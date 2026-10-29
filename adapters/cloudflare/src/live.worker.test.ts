import { CODE_ALARM_GLOBAL, CODE_ATTEMPTS_PER_PREFIX, LIVE_PROTOCOL, MAX_MINTED_TOKENS, ROOM_MESSAGES, createMatch, joinWindow, matchReducer, parseLiveTeamName, replayScore, scoreBoard, scoreClaimFor, type MatchEvent, type MatchState, type ScoreBoard, type ScoreClaim, type TeamId } from '@padel/core';
import { runInDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import { TEST_QUOTA_HMAC_KEY, quotaMac, sha256Hex } from './tokens';

const ORIGIN = 'https://patrickstubner.github.io';
const HOST_DEVICE = 'd11111111';
const PLAYER_DEVICE = 'd22222222';

let ipCount = 10;

function nextIp(): string {
  ipCount += 1;
  return `203.0.113.${ipCount}`;
}

function call(path: string, init: RequestInit = {}): Promise<Response> {
  return callFrom(nextIp(), path, init);
}

function callFrom(ip: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('origin', ORIGIN);
  headers.set('cf-connecting-ip', ip);
  return exports.default.fetch(new Request(`https://padel.example${path}`, { ...init, headers }));
}

const T0 = 1_700_000_000_000;

function seededMatch(teams: readonly TeamId[]): { state: MatchState; log: { schemaVersion: 2; base: MatchState; events: MatchEvent[] } } {
  const base = createMatch(T0);
  let state = base;
  const events: MatchEvent[] = [];
  for (const team of teams) {
    const event: MatchEvent = { type: 'game/increment', team, at: T0 + events.length + 1 };
    events.push(event);
    state = matchReducer(state, event);
  }
  return { state, log: { schemaVersion: 2, base, events } };
}

async function createLive(device: string, teams: readonly TeamId[] = []): Promise<{ matchId: string; hostToken: string; lastActivity: number; state: MatchState }> {
  const seeded = seededMatch(teams);
  const response = await call('/matches', {
    method: 'POST',
    body: JSON.stringify({
      device,
      log: seeded.log,
    }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { matchId: string; hostToken: string };
  const row = await env.DB.prepare('SELECT last_activity FROM matches WHERE id = ?').bind(body.matchId).first();
  const lastActivity = row?.last_activity;
  if (typeof lastActivity !== 'number') throw new Error('missing last_activity');
  return { matchId: body.matchId, hostToken: body.hostToken, lastActivity, state: seeded.state };
}

async function ticketFor(token: string, device: string): Promise<string> {
  const response = await call('/join', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ device }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { ticket: string };
  return body.ticket;
}

function inbox(ws: WebSocket): { waitFor(match: (message: Record<string, unknown>) => boolean): Promise<Record<string, unknown>>; all(): Record<string, unknown>[] } {
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
          notify = () => {
            check();
          };
          setTimeout(check, 20);
        };
        check();
      });
    },
  };
}

async function connect(token: string, device: string): Promise<{ ws: WebSocket; messages: ReturnType<typeof inbox> }> {
  const response = await call(`/ws/${await ticketFor(token, device)}`, { headers: { upgrade: 'websocket' } });
  const ws = response.webSocket;
  if (!ws) throw new Error(`websocket upgrade failed: ${response.status}`);
  ws.accept();
  const messages = inbox(ws);
  ws.send(JSON.stringify({ type: 'hello', protocol: LIVE_PROTOCOL, token, device, clientNow: Date.now() }));
  const snapshot = await messages.waitFor((message) => message.type === 'snapshot');
  expect(snapshot.protocol).toBe(LIVE_PROTOCOL);
  return { ws, messages };
}

function sendEvent(ws: WebSocket, state: MatchState, event: MatchEvent): MatchState {
  const claim = scoreClaimFor(state, event);
  ws.send(JSON.stringify({ type: 'event', eventId: crypto.randomUUID(), event, ...(claim ? { claim } : {}) }));
  return claim ? matchReducer(state, event) : state;
}

