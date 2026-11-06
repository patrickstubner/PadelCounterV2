import { LIVE_PROTOCOL, createMatch } from '@padel/core';
import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const ORIGIN = 'https://patrickstubner.github.io';
let ipCount = 40;

function call(path: string, init: RequestInit = {}): Promise<Response> {
  ipCount += 1;
  const headers = new Headers(init.headers);
  headers.set('origin', ORIGIN);
  headers.set('cf-connecting-ip', `198.51.100.${ipCount}`);
  return exports.default.fetch(new Request(`https://padel.example${path}`, { ...init, headers }));
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

async function showCode(matchId: string, token: string, rotate = false): Promise<{ status: number; token?: string; code?: string }> {
  const response = await call(`/matches/${matchId}/invites`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ role: 'player', ...(rotate ? { rotate: true } : {}) }),
  });
  const body = (await response.json()) as { token?: string; code?: string };
  return { status: response.status, token: body.token, code: body.code };
}

async function connect(token: string, device: string): Promise<{ ws: WebSocket; messages: ReturnType<typeof inbox> }> {
  const ticket = await call('/join', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ device }),
  });
  expect(ticket.status).toBe(201);
  const body = (await ticket.json()) as { ticket: string };
  const response = await call(`/ws/${body.ticket}`, { headers: { upgrade: 'websocket' } });
  const ws = response.webSocket;
  if (!ws) throw new Error(`websocket upgrade failed: ${response.status}`);
  ws.accept();
  const messages = inbox(ws);
  ws.send(JSON.stringify({ type: 'hello', protocol: LIVE_PROTOCOL, token, device, clientNow: Date.now() }));
  await messages.waitFor((message) => message.type === 'snapshot');
  return { ws, messages };
}

describe('shared connect and carry, 2.2.6', () => {
  it('lets a guest show the same code, stops at four phones, and revokes on a new code', async () => {
    const created = await createLive('d10000001000000000000000000000000');
    const first = await showCode(created.matchId, created.hostToken);
    expect(first.status).toBe(201);
    if (!first.token || !first.code) throw new Error('missing code');
    await connect(created.hostToken, 'd10000001000000000000000000000000');
    const guest = await connect(first.token, 'd10000002000000000000000000000000');
    const shown = await showCode(created.matchId, first.token);
    expect(shown.status).toBe(200);
    expect(shown.token).toBe(first.token);
    expect(shown.code).toBe(first.code);

    const stranger = await showCode(created.matchId, 'abcdefghijklmnopqrstuv');
    expect(stranger.status).toBe(401);

    const typed = await call('/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device: 'd10000003000000000000000000000000', code: first.code }),
    });
    expect(typed.status).toBe(201);
    const minted = (await typed.json()) as { token: string };
    const fromCode = await showCode(created.matchId, minted.token);
    expect(fromCode).toMatchObject({ status: 200, token: first.token, code: first.code });
    await connect(minted.token, 'd10000003000000000000000000000000');
    await connect(first.token, 'd10000004000000000000000000000000');

    const fullTicket = await call('/join', {
      method: 'POST',
      headers: { authorization: `Bearer ${first.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ device: 'd10000005000000000000000000000000' }),
    });
    expect(fullTicket.status).toBe(201);
    const fullBody = (await fullTicket.json()) as { ticket: string };
    const fullSocket = await call(`/ws/${fullBody.ticket}`, { headers: { upgrade: 'websocket' } });
    const ws = fullSocket.webSocket;
    if (!ws) throw new Error('socket');
    ws.accept();
    const messages = inbox(ws);
    ws.send(JSON.stringify({ type: 'hello', protocol: LIVE_PROTOCOL, token: first.token, device: 'd10000005000000000000000000000000', clientNow: Date.now() }));
    expect((await messages.waitFor((message) => message.type === 'error')).code).toBe('match_full');

    const rotated = await showCode(created.matchId, created.hostToken, true);
    expect(rotated.status).toBe(201);
    expect(rotated.token).not.toBe(first.token);
    expect(rotated.code).not.toBe(first.code);
    const old = await call('/join', {
      method: 'POST',
      headers: { authorization: `Bearer ${first.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ device: 'd10000006000000000000000000000000' }),
    });
    expect(old.status).toBe(401);
    expect((await guest.messages.waitFor((message) => message.type === 'error')).code).toBe('revoked');

    await env.DB.prepare('UPDATE credentials SET expires_at = ? WHERE token_hash = ?')
      .bind(1, await sha(rotated.token ?? ''))
      .run();
    const expired = await showCode(created.matchId, rotated.token ?? '');
    expect(expired.status).toBe(401);
  });

  it('moves three phones, including one that is offline, and does not move a stranger', async () => {
    const created = await createLive('d20000001000000000000000000000000');
    const invite = await showCode(created.matchId, created.hostToken);
    if (!invite.token) throw new Error('invite');
    const hostSocket = await connect(created.hostToken, 'd20000001000000000000000000000000');
    const online = await connect(invite.token, 'd20000002000000000000000000000000');
    const offline = await connect(invite.token, 'd20000003000000000000000000000000');
    offline.ws.close();
    const fourth = await connect(invite.token, 'd20000004000000000000000000000000');

    const base = createMatch(1_700_000_100_000);
    const next = await call('/matches', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        device: 'd20000001000000000000000000000000',
        log: { schemaVersion: 2, base, events: [] },
        previousHostToken: created.hostToken,
        carry: true,
      }),
    });
    expect(next.status).toBe(201);
    const createdNext = (await next.json()) as { matchId: string; hostToken: string };
    const carry = await call(`/matches/${createdNext.matchId}/carry`, {
      method: 'POST',
      headers: { authorization: `Bearer ${createdNext.hostToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: true, previousHostToken: created.hostToken, device: 'd20000001000000000000000000000000' }),
    });
    expect(carry.status).toBe(200);
    expect(await carry.json()).toMatchObject({ carried: 3 });

    const movedOnline = await online.messages.waitFor((message) => message.type === 'match_moved');
    const movedFourth = await fourth.messages.waitFor((message) => message.type === 'match_moved');
    expect(typeof movedOnline.token).toBe('string');
    expect(movedOnline.token).not.toBe(invite.token);
    expect(movedFourth.token).not.toBe(movedOnline.token);

    const back = await connect(invite.token, 'd20000003000000000000000000000000');
    const movedOffline = await back.messages.waitFor((message) => message.type === 'match_moved');
    expect(typeof movedOffline.token).toBe('string');
    await connect(String(movedOffline.token), 'd20000003000000000000000000000000');
    await connect(String(movedOnline.token), 'd20000002000000000000000000000000');

    hostSocket.ws.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const stranger = await connect(invite.token, 'd20000009000000000000000000000000');
    const notice = await stranger.messages.waitFor((message) => message.type === 'match_notice' || message.type === 'match_moved');
    expect(notice.type).toBe('match_notice');
    expect(JSON.stringify(notice)).not.toContain('token');
  });
});

async function sha(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
