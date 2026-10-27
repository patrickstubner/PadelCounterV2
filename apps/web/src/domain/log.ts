import { sanitizeTeamName } from './names';
import { createMatch, matchReducer } from './reducer';
import { serverMark } from './rules';
import { SCHEMA_VERSION, type MatchEvent, type MatchState } from './types';

export const MAX_EVENTS = 500;

export interface MatchLog {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly base: MatchState;
  readonly events: readonly MatchEvent[];
}

export function createLog(
  at: number,
  matchId?: string,
  names?: { readonly a?: string; readonly b?: string },
): MatchLog {
  return {
    schemaVersion: SCHEMA_VERSION,
    base: createMatch(at, matchId, names),
    events: [],
  };
}

export function replay(log: MatchLog): MatchState {
  return log.events.reduce(matchReducer, log.base);
}

export function appendEvent(log: MatchLog, event: MatchEvent): MatchLog {
  const current = replay(log);
  const next = matchReducer(current, event);
  if (next === current) return log;

  let base = log.base;
  const events = [...log.events, event];
  while (events.length > MAX_EVENTS) {
    const dropped = events.shift();
    if (dropped) base = matchReducer(base, dropped);
  }
  return { schemaVersion: SCHEMA_VERSION, base, events };
}

export function undoLog(log: MatchLog): MatchLog {
  if (log.events.length === 0) return log;
  return { schemaVersion: SCHEMA_VERSION, base: log.base, events: log.events.slice(0, -1) };
}

interface MatchSegment {
  readonly matchId: string;
  readonly from: number;
  readonly to: number;
}

function matchSegments(log: MatchLog): MatchSegment[] {
  const segments: MatchSegment[] = [];
  let matchId = log.base.matchId;
  let from = 0;
  let state = log.base;
  for (let index = 0; index < log.events.length; index += 1) {
    const event = log.events[index];
    if (!event) continue;
    const next = matchReducer(state, event);
    if (next.matchId !== state.matchId) {
      segments.push({ matchId, from, to: index });
      matchId = next.matchId;
      from = index;
    }
    state = next;
  }
  segments.push({ matchId, from, to: log.events.length });
  return segments;
}

/**
 * Removes one finished match from the undo log.
 * The live match is left untouched. Undo cannot step back into the removed match,
 * and its names and id are no longer in the saved log.
 */
export function omitMatch(log: MatchLog, matchId: string): MatchLog {
  const id = matchId.toLowerCase();
  if (replay(log).matchId.toLowerCase() === id) return log;
  const segments = matchSegments(log);
  const targetIndex = segments.findIndex((segment) => segment.matchId.toLowerCase() === id);
  const target = segments[targetIndex];
  if (!target || targetIndex < 0) return log;

  if (targetIndex === 0) {
    const successor = segments[1];
    if (!successor) return log;
    let base = log.base;
    for (let index = 0; index <= successor.from; index += 1) {
      const event = log.events[index];
      if (event) base = matchReducer(base, event);
    }
    return { schemaVersion: SCHEMA_VERSION, base, events: log.events.slice(successor.from + 1) };
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    base: log.base,
    events: [...log.events.slice(0, target.from), ...log.events.slice(target.to)],
  };
}

export type LogAction = { readonly type: 'undo' } | { readonly type: 'record'; readonly event: MatchEvent };

export function logReducer(log: MatchLog, action: LogAction): MatchLog {
  if (action.type === 'undo') return undoLog(log);
  return appendEvent(log, action.event);
}

export function describeEvent(event: MatchEvent): string {
  switch (event.type) {
    case 'game/increment':
      return `Game for ${event.team.toUpperCase()}`;
    case 'game/decrement':
      return `Game ${event.team.toUpperCase()} back`;
    case 'set/select':
      return `Set ${event.index + 1}`;
    case 'team/rename':
      return `Name ${event.team.toUpperCase()} · ${sanitizeTeamName(event.name, event.team)}`;
    case 'match/reset':
    case 'match/new':
      return 'New match';
    case 'match/end':
      return 'Match ended';
    case 'match/resume':
      return 'Resume';
    case 'serve/set':
      if (event.team === null || event.player === null) return 'Serve open';
      return `Serve ${serverMark(event.team, event.player)}`;
    default:
      return 'Change';
  }
}

const ENGLISH_TIME = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const ENGLISH_DATE = new Intl.DateTimeFormat('en-US', {
  month: '2-digit',
  day: '2-digit',
  year: 'numeric',
});

/** Local date and clock in en-US, always `MM/DD/YYYY HH:MM:SS`. */
export function formatMatchStamp(at: number): string {
  const date = new Date(at);
  return `${ENGLISH_DATE.format(date)} ${ENGLISH_TIME.format(date)}`;
}

/** Local clock in en-US. A different calendar day is prefixed as `MM/DD/YYYY`. */
export function formatEventTime(at: number, now = Date.now()): string {
  const date = new Date(at);
  const today = new Date(now);
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  const time = ENGLISH_TIME.format(date);
  if (sameDay) return time;
  return `${ENGLISH_DATE.format(date)} ${time}`;
}
