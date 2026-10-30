import { LEAVE_PER_ACTOR, LIVE_PROTOCOL, createMatch, isJoinToken } from '@padel/core';
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const ORIGIN = 'https://patrickstubner.github.io';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile';

let ipCount = 180;

function call(path: string, init: RequestInit = {}): Promise<Response> {
  ipCount += 1;
  const headers = new Headers(init.headers);
  headers.set('origin', ORIGIN);
  headers.set('cf-connecting-ip', `203.0.113.${ipCount}`);
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
}> {
  const ticket = await call('/join', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ device }),
  });
  expect(ticket.status).toBe(201);
  const body = (await ticket.json()) as { ticket: string };
  const response = await call(`/ws/${body.ticket}`, {
    headers: { upgrade: 'websocket', 'user-agent': agent },
  });
  const ws = response.webSocket;
  if (!ws) throw new Error(`websocket upgrade failed: ${response.status}`);
  ws.accept();
  const messages = inbox(ws);
  ws.send(JSON.stringify({ type: 'hello', protocol: LIVE_PROTOCOL, token, device, clientNow: Date.now() }));
  const opened = await messages.waitFor((message) => message.type === 'snapshot' || message.type === 'error');
  expect(opened.type).toBe('snapshot');
  return { ws, messages };
}

describe('leave revokes only the caller', () => {
  it('rejects reconnect and hello, keeps the join code, and leaves the other phones up', async () => {
    const hostDevice = 'd43000001000000000000000000000000';
    const leavingDevice = 'd43000002000000000000000000000000';
    const stayingDevice = 'd43000003000000000000000000000000';
    const created = await createLive(hostDevice);
    const invite = await call(`/matches/${created.matchId}/invites`, {
      method: 'POST',
      headers: { authorization: `Bearer ${created.hostToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'player' }),
    });
    expect(invite.status).toBe(201);
    const shared = (await invite.json()) as { token: string; code: string };
    expect(typeof shared.code).toBe('string');

    const host = await openSocket(created.hostToken, hostDevice, IPHONE);
    const leavingJoin = await call('/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device: leavingDevice, code: shared.code }),
    });
    expect(leavingJoin.status).toBe(201);
    const leavingBody = (await leavingJoin.json()) as { token: string; ticket: string };
    expect(isJoinToken(leavingBody.token)).toBe(true);
    const leavingSocket = await call(`/ws/${leavingBody.ticket}`, {
      headers: { upgrade: 'websocket', 'user-agent': ANDROID },
    });
    const leavingWs = leavingSocket.webSocket;
    if (!leavingWs) throw new Error('leaving socket');
    leavingWs.accept();
    const leaving = inbox(leavingWs);
    leavingWs.send(JSON.stringify({
      type: 'hello',
      protocol: LIVE_PROTOCOL,
      token: leavingBody.token,
      device: leavingDevice,
      clientNow: Date.now(),
    }));
    expect((await leaving.waitFor((message) => message.type === 'snapshot' || message.type === 'error')).type).toBe('snapshot');

    const stayingJoin = await call('/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device: stayingDevice, code: shared.code }),
    });
    expect(stayingJoin.status).toBe(201);
    const stayingBody = (await stayingJoin.json()) as { token: string; ticket: string };
    const stayingSocket = await call(`/ws/${stayingBody.ticket}`, {
      headers: { upgrade: 'websocket', 'user-agent': IPHONE },
    });
    const stayingWs = stayingSocket.webSocket;
    if (!stayingWs) throw new Error('staying socket');
    stayingWs.accept();
    const staying = inbox(stayingWs);
    stayingWs.send(JSON.stringify({
      type: 'hello',
      protocol: LIVE_PROTOCOL,
      token: stayingBody.token,
      device: stayingDevice,
      clientNow: Date.now(),
    }));
    expect((await staying.waitFor((message) => message.type === 'snapshot' || message.type === 'error')).type).toBe('snapshot');

    const spare = await call('/join', {
      method: 'POST',
      headers: { authorization: `Bearer ${leavingBody.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ device: leavingDevice }),
    });
    expect(spare.status).toBe(201);
    const spareTicket = (await spare.json()) as { ticket: string };

    const missing = await call(`/matches/${created.matchId}/leave`, { method: 'POST' });
    expect(missing.status).toBe(401);

    const left = await call(`/matches/${created.matchId}/leave`, {
      method: 'POST',
      headers: { authorization: `Bearer ${leavingBody.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ device: stayingDevice, seat: 'host' }),
    });
    expect(left.status).toBe(200);
    expect(await left.json()).toEqual({ revoked: true });

    const reconnect = await call('/join', {
      method: 'POST',
      headers: { authorization: `Bearer ${leavingBody.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ device: leavingDevice }),
    });
    expect(reconnect.status).toBe(401);

    const again = await call(`/ws/${spareTicket.ticket}`, {
      headers: { upgrade: 'websocket', 'user-agent': ANDROID },
    });
    const againWs = again.webSocket;
    if (!againWs) throw new Error('hello socket');
    againWs.accept();
    const hello = inbox(againWs);
    againWs.send(JSON.stringify({
      type: 'hello',
      protocol: LIVE_PROTOCOL,
      token: leavingBody.token,
      device: leavingDevice,
      clientNow: Date.now(),
    }));
    const refused = await hello.waitFor((message) => message.type === 'error');
    expect(refused.code === 'revoked' || refused.code === 'bad_token').toBe(true);

    const redeemed = await call('/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device: leavingDevice, code: shared.code }),
    });
    expect(redeemed.status).toBe(201);

    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(host.messages.all().some((message) => message.type === 'error' && message.code === 'revoked')).toBe(false);
    expect(staying.all().some((message) => message.type === 'error' && message.code === 'revoked')).toBe(false);
    const still = await call('/join', {
      method: 'POST',
      headers: { authorization: `Bearer ${stayingBody.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ device: stayingDevice }),
    });
    expect(still.status).toBe(201);
    const hostStill = await call('/join', {
      method: 'POST',
      headers: { authorization: `Bearer ${created.hostToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ device: hostDevice }),
    });
    expect(hostStill.status).toBe(201);
  });

  it('rate-limits leave and does not revoke the shared code', async () => {
    const hostDevice = 'd43000011000000000000000000000000';
    const created = await createLive(hostDevice);
    const invite = await call(`/matches/${created.matchId}/invites`, {
      method: 'POST',
      headers: { authorization: `Bearer ${created.hostToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'player' }),
    });
    const shared = (await invite.json()) as { token: string; code: string };
    for (let attempt = 0; attempt < LEAVE_PER_ACTOR; attempt += 1) {
      const response = await call(`/matches/${created.matchId}/leave`, {
        method: 'POST',
        headers: { authorization: `Bearer ${shared.token}`, 'content-type': 'application/json' },
        body: '{}',
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ revoked: false });
    }
    const limited = await call(`/matches/${created.matchId}/leave`, {
      method: 'POST',
      headers: { authorization: `Bearer ${shared.token}`, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ error: 'leave_limited' });
    const redeemed = await call('/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device: 'd43000012000000000000000000000000', code: shared.code }),
    });
    expect(redeemed.status).toBe(201);
  });
});