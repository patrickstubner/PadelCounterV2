import { CODE_ALARM_GLOBAL, HISTORY_RETAIN_MS, JOINS_PER_DEVICE, JOINS_PER_NETWORK, JOIN_WINDOW_MS, joinWindow, quotaDay } from '@padel/core';
import { describe, expect, it } from 'vitest';
import { d1MatchIndex, shouldTouchActivity, type CredentialRow, type D1Like, type D1Statement } from './match-index';
import { TEST_QUOTA_HMAC_KEY, quotaMac, sha256Hex } from './tokens';

const NOW = Date.UTC(2026, 9, 27, 12, 0, 0);

interface QuotaRow {
  hash: string;
  day: string;
  n: number;
  cap: number;
}

interface TicketRow {
  matchId: string;
  expiresAt: number;
}

interface MatchRow {
  createdAt: number;
  lastActivity: number;
}

interface CredRow {
  tokenHash: string;
  matchId: string;
  host: number;
  expiresAt: number;
  revokedAt: number | null;
}

interface JoinRow {
  hash: string;
  window: number;
  n: number;
  cap: number;
}

function memory(): { db: D1Like; queries: string[] } {
  const quota = new Map<string, QuotaRow>();
  const joins = new Map<string, JoinRow>();
  const tickets = new Map<string, TicketRow>();
  const matches = new Map<string, MatchRow>();
  const creds = new Map<string, CredRow>();
  const queries: string[] = [];

  function snapshot() {
    return {
      quota: new Map([...quota].map(([key, row]) => [key, { ...row }])),
      joins: new Map([...joins].map(([key, row]) => [key, { ...row }])),
      tickets: new Map([...tickets].map(([key, row]) => [key, { ...row }])),
      matches: new Map([...matches].map(([key, row]) => [key, { ...row }])),
      creds: new Map([...creds].map(([key, row]) => [key, { ...row }])),
    };
  }

  function restore(saved: ReturnType<typeof snapshot>) {
    quota.clear();
    joins.clear();
    tickets.clear();
    matches.clear();
    creds.clear();
    for (const [key, row] of saved.quota) quota.set(key, row);
    for (const [key, row] of saved.joins) joins.set(key, row);
    for (const [key, row] of saved.tickets) tickets.set(key, row);
    for (const [key, row] of saved.matches) matches.set(key, row);
    for (const [key, row] of saved.creds) creds.set(key, row);
  }

  function apply(sql: string, values: readonly unknown[], mode: 'run' | 'first' | 'all'): unknown {
    queries.push(sql);
    if (sql.startsWith('INSERT INTO matches')) {
      const id = String(values[0]);
      matches.set(id, { createdAt: Number(values[1]), lastActivity: Number(values[2]) });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('UPDATE matches SET last_activity')) {
      const row = matches.get(String(values[1]));
      if (row) row.lastActivity = Number(values[0]);
      return { meta: { changes: row ? 1 : 0 } };
    }
    if (sql.includes('FROM matches WHERE last_activity')) {
      const cutoff = Number(values[0]);
      const results = [...matches].filter(([, row]) => row.lastActivity < cutoff).map(([id]) => ({ id }));
      return { results };
    }
    if (sql.startsWith('INSERT INTO create_quota')) {
      const hash = String(values[0]);
      const day = String(values[1]);
      const cap = Number(values[2]);
      const key = `${hash}|${day}`;
      const current = quota.get(key);
      if (!current) {
        if (1 > cap) throw new Error('CHECK constraint failed');
        quota.set(key, { hash, day, n: 1, cap });
      } else if (current.n + 1 <= current.cap) {
        current.n += 1;
      } else {
        throw new Error('CHECK constraint failed');
      }
      return { meta: { changes: 1 } };
    }
    if (sql.includes('FROM create_quota WHERE address_hash')) {
      const row = quota.get(`${values[0]}|${values[1]}`);
      return row ? { n: row.n } : null;
    }
    if (sql.includes('SET n = n - 1')) {
      const row = quota.get(`${values[0]}|${values[1]}`);
      if (row && row.n > 0) row.n -= 1;
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('INSERT INTO join_quota')) {
      const hash = String(values[0]);
      const window = Number(values[1]);
      const cap = Number(values[2]);
      const key = `${hash}|${window}`;
      const current = joins.get(key);
      if (!current) {
        if (1 > cap) throw new Error('CHECK constraint failed');
        joins.set(key, { hash, window, n: 1, cap });
      } else if (current.n + 1 <= current.cap) {
        current.n += 1;
      } else {
        throw new Error('CHECK constraint failed');
      }
      const n = joins.get(key)?.n ?? 0;
      if (sql.includes('RETURNING')) return { results: [{ n }], meta: { changes: 1 } };
      return { meta: { changes: 1 } };
    }
    if (sql.includes('FROM join_quota WHERE subject_hash')) {
      const row = joins.get(`${values[0]}|${values[1]}`);
      return row ? { n: row.n } : null;
    }
    if (sql.startsWith('DELETE FROM join_quota')) {
      const cutoff = Number(values[0]);
      for (const [key, row] of joins) {
        if (row.window < cutoff) joins.delete(key);
      }
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('DELETE FROM create_quota')) {
      const cutoff = String(values[0]);
      for (const [key, row] of quota) {
        if (row.day < cutoff) quota.delete(key);
      }
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('INSERT INTO tickets')) {
      tickets.set(String(values[0]), { matchId: String(values[1]), expiresAt: Number(values[2]) });
      return { meta: { changes: 1 } };
    }
    if (sql.includes('RETURNING')) {
      const hash = String(values[0]);
      const row = tickets.get(hash);
      tickets.delete(hash);
      if (!row) return { results: [] };
      return { results: [{ match_id: row.matchId, expires_at: row.expiresAt }] };
    }
    if (sql.startsWith('DELETE FROM tickets WHERE expires_at')) {
      for (const [key, row] of tickets) {
        if (row.expiresAt <= Number(values[0])) tickets.delete(key);
      }
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('INSERT INTO credentials')) {
      if (values[0] === 'fail') throw new Error('credential insert failed');
      const tokenHash = String(values[0]);
      creds.set(tokenHash, {
        tokenHash,
        matchId: String(values[1]),
        host: Number(values[2]),
        expiresAt: Number(values[3]),
        revokedAt: values[4] === null || values[4] === undefined ? null : Number(values[4]),
      });
      return { meta: { changes: 1 } };
    }
    if (sql.includes('FROM credentials')) {
      const row = creds.get(String(values[0]));
      if (!row) return null;
      return {
        token_hash: row.tokenHash,
        match_id: row.matchId,
        host: row.host,
        expires_at: row.expiresAt,
        revoked_at: row.revokedAt,
      };
    }
    if (sql.startsWith('UPDATE credentials SET revoked_at')) {
      for (const row of creds.values()) {
        if (row.matchId === values[1] && row.host === 0 && row.revokedAt === null) row.revokedAt = Number(values[0]);
      }
      return { meta: { changes: 1 } };
    }
    if (mode === 'all') return { results: [] };
    if (mode === 'first') return null;
    return { meta: { changes: 0 } };
  }

  const db: D1Like = {
    prepare(query: string): D1Statement {
      const statement: D1Statement = {
        bind(...values: unknown[]) {
          const bound: D1Statement = {
            bind: statement.bind,
            async first() {
              const result = apply(query, values, 'first');
              return result && typeof result === 'object' && !('results' in result) ? (result as Record<string, unknown>) : null;
            },
            async run() {
              return apply(query, values, 'run');
            },
            async all() {
              const result = apply(query, values, 'all');
              return result && typeof result === 'object' && 'results' in result
                ? (result as { results: Record<string, unknown>[] })
                : { results: [] };
            },
          };
          return bound;
        },
        async first() {
          return null;
        },
        async run() {
          return apply(query, [], 'run');
        },
        async all() {
          return { results: [] };
        },
      };
      return statement;
    },
    async batch(statements) {
      const saved = snapshot();
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        return results;
      } catch (error) {
        restore(saved);
        throw error;
      }
    },
  };
  return { db, queries };
}

