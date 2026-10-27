import { readFileSync } from 'node:fs';
import { createMatch } from '@padel/core';
import { describe, expect, it } from 'vitest';
import { CLIENT_IP_HEADER, clientIpHeaders } from './match-index';
import { handleFetch, type RoomNamespace, type ServerEnv } from './server';

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

function harness(options?: { failCreate?: boolean | 'throw'; conflictOnce?: boolean; roomInfo?: RoomInfo }): {
  env: ServerEnv;
  found: Set<string>;
  calls: { id: string; body: string; ip: string | null }[];
  ops: string[];
} {
  const found = new Set<string>();
  const calls: { id: string; body: string; ip: string | null }[] = [];
  const ops: string[] = [];
  const quota = new Map<string, number>();
  const creds = new Map<string, CredRow>();
  const tickets = new Map<string, TicketRow>();
  let conflictsLeft = options?.conflictOnce ? 1 : 0;
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
            const values = statement.values;
            if (sql.includes('FROM matches WHERE id')) {
              const id = values[0];
              return typeof id === 'string' && found.has(id) ? { id } : null;
            }
            if (sql.includes('FROM create_quota')) {
              const n = quota.get(`${values[0]}|${values[1]}`);
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
            } else if (sql.startsWith('INSERT INTO create_quota')) {
              const key = `${values[0]}|${values[1]}`;
              if (quota.has(key)) throw new Error('UNIQUE constraint failed');
              quota.set(key, 1);
            } else if (sql.includes('SET n = n + 1')) {
              const key = `${values[0]}|${values[1]}`;
              const limit = Number(values[2]);
              const current = quota.get(key);
              if (current !== undefined && current < limit) quota.set(key, current + 1);
              else changes = 0;
            } else if (sql.includes('SET n = n - 1')) {
              const key = `${values[0]}|${values[1]}`;
              const current = quota.get(key) ?? 0;
              if (current > 0) quota.set(key, current - 1);
              else changes = 0;
            } else if (sql.startsWith('INSERT INTO credentials')) {
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
            } else if (sql.startsWith('DELETE FROM tickets WHERE ticket_hash')) {
              tickets.delete(String(values[0]));
            } else if (sql.startsWith('DELETE FROM tickets WHERE match_id')) {
              for (const [hash, row] of tickets) {
                if (row.matchId === values[0]) tickets.delete(hash);
              }
            }
            return { success: true, meta: { changes } };
          },
        };
        return statement;
      },
    },
  };
  return { env, found, calls, ops };
}

function postMatch(ip: string, extra?: Record<string, unknown>): Request {
  return new Request('https://padel.example/matches', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
    body: JSON.stringify({ log: courtLog(), ...extra }),
  });
}

function joinRequest(ip: string, token: string): Request {
  return new Request('https://padel.example/join', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, origin: PAGES, 'cf-connecting-ip': ip },
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
    expect(ops).toEqual(['d1-insert', 'do-create']);

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

  it('writes the index first and drops the row and the room when create fails', async () => {
    const { env, found, calls, ops } = harness({ failCreate: true });
    const created = await handleFetch(postMatch('203.0.113.61'), env);
    expect(created.status).toBe(500);
    expect(ops[0]).toBe('d1-insert');
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
    expect(ops).toEqual(['d1-insert', 'do-create', 'd1-delete', 'do-discard']);
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

  it('allows ten creates a day for one address and an eleventh from another', async () => {
    const { env, ops } = harness();
    for (let i = 0; i < 10; i += 1) {
      const response = await handleFetch(postMatch('203.0.113.71'), env);
      expect(response.status).toBe(201);
    }
    const blocked = await handleFetch(postMatch('203.0.113.71'), env);
    expect(blocked.status).toBe(429);
    expect(((await blocked.json()) as { error: string }).error).toBe('daily_limit');
    expect(ops.filter((op) => op === 'do-create')).toHaveLength(10);
    const other = await handleFetch(postMatch('203.0.113.72'), env);
    expect(other.status).toBe(201);
    expect(ops.filter((op) => op === 'do-create')).toHaveLength(11);
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
    expect(create).toContain('takeQuota');
    const room = readFileSync(new URL('./match-room.ts', import.meta.url), 'utf8');
    expect(room).toContain("pathname === '/discard'");
    expect(room).toContain('deleteAll');
    expect(room).toContain("pathname === '/carry-invite'");
    expect(room).toContain("pathname === '/notify'");
    const headers = clientIpHeaders(
      new Request('https://padel.example/matches/x/ws', {
        headers: { 'cf-connecting-ip': '198.51.100.8', [CLIENT_IP_HEADER]: 'spoofed' },
      }),
    );
    expect(headers.get(CLIENT_IP_HEADER)).toBe('198.51.100.8');
  });
});
