import { describe, expect, it } from 'vitest';
import { createMatch, matchReducer } from './reducer';
import { MAX_PENDING_EVENTS, parseScoreClaim, reconcilePending, scoreBoard, scoreClaimFor, type ScoreClaim } from './scoreSync';
import type { MatchEvent, MatchState, TeamId } from './types';

const T0 = 1_700_000_000_000;

function blankClaim(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    before: { sets: [{ a: 0, b: 0 }, { a: 0, b: 0 }, { a: 0, b: 0 }], activeSet: 0, ended: false },
    after: { sets: [{ a: 1, b: 0 }, { a: 0, b: 0 }, { a: 0, b: 0 }], activeSet: 0, ended: false },
    baseRevision: 0,
    ...patch,
  };
}

function play(state: MatchState, team: TeamId, type: 'game/increment' | 'game/decrement' = 'game/increment') {
  const event: MatchEvent = { type, team, at: state.updatedAt + 1 };
  const claim = scoreClaimFor(state, event);
  if (!claim) throw new Error('expected a score claim');
  return { event, claim, state: matchReducer(state, event) };
}

function chain(start: MatchState, teams: readonly TeamId[], type: 'game/increment' | 'game/decrement' = 'game/increment') {
  const steps: { id: string; event: MatchEvent; claim: ScoreClaim }[] = [];
  let state = start;
  teams.forEach((team, index) => {
    const step = play(state, team, type);
    steps.push({ id: `step-${index + 1}`, event: step.event, claim: step.claim });
    state = step.state;
  });
  return { steps, state };
}

function reach(teams: readonly TeamId[]): MatchState {
  return teams.reduce((state, team) => play(state, team).state, createMatch(T0));
}

describe('score claim parsing', () => {
  it('accepts a board inside padel bounds and a revision in range', () => {
    const parsed = parseScoreClaim(blankClaim({ baseRevision: 12 }));
    expect(parsed?.baseRevision).toBe(12);
    expect(parsed?.after.sets[0]).toEqual({ a: 1, b: 0 });
  });

  it('rejects the wrong shape, type, or bound', () => {
    const sevenFour = blankClaim({
      after: { sets: [{ a: 7, b: 4 }, { a: 0, b: 0 }, { a: 0, b: 0 }], activeSet: 0, ended: false },
    });
    expect(parseScoreClaim(sevenFour)).toBeNull();
    expect(parseScoreClaim(blankClaim({ baseRevision: -1 }))).toBeNull();
    expect(parseScoreClaim(blankClaim({ baseRevision: 10_000_001 }))).toBeNull();
    expect(parseScoreClaim(blankClaim({ baseRevision: 1.5 }))).toBeNull();
    expect(parseScoreClaim(blankClaim({ baseRevision: '0' }))).toBeNull();
    expect(parseScoreClaim(blankClaim({
      before: { sets: [{ a: '4', b: 1 }, { a: 0, b: 0 }, { a: 0, b: 0 }], activeSet: 0, ended: false },
    }))).toBeNull();
    expect(parseScoreClaim(blankClaim({
      after: { sets: [{ a: 4, b: 1 }, { a: 0, b: 0 }, { a: 0, b: 0 }], activeSet: 3, ended: false },
    }))).toBeNull();
    expect(parseScoreClaim(blankClaim({
      after: { sets: [{ a: 4, b: 1 }, { a: 0, b: 0 }, { a: 0, b: 0 }], activeSet: 0, ended: 'no' },
    }))).toBeNull();
    expect(parseScoreClaim(blankClaim({
      before: { sets: [{ a: 4, b: 1 }, { a: 0, b: 0 }], activeSet: 0, ended: false },
    }))).toBeNull();
    expect(parseScoreClaim(blankClaim({ extra: true }))).toBeNull();
    expect(parseScoreClaim({ ...blankClaim(), before: { ...blankClaim().before as object, note: 'x' } })).toBeNull();
    expect(parseScoreClaim(null)).toBeNull();
    expect(parseScoreClaim([])).toBeNull();
    expect(parseScoreClaim(blankClaim({
      after: { sets: [{ a: 1, b: 0, c: 1 }, { a: 0, b: 0 }, { a: 0, b: 0 }], activeSet: 0, ended: false },
    }))).toBeNull();
  });
});

