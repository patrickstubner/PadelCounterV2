import {
  CODE_ALARM_GLOBAL,
  CODE_ATTEMPTS_PER_PREFIX,
  MAX_MINTED_TOKENS,
  UNUSED_MINT_MS,
  HISTORY_RETAIN_MS,
  JOINS_PER_DEVICE,
  JOINS_PER_NETWORK,
  MATCHES_PER_DAY,
  MATCHES_PER_NETWORK_PER_DAY,
  QUOTA_RETAIN_MS,
  joinWindow,
  quotaDay,
} from '@padel/core';

export const CLIENT_IP_HEADER = 'x-padel-client-ip';

const FIND_MATCH = 'SELECT id FROM matches WHERE id = ?';
const INSERT_MATCH = 'INSERT INTO matches (id, created_at, last_activity) VALUES (?, ?, ?)';
const DELETE_MATCH = 'DELETE FROM matches WHERE id = ?';
const SELECT_QUOTA = 'SELECT n FROM create_quota WHERE address_hash = ? AND day = ?';
const UPSERT_QUOTA =
  'INSERT INTO create_quota (address_hash, day, n, cap) VALUES (?, ?, 1, ?) ON CONFLICT(address_hash, day) DO UPDATE SET n = n + 1';
const RELEASE_QUOTA = 'UPDATE create_quota SET n = n - 1 WHERE address_hash = ? AND day = ? AND n > 0';
const DELETE_OLD_QUOTA = 'DELETE FROM create_quota WHERE day < ?';
const UPSERT_JOIN =
  'INSERT INTO join_quota (subject_hash, window, n, cap) VALUES (?, ?, 1, ?) ON CONFLICT(subject_hash, window) DO UPDATE SET n = n + 1';
const UPSERT_JOIN_RETURNING = `${UPSERT_JOIN} RETURNING n`;
const DELETE_OLD_JOIN = 'DELETE FROM join_quota WHERE window < ?';
const INSERT_CREDENTIAL =
  'INSERT INTO credentials (token_hash, match_id, host, expires_at, revoked_at, device_id) VALUES (?, ?, ?, ?, ?, ?)';
const REVOKE_CREDENTIAL = 'UPDATE credentials SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL';
const REVOKE_CREDENTIAL_IN_MATCH =
  'UPDATE credentials SET revoked_at = ? WHERE token_hash = ? AND match_id = ? AND revoked_at IS NULL';
const REVOKE_REMOVED_IN_MATCH =
  'UPDATE credentials SET revoked_at = ?, revoke_reason = ? WHERE token_hash = ? AND match_id = ? AND revoked_at IS NULL';
const FIND_MINTED =
  'SELECT token_hash, expires_at FROM credentials WHERE match_id = ? AND device_id = ? AND revoked_at IS NULL AND expires_at > ?';
const COUNT_MINTED =
  'SELECT COUNT(*) AS n FROM credentials WHERE match_id = ? AND device_id IS NOT NULL AND revoked_at IS NULL AND admitted = 1 AND expires_at > ?';
const REVOKE_EXPIRED_PENDING =
  'UPDATE credentials SET revoked_at = ? WHERE match_id = ? AND admitted = 0 AND revoked_at IS NULL AND expires_at <= ?';
const REVOKE_OTHER_DEVICE =
  'UPDATE credentials SET revoked_at = ? WHERE match_id = ? AND device_id = ? AND token_hash != ? AND revoked_at IS NULL AND EXISTS (SELECT 1 FROM credentials WHERE token_hash = ? AND revoked_at IS NULL)';
const INSERT_MINTED =
  'INSERT INTO credentials (token_hash, match_id, host, expires_at, revoked_at, device_id, admitted) SELECT ?, ?, 0, ?, NULL, ?, 0 WHERE (SELECT COUNT(*) FROM credentials WHERE match_id = ? AND device_id IS NOT NULL AND revoked_at IS NULL AND admitted = 1 AND expires_at > ? AND device_id != ?) < ?';
const ADMIT_CREDENTIAL =
  'UPDATE credentials SET admitted = 1, expires_at = ? WHERE token_hash = ? AND revoked_at IS NULL';
const REBIND_CREDENTIAL =
  'UPDATE credentials SET device_id = ? WHERE token_hash = ? AND device_id = ? AND revoked_at IS NULL';
const REVOKE_SHARED_CREDS =
  'UPDATE credentials SET revoked_at = ? WHERE match_id = ? AND host = 0 AND revoked_at IS NULL';