describe('live match in workerd', () => {
  it('syncs a point both ways without waiting for a batch', async () => {
    const created = await createLive('d44444444');
    const host = await connect(created.hostToken, 'd44444444');
    const invite = await call(`/matches/${created.matchId}/invites`, {
      method: 'POST',
      headers: { authorization: `Bearer ${created.hostToken}` },
      body: JSON.stringify({ role: 'player' }),
    });
    expect(invite.status).toBe(201);
    const invited = (await invite.json()) as { token: string };
    const player = await connect(invited.token, 'd55555555');

    const hostEvent = '00000000-0000-4000-8000-0000000000a1';
    const playerEvent = '00000000-0000-4000-8000-0000000000a2';
    const hostPoint: MatchEvent = { type: 'game/increment', team: 'a', at: 1_700_000_000_100 };
    const started = Date.now();
    host.ws.send(JSON.stringify({
      type: 'event',
      eventId: hostEvent,
      event: hostPoint,
      claim: scoreClaimFor(created.state, hostPoint),
    }));
    const onPlayer = await player.messages.waitFor((message) => message.type === 'event' && message.eventId === hostEvent);
    expect((onPlayer.event as { team?: string }).team).toBe('a');
    expect(onPlayer.duplicate).toBe(false);
    expect(Date.now() - started).toBeLessThan(500);

    const back = Date.now();
    const playerPoint: MatchEvent = { type: 'game/increment', team: 'b', at: 1_700_000_000_200 };
    player.ws.send(JSON.stringify({
      type: 'event',
      eventId: playerEvent,
      event: playerPoint,
      claim: scoreClaimFor(matchReducer(created.state, hostPoint), playerPoint),
    }));
    const onHost = await host.messages.waitFor((message) => message.type === 'event' && message.eventId === playerEvent);
    expect((onHost.event as { team?: string }).team).toBe('b');
    expect(onHost.duplicate).toBe(false);
    expect(Date.now() - back).toBeLessThan(500);
  });

  it('broadcasts a team rename, keeps the later name, and limits the rate', async () => {
    const created = await createLive('d77777777');
    const host = await connect(created.hostToken, 'd77777777');
    const invite = await call(`/matches/${created.matchId}/invites`, {
      method: 'POST',
      headers: { authorization: `Bearer ${created.hostToken}` },
      body: JSON.stringify({ role: 'player' }),
    });
    expect(invite.status).toBe(201);
    const invited = (await invite.json()) as { token: string };
    const player = await connect(invited.token, 'd88888888');
    const opened = await host.messages.waitFor((message) => message.type === 'snapshot' && message.names !== undefined);
    expect((opened.names as { A?: string }).A).toBe('Team A');

    const firstId = '00000000-0000-4000-8000-0000000000c1';
    host.ws.send(JSON.stringify({ type: 'team_renamed', eventId: firstId, team: 'A', name: '  Lobos  ' }));
    const seen = await player.messages.waitFor((message) => message.type === 'team_renamed' && message.eventId === firstId);
    expect(seen.team).toBe('A');
    expect(seen.name).toBe('Lobos');
    expect(typeof seen.seq).toBe('number');

    host.ws.send(JSON.stringify({
      type: 'team_renamed',
      eventId: '00000000-0000-4000-8000-0000000000c2',
      team: 'B',
      name: `N${'o'.repeat(24)}`,
    }));
    const refused = await host.messages.waitFor((message) => message.type === 'error' && message.code === 'not_applied');
    expect(refused.eventId).toBe('00000000-0000-4000-8000-0000000000c2');

    host.ws.send(JSON.stringify({
      type: 'team_renamed',
      eventId: '00000000-0000-4000-8000-0000000000c3',
      team: 'A',
      name: 'Lobos\n',
    }));
    await host.messages.waitFor((message) => message.type === 'error' && message.eventId === '00000000-0000-4000-8000-0000000000c3');

    const laterId = '00000000-0000-4000-8000-0000000000c4';
    player.ws.send(JSON.stringify({ type: 'team_renamed', eventId: laterId, team: 'a', name: 'Wolves' }));
    const later = await host.messages.waitFor((message) => message.type === 'team_renamed' && message.eventId === laterId);
    expect(later.name).toBe('Wolves');
    expect(later.seq as number).toBeGreaterThan(seen.seq as number);

    for (const name of ['One', 'Two', 'Three']) {
      host.ws.send(JSON.stringify({
        type: 'team_renamed',
        eventId: crypto.randomUUID(),
        team: 'B',
        name,
      }));
    }
    const limited = await host.messages.waitFor((message) => message.type === 'error' && message.code === 'slow_down');
    expect(limited.code).toBe('slow_down');

    host.ws.send(JSON.stringify({
      type: 'event',
      eventId: '00000000-0000-4000-8000-0000000000c9',
      event: { type: 'team/rename', team: 'a', name: 'Sneaky', at: 1 },
    }));
    const blocked = await host.messages.waitFor((message) => message.eventId === '00000000-0000-4000-8000-0000000000c9');
    expect(blocked.type).toBe('error');
    expect(blocked.code).toBe('not_applied');
  });

  it('keeps the later rename when two phones rename the same team', async () => {
    const created = await createLive('d99999999');
    const host = await connect(created.hostToken, 'd99999999');
    const invite = await call(`/matches/${created.matchId}/invites`, {
      method: 'POST',
      headers: { authorization: `Bearer ${created.hostToken}` },
      body: JSON.stringify({ role: 'player' }),
    });
    const invited = (await invite.json()) as { token: string };
    const player = await connect(invited.token, 'daaaaaaa1');
    const hostId = '00000000-0000-4000-8000-0000000000f1';
    const playerId = '00000000-0000-4000-8000-0000000000f2';
    host.ws.send(JSON.stringify({ type: 'team_renamed', eventId: hostId, team: 'A', name: 'HostName' }));
    player.ws.send(JSON.stringify({ type: 'team_renamed', eventId: playerId, team: 'A', name: 'PlayerName' }));
    const onHost = await host.messages.waitFor((message) => message.type === 'team_renamed' && message.eventId === playerId);
    const onPlayer = await player.messages.waitFor((message) => message.type === 'team_renamed' && message.eventId === hostId);
    expect(onHost.seq as number).toBeGreaterThan(onPlayer.seq as number);
    const again = await connect(created.hostToken, 'd99999999');
    const snap = await again.messages.waitFor((message) => message.type === 'snapshot' && (message.names as { A?: string } | undefined)?.A === 'PlayerName');
    expect((snap.names as { A?: string }).A).toBe('PlayerName');
    expect(snap.nameSeq as number).toBeGreaterThanOrEqual(onHost.seq as number);
  });

  it('returns the event id on a refusal and stores a mixed-case id once', async () => {
    const created = await createLive('d66666666');
    const host = await connect(created.hostToken, 'd66666666');
    const refusedId = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
    host.ws.send(JSON.stringify({
      type: 'event',
      eventId: refusedId,
      event: { type: 'game/decrement', team: 'a', at: 1_700_000_000_100 },
    }));
    const refused = await host.messages.waitFor((message) => message.type === 'error' && message.code === 'not_applied');
    expect(refused.eventId).toBe(refusedId.toLowerCase());

    const scoredId = 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB';
    const scoredEvent: MatchEvent = { type: 'game/increment', team: 'a', at: 1_700_000_000_200 };
    host.ws.send(JSON.stringify({
      type: 'event',
      eventId: scoredId,
      event: scoredEvent,
      claim: scoreClaimFor(created.state, scoredEvent),
    }));
    const scored = await host.messages.waitFor((message) => message.type === 'event' && message.eventId === scoredId.toLowerCase());
    expect(scored.duplicate).toBe(false);
    host.ws.send(JSON.stringify({
      type: 'event',
      eventId: scoredId.toLowerCase(),
      event: { type: 'game/increment', team: 'a', at: 1_700_000_000_300 },
    }));
    const again = await host.messages.waitFor((message) => message.type === 'event' && message.duplicate === true);
    expect(again.eventId).toBe(scoredId.toLowerCase());
  });

  it('creates, invites, joins, carries, and reopens without a SQL begin', async () => {
    const first = await createLive(HOST_DEVICE);
    const host = await connect(first.hostToken, HOST_DEVICE);
    const opened = await host.messages.waitFor((message) => message.type === 'snapshot');
    expect(opened.host).toBe(true);

    let state = first.state;
    state = sendEvent(host.ws, state, { type: 'game/increment', team: 'a', at: 1 });
    state = sendEvent(host.ws, state, { type: 'game/increment', team: 'a', at: 2 });
    await host.messages.waitFor((message) => message.type === 'event' && (message.event as { type?: string }).type === 'game/increment');
    const activity = await env.DB.prepare('SELECT last_activity FROM matches WHERE id = ?').bind(first.matchId).first();
    expect(activity?.last_activity).toBe(first.lastActivity);
    const touched = await runInDurableObject(env.MATCH_ROOMS.get(env.MATCH_ROOMS.idFromName(first.matchId)), (_instance, state) => {
      const row = state.storage.sql.exec('SELECT activity_touch FROM meta WHERE id = 1').toArray()[0];
      return row?.activity_touch;
    });
    expect(touched).toBeTypeOf('number');

    const invite = await call(`/matches/${first.matchId}/invites`, {
      method: 'POST',
      headers: { authorization: `Bearer ${first.hostToken}` },
      body: JSON.stringify({ role: 'player' }),
    });
    expect(invite.status).toBe(201);
    const invited = (await invite.json()) as { token: string; role: string };
    expect(invited.role).toBe('player');

    const player = await connect(invited.token, PLAYER_DEVICE);
    const joined = await player.messages.waitFor((message) => message.type === 'snapshot');
    expect(joined.host).toBe(false);
    expect(joined.role).toBe('player');

    state = sendEvent(host.ws, state, { type: 'match/end', at: 3 });
    const ended = await player.messages.waitFor(
      (message) => message.type === 'event' && (message.event as { type?: string }).type === 'match/end',
    );
    expect((ended.event as { by?: string }).by).toBe('host');

    sendEvent(host.ws, state, { type: 'match/resume', at: 5 });
    await player.messages.waitFor(
      (message) => message.type === 'event' && (message.event as { type?: string }).type === 'match/resume',
    );

    const second = await createLive(HOST_DEVICE);
    const carry = await call(`/matches/${second.matchId}/carry`, {
      method: 'POST',
      headers: { authorization: `Bearer ${second.hostToken}` },
      body: JSON.stringify({ confirm: true, previousHostToken: first.hostToken }),
    });
    expect(carry.status).toBe(200);
    expect(await carry.json()).toEqual({ carried: 1, offered: true });
    const offer = await player.messages.waitFor((message) => message.type === 'join_offer');
    expect(typeof offer.token).toBe('string');

    const carried = await connect(offer.token as string, PLAYER_DEVICE);
    const snapshot = await carried.messages.waitFor((message) => message.type === 'snapshot');
    expect(snapshot.host).toBe(false);
    expect(snapshot.role).toBe('player');
  });

  it('stores an HMAC of the client address on the socket, not the address', async () => {
    const created = await createLive('d33333333');
    const address = '198.51.100.77';
    const ticket = await ticketFor(created.hostToken, 'd33333333');
    const response = await exports.default.fetch(
      new Request(`https://padel.example/ws/${ticket}`, {
        headers: { upgrade: 'websocket', origin: ORIGIN, 'cf-connecting-ip': address },
      }),
    );
    const ws = response.webSocket;
    if (!ws) throw new Error(`websocket upgrade failed: ${response.status}`);
    ws.accept();
    const room = env.MATCH_ROOMS.get(env.MATCH_ROOMS.idFromName(created.matchId));
    const readIps = () =>
      runInDurableObject(room, (_instance, state) =>
        state.getWebSockets().map((socket) => {
          const attachment = socket.deserializeAttachment() as { ip?: unknown } | null;
          return typeof attachment?.ip === 'string' ? attachment.ip : '';
        }),
      );
    const expected = await quotaMac(TEST_QUOTA_HMAC_KEY, 'socket-ip', address, 'socket');
    const pending = await readIps();
    expect(pending).toContain(expected);
    expect(JSON.stringify(pending)).not.toContain(address);

    const messages = inbox(ws);
    ws.send(JSON.stringify({ type: 'hello', protocol: LIVE_PROTOCOL, token: created.hostToken, device: 'd33333333' }));
    await messages.waitFor((message) => message.type === 'snapshot');
    const admitted = await readIps();
    expect(admitted).toContain(expected);
    expect(JSON.stringify(admitted)).not.toContain(address);
    ws.close();
  });
});

