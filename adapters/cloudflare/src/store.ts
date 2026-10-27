import { parseMatchLog, parseStoredEvent, type MatchState } from '@padel/core';
import type { InviteRow, RoomRecord, StoredEvent } from './room';

export interface SqlCursor {
  toArray(): ReadonlyArray<Record<string, unknown>>;
}

/** Subset of the Durable Object SQLite API used by the room. */
export interface RoomSql {
  exec(query: string, ...bindings: unknown[]): SqlCursor;
}

const CREATE_META = `CREATE TABLE IF NOT EXISTS meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  base_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`;

const CREATE_INVITES = `CREATE TABLE IF NOT EXISTS invites (
  token_hash TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  host INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
)`;

const CREATE_EVENTS = `CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL
)`;

export function migrate(sql: RoomSql): void {
  sql.exec(CREATE_META);
  sql.exec(CREATE_INVITES);
  sql.exec(CREATE_EVENTS);
}

/** Tables are created on match create, not when a socket wakes the object. */
export function openRoomForCreate(sql: RoomSql): RoomRecord | null {
  migrate(sql);
  return loadRoom(sql);
}

export function readRoom(sql: RoomSql): RoomRecord | null {
  try {
    return loadRoom(sql);
  } catch {
    return null;
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

export function loadRoom(sql: RoomSql): RoomRecord | null {
  const meta = sql.exec('SELECT base_json, created_at FROM meta WHERE id = 1').toArray();
  const row = meta[0];
  if (!row) return null;
  const baseJson = text(row.base_json);
  if (!baseJson) return null;
  let base: MatchState;
  try {
    const parsed = parseMatchLog({ schemaVersion: 2, base: JSON.parse(baseJson) as unknown, events: [] });
    if (!parsed) return null;
    base = parsed.base;
  } catch {
    return null;
  }

  const invites: InviteRow[] = [];
  for (const invite of sql.exec('SELECT token_hash, role, host, expires_at, revoked_at FROM invites').toArray()) {
    const tokenHash = text(invite.token_hash);
    const role = invite.role === 'player' || invite.role === 'spectator' ? invite.role : null;
    const expiresAt = integer(invite.expires_at);
    if (!tokenHash || !role || expiresAt === null) return null;
    const revokedAt = invite.revoked_at === null ? null : integer(invite.revoked_at);
    if (invite.revoked_at !== null && revokedAt === null) return null;
    invites.push({
      tokenHash,
      role,
      host: invite.host === 1,
      expiresAt,
      revokedAt,
    });
  }

  const events: StoredEvent[] = [];
  for (const event of sql.exec('SELECT event_id, payload FROM events ORDER BY seq').toArray()) {
    const eventId = text(event.event_id);
    const payload = text(event.payload);
    if (!eventId || !payload) return null;
    let body: unknown;
    try {
      body = JSON.parse(payload) as unknown;
    } catch {
      return null;
    }
    const parsed = parseStoredEvent(body);
    if (!parsed) return null;
    events.push({ eventId, event: parsed });
  }

  return { base, events, invites };
}

export function insertRoom(sql: RoomSql, record: RoomRecord, now: number): void {
  sql.exec('INSERT INTO meta (id, base_json, created_at) VALUES (1, ?, ?)', JSON.stringify(record.base), now);
  for (const invite of record.invites) insertInvite(sql, invite);
  for (const event of record.events) insertEvent(sql, event);
}

export function insertInvite(sql: RoomSql, invite: InviteRow): void {
  sql.exec(
    'INSERT INTO invites (token_hash, role, host, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?)',
    invite.tokenHash,
    invite.role,
    invite.host ? 1 : 0,
    invite.expiresAt,
    invite.revokedAt,
  );
}

export function revokePlayerInvites(sql: RoomSql, now: number): void {
  sql.exec('UPDATE invites SET revoked_at = ? WHERE host = 0 AND revoked_at IS NULL', now);
}

export function insertEvent(sql: RoomSql, event: StoredEvent): void {
  sql.exec('INSERT INTO events (event_id, payload) VALUES (?, ?)', event.eventId, JSON.stringify(event.event));
}
