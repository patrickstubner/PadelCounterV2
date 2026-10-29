import {
  canonicalCausalId,
  canonicalEventId,
  connectionCloses,
  liveTeamSide,
  parseLiveTeamName,
  HOST_TOKEN_TTL_MS,
  isJoinToken,
  isRoomCode,
  JOIN_TOKEN_TTL_MS,
  parseMatchLog,
  parseStoredEvent,
  ROOM_MESSAGES,
  type MatchEvent,
  type MatchLog,
  type RoomCode,
  type ScoreClaim,
} from '@padel/core';
import { PAGE_BASE } from '../base';

export { canonicalEventId, HOST_TOKEN_TTL_MS, JOIN_TOKEN_TTL_MS };

/** Resend a point that was not in the snapshot after this long. */
export const ACK_MS = 1_500;

/** A hide longer than this forces a new socket even if the browser still says open. */
export const HIDE_RECONNECT_MS = 15_000;

/** Wait this long before the court turns red, so a short reconnect does not flash. */
export const OFFLINE_COURT_MS = 1_500;

/** Drop the "too many changes" banner on its own if nothing succeeds first. */
export const SLOW_BANNER_MS = 5_000;

/** Black court: this phone is not in a live match. */
export const LOCAL_COURT = '#000000';

/** Very dark blue: a live match is connected. White on it is above WCAG AA. */
export const ONLINE_COURT = '#163056';

/** Dark red: a live match is counting with no server. White on it is above WCAG AA. */
export const OFFLINE_COURT = '#3a1016';

const TERMINAL_CODES: ReadonlySet<RoomCode> = new Set([
  'bad_token',
  'expired',
  'revoked',
  'match_full',
  'spectator_not_available',
  'upgrade_required',
]);

export function isTerminalCode(code: RoomCode | null): boolean {
  return code !== null && TERMINAL_CODES.has(code);
}

/** True when this fixed sentence is one that retrying cannot fix. */
export function isTerminalMessage(message: string): boolean {
  for (const code of TERMINAL_CODES) {
    if (ROOM_MESSAGES[code] === message) return true;
  }
  return false;
}

export function reconnectDelayMs(attempt: number, slowDown: boolean, random = Math.random()): number {
  const spread = Number.isFinite(random) ? Math.min(1, Math.max(0, random)) : 0;
  const step = Math.min(8, Math.max(0, Math.floor(attempt)));
  const base = Math.min(30_000, 400 * 2 ** step);
  const delay = base + Math.floor(spread * base * 0.25);
  if (!slowDown) return delay;
  return Math.max(2_000 + Math.floor(spread * 400), delay);
}

/** Ignore a burst of browser online events. One retry in this window is enough. */
export const ONLINE_RETRY_GAP_MS = 2_000;

export function onlineRetryAllowed(lastAt: number, now: number): boolean {
  return now - lastAt >= ONLINE_RETRY_GAP_MS;
}

export interface PendingLiveEvent<T> {
  readonly id: string;
  readonly event: T;
  readonly token: string;
  readonly matchId: string;
  readonly claim?: ScoreClaim | null;
  readonly parentId?: string | null;
}

