import { useRef, useState, type MutableRefObject } from 'react';
import { isJoinToken, isRoomCode, ROOM_MESSAGES, type MatchEvent, type MatchLog } from '@padel/core';
import { deviceId } from '../domain/device';
import { createMatchId } from '../domain/id';
import type { LiveSend } from '../hooks/useMatch';
import { interpretMessage, joinLink, socketUrl } from './protocol';

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
  const readyRef = useRef(false);
  const generation = useRef(0);
  const offerRef = useRef<string | null>(null);
  replaceRef.current = replaceLog;
  applyRef.current = applyLive;

  const rememberOffer = (token: string | null) => {
    offerRef.current = token;
    setOffer(token);
  };

  const disconnect = () => {
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
    const fail = (message: string) => {
      setStatus('off');
      if (asJoin) {
        setJoining(false);
        setJoinError(message);
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
      socketRef.current?.close();
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
          if (asJoin && !readyRef.current) setJoinError(notice.message);
          else setError(notice.message);
          if (asJoin && !readyRef.current) setJoining(false);
          if (!notice.close) return;
          liveRef.current = null;
          readyRef.current = false;
          setStatus('off');
          ws.close();
          return;
        }
        if (notice.kind === 'presence') {
          setPlayers(notice.players);
          return;
        }
        if (notice.kind === 'delta') {
          if (readyRef.current && !notice.duplicate) applyRef.current(notice.event);
          setPlayers(notice.players);
          return;
        }
        if (notice.kind === 'log') {
          replaceRef.current(notice.log);
          readyRef.current = true;
          setHost(notice.host);
          setPlayers(notice.players);
          setJoining(false);
          setJoinError(null);
          setStatus('live');
          liveRef.current = (courtEvent: MatchEvent) => {
            if (ws.readyState !== WebSocket.OPEN) return false;
            ws.send(JSON.stringify({ type: 'event', eventId: createMatchId(), event: courtEvent }));
            return true;
          };
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
        liveRef.current = null;
        readyRef.current = false;
        setJoining(false);
        setStatus('off');
        setHost(true);
      };
    })();
  };

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
