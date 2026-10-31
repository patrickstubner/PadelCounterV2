import { describe, expect, it } from 'vitest';
import { parseMatchLog } from './parse';
import { createMatch, matchReducer, replayScore } from './reducer';
import { tiebreakHint } from './rules';
import type { MatchEvent, MatchState, TeamId } from './types';

const T0 = 1_700_000_000_000;
const NEXT = '00000000-0000-4000-8000-000000000099';

/** The court before this change: each event steps from the current snapshot only. */
function fold(events: readonly MatchEvent[], base: MatchState = createMatch(T0)): MatchState {
  return events.reduce(matchReducer, base);
}

function point(type: 'game/increment' | 'game/decrement', team: TeamId, at: number): MatchEvent {
  return { type, team, at };
}

function sixAll(): MatchEvent[] {
  const events: MatchEvent[] = [{ type: 'serve/set', team: 'a', player: 1, at: T0 + 1 }];
  let at = T0 + 2;
  for (let i = 0; i < 6; i += 1) {
    events.push(point('game/increment', 'a', at));
    at += 1;
    events.push(point('game/increment', 'b', at));
    at += 1;
  }
  return events;
}

describe('minus rebuilds the serve from the log', () => {
  it('restores the 6:6 server after Plus to 7:6 and Minus', () => {
    const base = createMatch(T0);
    const events = sixAll();
    const tied = replayScore(base, events);
    expect(tied.sets[0]).toEqual({ a: 6, b: 6 });
    expect(tied.serve).toEqual({ team: 'a', player: 1 });
    expect(tied.serveAsk).toBeNull();
    expect(tiebreakHint(tied)).toContain('Team A player 1 serves 1 point, from the right');

    const plusAt = T0 + 100;
    const ahead = [...events, point('game/increment', 'b', plusAt)];
    const lead = replayScore(base, ahead);
    expect(lead.sets[0]).toEqual({ a: 6, b: 7 });
    expect(lead.activeSet).toBe(1);
    expect(lead.serve).toBeNull();
    expect(lead.serveAsk).toBe('b');
    expect(lead.servePrompt).toBe(false);

    const corrected = [...ahead, point('game/decrement', 'b', plusAt + 1)];
    const back = replayScore(base, corrected);
    expect(back.sets[0]).toEqual({ a: 6, b: 6 });
    expect(back.sets[1]).toEqual({ a: 0, b: 0 });
    expect(back.activeSet).toBe(0);
    expect(back.serve).toEqual({ team: 'a', player: 1 });
    expect(back.serveAsk).toBeNull();
    expect(back.servePrompt).toBe(false);
    expect(tiebreakHint(back)).toContain('Team A player 1 serves 1 point, from the right');
    expect(fold(corrected, base).serve).toBeNull();
    expect(replayScore(base, [...corrected])).toEqual(back);
  });

  it('restores the server when Minus steps back into the set that just ended', () => {
    const events: MatchEvent[] = [{ type: 'serve/set', team: 'a', player: 1, at: T0 + 1 }];
    let at = T0 + 2;
    for (let i = 0; i < 6; i += 1) {
      events.push(point('game/increment', 'a', at));
      at += 1;
    }
    const beforeWin = fold(events.slice(0, -1));
    const won = replayScore(createMatch(T0), events);
    expect(won.sets[0]).toEqual({ a: 6, b: 0 });
    expect(won.activeSet).toBe(1);
    expect(won.serve).toEqual(fold(events).serve);
    expect(beforeWin.serve).toEqual({ team: 'b', player: 1 });

    const cleared = [...events, { type: 'serve/set', team: null, player: null, at } as const];
    expect(replayScore(createMatch(T0), cleared).serve).toBeNull();
    const back = replayScore(createMatch(T0), [...cleared, point('game/decrement', 'a', at + 1)]);
    expect(back.sets[0]).toEqual({ a: 5, b: 0 });
    expect(back.activeSet).toBe(0);
    expect(back.serve).toEqual(beforeWin.serve);
    expect(back.serveAsk).toEqual(beforeWin.serveAsk);
    expect(back.servePrompt).toEqual(beforeWin.servePrompt);
    expect(fold([...cleared, point('game/decrement', 'a', at + 1)]).serve).toBeNull();
  });

  it('restores the server, the chooser, and a pending choice across several Minus steps', () => {
    const events: MatchEvent[] = [
      { type: 'serve/set', team: 'a', player: 1, at: T0 + 1 },
      point('game/increment', 'a', T0 + 2),
      { type: 'serve/set', team: 'a', player: 2, at: T0 + 3 },
      point('game/increment', 'b', T0 + 4),
      point('game/increment', 'a', T0 + 5),
    ];
    const beforeFirst = fold(events.slice(0, 1));
    const beforeSecond = fold(events.slice(0, 3));
    const beforeThird = fold(events.slice(0, 4));
    expect(beforeFirst.serve).toEqual({ team: 'a', player: 1 });
    expect(beforeSecond.serve).toEqual({ team: 'a', player: 2 });

    let log = events;
    const steps: readonly { team: TeamId; expected: MatchState }[] = [
      { team: 'a', expected: beforeThird },
      { team: 'b', expected: beforeSecond },
      { team: 'a', expected: beforeFirst },
    ];
    steps.forEach((step, index) => {
      log = [...log, point('game/decrement', step.team, T0 + 10 + index)];
      const state = replayScore(createMatch(T0), log);
      expect(state.sets).toEqual(fold(log).sets);
      expect(state.activeSet).toEqual(fold(log).activeSet);
      expect(state.revision).toEqual(fold(log).revision);
      expect(state.serve).toEqual(step.expected.serve);
      expect(state.serveAsk).toEqual(step.expected.serveAsk);
      expect(state.servePrompt).toEqual(step.expected.servePrompt);
    });
    expect(replayScore(createMatch(T0), log).serve).toEqual({ team: 'a', player: 1 });
    expect(fold(log).serve).not.toEqual({ team: 'a', player: 1 });

    const tied = sixAll();
    const asked = [
      ...tied,
      point('game/increment', 'b', T0 + 40),
      point('game/increment', 'a', T0 + 41),
      point('game/increment', 'b', T0 + 42),
    ];
    const beforeSetPoint = fold(asked.slice(0, -1));
    const beforeChooserMoved = fold(asked.slice(0, -2));
    expect(beforeChooserMoved.serveAsk).toBe('b');
    expect(beforeSetPoint.serveAsk).toBe('a');
    const undoSet = replayScore(createMatch(T0), [...asked, point('game/decrement', 'b', T0 + 43)]);
    expect(undoSet.sets[1]).toEqual({ a: 1, b: 0 });
    expect(undoSet.serve).toBeNull();
    expect(undoSet.serveAsk).toBe('a');
    const undoGame = replayScore(createMatch(T0), [
      ...asked,
      point('game/decrement', 'b', T0 + 43),
      point('game/decrement', 'a', T0 + 44),
    ]);
    expect(undoGame.sets[1]).toEqual({ a: 0, b: 0 });
    expect(undoGame.serveAsk).toBe('b');
    expect(undoGame.serve).toBeNull();
    const undoBreak = replayScore(createMatch(T0), [
      ...asked,
      point('game/decrement', 'b', T0 + 43),
      point('game/decrement', 'a', T0 + 44),
      point('game/decrement', 'b', T0 + 45),
    ]);
    expect(undoBreak.sets[0]).toEqual({ a: 6, b: 6 });
    expect(undoBreak.activeSet).toBe(0);
    expect(undoBreak.serve).toEqual({ team: 'a', player: 1 });
    expect(undoBreak.serveAsk).toBeNull();
    expect(undoBreak.servePrompt).toBe(false);
    expect(fold([
      ...asked,
      point('game/decrement', 'b', T0 + 43),
    ]).serveAsk).toBeNull();
  });

  it('puts a pending choice back and ignores events the court already ignores', () => {
    const base: MatchState = {
      ...createMatch(T0),
      sets: [{ a: 6, b: 6 }, { a: 0, b: 0 }, { a: 0, b: 0 }],
      serve: { team: 'a', player: 1 },
      servePrompt: true,
      revision: 13,
    };
    const events = [point('game/increment', 'b', T0 + 1), point('game/decrement', 'b', T0 + 2)];
    const back = replayScore(base, events);
    expect(back.sets[0]).toEqual({ a: 6, b: 6 });
    expect(back.serve).toEqual({ team: 'a', player: 1 });
    expect(back.serveAsk).toBeNull();
    expect(back.servePrompt).toBe(true);
    expect(fold(events, base).servePrompt).toBe(false);
    expect(back.sets).toEqual(fold(events, base).sets);

    const opened = fold([{ type: 'serve/set', team: 'a', player: 1, at: T0 + 1 }, point('game/increment', 'a', T0 + 2)]);
    const withoutHistory = replayScore(opened, [point('game/decrement', 'a', T0 + 3)]);
    expect(withoutHistory.sets[0]).toEqual({ a: 0, b: 0 });
    expect(withoutHistory.serve).toEqual(matchReducer(opened, point('game/decrement', 'a', T0 + 3)).serve);

    const kept: MatchEvent[] = [
      { type: 'serve/set', team: 'a', player: 1, at: T0 + 1 },
      point('game/increment', 'a', T0 + 2),
      { type: 'serve/set', team: 'a', player: 2, at: T0 + 3 },
      point('game/decrement', 'b', T0 + 4),
      point('game/decrement', 'a', T0 + 5),
    ];
    expect(replayScore(createMatch(T0), kept).sets[0]).toEqual({ a: 0, b: 0 });
    expect(replayScore(createMatch(T0), kept).serve).toEqual({ team: 'a', player: 1 });

    const ignored = { type: 'undo', at: T0 + 1 } as unknown as MatchEvent;
    const stale = point('game/increment', 'a', 0);
    const played = replayScore(createMatch(T0), [ignored, stale, point('game/increment', 'b', T0 + 2)]);
    expect(played.sets[0]).toEqual({ a: 0, b: 1 });

    const fresh = [
      { type: 'serve/set' as const, team: 'a' as const, player: 1 as const, at: T0 + 1 },
      point('game/increment', 'a', T0 + 2),
      { type: 'match/new' as const, matchId: NEXT, at: T0 + 3 },
      point('game/increment', 'b', T0 + 4),
      point('game/decrement', 'b', T0 + 5),
    ];
    const restarted = replayScore(createMatch(T0), fresh);
    expect(restarted.matchId).toBe(NEXT);
    expect(restarted.sets[0]).toEqual({ a: 0, b: 0 });
    expect(restarted.serve).toBeNull();
  });

  it('keeps the rotation when Minus removes an older game', () => {
    const start = { type: 'serve/set' as const, team: 'a' as const, player: 1 as const, at: T0 + 1 };
    const abab = replayScore(createMatch(T0), [
      start,
      point('game/increment', 'a', T0 + 2),
      point('game/increment', 'b', T0 + 3),
      point('game/decrement', 'a', T0 + 4),
      point('game/increment', 'b', T0 + 5),
    ]);
    expect(abab.sets[0]).toEqual({ a: 0, b: 2 });
    expect(abab.serve).toEqual({ team: 'a', player: 2 });

    const aaba = replayScore(createMatch(T0), [
      start,
      point('game/increment', 'a', T0 + 2),
      point('game/increment', 'a', T0 + 3),
      point('game/increment', 'b', T0 + 4),
      point('game/decrement', 'a', T0 + 5),
    ]);
    expect(aaba.sets[0]).toEqual({ a: 1, b: 1 });
    expect(aaba.serve).toEqual({ team: 'a', player: 2 });

    const events = [...sixAll(), point('game/increment', 'a', T0 + 80)];
    const sevenSix = replayScore(createMatch(T0), events);
    expect(sevenSix.sets[0]).toEqual({ a: 7, b: 6 });
    expect(sevenSix.serve).toBeNull();
    const taken = [...events, point('game/decrement', 'b', T0 + 81)];
    const back = replayScore(createMatch(T0), taken);
    const stepped = fold(taken);
    expect(back.sets[0]).toEqual({ a: 7, b: 5 });
    expect(back.serve).toEqual(stepped.serve);
    expect(back.serveAsk).toEqual(stepped.serveAsk);
    expect(back.servePrompt).toEqual(stepped.servePrompt);
    expect(back.serve).not.toEqual({ team: 'b', player: 2 });
    expect(back.serve).not.toEqual({ team: 'a', player: 1 });
  });

  it('does not restore a different team, a different set, or the previous match', () => {
    const won = [...sixAll(), point('game/increment', 'a', T0 + 40)];
    const otherTeam = [...won, point('game/decrement', 'b', T0 + 41)];
    expect(replayScore(createMatch(T0), otherTeam).serve).toBeNull();
    expect(replayScore(createMatch(T0), otherTeam).serveAsk).toBeNull();

    let at = T0 + 1;
    const across: MatchEvent[] = [{ type: 'serve/set', team: 'a', player: 1, at: at++ }];
    for (let i = 0; i < 6; i += 1) across.push(point('game/increment', 'a', at++));
    across.push(point('game/increment', 'a', at++));
    across.push({ type: 'serve/set', team: 'a', player: 1, at: at++ });
    across.push({ type: 'set/select', index: 0, at: at++ });
    across.push(point('game/decrement', 'a', at));
    const base = createMatch(T0);
    const corrected = replayScore(base, across);
    const stepped = fold(across, base);
    expect(corrected.sets[0]).toEqual({ a: 5, b: 0 });
    expect(corrected.sets[1]).toEqual({ a: 1, b: 0 });
    expect(corrected.serve).toEqual(stepped.serve);
    expect(corrected.serve).toEqual({ team: 'b', player: 1 });
    expect(corrected.serve).not.toEqual({ team: 'a', player: 2 });

    const fresh = [
      { type: 'serve/set' as const, team: 'a' as const, player: 1 as const, at: T0 + 1 },
      point('game/increment', 'a', T0 + 2),
      point('game/increment', 'b', T0 + 3),
      { type: 'match/new' as const, matchId: NEXT, at: T0 + 4 },
      { type: 'serve/set' as const, team: 'b' as const, player: 2 as const, at: T0 + 5 },
      point('game/increment', 'b', T0 + 6),
      point('game/decrement', 'a', T0 + 7),
      point('game/decrement', 'b', T0 + 8),
    ];
    const restarted = replayScore(createMatch(T0), fresh);
    expect(restarted.matchId).toBe(NEXT);
    expect(restarted.sets[0]).toEqual({ a: 0, b: 0 });
    expect(restarted.serve).toEqual({ team: 'b', player: 2 });
    expect(restarted.serveAsk).toBeNull();
  });

  it('drops a serve chosen after the game that Minus removes', () => {
    const events = [
      ...sixAll(),
      point('game/increment', 'b', T0 + 90),
      { type: 'serve/set' as const, team: 'b' as const, player: 2 as const, at: T0 + 91 },
      point('game/decrement', 'b', T0 + 92),
    ];
    const back = replayScore(createMatch(T0), events);
    expect(back.sets[0]).toEqual({ a: 6, b: 6 });
    expect(back.serve).toEqual({ team: 'a', player: 1 });
    expect(back.serve).not.toEqual({ team: 'b', player: 2 });
    expect(tiebreakHint(back)).toContain('Team A player 1 serves 1 point, from the right');
  });

  it('replays a stored log the same way twice', () => {
    const events = [...sixAll(), point('game/increment', 'b', T0 + 100), point('game/decrement', 'b', T0 + 101)];
    const base = createMatch(T0);
    const parsed = parseMatchLog({ schemaVersion: 2, base, events });
    expect(parsed).not.toBeNull();
    const direct = replayScore(base, events);
    const stored = replayScore(parsed!.base, parsed!.events);
    expect(stored).toEqual(direct);
    expect(replayScore(base, [...events])).toEqual(direct);
    expect(stored.serve).toEqual({ team: 'a', player: 1 });
  });
});
