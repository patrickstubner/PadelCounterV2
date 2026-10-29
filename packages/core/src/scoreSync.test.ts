import { describe, expect, it } from 'vitest';
import { createMatch, matchReducer } from './reducer';
import { MAX_PENDING_EVENTS, capturedInstant, clampClockOffset, parseScoreClaim, planMerge, scoreBoard, scoreClaimFor, type CausalEvent } from './scoreSync';
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

function linked(
  start: MatchState,
  teams: readonly TeamId[],
  prefix: string,
  parent: string | null,
  type: 'game/increment' | 'game/decrement' = 'game/increment',
): { events: CausalEvent[]; state: MatchState } {
  let state = start;
  let parentId = parent;
  const events: CausalEvent[] = [];
  teams.forEach((team, index) => {
    const step = play(state, team, type);
    const id = `${prefix}-${index + 1}`;
    events.push({ id, parentId, event: step.event, claim: step.claim });
    parentId = id;
    state = step.state;
  });
  return { events, state };
}

describe('parent-chain merge', () => {
  it('drops both offline points when the server is already at 4:3', () => {
    const start = reach(['a', 'a', 'a', 'a', 'b']);
    expect(scoreBoard(start).sets[0]).toEqual({ a: 4, b: 1 });
    const base = start;
    const online = linked(base, ['b', 'b'], 'online', null);
    const offline = linked(base, ['b', 'b'], 'offline', null);
    const plan = planMerge(base, online.events, offline.events);
    expect(plan.reason).toBe('already');
    expect(plan.send).toEqual([]);
    expect(scoreBoard(online.state).sets[0]).toEqual({ a: 4, b: 3 });
  });

  it('keeps only the third offline point when the server counted two', () => {
    const start = reach(['a', 'a', 'a', 'a', 'b']);
    const online = linked(start, ['b', 'b'], 'online', null);
    const offline = linked(start, ['b', 'b', 'b'], 'offline', null);
    const plan = planMerge(start, online.events, offline.events);
    expect(plan.reason).toBe('fast-forward');
    expect(plan.send.map((item) => item.id)).toEqual(['offline-3']);
    expect(scoreBoard(matchReducer(online.state, plan.send[0]!.event)).sets[0]).toEqual({ a: 4, b: 4 });
  });

  it('cancels an offline plus and minus so the online point stays', () => {
    const start = reach(['a', 'a', 'a', 'a', 'b']);
    expect(scoreBoard(start).sets[0]).toEqual({ a: 4, b: 1 });
    const online = linked(start, ['b'], 'online', null);
    expect(scoreBoard(online.state).sets[0]).toEqual({ a: 4, b: 2 });
    const plus = play(start, 'b');
    const minus = play(plus.state, 'b', 'game/decrement');
    const offline: CausalEvent[] = [
      { id: 'plus', parentId: null, event: plus.event, claim: plus.claim },
      { id: 'minus', parentId: 'plus', event: minus.event, claim: minus.claim },
    ];
    const plan = planMerge(start, online.events, offline);
    expect(plan.send).toEqual([]);
    expect(plan.reason).toBe('already');
    expect(scoreBoard(online.state).sets[0]).toEqual({ a: 4, b: 2 });
  });

  it('cancels one of two offline pluses against the minus and keeps the online pair', () => {
    const start = reach(['a', 'a', 'a', 'a', 'b']);
    const online = linked(start, ['b', 'b'], 'online', null);
    const first = play(start, 'b');
    const second = play(first.state, 'b');
    const back = play(second.state, 'b', 'game/decrement');
    const offline: CausalEvent[] = [
      { id: 'p1', parentId: null, event: first.event, claim: first.claim },
      { id: 'p2', parentId: 'p1', event: second.event, claim: second.claim },
      { id: 'm', parentId: 'p2', event: back.event, claim: back.claim },
    ];
    const plan = planMerge(start, online.events, offline);
    expect(plan.send).toEqual([]);
    expect(scoreBoard(online.state).sets[0]).toEqual({ a: 4, b: 3 });
  });

  it('adds an offline minus the server never stored', () => {
    const start = reach(['a', 'a', 'a', 'a', 'b', 'b', 'b']);
    const online = linked(start, ['a'], 'online', null);
    expect(scoreBoard(online.state).sets[0]).toEqual({ a: 5, b: 3 });
    const correction = linked(start, ['a'], 'fix', null, 'game/decrement');
    expect(scoreBoard(correction.state).sets[0]).toEqual({ a: 3, b: 3 });
    const plan = planMerge(start, online.events, correction.events);
    expect(plan.reason).toBe('merged');
    expect(plan.send).toHaveLength(1);
    expect(scoreBoard(matchReducer(online.state, plan.send[0]!.event)).sets[0]).toEqual({ a: 4, b: 3 });
  });

  it('keeps the game after a set the server already closed', () => {
    const start = reach(['a', 'a', 'a', 'a', 'a', 'b', 'b', 'b', 'b']);
    const online = linked(start, ['a'], 'online', null);
    const offline = linked(start, ['a', 'a'], 'offline', null);
    const plan = planMerge(start, online.events, offline.events);
    expect(plan.send).toHaveLength(1);
    const next = matchReducer(online.state, plan.send[0]!.event);
    expect(scoreBoard(next).sets[0]).toEqual({ a: 6, b: 4 });
    expect(scoreBoard(next).sets[1]).toEqual({ a: 1, b: 0 });
    expect(next.activeSet).toBe(1);
  });

  it('merges a branch that scored for the other team', () => {
    const start = reach(['a', 'a', 'a', 'a', 'b']);
    const online = linked(start, ['a'], 'online', null);
    const offline = linked(start, ['b', 'b'], 'offline', null);
    const plan = planMerge(start, online.events, offline.events);
    expect(plan.reason).toBe('merged');
    expect(plan.send).toHaveLength(2);
    let state = online.state;
    for (const item of plan.send) state = matchReducer(state, item.event);
    expect(scoreBoard(state).sets[0]).toEqual({ a: 5, b: 3 });
    expect(plan.ambiguous).toEqual([]);
  });

  it('asks before applying a broken chain or a 65th event, and keeps a chain of 64', () => {
    const start = createMatch(T0);
    const first = play(start, 'a');
    const broken: CausalEvent[] = [
      { id: 'one', parentId: null, event: first.event, claim: first.claim },
      { id: 'two', parentId: 'missing', event: play(first.state, 'a').event, claim: play(first.state, 'a').claim },
    ];
    expect(planMerge(start, [], broken).reason).toBe('ambiguous');
    expect(planMerge(start, [], broken).send).toEqual([]);
    expect(MAX_PENDING_EVENTS).toBe(64);
    let state = start;
    let parent: string | null = null;
    const sixtyFour: CausalEvent[] = [];
    for (let index = 0; index < 64; index += 1) {
      const event: MatchEvent = { type: 'set/select', index: index % 2 === 0 ? 1 : 0, at: T0 + index + 1 };
      const claim = scoreClaimFor(state, event);
      if (!claim) throw new Error('select');
      const id = `sel-${index + 1}`;
      sixtyFour.push({ id, parentId: parent, event, claim });
      parent = id;
      state = matchReducer(state, event);
    }
    expect(planMerge(start, [], sixtyFour).send).toHaveLength(64);
    const sixtyFive = [...sixtyFour, { ...sixtyFour[0]!, id: 'sel-65', parentId: 'sel-64' }];
    expect(planMerge(start, [], sixtyFive).reason).toBe('ambiguous');
    expect(planMerge(start, [], sixtyFive).send).toEqual([]);
  });

  it('does not use the phone clock to tell two points apart', () => {
    const start = reach(['a', 'a', 'a', 'a', 'b']);
    const online = linked(start, ['b'], 'online', null);
    const offline = linked(start, ['b'], 'offline', null);
    const late = offline.events[0];
    if (!late) throw new Error('event');
    const far = { ...late, event: { ...late.event, at: late.event.at + 120_000 } };
    const plan = planMerge(start, online.events, [{ ...far, claim: late.claim }]);
    expect(plan.send).toEqual([]);
    expect(plan.reason).toBe('already');
  });

  it('clamps a phone clock and does not let it decide a merge', () => {
    const serverNow = T0 + 60_000;
    expect(clampClockOffset(serverNow - 13 * 60 * 60 * 1000, serverNow)).toBe(12 * 60 * 60 * 1000);
    expect(clampClockOffset('noon', serverNow)).toBe(0);
    const future = capturedInstant(serverNow + 60_000, 0, serverNow, T0);
    expect(future).toBe(serverNow);
    const ancient = capturedInstant(T0 - 60_000, 0, serverNow, T0);
    expect(ancient).toBe(T0);
    expect(capturedInstant(Number.NaN, 0, serverNow, T0)).toBeNull();
  });
});
