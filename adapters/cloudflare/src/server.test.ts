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

function harness(options?: { failCreate?: boolean | 'throw' }): {
  env: ServerEnv;
  found: Set<string>;
  calls: { id: string; body: string; ip: string | null }[];
  ops: string[];
} {
  const found = new Set<string>();
  const calls: { id: string; body: string; ip: string | null }[] = [];
  const ops: string[] = [];
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
            const id = statement.values[0];
            return typeof id === 'string' && found.has(id) ? { id } : null;
          },
          async run() {
            const id = statement.values[0];
            const sql = statement.query.trim().toUpperCase();
            if (sql.startsWith('INSERT') && typeof id === 'string') {
              found.add(id);
              ops.push('d1-insert');
            } else if (sql.startsWith('DELETE') && typeof id === 'string') {
              found.delete(id);
              ops.push('d1-delete');
            }
            return { success: true };
          },
        };
        return statement;
      },
    },
  };
  return { env, found, calls, ops };
}

function postMatch(ip: string): Request {
  return new Request('https://padel.example/matches', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
    body: JSON.stringify({ log: courtLog() }),
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

  it('forwards a socket only after the index hit and replaces a spoofed address', async () => {
    const { env, calls } = harness();
    const created = await handleFetch(postMatch('203.0.113.31'), env);
    const body = (await created.json()) as { matchId: string };
    const socket = await handleFetch(
      new Request(`https://padel.example/matches/${body.matchId}/ws`, {
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
  });

  it('stops the 21st /matches request before a durable object is created', async () => {
    const { env, calls } = harness();
    for (let i = 0; i < 20; i += 1) {
      const response = await handleFetch(postMatch('203.0.113.41'), env);
      expect(response.status).toBe(201);
    }
    const blocked = await handleFetch(postMatch('203.0.113.41'), env);
    expect(blocked.status).toBe(429);
    expect(calls).toHaveLength(20);
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

  it('names the dev worker apart from production and looks up the index before get', () => {
    const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
    expect(toml).toMatch(/\[env\.dev\]\s+name = "padel-counter-dev"/);
    const source = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');
    const socket = source.slice(source.indexOf('async function openSocket'));
    expect(socket.indexOf('.find(')).toBeGreaterThan(-1);
    expect(socket.indexOf('.find(')).toBeLessThan(socket.indexOf('idFromName'));
    const create = source.slice(source.indexOf('async function createMatch'), source.indexOf('async function createInvite'));
    expect(create.indexOf('.insert(')).toBeGreaterThan(-1);
    expect(create.indexOf('.insert(')).toBeLessThan(create.indexOf('/create'));
    expect(create).toContain('discardMatch');
    const room = readFileSync(new URL('./match-room.ts', import.meta.url), 'utf8');
    expect(room).toContain("pathname === '/discard'");
    expect(room).toContain('deleteAll');
    const headers = clientIpHeaders(
      new Request('https://padel.example/matches/x/ws', {
        headers: { 'cf-connecting-ip': '198.51.100.8', [CLIENT_IP_HEADER]: 'spoofed' },
      }),
    );
    expect(headers.get(CLIENT_IP_HEADER)).toBe('198.51.100.8');
  });
});
