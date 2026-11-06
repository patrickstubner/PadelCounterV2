import { LIVE_PROTOCOL, assignMatchId, createMatch, matchReducer, parseMatchLog, replayScore, scoreClaimFor, type MatchEvent, type MatchState } from '@padel/core';
import { runInDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './tokens';

const ORIGIN = 'https://patrickstubner.github.io';
const T0 = 1_700_000_000_000;

let ipCount = 210;
let deviceN = 0x2b00;

function dev(): string {
  deviceN += 1;
  return `d${deviceN.toString(16).padStart(8, '0')}${'0'.repeat(24)}`;
}

function call(path: string, init: RequestInit = {}): Promise<Response> {
  ipCount += 1;
  const headers = new Headers(init.headers);
  headers.set('origin', ORIGIN);
  headers.set('cf-connecting-ip', `203.0.113.${ipCount}`);
  return exports.default.fetch(new Request(`https://padel.example${path}`, { ...init, headers }));
}

interface Inbox {
  all(): Record<string, unknown>[];
  waitFor(match: (message: Record<string, unknown>) => boolean): Promise<Record<string, unknown>>;
}

function inbox(ws: WebSocket): Inbox {
  const messages: Record<string, unknown>[] = [];
  let notify = (): void => {};
  ws.addEventListener('message', (event: MessageEvent) => {
    messages.push(JSON.parse(String(event.data)) as Record<string, unknown>);
    notify();
  });
  return {
    all: () => messages.slice(),
    waitFor(match) {
      const start = Date.now();
      return new Promise((resolve, reject) => {
        const check = (): void => {
          const found = messages.find(match);
          if (found) {
            resolve(found);
            return;
          }
          if (Date.now() - start > 3_000) {
            reject(new Error(`no matching socket message in ${JSON.stringify(messages)}`));
            return;
          }
          notify = () => check();
          setTimeout(check, 20);
        };
        check();
      });
    },
  };
}

async function postMatch(device: string): Promise<{ matchId: string; hostToken: string }> {
  const response = await call('/matches', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ device, log: { schemaVersion: 2, base: createMatch(T0), events: [] } }),
  });
  expect(response.status, await response.clone().text()).toBe(201);
  return (await response.json()) as { matchId: string; hostToken: string };
}

async function issueCode(matchId: string, token: string): Promise<{ token: string; code: string }> {
  const response = await call(`/matches/${matchId}/invites`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ role: 'player' }),
  });
  expect(response.status, await response.clone().text()).toBe(201);
  const body = (await response.json()) as { token?: string; code?: string };
  if (!body.token || !body.code) throw new Error('invite did not return a code');
  return { token: body.token, code: body.code };
}

function redeem(code: string): Promise<Response> {
  return call('/join', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ device: dev(), code }),
  });
}

/**
 * A room created with `newUniqueId` has no `ctx.id.name`.
 * The log's replay id is the D1 id, which create stores in meta.
 */
async function namelessRoom(matchId: string, hostToken: string): Promise<DurableObjectStub> {
  const stub = env.MATCH_ROOMS.get(env.MATCH_ROOMS.newUniqueId());
  const log = assignMatchId({ schemaVersion: 2, base: createMatch(T0), events: [] }, matchId);
  expect(log).not.toBeNull();
  const response = await stub.fetch('https://match.internal/create', {
    method: 'POST',
    body: JSON.stringify({ log, hostToken }),
  });
  expect(response.status, await response.clone().text()).toBe(201);
  return stub;
}

async function objectName(stub: DurableObjectStub): Promise<string | undefined> {
  const name = await runInDurableObject(stub, (instance) => {
    const ctx = (instance as unknown as { ctx: { id: { name?: string } } }).ctx;
    return ctx.id.name;
  });
  return typeof name === 'string' ? name : undefined;
}

async function roomMeta(stub: DurableObjectStub): Promise<{ matchId: string; touch: number; ends: number }> {
  return runInDurableObject(stub, (_instance, state) => {
    const row = state.storage.sql.exec('SELECT match_id, activity_touch FROM meta WHERE id = 1').toArray()[0];
    const ends = state.storage.sql.exec('SELECT payload FROM events').toArray()
      .filter((item) => String(item.payload).includes('"match/end"')).length;
    return {
      matchId: typeof row?.match_id === 'string' ? row.match_id : '',
      touch: typeof row?.activity_touch === 'number' ? row.activity_touch : -1,
      ends,
    };
  });
}

async function setRoom(stub: DurableObjectStub, matchStored: string | null, touch: number): Promise<void> {
  await runInDurableObject(stub, (_instance, state) => {
    state.storage.sql.exec('UPDATE meta SET match_id = ?, activity_touch = ? WHERE id = 1', matchStored, touch);
  });
}

async function activityOf(matchId: string): Promise<number> {
  const row = await env.DB.prepare('SELECT last_activity FROM matches WHERE id = ?').bind(matchId).first();
  const value = row?.last_activity;
  if (typeof value !== 'number') throw new Error('missing last_activity');
  return value;
}

