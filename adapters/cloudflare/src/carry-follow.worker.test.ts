import { LIVE_PROTOCOL, createMatch, matchReducer, parseMatchLog, replayScore, scoreClaimFor, type MatchEvent, type MatchState, type TeamId } from '@padel/core';
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const ORIGIN = 'https://patrickstubner.github.io';
const T0 = 1_700_000_000_000;
let ipCount = 80;

function call(path: string, init: RequestInit = {}): Promise<Response> {
  ipCount += 1;
  const headers = new Headers(init.headers);
  headers.set('origin', ORIGIN);
  headers.set('cf-connecting-ip', `203.0.113.${ipCount}`);
  return exports.default.fetch(new Request(`https://padel.example${path}`, { ...init, headers }));
}

interface Inbox {
  waitFor(match: (message: Record<string, unknown>) => boolean): Promise<Record<string, unknown>>;
  all(): Record<string, unknown>[];
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

function seeded(sides: readonly TeamId[]): { state: MatchState; log: { schemaVersion: 2; base: MatchState; events: MatchEvent[] } } {
  const base = createMatch(T0);
  let state = base;
  const events: MatchEvent[] = [];
  for (const team of sides) {
    const event: MatchEvent = { type: 'game/increment', team, at: T0 + events.length + 1 };
    events.push(event);
    state = matchReducer(state, event);
  }
  return { state, log: { schemaVersion: 2, base, events } };
}

async function postMatch(
  device: string,
  log: { schemaVersion: 2; base: MatchState; events: readonly MatchEvent[] },
  previousHostToken?: string,
): Promise<{ matchId: string; hostToken: string }> {
  const response = await call('/matches', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      device,
      log,
      ...(previousHostToken ? { previousHostToken, carry: true } : {}),
    }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { matchId: string; hostToken: string };
}

async function showCode(matchId: string, token: string, rotate = false): Promise<number> {
  const response = await call(`/matches/${matchId}/invites`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ role: 'player', ...(rotate ? { rotate: true } : {}) }),
  });
  return response.status;
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

function clientLog(
  log: { schemaVersion: 2; base: MatchState; events: readonly MatchEvent[] },
  endAt: number,
): { schemaVersion: 2; base: MatchState; events: MatchEvent[] } {
  const end: MatchEvent = { type: 'match/end', at: endAt, by: 'host' };
  const created: MatchEvent = { type: 'match/new', matchId: crypto.randomUUID(), at: endAt + 1, by: 'host' };
  return { schemaVersion: 2, base: log.base, events: [...log.events, end, created] };
}

function freshBoard(snapshot: Record<string, unknown>): { ended: boolean; games: number } {
  const parsed = parseMatchLog(snapshot.log);
  if (!parsed) throw new Error('snapshot log');
  const state = replayScore(parsed.base, parsed.events);
  const games = state.sets.reduce((sum, set) => sum + set.a + set.b, 0);
  return { ended: state.ended, games };
}

async function openCourt(hostDevice: string, guestDevice: string, sides: readonly TeamId[]) {
  const first = seeded(sides);
  const created = await postMatch(hostDevice, first.log);
  const host = await connect(created.hostToken, hostDevice);
  const invite = await call(`/matches/${created.matchId}/invites`, {
    method: 'POST',
    headers: { authorization: `Bearer ${created.hostToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ role: 'player' }),
  });
  expect(invite.status).toBe(201);
  const shared = (await invite.json()) as { token: string };
  const guest = await connect(shared.token, guestDevice);
  return { created, host, guest, shared: shared.token, first };
}

describe('carry is not stopped by the shared address cap', () => {
  it('accepts carry after twenty other match requests from the same address', async () => {
    const ip = '198.51.100.77';
    const fixed = (path: string, init: RequestInit = {}): Promise<Response> => {
      const headers = new Headers(init.headers);
      headers.set('origin', ORIGIN);
      headers.set('cf-connecting-ip', ip);
      return exports.default.fetch(new Request(`https://padel.example${path}`, { ...init, headers }));
    };
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await fixed('/join', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      expect(response.status).not.toBe(429);
    }
    const blocked = await fixed('/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(blocked.status).toBe(429);
    const carry = await fixed('/matches/11111111-1111-4111-8111-111111111111/carry', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer abcdefghijklmnopqrstuv',
      },
      body: JSON.stringify({ confirm: true, previousHostToken: 'abcdefghijklmnopqrstuv' }),
    });
    expect(carry.status).not.toBe(429);
  });
});

