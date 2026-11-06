import { LIVE_PROTOCOL, ROOM_MESSAGES, createMatch, matchReducer, parseMatchLog, replayScore, scoreClaimFor, type MatchEvent, type MatchLog, type MatchState, type TeamId } from '@padel/core';
import { runInDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const ORIGIN = 'https://patrickstubner.github.io';
const T0 = 1_700_000_000_000;
const NEUTRAL = { error: 'join_code', message: ROOM_MESSAGES.join_code };

let ipCount = 160;
let deviceN = 0x2a10;

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

function seeded(sides: readonly TeamId[]): MatchLog {
  const base = createMatch(T0);
  const events: MatchEvent[] = [];
  for (const team of sides) {
    events.push({ type: 'game/increment', team, at: T0 + events.length + 1 });
  }
  return { schemaVersion: 2, base, events };
}

async function postMatch(device: string, log: MatchLog, previousHostToken?: string): Promise<{ matchId: string; hostToken: string }> {
  const response = await call('/matches', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      device,
      log,
      ...(previousHostToken ? { previousHostToken, carry: true } : {}),
    }),
  });
  expect(response.status, await response.clone().text()).toBe(201);
  return (await response.json()) as { matchId: string; hostToken: string };
}

async function issueCode(matchId: string, token: string, rotate = false): Promise<{ token: string; code: string }> {
  const response = await call(`/matches/${matchId}/invites`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ role: 'player', ...(rotate ? { rotate: true } : {}) }),
  });
  expect(response.status, await response.clone().text()).toBe(201);
  const body = (await response.json()) as { token?: string; code?: string };
  if (!body.token || !body.code) throw new Error('invite did not return a code');
  return { token: body.token, code: body.code };
}

function redeem(code: string, device: string): Promise<Response> {
  return call('/join', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ device, code }),
  });
}

async function connect(token: string, device: string): Promise<{ ws: WebSocket; messages: Inbox }> {
  const ticket = await call('/join', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ device }),
  });
  expect(ticket.status, await ticket.clone().text()).toBe(201);
  const body = (await ticket.json()) as { ticket: string };
  const response = await call(`/ws/${body.ticket}`, { headers: { upgrade: 'websocket' } });
  const ws = response.webSocket;
  if (!ws) throw new Error(`websocket upgrade failed: ${response.status}`);
  ws.accept();
  const messages = inbox(ws);
  ws.send(JSON.stringify({ type: 'hello', protocol: LIVE_PROTOCOL, token, device, clientNow: Date.now() }));
  const snapshot = await messages.waitFor((message) => message.type === 'snapshot' || message.type === 'error');
  expect(snapshot.type).toBe('snapshot');
  return { ws, messages };
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

function chainFrom(log: MatchLog): MatchLog {
  const at = log.base.updatedAt + log.events.length + 10;
  const created: MatchEvent = { type: 'match/new', matchId: crypto.randomUUID(), at: at + 1, by: 'host' };
  return {
    schemaVersion: 2,
    base: log.base,
    events: [...log.events, { type: 'match/end', at, by: 'host' }, created],
  };
}

async function activityOf(matchId: string): Promise<number> {
  const row = await env.DB.prepare('SELECT last_activity FROM matches WHERE id = ?').bind(matchId).first();
  const value = row?.last_activity;
  if (typeof value !== 'number') throw new Error('missing last_activity');
  return value;
}