function boardOf(snapshot: Record<string, unknown>): MatchState {
  const parsed = parseMatchLog(snapshot.log);
  if (!parsed) throw new Error('snapshot log');
  return replayScore(parsed.base, parsed.events);
}

function send(ws: WebSocket, state: MatchState, event: MatchEvent): MatchState {
  const claim = scoreClaimFor(state, event);
  ws.send(JSON.stringify({
    type: 'event',
    eventId: crypto.randomUUID(),
    event,
    ...(claim ? { claim } : {}),
  }));
  return matchReducer(state, event);
}

async function connectDirect(
  stub: DurableObjectStub,
  token: string,
  device: string,
): Promise<{ ws: WebSocket; messages: Inbox }> {
  ipCount += 1;
  const response = await stub.fetch('https://match.internal/socket', {
    headers: { upgrade: 'websocket', 'x-padel-client-ip': `198.51.100.${ipCount}` },
  });
  const ws = response.webSocket;
  if (!ws) throw new Error(`direct upgrade failed: ${response.status} ${await response.text()}`);
  ws.accept();
  const messages = inbox(ws);
  ws.send(JSON.stringify({ type: 'hello', protocol: LIVE_PROTOCOL, token, device, clientNow: Date.now() }));
  const snapshot = await messages.waitFor((message) => message.type === 'snapshot' || message.type === 'error');
  expect(snapshot.type).toBe('snapshot');
  return { ws, messages };
}

