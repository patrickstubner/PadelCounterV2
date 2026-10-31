import { KICK_PER_ACTOR, KICK_PER_MATCH, LIVE_PROTOCOL, createMatch, isJoinToken } from '@padel/core';
import { runInDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './tokens';

const ORIGIN = 'https://patrickstubner.github.io';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile';

let ipCount = 140;

function call(path: string, init: RequestInit = {}): Promise<Response> {
  ipCount += 1;
  const headers = new Headers(init.headers);
  headers.set('origin', ORIGIN);
  headers.set('cf-connecting-ip', `198.51.100.${ipCount}`);
  return exports.default.fetch(new Request(`https://padel.example${path}`, { ...init, headers }));
}

function inbox(ws: WebSocket): {
  all(): Record<string, unknown>[];
    waitFor(match: (message: Record<string, unknown>, index: number) => boolean): Promise<Record<string, unknown>>;
  } {
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
          const index = messages.findIndex((message, at) => match(message, at));
          const found = index >= 0 ? messages[index] : undefined;
          if (found) {
            resolve(found);
            return;
          }
          if (Date.now() - start > 3_000) {
            reject(new Error(`no matching message in ${JSON.stringify(messages.map((item) => item.type))}`));
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

type Phone = Record<string, unknown>;

function phonesOf(message: Record<string, unknown>): Phone[] {
  return message.phones as Phone[];
}

function assertAllowlist(message: Record<string, unknown>): void {
  const wire = JSON.stringify(message);
  expect(wire).not.toContain('Mozilla');
  expect(wire).not.toContain('userAgent');
  expect(wire).not.toContain('198.51.100');
  expect(wire).not.toMatch(/"deviceId"/);
  expect(wire).not.toMatch(/d[0-9a-f]{8}/);
  for (const phone of phonesOf(message)) {
    expect(Object.keys(phone).sort()).toEqual(['kind', 'online', 'seat', 'seen', 'self', 'since']);
  }
}

async function createLive(device: string): Promise<{ matchId: string; hostToken: string }> {
  const base = createMatch(1_700_000_000_000);
  const response = await call('/matches', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ device, log: { schemaVersion: 2, base, events: [] } }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { matchId: string; hostToken: string };
}

async function openSocket(token: string, device: string, agent: string): Promise<{
  ws: WebSocket;
  messages: ReturnType<typeof inbox>;
  session: string;
}> {
  const ticket = await call('/join', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ device }),
  });
  expect(ticket.status).toBe(201);
  const body = (await ticket.json()) as { ticket: string; token?: string };
  const session = isJoinToken(body.token) ? body.token : token;
  const response = await call(`/ws/${body.ticket}`, {
    headers: { upgrade: 'websocket', 'user-agent': agent },
  });
  const ws = response.webSocket;
  if (!ws) throw new Error(`websocket upgrade failed: ${response.status}`);
  ws.accept();
  const messages = inbox(ws);
  ws.send(JSON.stringify({ type: 'hello', protocol: LIVE_PROTOCOL, token: session, device, clientNow: Date.now() }));
  await messages.waitFor((message) => message.type === 'snapshot');
  await messages.waitFor((message) => message.type === 'roster');
  return { ws, messages, session };
}

async function seatOf(messages: ReturnType<typeof inbox>, self: boolean): Promise<string> {
  const roster = await messages.waitFor((message) => message.type === 'roster');
  const seat = phonesOf(roster).find((phone) => phone.self === self)?.seat;
  if (typeof seat !== 'string') throw new Error('missing seat');
  return seat;
}

