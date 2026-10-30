import { CARRY_PER_MATCH, LIVE_PROTOCOL, ROTATE_PER_MATCH, createMatch } from '@padel/core';
import { runInDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const ORIGIN = 'https://patrickstubner.github.io';

function dev(suffix: string): string {
  return `d${suffix.replace(/^d/, '').padEnd(32, '0')}`;
}

let ipCount = 120;

function call(path: string, init: RequestInit = {}): Promise<Response> {
  ipCount += 1;
  const headers = new Headers(init.headers);
  headers.set('origin', ORIGIN);
  headers.set('cf-connecting-ip', `203.0.113.${ipCount % 200}`);
  return exports.default.fetch(new Request(`https://padel.example${path}`, { ...init, headers }));
}

function inbox(ws: WebSocket): {
  all(): Record<string, unknown>[];
  waitFor(match: (message: Record<string, unknown>) => boolean): Promise<Record<string, unknown>>;
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
          const found = messages.find(match);
          if (found) {
            resolve(found);
            return;
          }
          if (Date.now() - start > 3_000) {
            reject(new Error(`missing message ${JSON.stringify(messages)}`));
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

async function invite(matchId: string, token: string, rotate: unknown = false): Promise<{ status: number; token?: string; code?: string }> {
  const response = await call(`/matches/${matchId}/invites`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ role: 'player', rotate }),
  });
  const body = (await response.json()) as { token?: string; code?: string };
  return { status: response.status, token: body.token, code: body.code };
}

async function connect(token: string, device: string): Promise<{ ws: WebSocket; messages: ReturnType<typeof inbox>; session: string }> {
  const ticket = await call('/join', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ device }),
  });
  expect(ticket.status).toBe(201);
  const body = (await ticket.json()) as { ticket: string; token?: string };
  const session = typeof body.token === 'string' ? body.token : token;
  const response = await call(`/ws/${body.ticket}`, { headers: { upgrade: 'websocket' } });
  const ws = response.webSocket;
  if (!ws) throw new Error('socket');
  ws.accept();
  const messages = inbox(ws);
  ws.send(JSON.stringify({ type: 'hello', protocol: LIVE_PROTOCOL, token: session, device, clientNow: Date.now() }));
  await messages.waitFor((message) => message.type === 'snapshot');
  return { ws, messages, session };
}