describe('reconnect reconcile', () => {
  it('drops both offline points when the server is already at 4:3', () => {
    const start = reach(['a', 'a', 'a', 'a', 'b']);
    expect(scoreBoard(start).sets[0]).toEqual({ a: 4, b: 1 });
    const offline = chain(start, ['b', 'b']);
    const server = chain(start, ['b', 'b']).state;
    expect(scoreBoard(server).sets[0]).toEqual({ a: 4, b: 3 });
    expect(scoreBoard(offline.state).sets[0]).toEqual({ a: 4, b: 3 });
    const plan = reconcilePending(server, offline.steps);
    expect(plan.reason).toBe('already');
    expect(plan.send).toEqual([]);
    expect(plan.droppedIds).toEqual(['step-1', 'step-2']);
  });

  it('keeps only the third offline point when the server counted two', () => {
    const start = reach(['a', 'a', 'a', 'a', 'b']);
    const offline = chain(start, ['b', 'b', 'b']);
    const server = chain(start, ['b', 'b']).state;
    const plan = reconcilePending(server, offline.steps);
    expect(plan.reason).toBe('suffix');
    expect(plan.send.map((item) => item.id)).toEqual(['step-3']);
    expect(scoreBoard(matchReducer(server, plan.send[0]!.event)).sets[0]).toEqual({ a: 4, b: 4 });
  });

  it('sends a minus the server has not seen, and skips a minus it already has', () => {
    const start = reach(['a', 'a', 'a', 'a', 'b', 'b', 'b']);
    expect(scoreBoard(start).sets[0]).toEqual({ a: 4, b: 3 });
    const correction = chain(start, ['a'], 'game/decrement');
    expect(scoreBoard(correction.state).sets[0]).toEqual({ a: 3, b: 3 });
    expect(reconcilePending(start, correction.steps).reason).toBe('current');
    expect(reconcilePending(start, correction.steps).send).toHaveLength(1);
    const already = chain(start, ['a'], 'game/decrement').state;
    expect(reconcilePending(already, correction.steps).reason).toBe('already');
    expect(reconcilePending(already, correction.steps).send).toEqual([]);
  });

  it('keeps the game after a set the server already closed', () => {
    const start = reach(['a', 'a', 'a', 'a', 'a', 'b', 'b', 'b', 'b']);
    expect(scoreBoard(start).sets[0]).toEqual({ a: 5, b: 4 });
    const offline = chain(start, ['a', 'a']);
    expect(scoreBoard(offline.state).sets[0]).toEqual({ a: 6, b: 4 });
    expect(scoreBoard(offline.state).sets[1]).toEqual({ a: 1, b: 0 });
    expect(offline.state.activeSet).toBe(1);
    const server = chain(start, ['a']).state;
    const plan = reconcilePending(server, offline.steps);
    expect(plan.reason).toBe('suffix');
    expect(plan.send).toHaveLength(1);
    const next = matchReducer(server, plan.send[0]!.event);
    expect(scoreBoard(next).sets[1]).toEqual({ a: 1, b: 0 });
    expect(next.activeSet).toBe(1);
  });

  it('drops the queue when the phones scored for different teams', () => {
    const start = reach(['a', 'a', 'a', 'a', 'b']);
    const offline = chain(start, ['b', 'b']);
    const server = chain(start, ['a']).state;
    expect(scoreBoard(server).sets[0]).toEqual({ a: 5, b: 1 });
    const plan = reconcilePending(server, offline.steps);
    expect(plan.reason).toBe('conflict');
    expect(plan.send).toEqual([]);
    expect(plan.droppedIds).toEqual(['step-1', 'step-2']);
  });

  it('drops a broken chain and a queue over the cap', () => {
    const start = createMatch(T0);
    const first = play(start, 'a');
    const skipped = play(first.state, 'a');
    const broken = [
      { id: 'one', event: first.event, claim: first.claim },
      { id: 'two', event: skipped.event, claim: play(start, 'b').claim },
    ];
    expect(reconcilePending(start, broken).reason).toBe('conflict');
    const overflow = Array.from({ length: MAX_PENDING_EVENTS + 1 }, (_, index) => ({
      id: `n-${index}`,
      event: first.event,
      claim: first.claim,
    }));
    expect(reconcilePending(start, overflow).send).toEqual([]);
    expect(reconcilePending(start, overflow).reason).toBe('conflict');
  });

  it('keeps a rename when the score is already on the server', () => {
    const start = createMatch(T0);
    const scored = chain(start, ['a']);
    const rename: MatchEvent = { type: 'team/rename', team: 'a', name: 'Lobos', at: T0 + 5 };
    const pending = [
      scored.steps[0]!,
      { id: 'name', event: rename, claim: null },
    ];
    const plan = reconcilePending(scored.state, pending);
    expect(plan.reason).toBe('already');
    expect(plan.send.map((item) => item.id)).toEqual(['name']);
  });
});
