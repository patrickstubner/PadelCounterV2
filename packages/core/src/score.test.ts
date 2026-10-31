import { describe, expect, it } from 'vitest';
import { isValidStoredName, parseLiveTeamName, sanitizeTeamName } from './names';
import { connectionCloses } from './messages';
import { createMatch, assignMatchId, matchReducer, replayScore } from './reducer';
import { canScoreGame, matchWinner, setWinner } from './rules';
import { parseMatchLog, parseStoredEvent } from './parse';
import type { MatchEvent } from './types';

const T0 = 1_700_000_000_000;

describe('scoring without undo', () => {
  it('counts games, closes a set at 6 with a two-game lead, and opens the next set', () => {
    let state = createMatch(T0);
    for (let i = 0; i < 6; i += 1) {
      state = matchReducer(state, { type: 'game/increment', team: 'a', at: T0 + i + 1 });
    }
    expect(state.sets[0]).toEqual({ a: 6, b: 0 });
    expect(setWinner(6, 0)).toBe('a');
    expect(state.activeSet).toBe(1);
    expect(matchWinner(state.sets)).toBeNull();
  });

  it('records a tiebreak as one game and keeps a third set from changing a decided winner', () => {
    let state = createMatch(T0);
    const winSet = (team: 'a' | 'b', start: number) => {
      for (let i = 0; i < 6; i += 1) {
        state = matchReducer(state, { type: 'game/increment', team, at: start + i });
      }
    };
    winSet('a', T0 + 1);
    winSet('a', T0 + 20);
    expect(matchWinner(state.sets)).toBe('a');
    state = matchReducer(state, { type: 'set/select', index: 2, at: T0 + 40 });
    state = matchReducer(state, { type: 'game/increment', team: 'b', at: T0 + 41 });
    expect(state.sets[2]).toEqual({ a: 0, b: 1 });
    expect(matchWinner(state.sets)).toBe('a');
  });

  it('replays a stored plus on a finished set the same way, even when a new plus is closed', () => {
    const base = createMatch(T0);
    const onFinished: MatchEvent[] = [];
    let at = T0;
    for (let i = 0; i < 6; i += 1) onFinished.push({ type: 'game/increment', team: 'a', at: ++at });
    onFinished.push({ type: 'set/select', index: 0, at: ++at });
    const beforePlus = replayScore(base, onFinished);
    expect(beforePlus.sets[0]).toEqual({ a: 6, b: 0 });
    expect(canScoreGame(beforePlus, 'b')).toBe(false);
    onFinished.push({ type: 'game/increment', team: 'b', at: at + 1 });
    const replayed = replayScore(base, onFinished);
    expect(replayed.sets[0]).toEqual({ a: 6, b: 1 });
    expect(replayScore(base, onFinished).sets).toEqual(replayed.sets);

    const decided: MatchEvent[] = [];
    at = T0;
    for (let i = 0; i < 12; i += 1) decided.push({ type: 'game/increment', team: 'a', at: ++at });
    decided.push({ type: 'set/select', index: 2, at: ++at });
    const openThird = replayScore(base, decided);
    expect(matchWinner(openThird.sets)).toBe('a');
    expect(openThird.sets[2]).toEqual({ a: 0, b: 0 });
    expect(canScoreGame(openThird, 'b')).toBe(false);
    decided.push({ type: 'game/increment', team: 'b', at: at + 1 });
    const withThird = replayScore(base, decided);
    expect(withThird.sets[1]).toEqual({ a: 6, b: 0 });
    expect(withThird.sets[2]).toEqual({ a: 0, b: 1 });
    expect(replayScore(base, decided)).toEqual(withThird);
  });

  it('corrects a finished 6:0 set to 5:1 without dropping the earlier events', () => {
    let state = createMatch(T0);
    const events = [];
    for (let i = 0; i < 6; i += 1) {
      const event = { type: 'game/increment' as const, team: 'a' as const, at: T0 + i + 1, by: 'host' };
      events.push(event);
      state = matchReducer(state, event);
    }
    expect(state.activeSet).toBe(1);
    expect(state.sets[0]).toEqual({ a: 6, b: 0 });
    const taken = { type: 'game/decrement' as const, team: 'a' as const, at: T0 + 7, by: 'p2' };
    const given = { type: 'game/increment' as const, team: 'b' as const, at: T0 + 8, by: 'p2' };
    state = matchReducer(state, taken);
    expect(state.activeSet).toBe(0);
    expect(state.sets[0]).toEqual({ a: 5, b: 0 });
    state = matchReducer(state, given);
    expect(state.sets[0]).toEqual({ a: 5, b: 1 });
    const log = [...events, taken, given];
    expect(log).toHaveLength(8);
    expect(log.filter((event) => event.type === 'game/increment')).toHaveLength(7);
    expect(replayScore(createMatch(T0), log).sets[0]).toEqual({ a: 5, b: 1 });
  });

  it('uses minus as the correction and ignores a score that is not a padel set', () => {
    let state = createMatch(T0);
    state = matchReducer(state, { type: 'game/increment', team: 'a', at: T0 + 1 });
    state = matchReducer(state, { type: 'game/decrement', team: 'a', at: T0 + 2 });
    expect(state.sets[0]).toEqual({ a: 0, b: 0 });
    const stuck = matchReducer(state, { type: 'game/decrement', team: 'a', at: T0 + 3 });
    expect(stuck).toBe(state);
    const events = [
      { type: 'game/increment', team: 'a', at: T0 + 1 },
      { type: 'game/increment', team: 'b', at: T0 + 2 },
    ] as const;
    expect(replayScore(createMatch(T0), events).sets[0]).toEqual({ a: 1, b: 1 });
  });

  it('rejects an undo payload and an impossible set', () => {
    expect(parseStoredEvent({ type: 'undo', at: T0 })).toBeNull();
    expect(parseStoredEvent({ type: 'game/increment', team: 'a', at: T0 })).toEqual({
      type: 'game/increment',
      team: 'a',
      at: T0,
    });
    const base = createMatch(T0);
    const tampered = {
      schemaVersion: 2,
      base: { ...base, sets: [{ a: 7, b: 4 }, base.sets[1], base.sets[2]] },
      events: [],
    };
    expect(parseMatchLog(tampered)).toBeNull();
  });

  it('stores a rename only after sanitizeTeamName, capped at 24 characters', () => {
    const event = parseStoredEvent({
      type: 'team/rename',
      team: 'a',
      name: '  Lobos\u0007 extra characters beyond twenty',
      at: T0,
    });
    expect(event).toMatchObject({ type: 'team/rename', team: 'a' });
    if (!event || event.type !== 'team/rename') return;
    expect(event.name).toBe('Lobos extra characters b');
    expect([...event.name].length).toBeLessThanOrEqual(24);
    expect(event.name).not.toContain('\u0007');
  });
});

