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

/** Coarse phone list. No token, address, or User-Agent. */
const CREATE_ROSTER = `CREATE TABLE IF NOT EXISTS roster (
  device_id TEXT PRIMARY KEY,
  seat TEXT NOT NULL,
  kind TEXT NOT NULL,
  since INTEGER NOT NULL,
  seen INTEGER NOT NULL,
  online INTEGER NOT NULL
)`;

/** Ciphertext only. `id` is `invite` or `move:<device>`. */
const CREATE_SEALED = `CREATE TABLE IF NOT EXISTS sealed (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  payload TEXT NOT NULL,
  expires_at INTEGER NOT NULL
)`;

export function migrate(sql: RoomSql): void {
  sql.exec(CREATE_META);
  sql.exec(CREATE_INVITES);
  sql.exec(CREATE_EVENTS);
  sql.exec(CREATE_JOINED);
  sql.exec(CREATE_SEALED);
  sql.exec(CREATE_ROSTER);
  ensureActivityColumn(sql);
}

/** Rooms created before the seal table still accept a later invite. */
export function ensureSealedTable(sql: RoomSql): void {
  sql.exec(CREATE_SEALED);
}

export function ensureRosterTable(sql: RoomSql): void {
  sql.exec(CREATE_ROSTER);
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

export interface MintGrant {
  readonly status: 'granted';
  readonly replaced: readonly string[];
  readonly revokedAt: number;
}

/** One grant for a device token. The count and the insert stay in the caller's transaction. */
export function grantMintedInvite(
  sql: RoomSql,
  invite: InviteRow,
  now: number,
  max: number,
): MintGrant | { readonly status: 'full' } {
  const rows = sql.exec(
    'SELECT token_hash, device_id FROM invites WHERE host = 0 AND revoked_at IS NULL AND device_id IS NOT NULL AND expires_at > ?',
    now,
  ).toArray();
  const deviceId = invite.deviceId ?? '';
  const mine = rows.filter((row) => row.device_id === deviceId && typeof row.token_hash === 'string');
  const others = rows.length - mine.length;
  if (mine.length === 0 && others >= max) return { status: 'full' };
  const replaced: string[] = [];
  for (const row of mine) {
    const hash = row.token_hash;
    if (typeof hash !== 'string') continue;
    sql.exec('UPDATE invites SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL', now, hash);
    replaced.push(hash);
  }
  insertInvite(sql, invite);
  return { status: 'granted', replaced, revokedAt: now };
}

/** Undo a grant that D1 did not keep. Only the revocation from that grant is cleared. */
export function restoreInviteHashes(sql: RoomSql, hashes: readonly string[], revokedAt: number): void {
  if (!Number.isInteger(revokedAt) || revokedAt <= 0) return;
  for (const hash of hashes) {
    if (!/^[0-9a-f]{64}$/.test(hash)) continue;
    sql.exec('UPDATE invites SET revoked_at = NULL WHERE token_hash = ? AND revoked_at = ?', hash, revokedAt);
  }
}

export function revokeInviteHash(sql: RoomSql, tokenHash: string, now: number): void {
  sql.exec('UPDATE invites SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL', now, tokenHash);
}

export function revokePlayerInvites(sql: RoomSql, now: number): void {
  sql.exec('UPDATE invites SET revoked_at = ? WHERE host = 0 AND revoked_at IS NULL', now);
}

export interface SealRow {
  readonly tokenHash: string;
  readonly payload: string;
  readonly expiresAt: number;
}

export function writeSeal(sql: RoomSql, id: string, tokenHash: string, payload: string, expiresAt: number): void {
  sql.exec(
    `INSERT INTO sealed (id, token_hash, payload, expires_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET token_hash = excluded.token_hash, payload = excluded.payload, expires_at = excluded.expires_at`,
    id,
    tokenHash,
    payload,
    expiresAt,
  );
}

export function readSeal(sql: RoomSql, id: string): SealRow | null {
  try {
    const row = sql.exec('SELECT token_hash, payload, expires_at FROM sealed WHERE id = ?', id).toArray()[0];
    const tokenHash = text(row?.token_hash);
    const payload = text(row?.payload);
    const expiresAt = integer(row?.expires_at);
    if (!tokenHash || !payload || expiresAt === null) return null;
    return { tokenHash, payload, expiresAt };
  } catch {
    return null;
  }
}

export interface RosterRecord {
  readonly deviceId: string;
  readonly seat: string;
  readonly kind: string;
  readonly since: number;
  readonly seen: number;
  readonly online: boolean;
}

export function saveRosterPhone(
  sql: RoomSql,
  phone: { deviceId: string; seat: string; kind: string; now: number },
): void {
  ensureRosterTable(sql);
  const existing = sql.exec('SELECT since FROM roster WHERE device_id = ?', phone.deviceId).toArray()[0];
  const since = integer(existing?.since) ?? phone.now;
  sql.exec(
    `INSERT INTO roster (device_id, seat, kind, since, seen, online) VALUES (?, ?, ?, ?, ?, 1)
     ON CONFLICT(device_id) DO UPDATE SET seat = excluded.seat, kind = excluded.kind, seen = excluded.seen, online = 1`,
    phone.deviceId,
    phone.seat,
    phone.kind,
    since,
    phone.now,
  );
}

export function markRosterOffline(sql: RoomSql, deviceId: string, seen: number): void {
  ensureRosterTable(sql);
  sql.exec('UPDATE roster SET online = 0, seen = ? WHERE device_id = ?', seen, deviceId);
}

export function readRoster(sql: RoomSql): RosterRecord[] {
  try {
    return sql.exec('SELECT device_id, seat, kind, since, seen, online FROM roster ORDER BY since, device_id').toArray().flatMap((row) => {
      const deviceId = text(row.device_id);
      const seat = text(row.seat);
      const kind = text(row.kind);
      const since = integer(row.since);
      const seen = integer(row.seen);
      if (!deviceId || !seat || !kind || since === null || seen === null) return [];
      return [{ deviceId, seat, kind, since, seen, online: row.online === 1 }];
    });
  } catch {
    return [];
  }
}

export function hasMoveSeal(sql: RoomSql): boolean {
  try {
    return sql.exec("SELECT id FROM sealed WHERE id LIKE 'move:%' LIMIT 1").toArray().length > 0;
  } catch {
    return false;
  }
}

export function insertEvent(sql: RoomSql, event: StoredEvent): void {
  sql.exec('INSERT INTO events (event_id, payload) VALUES (?, ?)', event.eventId, JSON.stringify(event.event));
}

export function readEventSeq(sql: RoomSql, eventId: string): number | null {
  const row = sql.exec('SELECT seq FROM events WHERE event_id = ?', eventId).toArray()[0];
  const seq = row?.seq;
  return typeof seq === 'number' && Number.isInteger(seq) && seq > 0 ? seq : null;
}

export function latestEventSeq(sql: RoomSql): number {
  const row = sql.exec('SELECT seq FROM events ORDER BY seq DESC LIMIT 1').toArray()[0];
  const seq = row?.seq;
  return typeof seq === 'number' && Number.isInteger(seq) && seq > 0 ? seq : 0;
}
