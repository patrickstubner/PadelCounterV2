import { canReopen } from '@padel/core';
import type { ArchivedMatch } from './archive';
import { appendEvent, createLog, replay, type MatchLog } from './log';
import { matchWinner, setWinner } from './rules';
import type { SetIndex, SetScore } from './types';

export type ContinueKind = 'until-winner' | 'extra-set';

export interface ContinueActor {
  readonly id: string;
  readonly isHost: boolean;
}

function decidedSets(sets: readonly [SetScore, SetScore, SetScore]): number {
  return sets.filter((set) => setWinner(set.a, set.b) !== null).length;
}

function logFrom(match: ArchivedMatch): MatchLog {
  let log = createLog(match.at, match.id, { a: match.teams.a, b: match.teams.b });
  for (const event of match.events) log = appendEvent(log, event);
  return log;
}

/**
 * History can put an ended match back on this phone.
 * Three decided sets is the whole best of 3, so that match stays finished.
 * A win with a set still open (2–0) continues for that set.
 * Anything else without a winner plays on until a team wins two sets.
 * Reopen rights match the live match: the creator always, otherwise only the phone that ended it.
 */
export function continueDecision(match: ArchivedMatch, actor: ContinueActor): ContinueKind | null {
  const state = replay(logFrom(match));
  if (state.matchId !== match.id) return null;
  if (decidedSets(state.sets) >= 3) return null;
  const ended = state.ended || match.events.some((event) => event.type === 'match/end');
  if (ended) {
    const allowed = canReopen({
      events: match.events,
      actorId: actor.id,
      actorIsHost: actor.isHost,
    });
    if (!allowed) return null;
  } else if (!actor.isHost) {
    return null;
  }
  return matchWinner(state.sets) ? 'extra-set' : 'until-winner';
}

/** Resume when the match was ended, then open the next set that has no winner. */
export function continuationLog(match: ArchivedMatch, at: number): MatchLog | null {
  let log = logFrom(match);
  if (replay(log).matchId !== match.id) return null;
  if (replay(log).ended) log = appendEvent(log, { type: 'match/resume', at });
  const state = replay(log);
  const active = state.sets[state.activeSet];
  if (setWinner(active.a, active.b)) {
    const open = state.sets.findIndex((set) => setWinner(set.a, set.b) === null);
    if (open === 0 || open === 1 || open === 2) {
      const index = open as SetIndex;
      if (index !== state.activeSet) {
        log = appendEvent(log, { type: 'set/select', index, at: at + 1 });
      }
    }
  }
  return log;
}

export function continueCopy(kind: ContinueKind, live: boolean): { readonly title: string; readonly body: string } {
  const stay = live
    ? ' Phones still in the live match stay there. This phone plays on alone.'
    : ' Phones still in a live match stay there. This phone plays on alone.';
  if (kind === 'extra-set') {
    return {
      title: 'Continue this match?',
      body: `This match is won, and a set is still open. Continue plays that set. The match on the court now is kept in History.${stay}`,
    };
  }
  return {
    title: 'Continue this match?',
    body: `This match ended before a winner. It goes back on the court until a team wins two sets. The match on the court now is kept in History.${stay}`,
  };
}