const NEUTRAL = { error: 'join_code', message: ROOM_MESSAGES.join_code };

async function issuedCode(device: string): Promise<{ matchId: string; hostToken: string; token: string; code: string }> {
  const created = await createLive(device);
  const response = await call(`/matches/${created.matchId}/invites`, {
    method: 'POST',
    headers: { authorization: `Bearer ${created.hostToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ role: 'player' }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { token?: string; code?: string; matchId?: string };
  if (!body.token || !body.code) throw new Error('invite did not return a code');
  expect(body.matchId).toBe(created.matchId);
  return { matchId: created.matchId, hostToken: created.hostToken, token: body.token, code: body.code };
}

function redeem(code: string, device: string, ip?: string): Promise<Response> {
  const init: RequestInit = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ device, code }),
  };
  return ip ? callFrom(ip, '/join', init) : call('/join', init);
}

describe('short match codes', () => {
  it('mints a player token from the code and leaves the QR token working', async () => {
    const invited = await issuedCode('d12121212');
    expect(invited.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/);
    expect(invited.code).not.toMatch(/[01ILO]/);
    const typed = invited.code.toLowerCase().replace('-', '');
    const response = await redeem(typed, 'd23232323');
    expect(response.status).toBe(201);
    const body = (await response.json()) as { token?: string; ticket?: string; matchId?: string; code?: string };
    expect(body.matchId).toBeUndefined();
    expect(body.code).toBeUndefined();
    expect(typeof body.token).toBe('string');
    expect(typeof body.ticket).toBe('string');
    expect(JSON.stringify(body)).not.toContain(invited.code.replace('-', ''));
    const token = body.token ?? '';
    const opened = await call(`/ws/${body.ticket}`, { headers: { upgrade: 'websocket' } });
    const socket = opened.webSocket;
    if (!socket) throw new Error('socket missing');
    socket.accept();
    const messages = inbox(socket);
    socket.send(JSON.stringify({ type: 'hello', protocol: LIVE_PROTOCOL, token, device: 'd23232323' }));
    const snapshot = await messages.waitFor((message) => message.type === 'snapshot');
    expect(snapshot.protocol).toBe(LIVE_PROTOCOL);

    const wrongTicket = await ticketFor(token, 'd34343434');
    const wrong = await call(`/ws/${wrongTicket}`, { headers: { upgrade: 'websocket' } });
    const wrongSocket = wrong.webSocket;
    if (!wrongSocket) throw new Error('socket missing');
    wrongSocket.accept();
    const wrongMessages = inbox(wrongSocket);
    wrongSocket.send(JSON.stringify({ type: 'hello', protocol: LIVE_PROTOCOL, token, device: 'd34343434' }));
    const refused = await wrongMessages.waitFor((message) => message.type === 'error');
    expect(refused.code).toBe('bad_token');

    await connect(invited.token, 'd45454545');
  });

  it('uses one error for an unknown code and an expired code', async () => {
    const invited = await issuedCode('d56565656');
    const unknown = await redeem('ZZZZ-ZZZZ', 'd67676767');
    expect(unknown.status).toBe(401);
    expect(await unknown.json()).toEqual(NEUTRAL);
    await env.DB.prepare('UPDATE join_codes SET expires_at = ? WHERE match_id = ?').bind(1, invited.matchId).run();
    const expired = await redeem(invited.code, 'd78787878');
    expect(expired.status).toBe(401);
    expect(await expired.json()).toEqual(NEUTRAL);
    expect(JSON.stringify(await redeem('nope', 'd89898989').then((item) => item.json()))).not.toContain('nope');
  });

  it('revokes the code and the minted token when the host asks for a new code', async () => {
    const invited = await issuedCode('d9a9a9a9a');
    const first = await redeem(invited.code, 'dabababa1');
    const minted = (await first.json()) as { token: string };
    const again = await call(`/matches/${invited.matchId}/invites`, {
      method: 'POST',
      headers: { authorization: `Bearer ${invited.hostToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'player' }),
    });
    const next = (await again.json()) as { code: string; token: string };
    expect(next.code).not.toBe(invited.code);
    const oldCode = await redeem(invited.code, 'dcdcdcdc2');
    expect(oldCode.status).toBe(401);
    expect(await oldCode.json()).toEqual(NEUTRAL);
    const oldToken = await call('/join', {
      method: 'POST',
      headers: { authorization: `Bearer ${minted.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ device: 'dabababa1' }),
    });
    expect(oldToken.status).toBe(401);
    const fresh = await redeem(next.code, 'dcdcdcdc2');
    expect(fresh.status).toBe(201);
    const body = (await fresh.json()) as { token: string };
    await connect(body.token, 'dcdcdcdc2');
  });

  it('checks the address budget before the code, including a valid one, and shares an IPv6 /64', async () => {
    const invited = await issuedCode('d01010101');
    const prefix = '2001:db8:1:2::1';
    const samePrefix = '2001:db8:1:2::abcd';
    for (let n = 0; n < CODE_ATTEMPTS_PER_PREFIX; n += 1) {
      const response = await redeem('ZZZZ-ZZZZ', 'd01010101', prefix);
      expect(response.status).toBe(401);
    }
    const blocked = await redeem(invited.code, 'd01010101', samePrefix);
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: 'code_limited', message: ROOM_MESSAGES.code_limited });
    const other = await redeem(invited.code, 'd01010101', '2001:db8:9:9::1');
    expect(other.status).toBe(201);
  });

  it('does not let the global alarm lock out another address', async () => {
    const invited = await issuedCode('d02020202');
    for (let n = 0; n < 61; n += 1) {
      const response = await redeem('YYYY-YYYY', `d${(n + 32).toString(16).padStart(8, '0')}`);
      expect(response.status).toBe(401);
    }
    const kept = await redeem(invited.code, 'd03030303');
    expect(kept.status).toBe(201);
  });

  it('stores an HMAC of the code, reuses one token per device, and stops at eight', async () => {
    const invited = await issuedCode('d04040404');
    const compact = invited.code.replace('-', '');
    const row = await env.DB.prepare('SELECT code_hash FROM join_codes WHERE match_id = ?').bind(invited.matchId).first();
    const expected = await quotaMac(TEST_QUOTA_HMAC_KEY, 'join-code', compact, 'code');
    expect(row?.code_hash).toBe(expected);
    expect(row?.code_hash).not.toBe(await sha256Hex(compact));
    const first = await redeem(invited.code, 'd05050505');
    const firstBody = (await first.json()) as { token: string };
    const second = await redeem(invited.code, 'd05050505');
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as { token: string };
    expect(secondBody.token).not.toBe(firstBody.token);
    const active = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM credentials WHERE match_id = ? AND device_id = ? AND revoked_at IS NULL',
    ).bind(invited.matchId, 'd05050505').first();
    expect(active?.n).toBe(1);
    const stale = await call('/join', {
      method: 'POST',
      headers: { authorization: `Bearer ${firstBody.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ device: 'd05050505' }),
    });
    expect(stale.status).toBe(401);
    for (let n = 0; n < MAX_MINTED_TOKENS - 1; n += 1) {
      const device = `d${(n + 64).toString(16).padStart(8, '0')}`;
      const response = await redeem(invited.code, device);
      expect(response.status).toBe(201);
    }
    const extra = await redeem(invited.code, 'd0e0e0e0e');
    expect(extra.status).toBe(401);
    expect(await extra.json()).toEqual(NEUTRAL);
    const minted = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM credentials WHERE match_id = ? AND device_id IS NOT NULL AND revoked_at IS NULL',
    ).bind(invited.matchId).first();
    expect(minted?.n).toBe(MAX_MINTED_TOKENS);
  });

  it('keeps the token cap when many devices redeem at the same time', async () => {
    const invited = await issuedCode('dbb000001');
    const many = await Promise.all(Array.from({ length: 20 }, (_, n) => {
      const device = `d${(n + 1).toString(16).padStart(8, 'b')}`;
      return redeem(invited.code, device);
    }));
    const statuses = many.map((response) => response.status);
    expect(statuses.filter((status) => status === 201)).toHaveLength(MAX_MINTED_TOKENS);
    const minted = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM credentials WHERE match_id = ? AND device_id IS NOT NULL AND revoked_at IS NULL',
    ).bind(invited.matchId).first();
    expect(minted?.n).toBe(MAX_MINTED_TOKENS);
  });

  it('keeps one row when one device redeems many times at once', async () => {
    const invited = await issuedCode('dcc000001');
    const same = await Promise.all(Array.from({ length: 8 }, () => redeem(invited.code, 'dcccccccc')));
    expect(same.filter((response) => response.status === 201).length).toBeGreaterThan(0);
    const one = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM credentials WHERE match_id = ? AND device_id = ? AND revoked_at IS NULL',
    ).bind(invited.matchId, 'dcccccccc').first();
    expect(one?.n).toBe(1);
  });

  it('frees a code token when the court is full', async () => {
    const invited = await issuedCode('daa000001');
    await connect(invited.hostToken, 'daa000001');
    await connect(invited.token, 'daa000002');
    await connect(invited.token, 'daa000003');
    await connect(invited.token, 'daa000004');
    const redeemed = await redeem(invited.code, 'daa000005');
    expect(redeemed.status).toBe(201);
    const body = (await redeemed.json()) as { token: string; ticket: string };
    const response = await call(`/ws/${body.ticket}`, { headers: { upgrade: 'websocket' } });
    const ws = response.webSocket;
    if (!ws) throw new Error('socket missing');
    ws.accept();
    const messages = inbox(ws);
    ws.send(JSON.stringify({ type: 'hello', protocol: LIVE_PROTOCOL, token: body.token, device: 'daa000005' }));
    const refused = await messages.waitFor((message) => message.type === 'error');
    expect(refused.code).toBe('match_full');
    expect(ROOM_MESSAGES.match_full).toBe('This match is full.');
    const left = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM credentials WHERE match_id = ? AND device_id = ? AND revoked_at IS NULL',
    ).bind(invited.matchId, 'daa000005').first();
    expect(left?.n).toBe(0);
    const again = await redeem(invited.code, 'daa000006');
    expect(again.status).toBe(201);
  });

  it('admits a seated device again when the court is full', async () => {
    const invited = await issuedCode('dab000001');
    await connect(invited.hostToken, 'dab000001');
    const first = await redeem(invited.code, 'dab000002');
    expect(first.status).toBe(201);
    const body = (await first.json()) as { token: string };
    const seated = await connect(body.token, 'dab000002');
    const second = await redeem(invited.code, 'dab000003');
    const third = await redeem(invited.code, 'dab000004');
    expect(second.status).toBe(201);
    expect(third.status).toBe(201);
    await connect(((await second.json()) as { token: string }).token, 'dab000003');
    await connect(((await third.json()) as { token: string }).token, 'dab000004');
    const errors: string[] = [];
    seated.ws.addEventListener('message', (event: MessageEvent) => {
      const parsed = JSON.parse(String(event.data)) as { type?: string; code?: string };
      if (parsed.type === 'error' && parsed.code) errors.push(parsed.code);
    });
    const closed = new Promise<CloseEvent>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('old socket stayed open')), 3_000);
      seated.ws.addEventListener('close', (event: CloseEvent) => {
        clearTimeout(timer);
        resolve(event);
      });
    });
    const again = await connect(body.token, 'dab000002');
    const close = await closed;
    expect(close.code).toBe(4000);
    expect(close.reason).toBe('superseded');
    expect(errors).toEqual([]);
    expect(again.ws.readyState).toBe(WebSocket.OPEN);
    const still = await call('/join', {
      method: 'POST',
      headers: { authorization: `Bearer ${body.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ device: 'dab000002' }),
    });
    expect(still.status).toBe(201);
    const live = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM credentials WHERE match_id = ? AND device_id = ? AND revoked_at IS NULL',
    ).bind(invited.matchId, 'dab000002').first();
    expect(live?.n).toBe(1);
  });

  it('keeps the previous token when the D1 claim does not insert', async () => {
    const invited = await issuedCode('dcd000001');
    const first = await redeem(invited.code, 'dcd000002');
    expect(first.status).toBe(201);
    const body = (await first.json()) as { token: string };
    for (let n = 0; n < MAX_MINTED_TOKENS - 1; n += 1) {
      const device = `d${(n + 1).toString(16).padStart(8, 'e')}`;
      expect((await redeem(invited.code, device)).status).toBe(201);
    }
    await env.DB.prepare(
      'INSERT INTO credentials (token_hash, match_id, host, expires_at, revoked_at, device_id) VALUES (?, ?, 0, ?, NULL, ?)',
    ).bind('ab'.repeat(32), invited.matchId, Date.now() + 3_600_000, 'd0f0f0f0f').run();
    const replaced = await redeem(invited.code, 'dcd000002');
    expect(replaced.status).toBe(401);
    expect(await replaced.json()).toEqual(NEUTRAL);
    const kept = await connect(body.token, 'dcd000002');
    expect(kept.ws.readyState).toBe(WebSocket.OPEN);
    const live = await env.DB.prepare(
      'SELECT token_hash FROM credentials WHERE match_id = ? AND device_id = ? AND revoked_at IS NULL',
    ).bind(invited.matchId, 'dcd000002').all();
    expect(live.results).toHaveLength(1);
    expect(live.results[0]?.token_hash).toBe(await sha256Hex(body.token));
  });

  it('logs one alarm line when the global count becomes 10000', async () => {
    const invited = await issuedCode('dae000001');
    const window = joinWindow(Date.now());
    const hash = await quotaMac(TEST_QUOTA_HMAC_KEY, 'code-global', 'all', String(window));
    await env.DB.prepare(
      'INSERT INTO join_quota (subject_hash, window, n, cap) VALUES (?, ?, ?, ?) ON CONFLICT(subject_hash, window) DO UPDATE SET n = excluded.n, cap = excluded.cap',
    ).bind(hash, window, CODE_ALARM_GLOBAL - 1, CODE_ALARM_GLOBAL).run();
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((line?: unknown) => {
      lines.push(String(line));
    });
    try {
      const first = await redeem(invited.code, 'dae000002');
      expect(first.status).toBe(201);
      const second = await redeem(invited.code, 'dae000003');
      expect(second.status).toBe(201);
      expect(lines.filter((line) => line === 'short code attempts recorded')).toEqual(['short code attempts recorded']);
    } finally {
      spy.mockRestore();
    }
  });

  it('revokes the code and the invite when the match ends', async () => {
    const invited = await issuedCode('d06060606');
    const host = await connect(invited.hostToken, 'd06060606');
    const endEvent: MatchEvent = { type: 'match/end', at: 1_700_000_000_100 };
    host.ws.send(JSON.stringify({
      type: 'event',
      eventId: '00000000-0000-4000-8000-0000000000ee',
      event: endEvent,
      claim: scoreClaimFor(createMatch(T0), endEvent),
    }));
    await host.messages.waitFor((message) => message.type === 'event');
    const code = await redeem(invited.code, 'd07070707');
    expect(code.status).toBe(401);
    expect(await code.json()).toEqual(NEUTRAL);
    const invite = await call('/join', {
      method: 'POST',
      headers: { authorization: `Bearer ${invited.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ device: 'd07070707' }),
    });
    expect(invite.status).toBe(401);
  });

  it('stores a replayed name only after the extra marks are removed', async () => {
    const stacked = `x${'\u0301'.repeat(8)}y`;
    const base = createMatch(1_700_000_000_000);
    const created = await call('/matches', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        device: 'd08080808',
        log: {
          schemaVersion: 2,
          base,
          events: [{ type: 'team/rename', team: 'a', name: stacked, at: base.createdAt + 1 }],
        },
      }),
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { hostToken: string };
    const host = await connect(body.hostToken, 'd08080808');
    const snap = await host.messages.waitFor((message) => message.type === 'snapshot');
    const events = (snap.log as { events: { type: string; name?: string }[] }).events;
    const rename = events.find((event) => event.type === 'team/rename');
    expect(rename?.name).not.toBe(stacked);
    expect(parseLiveTeamName(rename?.name)).toBe(rename?.name);
    const hindi = await call('/matches', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        device: 'd09090909',
        log: {
          schemaVersion: 2,
          base: createMatch(1_700_000_000_000, undefined, { a: 'भारतीय टीम' }),
          events: [],
        },
      }),
    });
    expect(hindi.status).toBe(201);
  });
});

