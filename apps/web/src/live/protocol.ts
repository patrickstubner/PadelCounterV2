import { isJoinToken, isRoomCode, isUuid, parseMatchLog, ROOM_MESSAGES, type MatchLog } from '@padel/core';

export const JOIN_KEY = 'padel-counter-v2.join';

export function socketUrl(apiBase: string, matchId: string): string {
  const url = new URL(apiBase);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `/matches/${matchId}/ws`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

/** Token stays in the fragment so it is not sent to the static host. */
export function joinLink(pageHref: string, matchId: string, token: string): string {
  const url = new URL(pageHref, 'http://localhost');
  const path = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
  return `${url.origin}${path}#/join/${matchId}?t=${encodeURIComponent(token)}`;
}

export function parseJoinHash(hash: string): { matchId: string; token: string } | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const match = /^\/join\/([0-9a-f-]{36})\?([^#]*)$/i.exec(raw);
  if (!match?.[1] || !match[2]) return null;
  if (!isUuid(match[1])) return null;
  const token = new URLSearchParams(match[2]).get('t');
  if (!isJoinToken(token)) return null;
  return { matchId: match[1].toLowerCase(), token };
}

export interface StoredJoin {
  readonly matchId: string;
  readonly token: string;
}

export function captureJoinHash(locationLike: Location, historyLike: History, storage: Storage): StoredJoin | null {
  const parsed = parseJoinHash(locationLike.hash);
  if (!parsed) return null;
  storage.setItem(JOIN_KEY, JSON.stringify(parsed));
  const clean = `${locationLike.pathname}${locationLike.search}#/join/${parsed.matchId}`;
  historyLike.replaceState({ padelArchive: 'court' }, '', clean);
  return parsed;
}

export type LiveNotice =
  | { readonly kind: 'log'; readonly log: MatchLog; readonly players: number }
  | { readonly kind: 'presence'; readonly players: number }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ignore' };

export function interpretMessage(data: unknown): LiveNotice {
  if (typeof data !== 'object' || data === null) return { kind: 'ignore' };
  const record = data as Record<string, unknown>;
  if (record.type === 'error') {
    const message = isRoomCode(record.code) ? ROOM_MESSAGES[record.code] : 'The live match did not accept that.';
    return { kind: 'error', message };
  }
  if (record.type === 'presence' && typeof record.players === 'number' && record.players >= 0 && record.players <= 4) {
    return { kind: 'presence', players: record.players };
  }
  if ((record.type === 'snapshot' || record.type === 'event') && record.log) {
    const log = parseMatchLog(record.log);
    if (!log) return { kind: 'error', message: 'The live match did not accept that.' };
    const players =
      typeof record.players === 'number' && record.players >= 0 && record.players <= 4 ? record.players : 0;
    return { kind: 'log', log, players };
  }
  return { kind: 'ignore' };
}
