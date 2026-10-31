import { describe, expect, it } from 'vitest';
import { createMatch, matchReducer } from './reducer';
import {
  FIP_SERVE_SOURCE,
  RULES_SUMMARY,
  courtCue,
  servePickPrompt,
  canDecrement,
  canIncrement,
  canScoreGame,
  displayGames,
  isPlausibleSetScore,
  isTiebreak,
  celebrationWinner,
  matchResult,
  matchWinner,
  gamesPlayed,
  inferServeStart,
  openingServer,
  rotateServe,
  serveChoice,
  serveCycle,
  serveCourtLabel,
  serveLabel,
  setWinner,
  tiebreakHint,
} from './rules';
import type { TeamId } from './types';

describe('setWinner', () => {
  const cases: Array<[number, number, TeamId | null]> = [
    [0, 0, null],
    [5, 3, null],
    [5, 5, null],
    [6, 5, null],
    [5, 6, null],
    [6, 6, null],
    [6, 0, 'a'],
    [6, 4, 'a'],
    [4, 6, 'b'],
    [7, 5, 'a'],
    [5, 7, 'b'],
    [7, 6, 'a'],
    [6, 7, 'b'],
  ];

  it.each(cases)('%i:%i → %s', (a, b, winner) => {
    expect(setWinner(a, b)).toBe(winner);
  });

  it('rejects impossible scores', () => {
    expect(setWinner(7, 4)).toBeNull();
    expect(setWinner(8, 6)).toBeNull();
    expect(setWinner(6.5, 4)).toBeNull();
    expect(isPlausibleSetScore(7, 4)).toBe(false);
    expect(isPlausibleSetScore(7, 7)).toBe(false);
    expect(isPlausibleSetScore(6, 6)).toBe(true);
  });
});

describe('matchWinner', () => {
  it('is best of 3, first to two sets', () => {
    expect(
      matchWinner([
        { a: 6, b: 4 },
        { a: 6, b: 3 },
        { a: 0, b: 0 },
      ]),
    ).toBe('a');
    expect(
      matchWinner([
        { a: 6, b: 4 },
        { a: 3, b: 6 },
        { a: 7, b: 5 },
      ]),
    ).toBe('a');
    expect(
      matchWinner([
        { a: 7, b: 6 },
        { a: 6, b: 7 },
        { a: 0, b: 0 },
      ]),
    ).toBeNull();
    expect(
      matchWinner([
        { a: 6, b: 5 },
        { a: 0, b: 0 },
        { a: 0, b: 0 },
      ]),
    ).toBeNull();
  });
});

describe('celebrationWinner', () => {
  const id = '00000000-0000-4000-8000-00000000000a';
  const at = 1_700_000_000_000;

  function match(
    sets: [{ a: number; b: number }, { a: number; b: number }, { a: number; b: number }],
    ended = false,
  ) {
    return { ...createMatch(at, id), sets, ended };
  }

  it('celebrates two sets and does not treat an early lead as a win', () => {
    const twoSets = match([
      { a: 6, b: 4 },
      { a: 6, b: 3 },
      { a: 0, b: 0 },
    ]);
    expect(celebrationWinner(twoSets)).toBe('a');
    expect(matchResult(twoSets)).toEqual({ kind: 'winner', team: 'a' });
    expect(celebrationWinner({ ...twoSets, ended: true })).toBe('a');
    expect(matchResult({ ...twoSets, ended: true })).toEqual({ kind: 'winner', team: 'a' });

    const earlyLead = match(
      [
        { a: 6, b: 3 },
        { a: 5, b: 2 },
        { a: 0, b: 0 },
      ],
      true,
    );
    expect(celebrationWinner(earlyLead)).toBeNull();
    expect(matchResult(earlyLead)).toEqual({ kind: 'leading', team: 'a' });
    expect(celebrationWinner(match([{ a: 4, b: 6 }, { a: 0, b: 0 }, { a: 0, b: 0 }]))).toBeNull();
    expect(matchResult(match([{ a: 4, b: 6 }, { a: 0, b: 0 }, { a: 0, b: 0 }], true))).toEqual({
      kind: 'leading',
      team: 'b',
    });
  });

  it('calls an early tie a draw and stays quiet', () => {
    const split = match(
      [
        { a: 6, b: 4 },
        { a: 3, b: 6 },
        { a: 0, b: 0 },
      ],
      true,
    );
    expect(celebrationWinner(split)).toBeNull();
    expect(matchResult(split)).toEqual({ kind: 'leading', team: 'b' });
    const levelGames = match(
      [
        { a: 6, b: 5 },
        { a: 0, b: 0 },
        { a: 0, b: 0 },
      ],
      true,
    );
    expect(celebrationWinner(levelGames)).toBeNull();
    expect(matchResult(levelGames)).toEqual({ kind: 'leading', team: 'a' });
    const blank = match([{ a: 0, b: 0 }, { a: 0, b: 0 }, { a: 0, b: 0 }], true);
    expect(celebrationWinner(blank)).toBeNull();
    expect(matchResult(blank)).toEqual({ kind: 'draw' });
    expect(matchResult(match([{ a: 1, b: 1 }, { a: 0, b: 0 }, { a: 0, b: 0 }]))).toEqual({ kind: 'playing' });
  });

  it('drops the celebration when the winning game is undone', () => {
    let state = createMatch(at, id);
    for (let i = 0; i < 12; i += 1) {
      state = matchReducer(state, { type: 'game/increment', team: 'a', at: at + 1 + i });
    }
    expect(celebrationWinner(state)).toBe('a');
    state = matchReducer(state, { type: 'game/decrement', team: 'a', at: at + 20 });
    expect(celebrationWinner(state)).toBeNull();
  });
});

