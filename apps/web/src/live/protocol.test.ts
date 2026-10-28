import { describe, expect, it } from 'vitest';
import { ROOM_MESSAGES } from '@padel/core';
import { JOIN_KEY, interpretMessage, isTerminalCode, isTerminalMessage, joinLink, parseJoinHash, readJoinToken, reconnectDelayMs, shouldResumeSocket, socketUrl, unackedAfterSnapshot } from './protocol';

const ID = '00000000-0000-4000-8000-0000000000aa';
const TOKEN = 'abcdefghijklmnopqrstuv';

describe('join links', () => {
  it('keeps the code in the fragment and parses only a 128-bit token', () => {
    const link = joinLink('https://patrickstubner.github.io/PadelCounterV2/', TOKEN);
    expect(link).toBe(`https://patrickstubner.github.io/PadelCounterV2/#/join?t=${TOKEN}`);
    expect(link).not.toContain(ID);
    expect(link.split('#')[0]).not.toContain(TOKEN);
    expect(parseJoinHash(`#/join?t=${TOKEN}`)).toEqual({ token: TOKEN });
    expect(parseJoinHash(`#/join/${ID}?t=${TOKEN}`)).toBeNull();
    expect(parseJoinHash('#/join?t=short')).toBeNull();
    expect(socketUrl('http://localhost:8787', TOKEN)).toBe(`ws://localhost:8787/ws/${TOKEN}`);
    expect(socketUrl('https://padel-counter.example.workers.dev/', TOKEN)).toBe(
      `wss://padel-counter.example.workers.dev/ws/${TOKEN}`,
    );
  });

  it('accepts a one-tap reconnect offer and ignores a forged token', () => {
    expect(interpretMessage({ type: 'join_offer', token: TOKEN })).toEqual({ kind: 'join_offer', token: TOKEN });
    expect(interpretMessage({ type: 'join_offer', token: 'short' })).toEqual({ kind: 'ignore' });
  });

  it('shows the fixed full-match sentence and ignores a forged message', () => {
    const notice = interpretMessage({
      type: 'error',
      code: 'match_full',
      message: '<img src=x onerror=alert(1)>',
    });
    expect(notice).toEqual({ kind: 'error', code: 'match_full', message: ROOM_MESSAGES.match_full, close: true, eventId: null });
    expect(interpretMessage({ type: 'error', code: 'spectator_not_available' })).toEqual({
      kind: 'error',
      code: 'spectator_not_available',
      message: 'View-only links are not available yet.',
      close: true,
      eventId: null,
    });
    expect(interpretMessage({ type: 'error', code: 'nope', message: 'secret internals' })).toEqual({
      kind: 'error',
      code: null,
      message: 'The live match did not accept that.',
      close: false,
      eventId: null,
    });
    expect(interpretMessage({
      type: 'error',
      code: 'not_applied',
      eventId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
    })).toMatchObject({ eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', close: false });
  });

  it('keeps the socket open for a rejected score and applies an event without the log', () => {
    expect(interpretMessage({ type: 'error', code: 'not_applied', message: 'raw' })).toEqual({
      kind: 'error',
      code: 'not_applied',
      message: 'That change was not applied.',
      close: false,
      eventId: null,
    });
    expect(interpretMessage({ type: 'error', code: 'bad_token' }).kind === 'error' && interpretMessage({ type: 'error', code: 'bad_token' })).toMatchObject({
      close: true,
    });
    const eventId = '00000000-0000-4000-8000-0000000000cc';
    const notice = interpretMessage({
      type: 'event',
      eventId,
      duplicate: false,
      players: 2,
      log: { schemaVersion: 2, base: { matchId: ID }, events: [{ type: 'game/increment', team: 'b', at: 1 }] },
      event: { type: 'game/increment', team: 'a', at: 1_700_000_000_000 },
    });
    expect(notice).toEqual({
      kind: 'delta',
      eventId,
      duplicate: false,
      players: 2,
      event: { type: 'game/increment', team: 'a', at: 1_700_000_000_000 },
    });
    expect(notice).not.toHaveProperty('log');
  });
});

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => {
      map.delete(key);
    },
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

describe('pending live points', () => {
  it('resends only this match and backs off with jitter', () => {
    const first = { id: 'a', event: 1, token: 't', matchId: '' };
    const other = { id: 'b', event: 2, token: 'other', matchId: '' };
    const done = { id: 'c', event: 3, token: 't', matchId: 'match' };
    expect(unackedAfterSnapshot([first, other, done], 't', 'match', ['c'])).toEqual([
      { id: 'a', event: 1, token: 't', matchId: 'match' },
    ]);
    const slow = reconnectDelayMs(0, true, 0);
    const fast = reconnectDelayMs(0, false, 0);
    const later = reconnectDelayMs(3, false, 0);
    expect(slow).toBeGreaterThanOrEqual(2_000);
    expect(later).toBeGreaterThan(fast);
    expect(reconnectDelayMs(0, false, 1)).toBeGreaterThan(fast);
    expect(isTerminalCode('bad_token')).toBe(true);
    expect(isTerminalCode('upgrade_required')).toBe(true);
    expect(isTerminalCode('unavailable')).toBe(false);
    expect(isTerminalCode('slow_down')).toBe(false);
    expect(isTerminalMessage(ROOM_MESSAGES.revoked)).toBe(true);
    expect(isTerminalMessage(ROOM_MESSAGES.offline)).toBe(false);
    expect(isTerminalMessage(ROOM_MESSAGES.spectator_not_available)).toBe(true);
  });
});

describe('socket resume', () => {
  it('waits while the page is hidden and resumes when the socket is gone', () => {
    expect(shouldResumeSocket('hidden', null, false)).toBe(false);
    expect(shouldResumeSocket('visible', 1, false)).toBe(false);
    expect(shouldResumeSocket('visible', 0, false)).toBe(false);
    expect(shouldResumeSocket('visible', null, true)).toBe(false);
    expect(shouldResumeSocket('visible', null, false)).toBe(true);
    expect(shouldResumeSocket('visible', 3, false)).toBe(true);
  });
});

describe('scanned join url', () => {
  it('removes a valid token from the url and keeps it only for this tab', () => {
    const storage = memoryStorage();
    const calls: unknown[][] = [];
    const history = {
      replaceState: (...args: unknown[]) => {
        calls.push(args);
      },
    };
    const location = { hash: `#/join?t=${TOKEN}`, pathname: '/PadelCounterV2/', search: '' };
    expect(readJoinToken(location, history, storage)).toEqual({ ok: true, token: TOKEN });
    expect(calls).toEqual([[{ padelArchive: 'court' }, '', '/PadelCounterV2/']]);
    expect(JSON.stringify(calls)).not.toContain(TOKEN);
    expect(JSON.parse(storage.getItem(JOIN_KEY) ?? '{}')).toEqual({ token: TOKEN });
    location.hash = '';
    expect(readJoinToken(location, history, storage)).toEqual({ ok: true, token: TOKEN });
    expect(calls).toHaveLength(1);
  });

  it('drops a stored token whose expiry has passed', () => {
    const storage = memoryStorage();
    const history = { replaceState: () => undefined };
    const location = { hash: '', pathname: '/PadelCounterV2/', search: '' };
    storage.setItem(JOIN_KEY, JSON.stringify({ token: TOKEN, expiresAt: Date.now() - 1 }));
    expect(readJoinToken(location, history, storage)).toEqual({ ok: false, invalid: true });
    expect(storage.getItem(JOIN_KEY)).toBeNull();
  });

  it('drops an invalid invite fragment and does not keep it', () => {
    const storage = memoryStorage();
    const calls: unknown[][] = [];
    const history = {
      replaceState: (...args: unknown[]) => {
        calls.push(args);
      },
    };
    const location = { hash: '#/join?t=short', pathname: '/PadelCounterV2/', search: '?ok=1' };
    expect(readJoinToken(location, history, storage)).toEqual({ ok: false, invalid: true });
    expect(calls).toEqual([[{ padelArchive: 'court' }, '', '/PadelCounterV2/?ok=1']]);
    expect(storage.getItem(JOIN_KEY)).toBeNull();
    storage.setItem(JOIN_KEY, JSON.stringify({ token: '<img src=x>' }));
    location.hash = '';
    expect(readJoinToken(location, history, storage)).toEqual({ ok: false, invalid: true });
    expect(storage.getItem(JOIN_KEY)).toBeNull();
  });

  it('keeps a valid token when storage is missing and still strips the url', () => {
    const calls: unknown[][] = [];
    const history = {
      replaceState: (...args: unknown[]) => {
        calls.push(args);
      },
    };
    const location = { hash: `#/join?t=${TOKEN}`, pathname: '/PadelCounterV2/', search: '' };
    expect(readJoinToken(location, history, null)).toEqual({ ok: true, token: TOKEN });
    expect(calls).toEqual([[{ padelArchive: 'court' }, '', '/PadelCounterV2/']]);
    expect(JSON.stringify(calls)).not.toContain(TOKEN);
  });
});
