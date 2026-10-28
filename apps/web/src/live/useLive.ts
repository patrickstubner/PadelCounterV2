import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { isJoinToken, isRoomCode, ROOM_MESSAGES, type MatchEvent, type MatchLog } from '@padel/core';
import { deviceId } from '../domain/device';
import { createMatchId } from '../domain/id';
import type { LiveSend } from '../hooks/useMatch';
import { forgetJoinToken, interpretMessage, joinLink, shouldResumeSocket, socketUrl } from './protocol';

export interface ShareOptions {
  readonly previousHostToken?: string;
  readonly carry?: boolean;
}

export interface LiveController {
  readonly configured: boolean;
  readonly status: 'off' | 'connecting' | 'live';
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
  const [status, setStatus] = useState<'off' | 'connecting' | 'live'>('off');
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
  const tokenRef = useRef<string | null>(null);
  const resumes = useRef(0);
  const opening = useRef(false);
  const seenRef = useRef(new Set<string>());
  const unackedRef = useRef<{ id: string; event: MatchEvent }[]>([]);
  const queueRef = useRef<{ id: string; event: MatchEvent }[]>([]);
  const wakeRef = useRef<() => void>(() => undefined);
  replaceRef.current = replaceLog;
  applyRef.current = applyLive;
  revertRef.current = revertLive;

  const armSender = () => {
    liveRef.current = (courtEvent: MatchEvent) => {
      const eventId = createMatchId();
      seenRef.current.add(eventId);
      unackedRef.current.push({ id: eventId, event: courtEvent });
      applyRef.current(courtEvent);
      const ws = socketRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'event', eventId, event: courtEvent }));
      } else {
        queueRef.current.push({ id: eventId, event: courtEvent });
        wakeRef.current();
      }
      return true;
    };
  };

  const flushQueue = (ws: WebSocket) => {
    const pending = queueRef.current.splice(0);
    for (const item of pending) {
      if (seenRef.current.has(item.id)) {
        unackedRef.current = unackedRef.current.filter((row) => row.id !== item.id);
        continue;
      }
      if (ws.readyState !== WebSocket.OPEN) {
        queueRef.current.push(item);
        continue;
      }
      ws.send(JSON.stringify({ type: 'event', eventId: item.id, event: item.event }));
    }
  };

  const rememberOffer = (token: string | null) => {
    offerRef.current = token;
    setOffer(token);
  };

  const disconnect = () => {
    tokenRef.current = null;
    queueRef.current = [];
    generation.current += 1;
    liveRef.current = null;
    readyRef.current = false;
    socketRef.current?.close();
    socketRef.current = null;
    hostRef.current = null;
    setStatus('off');
    setHost(true);
    setQr(null);
    setPlayers(0);
    rememberOffer(null);
  };

  const open = (token: string, asJoin: boolean) => {
    tokenRef.current = token;
    if (opening.current) return;
    opening.current = true;
    const fail = (message: string) => {
      opening.current = false;
      setStatus('off');
      if (asJoin) {
        setJoining(false);
        setJoinError(message);
        const rejected = message === ROOM_MESSAGES.bad_token
          || message === ROOM_MESSAGES.expired
          || message === ROOM_MESSAGES.revoked;
        if (rejected) {
          tokenRef.current = null;
          try {
            forgetJoinToken(sessionStorage);
          } catch {
            // Storage may be blocked.
          }
        }
        return;
      }
      setError(message);
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
      const previous = socketRef.current;
      socketRef.current = null;
      previous?.close();
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
        if (notice.kind === 'error') {
          const failed = unackedRef.current.shift();
          if (failed && !notice.close) {
            seenRef.current.delete(failed.id);
            revertRef.current(failed.event);
          }
          if (asJoin && !readyRef.current) setJoinError(notice.message);
          else setError(notice.message);
          if (asJoin && !readyRef.current) setJoining(false);
          if (!notice.close) return;
          readyRef.current = false;
          setStatus('off');
          tokenRef.current = null;
          try {
            forgetJoinToken(sessionStorage);
          } catch {
            // Storage may be blocked. The in-memory token is already cleared.
          }
          ws.close();
          return;
        }
        if (notice.kind === 'presence') {
          setPlayers(notice.players);
          return;
        }
        if (notice.kind === 'delta') {
          unackedRef.current = unackedRef.current.filter((item) => item.id !== notice.eventId);
          if (!seenRef.current.has(notice.eventId)) {
            seenRef.current.add(notice.eventId);
            applyRef.current(notice.event);
          }
          setPlayers(notice.players);
          return;
        }
        if (notice.kind === 'log') {
          replaceRef.current(notice.log);
          seenRef.current = new Set(notice.eventIds);
          readyRef.current = true;
          setHost(notice.host);
          setPlayers(notice.players);
          setJoining(false);
          setJoinError(null);
          setStatus('live');
          resumes.current = 0;
          opening.current = false;
          armSender();
          flushQueue(ws);
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
        if (tokenRef.current) wakeRef.current();
      };
    })();
  };

  wakeRef.current = () => {
    if (!tokenRef.current || resumes.current >= 4) return;
    const ws = socketRef.current;
    const visibility = typeof document === 'undefined' ? 'visible' : document.visibilityState;
    if (!shouldResumeSocket(visibility, ws ? ws.readyState : null, opening.current)) return;
    resumes.current += 1;
    const token = tokenRef.current;
    open(token, false);
  };

  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    const onShow = () => {
      if (document.visibilityState === 'hidden') return;
      resumes.current = 0;
      wakeRef.current();
    };
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('pageshow', onShow);
    return () => {
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener('pageshow', onShow);
    };
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
      tokenRef.current = null;
      queueRef.current = [];
      liveRef.current = null;
      readyRef.current = false;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'event', eventId: createMatchId(), event }));
      }
      generation.current += 1;
      ws?.close();
      socketRef.current = null;
      hostRef.current = null;
      setStatus('off');
      setHost(true);
      setQr(null);
      setPlayers(0);
      return previous;
    },
    connect: (token) => {
      setJoining(true);
      setJoinError(null);
      open(token, true);
    },
    rejectToken: () => {
      setJoining(false);
      setJoinError(ROOM_MESSAGES.bad_token);
      setStatus('off');
    },
    share: (log, options) => {
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
          hostRef.current = { matchId: body.matchId, token: body.hostToken };
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
