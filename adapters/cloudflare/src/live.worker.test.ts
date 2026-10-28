import { CODE_FAILS_GLOBAL, CODE_FAILS_PER_IP, ROOM_MESSAGES, createMatch } from '@padel/core';
import { runInDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { quotaMac } from './tokens';

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

async function createLive(device: string): Promise<{ matchId: string; hostToken: string; lastActivity: number }> {
  const response = await call('/matches', {
    method: 'POST',
    body: JSON.stringify({
      device,
      log: { schemaVersion: 2, base: createMatch(1_700_000_000_000), events: [] },
    }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { matchId: string; hostToken: string };
  const row = await env.DB.prepare('SELECT last_activity FROM matches WHERE id = ?').bind(body.matchId).first();
  const lastActivity = row?.last_activity;
  if (typeof lastActivity !== 'number') throw new Error('missing last_activity');
  return { matchId: body.matchId, hostToken: body.hostToken, lastActivity };
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

function inbox(ws: WebSocket): { waitFor(match: (message: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> } {
  const messages: Record<string, unknown>[] = [];
  let notify = (): void => {};
  ws.addEventListener('message', (event: MessageEvent) => {
    messages.push(JSON.parse(String(event.data)) as Record<string, unknown>);
    notify();
  });
  return {
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
  ws.send(JSON.stringify({ type: 'hello', protocol: 1, token, device }));
  const snapshot = await messages.waitFor((message) => message.type === 'snapshot');
  expect(snapshot.protocol).toBe(1);
  return { ws, messages };
}

function sendEvent(ws: WebSocket, event: Record<string, unknown>): void {
  ws.send(JSON.stringify({ type: 'event', eventId: crypto.randomUUID(), event }));
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
    const started = Date.now();
    host.ws.send(JSON.stringify({
      type: 'event',
      eventId: hostEvent,
      event: { type: 'game/increment', team: 'a', at: 1_700_000_000_100 },
    }));
    const onPlayer = await player.messages.waitFor((message) => message.type === 'event' && message.eventId === hostEvent);
    expect((onPlayer.event as { team?: string }).team).toBe('a');
    expect(onPlayer.duplicate).toBe(false);
    expect(Date.now() - started).toBeLessThan(500);

    const back = Date.now();
    player.ws.send(JSON.stringify({
      type: 'event',
      eventId: playerEvent,
      event: { type: 'game/increment', team: 'b', at: 1_700_000_000_200 },
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
    host.ws.send(JSON.stringify({
      type: 'event',
      eventId: scoredId,
      event: { type: 'game/increment', team: 'a', at: 1_700_000_000_200 },
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

    sendEvent(host.ws, { type: 'game/increment', team: 'a', at: 1 });
    sendEvent(host.ws, { type: 'game/increment', team: 'a', at: 2 });
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

    sendEvent(host.ws, { type: 'match/end', at: 3 });
    const ended = await player.messages.waitFor(
      (message) => message.type === 'event' && (message.event as { type?: string }).type === 'match/end',
    );
    expect((ended.event as { by?: string }).by).toBe('host');

    sendEvent(player.ws, { type: 'match/resume', at: 4 });
    const refused = await player.messages.waitFor((message) => message.type === 'error');
    expect(refused.code).toBe('forbidden');

    sendEvent(host.ws, { type: 'match/resume', at: 5 });
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
    const expected = await quotaMac('test-quota-hmac-key', 'socket-ip', address, 'socket');
    const pending = await readIps();
    expect(pending).toContain(expected);
    expect(JSON.stringify(pending)).not.toContain(address);

    const messages = inbox(ws);
    ws.send(JSON.stringify({ type: 'hello', protocol: 1, token: created.hostToken, device: 'd33333333' }));
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
    expect(invited.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{3}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{3}$/);
    expect(invited.code).not.toMatch(/[01ILO]/);
    const typed = invited.code.toLowerCase().replace('-', '');
    const response = await redeem(typed, 'd23232323');
    expect(response.status).toBe(201);
    const body = (await response.json()) as { token?: string; matchId?: string; code?: string };
    expect(body.matchId).toBeUndefined();
    expect(body.code).toBeUndefined();
    expect(typeof body.token).toBe('string');
    expect(JSON.stringify(body)).not.toContain(invited.code.replace('-', ''));
    const token = body.token ?? '';
    await connect(token, 'd23232323');

    const wrongTicket = await ticketFor(token, 'd34343434');
    const wrong = await call(`/ws/${wrongTicket}`, { headers: { upgrade: 'websocket' } });
    const wrongSocket = wrong.webSocket;
    if (!wrongSocket) throw new Error('socket missing');
    wrongSocket.accept();
    const wrongMessages = inbox(wrongSocket);
    wrongSocket.send(JSON.stringify({ type: 'hello', protocol: 1, token, device: 'd34343434' }));
    const refused = await wrongMessages.waitFor((message) => message.type === 'error');
    expect(refused.code).toBe('bad_token');

    await connect(invited.token, 'd45454545');
  });

  it('uses one error for an unknown code and an expired code', async () => {
    const invited = await issuedCode('d56565656');
    const unknown = await redeem('K7M-42Q', 'd67676767');
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

  it('limits failed guesses per address and across every address', async () => {
    const ip = '198.51.100.77';
    for (let n = 0; n < CODE_FAILS_PER_IP; n += 1) {
      const response = await redeem('ZZZ-ZZZ', 'd01010101', ip);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual(NEUTRAL);
    }
    const blocked = await redeem('YYY-YYY', 'd01010101', ip);
    expect(blocked.status).toBe(429);
    expect(((await blocked.json()) as { error?: string }).error).toBe('slow_down');
    let accepted = 0;
    for (let n = 0; n < CODE_FAILS_GLOBAL; n += 1) {
      const device = `d${(n + 16).toString(16).padStart(8, '0')}`;
      const response = await redeem('WWW-WWW', device);
      if (response.status === 429) break;
      expect(response.status).toBe(401);
      accepted += 1;
    }
    expect(accepted).toBeGreaterThan(0);
    expect(accepted).toBeLessThanOrEqual(CODE_FAILS_GLOBAL);
    const global = await redeem('VVV-VVV', 'd03030303');
    expect(global.status).toBe(429);
    expect(((await global.json()) as { error?: string }).error).toBe('slow_down');
  });

  it('refuses a stacked base name and keeps a Hindi name', async () => {
    const stacked = `5${'\u0301'.repeat(8)}`;
    const refused = await call('/matches', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        device: 'd04040404',
        log: { schemaVersion: 2, base: createMatch(1_700_000_000_000, undefined, { a: stacked }), events: [] },
      }),
    });
    expect(refused.status).toBe(400);
    const text = await refused.text();
    expect(text).toContain('invalid_match');
    expect(text).not.toContain('\u0301');
    const kept = await call('/matches', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        device: 'd05050505',
        log: {
          schemaVersion: 2,
          base: createMatch(1_700_000_000_000, undefined, { a: 'भारतीय टीम' }),
          events: [],
        },
      }),
    });
    expect(kept.status).toBe(201);
  });
});
