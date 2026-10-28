import { createMatch } from '@padel/core';
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
  const headers = new Headers(init.headers);
  headers.set('origin', ORIGIN);
  headers.set('cf-connecting-ip', nextIp());
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