describe('manual corrections stay on plausible scores', () => {
  it('blocks plus on a finished set for both teams', () => {
    for (const score of [
      { a: 6, b: 0 },
      { a: 6, b: 4 },
      { a: 7, b: 5 },
      { a: 7, b: 6 },
      { a: 0, b: 6 },
      { a: 4, b: 6 },
      { a: 5, b: 7 },
      { a: 6, b: 7 },
    ]) {
      expect(canIncrement(score, 'a'), `${score.a}:${score.b} a`).toBe(false);
      expect(canIncrement(score, 'b'), `${score.a}:${score.b} b`).toBe(false);
    }
    expect(canIncrement({ a: 6, b: 5 }, 'a')).toBe(true);
    expect(canIncrement({ a: 6, b: 5 }, 'b')).toBe(true);
    expect(canIncrement({ a: 6, b: 6 }, 'a')).toBe(true);
    expect(canIncrement({ a: 5, b: 5 }, 'b')).toBe(true);
  });

  it('blocks a new plus when the match is already won, including the empty third set', () => {
    let state = createMatch(1_700_000_000_000, '00000000-0000-4000-8000-000000000001');
    for (let i = 0; i < 12; i += 1) {
      state = matchReducer(state, { type: 'game/increment', team: 'a', at: state.updatedAt + 1 });
    }
    expect(matchWinner(state.sets)).toBe('a');
    expect(canScoreGame(state, 'a')).toBe(false);
    expect(canScoreGame(state, 'b')).toBe(false);
    const third = matchReducer(state, { type: 'set/select', index: 2, at: state.updatedAt + 1 });
    expect(third.sets[2]).toEqual({ a: 0, b: 0 });
    expect(canScoreGame(third, 'a')).toBe(false);
    expect(canScoreGame(third, 'b')).toBe(false);
    const undone = matchReducer(state, { type: 'game/decrement', team: 'a', at: state.updatedAt + 2 });
    expect(matchWinner(undone.sets)).toBeNull();
    expect(canScoreGame(undone, 'b')).toBe(true);
  });

  it('blocks a decrement that would invent 7:4', () => {
    expect(canDecrement({ a: 7, b: 5 }, 'b')).toBe(false);
    expect(canDecrement({ a: 7, b: 5 }, 'a')).toBe(true);
    expect(canDecrement({ a: 7, b: 6 }, 'a')).toBe(true);
    expect(canDecrement({ a: 0, b: 0 }, 'a')).toBe(false);
  });
});

describe('display', () => {
  it('shows a dash for sets that have not started', () => {
    const state = createMatch(1_700_000_000_000, '00000000-0000-4000-8000-000000000001');
    expect(displayGames(state, 0, 'a')).toBe('0');
    expect(displayGames(state, 1, 'b')).toBe('–');
    expect(displayGames(state, 2, 'a')).toBe('–');
  });

  it('describes this counter without stating a law', () => {
    expect(RULES_SUMMARY).toContain('This counter');
    expect(RULES_SUMMARY).toContain('6 games');
    expect(RULES_SUMMARY).toContain('lead of 2');
    expect(RULES_SUMMARY).toContain('7–5');
    expect(RULES_SUMMARY).toContain('6–6');
    expect(RULES_SUMMARY).toContain('7–6');
    expect(RULES_SUMMARY).toContain('best of 3');
    expect(RULES_SUMMARY).toContain('Serve is optional and rotates between teams and partners.');
    expect(RULES_SUMMARY).toContain('Tap a set to select it');
    expect(RULES_SUMMARY).not.toContain('Set won');
    expect(RULES_SUMMARY).not.toContain('correct it');
  });
});