describe('server match id', () => {
  it('replaces the current match id and keeps the score', () => {
    const clientId = '00000000-0000-4000-8000-0000000000aa';
    const serverId = '00000000-0000-4000-8000-0000000000bb';
    let base = createMatch(T0, clientId);
    base = matchReducer(base, { type: 'game/increment', team: 'a', at: T0 + 1 });
    const log = {
      schemaVersion: 2 as const,
      base: createMatch(T0, clientId),
      events: [{ type: 'game/increment' as const, team: 'a' as const, at: T0 + 1 }],
    };
    const assigned = assignMatchId(log, serverId);
    expect(assigned).not.toBeNull();
    if (!assigned) return;
    const played = replayScore(assigned.base, assigned.events);
    expect(played.matchId).toBe(serverId);
    expect(played.sets[0]).toEqual(base.sets[0]);
    expect(JSON.stringify(assigned)).not.toContain(clientId);
  });

  it('rewrites only the id replay currently shows, so a chain keeps the earlier id on base', () => {
    const earlier = '00000000-0000-4000-8000-0000000000aa';
    const clientNext = '00000000-0000-4000-8000-0000000000cc';
    const serverId = '00000000-0000-4000-8000-0000000000bb';
    const log = {
      schemaVersion: 2 as const,
      base: createMatch(T0, earlier),
      events: [
        { type: 'game/increment' as const, team: 'a' as const, at: T0 + 1 },
        { type: 'match/end' as const, at: T0 + 2 },
        { type: 'match/new' as const, matchId: clientNext, at: T0 + 3 },
      ],
    };
    const assigned = assignMatchId(log, serverId);
    expect(assigned).not.toBeNull();
    if (!assigned) return;
    expect(assigned.base.matchId).toBe(earlier);
    const created = assigned.events[assigned.events.length - 1];
    expect(created).toMatchObject({ type: 'match/new', matchId: serverId });
    expect(replayScore(assigned.base, assigned.events).matchId).toBe(serverId);
    expect(JSON.stringify(assigned)).not.toContain(clientNext);
  });
});