/** Match 2 is the production shape: snapshot log, then match/end and match/new, with the previous host token. */
async function carriedChain(): Promise<{
  firstId: string;
  secondId: string;
  secondToken: string;
  code: string;
  inviteToken: string;
}> {
  const hostDevice = dev();
  const guestDevice = dev();
  const first = await postMatch(hostDevice, seeded(['a']));
  const host = await connect(first.hostToken, hostDevice);
  const snap = await host.messages.waitFor((message) => message.type === 'snapshot');
  const parsed = parseMatchLog(snap.log);
  if (!parsed) throw new Error('snapshot log');
  expect(parsed.base.matchId).toBe(first.matchId);
  const shared = await issueCode(first.matchId, first.hostToken);
  const guest = await connect(shared.token, guestDevice);
  expect((await redeem(shared.code, dev())).status).toBe(201);
  send(host.ws, boardOf(snap), { type: 'match/end', at: Date.now(), by: 'host' });
  await host.messages.waitFor((message) => message.type === 'event' && (message.event as { type?: string }).type === 'match/end');
  await guest.messages.waitFor((message) => message.type === 'event' && (message.event as { type?: string }).type === 'match/end');
  const ended = await redeem(shared.code, dev());
  expect(ended.status).toBe(401);

  const second = await postMatch(dev(), chainFrom(parsed), first.hostToken);
  const carry = await call(`/matches/${second.matchId}/carry`, {
    method: 'POST',
    headers: { authorization: `Bearer ${second.hostToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ confirm: true, previousHostToken: first.hostToken }),
  });
  expect(carry.status, await carry.clone().text()).toBe(200);
  const nextCode = await issueCode(second.matchId, second.hostToken);
  return {
    firstId: first.matchId,
    secondId: second.matchId,
    secondToken: second.hostToken,
    code: nextCode.code,
    inviteToken: nextCode.token,
  };
}

describe('join code of a carried match chain', () => {
  it('rejects the code after End match and records activity on this room', async () => {
    const court = await carriedChain();
    const firstActivity = await activityOf(court.firstId);
    const stored = await runInDurableObject(env.MATCH_ROOMS.get(env.MATCH_ROOMS.idFromName(court.secondId)), (_instance, state) => {
      state.storage.sql.exec('UPDATE meta SET activity_touch = 1 WHERE id = 1');
      const row = state.storage.sql.exec('SELECT base_json, match_id FROM meta WHERE id = 1').toArray()[0];
      const base = JSON.parse(String(row?.base_json)) as { matchId?: unknown };
      return {
        baseId: typeof base.matchId === 'string' ? base.matchId : '',
        roomId: typeof row?.match_id === 'string' ? row.match_id : '',
      };
    });
    expect(stored.baseId).toBe(court.firstId);
    expect(stored.baseId).not.toBe(court.secondId);
    expect(stored.roomId).toBe(court.secondId);
    await env.DB.prepare('UPDATE matches SET last_activity = 1 WHERE id = ?').bind(court.secondId).run();

    expect((await redeem(court.code, dev())).status).toBe(201);
    const host = await connect(court.secondToken, dev());
    const snap = await host.messages.waitFor((message) => message.type === 'snapshot');
    const opened = parseMatchLog(snap.log);
    if (!opened) throw new Error('snapshot log');
    expect(opened.base.matchId).toBe(court.firstId);
    expect(replayScore(opened.base, opened.events).matchId).toBe(court.secondId);

    const state = boardOf(snap);
    send(host.ws, state, { type: 'game/increment', team: 'a', at: Date.now() });
    const played = await host.messages.waitFor((message) => message.type === 'event' && (message.event as { type?: string }).type === 'game/increment');
    const at = (played.event as { at?: unknown }).at;
    expect(at).toEqual(expect.any(Number));
    expect(await activityOf(court.secondId)).toBe(at);
    expect(await activityOf(court.firstId)).toBe(firstActivity);

    const afterPoint = matchReducer(state, { type: 'game/increment', team: 'a', at: typeof at === 'number' ? at : Date.now() });
    send(host.ws, afterPoint, { type: 'match/end', at: Date.now(), by: 'host' });
    await host.messages.waitFor((message) => message.type === 'event' && (message.event as { type?: string }).type === 'match/end');
    const code = await redeem(court.code, dev());
    expect(code.status).toBe(401);
    expect(await code.json()).toEqual(NEUTRAL);
    const invite = await call('/join', {
      method: 'POST',
      headers: { authorization: `Bearer ${court.inviteToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ device: dev() }),
    });
    expect(invite.status).toBe(401);
    expect(await activityOf(court.firstId)).toBe(firstActivity);
  });

  it('rejects the previous code when the chained match asks for a new code', async () => {
    const court = await carriedChain();
    expect((await redeem(court.code, dev())).status).toBe(201);
    const next = await issueCode(court.secondId, court.secondToken, true);
    expect(next.code).not.toBe(court.code);
    const oldCode = await redeem(court.code, dev());
    expect(oldCode.status).toBe(401);
    expect(await oldCode.json()).toEqual(NEUTRAL);
    const oldToken = await call('/join', {
      method: 'POST',
      headers: { authorization: `Bearer ${court.inviteToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ device: dev() }),
    });
    expect(oldToken.status).toBe(401);
    expect((await redeem(next.code, dev())).status).toBe(201);
  });

  it('revokes a repeated end only while the match is still ended', async () => {
    const hostDevice = dev();
    const created = await postMatch(hostDevice, seeded(['a']));
    const shared = await issueCode(created.matchId, created.hostToken);
    const host = await connect(created.hostToken, hostDevice);
    const snap = await host.messages.waitFor((message) => message.type === 'snapshot');
    const state = boardOf(snap);
    const eventId = crypto.randomUUID();
    const end = { type: 'match/end' as const, at: Date.now(), by: 'host' as const };
    const claim = scoreClaimFor(state, end);
    host.ws.send(JSON.stringify({ type: 'event', eventId, event: end, ...(claim ? { claim } : {}) }));
    await host.messages.waitFor((message) => message.type === 'event' && (message.event as { type?: string }).type === 'match/end');
    expect((await redeem(shared.code, dev())).status).toBe(401);

    await env.DB.prepare('UPDATE join_codes SET revoked_at = NULL WHERE match_id = ?').bind(created.matchId).run();
    await env.DB.prepare('UPDATE credentials SET revoked_at = NULL WHERE match_id = ? AND host = 0').bind(created.matchId).run();
    expect((await redeem(shared.code, dev())).status).toBe(201);

    host.ws.send(JSON.stringify({ type: 'event', eventId, event: end }));
    const repeated = await host.messages.waitFor((message) => message.type === 'event' && message.duplicate === true);
    expect((repeated.event as { type?: string }).type).toBe('match/end');
    expect((await redeem(shared.code, dev())).status).toBe(401);

    const resumed = matchReducer(state, end);
    send(host.ws, resumed, { type: 'match/resume', at: Date.now(), by: 'host' });
    await host.messages.waitFor((message) => message.type === 'event' && (message.event as { type?: string }).type === 'match/resume');
    const next = await issueCode(created.matchId, created.hostToken, true);
    expect((await redeem(next.code, dev())).status).toBe(201);
    const seen = host.messages.all().length;
    host.ws.send(JSON.stringify({ type: 'event', eventId, event: end }));
    const start = Date.now();
    for (;;) {
      const fresh = host.messages.all().slice(seen).some((message) => message.type === 'event' && message.duplicate === true);
      if (fresh) break;
      if (Date.now() - start > 3_000) throw new Error(`no duplicate end after resume in ${JSON.stringify(host.messages.all().slice(seen))}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect((await redeem(next.code, dev())).status).toBe(201);
  });

  it('keeps the code when the socket closes, and an anonymous leave does not revoke it', async () => {
    const court = await carriedChain();
    expect((await redeem(court.code, dev())).status).toBe(201);
    const host = await connect(court.secondToken, dev());
    host.ws.close();
    expect((await redeem(court.code, dev())).status).toBe(201);
    const leave = await call(`/matches/${court.secondId}/leave`, { method: 'POST' });
    const kick = await call(`/matches/${court.secondId}/kick`, { method: 'POST' });
    expect(leave.status).toBe(401);
    expect(kick.status).toBe(404);
    expect(await leave.json()).toMatchObject({ error: 'bad_token' });
    expect(await kick.json()).toEqual({ error: 'not_found' });
    expect((await redeem(court.code, dev())).status).toBe(201);
  });
});