const FIND_CREDENTIAL =
  'SELECT token_hash, match_id, host, expires_at, revoked_at, device_id, revoke_reason FROM credentials WHERE token_hash = ?';
const DELETE_REVOKED_CREDENTIALS = 'DELETE FROM credentials WHERE match_id = ? AND revoked_at IS NOT NULL';
const DELETE_REVOKED_CODES = 'DELETE FROM join_codes WHERE match_id = ? AND revoked_at IS NOT NULL';
const REVOKE_PLAYERS =
  'UPDATE credentials SET revoked_at = ? WHERE match_id = ? AND host = 0 AND revoked_at IS NULL';
const MOVE_CREDENTIAL = 'UPDATE credentials SET match_id = ? WHERE token_hash = ? AND match_id = ?';
const DELETE_CREDENTIALS = 'DELETE FROM credentials WHERE match_id = ?';
const INSERT_TICKET = 'INSERT INTO tickets (ticket_hash, match_id, expires_at) VALUES (?, ?, ?)';
const DELETE_TICKET = 'DELETE FROM tickets WHERE ticket_hash = ? RETURNING match_id, expires_at';
const DELETE_TICKETS = 'DELETE FROM tickets WHERE match_id = ?';
const DELETE_EXPIRED_TICKETS = 'DELETE FROM tickets WHERE expires_at <= ?';
const INSERT_CODE =
  'INSERT INTO join_codes (code_hash, match_id, token_hash, expires_at, revoked_at) VALUES (?, ?, ?, ?, NULL)';
const FIND_CODE =
  'SELECT code_hash, match_id, token_hash, expires_at, revoked_at FROM join_codes WHERE code_hash = ?';
const REVOKE_CODES = 'UPDATE join_codes SET revoked_at = ? WHERE match_id = ? AND revoked_at IS NULL';
const DELETE_CODES = 'DELETE FROM join_codes WHERE match_id = ?';
const DELETE_EXPIRED_CODES = 'DELETE FROM join_codes WHERE expires_at <= ?';
const TOUCH_MATCH = 'UPDATE matches SET last_activity = ? WHERE id = ?';

/** D1 history clock. The room writes this at most once per match per minute. */
export const ACTIVITY_TOUCH_MS = 60_000;

export function shouldTouchActivity(last: number, now: number): boolean {
  if (!Number.isInteger(last) || !Number.isInteger(now)) return false;
  if (now < last) return false;
  return now - last >= ACTIVITY_TOUCH_MS;
}

const EXPIRED_MATCHES = 'SELECT id FROM matches WHERE last_activity < ?';

export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first(): Promise<Record<string, unknown> | null>;
  run(): Promise<unknown>;
  all?(): Promise<{ results?: readonly Record<string, unknown>[] }>;
}

export interface D1Like {
  prepare(query: string): D1Statement;
  batch(statements: readonly D1Statement[]): Promise<unknown>;
}

export interface CredentialRow {
  readonly tokenHash: string;
  readonly matchId: string;
  readonly host: boolean;
  readonly expiresAt: number;
  readonly revokedAt: number | null;
  readonly deviceId?: string | null;
  /** Set only when this phone was removed. Other revokes leave it null. */
  readonly revokeReason?: 'removed' | null;
}

export interface JoinCodeRow {
  readonly codeHash: string;
  readonly matchId: string;
  readonly tokenHash: string;
  readonly expiresAt: number;
  readonly revokedAt: number | null;
}

export type QuotaReason = 'device' | 'network';

