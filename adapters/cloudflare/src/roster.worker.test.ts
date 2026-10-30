import { LIVE_PROTOCOL, createMatch } from '@padel/core';
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const ORIGIN = 'https://patrickstubner.github.io';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0';
const OTHER = 'SomePad/2.0';

let ipCount = 70;

function call(path: string, init: RequestInit = {}): Promise<Response> {
  ipCount += 1;
  const headers = new Headers(init.headers);
  headers.set('origin', ORIGIN);
  headers.set('cf-connecting-ip', `198.51.100.${ipCount}`);
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
            reject(new Error(`no roster message in ${JSON.stringify(messages)}`));
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

function assertSafe(message: Record<string, unknown>): void {
  const wire = JSON.stringify(message);
  expect(wire).not.toContain('Mozilla');
  expect(wire).not.toContain('Windows NT');
  expect(wire).not.toContain('userAgent');
  expect(wire).not.toContain('user-agent');
  expect(wire).not.toContain('198.51.100');
  expect(wire).not.toContain('token');
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

async function connect(token: string, device: string, agent: string): Promise<{
  ws: WebSocket;
  messages: ReturnType<typeof inbox>;
  roster: Record<string, unknown>;
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
  await messages.waitFor((message) => message.type === 'snapshot');
  const roster = await messages.waitFor((message) => message.type === 'roster');
  return { ws, messages, roster };
}

describe('connected phones', () => {
  it('lists two, three, and four phones, then one offline, without secrets', async () => {
    const created = await createLive('d41000001');
    const invite = await call(`/matches/${created.matchId}/invites`, {
      method: 'POST',
      headers: { authorization: `Bearer ${created.hostToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'player' }),
    });
    expect(invite.status).toBe(201);
    const shared = (await invite.json()) as { token: string };

    const host = await connect(created.hostToken, 'd41000001', DESKTOP);
    const second = await connect(shared.token, 'd41000002', IPHONE);
    const two = await host.messages.waitFor((message) => message.type === 'roster' && phonesOf(message).length === 2);
    assertSafe(two);
    assertSafe(second.roster);
    expect(phonesOf(two).filter((phone) => phone.self === true)).toHaveLength(1);
    expect(phonesOf(second.roster).filter((phone) => phone.self === true)).toHaveLength(1);
    expect(phonesOf(two).find((phone) => phone.self === true)?.kind).toBe('desktop');
    expect(phonesOf(second.roster).find((phone) => phone.self === true)?.kind).toBe('iphone');
    expect(phonesOf(two).every((phone) => phone.online === true)).toBe(true);

    const third = await connect(shared.token, 'd41000003', ANDROID);
    const three = await host.messages.waitFor((message) => message.type === 'roster' && phonesOf(message).length === 3);
    assertSafe(three);
    expect(phonesOf(third.roster).find((phone) => phone.self === true)?.kind).toBe('android');

    const fourth = await connect(shared.token, 'd41000004', OTHER);
    const four = await host.messages.waitFor((message) => message.type === 'roster' && phonesOf(message).length === 4);
    assertSafe(four);
    const selfSeat = phonesOf(fourth.roster).find((phone) => phone.self === true)?.seat;
    expect(phonesOf(fourth.roster).find((phone) => phone.self === true)?.kind).toBe('other');
    expect(phonesOf(four).filter((phone) => phone.online === true)).toHaveLength(4);

    fourth.ws.close();
    const after = await host.messages.waitFor((message) => {
      if (message.type !== 'roster') return false;
      return phonesOf(message).some((phone) => phone.seat === selfSeat && phone.online === false);
    });
    assertSafe(after);
    const offline = phonesOf(after).find((phone) => phone.seat === selfSeat);
    expect(offline?.online).toBe(false);
    expect(Number(offline?.seen)).toBeGreaterThanOrEqual(Number(offline?.since));
    expect(phonesOf(after).filter((phone) => phone.online === true)).toHaveLength(3);
    expect(phonesOf(after).filter((phone) => phone.self === true)).toHaveLength(1);

    const missing = await call(`/matches/${created.matchId}/phones`);
    expect(missing.status).toBe(404);
    const ticket = await call('/join', {
      method: 'POST',
      headers: { authorization: `Bearer ${created.hostToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ device: 'd41000009' }),
    });
    expect(ticket.status).toBe(201);
    const opened = (await ticket.json()) as { ticket: string };
    const strangerSocket = await call(`/ws/${opened.ticket}`, { headers: { upgrade: 'websocket', 'user-agent': IPHONE } });
    const stranger = strangerSocket.webSocket;
    if (!stranger) throw new Error('socket');
    stranger.accept();
    const strangerMessages = inbox(stranger);
    stranger.send(JSON.stringify({
      type: 'hello',
      protocol: LIVE_PROTOCOL,
      token: 'abcdefghijklmnopqrstuv',
      device: 'd41000009',
      clientNow: Date.now(),
    }));
    const error = await strangerMessages.waitFor((message) => message.type === 'error');
    expect(error.code).toBe('bad_token');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(strangerMessages.all().some((message) => message.type === 'roster')).toBe(false);
    expect(JSON.stringify(strangerMessages.all())).not.toContain('iphone');
  });
});
