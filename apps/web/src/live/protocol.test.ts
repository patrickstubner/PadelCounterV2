import { describe, expect, it } from 'vitest';
import { ROOM_MESSAGES } from '@padel/core';
import { JOIN_KEY, interpretMessage, isTerminalCode, isTerminalMessage, joinLink, matchCodeShareText, onlineRetryAllowed, parseJoinHash, readJoinToken, reconnectDelayMs, sendMatchCode, shouldResumeSocket, socketUrl, tokenFromJoinQr, unackedAfterSnapshot } from './protocol';

const ID = '00000000-0000-4000-8000-0000000000aa';
const TOKEN = 'abcdefghijklmnopqrstuv';

describe('sending a short code', () => {
  it('shares the code, copies it when sharing is missing, and ignores a cancelled share', async () => {
    const text = matchCodeShareText('K7M-42Q');
    expect(text).toBe('Join my padel match in Padel Counter. Code: K7M-42Q');
    expect(text).not.toContain('#/join');
    const share = async () => undefined;
    expect(await sendMatchCode('K7M-42Q', { share })).toBe('shared');
    const writeText = async () => undefined;
    expect(await sendMatchCode('K7M-42Q', { clipboard: { writeText } })).toBe('copied');
    let copied = false;
    expect(await sendMatchCode('K7M-42Q', {
      share: async () => {
        throw new DOMException('cancelled', 'AbortError');
      },
      clipboard: { writeText: async () => {
        copied = true;
      } },
    })).toBe('visible');
    expect(copied).toBe(false);
  });
});