describe('review 23 fixes', () => {
  it('does not rotate unless rotate is the boolean true, and refuses a spectator role', async () => {
    const created = await createLive(dev('d51000001000000000000000000000000'));
    const host = await connect(created.hostToken, dev('d51000001000000000000000000000000'));
    const first = await invite(created.matchId, created.hostToken);
    expect(first.status).toBe(201);
    const asText = await invite(created.matchId, created.hostToken, 'true');
    expect(asText.status).toBe(200);
    expect(asText.token).toBe(first.token);
    const asFalse = await invite(created.matchId, created.hostToken, false);
    expect(asFalse.token).toBe(first.token);
    const spectator = await call(`/matches/${created.matchId}/invites`, {
      method: 'POST',
      headers: { authorization: `Bearer ${created.hostToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'spectator' }),
    });
    expect(spectator.status).toBe(403);
    expect((await spectator.json()) as { error: string }).toEqual({
      error: 'spectator_not_available',
      message: 'View-only links are not available yet.',
    });
    const stub = env.MATCH_ROOMS.get(env.MATCH_ROOMS.idFromName(created.matchId));
    const direct = await stub.fetch('https://match.internal/invite', {
      method: 'POST',
      body: JSON.stringify({
        memberToken: created.hostToken,
        role: 'player',
        rotate: 'true',
        inviteToken: 'bbbbbbbbbbbbbbbbbbbbbb',
        code: 'ABCD-EFGH',
      }),
    });
    expect(direct.status).toBe(200);
    expect(((await direct.json()) as { token?: string }).token).toBe(first.token);
    expect(host.messages.all().some((message) => message.type === 'error' && message.code === 'revoked')).toBe(false);
  });

  it('keeps the caller when they replace the code, and stops after the match limit', async () => {
    const created = await createLive(dev('d52000001000000000000000000000000'));
    await connect(created.hostToken, dev('d52000001000000000000000000000000'));
    const first = await invite(created.matchId, created.hostToken);
    if (!first.code) throw new Error('code');
    const redeemed = await call('/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device: dev('d52000002000000000000000000000000'), code: first.code }),
    });
    expect(redeemed.status).toBe(201);
    const own = (await redeemed.json()) as { token: string };
    const caller = await connect(own.token, dev('d52000002000000000000000000000000'));
    const other = await connect(first.token ?? '', dev('d52000003000000000000000000000000'));
    const rotated = await invite(created.matchId, own.token, true);
    expect(rotated.status).toBe(201);
    expect(rotated.token).not.toBe(first.token);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(caller.messages.all().some((message) => message.code === 'revoked')).toBe(false);
    expect((await other.messages.waitFor((message) => message.type === 'error')).code).toBe('revoked');
    const still = await call('/join', {
      method: 'POST',
      headers: { authorization: `Bearer ${own.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ device: dev('d52000002000000000000000000000000') }),
    });
    expect(still.status).toBe(201);
    for (let n = 1; n < ROTATE_PER_MATCH; n += 1) {
      const again = await invite(created.matchId, own.token, true);
      expect(again.status).toBe(201);
    }
    const limited = await invite(created.matchId, own.token, true);
    expect(limited.status).toBe(429);
    expect((await call(`/matches/${created.matchId}/invites`, {
      method: 'POST',
      headers: { authorization: `Bearer ${own.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'player', rotate: true }),
    }).then((response) => response.json())) as { error: string }).toMatchObject({ error: 'invite_limited' });
  });

  it('refuses a shared code as the mover, ignores a forged starter, and caps carries', async () => {
    const created = await createLive(dev('d53000001000000000000000000000000'));
    const host = await connect(created.hostToken, dev('d53000001000000000000000000000000'));
    const first = await invite(created.matchId, created.hostToken);
    const guest = await connect(first.token ?? '', dev('d53000002000000000000000000000000'));
    const shared = await call(`/matches/${(await createLive(dev('d53000009000000000000000000000000'))).matchId}/carry`, {
      method: 'POST',
      headers: { authorization: `Bearer ${(await createLive(dev('d53000008000000000000000000000000'))).hostToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: true, previousHostToken: first.token, device: dev('d53000001000000000000000000000000') }),
    });
    expect(shared.status).toBe(401);

    const next = await createLive(dev('d53000003000000000000000000000000'));
    const lied = await call(`/matches/${next.matchId}/carry`, {
      method: 'POST',
      headers: { authorization: `Bearer ${next.hostToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: true, previousHostToken: created.hostToken, device: dev('d53000002000000000000000000000000') }),
    });
    expect(lied.status).toBe(200);
    expect(await lied.json()).toMatchObject({ carried: 1 });
    const moved = await guest.messages.waitFor((message) => message.type === 'match_moved');
    expect(typeof moved.token).toBe('string');
    expect(host.messages.all().some((message) => message.type === 'match_moved')).toBe(false);

    for (let n = 1; n < CARRY_PER_MATCH; n += 1) {
      const extra = await createLive(dev(`d5300001${n}`));
      const again = await call(`/matches/${extra.matchId}/carry`, {
        method: 'POST',
        headers: { authorization: `Bearer ${extra.hostToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: true, previousHostToken: created.hostToken }),
      });
      expect(again.status).toBe(200);
    }
    const blocked = await createLive(dev('d53000019000000000000000000000000'));
    const limited = await call(`/matches/${blocked.matchId}/carry`, {
      method: 'POST',
      headers: { authorization: `Bearer ${blocked.hostToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: true, previousHostToken: created.hostToken }),
    });
    expect(limited.status).toBe(429);
    expect((await limited.json()) as { error: string }).toMatchObject({ error: 'carry_limited' });
  });

  it('checks the handover pair and expiry, the notify gate, and does not list a socket before hello', async () => {
    const created = await createLive(dev('d54000001000000000000000000000000'));
    await connect(created.hostToken, dev('d54000001000000000000000000000000'));
    const first = await invite(created.matchId, created.hostToken);
    const offline = await connect(first.token ?? '', dev('d54000002000000000000000000000000'));
    const offlineSession = offline.session;
    offline.ws.close();
    const next = await createLive(dev('d54000003000000000000000000000000'));
    const carry = await call(`/matches/${next.matchId}/carry`, {
      method: 'POST',
      headers: { authorization: `Bearer ${next.hostToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: true, previousHostToken: created.hostToken }),
    });
    expect(carry.status).toBe(200);

    const wrongTicket = await call('/join', {
      method: 'POST',
      headers: { authorization: `Bearer ${created.hostToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ device: dev('d54000002000000000000000000000000') }),
    });
    const wrongBody = (await wrongTicket.json()) as { ticket: string };
    const wrongSocket = await call(`/ws/${wrongBody.ticket}`, { headers: { upgrade: 'websocket' } });
    const wrong = wrongSocket.webSocket;
    if (!wrong) throw new Error('socket');
    wrong.accept();
    const wrongMessages = inbox(wrong);
    wrong.send(JSON.stringify({
      type: 'hello',
      protocol: LIVE_PROTOCOL,
      token: created.hostToken,
      device: dev('d54000002000000000000000000000000'),
      clientNow: Date.now(),
    }));
    const wrongNotice = await wrongMessages.waitFor((message) => message.type === 'match_notice' || message.type === 'match_moved');
    expect(wrongNotice.type).toBe('match_notice');
    wrong.close();
    const wrongAgainTicket = await call('/join', {
      method: 'POST',
      headers: { authorization: `Bearer ${created.hostToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ device: dev('d54000002000000000000000000000000') }),
    });
    const wrongAgainBody = (await wrongAgainTicket.json()) as { ticket: string };
    const wrongAgainSocket = await call(`/ws/${wrongAgainBody.ticket}`, { headers: { upgrade: 'websocket' } });
    const wrongAgain = wrongAgainSocket.webSocket;
    if (!wrongAgain) throw new Error('socket');
    wrongAgain.accept();
    const wrongAgainMessages = inbox(wrongAgain);
    wrongAgain.send(JSON.stringify({
      type: 'hello',
      protocol: LIVE_PROTOCOL,
      token: created.hostToken,
      device: dev('d54000002000000000000000000000000'),
      clientNow: Date.now(),
    }));
    const secondNotice = await wrongAgainMessages.waitFor((message) => message.type === 'match_notice' || message.type === 'match_moved');
    expect(secondNotice.type).toBe('match_notice');

    await runInDurableObject(env.MATCH_ROOMS.get(env.MATCH_ROOMS.idFromName(created.matchId)), (_instance, state) => {
      state.storage.sql.exec('UPDATE sealed SET expires_at = 1 WHERE id LIKE ?', 'move:%');
    });
    const late = await connect(offlineSession, dev('d54000002000000000000000000000000'));
    const lateNotice = await late.messages.waitFor((message) => message.type === 'match_notice' || message.type === 'match_moved');
    expect(lateNotice.type).toBe('match_notice');

    const room = env.MATCH_ROOMS.get(env.MATCH_ROOMS.idFromName(created.matchId));
    const missing = await room.fetch('https://match.internal/notify', {
      method: 'POST',
      body: JSON.stringify({ offers: [{ deviceId: dev('d54000009000000000000000000000000'), token: 'abcdefghijklmnopqrstuv' }] }),
    });
    expect(missing.status).toBe(401);
    const rotated = await invite(created.matchId, created.hostToken, true);
    expect(rotated.status).toBe(201);
    const revoked = await room.fetch('https://match.internal/notify', {
      method: 'POST',
      body: JSON.stringify({ hostToken: first.token, offers: [] }),
    });
    expect(revoked.status).toBe(401);
    const outsider = await room.fetch('https://match.internal/notify', {
      method: 'POST',
      body: JSON.stringify({ hostToken: created.hostToken, offers: [{ deviceId: dev('d54ffffff000000000000000000000000'), token: 'abcdefghijklmnopqrstuv' }] }),
    });
    expect(outsider.status).toBe(200);
    const sealed = await runInDurableObject(room, (_instance, state) => {
      return state.storage.sql.exec('SELECT id FROM sealed WHERE id = ?', `move:${dev('d54ffffff000000000000000000000000')}`).toArray().length;
    });
    expect(sealed).toBe(0);

    const quietTicket = await call('/join', {
      method: 'POST',
      headers: { authorization: `Bearer ${created.hostToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ device: dev('d54000008000000000000000000000000') }),
    });
    const quietBody = (await quietTicket.json()) as { ticket: string };
    const quietSocket = await call(`/ws/${quietBody.ticket}`, { headers: { upgrade: 'websocket' } });
    const quiet = quietSocket.webSocket;
    if (!quiet) throw new Error('socket');
    quiet.accept();
    const quietMessages = inbox(quiet);
    await connect(created.hostToken, dev('d54000007000000000000000000000000'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(quietMessages.all().some((message) => message.type === 'roster')).toBe(false);
  });
});
