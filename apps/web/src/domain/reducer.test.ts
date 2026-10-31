import { describe, expect, it } from 'vitest';
import { canScoreGame, matchWinner, setWinner } from './rules';
import { createMatch, matchReducer } from './reducer';
import type { MatchEvent, MatchState, TeamId } from './types';

const ID = '00000000-0000-4000-8000-000000000001';
const NEXT = '00000000-0000-4000-8000-000000000002';
const T0 = 1_700_000_000_000;

function start(): MatchState {
  return createMatch(T0, ID);
}

function play(state: MatchState, team: TeamId, times: number): MatchState {
  let next = state;
  for (let i = 0; i < times; i += 1) {
    const snapshot = structuredClone(next);
    const event: MatchEvent = { type: 'game/increment', team, at: next.updatedAt + 1 };
    const previous = next;
    next = matchReducer(next, event);
    expect(previous).toEqual(snapshot);
  }
  return next;
}

describe('matchReducer', () => {
  it('wins a set at 6:0 and opens the next set', () => {
    const state = play(start(), 'a', 6);
    expect(state.sets[0]).toEqual({ a: 6, b: 0 });
    expect(setWinner(6, 0)).toBe('a');
    expect(state.activeSet).toBe(1);
    expect(state.sets[1]).toEqual({ a: 0, b: 0 });
    expect(state.revision).toBe(6);
    expect(matchWinner(state.sets)).toBeNull();
  });

  it('does not treat 6:5 as a set and reaches 7:5', () => {
    let state = start();
    for (let i = 0; i < 5; i += 1) {
      state = play(state, 'a', 1);
      state = play(state, 'b', 1);
    }
    expect(state.sets[0]).toEqual({ a: 5, b: 5 });
    state = play(state, 'a', 1);
    expect(state.sets[0]).toEqual({ a: 6, b: 5 });
    expect(state.activeSet).toBe(0);
    state = play(state, 'a', 1);
    expect(state.sets[0]).toEqual({ a: 7, b: 5 });
    expect(state.activeSet).toBe(1);
  });

  it('records a 6:6 tiebreak as 7:6', () => {
    let state = start();
    for (let i = 0; i < 6; i += 1) {
      state = play(state, 'a', 1);
      state = play(state, 'b', 1);
    }
    expect(state.sets[0]).toEqual({ a: 6, b: 6 });
    expect(state.activeSet).toBe(0);
    state = play(state, 'b', 1);
    expect(state.sets[0]).toEqual({ a: 6, b: 7 });
    expect(setWinner(6, 7)).toBe('b');
    expect(state.activeSet).toBe(1);
  });

  it('ends a best-of-3 match without opening an unplayed set', () => {
    let state = play(start(), 'a', 6);
    state = play(state, 'a', 6);
    expect(state.sets[0]).toEqual({ a: 6, b: 0 });
    expect(state.sets[1]).toEqual({ a: 6, b: 0 });
    expect(state.sets[2]).toEqual({ a: 0, b: 0 });
    expect(state.activeSet).toBe(1);
    expect(matchWinner(state.sets)).toBe('a');
  });

  it('refuses a new plus on 6:4, 7:5, and 7:6, and still replays a stored plus', () => {
    const rally = (pairs: number, extra: readonly TeamId[]) => {
      let state = start();
      for (let i = 0; i < pairs; i += 1) {
        state = play(state, 'a', 1);
        state = play(state, 'b', 1);
      }
      for (const team of extra) state = play(state, team, 1);
      return state;
    };
    for (const [label, built, expected] of [
      ['6:4', rally(4, ['a', 'a']), { a: 6, b: 4 }],
      ['7:5', rally(5, ['a', 'a']), { a: 7, b: 5 }],
      ['7:6', rally(6, ['a']), { a: 7, b: 6 }],
    ] as const) {
      const selected = matchReducer(built, { type: 'set/select', index: 0, at: built.updatedAt + 1 });
      expect(selected.sets[0], label).toEqual(expected);
      expect(canScoreGame(selected, 'a'), label).toBe(false);
      expect(canScoreGame(selected, 'b'), label).toBe(false);
    }
    const sixFour = matchReducer(rally(4, ['a', 'a']), { type: 'set/select', index: 0, at: T0 + 100 });
    expect(matchReducer(sixFour, { type: 'game/increment', team: 'b', at: T0 + 101 }).sets[0]).toEqual({ a: 6, b: 5 });
    const opened = matchReducer(sixFour, { type: 'game/decrement', team: 'a', at: T0 + 102 });
    expect(opened.sets[0]).toEqual({ a: 5, b: 4 });
    expect(canScoreGame(opened, 'b')).toBe(true);
    expect(matchReducer(opened, { type: 'game/increment', team: 'b', at: T0 + 103 }).sets[0]).toEqual({ a: 5, b: 5 });
  });

  it('ignores increments that are not plausible and decrements down to zero', () => {
    const state = play(start(), 'a', 6);
    const selected = matchReducer(state, { type: 'set/select', index: 0, at: state.updatedAt + 1 });
    const blocked = matchReducer(selected, { type: 'game/increment', team: 'a', at: selected.updatedAt + 1 });
    expect(blocked).toBe(selected);
    let undone = selected;
    for (let i = 0; i < 6; i += 1) undone = matchReducer(undone, { type: 'game/decrement', team: 'a', at: undone.updatedAt + 1 });
    expect(undone.sets[0]).toEqual({ a: 0, b: 0 });
    const stuck = matchReducer(undone, { type: 'game/decrement', team: 'a', at: undone.updatedAt + 1 });
    expect(stuck).toBe(undone);
  });

  it('caps renames, strips control characters, and resets names on a new match', () => {
    let state = matchReducer(start(), {
      type: 'team/rename',
      team: 'a',
      name: '  Sonne\nTeam  ',
      at: T0 + 5,
    });
    expect(state.teams.a.name).toBe('SonneTeam');
    state = matchReducer(state, {
      type: 'team/rename',
      team: 'b',
      name: '12345678901234567890EXTRA',
      at: T0 + 6,
    });
    expect(state.teams.b.name).toHaveLength(24);
    expect(state.teams.b.name).toBe('12345678901234567890EXTR');
    state = play(state, 'a', 1);
    const kept = matchReducer(state, { type: 'match/reset', matchId: NEXT, at: T0 + 20 });
    expect(kept.matchId).toBe(NEXT);
    expect(kept.teams.a.name).toBe('SonneTeam');
    expect(kept.teams.b.name).toBe('12345678901234567890EXTR');
    const reset = matchReducer(state, { type: 'match/new', matchId: NEXT, at: T0 + 21 });
    expect(reset.matchId).toBe(NEXT);
    expect(reset.revision).toBe(0);
    expect(reset.activeSet).toBe(0);
    expect(reset.sets).toEqual([
      { a: 0, b: 0 },
      { a: 0, b: 0 },
      { a: 0, b: 0 },
    ]);
    expect(reset.teams.a.name).toBe('Team A');
    expect(reset.teams.b.name).toBe('Team B');
    expect(reset.serve).toBeNull();
    expect(matchReducer(state, { type: 'match/new', matchId: 'not-a-uuid', at: T0 + 22 })).toBe(state);
  });

  it('stores angle brackets as text and falls back when a name is empty', () => {
    const named = matchReducer(start(), {
      type: 'team/rename',
      team: 'a',
      name: '<b>Hi</b>',
      at: T0 + 1,
    });
    expect(named.teams.a.name).toBe('<b>Hi</b>');
    const cleared = matchReducer(named, { type: 'team/rename', team: 'a', name: '   ', at: T0 + 2 });
    expect(cleared.teams.a.name).toBe('Team A');
  });

  it('ignores invalid events', () => {
    const state = start();
    expect(matchReducer(state, { type: 'game/increment', team: 'a', at: Number.NaN })).toBe(state);
    expect(matchReducer(state, { type: 'set/select', index: 3 as never, at: T0 + 1 })).toBe(state);
    expect(matchReducer(state, { type: 'match/reset', matchId: 'not-a-uuid', at: T0 + 1 })).toBe(state);
    expect(matchReducer(state, { type: 'serve/set', team: null, player: 1, at: T0 + 1 })).toBe(state);
    expect(matchReducer(state, { type: 'serve/set', team: 'a', player: 3 as never, at: T0 + 1 })).toBe(state);
    expect(matchReducer(state, { type: 'nope' } as never)).toBe(state);
  });

  it('treats a serve chosen at 0:0 as the first game and rotates A1 B1 A2 B2', () => {
    let state = matchReducer(start(), { type: 'serve/set', team: 'a', player: 1, at: T0 + 1 });
    expect(state.serve).toEqual({ team: 'a', player: 1 });
    const order = [
      { team: 'b', player: 1 },
      { team: 'a', player: 2 },
      { team: 'b', player: 2 },
      { team: 'a', player: 1 },
    ] as const;
    for (const expected of order) {
      state = play(state, 'a', 1);
      expect(state.serve).toEqual(expected);
    }
  });

  it('derives the opening order when serve is set at 1:0 and steps back with undo', () => {
    let state = play(start(), 'a', 1);
    expect(state.sets[0]).toEqual({ a: 1, b: 0 });
    expect(state.serve).toBeNull();
    state = matchReducer(state, { type: 'serve/set', team: 'a', player: 1, at: state.updatedAt + 1 });
    expect(state.serve).toEqual({ team: 'a', player: 1 });
    expect(state.sets[0]).toEqual({ a: 1, b: 0 });
    state = play(state, 'b', 1);
    expect(state.sets[0]).toEqual({ a: 1, b: 1 });
    expect(state.serve).toEqual({ team: 'b', player: 2 });
    state = matchReducer(state, { type: 'game/decrement', team: 'b', at: state.updatedAt + 1 });
    expect(state.sets[0]).toEqual({ a: 1, b: 0 });
    expect(state.serve).toEqual({ team: 'a', player: 1 });

    let fromB = play(start(), 'b', 1);
    fromB = matchReducer(fromB, { type: 'serve/set', team: 'b', player: 1, at: fromB.updatedAt + 1 });
    fromB = play(fromB, 'a', 1);
    expect(fromB.serve).toEqual({ team: 'a', player: 2 });
    fromB = matchReducer(fromB, { type: 'game/decrement', team: 'a', at: fromB.updatedAt + 1 });
    expect(fromB.serve).toEqual({ team: 'b', player: 1 });
  });

  it('rotates B1 A1 B2 A2 when B serves first, and undo restores each server', () => {
    let state = matchReducer(start(), { type: 'serve/set', team: 'b', player: 1, at: T0 + 1 });
    const order = [
      { team: 'a', player: 1 },
      { team: 'b', player: 2 },
      { team: 'a', player: 2 },
      { team: 'b', player: 1 },
    ] as const;
    const seen = [{ ...state }];
    for (const expected of order) {
      state = play(state, 'b', 1);
      expect(state.serve).toEqual(expected);
      seen.push(state);
    }
    for (let index = seen.length - 2; index >= 0; index -= 1) {
      state = matchReducer(state, { type: 'game/decrement', team: 'b', at: state.updatedAt + 1 });
      expect(state.serve).toEqual(seen[index]?.serve);
    }
  });

  it('lets a manual serve override replace the rotation and steps back on decrement', () => {
    let state = matchReducer(start(), { type: 'serve/set', team: 'a', player: 1, at: T0 + 1 });
    state = play(state, 'a', 1);
    expect(state.serve).toEqual({ team: 'b', player: 1 });
    state = matchReducer(state, { type: 'serve/set', team: 'b', player: 2, at: state.updatedAt + 1 });
    expect(state.serve).toEqual({ team: 'b', player: 2 });
    state = play(state, 'b', 1);
    expect(state.serve).toEqual({ team: 'a', player: 1 });
    state = matchReducer(state, { type: 'game/decrement', team: 'b', at: state.updatedAt + 1 });
    expect(state.sets[0]).toEqual({ a: 1, b: 0 });
    expect(state.serve).toEqual({ team: 'b', player: 2 });
  });

  it('keeps an unknown serve unknown when games change and clears it on a third tap cycle', () => {
    const scored = play(start(), 'a', 1);
    expect(scored.serve).toBeNull();
    let state = matchReducer(start(), { type: 'serve/set', team: 'a', player: 2, at: T0 + 1 });
    state = matchReducer(state, { type: 'serve/set', team: null, player: null, at: T0 + 2 });
    expect(state.serve).toBeNull();
    const again = matchReducer(state, { type: 'serve/set', team: null, player: null, at: T0 + 3 });
    expect(again).toBe(state);
  });

  it('keeps the tiebreak server for that one game, then asks which partner of the other team', () => {
    let state = matchReducer(start(), { type: 'serve/set', team: 'a', player: 1, at: T0 + 1 });
    for (let i = 0; i < 6; i += 1) {
      state = play(state, 'a', 1);
      state = play(state, 'b', 1);
    }
    expect(state.sets[0]).toEqual({ a: 6, b: 6 });
    expect(state.serve).toEqual({ team: 'a', player: 1 });
    expect(state.serveAsk).toBeNull();
    state = play(state, 'b', 1);
    expect(state.sets[0]).toEqual({ a: 6, b: 7 });
    expect(state.activeSet).toBe(1);
    expect(state.serve).toBeNull();
    expect(state.serveAsk).toBe('b');
    expect(state.servePrompt).toBe(false);
    const stillAsking = matchReducer(state, { type: 'set/select', index: 0, at: state.updatedAt + 1 });
    expect(stillAsking.activeSet).toBe(0);
    expect(stillAsking.serveAsk).toBe('b');
    expect(stillAsking.serve).toBeNull();
    const steppedBack = matchReducer(stillAsking, { type: 'game/decrement', team: 'b', at: stillAsking.updatedAt + 1 });
    expect(steppedBack.sets[0]).toEqual({ a: 6, b: 6 });
    expect(steppedBack.serve).toBeNull();
    expect(steppedBack.serveAsk).toBeNull();
    const wrongTeam = matchReducer(state, { type: 'serve/set', team: 'a', player: 2, at: state.updatedAt + 1 });
    expect(wrongTeam).toBe(state);
    state = matchReducer(state, { type: 'serve/set', team: 'b', player: 2, at: state.updatedAt + 1 });
    expect(state.serve).toEqual({ team: 'b', player: 2 });
    expect(state.serveAsk).toBeNull();
  });

  it('moves a pending tiebreak team to the other side when the next game is won', () => {
    let asked = matchReducer(start(), { type: 'serve/set', team: 'a', player: 1, at: T0 + 1 });
    for (let i = 0; i < 6; i += 1) {
      asked = play(asked, 'a', 1);
      asked = play(asked, 'b', 1);
    }
    asked = play(asked, 'b', 1);
    expect(asked.serveAsk).toBe('b');
    expect(asked.serve).toBeNull();

    const wonByA = play(asked, 'a', 1);
    const wonByB = play(asked, 'b', 1);
    expect(wonByA.sets[1]).toEqual({ a: 1, b: 0 });
    expect(wonByB.sets[1]).toEqual({ a: 0, b: 1 });
    expect(wonByA.serve).toBeNull();
    expect(wonByB.serve).toBeNull();
    expect(wonByA.serveAsk).toBe('a');
    expect(wonByB.serveAsk).toBe('a');
    expect(wonByA.servePrompt).toBe(false);
    expect(wonByB.servePrompt).toBe(false);

    const again = play(wonByA, 'a', 1);
    expect(again.sets[1]).toEqual({ a: 2, b: 0 });
    expect(again.serve).toBeNull();
    expect(again.serveAsk).toBe('b');

    const picked = matchReducer(wonByA, { type: 'serve/set', team: 'a', player: 2, at: wonByA.updatedAt + 1 });
    expect(picked.serve).toEqual({ team: 'a', player: 2 });
    expect(picked.serveAsk).toBeNull();
    const wrongTeam = matchReducer(wonByA, { type: 'serve/set', team: 'b', player: 1, at: wonByA.updatedAt + 1 });
    expect(wrongTeam).toBe(wonByA);
  });

  it('asks the team opposite a tiebreak started by B', () => {
    let state = matchReducer(start(), { type: 'serve/set', team: 'b', player: 1, at: T0 + 1 });
    for (let i = 0; i < 6; i += 1) {
      state = play(state, 'b', 1);
      state = play(state, 'a', 1);
    }
    expect(state.serve).toEqual({ team: 'b', player: 1 });
    state = play(state, 'a', 1);
    expect(state.sets[0]).toEqual({ a: 7, b: 6 });
    expect(state.serveAsk).toBe('a');
    expect(state.serve).toBeNull();
    state = play(state, 'b', 1);
    expect(state.sets[1]).toEqual({ a: 0, b: 1 });
    expect(state.serveAsk).toBe('b');
    expect(state.serve).toBeNull();
  });

  it('does not ask for a server after a tiebreak the match never assigned', () => {
    let state = start();
    for (let i = 0; i < 6; i += 1) {
      state = play(state, 'a', 1);
      state = play(state, 'b', 1);
    }
    state = play(state, 'a', 1);
    expect(state.sets[0]).toEqual({ a: 7, b: 6 });
    expect(state.serve).toBeNull();
    expect(state.serveAsk).toBeNull();
    expect(state.servePrompt).toBe(false);
  });

  it('keeps the server when a set is tapped, and minus still steps back', () => {
    let state = matchReducer(start(), { type: 'serve/set', team: 'a', player: 1, at: T0 + 1 });
    state = play(state, 'a', 1);
    expect(state.serve).toEqual({ team: 'b', player: 1 });
    state = matchReducer(state, { type: 'game/decrement', team: 'a', at: state.updatedAt + 1 });
    expect(state.sets[0]).toEqual({ a: 0, b: 0 });
    expect(state.serve).toEqual({ team: 'a', player: 1 });
    expect(state.serveAsk).toBeNull();
    state = play(state, 'a', 1);
    const beforeSelect = state.serve;
    state = matchReducer(state, { type: 'set/select', index: 1, at: state.updatedAt + 1 });
    expect(state.activeSet).toBe(1);
    expect(state.serve).toEqual(beforeSelect);
    expect(state.serveAsk).toBeNull();
    expect(state.servePrompt).toBe(false);
    const open = matchReducer(start(), { type: 'set/select', index: 1, at: T0 + 1 });
    expect(open.serve).toBeNull();
    expect(open.servePrompt).toBe(false);
  });

  it('ends a match in place, blocks scoring, and resumes', () => {
    let state = play(start(), 'a', 2);
    const score = state.sets;
    state = matchReducer(state, { type: 'match/end', at: state.updatedAt + 1 });
    expect(state.ended).toBe(true);
    expect(state.sets).toEqual(score);
    const blocked = matchReducer(state, { type: 'game/increment', team: 'b', at: state.updatedAt + 1 });
    expect(blocked).toBe(state);
    expect(matchReducer(state, { type: 'serve/set', team: 'a', player: 1, at: state.updatedAt + 1 })).toBe(state);
    expect(matchReducer(state, { type: 'team/rename', team: 'a', name: 'Neu', at: state.updatedAt + 1 })).toBe(state);
    expect(matchReducer(state, { type: 'set/select', index: 1, at: state.updatedAt + 1 })).toBe(state);
    expect(matchReducer(state, { type: 'match/end', at: state.updatedAt + 1 })).toBe(state);

    const resumed = matchReducer(state, { type: 'match/resume', at: state.updatedAt + 1 });
    expect(resumed.ended).toBe(false);
    expect(resumed.sets).toEqual(score);
    const continued = matchReducer(resumed, { type: 'game/increment', team: 'b', at: resumed.updatedAt + 1 });
    expect(continued.sets[0]).toEqual({ a: 2, b: 1 });
    expect(matchReducer(resumed, { type: 'match/resume', at: resumed.updatedAt + 1 })).toBe(resumed);
  });

  it('starts a fresh match from an ended one', () => {
    const ended = matchReducer(play(start(), 'a', 1), { type: 'match/end', at: T0 + 10 });
    const reset = matchReducer(ended, { type: 'match/reset', matchId: NEXT, at: T0 + 11 });
    expect(reset.ended).toBe(false);
    expect(reset.matchId).toBe(NEXT);
    expect(reset.sets[0]).toEqual({ a: 0, b: 0 });
  });
});
