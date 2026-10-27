import { describe, expect, it } from 'vitest';
import { ROOM_MESSAGES } from '@padel/core';
import { interpretMessage, joinLink, parseJoinHash, socketUrl } from './protocol';

const ID = '00000000-0000-4000-8000-0000000000aa';
const TOKEN = 'abcdefghijklmnopqrstuv';

describe('join links', () => {
  it('keeps the code in the fragment and parses only a 128-bit token', () => {
    const link = joinLink('https://patrickstubner.github.io/PadelCounterV2/', ID, TOKEN);
    expect(link).toBe(`https://patrickstubner.github.io/PadelCounterV2/#/join/${ID}?t=${TOKEN}`);
    expect(link.split('#')[0]).not.toContain(TOKEN);
    expect(parseJoinHash(`#/join/${ID}?t=${TOKEN}`)).toEqual({ matchId: ID, token: TOKEN });
    expect(parseJoinHash(`#/join/${ID}?t=short`)).toBeNull();
    expect(parseJoinHash('#/join/not-a-match?t=' + TOKEN)).toBeNull();
    expect(socketUrl('http://localhost:8787', ID)).toBe(`ws://localhost:8787/matches/${ID}/ws`);
    expect(socketUrl('https://padel-counter.example.workers.dev/', ID)).toBe(
      `wss://padel-counter.example.workers.dev/matches/${ID}/ws`,
    );
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