/** Unacked points for this token and match that the snapshot did not already contain. */
export function unackedAfterSnapshot<T>(
  items: readonly PendingLiveEvent<T>[],
  token: string,
  matchId: string,
  eventIds: readonly string[],
): PendingLiveEvent<T>[] {
  const known = new Set(eventIds.map((id) => id.toLowerCase()));
  const kept: PendingLiveEvent<T>[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (item.token !== token) continue;
    if (item.matchId !== '' && item.matchId !== matchId) continue;
    if (known.has(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    kept.push({ ...item, matchId });
  }
  return kept;
}

export const JOIN_KEY = 'pcv2:join';

export function socketUrl(apiBase: string, ticket: string): string {
  const url = new URL(apiBase);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `/ws/${ticket}`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

/** App path used in join links. `index.html` and extra slashes are not part of it. */
function canonicalAppPath(pathname: string): string {
  let path = pathname;
  while (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  if (path.toLowerCase().endsWith('/index.html')) path = path.slice(0, -'/index.html'.length);
  while (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return path === '' ? '/' : path;
}

/** A query that already carries the invite must not be treated as a join link. */
function queryCarriesToken(url: URL): boolean {
  if (url.searchParams.has('t')) return true;
  for (const value of url.searchParams.values()) {
    if (isJoinToken(value)) return true;
  }
  return false;
}

/** Token stays in the fragment so it is not sent to the static host. The match id is not in the link. */
export function joinLink(pageHref: string, token: string): string {
  const url = new URL(pageHref, 'http://localhost');
  const path = canonicalAppPath(PAGE_BASE);
  const directory = path === '/' ? '/' : `${path}/`;
  return `${url.origin}${directory}#/join?t=${encodeURIComponent(token)}`;
}

/**
 * A scanned QR is a join link only when it points at this app.
 * The origin must be this page. The path must be the app base path.
 * `index.html`, extra slashes, and this page's own query are ignored.
 * The token is read only from the fragment. The scanned URL is never opened.
 */
export function tokenFromJoinQr(text: string, pageHref: string): string | null {
  if (typeof text !== 'string' || text.length === 0 || text.length > 2048) return null;
  let scanned: URL;
  let page: URL;
  try {
    scanned = new URL(text.trim());
    page = new URL(pageHref);
  } catch {
    return null;
  }
  if (scanned.username || scanned.password) return null;
  if (scanned.protocol !== 'https:' && scanned.protocol !== 'http:') return null;
  if (page.protocol !== 'https:' && page.protocol !== 'http:') return null;
  if (scanned.origin !== page.origin) return null;
  if (queryCarriesToken(scanned)) return null;
  if (canonicalAppPath(scanned.pathname) !== canonicalAppPath(PAGE_BASE)) return null;
  return parseJoinHash(scanned.hash)?.token ?? null;
}

export function matchCodeShareText(code: string): string {
  return `Join my padel match in Padel Counter. Code: ${code}`;
}

export async function sendMatchCode(
  code: string,
  nav: {
    share?: (data: { text: string }) => Promise<void>;
    clipboard?: { writeText: (value: string) => Promise<void> };
  },
): Promise<'shared' | 'copied' | 'visible'> {
  const text = matchCodeShareText(code);
  if (nav.share) {
    try {
      await nav.share({ text });
      return 'shared';
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      if (name === 'AbortError') return 'visible';
    }
  }
  if (nav.clipboard) {
    try {
      await nav.clipboard.writeText(text);
      return 'copied';
    } catch {
      return 'visible';
    }
  }
  return 'visible';
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

/** A host record in this tab is not replaced by a scanned join fragment. */
function storedHostToken(storage: Storage, now: number): string | null {
  try {
    const raw = storage.getItem(JOIN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token?: unknown; host?: unknown; expiresAt?: unknown };
    if (parsed.host !== true || !isJoinToken(parsed.token)) return null;
    if (typeof parsed.expiresAt === 'number' && parsed.expiresAt <= now) return null;
    return parsed.token;
  } catch {
    return null;
  }
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
      const hostToken = storedHostToken(storage, Date.now());
      if (hostToken) return { ok: true, token: hostToken };
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
    const expiresAt = (parsed as { expiresAt?: unknown }).expiresAt;
    if (typeof expiresAt === 'number' && expiresAt <= Date.now()) {
      storage.removeItem(JOIN_KEY);
      return { ok: false, invalid: true };
    }
    return { ok: true, token: parsed.token };
  } catch {
    return { ok: false, invalid: false };
  }
}

/** A hidden page waits. An opening or still-open socket is left alone. */
export function shouldResumeSocket(visibility: string, readyState: number | null, opening: boolean): boolean {
  if (opening || visibility === 'hidden') return false;
  if (readyState === null) return true;
  return readyState !== 0 && readyState !== 1;
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
  | { readonly kind: 'log'; readonly log: MatchLog; readonly players: number; readonly host: boolean; readonly eventIds: readonly string[]; readonly nameSeq: number }
  | { readonly kind: 'delta'; readonly eventId: string; readonly event: MatchEvent; readonly duplicate: boolean; readonly players: number }
  | { readonly kind: 'rename'; readonly eventId: string; readonly team: 'a' | 'b'; readonly name: string; readonly seq: number }
  | { readonly kind: 'presence'; readonly players: number }
  | { readonly kind: 'join_offer'; readonly token: string }
  | { readonly kind: 'error'; readonly message: string; readonly close: boolean; readonly code: RoomCode | null; readonly eventId: string | null }
  | { readonly kind: 'pong' }
  | { readonly kind: 'ignore' };

function playerCount(value: unknown): number {
  return typeof value === 'number' && value >= 0 && value <= 4 ? value : 0;
}

export function interpretMessage(data: unknown): LiveNotice {
  if (typeof data !== 'object' || data === null) return { kind: 'ignore' };
  const record = data as Record<string, unknown>;
  if (record.type === 'pong') return { kind: 'pong' };
  if (record.type === 'error') {
    const eventId = canonicalEventId(record.eventId);
    if (!isRoomCode(record.code)) {
      return { kind: 'error', message: 'The live match did not accept that.', close: false, code: null, eventId };
    }
    return {
      kind: 'error',
      message: ROOM_MESSAGES[record.code],
      close: connectionCloses(record.code),
      code: record.code,
      eventId,
    };
  }
  if (record.type === 'presence' && typeof record.players === 'number' && record.players >= 0 && record.players <= 4) {
    return { kind: 'presence', players: record.players };
  }
  if (record.type === 'team_renamed') {
    const eventId = canonicalEventId(record.eventId);
    const team = liveTeamSide(record.team);
    const name = parseLiveTeamName(record.name);
    const seq = typeof record.seq === 'number' && Number.isInteger(record.seq) && record.seq > 0 ? record.seq : null;
    if (!eventId || !team || !name || seq === null) {
      return { kind: 'error', message: 'The live match did not accept that.', close: false, code: null, eventId };
    }
    return { kind: 'rename', eventId, team, name, seq };
  }
  if (record.type === 'event') {
    const eventId = canonicalEventId(record.eventId);
    const event = parseStoredEvent(record.event);
    if (!event || !eventId) {
      return { kind: 'error', message: 'The live match did not accept that.', close: false, code: null, eventId };
    }
    return {
      kind: 'delta',
      eventId,
      event,
      duplicate: record.duplicate === true,
      players: playerCount(record.players),
    };
  }
  if (record.type === 'snapshot' && record.log) {
    const log = parseMatchLog(record.log);
    if (!log) {
      return { kind: 'error', message: 'The live match did not accept that.', close: false, code: null, eventId: null };
    }
    const eventIds = Array.isArray(record.eventIds)
      ? record.eventIds.flatMap((id) => {
          const causal = canonicalCausalId(id);
          return causal ? [causal] : [];
        })
      : [];
    const nameSeq = typeof record.nameSeq === 'number' && Number.isInteger(record.nameSeq) && record.nameSeq > 0
      ? record.nameSeq
      : 0;
    return { kind: 'log', log, players: playerCount(record.players), host: record.host === true, eventIds, nameSeq };
  }
  if (record.type === 'join_offer' && isJoinToken(record.token)) {
    return { kind: 'join_offer', token: record.token };
  }
  return { kind: 'ignore' };
}
