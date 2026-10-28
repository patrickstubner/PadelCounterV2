import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { HOST_TOKEN_TTL_MS, isJoinToken, isRoomCode, isUuid, JOIN_TOKEN_TTL_MS, ROOM_MESSAGES, type MatchEvent, type MatchLog } from '@padel/core';
import { deviceId } from '../domain/device';
import { createMatchId } from '../domain/id';
import type { LiveSend } from '../hooks/useMatch';
import {
  ACK_MS,
  canonicalEventId,
  forgetJoinToken,
  HIDE_RECONNECT_MS,
  interpretMessage,
  isTerminalCode,
  isTerminalMessage,
  JOIN_KEY,
  joinLink,
  OFFLINE_COURT_MS,
  reconnectDelayMs,
  SLOW_BANNER_MS,
  shouldResumeSocket,
  socketUrl,
  unackedAfterSnapshot,
  type PendingLiveEvent,
} from './protocol';

export interface ShareOptions {
  readonly previousHostToken?: string;
  readonly carry?: boolean;
}

export interface LiveController {
  readonly configured: boolean;
  readonly status: 'off' | 'connecting' | 'live' | 'disconnected';
  /** local is black, online is dark blue, offline is dark red after the debounce. */
  readonly courtTone: 'local' | 'online' | 'offline';
  readonly host: boolean;
  readonly players: number;
  readonly qr: string | null;
  readonly error: string | null;
  readonly joinError: string | null;
  readonly joining: boolean;
  readonly offer: string | null;
  readonly share: (log: MatchLog, options?: ShareOptions) => void;
  readonly rotate: () => void;
  readonly connect: (token: string) => void;
  readonly rejectToken: () => void;
  readonly disconnect: () => void;
  readonly acceptOffer: () => void;
  readonly dismissOffer: () => void;
  /** Sends the end event, then drops this phone's socket. Returns the host token when this phone created the match. */
  readonly finishShared: (event: MatchEvent) => string | null;
}

async function errorText(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (isRoomCode(body.error)) return ROOM_MESSAGES[body.error];
  } catch {
    // The status is enough. Do not surface the raw body.
  }
  return ROOM_MESSAGES.offline;
}

function thisDevice(): string {
  try {
    if (typeof localStorage === 'undefined') return 'd00000000';
    return deviceId(localStorage);
  } catch {
    return 'd00000000';
  }
}

function devApiOverride(): string {
  if (!import.meta.env.DEV) return '';
  const testApi = (globalThis as { __PADEL_TEST_API__?: unknown }).__PADEL_TEST_API__;
  return typeof testApi === 'string' ? testApi.replace(/\/$/, '') : '';
}

interface PendingPoint extends PendingLiveEvent<MatchEvent> {
  sentAt: number;
  resent: boolean;
}

function apiBase(): string {
  const fromEnv = String(import.meta.env.PUBLIC_API_URL ?? '').replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  return devApiOverride();
}

