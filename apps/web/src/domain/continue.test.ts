import { describe, expect, it } from 'vitest';
import type { ArchivedMatch } from './archive';
import { continueDecision, continuationLog } from './continue';
import { appendEvent, createLog, replay } from './log';
import { sessionReducer, type Session } from './session';
import type { TeamId } from './types';

const T0 = 1_700_000_000_000;
const CURRENT = '00000000-0000-4000-8000-0000000000aa';
const PAST = '00000000-0000-4000-8000-0000000000bb';
const HOST = { id: 'host', isHost: true };
const GUEST = { id: 'p2', isHost: false };

function played(id: string, sides: readonly TeamId[], endedBy: string | null): ArchivedMatch {
  let log = createLog(T0, id, { a: 'Lobos', b: 'Team B' });
  for (const team of sides) {
    log = appendEvent(log, { type: 'game/increment', team, at: T0 + log.events.length + 1 });
  }
  if (endedBy) log = appendEvent(log, { type: 'match/end', at: T0 + 500, by: endedBy });
  const state = replay(log);
  return {
    id,
    at: state.updatedAt,
    teams: { a: state.teams.a.name, b: state.teams.b.name },
    sets: [state.sets[0], state.sets[1], state.sets[2]],
    status: endedBy && state.sets[0].a < 6 ? 'ended-early' : 'winner-a',
    events: log.events,
  };
}

const six = (team: TeamId) => Array.from({ length: 6 }, () => team);

describe('continue a match from history', () => {
  it('resumes an early end for the creator and refuses it for another phone', () => {
    const early = played(PAST, ['a', 'a', 'a'], 'host');
    expect(continueDecision(early, HOST)).toBe('until-winner');
    expect(continueDecision(early, GUEST)).toBeNull();
    const log = continuationLog(early, T0 + 600);
    const state = replay(log!);
    expect(state.ended).toBe(false);
    expect(state.sets[0]).toEqual({ a: 3, b: 0 });
    expect(state.activeSet).toBe(0);
  });

  it('opens the remaining set of a 2–0 win and stops after three decided sets', () => {
    const twoNil = played(PAST, [...six('a'), ...six('a')], 'host');
    expect(continueDecision(twoNil, HOST)).toBe('extra-set');
    const next = replay(continuationLog(twoNil, T0 + 600)!);
    expect(next.ended).toBe(false);
    expect(next.activeSet).toBe(2);
    expect(next.sets[2]).toEqual({ a: 0, b: 0 });

    const twoOne = played(PAST, [...six('a'), ...six('b'), ...six('a')], 'host');
    expect(continueDecision(twoOne, HOST)).toBeNull();
    expect(continuationLog(twoOne, T0 + 600)).not.toBeNull();
  });

  it('does not let a guest continue a match that has not ended', () => {
    const playing = played(PAST, ['a', 'a'], null);
    expect(continueDecision(playing, GUEST)).toBeNull();
    expect(continueDecision(playing, HOST)).toBe('until-winner');
  });

  it('lets the phone that ended it continue when that phone is not the creator', () => {
    const early = played(PAST, ['b'], 'p2');
    expect(continueDecision(early, GUEST)).toBe('until-winner');
    expect(continueDecision(early, { id: 'p3', isHost: false })).toBeNull();
    expect(continueDecision(early, HOST)).toBe('until-winner');
  });

  it('archives the court match and plays the restored one', () => {
    let current = createLog(T0, CURRENT);
    current = appendEvent(current, { type: 'game/increment', team: 'b', at: T0 + 1 });
    const early = played(PAST, ['a'], 'host');
    const session: Session = { log: current, archive: [early] };
    const next = continuationLog(early, T0 + 50);
    const restored = sessionReducer(session, { type: 'continue-match', log: next! });
    expect(replay(restored.log).matchId).toBe(PAST);
    expect(replay(restored.log).ended).toBe(false);
    expect(replay(restored.log).sets[0]).toEqual({ a: 1, b: 0 });
    expect(restored.archive.map((match) => match.id)).toEqual([CURRENT]);
    expect(replay({ schemaVersion: 2, base: createLog(0, CURRENT).base, events: restored.archive[0]!.events }).sets[0].b).toBe(1);
  });
});