describe('carry follows the phones that already joined', () => {
  it('takes a guest into the next match after a win, even after the new code is published', async () => {
    const hostDevice = 'd91000001000000000000000000000000';
    const guestDevice = 'd91000002000000000000000000000000';
    const court = await openCourt(hostDevice, guestDevice, [...Array.from({ length: 6 }, () => 'a' as const), ...Array.from({ length: 6 }, () => 'a' as const)]);
    const end: MatchEvent = { type: 'match/end', at: T0 + 80, by: 'host' };
    send(court.host.ws, court.first.state, end);
    await court.guest.messages.waitFor((message) => message.type === 'event' && (message.event as { type?: string }).type === 'match/end');
    court.host.ws.close();

    const next = await postMatch(hostDevice, clientLog(court.first.log, T0 + 80), court.created.hostToken);
    const carry = await call(`/matches/${next.matchId}/carry`, {
      method: 'POST',
      headers: { authorization: `Bearer ${next.hostToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: true, previousHostToken: court.created.hostToken }),
    });
    expect(carry.status).toBe(200);
    expect(await carry.json()).toMatchObject({ carried: 1 });
    const moved = await court.guest.messages.waitFor((message) => message.type === 'match_moved');
    expect(typeof moved.token).toBe('string');

    expect(await showCode(next.matchId, next.hostToken)).toBe(201);
    const followed = await connect(String(moved.token), guestDevice);
    const board = freshBoard(await followed.messages.waitFor((message) => message.type === 'snapshot'));
    expect(board).toEqual({ ended: false, games: 0 });

    expect(await showCode(next.matchId, next.hostToken, true)).toBe(201);
    const kicked = await followed.messages.waitFor((message) => message.type === 'error');
    expect(kicked.code).toBe('revoked');
  });

  it('takes a guest after an early end, and publishing the code does not drop a phone that already followed', async () => {
    const hostDevice = 'd92000001000000000000000000000000';
    const guestDevice = 'd92000002000000000000000000000000';
    const court = await openCourt(hostDevice, guestDevice, ['a', 'b']);
    const end: MatchEvent = { type: 'match/end', at: T0 + 20, by: 'host' };
    send(court.host.ws, court.first.state, end);
    await court.guest.messages.waitFor((message) => message.type === 'event' && (message.event as { type?: string }).type === 'match/end');
    court.host.ws.close();

    const next = await postMatch(hostDevice, clientLog(court.first.log, T0 + 20), court.created.hostToken);
    const carry = await call(`/matches/${next.matchId}/carry`, {
      method: 'POST',
      headers: { authorization: `Bearer ${next.hostToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: true, previousHostToken: court.created.hostToken }),
    });
    expect(carry.status).toBe(200);
    const moved = await court.guest.messages.waitFor((message) => message.type === 'match_moved');
    const followed = await connect(String(moved.token), guestDevice);
    const before = await followed.messages.waitFor((message) => message.type === 'roster');
    const since = (before.phones as { self?: boolean; since?: number }[]).find((phone) => phone.self)?.since;
    expect(typeof since).toBe('number');
    expect(await showCode(next.matchId, next.hostToken)).toBe(201);
    followed.ws.close();
    const again = await connect(String(moved.token), guestDevice);
    const after = await again.messages.waitFor((message) => message.type === 'roster');
    const sinceAgain = (after.phones as { self?: boolean; since?: number }[]).find((phone) => phone.self)?.since;
    expect(sinceAgain).toBe(since);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(followed.messages.all().some((message) => message.type === 'error' && message.code === 'revoked')).toBe(false);
    const board = freshBoard(followed.messages.all().find((message) => message.type === 'snapshot') ?? {});
    expect(board.ended).toBe(false);
  });

  it('carries an offline guest when it reconnects, then carries that phone a second time', async () => {
    const hostDevice = 'd93000001000000000000000000000000';
    const guestDevice = 'd93000002000000000000000000000000';
    const court = await openCourt(hostDevice, guestDevice, ['a']);
    court.guest.ws.close();
    const end: MatchEvent = { type: 'match/end', at: T0 + 10, by: 'host' };
    send(court.host.ws, court.first.state, end);
    court.host.ws.close();

    const next = await postMatch(hostDevice, clientLog(court.first.log, T0 + 10), court.created.hostToken);
    const carry = await call(`/matches/${next.matchId}/carry`, {
      method: 'POST',
      headers: { authorization: `Bearer ${next.hostToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: true, previousHostToken: court.created.hostToken }),
    });
    expect(carry.status).toBe(200);
    expect(await showCode(next.matchId, next.hostToken)).toBe(201);
    const back = await connect(court.shared, guestDevice);
    const moved = await back.messages.waitFor((message) => message.type === 'match_moved' || message.type === 'match_notice');
    expect(moved.type).toBe('match_moved');
    const followed = await connect(String(moved.token), guestDevice);
    expect(freshBoard(followed.messages.all().find((message) => message.type === 'snapshot') ?? {}).ended).toBe(false);

    const host = await connect(next.hostToken, hostDevice);
    const secondEnd: MatchEvent = { type: 'match/end', at: T0 + 30, by: 'host' };
    const empty = createMatch(T0 + 30);
    send(host.ws, empty, secondEnd);
    await followed.messages.waitFor((message) => message.type === 'event' && (message.event as { type?: string }).type === 'match/end');
    host.ws.close();
    const third = await postMatch(hostDevice, clientLog({ schemaVersion: 2, base: empty, events: [] }, T0 + 30), next.hostToken);
    const again = await call(`/matches/${third.matchId}/carry`, {
      method: 'POST',
      headers: { authorization: `Bearer ${third.hostToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: true, previousHostToken: next.hostToken }),
    });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ carried: 1 });
    expect(await showCode(third.matchId, third.hostToken)).toBe(201);
    const movedAgain = await followed.messages.waitFor((message) => message.type === 'match_moved');
    const twice = await connect(String(movedAgain.token), guestDevice);
    expect(freshBoard(twice.messages.all().find((message) => message.type === 'snapshot') ?? {})).toEqual({ ended: false, games: 0 });
  });
});