describe('join links', () => {
  it('keeps the code in the fragment and parses only a 128-bit token', () => {
    const link = joinLink('https://patrickstubner.github.io/PadelCounterV2/', TOKEN);
    expect(link).toBe(`https://patrickstubner.github.io/PadelCounterV2/#/join?t=${TOKEN}`);
    expect(link).not.toContain(ID);
    expect(link.split('#')[0]).not.toContain(TOKEN);
    expect(parseJoinHash(`#/join?t=${TOKEN}`)).toEqual({ token: TOKEN });
    expect(parseJoinHash(`#/join/${ID}?t=${TOKEN}`)).toBeNull();
    expect(parseJoinHash('#/join?t=short')).toBeNull();
    const page = 'https://patrickstubner.github.io/PadelCounterV2/';
    expect(tokenFromJoinQr(link, page)).toBe(TOKEN);
    expect(tokenFromJoinQr(`${page}?t=${TOKEN}#/join?t=${TOKEN}`, page)).toBeNull();
    expect(tokenFromJoinQr(`https://evil.example/PadelCounterV2/#/join?t=${TOKEN}`, page)).toBeNull();
    expect(tokenFromJoinQr(`https://patrickstubner.github.io/PadelCounter/#/join?t=${TOKEN}`, page)).toBeNull();
    expect(tokenFromJoinQr(`https://user:secret@patrickstubner.github.io/PadelCounterV2/#/join?t=${TOKEN}`, page)).toBeNull();
    expect(tokenFromJoinQr('K7M-42Q', page)).toBeNull();
    expect(tokenFromJoinQr(`http://patrickstubner.github.io/PadelCounterV2/#/join?t=${TOKEN}`, page)).toBeNull();
    expect(joinLink('https://patrickstubner.github.io/PadelCounterV2/index.html?source=pwa', TOKEN)).toBe(link);
    expect(joinLink('https://patrickstubner.github.io/PadelCounterV2/index.html?source=pwa', TOKEN).split('#')[0]).not.toContain(TOKEN);
    expect(socketUrl('http://localhost:8787', TOKEN)).toBe(`ws://localhost:8787/ws/${TOKEN}`);
    expect(socketUrl('https://padel-counter.example.workers.dev/', TOKEN)).toBe(
      `wss://padel-counter.example.workers.dev/ws/${TOKEN}`,
    );
  });

  it('accepts a join link when the page query, index.html, or trailing slash differs', () => {
    const origin = 'https://patrickstubner.github.io';
    const base = `${origin}/PadelCounterV2/`;
    const link = `${base}#/join?t=${TOKEN}`;
    const pwa = `${base}?source=pwa`;
    const indexPage = `${origin}/PadelCounterV2/index.html?source=pwa`;
    expect(tokenFromJoinQr(link, pwa)).toBe(TOKEN);
    expect(tokenFromJoinQr(link, indexPage)).toBe(TOKEN);
    expect(tokenFromJoinQr(`${origin}/PadelCounterV2/index.html#/join?t=${TOKEN}`, pwa)).toBe(TOKEN);
    expect(tokenFromJoinQr(`${origin}/PadelCounterV2#/join?t=${TOKEN}`, base)).toBe(TOKEN);
    expect(tokenFromJoinQr(link, `${origin}/PadelCounterV2`)).toBe(TOKEN);
    expect(tokenFromJoinQr(`${base}?source=pwa#/join?t=${TOKEN}`, base)).toBe(TOKEN);
    expect(tokenFromJoinQr(`https://evil.example/PadelCounterV2/#/join?t=${TOKEN}`, pwa)).toBeNull();
    expect(tokenFromJoinQr(`https://patrickstubner.github.io.evil.example/PadelCounterV2/#/join?t=${TOKEN}`, pwa)).toBeNull();
    expect(tokenFromJoinQr(`${origin}/PadelCounter/#/join?t=${TOKEN}`, indexPage)).toBeNull();
    expect(tokenFromJoinQr(`${origin}/PadelCounterV2/other/#/join?t=${TOKEN}`, pwa)).toBeNull();
    expect(tokenFromJoinQr(`${base}?t=${TOKEN}#/join?t=${TOKEN}`, pwa)).toBeNull();
    expect(tokenFromJoinQr(`${base}?next=https://evil.example#/join?t=${TOKEN}`, pwa)).toBe(TOKEN);
    expect(tokenFromJoinQr(`${'java' + 'script:'}alert(1)`, pwa)).toBeNull();
    expect(tokenFromJoinQr('data:text/html,hello', pwa)).toBeNull();
    expect(tokenFromJoinQr(`${link}${'x'.repeat(2048)}`, pwa)).toBeNull();
    expect(tokenFromJoinQr(`https://user:secret@patrickstubner.github.io/PadelCounterV2/#/join?t=${TOKEN}`, pwa)).toBeNull();
  });

  it('accepts a one-tap reconnect offer and ignores a forged token', () => {
    expect(interpretMessage({ type: 'join_offer', token: TOKEN })).toEqual({ kind: 'join_offer', token: TOKEN });
    expect(interpretMessage({ type: 'join_offer', token: 'short' })).toEqual({ kind: 'ignore' });
    expect(interpretMessage({ type: 'match_moved', token: TOKEN })).toEqual({ kind: 'match_moved', token: TOKEN, seat: null });
    expect(interpretMessage({ type: 'match_moved', token: TOKEN, seat: 'p3' })).toEqual({ kind: 'match_moved', token: TOKEN, seat: 'p3' });
    const hiddenSeat = interpretMessage({ type: 'match_moved', token: TOKEN, seat: 'd' + 'a'.repeat(32) });
    expect(hiddenSeat.kind === 'match_moved' ? hiddenSeat.seat : 'kept').toBeNull();
    expect(interpretMessage({ type: 'match_moved', token: 'short' })).toEqual({ kind: 'ignore' });
    expect(interpretMessage({ type: 'match_notice', code: 'continued' })).toEqual({ kind: 'match_notice' });
    expect(interpretMessage({ type: 'match_notice', code: 'other', token: TOKEN })).toEqual({ kind: 'ignore' });
    const roster = interpretMessage({
      type: 'roster',
      phones: [{
        seat: 'p2',
        since: 10,
        seen: 20,
        online: true,
        kind: 'iphone',
        self: false,
        token: TOKEN,
        ip: '203.0.113.8',
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      }],
    });
    expect(roster).toEqual({
      kind: 'roster',
      phones: [{ seat: 'p2', since: 10, seen: 20, online: true, kind: 'iphone', self: false }],
    });
    expect(JSON.stringify(roster)).not.toContain(TOKEN);
    expect(JSON.stringify(roster)).not.toContain('203.0.113.8');
    expect(JSON.stringify(roster)).not.toContain('Mozilla');
    expect(interpretMessage({ type: 'roster', phones: [{ seat: 'p2', since: 10, seen: 20, online: true, kind: 'phone', self: false }] })).toEqual({ kind: 'ignore' });
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
    expect(reconnectDelayMs(3, true, 0)).toBeGreaterThanOrEqual(later);
    expect(onlineRetryAllowed(1_000, 2_500)).toBe(false);
    expect(onlineRetryAllowed(1_000, 3_000)).toBe(true);
    expect(isTerminalCode('bad_token')).toBe(true);
    expect(isTerminalCode('upgrade_required')).toBe(true);
    expect(isTerminalCode('unavailable')).toBe(false);
    expect(isTerminalCode('slow_down')).toBe(false);
    expect(isTerminalCode('score_kept')).toBe(false);
    expect(isTerminalMessage(ROOM_MESSAGES.score_kept)).toBe(false);
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

  it('keeps the host token when a join fragment arrives in that tab', () => {
    const storage = memoryStorage();
    const host = 'hhhhhhhhhhhhhhhhhhhhhh';
    const expiresAt = Date.now() + 60_000;
    storage.setItem(JOIN_KEY, JSON.stringify({ token: host, expiresAt, host: true, matchId: ID }));
    const history = { replaceState: () => undefined };
    const location = { hash: `#/join?t=${TOKEN}`, pathname: '/PadelCounterV2/', search: '' };
    expect(readJoinToken(location, history, storage)).toEqual({ ok: true, token: host });
    expect(JSON.parse(storage.getItem(JOIN_KEY) ?? '{}').token).toBe(host);
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