function stepId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function offlineFrom(
  start: MatchState,
  teams: readonly TeamId[],
  type: 'game/increment' | 'game/decrement' = 'game/increment',
): { event: MatchEvent; claim: ScoreClaim }[] {
  const steps: { event: MatchEvent; claim: ScoreClaim }[] = [];
  let state = start;
  for (const team of teams) {
    const event: MatchEvent = { type, team, at: state.updatedAt + 50 + steps.length };
    const claim = scoreClaimFor(state, event);
    if (!claim) throw new Error('claim');
    steps.push({ event, claim });
    state = matchReducer(state, event);
  }
  return steps;
}

async function invitePlayer(matchId: string, hostToken: string, device: string) {
  const invite = await call(`/matches/${matchId}/invites`, {
    method: 'POST',
    headers: { authorization: `Bearer ${hostToken}` },
    body: JSON.stringify({ role: 'player' }),
  });
  expect(invite.status).toBe(201);
  const invited = (await invite.json()) as { token: string };
  return connect(invited.token, device);
}

async function push(
  ws: WebSocket,
  messages: ReturnType<typeof inbox>,
  id: string,
  event: MatchEvent,
  claim: unknown,
  parentId?: string | null,
): Promise<Record<string, unknown>> {
  ws.send(JSON.stringify({ type: 'event', eventId: id, event, claim, ...(parentId !== undefined ? { parentId } : {}) }));
  return messages.waitFor((message) => message.eventId === id);
}