describe('socket close policy', () => {
  it('closes on auth failures and leaves a bad event open', () => {
    expect(connectionCloses('bad_token')).toBe(true);
    expect(connectionCloses('expired')).toBe(true);
    expect(connectionCloses('revoked')).toBe(true);
    expect(connectionCloses('removed')).toBe(true);
    expect(connectionCloses('join_removed')).toBe(false);
    expect(connectionCloses('spectator_not_available')).toBe(true);
    expect(connectionCloses('match_full')).toBe(true);
    expect(connectionCloses('not_applied')).toBe(false);
    expect(connectionCloses('forbidden')).toBe(false);
    expect(connectionCloses('slow_down')).toBe(false);
    expect(connectionCloses('kick_refused')).toBe(false);
    expect(connectionCloses('kick_limited')).toBe(false);
    expect(connectionCloses('leave_limited')).toBe(false);
    expect(connectionCloses('join_device_limit')).toBe(false);
    expect(connectionCloses('join_network_limit')).toBe(false);
    expect(connectionCloses('invalid_device')).toBe(false);
  });
});

describe('live team names', () => {
  it('accepts a trimmed name of 24 characters and refuses controls or a longer name', () => {
    const full = 'L'.repeat(24);
    expect(parseLiveTeamName(`  ${full}  `)).toBe(full);
    expect(parseLiveTeamName(`${full}X`)).toBeNull();
    expect(parseLiveTeamName('Lobos\n')).toBeNull();
    expect(parseLiveTeamName('')).toBeNull();
    expect(parseLiveTeamName(12)).toBeNull();
    expect(parseLiveTeamName('\u3164')).toBeNull();
    expect(parseLiveTeamName('\u115F')).toBeNull();
    expect(parseLiveTeamName('\u2800\u2800')).toBeNull();
    expect(parseLiveTeamName('\uFE0F\uFE0F')).toBeNull();
    expect(parseLiveTeamName('\u{E0100}')).toBeNull();
    expect(parseLiveTeamName(`A${'\u0301'.repeat(8)}`)).toBeNull();
    expect(parseLiveTeamName('A\u0301')).toBe('Á');
    expect(parseLiveTeamName('❤️')).toBe('❤️');
    const kept = matchReducer(createMatch(T0), { type: 'team/rename', team: 'a', name: full, at: T0 + 1 });
    expect(kept.teams.a.name).toBe(full);
    const local = matchReducer(createMatch(T0), {
      type: 'team/rename',
      team: 'b',
      name: `  ${'W'.repeat(30)}\u0007`,
      at: T0 + 1,
    });
    expect([...local.teams.b.name].length).toBeLessThanOrEqual(24);
    expect(local.teams.b.name).not.toContain('\u0007');
  });

  it('keeps Hindi, Thai, Arabic, and Hebrew names and refuses a stack of marks', () => {
    const names = [
      'भारतीय टीम',
      'ऑस्ट्रेलिया',
      'สวัสดีครับ',
      'বাংলাদেশ',
      'مَرْحَبًا',
      'שָׁלוֹם',
      'ทีมไทย',
      'नमस्ते',
    ];
    for (const name of names) {
      expect(name.normalize('NFC')).toBe(name);
      expect(parseLiveTeamName(name)).toBe(name);
      expect(sanitizeTeamName(name, 'a')).toBe(name);
      expect(sanitizeTeamName(name, 'b')).toBe(name);
      expect(isValidStoredName(name)).toBe(true);
    }
    const allowed = `5${'\u0301'.repeat(4)}`;
    const stacked = `5${'\u0301'.repeat(8)}`;
    expect(parseLiveTeamName(allowed)).toBe(allowed);
    expect(sanitizeTeamName(allowed, 'a')).toBe(allowed);
    expect(parseLiveTeamName(stacked)).toBeNull();
    expect(parseLiveTeamName(`X${'\u0323'.repeat(5)}`)).toBeNull();
    expect(sanitizeTeamName(stacked, 'a')).toBe(stacked);
    expect([...sanitizeTeamName(stacked, 'b')].filter((char) => /\p{M}/u.test(char))).toHaveLength(8);
    expect(isValidStoredName(stacked)).toBe(true);
    expect(isValidStoredName('A\u00A0B')).toBe(true);
    expect(parseLiveTeamName('A\u00A0B')).toBe('A B');
    expect(isValidStoredName('A\u0301')).toBe(false);
    expect(isValidStoredName('\u3164')).toBe(true);
    expect(sanitizeTeamName('\uFE0F\uFE0F', 'a')).toBe('Team A');
    expect(sanitizeTeamName('\u{E0100}', 'b')).toBe('Team B');
    expect(sanitizeTeamName('❤️', 'a')).toBe('❤️');
  });
});