async function increments(messages: Inbox, count: number): Promise<Record<string, unknown>> {
  const start = Date.now();
  for (;;) {
    const found = messages.all().filter((message) => (
      message.type === 'event' && (message.event as { type?: string }).type === 'game/increment'
    ));
    const picked = found[count - 1];
    if (picked) return picked;
    if (Date.now() - start > 3_000) {
      throw new Error(`wanted ${count} points, saw ${JSON.stringify(messages.all())}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function failActivityWrite(): () => void {
  const db = env.DB as unknown as { prepare: (query: string) => { bind: (...values: unknown[]) => unknown } };
  const original = db.prepare;
  db.prepare = (query: string) => {
    if (query.includes('SET last_activity')) throw new Error('activity down');
    return original.call(db, query);
  };
  return () => {
    db.prepare = original;
  };
}

async function guestRevoked(matchId: string): Promise<unknown> {
  const start = Date.now();
  for (;;) {
    const row = await env.DB.prepare(
      'SELECT revoked_at FROM credentials WHERE match_id = ? AND host = 0',
    ).bind(matchId).first();
    if (typeof row?.revoked_at === 'number') return row.revoked_at;
    if (Date.now() - start > 3_000) return row?.revoked_at ?? null;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('stored room id', () => {
  it('stores the replay id when the object has no name', async () => {
    const created = await postMatch(dev());
    const stub = await namelessRoom(created.matchId, created.hostToken);
    expect(await objectName(stub)).toBeUndefined();
    expect((await roomMeta(stub)).matchId).toBe(created.matchId);
  });

  it('revokes a kick and a leave from the stored id when the object name is missing', async () => {
    const hostDevice = dev();
    const guestDevice = dev();
    const created = await postMatch(hostDevice);
    const stub = await namelessRoom(created.matchId, created.hostToken);
    expect(await objectName(stub)).toBeUndefined();
    await setRoom(stub, created.matchId.toUpperCase(), 1);
    const guestToken = 'bbbbbbbbbbbbbbbbbbbbbb';
    const guestHash = await sha256Hex(guestToken);
    const expiresAt = Date.now() + 3_600_000;
    await runInDurableObject(stub, (_instance, state) => {
      const now = Date.now();
      state.storage.sql.exec(
        'INSERT INTO invites (token_hash, role, host, expires_at, revoked_at, device_id, minted_at) VALUES (?, ?, 0, ?, NULL, ?, 0)',
        guestHash,
        'player',
        expiresAt,
        guestDevice,
      );
      state.storage.sql.exec(
        'INSERT INTO roster (device_id, seat, kind, since, seen, online) VALUES (?, ?, ?, ?, ?, 1)',
        guestDevice,
        'p2',
        'other',
        now,
        now,
      );
    });
    await env.DB.prepare(
      'INSERT INTO credentials (token_hash, match_id, host, expires_at, revoked_at, device_id) VALUES (?, ?, 0, ?, NULL, ?)',
    ).bind(guestHash, created.matchId, expiresAt, guestDevice).run();

    const host = await connectDirect(stub, created.hostToken, hostDevice);
    host.ws.send(JSON.stringify({ type: 'kick', seat: 'p2' }));
    expect(await guestRevoked(created.matchId)).toEqual(expect.any(Number));

    const leaving = await stub.fetch('https://match.internal/leave', {
      method: 'POST',
      body: JSON.stringify({ token: created.hostToken }),
    });
    expect(leaving.status).toBe(200);
    expect(await leaving.json()).toEqual({ revoked: true });
    const again = await call('/join', {
      method: 'POST',
      headers: { authorization: `Bearer ${created.hostToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ device: hostDevice }),
    });
    expect(again.status).toBe(401);
  });

  it('ends the match from a stored uppercase id and does not answer unavailable', async () => {
    const hostDevice = dev();
    const created = await postMatch(hostDevice);
    const shared = await issueCode(created.matchId, created.hostToken);
    const stub = await namelessRoom(created.matchId, created.hostToken);
    expect(await objectName(stub)).toBeUndefined();
    await setRoom(stub, created.matchId.toUpperCase(), 1);
    const host = await connectDirect(stub, created.hostToken, hostDevice);
    const snap = await host.messages.waitFor((message) => message.type === 'snapshot');
    send(host.ws, boardOf(snap), { type: 'match/end', at: Date.now(), by: 'host' });
    const ended = await host.messages.waitFor((message) => (
      (message.type === 'event' && (message.event as { type?: string }).type === 'match/end')
      || (message.type === 'error' && message.code === 'unavailable')
    ));
    expect(ended.type).toBe('event');
    expect((await roomMeta(stub)).matchId).toBe(created.matchId);
    expect((await redeem(shared.code)).status).toBe(401);
  });

  it('does not store End match when no room id can be resolved, then revokes on the retry', async () => {
    const hostDevice = dev();
    const created = await postMatch(hostDevice);
    const shared = await issueCode(created.matchId, created.hostToken);
    const stub = await namelessRoom(created.matchId, created.hostToken);
    expect(await objectName(stub)).toBeUndefined();
    await setRoom(stub, null, 1);
    const host = await connectDirect(stub, created.hostToken, hostDevice);
    const snap = await host.messages.waitFor((message) => message.type === 'snapshot');
    const state = boardOf(snap);
    send(host.ws, state, { type: 'match/end', at: Date.now(), by: 'host' });
    const refused = await host.messages.waitFor((message) => message.type === 'error' || message.type === 'event');
    expect(refused).toMatchObject({ type: 'error', code: 'unavailable' });
    expect((await roomMeta(stub)).ends).toBe(0);
    expect((await redeem(shared.code)).status).toBe(201);

    await setRoom(stub, created.matchId, 1);
    const again = await connectDirect(stub, created.hostToken, hostDevice);
    const opened = await again.messages.waitFor((message) => message.type === 'snapshot');
    send(again.ws, boardOf(opened), { type: 'match/end', at: Date.now(), by: 'host' });
    const ended = await again.messages.waitFor((message) => (
      message.type === 'event' && (message.event as { type?: string }).type === 'match/end'
    ));
    expect(ended.type).toBe('event');
    expect((await roomMeta(stub)).ends).toBe(1);
    expect((await redeem(shared.code)).status).toBe(401);
  });

  it('restores the activity marker when D1 rejects the touch so the next point retries', async () => {
    const hostDevice = dev();
    const created = await postMatch(hostDevice);
    const stub = env.MATCH_ROOMS.get(env.MATCH_ROOMS.idFromName(created.matchId));
    await setRoom(stub, created.matchId, 1);
    await env.DB.prepare('UPDATE matches SET last_activity = 1 WHERE id = ?').bind(created.matchId).run();
    const host = await connectDirect(stub, created.hostToken, hostDevice);
    const snap = await host.messages.waitFor((message) => message.type === 'snapshot');
    let state = boardOf(snap);
    const restore = failActivityWrite();
    try {
      state = send(host.ws, state, { type: 'game/increment', team: 'a', at: Date.now() });
      await increments(host.messages, 1);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect((await roomMeta(stub)).touch).toBe(1);
      expect(await activityOf(created.matchId)).toBe(1);
    } finally {
      restore();
    }
    send(host.ws, state, { type: 'game/increment', team: 'a', at: Date.now() });
    const played = await increments(host.messages, 2);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await activityOf(created.matchId)).toBe((played.event as { at?: unknown }).at);
  });

  it('restores the activity marker when the room id is missing so a later point can touch', async () => {
    const hostDevice = dev();
    const created = await postMatch(hostDevice);
    const stub = await namelessRoom(created.matchId, created.hostToken);
    expect(await objectName(stub)).toBeUndefined();
    await setRoom(stub, null, 1);
    await env.DB.prepare('UPDATE matches SET last_activity = 1 WHERE id = ?').bind(created.matchId).run();
    const host = await connectDirect(stub, created.hostToken, hostDevice);
    const snap = await host.messages.waitFor((message) => message.type === 'snapshot');
    let state = boardOf(snap);
    state = send(host.ws, state, { type: 'game/increment', team: 'a', at: Date.now() });
    await increments(host.messages, 1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await roomMeta(stub)).touch).toBe(1);
    expect(await activityOf(created.matchId)).toBe(1);

    await setRoom(stub, created.matchId, 1);
    send(host.ws, state, { type: 'game/increment', team: 'a', at: Date.now() });
    const played = await increments(host.messages, 2);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await activityOf(created.matchId)).toBe((played.event as { at?: unknown }).at);
  });
});
