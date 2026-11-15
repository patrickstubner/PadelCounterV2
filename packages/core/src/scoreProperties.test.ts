// Property-Tests für Zählen und Replay (Testplan T-04).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseStoredEvent } from './parse';
import { createMatch, matchReducer, replayScore } from './reducer';
import { isPlausibleSetScore } from './rules';
import { MAX_TEAM_NAME_LENGTH, codePointLength } from './names';
import type { MatchEvent, MatchState } from './types';

const T0 = 1_700_000_000_000;
const team = fc.constantFrom('a' as const, 'b' as const);

const event: fc.Arbitrary<MatchEvent> = fc.oneof(
  { weight: 8, arbitrary: team.map((t) => ({ type: 'game/increment' as const, team: t, at: 0 })) },
  { weight: 3, arbitrary: team.map((t) => ({ type: 'game/decrement' as const, team: t, at: 0 })) },
  { weight: 1, arbitrary: fc.constantFrom(0 as const, 1 as const, 2 as const).map((i) => ({ type: 'set/select' as const, index: i, at: 0 })) },
  {
    weight: 1,
    arbitrary: fc
      .tuple(team, fc.constantFrom(1 as const, 2 as const))
      .map(([t, p]) => ({ type: 'serve/set' as const, team: t, player: p, at: 0 })),
  },
  { weight: 1, arbitrary: fc.constant({ type: 'match/end' as const, at: 0 }) },
  { weight: 1, arbitrary: fc.constant({ type: 'match/resume' as const, at: 0 }) },
);

const events = fc.array(event, { maxLength: 120 }).map((list) => list.map((e, i) => ({ ...e, at: T0 + (i + 1) * 1000 })));
const base = () => createMatch(T0, '00000000-0000-4000-8000-0000000000c1');
const fold = (s: MatchState, list: readonly MatchEvent[]) => list.reduce(matchReducer, s);

describe('Property: Replay', () => {
  it('ist deterministisch und gleich dem schrittweisen Reducer', () => {
    fc.assert(
      fc.property(events, (list) => {
        const a = replayScore(base(), list);
        expect(replayScore(base(), list)).toEqual(a);
        expect(fold(base(), list).sets).toEqual(a.sets);
      }),
    );
  });

  it('liefert nie unplausible Satzstände', () => {
    fc.assert(
      fc.property(events, (list) => {
        const s = replayScore(base(), list);
        for (const set of s.sets) expect(isPlausibleSetScore(set.a, set.b)).toBe(true);
      }),
    );
  });

  it('Plus und danach Minus desselben Teams stellt die Games wieder her, solange der Satz offen bleibt', () => {
    fc.assert(
      fc.property(events, team, (list, t) => {
        const before = fold(base(), list);
        const plus = matchReducer(before, { type: 'game/increment', team: t, at: T0 + 10_000_000 });
        fc.pre(plus !== before && plus.activeSet === before.activeSet);
        const minus = matchReducer(plus, { type: 'game/decrement', team: t, at: T0 + 10_000_001 });
        expect(minus.sets).toEqual(before.sets);
        expect(minus.activeSet).toBe(before.activeSet);
      }),
    );
  });
});

describe('Property: Parser', () => {
  it('akzeptiert nie einen Namen über dem Limit', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme', minLength: 0, maxLength: 200 }), (name) => {
        const parsed = parseStoredEvent({ type: 'team/rename', team: 'a', name, at: T0 });
        if (parsed && parsed.type === 'team/rename') expect(codePointLength(parsed.name)).toBeLessThanOrEqual(MAX_TEAM_NAME_LENGTH);
      }),
    );
  });

  it('wirft nie, auch bei beliebigen Eingaben', () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        expect(() => parseStoredEvent(value)).not.toThrow();
      }),
    );
  });
});