export function useLive(
  liveRef: MutableRefObject<LiveSend | null>,
  replaceLog: (log: MatchLog) => void,
  applyLive: (event: MatchEvent) => void,
  revertLive: (event: MatchEvent) => void,
): LiveController {
  const api = apiBase();
  const [status, setStatus] = useState<'off' | 'connecting' | 'live' | 'disconnected'>('off');
  const [courtTone, setCourtTone] = useState<'local' | 'online' | 'offline'>('local');
  const [host, setHost] = useState(true);
  const [players, setPlayers] = useState(0);
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [offer, setOffer] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const hostRef = useRef<{ matchId: string; token: string } | null>(null);
  const replaceRef = useRef(replaceLog);
  const applyRef = useRef(applyLive);
  const revertRef = useRef(revertLive);
  const readyRef = useRef(false);
  const generation = useRef(0);
  const offerRef = useRef<string | null>(null);
  const tokenRef = useRef<{ token: string; expiresAt: number } | null>(null);
  const matchRef = useRef('');
  const resumes = useRef(0);
  const opening = useRef(false);
  const slowDown = useRef(false);
  const hadLive = useRef(false);
  const hiddenAt = useRef<number | null>(null);
  const wakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offlineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenRef = useRef(new Set<string>());
  const unackedRef = useRef<PendingPoint[]>([]);
  const queueRef = useRef<PendingPoint[]>([]);
  const wakeRef = useRef<() => void>(() => undefined);
  const reconnectNowRef = useRef<() => void>(() => undefined);
  replaceRef.current = replaceLog;
  applyRef.current = applyLive;
  revertRef.current = revertLive;

  const clearWake = () => {
    if (wakeTimer.current !== null) {
      clearTimeout(wakeTimer.current);
      wakeTimer.current = null;
    }
  };

  const dropToken = () => {
    tokenRef.current = null;
    try {
      forgetJoinToken(sessionStorage);
    } catch {
      // Storage may be blocked.
    }
  };

  const clearPending = () => {
    queueRef.current = [];
    unackedRef.current = [];
  };

  const clearSlowTimer = () => {
    if (slowTimer.current !== null) {
      clearTimeout(slowTimer.current);
      slowTimer.current = null;
    }
  };

  /** Handlers go first so a closing socket cannot open another connection. */
  const detachSocket = (ws: WebSocket | null) => {
    if (!ws) return;
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
    if (socketRef.current === ws) socketRef.current = null;
    try {
      ws.close();
    } catch {
      // Already closed.
    }
  };

  const socketIsUp = (ws: WebSocket | null): boolean =>
    ws !== null && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING);

  const armSlowClear = () => {
    clearSlowTimer();
    slowTimer.current = setTimeout(() => {
      slowTimer.current = null;
      setError((current) => (current === ROOM_MESSAGES.slow_down ? null : current));
      setJoinError((current) => (current === ROOM_MESSAGES.slow_down ? null : current));
    }, SLOW_BANNER_MS);
  };

  const noteError = (message: string) => {
    setError(message);
    if (message === ROOM_MESSAGES.slow_down) armSlowClear();
    else clearSlowTimer();
  };

  const clearSlowBanner = () => {
    clearSlowTimer();
    setError((current) => (current === ROOM_MESSAGES.slow_down ? null : current));
    setJoinError((current) => (current === ROOM_MESSAGES.slow_down ? null : current));
  };

  const persistHost = (matchId: string, held: { token: string; expiresAt: number }) => {
    hostRef.current = { matchId, token: held.token };
    try {
      sessionStorage.setItem(JOIN_KEY, JSON.stringify({
        token: held.token,
        expiresAt: held.expiresAt,
        host: true,
        matchId,
      }));
    } catch {
      // The ref still rotates a code until this tab closes.
    }
  };

  const rememberToken = (token: string, asJoin: boolean) => {
    const now = Date.now();
    const current = tokenRef.current;
    if (current && current.token === token) {
      if (current.expiresAt <= now) return null;
      return current;
    }
    const next = { token, expiresAt: now + (asJoin ? JOIN_TOKEN_TTL_MS : HOST_TOKEN_TTL_MS) };
    tokenRef.current = next;
    try {
      let matchId = '';
      const raw = sessionStorage.getItem(JOIN_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { token?: unknown; host?: unknown; matchId?: unknown };
        if (parsed.token === token && parsed.host === true && isUuid(parsed.matchId)) matchId = parsed.matchId.toLowerCase();
      }
      sessionStorage.setItem(JOIN_KEY, JSON.stringify({
        token: next.token,
        expiresAt: next.expiresAt,
        ...(matchId ? { host: true, matchId } : {}),
      }));
      if (matchId) hostRef.current = { matchId, token };
    } catch {
      // The in-memory copy still reconnects this visit.
    }
    return next;
  };

  const showLocalCourt = () => {
    hadLive.current = false;
    if (offlineTimer.current !== null) {
      clearTimeout(offlineTimer.current);
      offlineTimer.current = null;
    }
    setCourtTone('local');
  };

  const sendPoint = (ws: WebSocket, item: PendingPoint) => {
    if (ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify({ type: 'event', eventId: item.id, event: item.event }));
    } catch {
      return false;
    }
    item.sentAt = Date.now();
    return true;
  };

  const armSender = () => {
    liveRef.current = (courtEvent: MatchEvent) => {
      const eventId = canonicalEventId(createMatchId());
      const held = tokenRef.current;
      if (!eventId || !held) return false;
      const point: PendingPoint = {
        id: eventId,
        event: courtEvent,
        token: held.token,
        matchId: matchRef.current,
        sentAt: Date.now(),
        resent: false,
      };
      seenRef.current.add(eventId);
      unackedRef.current.push(point);
      applyRef.current(courtEvent);
      const ws = socketRef.current;
      if (!ws || !sendPoint(ws, point)) {
        queueRef.current.push(point);
        if (hadLive.current) setStatus('connecting');
        wakeRef.current();
      }
      return true;
    };
  };

  const resendOutstanding = (ws: WebSocket, matchId: string) => {
    const token = tokenRef.current?.token ?? '';
    const outstanding = unackedAfterSnapshot(
      [...unackedRef.current, ...queueRef.current],
      token,
      matchId,
      [...seenRef.current],
    ).map((item): PendingPoint => ({ ...item, sentAt: Date.now(), resent: false }));
    queueRef.current = [];
    unackedRef.current = outstanding;
    for (const item of outstanding) {
      if (!sendPoint(ws, item)) queueRef.current.push(item);
    }
  };

  const rememberOffer = (token: string | null) => {
    offerRef.current = token;
    setOffer(token);
  };

  const disconnect = () => {
    dropToken();
    clearPending();
    clearWake();
    showLocalCourt();
    generation.current += 1;
    opening.current = false;
    liveRef.current = null;
    readyRef.current = false;
    detachSocket(socketRef.current);
    hostRef.current = null;
    matchRef.current = '';
    setStatus('off');
    setHost(true);
    setQr(null);
    setPlayers(0);
    setError(null);
    rememberOffer(null);
  };

  const open = (token: string, asJoin: boolean) => {
    const held = tokenRef.current;
    if (held?.token === token && (opening.current || socketIsUp(socketRef.current))) return;
    if (held && held.token !== token) {
      clearPending();
      generation.current += 1;
      opening.current = false;
    }
    detachSocket(socketRef.current);
    if (!rememberToken(token, asJoin)) {
      dropToken();
      clearPending();
      liveRef.current = null;
      opening.current = false;
      showLocalCourt();
      setStatus('disconnected');
      setError(ROOM_MESSAGES.expired);
      setJoining(false);
      return;
    }
    opening.current = true;
    const fail = (message: string) => {
      opening.current = false;
      if (message === ROOM_MESSAGES.slow_down) slowDown.current = true;
      if (isTerminalMessage(message)) {
        dropToken();
        clearPending();
        liveRef.current = null;
        showLocalCourt();
        setStatus('disconnected');
        noteError(message);
        if (asJoin) setJoinError(message);
        setJoining(false);
        return;
      }
      setStatus(hadLive.current ? 'connecting' : 'off');
      if (asJoin) {
        setJoining(false);
        setJoinError(message);
        if (message === ROOM_MESSAGES.slow_down) armSlowClear();
        return;
      }
      noteError(message);
    };
    if (!isJoinToken(token)) {
      fail(ROOM_MESSAGES.bad_token);
      return;
    }
    const mine = generation.current + 1;
    generation.current = mine;
    void (async () => {
      if (!api) {
        fail(ROOM_MESSAGES.not_configured);
        return;
      }
      readyRef.current = false;
      detachSocket(socketRef.current);
      setStatus('connecting');
      if (asJoin) setJoinError(null);
      else setError(null);
      let ticket: string | undefined;
      try {
        const response = await fetch(`${api}/join`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ device: thisDevice() }),
        });
        if (generation.current !== mine) return;
        if (!response.ok) {
          fail(await errorText(response));
          return;
        }
        const body = (await response.json()) as { ticket?: unknown };
        if (typeof body.ticket !== 'string') {
          fail(ROOM_MESSAGES.offline);
          return;
        }
        ticket = body.ticket;
      } catch {
        if (generation.current !== mine) return;
        fail(ROOM_MESSAGES.offline);
        return;
      }
      if (!ticket || generation.current !== mine) return;
      const ws = new WebSocket(socketUrl(api, ticket));
      socketRef.current = ws;
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'hello', protocol: 1, token, device: thisDevice() }));
      };
      ws.onmessage = (event) => {
        if (socketRef.current !== ws) return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(event.data)) as unknown;
        } catch {
          return;
        }
        const notice = interpretMessage(parsed);
        if (notice.kind === 'join_offer') {
          rememberOffer(notice.token);
          return;
        }
        if (notice.kind === 'pong') return;
        if (notice.kind === 'error') {
          if (notice.code === 'slow_down') slowDown.current = true;
          if (notice.eventId) {
            const failed = unackedRef.current.find((item) => item.id === notice.eventId);
            if (failed) {
              unackedRef.current = unackedRef.current.filter((item) => item.id !== notice.eventId);
              queueRef.current = queueRef.current.filter((item) => item.id !== notice.eventId);
              seenRef.current.delete(notice.eventId);
              revertRef.current(failed.event);
            }
          }
          if (notice.code && isTerminalCode(notice.code)) {
            dropToken();
            clearPending();
            liveRef.current = null;
            readyRef.current = false;
            opening.current = false;
            showLocalCourt();
            setJoining(false);
            setStatus('disconnected');
            noteError(notice.message);
            detachSocket(ws);
            return;
          }
          if (asJoin && !readyRef.current) setJoinError(notice.message);
          else noteError(notice.message);
          if (asJoin && !readyRef.current) setJoining(false);
          if (!notice.close) return;
          readyRef.current = false;
          opening.current = false;
          setStatus(hadLive.current ? 'connecting' : 'off');
          detachSocket(ws);
          wakeRef.current();
          return;
        }
        if (notice.kind === 'presence') {
          setPlayers(notice.players);
          return;
        }
        if (notice.kind === 'delta') {
          unackedRef.current = unackedRef.current.filter((item) => item.id !== notice.eventId);
          queueRef.current = queueRef.current.filter((item) => item.id !== notice.eventId);
          if (!seenRef.current.has(notice.eventId)) {
            seenRef.current.add(notice.eventId);
            applyRef.current(notice.event);
          }
          setPlayers(notice.players);
          clearSlowBanner();
          return;
        }
        if (notice.kind === 'log') {
          const matchId = notice.log.base.matchId.toLowerCase();
          matchRef.current = matchId;
          seenRef.current = new Set(notice.eventIds.map((id) => id.toLowerCase()));
          replaceRef.current(notice.log);
          readyRef.current = true;
          hadLive.current = true;
          setCourtTone('online');
          setHost(notice.host);
          setPlayers(notice.players);
          setJoining(false);
          setJoinError(null);
          clearSlowTimer();
          setError(null);
          if (notice.host && tokenRef.current) persistHost(matchId, tokenRef.current);
          else {
            hostRef.current = null;
            try {
              const raw = sessionStorage.getItem(JOIN_KEY);
              if (raw) {
                const parsed = JSON.parse(raw) as { token?: unknown; expiresAt?: unknown; host?: unknown };
                if (parsed.host === true && parsed.token === tokenRef.current?.token && typeof parsed.expiresAt === 'number' && isJoinToken(parsed.token)) {
                  sessionStorage.setItem(JOIN_KEY, JSON.stringify({ token: parsed.token, expiresAt: parsed.expiresAt }));
                }
              }
            } catch {
              // The in-memory host ref is already clear.
            }
          }
          setStatus('live');
          resumes.current = 0;
          slowDown.current = false;
          opening.current = false;
          clearWake();
          armSender();
          resendOutstanding(ws, matchId);
        }
      };
      ws.onerror = () => {
        if (asJoin && !readyRef.current) {
          setJoining(false);
          setJoinError(ROOM_MESSAGES.offline);
          return;
        }
        setError(ROOM_MESSAGES.offline);
      };
      ws.onclose = () => {
        if (socketRef.current !== ws) return;
        socketRef.current = null;
        readyRef.current = false;
        opening.current = false;
        setJoining(false);
        if (!tokenRef.current) return;
        if (hadLive.current) setStatus('connecting');
        wakeRef.current();
      };
    })();
  };

  reconnectNowRef.current = () => {
    if (!tokenRef.current) return;
    clearWake();
    detachSocket(socketRef.current);
    opening.current = false;
    readyRef.current = false;
    open(tokenRef.current.token, false);
  };

  wakeRef.current = () => {
    const held = tokenRef.current;
    if (!held || wakeTimer.current !== null) return;
    if (held.expiresAt <= Date.now()) {
      dropToken();
      clearPending();
      liveRef.current = null;
      showLocalCourt();
      setStatus('disconnected');
      setError(ROOM_MESSAGES.expired);
      return;
    }
    const ws = socketRef.current;
    const visibility = typeof document === 'undefined' ? 'visible' : document.visibilityState;
    if (!shouldResumeSocket(visibility, ws ? ws.readyState : null, opening.current)) return;
    const delay = reconnectDelayMs(resumes.current, slowDown.current);
    resumes.current += 1;
    wakeTimer.current = setTimeout(() => {
      wakeTimer.current = null;
      const again = tokenRef.current;
      if (!again) return;
      open(again.token, false);
    }, delay);
  };

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(JOIN_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { token?: unknown; expiresAt?: unknown; host?: unknown; matchId?: unknown };
      if (parsed.host !== true || !isJoinToken(parsed.token) || !isUuid(parsed.matchId)) return;
      if (typeof parsed.expiresAt === 'number' && parsed.expiresAt <= Date.now()) return;
      hostRef.current = { matchId: parsed.matchId.toLowerCase(), token: parsed.token };
    } catch {
      // A missing host record only means Show QR creates a match.
    }
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    const onShow = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now();
        return;
      }
      const hiddenFor = hiddenAt.current === null ? 0 : Date.now() - hiddenAt.current;
      hiddenAt.current = null;
      resumes.current = 0;
      const stale = socketRef.current;
      if (hiddenFor >= HIDE_RECONNECT_MS && stale && hadLive.current) {
        detachSocket(stale);
        opening.current = false;
        readyRef.current = false;
        setStatus('connecting');
      }
      if (!socketIsUp(socketRef.current)) {
        reconnectNowRef.current();
        return;
      }
      wakeRef.current();
    };
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('pageshow', onShow);
    return () => {
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener('pageshow', onShow);
    };
  }, []);

  useEffect(() => {
    if (status === 'live') {
      hadLive.current = true;
      if (offlineTimer.current !== null) {
        clearTimeout(offlineTimer.current);
        offlineTimer.current = null;
      }
      setCourtTone('online');
      return;
    }
    if (status !== 'connecting' || !hadLive.current) {
      if (offlineTimer.current !== null) {
        clearTimeout(offlineTimer.current);
        offlineTimer.current = null;
      }
      setCourtTone('local');
      return;
    }
    if (courtTone === 'offline' || offlineTimer.current !== null) return;
    offlineTimer.current = setTimeout(() => {
      offlineTimer.current = null;
      setCourtTone('offline');
    }, OFFLINE_COURT_MS);
  }, [status, courtTone]);

  useEffect(() => () => {
    generation.current += 1;
    opening.current = false;
    detachSocket(socketRef.current);
    if (offlineTimer.current !== null) {
      clearTimeout(offlineTimer.current);
      offlineTimer.current = null;
    }
    if (slowTimer.current !== null) {
      clearTimeout(slowTimer.current);
      slowTimer.current = null;
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const timer = window.setInterval(() => {
      const ws = socketRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const now = Date.now();
      const stale = unackedRef.current.filter((item) => now - item.sentAt >= ACK_MS);
      if (stale.length === 0) return;
      const fresh = stale.filter((item) => !item.resent);
      if (fresh.length > 0) {
        for (const item of fresh) {
          try {
            ws.send(JSON.stringify({ type: 'ping' }));
            ws.send(JSON.stringify({ type: 'event', eventId: item.id, event: item.event }));
            item.resent = true;
            item.sentAt = now;
          } catch {
            try {
              ws.close();
            } catch {
              // The close handler resumes.
            }
          }
        }
        return;
      }
      reconnectNowRef.current();
    }, 500);
    return () => window.clearInterval(timer);
  }, []);

  const publishQr = async (matchId: string, hostToken: string) => {
    const response = await fetch(`${api}/matches/${matchId}/invites`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${hostToken}`,
      },
      body: JSON.stringify({ role: 'player' }),
    });
    if (!response.ok) {
      setError(await errorText(response));
      setStatus('off');
      return;
    }
    const body = (await response.json()) as { token?: unknown };
    if (typeof body.token !== 'string') {
      setError(ROOM_MESSAGES.offline);
      return;
    }
    const page = typeof location === 'undefined' ? 'https://patrickstubner.github.io/PadelCounterV2/' : location.href;
    setQr(joinLink(page, body.token));
  };

  return {
    configured: api.length > 0,
    status,
    courtTone,
    host,
    players,
    qr,
    error,
    joinError,
    joining,
    offer,
    disconnect,
    acceptOffer: () => {
      const token = offerRef.current;
      rememberOffer(null);
      if (!token) return;
      setJoining(true);
      open(token, true);
    },
    dismissOffer: () => rememberOffer(null),
    finishShared: (event) => {
      const previous = hostRef.current?.token ?? null;
      const ws = socketRef.current;
      dropToken();
      clearPending();
      clearWake();
      showLocalCourt();
      liveRef.current = null;
      readyRef.current = false;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'event', eventId: createMatchId(), event }));
      }
      generation.current += 1;
      detachSocket(ws);
      hostRef.current = null;
      setStatus('off');
      setHost(true);
      setQr(null);
      setPlayers(0);
      return previous;
    },
    connect: (token) => {
      if (tokenRef.current?.token === token && (opening.current || socketIsUp(socketRef.current))) return;
      setJoining(true);
      setJoinError(null);
      open(token, hostRef.current?.token !== token);
    },
    rejectToken: () => {
      setJoining(false);
      setJoinError(ROOM_MESSAGES.bad_token);
      setStatus('off');
    },
    share: (log, options) => {
      const current = hostRef.current;
      if (current && !options?.previousHostToken) {
        void publishQr(current.matchId, current.token);
        return;
      }
      void (async () => {
        if (!api) {
          setError(ROOM_MESSAGES.not_configured);
          return;
        }
        setStatus('connecting');
        setError(null);
        try {
          const response = await fetch(`${api}/matches`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              log,
              device: thisDevice(),
              ...(options?.previousHostToken
                ? { previousHostToken: options.previousHostToken, carry: options.carry === true }
                : {}),
            }),
          });
          if (!response.ok) {
            setError(await errorText(response));
            setStatus('off');
            return;
          }
          const body = (await response.json()) as { matchId?: unknown; hostToken?: unknown };
          if (typeof body.matchId !== 'string' || typeof body.hostToken !== 'string') {
            setError(ROOM_MESSAGES.offline);
            setStatus('off');
            return;
          }
          const held = rememberToken(body.hostToken, false);
          if (held) persistHost(body.matchId.toLowerCase(), held);
          open(body.hostToken, false);
          if (options?.carry && options.previousHostToken) {
            try {
              const carried = await fetch(`${api}/matches/${body.matchId}/carry`, {
                method: 'POST',
                headers: {
                  'content-type': 'application/json',
                  authorization: `Bearer ${body.hostToken}`,
                },
                body: JSON.stringify({ confirm: true, previousHostToken: options.previousHostToken }),
              });
              if (!carried.ok) setError(await errorText(carried));
            } catch {
              setError(ROOM_MESSAGES.offline);
            }
          }
          await publishQr(body.matchId, body.hostToken);
        } catch {
          setError(ROOM_MESSAGES.offline);
          setStatus('off');
        }
      })();
    },
    rotate: () => {
      const current = hostRef.current;
      if (!current) return;
      void publishQr(current.matchId, current.token);
    },
  };
}
