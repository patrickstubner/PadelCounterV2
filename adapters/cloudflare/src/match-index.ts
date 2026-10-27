import { HISTORY_RETAIN_MS, MATCHES_PER_DAY, quotaDay } from '@padel/core';

export const CLIENT_IP_HEADER = 'x-padel-client-ip';

const FIND_MATCH = 'SELECT id FROM matches WHERE id = ?';
const INSERT_MATCH = 'INSERT INTO matches (id, created_at, last_activity) VALUES (?, ?, ?)';
const DELETE_MATCH = 'DELETE FROM matches WHERE id = ?';
const SELECT_QUOTA = 'SELECT n FROM create_quota WHERE address_hash = ? AND day = ?';
const INSERT_QUOTA = 'INSERT INTO create_quota (address_hash, day, n) VALUES (?, ?, 1)';
const UPDATE_QUOTA = 'UPDATE create_quota SET n = n + 1 WHERE address_hash = ? AND day = ? AND n < ?';
const RELEASE_QUOTA = 'UPDATE create_quota SET n = n - 1 WHERE address_hash = ? AND day = ? AND n > 0';
const INSERT_CREDENTIAL =
  'INSERT INTO credentials (token_hash, match_id, host, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?)';
const FIND_CREDENTIAL =
  'SELECT token_hash, match_id, host, expires_at, revoked_at FROM credentials WHERE token_hash = ?';
const REVOKE_PLAYERS =
  'UPDATE credentials SET revoked_at = ? WHERE match_id = ? AND host = 0 AND revoked_at IS NULL';
const MOVE_CREDENTIAL = 'UPDATE credentials SET match_id = ? WHERE token_hash = ? AND match_id = ?';
const DELETE_CREDENTIALS = 'DELETE FROM credentials WHERE match_id = ?';
const INSERT_TICKET = 'INSERT INTO tickets (ticket_hash, match_id, expires_at) VALUES (?, ?, ?)';
const FIND_TICKET = 'SELECT match_id, expires_at FROM tickets WHERE ticket_hash = ?';
const DELETE_TICKET = 'DELETE FROM tickets WHERE ticket_hash = ?';
const DELETE_TICKETS = 'DELETE FROM tickets WHERE match_id = ?';
const EXPIRED_MATCHES = 'SELECT id FROM matches WHERE last_activity < ?';

export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first(): Promise<Record<string, unknown> | null>;
  run(): Promise<unknown>;
  all?(): Promise<{ results?: readonly Record<string, unknown>[] }>;
}

export interface D1Like {
  prepare(query: string): D1Statement;
}

export interface CredentialRow {
  readonly tokenHash: string;
  readonly matchId: string;
  readonly host: boolean;
  readonly expiresAt: number;
  readonly revokedAt: number | null;
}

export interface MatchIndex {
  find(id: string): Promise<boolean>;
  insert(id: string, now: number): Promise<void>;
  remove(id: string): Promise<void>;
  takeQuota(addressHash: string, now: number): Promise<boolean>;
  releaseQuota(addressHash: string, now: number): Promise<void>;
  insertCredential(row: CredentialRow): Promise<void>;
  findCredential(tokenHash: string): Promise<CredentialRow | null>;
  revokePlayerCredentials(matchId: string, now: number): Promise<void>;
  moveCredential(tokenHash: string, fromMatchId: string, toMatchId: string): Promise<void>;
  putTicket(ticketHash: string, matchId: string, expiresAt: number): Promise<void>;
  takeTicket(ticketHash: string, now: number): Promise<string | null>;
  expiredMatchIds(now: number): Promise<readonly string[]>;
}

export function isIdConflict(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /unique|constraint|already exists|409/i.test(message);
}

function changesOf(result: unknown): number {
  if (!result || typeof result !== 'object') return 0;
  const meta = (result as { meta?: { changes?: unknown } }).meta;
  return typeof meta?.changes === 'number' ? meta.changes : 0;
}

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
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
      await db.prepare(DELETE_MATCH).bind(id).run();
    },
    async takeQuota(addressHash, now) {
      const day = quotaDay(now);
      const existing = await db.prepare(SELECT_QUOTA).bind(addressHash, day).first();
      const current = existing ? integer(existing.n) : 0;
      if (current !== null && current >= MATCHES_PER_DAY) return false;
      if (!existing) {
        try {
          await db.prepare(INSERT_QUOTA).bind(addressHash, day).run();
          return true;
        } catch (error) {
          if (!isIdConflict(error)) throw error;
        }
      }
      const updated = await db.prepare(UPDATE_QUOTA).bind(addressHash, day, MATCHES_PER_DAY).run();
      return changesOf(updated) > 0;
    },
    async releaseQuota(addressHash, now) {
      await db.prepare(RELEASE_QUOTA).bind(addressHash, quotaDay(now)).run();
    },
    async insertCredential(row) {
      await db
        .prepare(INSERT_CREDENTIAL)
        .bind(row.tokenHash, row.matchId, row.host ? 1 : 0, row.expiresAt, row.revokedAt)
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
      };
    },
    async revokePlayerCredentials(matchId, now) {
      await db.prepare(REVOKE_PLAYERS).bind(now, matchId).run();
    },
    async moveCredential(tokenHash, fromMatchId, toMatchId) {
      await db.prepare(MOVE_CREDENTIAL).bind(toMatchId, tokenHash, fromMatchId).run();
    },
    async putTicket(ticketHash, matchId, expiresAt) {
      await db.prepare(INSERT_TICKET).bind(ticketHash, matchId, expiresAt).run();
    },
    async takeTicket(ticketHash, now) {
      const row = await db.prepare(FIND_TICKET).bind(ticketHash).first();
      await db.prepare(DELETE_TICKET).bind(ticketHash).run();
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