describe('removing a phone', () => {
  it('lets a guest remove another guest, refuses self and the starter, and requires a new code', async () => {
    const hostDevice = 'd42000001000000000000000000000000';
    const guestDevice = 'd42000002000000000000000000000000';
    const otherDevice = 'd42000003000000000000000000000000';
    const created = await createLive(hostDevice);
    const invite = await call(`/matches/${created.matchId}/invites`, {
      method: 'POST',
      headers: { authorization: `Bearer ${created.hostToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'player' }),
    });
    expect(invite.status).toBe(201);
    const shared = (await invite.json()) as { token: string };

    const host = await openSocket(created.hostToken, hostDevice, IPHONE);
    const guestJoin = await call('/join', {
      method: 'POST',
      headers: { authorization: `Bearer ${shared.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ device: guestDevice }),
    });
    expect(guestJoin.status).toBe(201);
    const guestBody = (await guestJoin.json()) as { ticket: string; token: string };
    expect(isJoinToken(guestBody.token)).toBe(true);
    const guestSocket = await call(`/ws/${guestBody.ticket}`, {
      headers: { upgrade: 'websocket', 'user-agent': ANDROID },
    });
    const guestWs = guestSocket.webSocket;
    if (!guestWs) throw new Error('guest socket');
    guestWs.accept();
    const guest = inbox(guestWs);
    guestWs.send(JSON.stringify({
      type: 'hello',
      protocol: LIVE_PROTOCOL,
      token: guestBody.token,
      device: guestDevice,
      clientNow: Date.now(),
    }));
    await guest.waitFor((message) => message.type === 'snapshot');
    const other = await openSocket(shared.token, otherDevice, IPHONE);
    expect(other.session).not.toBe(shared.token);
    const guestSeat = await seatOf(guest, true);
    const otherSeat = await seatOf(other.messages, true);
    expect(guestSeat).not.toBe('host');
    expect(otherSeat).not.toBe('host');
    expect(guestSeat).not.toBe(otherSeat);

    guestWs.send(JSON.stringify({ type: 'kick', seat: 'host', deviceId: otherDevice }));
    const protectedHost = await guest.waitFor((message) => message.type === 'error' && message.code === 'kick_refused');
    expect(JSON.stringify(protectedHost)).not.toContain(otherDevice);
    guestWs.send(JSON.stringify({ type: 'kick', seat: guestSeat }));
    const selfKick = await guest.waitFor((message) => message.type === 'error' && message.code === 'kick_refused' && message !== protectedHost);
    expect(selfKick.code).toBe('kick_refused');

    const rosterMark = host.messages.all().length;
    guestWs.send(JSON.stringify({ type: 'kick', seat: otherSeat }));
    const dropped = await host.messages.waitFor((message, index) => {
      if (index < rosterMark || message.type !== 'roster') return false;
      return !phonesOf(message).some((phone) => phone.seat === otherSeat);
    });
    assertAllowlist(dropped);
    expect(phonesOf(dropped).some((phone) => phone.seat === guestSeat && phone.online === true)).toBe(true);
    expect(phonesOf(dropped).some((phone) => phone.self === true)).toBe(true);
    const revoked = await other.messages.waitFor((message) => message.type === 'error');
    expect(revoked.code).toBe('revoked');
    const otherHash = await sha256Hex(other.session);
    const roomRevoked = await runInDurableObject(
      env.MATCH_ROOMS.get(env.MATCH_ROOMS.idFromName(created.matchId)),
      (_instance, state) => state.storage.sql.exec(
        'SELECT revoked_at FROM invites WHERE token_hash = ?',
        otherHash,
      ).toArray()[0]?.revoked_at,
    );
    expect(roomRevoked).toEqual(expect.any(Number));

    const oldToken = await call('/join', {
      method: 'POST',
      headers: { authorization: `Bearer ${other.session}`, 'content-type': 'application/json' },
      body: JSON.stringify({ device: otherDevice }),
    });
    expect(oldToken.status).toBe(401);
    const sameCode = await call('/join', {
      method: 'POST',
      headers: { authorization: `Bearer ${shared.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ device: otherDevice }),
    });
    expect(sameCode.status).not.toBe(201);

    const rotated = await call(`/matches/${created.matchId}/invites`, {
      method: 'POST',
      headers: { authorization: `Bearer ${created.hostToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'player', rotate: true }),
    });
    expect(rotated.status).toBe(201);
    const next = (await rotated.json()) as { token: string };
    const returned = await call('/join', {
      method: 'POST',
      headers: { authorization: `Bearer ${next.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ device: otherDevice }),
    });
    expect(returned.status).toBe(201);
  });

  it('stops a kick war after the per-phone limit', async () => {
    const hostDevice = 'd42000011000000000000000000000000';
    const created = await createLive(hostDevice);
    const invite = await call(`/matches/${created.matchId}/invites`, {
      method: 'POST',
      headers: { authorization: `Bearer ${created.hostToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'player' }),
    });
    const shared = (await invite.json()) as { token: string };
    const host = await openSocket(created.hostToken, hostDevice, IPHONE);
    const devices = [
      'd42000012000000000000000000000000',
      'd42000013000000000000000000000000',
      'd42000014000000000000000000000000',
      'd42000015000000000000000000000000',
    ];
    for (let index = 0; index < KICK_PER_ACTOR; index += 1) {
      const device = devices[index];
      if (!device) throw new Error('device');
      const phone = await openSocket(shared.token, device, ANDROID);
      const seat = await seatOf(phone.messages, true);
      const mark = host.messages.all().length;
      host.ws.send(JSON.stringify({ type: 'kick', seat }));
      const gone = await host.messages.waitFor((message, at) => {
        if (at < mark || message.type !== 'roster') return false;
        return !phonesOf(message).some((row) => row.seat === seat);
      });
      assertAllowlist(gone);
      const revoked = await phone.messages.waitFor((message) => message.type === 'error' && message.code === 'revoked');
      expect(revoked.code).toBe('revoked');
    }
    const last = devices[KICK_PER_ACTOR];
    if (!last) throw new Error('last');
    const staying = await openSocket(shared.token, last, ANDROID);
    const seat = await seatOf(staying.messages, true);
    host.ws.send(JSON.stringify({ type: 'kick', seat }));
    const limited = await host.messages.waitFor((message) => message.type === 'error' && message.code === 'kick_limited');
    expect(limited.code).toBe('kick_limited');
    await new Promise((resolve) => setTimeout(resolve, 40));
    const still = host.messages.all().filter((message) => message.type === 'roster').at(-1);
    if (!still) throw new Error('roster');
    expect(phonesOf(still).some((row) => row.seat === seat && row.online === true)).toBe(true);
    assertAllowlist(still);
    expect(staying.messages.all().some((message) => message.type === 'error' && message.code === 'revoked')).toBe(false);
  });

  it('stops the ninth removal in one match', async () => {
    expect(KICK_PER_MATCH).toBe(8);
    const hostDevice = 'd42000021000000000000000000000000';
    const created = await createLive(hostDevice);
    const invite = await call(`/matches/${created.matchId}/invites`, {
      method: 'POST',
      headers: { authorization: `Bearer ${created.hostToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'player' }),
    });
    const shared = (await invite.json()) as { token: string };
    const host = await openSocket(created.hostToken, hostDevice, IPHONE);
    const actorA = await openSocket(shared.token, 'd42000022000000000000000000000000', ANDROID);
    const actorB = await openSocket(shared.token, 'd42000023000000000000000000000000', IPHONE);
    const actors = [
      { ws: actorA.ws, messages: actorA.messages, count: 3 },
      { ws: actorB.ws, messages: actorB.messages, count: 3 },
      { ws: host.ws, messages: host.messages, count: 2 },
    ];
    let deviceN = 0x42000024;
    const kickOne = async (from: WebSocket, inboxFor: ReturnType<typeof inbox>): Promise<void> => {
      deviceN += 1;
      const device = `d${deviceN.toString(16).padStart(8, '0')}${'0'.repeat(24)}`;
      const phone = await openSocket(shared.token, device, ANDROID);
      const seat = await seatOf(phone.messages, true);
      expect(seat).not.toBe('host');
      const mark = inboxFor.all().length;
      from.send(JSON.stringify({ type: 'kick', seat }));
      await inboxFor.waitFor((message, index) => {
        if (index < mark || message.type !== 'roster') return false;
        return !phonesOf(message).some((row) => row.seat === seat);
      });
      const dropped = await phone.messages.waitFor((message) => message.type === 'error' && message.code === 'revoked');
      expect(dropped.code).toBe('revoked');
      if (phone.ws.readyState !== 3) {
        await new Promise<void>((resolve) => phone.ws.addEventListener('close', () => resolve()));
      }
    };
    for (const actor of actors) {
      for (let index = 0; index < actor.count; index += 1) await kickOne(actor.ws, actor.messages);
    }
    const last = await openSocket(shared.token, 'd4200002f000000000000000000000000', ANDROID);
    const seat = await seatOf(last.messages, true);
    host.ws.send(JSON.stringify({ type: 'kick', seat }));
    const limited = await host.messages.waitFor((message) => message.type === 'error' && message.code === 'kick_limited');
    expect(limited.code).toBe('kick_limited');
    await new Promise((resolve) => setTimeout(resolve, 40));
    const still = host.messages.all().filter((message) => message.type === 'roster').at(-1);
    if (!still) throw new Error('roster');
    expect(phonesOf(still).some((row) => row.seat === seat && row.online === true)).toBe(true);
  }, 20_000);
});