export interface MatchIndex {
  find(id: string): Promise<boolean>;
  insert(id: string, now: number): Promise<void>;
  remove(id: string): Promise<void>;
  touchActivity(id: string, now: number): Promise<void>;
  takeCreateQuota(deviceHash: string, ipHash: string, now: number): Promise<{ ok: true } | { ok: false; reason: QuotaReason }>;
  releaseCreateQuota(deviceHash: string, ipHash: string, now: number): Promise<void>;
  takeJoinDevice(deviceHash: string, now: number): Promise<{ ok: true } | { ok: false; reason: 'device' }>;
  noteJoinFailure(ipHash: string, now: number): Promise<{ ok: true } | { ok: false; reason: 'network' }>;
  takeCodeAttempt(ipHash: string, now: number): Promise<{ ok: true } | { ok: false }>;
  noteCodeAlarm(globalHash: string, now: number): Promise<boolean>;
  claimMinted(row: CredentialRow, now: number): Promise<boolean>;
  admitCredential(tokenHash: string, expiresAt: number): Promise<void>;
  rebindCredential(tokenHash: string, fromDevice: string, toDevice: string): Promise<void>;
  findJoinCode(codeHash: string): Promise<JoinCodeRow | null>;
  countMinted(matchId: string, now: number): Promise<number>;
  findMinted(matchId: string, deviceId: string, now: number): Promise<{ tokenHash: string } | null>;
  revokeCredential(tokenHash: string, now: number): Promise<void>;
  /** Revoke one credential only inside this durable object's match. `removed` is the kick reason. */
  revokeCredentialInMatch(tokenHash: string, matchId: string, now: number, reason?: 'removed'): Promise<void>;
  revokeSharedAccess(matchId: string, now: number, keepHashes?: readonly string[]): Promise<void>;
  putJoinCode(matchId: string, now: number, row: JoinCodeRow): Promise<void>;
  insertCredential(row: CredentialRow): Promise<void>;
  findCredential(tokenHash: string): Promise<CredentialRow | null>;
  replacePlayerCredential(
    matchId: string,
    now: number,
    row: CredentialRow,
    keepHash?: string,
    keepDeviceBound?: boolean,
  ): Promise<void>;
  deleteRevokedAccess(matchId: string): Promise<void>;
  moveCredential(tokenHash: string, fromMatchId: string, toMatchId: string): Promise<void>;
  putTicket(ticketHash: string, matchId: string, expiresAt: number): Promise<void>;
  takeTicket(ticketHash: string, now: number): Promise<string | null>;
  expiredMatchIds(now: number): Promise<readonly string[]>;
  purgeEphemeral(now: number): Promise<void>;
}

export function isIdConflict(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /unique|constraint|already exists|409/i.test(message);
}

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function isQuotaCap(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /check constraint/i.test(message);
}

async function quotaCount(db: D1Like, hash: string, bucket: string | number, query = SELECT_QUOTA): Promise<number | null> {
  const row = await db.prepare(query).bind(hash, bucket).first();
  if (!row) return null;
  return integer(row.n);
}

export async function touchMatchActivity(db: D1Like, id: string, now: number): Promise<void> {
  await db.prepare(TOUCH_MATCH).bind(now, id).run();
}

