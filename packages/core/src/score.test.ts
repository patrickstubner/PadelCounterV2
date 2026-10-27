import { describe, expect, it } from 'vitest';
import { connectionCloses } from './messages';
import { createMatch, assignMatchId, matchReducer, replayScore } from './reducer';
import { matchWinner, setWinner } from './rules';
import { parseMatchLog, parseStoredEvent } from './parse';

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

  it('stores a rename only after sanitizeTeamName, capped at 20 characters', () => {
    const event = parseStoredEvent({
      type: 'team/rename',
      team: 'a',
      name: '  Lobos\u0007 extra characters beyond twenty',
      at: T0,
    });
    expect(event).toMatchObject({ type: 'team/rename', team: 'a' });
    if (!event || event.type !== 'team/rename') return;
    expect(event.name).toBe('Lobos extra characte');
    expect([...event.name].length).toBeLessThanOrEqual(20);
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
});

describe('socket close policy', () => {
  it('closes on auth failures and leaves a bad event open', () => {
    expect(connectionCloses('bad_token')).toBe(true);
    expect(connectionCloses('expired')).toBe(true);
    expect(connectionCloses('revoked')).toBe(true);
    expect(connectionCloses('spectator_not_available')).toBe(true);
    expect(connectionCloses('match_full')).toBe(true);
    expect(connectionCloses('not_applied')).toBe(false);
    expect(connectionCloses('forbidden')).toBe(false);
    expect(connectionCloses('slow_down')).toBe(false);
  });
});
