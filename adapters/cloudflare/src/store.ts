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
  created_at INTEGER NOT NULL,
  activity_touch INTEGER NOT NULL DEFAULT 0
)`;

const CREATE_INVITES = `CREATE TABLE IF NOT EXISTS invites (
  token_hash TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  host INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  device_id TEXT
)`;

const CREATE_JOINED = `CREATE TABLE IF NOT EXISTS joined (
  token_hash TEXT NOT NULL,
  player_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  PRIMARY KEY (token_hash, device_id)
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
  sql.exec(CREATE_JOINED);
  ensureActivityColumn(sql);
}

/** Older rooms predate the activity column. Create already includes it. */
export function ensureActivityColumn(sql: RoomSql): void {
  const names = sql.exec('PRAGMA table_info(meta)').toArray().map((row) => row.name);
  if (!names.includes('activity_touch')) {
    sql.exec('ALTER TABLE meta ADD COLUMN activity_touch INTEGER NOT NULL DEFAULT 0');
  }
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
  const serverCreatedAt = integer(row.created_at);
  const baseJson = text(row.base_json);
  if (serverCreatedAt === null) return null;
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
  for (const invite of sql.exec('SELECT token_hash, role, host, expires_at, revoked_at, device_id FROM invites').toArray()) {
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
      deviceId: text(invite.device_id),
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

  return { serverCreatedAt, base, events, invites };
}

export function insertRoom(sql: RoomSql, record: RoomRecord): void {
  sql.exec(
    'INSERT INTO meta (id, base_json, created_at, activity_touch) VALUES (1, ?, ?, ?)',
    JSON.stringify(record.base),
    record.serverCreatedAt,
    record.serverCreatedAt,
  );
  for (const invite of record.invites) insertInvite(sql, invite);
  for (const event of record.events) insertEvent(sql, event);
}

export function insertInvite(sql: RoomSql, invite: InviteRow): void {
  sql.exec(
    'INSERT INTO invites (token_hash, role, host, expires_at, revoked_at, device_id) VALUES (?, ?, ?, ?, ?, ?)',
    invite.tokenHash,
    invite.role,
    invite.host ? 1 : 0,
    invite.expiresAt,
    invite.revokedAt,
    invite.deviceId ?? null,
  );
}

export function insertJoined(sql: RoomSql, tokenHash: string, playerId: string, deviceId: string): void {
  sql.exec(
    'INSERT INTO joined (token_hash, player_id, device_id) VALUES (?, ?, ?) ON CONFLICT(token_hash, device_id) DO NOTHING',
    tokenHash,
    playerId,
    deviceId,
  );
}

export function readJoined(sql: RoomSql): { tokenHash: string; playerId: string; deviceId: string | null }[] {
  try {
    return sql
      .exec('SELECT token_hash, player_id, device_id FROM joined')
      .toArray()
      .flatMap((row) => {
        const tokenHash = text(row.token_hash);
        const playerId = text(row.player_id);
        if (!tokenHash || !playerId) return [];
        return [{ tokenHash, playerId, deviceId: text(row.device_id) }];
      });
  } catch {
    return [];
  }
}

export function readActivityTouch(sql: RoomSql): number | null {
  try {
    const row = sql.exec('SELECT activity_touch FROM meta WHERE id = 1').toArray()[0];
    const value = row?.activity_touch;
    return typeof value === 'number' && Number.isInteger(value) ? value : null;
  } catch {
    return null;
  }
}

export function markActivityTouch(sql: RoomSql, now: number): void {
  sql.exec('UPDATE meta SET activity_touch = ? WHERE id = 1', now);
}

export function revokePlayerInvites(sql: RoomSql, now: number): void {
  sql.exec('UPDATE invites SET revoked_at = ? WHERE host = 0 AND revoked_at IS NULL', now);
}

export function insertEvent(sql: RoomSql, event: StoredEvent): void {
  sql.exec('INSERT INTO events (event_id, payload) VALUES (?, ?)', event.eventId, JSON.stringify(event.event));
}
