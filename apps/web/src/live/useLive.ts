import { useRef, useState, type MutableRefObject } from 'react';
import { isRoomCode, ROOM_MESSAGES, type MatchLog } from '@padel/core';
import { createMatchId } from '../domain/id';
import type { LiveSend } from '../hooks/useMatch';
import type { MatchEvent } from '../domain/types';
import { interpretMessage, joinLink, socketUrl } from './protocol';

export interface LiveController {
  readonly configured: boolean;
  readonly status: 'off' | 'connecting' | 'live';
  readonly players: number;
  readonly qr: string | null;
  readonly error: string | null;
  readonly share: (log: MatchLog) => void;
  readonly rotate: () => void;
  readonly connect: (matchId: string, token: string) => void;
  readonly disconnect: () => void;
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

export function useLive(
  liveRef: MutableRefObject<LiveSend | null>,
  replaceLog: (log: MatchLog) => void,
  applyLive: (event: MatchEvent) => void,
): LiveController {
  const api = String(import.meta.env.PUBLIC_API_URL ?? '').replace(/\/$/, '');
  const [status, setStatus] = useState<'off' | 'connecting' | 'live'>('off');
  const [players, setPlayers] = useState(0);
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const hostRef = useRef<{ matchId: string; token: string } | null>(null);
  const replaceRef = useRef(replaceLog);
  const applyRef = useRef(applyLive);
  const readyRef = useRef(false);
  replaceRef.current = replaceLog;
  applyRef.current = applyLive;

  const disconnect = () => {
    liveRef.current = null;
    readyRef.current = false;
    socketRef.current?.close();
    socketRef.current = null;
    hostRef.current = null;
    setStatus('off');
    setQr(null);
    setPlayers(0);
  };

  const open = (matchId: string, token: string, replaceLog: (log: MatchLog) => void) => {
    if (!api) {
      setError(ROOM_MESSAGES.not_configured);
      return;
    }
    replaceRef.current = replaceLog;
    readyRef.current = false;
    socketRef.current?.close();
    setStatus('connecting');
    setError(null);
    const ws = new WebSocket(socketUrl(api, matchId));
    socketRef.current = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'hello', protocol: 1, token }));
    };
    ws.onmessage = (event) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(event.data)) as unknown;
      } catch {
        return;
      }
      const notice = interpretMessage(parsed);
      if (notice.kind === 'error') {
        setError(notice.message);
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
        setPlayers(notice.players);
        setStatus('live');
        liveRef.current = (courtEvent: MatchEvent) => {
          if (ws.readyState !== WebSocket.OPEN) return false;
          ws.send(JSON.stringify({ type: 'event', eventId: createMatchId(), event: courtEvent }));
          return true;
        };
      }
    };
    ws.onerror = () => {
      setError(ROOM_MESSAGES.offline);
    };
    ws.onclose = () => {
      if (socketRef.current !== ws) return;
      liveRef.current = null;
      readyRef.current = false;
      setStatus('off');
    };
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
    setQr(joinLink(page, matchId, body.token));
  };

  return {
    configured: api.length > 0,
    status,
    players,
    qr,
    error,
    disconnect,
    connect: (matchId, token) => {
      open(matchId, token, replaceRef.current);
    },
    share: (log) => {
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
            body: JSON.stringify({ log }),
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
          open(body.matchId, body.hostToken, replaceRef.current);
          await publishQr(body.matchId, body.hostToken);
        } catch {
          setError(ROOM_MESSAGES.offline);
          setStatus('off');
        }
      })();
    },
    rotate: () => {
      const host = hostRef.current;
      if (!host) return;
      void publishQr(host.matchId, host.token);
    },
  };
}