export function d1MatchIndex(db: D1Like): MatchIndex {
  return {
    async find(id) {
      const row = await db.prepare(FIND_MATCH).bind(id).first();
      return row !== null;
    },
    async insert(id, now) {
      await db.prepare(INSERT_MATCH).bind(id, now, now).run();
    },
    async remove(id) {
      await db.prepare(DELETE_CREDENTIALS).bind(id).run();
      await db.prepare(DELETE_TICKETS).bind(id).run();
      await db.prepare(DELETE_CODES).bind(id).run();
      await db.prepare(DELETE_MATCH).bind(id).run();
    },
    async touchActivity(id, now) {
      await touchMatchActivity(db, id, now);
    },
    async takeCreateQuota(deviceHash, ipHash, now) {
      const day = quotaDay(now);
      try {
        await db.batch([
          db.prepare(UPSERT_QUOTA).bind(deviceHash, day, MATCHES_PER_DAY),
          db.prepare(UPSERT_QUOTA).bind(ipHash, day, MATCHES_PER_NETWORK_PER_DAY),
        ]);
        return { ok: true };
      } catch (error) {
        if (!isQuotaCap(error)) throw error;
        const deviceN = await quotaCount(db, deviceHash, day);
        const networkN = await quotaCount(db, ipHash, day);
        if (networkN !== null && networkN >= MATCHES_PER_NETWORK_PER_DAY && (deviceN === null || deviceN < MATCHES_PER_DAY)) {
          return { ok: false, reason: 'network' };
        }
        return { ok: false, reason: 'device' };
      }
    },
    async releaseCreateQuota(deviceHash, ipHash, now) {
      const day = quotaDay(now);
      await db.batch([
        db.prepare(RELEASE_QUOTA).bind(deviceHash, day),
        db.prepare(RELEASE_QUOTA).bind(ipHash, day),
      ]);
    },
    async takeJoinDevice(deviceHash, now) {
      const window = joinWindow(now);
      try {
        await db.prepare(UPSERT_JOIN).bind(deviceHash, window, JOINS_PER_DEVICE).run();
        return { ok: true };
      } catch (error) {
        if (!isQuotaCap(error)) throw error;
        return { ok: false, reason: 'device' };
      }
    },
    async noteJoinFailure(ipHash, now) {
      const window = joinWindow(now);
      try {
        await db.prepare(UPSERT_JOIN).bind(ipHash, window, JOINS_PER_NETWORK).run();
        return { ok: true };
      } catch (error) {
        if (!isQuotaCap(error)) throw error;
        return { ok: false, reason: 'network' };
      }
    },
    async takeCodeAttempt(ipHash, now) {
      const window = joinWindow(now);
      try {
        await db.prepare(UPSERT_JOIN).bind(ipHash, window, CODE_ATTEMPTS_PER_PREFIX).run();
        return { ok: true };
      } catch (error) {
        if (!isQuotaCap(error)) throw error;
        return { ok: false };
      }
    },
    async noteCodeAlarm(globalHash, now) {
      const window = joinWindow(now);
      try {
        const statement = db.prepare(UPSERT_JOIN_RETURNING).bind(globalHash, window, CODE_ALARM_GLOBAL);
        if (!statement.all) throw new Error('code alarm must return the count');
        const listed = await statement.all();
        return integer(listed.results?.[0]?.n) === CODE_ALARM_GLOBAL;
      } catch (error) {
        if (!isQuotaCap(error)) throw error;
        return false;
      }
    },
    async claimMinted(row, now) {
      if (!row.deviceId) return false;
      const results = await db.batch([
        db.prepare(REVOKE_EXPIRED_PENDING).bind(now, row.matchId, now),
        db.prepare(INSERT_MINTED).bind(
          row.tokenHash,
          row.matchId,
          now + UNUSED_MINT_MS,
          row.deviceId,
          row.matchId,
          now,
          row.deviceId,
          MAX_MINTED_TOKENS,
        ),
        db.prepare(REVOKE_OTHER_DEVICE).bind(now, row.matchId, row.deviceId, row.tokenHash, row.tokenHash),
      ]);
      const inserted = (results as readonly { meta?: { changes?: number } }[] | undefined)?.[1];
      return (inserted?.meta?.changes ?? 0) > 0;
    },
    async admitCredential(tokenHash, expiresAt) {
      await db.prepare(ADMIT_CREDENTIAL).bind(expiresAt, tokenHash).run();
    },
    async rebindCredential(tokenHash, fromDevice, toDevice) {
      await db.prepare(REBIND_CREDENTIAL).bind(toDevice, tokenHash, fromDevice).run();
    },
    async findJoinCode(codeHash) {
      const row = await db.prepare(FIND_CODE).bind(codeHash).first();
      if (!row || typeof row.code_hash !== 'string' || typeof row.match_id !== 'string' || typeof row.token_hash !== 'string') {
        return null;
      }
      const expiresAt = integer(row.expires_at);
      if (expiresAt === null) return null;
      const revokedAt = row.revoked_at === null ? null : integer(row.revoked_at);
      if (row.revoked_at !== null && revokedAt === null) return null;
      return {
        codeHash: row.code_hash,
        matchId: row.match_id,
        tokenHash: row.token_hash,
        expiresAt,
        revokedAt,
      };
    },
    async countMinted(matchId, now) {
      const row = await db.prepare(COUNT_MINTED).bind(matchId, now).first();
      const count = row ? integer(row.n) : 0;
      return count ?? 0;
    },
    async findMinted(matchId, deviceId, now) {
      const row = await db.prepare(FIND_MINTED).bind(matchId, deviceId, now).first();
      if (!row || typeof row.token_hash !== 'string') return null;
      return { tokenHash: row.token_hash };
    },
    async revokeCredential(tokenHash, now) {
      await db.prepare(REVOKE_CREDENTIAL).bind(now, tokenHash).run();
    },
    async revokeCredentialInMatch(tokenHash, matchId, now, reason) {
      if (reason === 'removed') {
        await db.prepare(REVOKE_REMOVED_IN_MATCH).bind(now, 'removed', tokenHash, matchId).run();
        return;
      }
      await db.prepare(REVOKE_CREDENTIAL_IN_MATCH).bind(now, tokenHash, matchId).run();
    },
    async revokeSharedAccess(matchId, now, keepHashes = []) {
      const statements = [
        db.prepare(REVOKE_SHARED_CREDS).bind(now, matchId),
        db.prepare(REVOKE_CODES).bind(now, matchId),
      ];
      for (const hash of keepHashes) {
        if (!/^[0-9a-f]{64}$/.test(hash)) continue;
        statements.push(db.prepare(
          'UPDATE credentials SET revoked_at = NULL WHERE token_hash = ? AND match_id = ? AND revoked_at = ?',
        ).bind(hash, matchId, now));
      }
      await db.batch(statements);
    },
    async putJoinCode(matchId, now, row) {
      await db.batch([
        db.prepare(REVOKE_CODES).bind(now, matchId),
        db.prepare(INSERT_CODE).bind(row.codeHash, row.matchId, row.tokenHash, row.expiresAt),
      ]);
    },
    async insertCredential(row) {
      await db
        .prepare(INSERT_CREDENTIAL)
        .bind(row.tokenHash, row.matchId, row.host ? 1 : 0, row.expiresAt, row.revokedAt, row.deviceId ?? null)
        .run();
    },
    async findCredential(tokenHash) {
      const row = await db.prepare(FIND_CREDENTIAL).bind(tokenHash).first();
      if (!row || typeof row.match_id !== 'string' || typeof row.token_hash !== 'string') return null;
      const expiresAt = integer(row.expires_at);
      if (expiresAt === null) return null;
      const revokedAt = row.revoked_at === null ? null : integer(row.revoked_at);
      if (row.revoked_at !== null && revokedAt === null) return null;
      return {
        tokenHash: row.token_hash,
        matchId: row.match_id,
        host: row.host === 1,
        expiresAt,
        revokedAt,
        revokeReason: row.revoke_reason === 'removed' ? 'removed' : null,
        deviceId: typeof row.device_id === 'string' && row.device_id.length > 0 ? row.device_id : null,
      };
    },
    async replacePlayerCredential(matchId, now, row, keepHash, keepDeviceBound = false) {
      const revoke = keepDeviceBound
        ? db.prepare(
          'UPDATE credentials SET revoked_at = ? WHERE match_id = ? AND host = 0 AND device_id IS NULL AND revoked_at IS NULL',
        ).bind(now, matchId)
        : keepHash && /^[0-9a-f]{64}$/.test(keepHash)
          ? db.prepare(`${REVOKE_PLAYERS} AND token_hash != ?`).bind(now, matchId, keepHash)
          : db.prepare(REVOKE_PLAYERS).bind(now, matchId);
      await db.batch([
        revoke,
        db.prepare(INSERT_CREDENTIAL).bind(row.tokenHash, row.matchId, row.host ? 1 : 0, row.expiresAt, row.revokedAt, row.deviceId ?? null),
      ]);
    },
    async deleteRevokedAccess(matchId) {
      await db.batch([
        db.prepare(DELETE_REVOKED_CREDENTIALS).bind(matchId),
        db.prepare(DELETE_REVOKED_CODES).bind(matchId),
      ]);
    },
    async moveCredential(tokenHash, fromMatchId, toMatchId) {
      await db.prepare(MOVE_CREDENTIAL).bind(toMatchId, tokenHash, fromMatchId).run();
    },
    async putTicket(ticketHash, matchId, expiresAt) {
      await db.prepare(INSERT_TICKET).bind(ticketHash, matchId, expiresAt).run();
    },
    async takeTicket(ticketHash, now) {
      const statement = db.prepare(DELETE_TICKET).bind(ticketHash);
      if (!statement.all) throw new Error('ticket delete must return the row');
      const listed = await statement.all();
      const row = listed.results?.[0];
      const expiresAt = row ? integer(row.expires_at) : null;
      if (!row || typeof row.match_id !== 'string' || expiresAt === null || expiresAt <= now) return null;
      return row.match_id;
    },
    async expiredMatchIds(now) {
      const statement = db.prepare(EXPIRED_MATCHES).bind(now - HISTORY_RETAIN_MS);
      if (!statement.all) return [];
      const listed = await statement.all();
      const ids: string[] = [];
      for (const row of listed.results ?? []) {
        if (typeof row.id === 'string') ids.push(row.id);
      }
      return ids;
    },
    async purgeEphemeral(now) {
      await db.batch([
        db.prepare(DELETE_OLD_QUOTA).bind(quotaDay(now - QUOTA_RETAIN_MS)),
        db.prepare(DELETE_EXPIRED_TICKETS).bind(now),
        db.prepare(DELETE_EXPIRED_CODES).bind(now),
        db.prepare(DELETE_OLD_JOIN).bind(joinWindow(now - QUOTA_RETAIN_MS)),
      ]);
    },
  };
}

export function clientAddress(request: Request): string {
  const address = request.headers.get('cf-connecting-ip');
  return address && address.length > 0 && address.length <= 80 ? address : 'missing';
}

/** The worker sets the address. A client-supplied copy of the header is replaced. */
export function clientIpHeaders(request: Request): Headers {
  const headers = new Headers(request.headers);
  headers.set(CLIENT_IP_HEADER, clientAddress(request));
  return headers;
}