const player = (tokenHash: string): CredentialRow => ({
  tokenHash,
  matchId: 'match-1',
  host: false,
  expiresAt: NOW + 1000,
  revokedAt: null,
});

describe('create quota', () => {
  it('caps a device at 10 and a network at 100 without moving the other counter', async () => {
    const { db } = memory();
    const index = d1MatchIndex(db);
    for (let i = 0; i < 10; i += 1) {
      const taken = await index.takeCreateQuota('device-a', `net-${i}`, NOW);
      expect(taken).toEqual({ ok: true });
    }
    const deviceBlocked = await index.takeCreateQuota('device-a', 'net-new', NOW);
    expect(deviceBlocked).toEqual({ ok: false, reason: 'device' });
    expect(
      await db.prepare('SELECT n FROM create_quota WHERE address_hash = ? AND day = ?').bind('net-new', quotaDay(NOW)).first(),
    ).toBeNull();
    const fresh = await index.takeCreateQuota('device-b', 'net-new', NOW);
    expect(fresh).toEqual({ ok: true });

    const network = memory();
    const networkIndex = d1MatchIndex(network.db);
    for (let i = 0; i < 100; i += 1) {
      const taken = await networkIndex.takeCreateQuota(`device-${i}`, 'shared-net', NOW);
      expect(taken.ok).toBe(true);
    }
    const networkBlocked = await networkIndex.takeCreateQuota('device-overflow', 'shared-net', NOW);
    expect(networkBlocked).toEqual({ ok: false, reason: 'network' });
    const overflow = await network.db.prepare('SELECT n FROM create_quota WHERE address_hash = ? AND day = ?').bind('device-overflow', quotaDay(NOW)).first();
    expect(overflow).toBeNull();
  });

  it('rotates the HMAC each UTC day and does not store a plain address hash', async () => {
    const address = '203.0.113.10';
    const today = await quotaMac(TEST_QUOTA_HMAC_KEY, 'ip', address, '2026-10-27');
    const tomorrow = await quotaMac(TEST_QUOTA_HMAC_KEY, 'ip', address, '2026-10-28');
    expect(today).not.toBe(tomorrow);
    expect(today).not.toBe(await sha256Hex(address));
    expect(today).not.toBe(await quotaMac(TEST_QUOTA_HMAC_KEY, 'device', address, '2026-10-27'));
    const socket = await quotaMac(TEST_QUOTA_HMAC_KEY, 'socket-ip', address, 'socket');
    expect(socket).toBe(await quotaMac(TEST_QUOTA_HMAC_KEY, 'socket-ip', address, 'socket'));
    expect(socket).not.toBe(await quotaMac(TEST_QUOTA_HMAC_KEY, 'socket-ip', '203.0.113.11', 'socket'));
    expect(socket).not.toBe(await sha256Hex(address));
    expect(socket).not.toContain(address);
  });

  it('deletes quota rows older than two days and expired tickets', async () => {
    const { db } = memory();
    const index = d1MatchIndex(db);
    const old = NOW - 3 * 24 * 60 * 60 * 1000;
    expect((await index.takeCreateQuota('old-device', 'old-net', old)).ok).toBe(true);
    expect((await index.takeCreateQuota('new-device', 'new-net', NOW)).ok).toBe(true);
    await index.putTicket('expired', 'match-1', NOW - 1);
    await index.putTicket('fresh', 'match-1', NOW + 30_000);
    await index.purgeEphemeral(NOW);
    const day = quotaDay(NOW);
    expect(await db.prepare('SELECT n FROM create_quota WHERE address_hash = ? AND day = ?').bind('old-device', quotaDay(old)).first()).toBeNull();
    expect(await db.prepare('SELECT n FROM create_quota WHERE address_hash = ? AND day = ?').bind('new-device', day).first()).toEqual({ n: 1 });
    expect(await index.takeTicket('expired', NOW)).toBeNull();
    expect(await index.takeTicket('fresh', NOW)).toBe('match-1');
  });

  it('takes a ticket with one delete and ignores an expired row', async () => {
    const { db, queries } = memory();
    const index = d1MatchIndex(db);
    await index.putTicket('once', 'match-9', NOW + 1000);
    queries.length = 0;
    expect(await index.takeTicket('once', NOW)).toBe('match-9');
    expect(queries).toEqual(['DELETE FROM tickets WHERE ticket_hash = ? RETURNING match_id, expires_at']);
    expect(await index.takeTicket('once', NOW)).toBeNull();
    await index.putTicket('stale', 'match-9', NOW);
    expect(await index.takeTicket('stale', NOW)).toBeNull();
  });

  it('touches D1 activity at most once a minute', () => {
    const last = NOW;
    expect(shouldTouchActivity(last, last)).toBe(false);
    expect(shouldTouchActivity(last, last + 59_999)).toBe(false);
    expect(shouldTouchActivity(last, last + 60_000)).toBe(true);
    expect(shouldTouchActivity(last + 1, last)).toBe(false);
    expect(shouldTouchActivity(1.5, last)).toBe(false);
    expect(shouldTouchActivity(last, Number.NaN)).toBe(false);
  });

  it('moves the two-year clock from the last score', async () => {
    const { db } = memory();
    const index = d1MatchIndex(db);
    const created = NOW - HISTORY_RETAIN_MS - 1000;
    await index.insert('match-old', created);
    expect(await index.expiredMatchIds(NOW)).toEqual(['match-old']);
    await index.touchActivity('match-old', NOW);
    expect(await index.expiredMatchIds(NOW)).toEqual([]);
  });

  it('limits a device on every join and a network only when a failure is recorded', async () => {
    const { db } = memory();
    const index = d1MatchIndex(db);
    const window = joinWindow(NOW);
    const device = await quotaMac(TEST_QUOTA_HMAC_KEY, 'join-device', 'd00000001', String(window));
    const network = await quotaMac(TEST_QUOTA_HMAC_KEY, 'join-ip', '192.0.2.1', String(window));
    expect(device).not.toBe(await sha256Hex('d00000001'));
    expect(network).not.toBe(await sha256Hex('192.0.2.1'));
    for (let i = 0; i < JOINS_PER_DEVICE; i += 1) {
      expect((await index.takeJoinDevice(device, NOW)).ok).toBe(true);
    }
    expect(await db.prepare('SELECT n FROM join_quota WHERE subject_hash = ? AND window = ?').bind(network, window).first()).toBeNull();
    const again = d1MatchIndex(db);
    expect(await again.takeJoinDevice(device, NOW)).toEqual({ ok: false, reason: 'device' });
    expect((await again.takeJoinDevice(device, NOW + JOIN_WINDOW_MS)).ok).toBe(true);

    const shared = await quotaMac(TEST_QUOTA_HMAC_KEY, 'join-ip', '192.0.2.9', String(window));
    for (let i = 0; i < JOINS_PER_NETWORK; i += 1) {
      expect((await index.noteJoinFailure(shared, NOW)).ok).toBe(true);
    }
    expect(await db.prepare('SELECT n FROM join_quota WHERE subject_hash = ? AND window = ?').bind(shared, window).first()).toEqual({ n: JOINS_PER_NETWORK });
    expect(await index.noteJoinFailure(shared, NOW)).toEqual({ ok: false, reason: 'network' });
    expect(await db.prepare('SELECT n FROM join_quota WHERE subject_hash = ? AND window = ?').bind(shared, window).first()).toEqual({ n: JOINS_PER_NETWORK });
    const overflowPhone = await quotaMac(TEST_QUOTA_HMAC_KEY, 'join-device', 'd000000ff', String(window));
    expect((await index.takeJoinDevice(overflowPhone, NOW)).ok).toBe(true);

    await index.purgeEphemeral(NOW + 3 * 24 * 60 * 60 * 1000);
    expect(await db.prepare('SELECT n FROM join_quota WHERE subject_hash = ? AND window = ?').bind(device, window).first()).toBeNull();
    expect(await db.prepare('SELECT n FROM join_quota WHERE subject_hash = ? AND window = ?').bind(shared, window).first()).toBeNull();
  });

  it('alarms only when the upsert lands on exactly 10000', async () => {
    const { db, queries } = memory();
    const index = d1MatchIndex(db);
    let alarms = 0;
    for (let i = 0; i < CODE_ALARM_GLOBAL + 2; i += 1) {
      if (await index.noteCodeAlarm('global', NOW)) alarms += 1;
    }
    expect(alarms).toBe(1);
    expect(queries.some((sql) => sql.includes('RETURNING n'))).toBe(true);
    expect(queries.some((sql) => sql.startsWith('SELECT n FROM join_quota'))).toBe(false);
    expect(TEST_QUOTA_HMAC_KEY.length).toBeGreaterThanOrEqual(32);
  });

  it('rolls back a player-credential revoke when the insert fails', async () => {
    const { db } = memory();
    const index = d1MatchIndex(db);
    await index.insertCredential(player('player-1'));
    await expect(index.replacePlayerCredential('match-1', NOW, player('fail'))).rejects.toThrow(/credential insert failed/);
    expect((await index.findCredential('player-1'))?.revokedAt).toBeNull();
    await index.replacePlayerCredential('match-1', NOW, player('player-2'));
    expect((await index.findCredential('player-1'))?.revokedAt).toBe(NOW);
    expect((await index.findCredential('player-2'))?.revokedAt).toBeNull();
  });
});
