import { readFileSync } from 'node:fs';
import { createMatch, joinWindow, quotaDay } from '@padel/core';
import { describe, expect, it } from 'vitest';
import { CLIENT_IP_HEADER, clientIpHeaders } from './match-index';
import { handleFetch, type RoomNamespace, type ServerEnv } from './server';
import { quotaMac, sha256Hex } from './tokens';

const CLIENT = '00000000-0000-4000-8000-0000000000aa';
const PAGES = 'https://patrickstubner.github.io';

function courtLog(): unknown {
  return { schemaVersion: 2, base: createMatch(1_700_000_000_000, CLIENT), events: [] };
}

interface CredRow {
  tokenHash: string;
  matchId: string;
  host: number;
  expiresAt: number;
  revokedAt: number | null;
}

interface TicketRow {
  matchId: string;
  expiresAt: number;
}

interface RoomInfo {
  lastChangeAt: number;
  joinedHashes: readonly string[];
  invites: readonly { tokenHash: string; host: boolean; deviceId?: string | null }[];
}

function harness(options?: {
  failCreate?: boolean | 'throw';
  conflictOnce?: boolean;
  roomInfo?: RoomInfo;
  omitQuotaKey?: boolean;
  failPlayerInsert?: boolean;
  omitLimiter?: boolean;
  /** After this many binding checks, `limit()` returns `{ success: false }`. */
  edgeFailAfter?: number;
}): {
  env: ServerEnv;
  found: Set<string>;
  calls: { id: string; body: string; ip: string | null }[];
  ops: string[];
  creds: Map<string, CredRow>;
  quota: Map<string, number>;
  joins: Map<string, number>;
  edge: { calls: number; keys: string[] };
  queries: string[];
} {
  const found = new Set<string>();
  const calls: { id: string; body: string; ip: string | null }[] = [];
  const ops: string[] = [];
  const quota = new Map<string, number>();
  const joins = new Map<string, number>();
  const queries: string[] = [];
  const edge = { calls: 0, keys: [] as string[] };
  const creds = new Map<string, CredRow>();
  const tickets = new Map<string, TicketRow>();
  let conflictsLeft = options?.conflictOnce ? 1 : 0;
  let playerInserts = 0;
  const rooms: RoomNamespace = {
    idFromName(name) {
      return name;
    },
    get(id) {
      return {
        async fetch(input, init) {
          const request = input instanceof Request ? input : new Request(String(input), init);
          calls.push({
            id: String(id),
            body: request.method === 'GET' ? '' : await request.text(),
            ip: request.headers.get(CLIENT_IP_HEADER),
          });
          if (request.url.endsWith('/create')) {
            ops.push('do-create');
            if (options?.failCreate === 'throw') throw new Error('create failed');
            if (options?.failCreate) return Response.json({ error: 'unavailable' }, { status: 500 });
          } else if (request.url.endsWith('/discard')) {
            ops.push('do-discard');
            return Response.json({ ok: true });
          } else if (request.url.endsWith('/reconnect-info')) {
            return Response.json(
              options?.roomInfo ?? { lastChangeAt: 0, joinedHashes: [], invites: [] },
            );
          } else if (request.url.endsWith('/carry-invite')) {
            ops.push('do-carry');
          } else if (request.url.endsWith('/notify')) {
            ops.push('do-notify');
          }
          return Response.json({ expiresAt: 1_700_000_000_000 }, { status: 201 });
        },
      };
    },
  };
  const env: ServerEnv = {
    ENVIRONMENT: 'production',
    MATCH_ROOMS: rooms,
    DB: {
      prepare(query: string) {
        const statement = {
          query,
          values: [] as unknown[],
          bind(...values: unknown[]) {
            statement.values = values;
            return statement;
          },
          async first() {
            const sql = statement.query;
            queries.push(sql);
            const values = statement.values;
            if (sql.includes('FROM matches WHERE id')) {
              const id = values[0];
              return typeof id === 'string' && found.has(id) ? { id } : null;
            }
            if (sql.includes('FROM create_quota')) {
              const n = quota.get(`${values[0]}|${values[1]}`);
              return n === undefined ? null : { n };
            }
            if (sql.includes('FROM join_quota')) {
              const n = joins.get(`${values[0]}|${values[1]}`);
              return n === undefined ? null : { n };
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
            if (sql.includes('FROM tickets')) {
              const row = tickets.get(String(values[0]));
              return row ? { match_id: row.matchId, expires_at: row.expiresAt } : null;
            }
            return null;
          },
          async run() {
            const sql = statement.query;
            queries.push(sql);
            const values = statement.values;
            let changes = 1;
            if (sql.startsWith('INSERT INTO matches')) {
              if (conflictsLeft > 0) {
                conflictsLeft -= 1;
                throw new Error('UNIQUE constraint failed');
              }
              const id = values[0];
              if (typeof id === 'string') found.add(id);
              ops.push('d1-insert');
            } else if (sql.startsWith('DELETE FROM matches') && typeof values[0] === 'string') {
              found.delete(values[0]);
              ops.push('d1-delete');
            } else if (sql.startsWith('INSERT INTO join_quota')) {
              const key = `${values[0]}|${values[1]}`;
              const cap = Number(values[2]);
              const current = joins.get(key);
              if (current === undefined) joins.set(key, 1);
              else if (current + 1 <= cap) joins.set(key, current + 1);
              else throw new Error('CHECK constraint failed');
            } else if (sql.startsWith('INSERT INTO create_quota')) {
              const key = `${values[0]}|${values[1]}`;
              const cap = Number(values[2]);
              const current = quota.get(key);
              if (current === undefined) quota.set(key, 1);
              else if (current + 1 <= cap) quota.set(key, current + 1);
              else throw new Error('CHECK constraint failed');
            } else if (sql.includes('SET n = n - 1')) {
              const key = `${values[0]}|${values[1]}`;
              const current = quota.get(key) ?? 0;
              if (current > 0) quota.set(key, current - 1);
              else changes = 0;
            } else if (sql.startsWith('INSERT INTO credentials')) {
              if (Number(values[2]) === 0) {
                playerInserts += 1;
                if (options?.failPlayerInsert && playerInserts > 1) throw new Error('credential insert failed');
              }
              const tokenHash = String(values[0]);
              creds.set(tokenHash, {
                tokenHash,
                matchId: String(values[1]),
                host: Number(values[2]),
                expiresAt: Number(values[3]),
                revokedAt: values[4] === null || values[4] === undefined ? null : Number(values[4]),
              });
            } else if (sql.startsWith('DELETE FROM credentials')) {
              for (const [hash, row] of creds) {
                if (row.matchId === values[0]) creds.delete(hash);
              }
            } else if (sql.startsWith('UPDATE credentials SET revoked_at')) {
              for (const row of creds.values()) {
                if (row.matchId === values[1] && row.host === 0 && row.revokedAt === null) row.revokedAt = Number(values[0]);
              }
            } else if (sql.startsWith('INSERT INTO tickets')) {
              tickets.set(String(values[0]), { matchId: String(values[1]), expiresAt: Number(values[2]) });
            } else if (sql.startsWith('DELETE FROM tickets WHERE match_id')) {
              for (const [hash, row] of tickets) {
                if (row.matchId === values[0]) tickets.delete(hash);
              }
            }
            return { success: true, meta: { changes } };
          },
          async all() {
            const sql = statement.query;
            queries.push(sql);
            const values = statement.values;
            if (sql.includes('RETURNING')) {
              const hash = String(values[0]);
              const row = tickets.get(hash);
              tickets.delete(hash);
              if (!row) return { results: [] };
              return { results: [{ match_id: row.matchId, expires_at: row.expiresAt }] };
            }
            return { results: [] };
          },
        };
        return statement;
      },
      async batch(statements: readonly { run(): Promise<unknown> }[]) {
        const quotaSnapshot = new Map(quota);
        const joinSnapshot = new Map(joins);
        const credSnapshot = new Map([...creds].map(([key, row]) => [key, { ...row }]));
        try {
          const results = [];
          for (const statement of statements) results.push(await statement.run());
          ops.push('d1-batch');
          return results;
        } catch (error) {
          quota.clear();
          for (const [key, value] of quotaSnapshot) quota.set(key, value);
          joins.clear();
          for (const [key, value] of joinSnapshot) joins.set(key, value);
          creds.clear();
          for (const [key, value] of credSnapshot) creds.set(key, value);
          throw error;
        }
      },
    },
    ...(options?.omitQuotaKey ? {} : { QUOTA_HMAC_KEY: 'test-quota-hmac-key' }),
    ...(options?.omitLimiter
      ? {}
      : {
          REQUEST_LIMIT: {
            async limit(input: { key: string }) {
              edge.calls += 1;
              edge.keys.push(input.key);
              if (options?.edgeFailAfter !== undefined && edge.calls > options.edgeFailAfter) {
                return { success: false };
              }
              return { success: true };
            },
          },
        }),
  };
  return { env, found, calls, ops, creds, quota, joins, edge, queries };
}

function postMatch(ip: string, extra?: Record<string, unknown>, device = 'd00000001'): Request {
  return new Request('https://padel.example/matches', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
    body: JSON.stringify({ log: courtLog(), device, ...extra }),
  });
}

