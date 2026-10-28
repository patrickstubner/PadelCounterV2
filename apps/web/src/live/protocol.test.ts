import { describe, expect, it } from 'vitest';
import { ROOM_MESSAGES } from '@padel/core';
import { JOIN_KEY, interpretMessage, joinLink, parseJoinHash, readJoinToken, socketUrl } from './protocol';

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
    expect(notice).toEqual({ kind: 'error', message: ROOM_MESSAGES.match_full, close: true });
    expect(interpretMessage({ type: 'error', code: 'spectator_not_available' })).toEqual({
      kind: 'error',
      message: 'View-only links are not available yet.',
      close: true,
    });
    expect(interpretMessage({ type: 'error', code: 'nope', message: 'secret internals' })).toEqual({
      kind: 'error',
      message: 'The live match did not accept that.',
      close: false,
    });
  });

  it('keeps the socket open for a rejected score and applies an event without the log', () => {
    expect(interpretMessage({ type: 'error', code: 'not_applied', message: 'raw' })).toEqual({
      kind: 'error',
      message: 'That change was not applied.',
      close: false,
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
});
