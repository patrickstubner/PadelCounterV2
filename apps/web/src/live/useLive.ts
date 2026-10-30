import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { HOST_TOKEN_TTL_MS, isJoinToken, isRoomCode, isScoreEvent, isUuid, JOIN_TOKEN_TTL_MS, LIVE_PROTOCOL, MAX_PENDING_EVENTS, planMerge, replayScore, ROOM_MESSAGES, normalizeJoinCode, prepareLiveLog, sameBoard, scoreBoard, type CausalEvent, type MatchEvent, type MatchLog, type ScoreClaim } from '@padel/core';
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
  onlineRetryAllowed,
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
  readonly code: string | null;
  readonly error: string | null;
  readonly joinError: string | null;
  readonly joining: boolean;
  readonly offer: string | null;
  /** The old match ended and this phone was not moved into the new one. */
  readonly continued: boolean;
  readonly dismissContinued: () => void;
  readonly pendingRestore: readonly { readonly id: string; readonly event: MatchEvent; readonly claim: ScoreClaim | null }[];
  readonly clearRestore: () => void;
  readonly commitRestore: () => MatchEvent[];
  readonly share: (log: MatchLog, options?: ShareOptions) => void;
  readonly rotate: () => void;
  readonly connect: (token: string) => void;
  readonly joinByCode: (code: string) => Promise<boolean>;
  readonly rejectToken: () => void;
  readonly disconnect: () => void;
  readonly acceptOffer: () => void;
  readonly dismissOffer: () => void;
  /** Sends the end event, then drops this phone's socket. Returns the member token. */
  readonly finishShared: (event: MatchEvent, claim: ScoreClaim | null) => string | null;
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
  claim: ScoreClaim | null;
  parentId: string | null;
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
  readLog: () => MatchLog,
): LiveController {
  const api = apiBase();
  const [status, setStatus] = useState<'off' | 'connecting' | 'live' | 'disconnected'>('off');
  const [courtTone, setCourtTone] = useState<'local' | 'online' | 'offline'>('local');
  const [host, setHost] = useState(true);
  const [players, setPlayers] = useState(0);
  const [qr, setQr] = useState<string | null>(null);
  const [matchCode, setMatchCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [offer, setOffer] = useState<string | null>(null);
  const [continued, setContinued] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<readonly { id: string; event: MatchEvent; claim: ScoreClaim | null }[]>([]);
  const socketRef = useRef<WebSocket | null>(null);
  const hostRef = useRef<{
    matchId: string;
    token: string;
    inviteToken: string | null;
    inviteExpiresAt: number;
    inviteCode: string | null;
  } | null>(null);
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
  const nameSeq = useRef(0);
  const lastOnlineRetry = useRef(0);
  const hadLive = useRef(false);
  const hiddenAt = useRef<number | null>(null);
  const wakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offlineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenRef = useRef(new Set<string>());
  const conflictNote = useRef(false);
  const keptRetry = useRef(new Set<string>());
  const headRef = useRef<string | null>(null);
  const logIdsRef = useRef<string[]>([]);
  const readLogRef = useRef(readLog);
  const pendingRef = useRef(pendingRestore);
  readLogRef.current = readLog;
  pendingRef.current = pendingRestore;
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
    keptRetry.current = new Set();
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

  const writeHost = (held: { token: string; expiresAt: number }) => {
    const current = hostRef.current;
    if (!current) return;
    try {
      sessionStorage.setItem(JOIN_KEY, JSON.stringify({
        token: held.token,
        expiresAt: held.expiresAt,
        host: true,
        matchId: current.matchId,
        ...(current.inviteToken ? { inviteToken: current.inviteToken, inviteExpiresAt: current.inviteExpiresAt } : {}),
        ...(current.inviteCode ? { inviteCode: current.inviteCode } : {}),
      }));
    } catch {
      // The ref still shows or rotates a code until this tab closes.
    }
  };

  const persistMember = (matchId: string, held: { token: string; expiresAt: number }) => {
    const same = hostRef.current?.matchId === matchId ? hostRef.current : null;
    const next = {
      matchId,
      token: held.token,
      inviteToken: same?.inviteToken ?? null,
      inviteExpiresAt: same?.inviteExpiresAt ?? 0,
      inviteCode: same?.inviteCode ?? null,
    };
    hostRef.current = next;
    try {
      sessionStorage.setItem(JOIN_KEY, JSON.stringify({
        token: held.token,
        expiresAt: held.expiresAt,
        host: false,
        matchId,
        ...(next.inviteToken ? { inviteToken: next.inviteToken, inviteExpiresAt: next.inviteExpiresAt } : {}),
        ...(next.inviteCode ? { inviteCode: next.inviteCode } : {}),
      }));
    } catch {
      // The ref still shows the code until this tab closes.
    }
  };

  const persistHost = (matchId: string, held: { token: string; expiresAt: number }) => {
    const same = hostRef.current?.matchId === matchId ? hostRef.current : null;
    hostRef.current = {
      matchId,
      token: held.token,
      inviteToken: same?.inviteToken ?? null,
      inviteExpiresAt: same?.inviteExpiresAt ?? 0,
      inviteCode: same?.inviteCode ?? null,
    };
    writeHost(held);
  };

  const rememberInvite = (inviteToken: string, inviteExpiresAt: number, inviteCode: string | null) => {
    const current = hostRef.current;
    const held = tokenRef.current;
    if (!current || !held) return;
    hostRef.current = { ...current, inviteToken, inviteExpiresAt, inviteCode };
    setMatchCode(inviteCode);
    writeHost(held);
  };

  const rememberToken = (token: string, asJoin: boolean) => {
    const now = Date.now();
    const current = tokenRef.current;
    if (current && current.token === token) {
      if (current.expiresAt <= now) return null;
      return current;
    }
    let keptExpiry: number | null = null;
    try {
      const raw = sessionStorage.getItem(JOIN_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { token?: unknown; expiresAt?: unknown };
        if (parsed.token === token && typeof parsed.expiresAt === 'number' && parsed.expiresAt > now) {
          keptExpiry = parsed.expiresAt;
        }
      }
    } catch {
      // A missing expiry gets a fresh lifetime below.
    }
    const next = { token, expiresAt: keptExpiry ?? now + (asJoin ? JOIN_TOKEN_TTL_MS : HOST_TOKEN_TTL_MS) };
    tokenRef.current = next;
    try {
      let matchId = '';
      let hostFlag = false;
      let inviteToken: string | null = null;
      let inviteExpiresAt = 0;
      let inviteCode: string | null = null;
      const raw = sessionStorage.getItem(JOIN_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          token?: unknown;
          host?: unknown;
          matchId?: unknown;
          inviteToken?: unknown;
          inviteExpiresAt?: unknown;
          inviteCode?: unknown;
        };
        if (parsed.token === token && isUuid(parsed.matchId) && (parsed.host === true || parsed.host === false)) {
          matchId = parsed.matchId.toLowerCase();
          hostFlag = parsed.host === true;
          if (isJoinToken(parsed.inviteToken) && typeof parsed.inviteExpiresAt === 'number') {
            inviteToken = parsed.inviteToken;
            inviteExpiresAt = parsed.inviteExpiresAt;
          }
          const storedCode = normalizeJoinCode(parsed.inviteCode);
          if (storedCode) inviteCode = storedCode;
        }
      }
      sessionStorage.setItem(JOIN_KEY, JSON.stringify({
        token: next.token,
        expiresAt: next.expiresAt,
        ...(matchId ? {
          host: hostFlag,
          matchId,
          ...(inviteToken ? { inviteToken, inviteExpiresAt } : {}),
          ...(inviteCode ? { inviteCode } : {}),
        } : {}),
      }));
      if (matchId) hostRef.current = { matchId, token, inviteToken, inviteExpiresAt, inviteCode };
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
    const body = item.event.type === 'team/rename'
      ? { type: 'team_renamed', eventId: item.id, team: item.event.team.toUpperCase(), name: item.event.name }
      : {
          type: 'event',
          eventId: item.id,
          parentId: item.parentId,
          event: item.event,
          ...(item.claim ? { claim: item.claim } : {}),
        };
    try {
      ws.send(JSON.stringify(body));
    } catch {
      return false;
    }
    item.sentAt = Date.now();
    return true;
  };

  const armSender = () => {
    liveRef.current = (courtEvent: MatchEvent, claim: ScoreClaim | null) => {
      const eventId = canonicalEventId(createMatchId());
      const held = tokenRef.current;
      if (!eventId || !held) return false;
      if (unackedRef.current.length >= MAX_PENDING_EVENTS) {
        noteError(ROOM_MESSAGES.slow_down);
        return true;
      }
      const parentId = headRef.current;
      const point: PendingPoint = {
        id: eventId,
        event: courtEvent,
        token: held.token,
        matchId: matchRef.current,
        sentAt: Date.now(),
        resent: false,
        claim,
        parentId,
      };
      headRef.current = eventId;
      logIdsRef.current.push(eventId);
      seenRef.current.add(eventId);
      unackedRef.current.push(point);
      applyRef.current(courtEvent);
      const ws = socketRef.current;
      const queuedIds = new Set(queueRef.current.map((item) => item.id));
      const waiting = !readyRef.current || unackedRef.current.some((item) => isScoreEvent(item.event.type) && item.id !== eventId && !queuedIds.has(item.id));
      if (waiting || !ws || !sendPoint(ws, point)) {
        queueRef.current.push(point);
        if (hadLive.current && !waiting) {
          setStatus('connecting');
          wakeRef.current();
        }
      }
      return true;
    };
  };

  const flushQueued = (ws: WebSocket) => {
    if (!readyRef.current) return;
    const rest: PendingPoint[] = [];
    let blocked = unackedRef.current.some((item) => isScoreEvent(item.event.type) && !queueRef.current.some((queued) => queued.id === item.id));
    for (const item of queueRef.current) {
      if (blocked) {
        rest.push(item);
        continue;
      }
      if (!sendPoint(ws, item)) {
        rest.push(item);
        if (isScoreEvent(item.event.type)) blocked = true;
        continue;
      }
      if (isScoreEvent(item.event.type)) blocked = true;
    }
    queueRef.current = rest;
  };

  const resendOutstanding = (ws: WebSocket, matchId: string, log: MatchLog, eventIds: readonly string[]): 'already' | 'fast-forward' | 'merged' | 'ambiguous' => {
    const token = tokenRef.current?.token ?? '';
    const outstanding = unackedAfterSnapshot(
      [...unackedRef.current, ...queueRef.current],
      token,
      matchId,
      [...seenRef.current],
    ).map((item): PendingPoint => ({ ...item, claim: item.claim ?? null, parentId: item.parentId ?? null, sentAt: Date.now(), resent: false }));
    const server: CausalEvent[] = log.events.flatMap((event, index) => {
      const id = eventIds[index];
      if (!id) return [];
      const previous = index === 0 ? null : eventIds[index - 1] ?? null;
      return [{
        id,
        parentId: event.parentId === undefined ? previous : event.parentId,
        event,
        claim: null,
      }];
    });
    const stateNow = replayScore(log.base, log.events);
    const listed = (items: readonly CausalEvent[]) => items.filter((item) => {
      if (item.claim && sameBoard(scoreBoard(stateNow), item.claim.after)) return false;
      const alone = planMerge(log.base, server, [item]);
      return alone.reason !== 'already';
    }).map((item) => ({ id: item.id, event: item.event, claim: item.claim }));
    const plan = planMerge(
      log.base,
      server,
      outstanding.map((item) => ({ id: item.id, parentId: item.parentId, event: item.event, claim: item.claim })),
    );
    const sendById = new Map(plan.send.map((item) => [item.id, item]));
    const sending = outstanding.flatMap((item) => {
      const planned = sendById.get(item.id);
      return planned ? [{ ...item, parentId: planned.parentId, claim: planned.claim }] : [];
    });
    queueRef.current = [];
    unackedRef.current = sending;
    const known = new Set(eventIds);
    if (plan.reason === 'ambiguous') {
      const incoming = listed(plan.ambiguous);
      const incomingIds = new Set(incoming.map((item) => item.id));
      setPendingRestore((current) => {
        const kept = current.filter((item) => !known.has(item.id) && !incomingIds.has(item.id));
        return [...kept, ...incoming].slice(0, MAX_PENDING_EVENTS);
      });
      return plan.reason;
    }
    setPendingRestore((current) => current.filter((item) => !known.has(item.id) && !sendById.has(item.id)));
    for (const item of sending) {
      if (!sendPoint(ws, item)) queueRef.current.push(item);
    }
    return plan.reason;
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
    setMatchCode(null);
    setPlayers(0);
    setError(null);
    setPendingRestore([]);
    rememberOffer(null);
  };

  const open = (token: string, asJoin: boolean, existingTicket?: string) => {
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
      if (tokenRef.current && message !== ROOM_MESSAGES.not_configured) wakeRef.current();
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
      else if (!hadLive.current) setError(null);
      let ticket: string | undefined = existingTicket;
      if (!ticket) {
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
          if (!asJoin) {
            setError(null);
            setJoinError(null);
          }
        } catch {
          if (generation.current !== mine) return;
          fail(ROOM_MESSAGES.offline);
          return;
        }
      }
      if (!ticket || generation.current !== mine) return;
      const ws = new WebSocket(socketUrl(api, ticket));
      socketRef.current = ws;
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'hello', protocol: LIVE_PROTOCOL, token, device: thisDevice(), clientNow: Date.now() }));
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
        if (notice.kind === 'match_moved') {
          setContinued(false);
          setJoining(true);
          open(notice.token, true);
          return;
        }
        if (notice.kind === 'match_notice') {
          setContinued(true);
          return;
        }
        if (notice.kind === 'pong') return;
        if (notice.kind === 'error') {
          if (notice.code === 'score_kept') {
            const rejectedId = notice.eventId ?? '';
            const rejected = unackedRef.current.find((item) => item.id === rejectedId);
            unackedRef.current = unackedRef.current.filter((item) => item.id !== rejectedId);
            queueRef.current = queueRef.current.filter((item) => item.id !== rejectedId);
            if (keptRetry.current.has(rejectedId)) {
              const currentLog = readLogRef.current();
              const checked = rejected
                ? planMerge(currentLog.base, currentLog.events.map((event, index) => ({
                  id: logIdsRef.current[index] ?? `local-${index}`,
                  parentId: index === 0 ? null : logIdsRef.current[index - 1] ?? null,
                  event,
                  claim: null,
                })), [{ id: rejected.id, parentId: rejected.parentId, event: rejected.event, claim: rejected.claim }])
                : null;
              const board = scoreBoard(replayScore(currentLog.base, currentLog.events));
              const alreadyThere = checked?.reason === 'already'
                || (rejected?.claim != null && sameBoard(board, rejected.claim.after));
              if (!alreadyThere && rejected) {
                seenRef.current.delete(rejected.id);
                setPendingRestore((current) => {
                  if (current.some((item) => item.id === rejected.id)) return current;
                  return [...current, { id: rejected.id, event: rejected.event, claim: rejected.claim }].slice(0, MAX_PENDING_EVENTS);
                });
                noteError(ROOM_MESSAGES.score_kept);
              }
              return;
            }
            keptRetry.current.add(rejectedId);
            if (rejected) {
              seenRef.current.delete(rejected.id);
              queueRef.current.push({ ...rejected, sentAt: 0, resent: false });
            }
            conflictNote.current = true;
            reconnectNowRef.current();
            return;
          }
          if (notice.code === 'slow_down') slowDown.current = true;
          if (notice.eventId) {
            const failed = unackedRef.current.find((item) => item.id === notice.eventId);
            if (failed) {
              unackedRef.current = unackedRef.current.filter((item) => item.id !== notice.eventId);
              queueRef.current = queueRef.current.filter((item) => item.id !== notice.eventId);
              seenRef.current.delete(notice.eventId);
              if (logIdsRef.current.at(-1) === notice.eventId) logIdsRef.current.pop();
              revertRef.current(failed.event);
            }
          }
          if (notice.code === 'revoked' || notice.code === 'expired') {
            const current = hostRef.current;
            if (current) hostRef.current = { ...current, inviteToken: null, inviteExpiresAt: 0, inviteCode: null };
            setQr(null);
            setMatchCode(null);
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
          const foreign = !notice.duplicate && !seenRef.current.has(notice.eventId);
          unackedRef.current = unackedRef.current.filter((item) => item.id !== notice.eventId);
          queueRef.current = queueRef.current.filter((item) => item.id !== notice.eventId);
          if (foreign) {
            applyRef.current(notice.event);
            logIdsRef.current.push(notice.eventId);
            headRef.current = notice.eventId;
          }
          seenRef.current.add(notice.eventId);
          setPlayers(notice.players);
          clearSlowBanner();
          flushQueued(ws);
          return;
        }
        if (notice.kind === 'tail') {
          const current = readLogRef.current();
          const ids = logIdsRef.current;
          const cut = notice.since === null ? -1 : ids.lastIndexOf(notice.since);
          if (notice.since !== null && cut < 0) {
            reconnectNowRef.current();
            return;
          }
          const prefixEvents = notice.since === null ? [] : current.events.slice(0, cut + 1);
          const prefixIds = notice.since === null ? [] : ids.slice(0, cut + 1);
          const nextLog = { ...current, events: [...prefixEvents, ...notice.events] };
          const nextIds = [...prefixIds, ...notice.eventIds];
          logIdsRef.current = nextIds;
          seenRef.current = new Set(nextIds.map((id) => id.toLowerCase()));
          headRef.current = nextIds[nextIds.length - 1] ?? null;
          const kept = new Set(nextIds);
          unackedRef.current = unackedRef.current.filter((item) => !kept.has(item.id));
          queueRef.current = queueRef.current.filter((item) => !kept.has(item.id));
          replaceRef.current(nextLog);
          setPlayers(notice.players);
          nameSeq.current = Math.max(nameSeq.current, notice.nameSeq);
          resendOutstanding(ws, matchRef.current, nextLog, nextIds);
          return;
        }
        if (notice.kind === 'rename') {
          unackedRef.current = unackedRef.current.filter((item) => item.id !== notice.eventId);
          queueRef.current = queueRef.current.filter((item) => item.id !== notice.eventId);
          if (notice.seq <= nameSeq.current) return;
          nameSeq.current = notice.seq;
          if (!seenRef.current.has(notice.eventId)) {
            logIdsRef.current.push(notice.eventId);
            headRef.current = notice.eventId;
          }
          seenRef.current.add(notice.eventId);
          applyRef.current({ type: 'team/rename', team: notice.team, name: notice.name, at: Date.now() });
          return;
        }
        if (notice.kind === 'log') {
          const matchId = notice.log.base.matchId.toLowerCase();
          matchRef.current = matchId;
          seenRef.current = new Set(notice.eventIds.map((id) => id.toLowerCase()));
          logIdsRef.current = [...notice.eventIds];
          headRef.current = notice.eventIds[notice.eventIds.length - 1] ?? null;
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
          else if (tokenRef.current) persistMember(matchId, tokenRef.current);
          setContinued(false);
          setStatus('live');
          resumes.current = 0;
          slowDown.current = false;
          nameSeq.current = Math.max(nameSeq.current, notice.nameSeq);
          opening.current = false;
          clearWake();
          armSender();
          const merged = resendOutstanding(ws, matchId, notice.log, notice.eventIds);
          if (conflictNote.current) {
            conflictNote.current = false;
            if (merged === 'ambiguous') noteError(ROOM_MESSAGES.score_kept);
          }
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
    const penalise = slowDown.current;
    if (penalise) slowDown.current = false;
    const delay = reconnectDelayMs(resumes.current, penalise);
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
      const parsed = JSON.parse(raw) as {
        token?: unknown;
        expiresAt?: unknown;
        host?: unknown;
        matchId?: unknown;
        inviteToken?: unknown;
        inviteExpiresAt?: unknown;
        inviteCode?: unknown;
      };
      if ((parsed.host !== true && parsed.host !== false) || !isJoinToken(parsed.token) || !isUuid(parsed.matchId)) return;
      if (typeof parsed.expiresAt === 'number' && parsed.expiresAt <= Date.now()) return;
      const inviteToken = isJoinToken(parsed.inviteToken) ? parsed.inviteToken : null;
      const inviteExpiresAt = typeof parsed.inviteExpiresAt === 'number' ? parsed.inviteExpiresAt : 0;
      const inviteCode = normalizeJoinCode(parsed.inviteCode);
      hostRef.current = { matchId: parsed.matchId.toLowerCase(), token: parsed.token, inviteToken, inviteExpiresAt, inviteCode };
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
    const onOnline = () => {
      const now = Date.now();
      if (!onlineRetryAllowed(lastOnlineRetry.current, now)) return;
      if (!tokenRef.current) return;
      if (readyRef.current && socketIsUp(socketRef.current)) return;
      lastOnlineRetry.current = now;
      clearWake();
      resumes.current = 0;
      if (slowDown.current) {
        wakeRef.current();
        return;
      }
      reconnectNowRef.current();
    };
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener('pageshow', onShow);
      window.removeEventListener('online', onOnline);
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
    clearWake();
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
            sendPoint(ws, item);
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

  const publishQr = async (matchId: string, memberToken: string, rotate = false) => {
    const response = await fetch(`${api}/matches/${matchId}/invites`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({ role: 'player', ...(rotate ? { rotate: true } : {}) }),
    });
    if (!response.ok) {
      setError(await errorText(response));
      return;
    }
    const body = (await response.json()) as { token?: unknown; expiresAt?: unknown; code?: unknown };
    if (typeof body.token !== 'string') {
      setError(ROOM_MESSAGES.offline);
      return;
    }
    const expiresAt = typeof body.expiresAt === 'number' && Number.isFinite(body.expiresAt)
      ? body.expiresAt
      : Date.now() + JOIN_TOKEN_TTL_MS;
    rememberInvite(body.token, expiresAt, normalizeJoinCode(body.code));
    setError(null);
    setJoinError(null);
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
    code: matchCode,
    error,
    joinError,
    joining,
    offer,
    continued,
    dismissContinued: () => setContinued(false),
    pendingRestore,
    clearRestore: () => setPendingRestore([]),
    commitRestore: () => {
      const log = readLogRef.current();
      const state = replayScore(log.base, log.events);
      const board = scoreBoard(state);
      const server: CausalEvent[] = log.events.map((event, index) => ({
        id: logIdsRef.current[index] ?? `local-${index}`,
        parentId: index === 0 ? null : logIdsRef.current[index - 1] ?? null,
        event,
        claim: null,
      }));
      const events: MatchEvent[] = [];
      for (const item of pendingRef.current) {
        if (item.claim && sameBoard(board, item.claim.after)) continue;
        const plan = planMerge(log.base, server, [{ id: item.id, parentId: headRef.current, event: item.event, claim: item.claim }]);
        if (plan.reason === 'already' || (plan.send.length === 0 && plan.ambiguous.length === 0)) continue;
        events.push(item.event);
      }
      setPendingRestore([]);
      return events;
    },
    disconnect,
    acceptOffer: () => {
      const token = offerRef.current;
      rememberOffer(null);
      if (!token) return;
      setJoining(true);
      open(token, true);
    },
    dismissOffer: () => rememberOffer(null),
    finishShared: (event, claim) => {
      const previous = tokenRef.current?.token ?? hostRef.current?.token ?? null;
      const ws = socketRef.current;
      dropToken();
      clearPending();
      clearWake();
      showLocalCourt();
      liveRef.current = null;
      readyRef.current = false;
      if (ws && ws.readyState === WebSocket.OPEN && (claim || !isScoreEvent(event.type))) {
        ws.send(JSON.stringify({
          type: 'event',
          eventId: createMatchId(),
          parentId: headRef.current,
          event,
          ...(claim ? { claim } : {}),
        }));
      }
      generation.current += 1;
      detachSocket(ws);
      hostRef.current = null;
      setStatus('off');
      setHost(true);
      setQr(null);
      setMatchCode(null);
      setPlayers(0);
      return previous;
    },
    connect: (token) => {
      if (tokenRef.current?.token === token && (opening.current || socketIsUp(socketRef.current))) return;
      setJoining(true);
      setJoinError(null);
      open(token, hostRef.current?.token !== token);
    },
    joinByCode: async (code) => {
      const normalized = normalizeJoinCode(code);
      if (!normalized) {
        setJoinError(ROOM_MESSAGES.join_code);
        return false;
      }
      if (!api) {
        setJoinError(ROOM_MESSAGES.not_configured);
        return false;
      }
      try {
        const response = await fetch(`${api}/join`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ device: thisDevice(), code: normalized }),
        });
        if (!response.ok) {
          setJoinError(await errorText(response));
          return false;
        }
        const body = (await response.json()) as { token?: unknown; ticket?: unknown };
        if (!isJoinToken(body.token) || typeof body.ticket !== 'string') {
          setJoinError(ROOM_MESSAGES.join_code);
          return false;
        }
        setJoining(true);
        setJoinError(null);
        open(body.token, true, body.ticket);
        return true;
      } catch {
        setJoinError(ROOM_MESSAGES.offline);
        return false;
      }
    },
    rejectToken: () => {
      setJoining(false);
      setJoinError(ROOM_MESSAGES.bad_token);
      setStatus('off');
    },
    share: (log, options) => {
      const current = hostRef.current;
      if (current && !options?.previousHostToken) {
        if (current.inviteToken && current.inviteExpiresAt > Date.now()) {
          const page = typeof location === 'undefined' ? 'https://patrickstubner.github.io/PadelCounterV2/' : location.href;
          setQr(joinLink(page, current.inviteToken));
          setMatchCode(current.inviteCode);
          return;
        }
        void publishQr(current.matchId, current.token);
        return;
      }
      void (async () => {
        if (!api) {
          setError(ROOM_MESSAGES.not_configured);
          return;
        }
        const liveLog = prepareLiveLog(log);
        setStatus('connecting');
        setError(null);
        try {
          const response = await fetch(`${api}/matches`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              log: liveLog,
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
                body: JSON.stringify({
                  confirm: true,
                  previousHostToken: options.previousHostToken,
                  device: thisDevice(),
                }),
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
      void publishQr(current.matchId, current.token, true);
    },
  };
}
