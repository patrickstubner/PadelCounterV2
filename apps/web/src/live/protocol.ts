import {
  connectionCloses,
  isJoinToken,
  isRoomCode,
  isUuid,
  parseMatchLog,
  parseStoredEvent,
  ROOM_MESSAGES,
  type MatchEvent,
  type MatchLog,
} from '@padel/core';

export const JOIN_KEY = 'pcv2:join';

export function socketUrl(apiBase: string, ticket: string): string {
  const url = new URL(apiBase);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `/ws/${ticket}`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

/** Token stays in the fragment so it is not sent to the static host. The match id is not in the link. */
export function joinLink(pageHref: string, token: string): string {
  const url = new URL(pageHref, 'http://localhost');
  const path = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
  return `${url.origin}${path}#/join?t=${encodeURIComponent(token)}`;
}

export function parseJoinHash(hash: string): { token: string } | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const match = /^\/join\?([^#]*)$/i.exec(raw);
  if (!match?.[1]) return null;
  const token = new URLSearchParams(match[1]).get('t');
  if (!isJoinToken(token)) return null;
  return { token };
}

export interface StoredJoin {
  readonly token: string;
}

export interface JoinLocation {
  readonly hash: string;
  readonly pathname: string;
  readonly search: string;
}

export interface JoinHistory {
  replaceState(data: unknown, unused: string, url?: string | URL | null): void;
}

export type JoinAttempt = { readonly ok: true; readonly token: string } | { readonly ok: false; readonly invalid: boolean };

/** Invite captured at boot, including when sessionStorage is blocked. */
let heldAttempt: JoinAttempt | null = null;

export function holdJoin(attempt: JoinAttempt): void {
  if (attempt.ok || attempt.invalid) heldAttempt = attempt;
}

export function heldJoin(): JoinAttempt | null {
  return heldAttempt;
}

export function releaseHeldJoin(): void {
  heldAttempt = null;
}

function rememberJoin(storage: Storage, token: string): void {
  storage.setItem(JOIN_KEY, JSON.stringify({ token }));
}

/** Drop a join fragment so the address bar cannot keep the invite. */
function replaceCourt(locationLike: JoinLocation, historyLike: JoinHistory): void {
  historyLike.replaceState({ padelArchive: 'court' }, '', `${locationLike.pathname}${locationLike.search}`);
}

/**
 * Read a scanned invite. A valid token is returned and removed from the URL.
 * A join fragment that is not a 128-bit token is also removed and reported invalid.
 * Storage may be null or throw. The token is still returned so the caller can keep it in memory.
 */
export function readJoinToken(
  locationLike: JoinLocation,
  historyLike: JoinHistory,
  storage: Storage | null,
): JoinAttempt {
  const fragment = locationLike.hash.startsWith('#') ? locationLike.hash.slice(1) : locationLike.hash;
  const joinFragment = /^\/join\b/i.test(fragment);
  const fromHash = parseJoinHash(locationLike.hash);
  if (joinFragment) {
    try {
      replaceCourt(locationLike, historyLike);
    } catch {
      // The token is still returned. The caller strips the URL again on the next read.
    }
  }
  if (fromHash) {
    if (storage) {
      try {
        rememberJoin(storage, fromHash.token);
      } catch {
        // The URL is already clean. The caller keeps the returned token in memory.
      }
    }
    return { ok: true, token: fromHash.token };
  }
  if (joinFragment) return { ok: false, invalid: true };
  if (!storage) return { ok: false, invalid: false };
  try {
    const raw = storage.getItem(JOIN_KEY);
    if (!raw) return { ok: false, invalid: false };
    const parsed = JSON.parse(raw) as { token?: unknown };
    if (!isJoinToken(parsed.token)) {
      storage.removeItem(JOIN_KEY);
      return { ok: false, invalid: true };
    }
    return { ok: true, token: parsed.token };
  } catch {
    return { ok: false, invalid: false };
  }
}

export function forgetJoinToken(storage: Storage): void {
  storage.removeItem(JOIN_KEY);
}

export function captureJoinHash(
  locationLike: JoinLocation,
  historyLike: JoinHistory,
  storage: Storage | null,
): StoredJoin | null {
  const attempt = readJoinToken(locationLike, historyLike, storage);
  holdJoin(attempt);
  return attempt.ok ? { token: attempt.token } : null;
}

export type LiveNotice =
  | { readonly kind: 'log'; readonly log: MatchLog; readonly players: number; readonly host: boolean }
  | { readonly kind: 'delta'; readonly eventId: string; readonly event: MatchEvent; readonly duplicate: boolean; readonly players: number }
  | { readonly kind: 'presence'; readonly players: number }
  | { readonly kind: 'join_offer'; readonly token: string }
  | { readonly kind: 'error'; readonly message: string; readonly close: boolean }
  | { readonly kind: 'ignore' };

function playerCount(value: unknown): number {
  return typeof value === 'number' && value >= 0 && value <= 4 ? value : 0;
}

export function interpretMessage(data: unknown): LiveNotice {
  if (typeof data !== 'object' || data === null) return { kind: 'ignore' };
  const record = data as Record<string, unknown>;
  if (record.type === 'error') {
    if (!isRoomCode(record.code)) {
      return { kind: 'error', message: 'The live match did not accept that.', close: false };
    }
    return { kind: 'error', message: ROOM_MESSAGES[record.code], close: connectionCloses(record.code) };
  }
  if (record.type === 'presence' && typeof record.players === 'number' && record.players >= 0 && record.players <= 4) {
    return { kind: 'presence', players: record.players };
  }
  if (record.type === 'event') {
    const event = parseStoredEvent(record.event);
    if (!event || !isUuid(record.eventId)) {
      return { kind: 'error', message: 'The live match did not accept that.', close: false };
    }
    return {
      kind: 'delta',
      eventId: record.eventId.toLowerCase(),
      event,
      duplicate: record.duplicate === true,
      players: playerCount(record.players),
    };
  }
  if (record.type === 'snapshot' && record.log) {
    const log = parseMatchLog(record.log);
    if (!log) return { kind: 'error', message: 'The live match did not accept that.', close: false };
    return { kind: 'log', log, players: playerCount(record.players), host: record.host === true };
  }
  if (record.type === 'join_offer' && isJoinToken(record.token)) {
    return { kind: 'join_offer', token: record.token };
  }
  return { kind: 'ignore' };
}