function joinRequest(ip: string, token: string, device = 'd00000001'): Request {
  return new Request('https://padel.example/join', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      origin: PAGES,
      'content-type': 'application/json',
      'cf-connecting-ip': ip,
    },
    body: JSON.stringify({ device }),
  });
}

function carryRequest(
  matchId: string,
  hostToken: string,
  previousHostToken: string,
  confirm: boolean,
  ip: string,
): Request {
  return new Request(`https://padel.example/matches/${matchId}/carry`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${hostToken}`,
      'content-type': 'application/json',
      origin: PAGES,
      'cf-connecting-ip': ip,
    },
    body: JSON.stringify({ confirm, previousHostToken }),
  });
}

describe('match index gate', () => {
  it('mints the match id and does not open a socket for an unknown id', async () => {
    const { env, found, calls, ops } = harness();
    const created = await handleFetch(postMatch('203.0.113.21'), env);
    expect(created.status).toBe(201);
    const body = (await created.json()) as { matchId: string };
    expect(body.matchId).not.toBe(CLIENT);
    expect(found.has(body.matchId)).toBe(true);
    const sent = JSON.parse(calls[0]?.body ?? '{}') as { log: { base: { matchId: string } } };
    expect(sent.log.base.matchId).toBe(body.matchId);
    expect(calls).toHaveLength(1);
    expect(ops).toEqual(['d1-batch', 'd1-insert', 'do-create']);

    const unknown = '00000000-0000-4000-8000-0000000000ff';
    const socket = await handleFetch(
      new Request(`https://padel.example/matches/${unknown}/ws`, {
        headers: { upgrade: 'websocket', origin: PAGES, 'cf-connecting-ip': '203.0.113.22', [CLIENT_IP_HEADER]: 'spoofed' },
      }),
      env,
    );
    expect(socket.status).toBe(404);
    expect(calls).toHaveLength(1);

    const invite = await handleFetch(
      new Request(`https://padel.example/matches/${unknown}/invites`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer abcdefghijklmnopqrstuv',
          'content-type': 'application/json',
          'cf-connecting-ip': '203.0.113.23',
        },
        body: JSON.stringify({ role: 'player' }),
      }),
      env,
    );
    expect(invite.status).toBe(404);
    expect(calls).toHaveLength(1);
  });

  it('forwards a socket only after a one-use ticket and replaces a spoofed address', async () => {
    const { env, calls } = harness();
    const created = await handleFetch(postMatch('203.0.113.31'), env);
    const body = (await created.json()) as { matchId: string; hostToken: string };
    const minted = await handleFetch(joinRequest('203.0.113.31', body.hostToken), env);
    expect(minted.status).toBe(201);
    const ticketBody = (await minted.json()) as { ticket?: string; matchId?: string };
    expect(ticketBody.ticket).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(ticketBody).not.toHaveProperty('matchId');
    const socket = await handleFetch(
      new Request(`https://padel.example/ws/${ticketBody.ticket}`, {
        headers: {
          upgrade: 'websocket',
          origin: PAGES,
          'cf-connecting-ip': '198.51.100.7',
          [CLIENT_IP_HEADER]: 'spoofed',
        },
      }),
      env,
    );
    expect(socket.status).toBe(201);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.ip).toBe('198.51.100.7');
    expect(calls[1]?.id).toBe(body.matchId);

    const again = await handleFetch(
      new Request(`https://padel.example/ws/${ticketBody.ticket}`, {
        headers: { upgrade: 'websocket', origin: PAGES, 'cf-connecting-ip': '198.51.100.9' },
      }),
      env,
    );
    expect(again.status).toBe(401);
    expect(calls).toHaveLength(2);

    const byId = await handleFetch(
      new Request(`https://padel.example/matches/${body.matchId}/ws`, {
        headers: { upgrade: 'websocket', origin: PAGES, 'cf-connecting-ip': '203.0.113.33' },
      }),
      env,
    );
    expect(byId.status).toBe(404);
    expect(calls).toHaveLength(2);
  });

  it('stops the 21st match route before another durable object call', async () => {
    const { env, calls } = harness();
    const created = await handleFetch(postMatch('203.0.113.41'), env);
    expect(created.status).toBe(201);
    const body = (await created.json()) as { hostToken: string };
    for (let i = 0; i < 19; i += 1) {
      const response = await handleFetch(joinRequest('203.0.113.41', body.hostToken), env);
      expect(response.status).toBe(201);
    }
    const blocked = await handleFetch(joinRequest('203.0.113.41', body.hostToken), env);
    expect(blocked.status).toBe(429);
    expect(((await blocked.json()) as { error: string }).error).toBe('slow_down');
    expect(calls).toHaveLength(1);
  });

  it('limits join tickets per device in D1 across addresses', async () => {
    const { env } = harness();
    const created = await handleFetch(postMatch('192.0.2.1', undefined, 'd00000099'), env);
    expect(created.status).toBe(201);
    const body = (await created.json()) as { hostToken: string };
    for (let i = 0; i < 20; i += 1) {
      const response = await handleFetch(joinRequest(`192.0.2.${i + 2}`, body.hostToken, 'd00000099'), env);
      expect(response.status).toBe(201);
    }
    const blocked = await handleFetch(joinRequest('192.0.2.30', body.hostToken, 'd00000099'), env);
    expect(blocked.status).toBe(429);
    const payload = (await blocked.json()) as { error: string; message: string };
    expect(payload).toEqual({
      error: 'join_device_limit',
      message: 'Too many connection attempts from this device. Wait a minute.',
    });
    const other = await handleFetch(joinRequest('192.0.2.31', body.hostToken, 'd00000098'), env);
    expect(other.status).toBe(201);
    const missingDevice = await handleFetch(
      new Request('https://padel.example/join', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${body.hostToken}`,
          origin: PAGES,
          'content-type': 'application/json',
          'cf-connecting-ip': '192.0.2.32',
        },
        body: JSON.stringify({ device: 'phone' }),
      }),
      env,
    );
    expect(missingDevice.status).toBe(400);
    expect(((await missingDevice.json()) as { error: string }).error).toBe('invalid_device');
    const missingKey = harness({ omitQuotaKey: true });
    const unconfigured = await handleFetch(joinRequest('192.0.2.33', body.hostToken, 'd00000099'), missingKey.env);
    expect(unconfigured.status).toBe(503);
  });

  it('counts the network only after a rejected token and still admits a valid one', async () => {
    const { env, joins } = harness();
    const created = await handleFetch(postMatch('192.0.2.60', undefined, 'd00000060'), env);
    expect(created.status).toBe(201);
    const body = (await created.json()) as { hostToken: string };
    const window = joinWindow(Date.now());
    const device = await quotaMac('test-quota-hmac-key', 'join-device', 'd00000060', String(window));
    const network = await quotaMac('test-quota-hmac-key', 'join-ip', '192.0.2.61', String(window));
    const ok = await handleFetch(joinRequest('192.0.2.61', body.hostToken, 'd00000060'), env);
    expect(ok.status).toBe(201);
    expect(joins.get(`${device}|${window}`)).toBe(1);
    expect(joins.has(`${network}|${window}`)).toBe(false);

    const bad = await handleFetch(joinRequest('192.0.2.61', 'b'.repeat(22), 'd00000060'), env);
    expect(bad.status).toBe(401);
    expect(((await bad.json()) as { error: string }).error).toBe('bad_token');
    expect(joins.get(`${network}|${window}`)).toBe(1);
    expect(joins.get(`${device}|${window}`)).toBe(1);

    const invalid = await handleFetch(joinRequest('192.0.2.62', body.hostToken, 'not-a-device'), env);
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      error: 'invalid_device',
      message: 'This device id is not valid.',
    });
    expect(joins.size).toBe(2);

    const full = await quotaMac('test-quota-hmac-key', 'join-ip', '192.0.2.71', String(window));
    joins.set(`${full}|${window}`, 60);
    const still = await handleFetch(joinRequest('192.0.2.71', body.hostToken, 'd00000070'), env);
    expect(still.status).toBe(201);
    expect(joins.get(`${full}|${window}`)).toBe(60);
    const overflow = await handleFetch(joinRequest('192.0.2.71', 'c'.repeat(22), 'd00000071'), env);
    expect(overflow.status).toBe(429);
    expect(await overflow.json()).toEqual({
      error: 'join_network_limit',
      message: 'Too many failed connection attempts from this network. Wait a minute.',
    });
    expect(joins.get(`${full}|${window}`)).toBe(60);
  });

  it('reads a rejected join before the one network write and then stops further writes', async () => {
    const { env, joins, queries } = harness();
    const created = await handleFetch(postMatch('198.51.100.60', undefined, 'd00000061'), env);
    expect(created.status).toBe(201);
    const body = (await created.json()) as { hostToken: string };
    const window = joinWindow(Date.now());
    const network = await quotaMac('test-quota-hmac-key', 'join-ip', '198.51.100.61', String(window));
    const device = await quotaMac('test-quota-hmac-key', 'join-device', 'd00000061', String(window));
    const writes = (from: number) => queries.slice(from).filter((sql) => /^(INSERT|UPDATE|DELETE)\b/.test(sql));

    for (let i = 0; i < 5; i += 1) {
      const mark = queries.length;
      const bad = await handleFetch(joinRequest('198.51.100.61', 'e'.repeat(22), 'd00000061'), env);
      expect(bad.status).toBe(401);
      const added = writes(mark);
      expect(added).toEqual([
        'INSERT INTO join_quota (subject_hash, window, n, cap) VALUES (?, ?, 1, ?) ON CONFLICT(subject_hash, window) DO UPDATE SET n = n + 1',
      ]);
      const readAt = queries.slice(mark).findIndex((sql) => sql.includes('FROM credentials'));
      const writeAt = queries.slice(mark).findIndex((sql) => sql.startsWith('INSERT INTO join_quota'));
      expect(readAt).toBeGreaterThan(-1);
      expect(readAt).toBeLessThan(writeAt);
    }
    expect(joins.get(`${network}|${window}`)).toBe(5);
    expect(joins.has(`${device}|${window}`)).toBe(false);

    const mark = queries.length;
    const stopped = await handleFetch(joinRequest('198.51.100.61', 'e'.repeat(22), 'd00000061'), env);
    expect(stopped.status).toBe(429);
    expect(((await stopped.json()) as { error: string }).error).toBe('slow_down');
    expect(writes(mark)).toEqual([]);
    expect(queries.slice(mark).some((sql) => sql.includes('FROM credentials'))).toBe(true);
    expect(joins.get(`${network}|${window}`)).toBe(5);

    const okMark = queries.length;
    const ok = await handleFetch(joinRequest('198.51.100.61', body.hostToken, 'd00000061'), env);
    expect(ok.status).toBe(201);
    expect(joins.get(`${device}|${window}`)).toBe(1);
    expect(joins.get(`${network}|${window}`)).toBe(5);
    const okQueries = queries.slice(okMark);
    const credentialAt = okQueries.findIndex((sql) => sql.includes('FROM credentials'));
    const matchAt = okQueries.findIndex((sql) => sql.includes('FROM matches WHERE id'));
    const deviceWriteAt = okQueries.findIndex((sql) => sql.startsWith('INSERT INTO join_quota'));
    expect(credentialAt).toBeGreaterThan(-1);
    expect(credentialAt).toBeLessThan(matchAt);
    expect(matchAt).toBeLessThan(deviceWriteAt);
    expect(writes(okMark).filter((sql) => sql.startsWith('INSERT INTO join_quota'))).toHaveLength(1);
  });

  it('stops a match route at the Workers rate limit before D1 and before the isolate map', async () => {
    const blocked = harness({ edgeFailAfter: 0 });
    const create = await handleFetch(postMatch('192.0.2.50'), blocked.env);
    expect(create.status).toBe(429);
    expect(((await create.json()) as { error: string }).error).toBe('slow_down');
    expect(blocked.ops).toHaveLength(0);
    expect(blocked.joins.size).toBe(0);
    expect(blocked.calls).toHaveLength(0);
    const join = await handleFetch(joinRequest('192.0.2.51', 'd'.repeat(22)), blocked.env);
    expect(join.status).toBe(429);
    expect(blocked.joins.size).toBe(0);
    const socket = await handleFetch(
      new Request('https://padel.example/ws/abcdefghijklmnopqrstuv', {
        headers: { upgrade: 'websocket', origin: PAGES, 'cf-connecting-ip': '192.0.2.52' },
      }),
      blocked.env,
    );
    expect(socket.status).toBe(429);
    expect(blocked.edge.calls).toBe(3);
    expect(blocked.ops).toHaveLength(0);

    const open = harness();
    const health = await handleFetch(
      new Request('https://padel.example/health', { headers: { 'cf-connecting-ip': '192.0.2.53' } }),
      open.env,
    );
    expect(health.status).toBe(200);
    expect(open.edge.calls).toBe(0);
    const auth = await handleFetch(
      new Request('https://padel.example/auth/google', {
        method: 'POST',
        headers: { 'cf-connecting-ip': '192.0.2.54' },
      }),
      open.env,
    );
    expect(auth.status).toBe(501);
    expect(open.edge.calls).toBe(0);

    const keyed = harness();
    await handleFetch(postMatch('192.0.2.80'), keyed.env);
    await handleFetch(postMatch('192.0.2.80', undefined, 'd00000080'), keyed.env);
    const expected = await quotaMac('test-quota-hmac-key', 'rate-ip', '192.0.2.80', 'binding');
    expect(keyed.edge.keys).toEqual([expected, expected]);
    expect(expected).not.toContain('192.0.2.80');
    expect(expected).not.toBe(await sha256Hex('192.0.2.80'));

    const bare = harness({ omitLimiter: true });
    const missingBinding = await handleFetch(postMatch('192.0.2.55'), bare.env);
    expect(missingBinding.status).toBe(503);
    expect(bare.ops).toHaveLength(0);
    const missingKey = harness({ omitQuotaKey: true });
    const refused = await handleFetch(postMatch('192.0.2.56'), missingKey.env);
    expect(refused.status).toBe(503);
    expect(missingKey.edge.calls).toBe(0);
    expect(missingKey.ops).toHaveLength(0);
  });

  it('writes the index first and drops the row and the room when create fails', async () => {
    const { env, found, calls, ops } = harness({ failCreate: true });
    const created = await handleFetch(postMatch('203.0.113.61'), env);
    expect(created.status).toBe(500);
    expect(ops[0]).toBe('d1-batch');
    expect(ops.indexOf('d1-insert')).toBeLessThan(ops.indexOf('do-create'));
    expect(ops.indexOf('do-create')).toBeLessThan(ops.indexOf('d1-delete'));
    expect(ops.indexOf('do-create')).toBeLessThan(ops.indexOf('do-discard'));
    expect(found.size).toBe(0);
    expect(calls[0]?.id).toBe(calls[1]?.id);
    expect(calls[1]?.body).toBe('');
  });

  it('drops the index and the room when the room write throws', async () => {
    const { env, found, ops } = harness({ failCreate: 'throw' });
    const created = await handleFetch(postMatch('203.0.113.63'), env);
    expect(created.status).toBe(500);
    expect(ops).toEqual(['d1-batch', 'd1-insert', 'do-create', 'd1-delete', 'do-discard', 'd1-batch']);
    expect(found.size).toBe(0);
  });

  it('does not expose discard on the public worker', async () => {
    const { env, calls, ops } = harness();
    const response = await handleFetch(
      new Request('https://padel.example/discard', {
        method: 'POST',
        headers: { 'cf-connecting-ip': '203.0.113.62' },
      }),
      env,
    );
    expect(response.status).toBe(404);
    expect(calls).toHaveLength(0);
    expect(ops).toHaveLength(0);
  });

  it('allows ten creates a day on one device and blocks the eleventh', async () => {
    const { env, ops } = harness();
    for (let i = 0; i < 10; i += 1) {
      const response = await handleFetch(postMatch('203.0.113.71', undefined, 'd00000071'), env);
      expect(response.status).toBe(201);
    }
    const blocked = await handleFetch(postMatch('203.0.113.71', undefined, 'd00000071'), env);
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({
      error: 'device_daily_limit',
      message: "You've reached 10 new matches today on this device.",
    });
    expect(ops.filter((op) => op === 'do-create')).toHaveLength(10);
    const sameDevice = await handleFetch(postMatch('203.0.113.72', undefined, 'd00000071'), env);
    expect(sameDevice.status).toBe(429);
    expect(((await sameDevice.json()) as { error: string }).error).toBe('device_daily_limit');
    const otherDevice = await handleFetch(postMatch('203.0.113.71', undefined, 'd00000072'), env);
    expect(otherDevice.status).toBe(201);
    expect(ops.filter((op) => op === 'do-create')).toHaveLength(11);
  });

  it('blocks a network that has already started 100 matches', async () => {
    const { env, quota, ops } = harness();
    const day = quotaDay(Date.now());
    const ipHash = await quotaMac('test-quota-hmac-key', 'ip', '198.51.100.51', day);
    quota.set(`${ipHash}|${day}`, 100);
    const response = await handleFetch(postMatch('198.51.100.51', undefined, 'd00000051'), env);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: 'network_daily_limit',
      message: 'Too many new matches from this network today.',
    });
    expect(ops).not.toContain('do-create');
    expect(quota.get(`${ipHash}|${day}`)).toBe(100);
  });

  it('retries a unique id collision and still returns 201 once', async () => {
    const { env, found, ops } = harness({ conflictOnce: true });
    const created = await handleFetch(postMatch('203.0.113.81'), env);
    expect(created.status).toBe(201);
    expect(ops.filter((op) => op === 'd1-insert')).toHaveLength(1);
    expect(ops.filter((op) => op === 'do-create')).toHaveLength(1);
    expect(ops).not.toContain('do-discard');
    expect(found.size).toBe(1);
  });

  it('reconnects only joined devices, and only when the host confirms inside the hour', async () => {
    const joined = 'a'.repeat(64);
    const outsider = 'b'.repeat(64);
    const { env, ops, calls } = harness({
      roomInfo: {
        lastChangeAt: Date.now(),
        joinedHashes: [joined],
        invites: [
          { tokenHash: joined, host: false, deviceId: 'd11111111' },
          { tokenHash: outsider, host: false, deviceId: 'd22222222' },
        ],
      },
    });
    const previousResponse = await handleFetch(postMatch('203.0.113.91'), env);
    const previous = (await previousResponse.json()) as { hostToken: string };
    const nextResponse = await handleFetch(postMatch('203.0.113.92'), env);
    const next = (await nextResponse.json()) as { matchId: string; hostToken: string };
    expect(nextResponse.status).toBe(201);

    const invite = await handleFetch(
      new Request(`https://padel.example/matches/${next.matchId}/invites`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${next.hostToken}`,
          'content-type': 'application/json',
          'cf-connecting-ip': '203.0.113.93',
        },
        body: JSON.stringify({ role: 'player' }),
      }),
      env,
    );
    const player = (await invite.json()) as { token: string };
    const denied = await handleFetch(
      carryRequest(next.matchId, player.token, previous.hostToken, true, '203.0.113.93'),
      env,
    );
    expect(denied.status).toBe(401);
    expect(ops).not.toContain('do-carry');

    const declined = await handleFetch(
      carryRequest(next.matchId, next.hostToken, previous.hostToken, false, '203.0.113.94'),
      env,
    );
    expect(declined.status).toBe(200);
    expect(await declined.json()).toMatchObject({ carried: 0, offered: true });
    expect(ops).not.toContain('do-carry');
    expect(ops).not.toContain('do-notify');

    const accepted = await handleFetch(
      carryRequest(next.matchId, next.hostToken, previous.hostToken, true, '203.0.113.95'),
      env,
    );
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ carried: 1, offered: true });
    const notify = calls
      .map((call) => {
        try {
          return JSON.parse(call.body) as { offers?: { deviceId?: string }[] };
        } catch {
          return null;
        }
      })
      .find((body) => Array.isArray(body?.offers));
    expect(notify?.offers?.map((offer) => offer.deviceId)).toEqual(['d11111111']);
  });

  it('does not invite anyone when the previous match is older than an hour', async () => {
    const { env, ops } = harness({
      roomInfo: {
        lastChangeAt: Date.now() - 2 * 60 * 60 * 1000,
        joinedHashes: ['a'.repeat(64)],
        invites: [{ tokenHash: 'a'.repeat(64), host: false, deviceId: 'd11111111' }],
      },
    });
    const previousResponse = await handleFetch(postMatch('203.0.113.96'), env);
    const previous = (await previousResponse.json()) as { hostToken: string };
    const nextResponse = await handleFetch(postMatch('203.0.113.97'), env);
    const next = (await nextResponse.json()) as { matchId: string; hostToken: string };
    const stale = await handleFetch(
      carryRequest(next.matchId, next.hostToken, previous.hostToken, true, '203.0.113.98'),
      env,
    );
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { error: string }).error).toBe('reconnect_unavailable');
    expect(ops).not.toContain('do-carry');
    expect(ops).not.toContain('do-notify');
  });

  it('names the dev worker apart from production and looks up the ticket before get', () => {
    const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
    expect(toml).toMatch(/\[env\.dev\]\s+name = "padel-counter-dev"/);
    expect(toml).toContain('[env.production.triggers]');
    expect(toml).toContain('[env.staging.triggers]');
    expect(toml).not.toContain('[env.dev.triggers]');
    expect(toml).toContain('17 3 * * *');
    const source = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');
    const socket = source.slice(source.indexOf('async function openSocket'));
    expect(socket.indexOf('takeTicket')).toBeGreaterThan(-1);
    expect(socket.indexOf('takeTicket')).toBeLessThan(socket.indexOf('idFromName'));
    expect(socket.indexOf('.find(')).toBeGreaterThan(-1);
    expect(socket.indexOf('.find(')).toBeLessThan(socket.indexOf('idFromName'));
    const create = source.slice(source.indexOf('async function createMatch'), source.indexOf('async function reconnectOffer'));
    expect(create.indexOf('.insert(')).toBeGreaterThan(-1);
    expect(create.indexOf('.insert(')).toBeLessThan(create.indexOf('/create'));
    expect(create).toContain('discardMatch');
    expect(create).toContain('takeCreateQuota');
    expect(create).toContain('quotaMac');
    expect(source).toContain('takeJoinDevice');
    expect(source).toContain('noteJoinFailure');
    const gate = source.slice(source.indexOf('async function enforceMatchRouteLimit'), source.indexOf('async function createMatch'));
    expect(gate.indexOf('limiter.limit')).toBeGreaterThan(-1);
    expect(gate.indexOf('limiter.limit')).toBeLessThan(gate.indexOf('takeMatchRoute'));
    const fetchFn = source.slice(source.indexOf('export async function handleFetch'), source.indexOf('const CREATE_ATTEMPTS'));
    expect(fetchFn.indexOf('enforceMatchRouteLimit')).toBeGreaterThan(-1);
    expect(fetchFn.indexOf('enforceMatchRouteLimit')).toBeLessThan(fetchFn.indexOf('mintTicket'));
    const ticket = source.slice(source.indexOf('async function mintTicket'), source.indexOf('async function openSocket'));
    expect(ticket.indexOf('findCredential')).toBeLessThan(ticket.indexOf('noteJoinFailure'));
    expect(ticket.indexOf('findCredential')).toBeLessThan(ticket.indexOf('takeJoinDevice'));
    expect(ticket.indexOf('index.find(')).toBeLessThan(ticket.indexOf('noteJoinFailure'));
    expect(ticket.indexOf('takeJoinFailure')).toBeLessThan(ticket.indexOf('noteJoinFailure'));
    expect(ticket).toContain('invalid_device');
    expect(toml).toContain('[[ratelimits]]');
    expect(toml).toContain('name = "REQUEST_LIMIT"');
    expect(toml).toContain('namespace_id = "1001"');
    expect(toml).toContain('namespace_id = "1002"');
    expect(toml).toContain('namespace_id = "1003"');
    expect(toml).toContain('[[env.dev.ratelimits]]');
    expect(toml).toContain('[[env.staging.ratelimits]]');
    expect(toml).toContain('[[env.production.ratelimits]]');
    expect(toml).toContain('limit = 30');
    expect(toml).toContain('period = 60');
    const room = readFileSync(new URL('./match-room.ts', import.meta.url), 'utf8');
    expect(room).toContain("pathname === '/discard'");
    expect(room).toContain('deleteAll');
    expect(room).toContain("pathname === '/carry-invite'");
    expect(room).toContain("pathname === '/notify'");
    expect(room).toContain('chooseActor');
    expect(room).toContain('touchMatchActivity');
    expect(room).toContain('transactionSync');
    expect(room).not.toContain("exec('BEGIN')");
    expect(room).not.toContain("exec('COMMIT')");
    expect(room).not.toContain("exec('ROLLBACK')");
    expect(room).toContain('serverLastChange');
    const headers = clientIpHeaders(
      new Request('https://padel.example/matches/x/ws', {
        headers: { 'cf-connecting-ip': '198.51.100.8', [CLIENT_IP_HEADER]: 'spoofed' },
      }),
    );
    expect(headers.get(CLIENT_IP_HEADER)).toBe('198.51.100.8');
  });

  it('refuses a create when the quota secret or the device id is missing', async () => {
    const missingKey = harness({ omitQuotaKey: true });
    const refused = await handleFetch(postMatch('198.51.100.41'), missingKey.env);
    expect(refused.status).toBe(503);
    expect(missingKey.ops).not.toContain('do-create');
    const { env, ops } = harness();
    const badDevice = await handleFetch(postMatch('198.51.100.42', { device: 'phone' }), env);
    expect(badDevice.status).toBe(400);
    expect(ops).not.toContain('do-create');
  });

  it('consumes a websocket ticket once with a single delete', async () => {
    const { env, calls } = harness();
    const created = await handleFetch(postMatch('198.51.100.21', undefined, 'd00000021'), env);
    const body = (await created.json()) as { hostToken: string };
    const joined = await handleFetch(joinRequest('198.51.100.22', body.hostToken), env);
    expect(joined.status).toBe(201);
    const ticket = ((await joined.json()) as { ticket: string }).ticket;
    const opened = await handleFetch(
      new Request(`https://padel.example/ws/${ticket}`, {
        headers: { upgrade: 'websocket', origin: PAGES, 'cf-connecting-ip': '198.51.100.23' },
      }),
      env,
    );
    expect(opened.status).not.toBe(401);
    expect(calls.some((call) => call.id.length > 0)).toBe(true);
    const again = await handleFetch(
      new Request(`https://padel.example/ws/${ticket}`, {
        headers: { upgrade: 'websocket', origin: PAGES, 'cf-connecting-ip': '198.51.100.24' },
      }),
      env,
    );
    expect(again.status).toBe(401);
  });

  it('keeps one player credential when a second invite insert fails', async () => {
    const { env, creds, ops } = harness({ failPlayerInsert: true });
    const created = await handleFetch(postMatch('198.51.100.31', undefined, 'd00000031'), env);
    const body = (await created.json()) as { matchId: string; hostToken: string };
    const first = await handleFetch(
      new Request(`https://padel.example/matches/${body.matchId}/invites`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${body.hostToken}`,
          'content-type': 'application/json',
          'cf-connecting-ip': '198.51.100.32',
        },
        body: JSON.stringify({ role: 'player' }),
      }),
      env,
    );
    expect(first.status).toBe(201);
    const active = () => [...creds.values()].filter((row) => row.host === 0 && row.revokedAt === null);
    expect(active()).toHaveLength(1);
    const second = await handleFetch(
      new Request(`https://padel.example/matches/${body.matchId}/invites`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${body.hostToken}`,
          'content-type': 'application/json',
          'cf-connecting-ip': '198.51.100.33',
        },
        body: JSON.stringify({ role: 'player' }),
      }),
      env,
    );
    expect(second.status).toBe(500);
    expect(active()).toHaveLength(1);
    expect(ops.filter((op) => op === 'd1-batch').length).toBeGreaterThanOrEqual(2);
  });
});