describe('serve rotation', () => {
  it('cycles teams and partners, and can be cleared from the same team', () => {
    expect(serveCycle('a').map((server) => `${server.team}${server.player}`)).toEqual(['a1', 'b1', 'a2', 'b2']);
    expect(serveCycle('b').map((server) => `${server.team}${server.player}`)).toEqual(['b1', 'a1', 'b2', 'a2']);
    expect(rotateServe({ team: 'a', player: 1 }, 0, 1)).toEqual({ team: 'b', player: 1 });
    expect(rotateServe({ team: 'b', player: 1 }, 0, 1)).toEqual({ team: 'a', player: 1 });
    expect(rotateServe({ team: 'a', player: 1 }, 1, 1)).toEqual({ team: 'b', player: 2 });
    expect(rotateServe({ team: 'b', player: 1 }, 1, 1)).toEqual({ team: 'a', player: 2 });
    expect(rotateServe({ team: 'a', player: 1 }, 0, -1)).toEqual({ team: 'b', player: 2 });
    expect(rotateServe(null, 0, 1)).toBeNull();
    expect(serveChoice(null, 'b')).toEqual({ team: 'b', player: 1 });
    expect(serveChoice({ team: 'a', player: 1 }, 'a')).toEqual({ team: 'a', player: 2 });
    expect(serveChoice({ team: 'a', player: 2 }, 'a')).toBeNull();
    expect(serveChoice({ team: 'a', player: 2 }, 'b')).toEqual({ team: 'b', player: 1 });
    expect(serveLabel(null)).toBe('Serve open');
    expect(serveLabel({ team: 'a', player: 1 })).toBe('Serve A1');
  });

  it('follows the team that served first, including a serve set at 1:0', () => {
    const fromA = serveCycle('a');
    for (let step = 0; step < 4; step += 1) {
      expect(rotateServe(fromA[step]!, step, 1)).toEqual(fromA[(step + 1) % 4]);
      expect(inferServeStart(step, fromA[step]!)).toBe('a');
    }
    const fromB = serveCycle('b');
    for (let step = 0; step < 4; step += 1) {
      expect(rotateServe(fromB[step]!, step, 1)).toEqual(fromB[(step + 1) % 4]);
      expect(inferServeStart(step, fromB[step]!)).toBe('b');
    }
    expect(rotateServe({ team: 'b', player: 1 }, 1, 1)).toEqual({ team: 'a', player: 2 });
    expect(rotateServe({ team: 'b', player: 1 }, 1, 1)).not.toEqual({ team: 'a', player: 1 });
    expect(openingServer(1, { team: 'a', player: 1 })).toEqual({ team: 'b', player: 1 });
    expect(rotateServe({ team: 'a', player: 1 }, 1, 1)).toEqual({ team: 'b', player: 2 });
    expect(openingServer(1, { team: 'b', player: 1 })).toEqual({ team: 'a', player: 1 });
    expect(gamesPlayed([{ a: 1, b: 0 }, { a: 0, b: 0 }, { a: 0, b: 0 }])).toBe(1);
    expect(gamesPlayed([{ a: 6, b: 4 }, { a: 1, b: 0 }, { a: 0, b: 0 }])).toBe(11);
  });

  it('marks only a 6:6 active set as a tiebreak', () => {
    const state = createMatch(1_700_000_000_000, '00000000-0000-4000-8000-000000000001');
    expect(isTiebreak(state)).toBe(false);
    expect(tiebreakHint(state)).toBeNull();
    const tied = {
      ...state,
      sets: [
        { a: 6, b: 6 },
        { a: 0, b: 0 },
        { a: 0, b: 0 },
      ] as const,
      serve: { team: 'b' as const, player: 2 as const },
    };
    expect(isTiebreak(tied)).toBe(true);
    expect(tiebreakHint(tied)).toBe(
      'Team B player 2 serves 1 point, from the right. Then each player serves 2 points in a row. The next 2 points are from the left. Change ends every 6 points.',
    );
    expect(tiebreakHint(tied)).not.toContain('then from the right');
    expect(tiebreakHint({ ...tied, serve: null })).toContain('The player whose turn it is');
    expect(courtCue(state)).toEqual({ kind: 'choose-serve', text: 'Please choose the serving team' });
    expect(courtCue({ ...state, serve: { team: 'a', player: 1 } })).toBeNull();
    const after = {
      ...state,
      activeSet: 1 as const,
      sets: [
        { a: 7, b: 6 },
        { a: 0, b: 0 },
        { a: 0, b: 0 },
      ] as const,
      serve: null,
      serveAsk: 'a' as const,
    };
    expect(courtCue(after)?.text).toContain('Team A serves first');
    expect(courtCue(after)?.text).toContain('did not start the tie-break');
    expect(courtCue(after)?.text).toContain('choose which player');
    expect(courtCue({ ...after, serve: { team: 'a', player: 2 } })).toBeNull();
    const plain = {
      ...after,
      sets: [
        { a: 6, b: 4 },
        { a: 0, b: 0 },
        { a: 0, b: 0 },
      ] as const,
      serveAsk: null,
    };
    expect(courtCue(plain)).toBeNull();
    const sixFour = {
      ...state,
      sets: [
        { a: 6, b: 4 },
        { a: 0, b: 0 },
        { a: 0, b: 0 },
      ] as const,
      serve: { team: 'a' as const, player: 1 as const },
    };
    const sixFive = { ...sixFour, sets: [{ a: 6, b: 5 }, { a: 0, b: 0 }, { a: 0, b: 0 }] as const };
    const fiveSix = { ...sixFour, sets: [{ a: 5, b: 6 }, { a: 0, b: 0 }, { a: 0, b: 0 }] as const };
    expect(courtCue(sixFour)).toBeNull();
    expect(tiebreakHint(sixFour)).toBeNull();
    expect(courtCue(sixFive)).toBeNull();
    expect(courtCue(fiveSix)).toBeNull();
    expect(courtCue({ ...sixFour, sets: [{ a: 7, b: 5 }, { a: 0, b: 0 }, { a: 0, b: 0 }] as const })).toBeNull();
    const afterSixSeven = {
      ...state,
      activeSet: 1 as const,
      sets: [
        { a: 6, b: 7 },
        { a: 0, b: 0 },
        { a: 0, b: 0 },
      ] as const,
      serve: null,
      serveAsk: 'b' as const,
    };
    expect(courtCue(afterSixSeven)?.kind).toBe('next-set');
    expect(courtCue(afterSixSeven)?.text).toContain('Team B serves first');
    expect(courtCue(afterSixSeven)?.text).toContain('did not start the tie-break');
    expect(courtCue({
      ...afterSixSeven,
      sets: [
        { a: 7, b: 5 },
        { a: 0, b: 0 },
        { a: 0, b: 0 },
      ] as const,
    })).toBeNull();
    expect(FIP_SERVE_SOURCE).toContain('https://padelfip.com/wp-content/uploads/2025/12/FIP_Rules-of-Padel.pdf');
    expect(FIP_SERVE_SOURCE).toContain('2026-10-30');
    expect(FIP_SERVE_SOURCE).toContain('1 January 2026');
    expect(servePickPrompt(state)).toBeNull();
    expect(servePickPrompt({ ...tied, serve: null, servePrompt: true })).toBe('Choose the server');
    expect(servePickPrompt({ ...tied, serve: null, serveAsk: 'b', servePrompt: false })).toBe('Choose the player');
    expect(serveCourtLabel({ ...tied, serve: null, serveAsk: 'b' })).toBe('Team B to serve');
    expect(servePickPrompt({ ...tied, serve: null, servePrompt: true, ended: true })).toBeNull();
    expect(servePickPrompt({ ...tied, servePrompt: true })).toBeNull();
  });

  it('names the player whose turn it is after a full rotation to 6:6', () => {
    const reached = (opener: 'a' | 'b') => {
      let state = createMatch(1_700_000_000_000, '00000000-0000-4000-8000-000000000001');
      state = matchReducer(state, { type: 'serve/set', team: opener, player: 1, at: state.updatedAt + 1 });
      for (let game = 0; game < 6; game += 1) {
        state = matchReducer(state, { type: 'game/increment', team: 'a', at: state.updatedAt + 1 });
        state = matchReducer(state, { type: 'game/increment', team: 'b', at: state.updatedAt + 1 });
      }
      return state;
    };
    const fromA = reached('a');
    expect(fromA.sets[0]).toEqual({ a: 6, b: 6 });
    expect(fromA.serve).toEqual({ team: 'a', player: 1 });
    expect(tiebreakHint(fromA)).toContain('Team A player 1 serves 1 point, from the right');
    expect(tiebreakHint(fromA)).not.toContain('player 2');
    expect(tiebreakHint(fromA)).not.toContain('Team B');
    const fromB = reached('b');
    expect(fromB.serve).toEqual({ team: 'b', player: 1 });
    expect(tiebreakHint(fromB)).toContain('Team B player 1 serves 1 point, from the right');
    expect(tiebreakHint(fromB)).not.toContain('player 2');
    expect(tiebreakHint(fromB)).not.toContain('Team A');
  });
});