async function storedBoard(token: string, device: string): Promise<ScoreBoard> {
  const again = await connect(token, device);
  const snap = await again.messages.waitFor((message) => message.type === 'snapshot');
  const log = snap.log as { base: MatchState; events: MatchEvent[] };
  again.ws.close();
  return scoreBoard(replayScore(log.base, log.events));
}

describe('offline score reconcile in the durable object', () => {
  it('stays 4:3 when phone A replays the two points phone B already stored', async () => {
    const created = await createLive('d0c000001', ['a', 'a', 'a', 'a', 'b']);
    const phoneB = await invitePlayer(created.matchId, created.hostToken, 'd0c000002');
    const opening = await phoneB.messages.waitFor((message) => message.type === 'snapshot');
    const opened = opening.log as { base: MatchState; events: MatchEvent[] };
    expect(scoreBoard(replayScore(opened.base, opened.events)).sets[0]).toEqual({ a: 4, b: 1 });
    const online = offlineFrom(created.state, ['b', 'b']);
    let parent = 'seed-5';
    for (let index = 0; index < online.length; index += 1) {
      const step = online[index];
      if (!step) continue;
      const id = stepId(100 + index);
      const ack = await push(phoneB.ws, phoneB.messages, id, step.event, step.claim, parent);
      expect(ack.type).toBe('event');
      expect(ack.duplicate).toBe(false);
      parent = id;
    }
    const phoneA = await connect(created.hostToken, 'd0c000001');
    const queued = offlineFrom(created.state, ['b', 'b']);
    const first = await push(phoneA.ws, phoneA.messages, stepId(110), queued[0]!.event, queued[0]!.claim, 'seed-5');
    expect(first).toMatchObject({ type: 'event', duplicate: true, reconciled: 'already' });
    expect(phoneB.messages.all().some((message) => message.eventId === stepId(110))).toBe(false);
    const second = await push(phoneA.ws, phoneA.messages, stepId(111), queued[1]!.event, queued[1]!.claim, stepId(100));
    expect(second).toMatchObject({ type: 'event', duplicate: true, reconciled: 'already' });
    expect((await storedBoard(created.hostToken, 'd0c000001')).sets[0]).toEqual({ a: 4, b: 3 });
  });

  it('counts the third offline point when the server only has two', async () => {
    const created = await createLive('d0c000011', ['a', 'a', 'a', 'a', 'b']);
    const phoneB = await invitePlayer(created.matchId, created.hostToken, 'd0c000012');
    const online = offlineFrom(created.state, ['b', 'b']);
    let parent = 'seed-5';
    for (let index = 0; index < online.length; index += 1) {
      const step = online[index];
      if (!step) continue;
      const id = stepId(120 + index);
      await push(phoneB.ws, phoneB.messages, id, step.event, step.claim, parent);
      parent = id;
    }
    const phoneA = await connect(created.hostToken, 'd0c000011');
    const queued = offlineFrom(created.state, ['b', 'b', 'b']);
    expect((await push(phoneA.ws, phoneA.messages, stepId(130), queued[0]!.event, queued[0]!.claim, 'seed-5')).reconciled).toBe('already');
    const extra = await push(phoneA.ws, phoneA.messages, stepId(132), queued[2]!.event, queued[2]!.claim);
    expect(extra).toMatchObject({ type: 'event', duplicate: false });
    expect((await storedBoard(created.hostToken, 'd0c000011')).sets[0]).toEqual({ a: 4, b: 4 });
  });

  it('applies a minus once, and keeps the server score when the phones diverge', async () => {
    const correction = await createLive('d0c000021', ['a', 'a', 'a', 'a', 'b', 'b', 'b']);
    const host = await connect(correction.hostToken, 'd0c000021');
    const minus = offlineFrom(correction.state, ['a'], 'game/decrement')[0];
    if (!minus) throw new Error('minus');
    const applied = await push(host.ws, host.messages, stepId(140), minus.event, minus.claim, 'seed-7');
    expect(applied.type).toBe('event');
    const twice = await push(host.ws, host.messages, stepId(141), minus.event, minus.claim, 'seed-7');
    expect(twice.reconciled).toBe('already');
    expect((await storedBoard(correction.hostToken, 'd0c000021')).sets[0]).toEqual({ a: 3, b: 3 });

    const created = await createLive('d0c000031', ['a', 'a', 'a', 'a', 'b']);
    const phoneB = await invitePlayer(created.matchId, created.hostToken, 'd0c000032');
    const theirs = offlineFrom(created.state, ['a'])[0];
    if (!theirs) throw new Error('point');
    await push(phoneB.ws, phoneB.messages, stepId(150), theirs.event, theirs.claim, 'seed-5');
    const phoneA = await connect(created.hostToken, 'd0c000031');
    const queued = offlineFrom(created.state, ['b', 'b']);
    const added = await push(phoneA.ws, phoneA.messages, stepId(151), queued[0]!.event, queued[0]!.claim, 'seed-5');
    expect(added.type).toBe('event');
    expect(added.duplicate).toBe(false);
    expect((await storedBoard(created.hostToken, 'd0c000031')).sets[0]).toEqual({ a: 5, b: 2 });
  });

  it('keeps the following game when the set was already closed on the server', async () => {
    const created = await createLive('d0c000041', ['a', 'a', 'a', 'a', 'a', 'b', 'b', 'b', 'b']);
    const phoneB = await invitePlayer(created.matchId, created.hostToken, 'd0c000042');
    const queued = offlineFrom(created.state, ['a', 'a']);
    const closed = await push(phoneB.ws, phoneB.messages, stepId(160), queued[0]!.event, queued[0]!.claim, 'seed-9');
    expect(closed.type).toBe('event');
    const phoneA = await connect(created.hostToken, 'd0c000041');
    expect((await push(phoneA.ws, phoneA.messages, stepId(161), queued[0]!.event, queued[0]!.claim, 'seed-9')).reconciled).toBe('already');
    const next = await push(phoneA.ws, phoneA.messages, stepId(162), queued[1]!.event, queued[1]!.claim);
    expect(next).toMatchObject({ type: 'event', duplicate: false });
    const board = await storedBoard(created.hostToken, 'd0c000041');
    expect(board.sets[0]).toEqual({ a: 6, b: 4 });
    expect(board.sets[1]).toEqual({ a: 1, b: 0 });
    expect(board.activeSet).toBe(1);
  });

  it('rejects a malformed score claim and still accepts a later valid point', async () => {
    const created = await createLive('d0c000051');
    const host = await connect(created.hostToken, 'd0c000051');
    const event: MatchEvent = { type: 'game/increment', team: 'a', at: T0 + 10 };
    const valid = scoreClaimFor(created.state, event);
    if (!valid) throw new Error('claim');
    const malformed = [
      undefined,
      { ...valid, baseRevision: -1 },
      { ...valid, baseRevision: 1.5 },
      { ...valid, after: { ...valid.after, sets: [{ a: 8, b: 0 }, { a: 0, b: 0 }, { a: 0, b: 0 }] } },
      { ...valid, after: { ...valid.after, activeSet: 3 } },
      { ...valid, after: { ...valid.after, ended: 'no' } },
      { ...valid, note: 'extra' },
      { ...valid, after: { ...valid.after, sets: [{ a: 4, b: 3 }, { a: 0, b: 0 }, { a: 0, b: 0 }] } },
    ];
    for (let index = 0; index < malformed.length; index += 1) {
      const ack = await push(host.ws, host.messages, stepId(170 + index), event, malformed[index]);
      expect(ack).toMatchObject({ type: 'error', code: 'not_applied' });
    }
    const scored = await push(host.ws, host.messages, stepId(180), event, valid);
    expect(scored).toMatchObject({ type: 'event', duplicate: false });
    const again = await connect(created.hostToken, 'd0c000051');
    const snap = await again.messages.waitFor((message) => message.type === 'snapshot');
    const stored = (snap.log as { events: { capturedAt?: number }[] }).events.at(-1);
    expect(stored?.capturedAt).toBeGreaterThan(T0 + 10);
    expect((await storedBoard(created.hostToken, 'd0c000051')).sets[0]).toEqual({ a: 1, b: 0 });
  });

  it('closes a protocol 1 hello and asks for an update', async () => {
    const created = await createLive('d0c000061');
    const response = await call(`/ws/${await ticketFor(created.hostToken, 'd0c000061')}`, { headers: { upgrade: 'websocket' } });
    const ws = response.webSocket;
    if (!ws) throw new Error('socket');
    ws.accept();
    const messages = inbox(ws);
    ws.send(JSON.stringify({ type: 'hello', protocol: 1, token: created.hostToken, device: 'd0c000061' }));
    const error = await messages.waitFor((message) => message.type === 'error');
    expect(error.code).toBe('upgrade_required');
  });
});
