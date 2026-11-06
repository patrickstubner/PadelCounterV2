import { describe, expect, it } from 'vitest';
import { planNewMatch } from './policy';
import { createMatch } from './reducer';
import { celebrationWinner, matchResult } from './rules';

const id = '00000000-0000-4000-8000-00000000000a';
const at = 1_700_000_000_000;

function ended(
  sets: [{ a: number; b: number }, { a: number; b: number }, { a: number; b: number }],
  finished = true,
) {
  return { ...createMatch(at, id), sets, ended: finished };
}

describe('matchResult', () => {
  it('names a winner only after two sets', () => {
    const won = ended([{ a: 6, b: 4 }, { a: 6, b: 3 }, { a: 0, b: 0 }], false);
    expect(matchResult(won)).toEqual({ kind: 'winner', team: 'a' });
    expect(celebrationWinner(won)).toBe('a');
    expect(matchResult({ ...won, ended: true }).kind).toBe('winner');
    expect(matchResult(ended([{ a: 6, b: 0 }, { a: 3, b: 6 }, { a: 6, b: 2 }])).kind).toBe('winner');
  });

  it('uses games when the sets are level, and a draw only when the games are level too', () => {
    expect(matchResult(ended([{ a: 5, b: 3 }, { a: 0, b: 0 }, { a: 0, b: 0 }]))).toEqual({ kind: 'leading', team: 'a' });
    expect(celebrationWinner(ended([{ a: 5, b: 3 }, { a: 0, b: 0 }, { a: 0, b: 0 }]))).toBeNull();
    expect(matchResult(ended([{ a: 6, b: 4 }, { a: 4, b: 6 }, { a: 4, b: 0 }]))).toEqual({ kind: 'leading', team: 'a' });
    expect(matchResult(ended([{ a: 6, b: 4 }, { a: 4, b: 6 }, { a: 0, b: 0 }]))).toEqual({ kind: 'draw' });
    expect(matchResult(ended([{ a: 6, b: 4 }, { a: 3, b: 6 }, { a: 0, b: 0 }]))).toEqual({ kind: 'leading', team: 'b' });
    expect(matchResult(ended([{ a: 6, b: 4 }, { a: 0, b: 5 }, { a: 0, b: 0 }]))).toEqual({ kind: 'leading', team: 'a' });
    expect(matchResult(ended([{ a: 0, b: 0 }, { a: 0, b: 0 }, { a: 0, b: 0 }]))).toEqual({ kind: 'draw' });
    expect(matchResult(ended([{ a: 6, b: 5 }, { a: 0, b: 0 }, { a: 0, b: 0 }]))).toEqual({ kind: 'leading', team: 'a' });
    expect(matchResult(ended([{ a: 1, b: 1 }, { a: 0, b: 0 }, { a: 0, b: 0 }], false))).toEqual({ kind: 'playing' });
  });

  it('does not ask to carry phones out of a match that is not open', () => {
    expect(planNewMatch({ host: true, open: false, lastEventAt: at, now: at, coPlayers: 3 }).askCarry).toBe(false);
    expect(planNewMatch({ host: false, open: false, lastEventAt: at, now: at, coPlayers: 3 }).askCarry).toBe(false);
    expect(planNewMatch({ host: true, open: true, lastEventAt: at, now: at, coPlayers: 3 }).askCarry).toBe(true);
  });
});
