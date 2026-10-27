import { currentMatchEvents } from './archive';
import { describeEvent, type MatchLog } from './log';
import { createMatch, matchReducer } from './reducer';
import type { MatchEvent, MatchState, SetScore } from './types';

export interface HistorySetMark {
  readonly a: number;
  readonly b: number;
  readonly aChanged: boolean;
  readonly bChanged: boolean;
}

export interface HistoryRow {
  readonly at: number;
  readonly label: string;
  /** Complete set score after the event. Only the number that changed is marked. */
  readonly score: readonly HistorySetMark[];
}

/** `6:3 5:1`, omitting sets that are still 0:0 on both sides of the event. */
export function formatHistoryScore(score: readonly HistorySetMark[]): string {
  return score.map((set) => `${set.a}:${set.b}`).join(' ');
}

function markedSets(before: MatchState, after: MatchState): HistorySetMark[] {
  let last = 0;
  for (let index = 0; index < after.sets.length; index += 1) {
    const prev = before.sets[index] ?? { a: 0, b: 0 };
    const next = after.sets[index] ?? { a: 0, b: 0 };
    if (prev.a !== 0 || prev.b !== 0 || next.a !== 0 || next.b !== 0) last = index;
  }
  const marks: HistorySetMark[] = [];
  for (let index = 0; index <= last; index += 1) {
    const prev = before.sets[index] ?? { a: 0, b: 0 };
    const next = after.sets[index] ?? { a: 0, b: 0 };
    marks.push({
      a: next.a,
      b: next.b,
      aChanged: next.a !== prev.a,
      bChanged: next.b !== prev.b,
    });
  }
  return marks;
}

export function colonSetScore(sets: readonly [SetScore, SetScore, SetScore]): string {
  let last = -1;
  sets.forEach((set, index) => {
    if (set.a !== 0 || set.b !== 0) last = index;
  });
  if (last < 0) return '0:0';
  return sets
    .slice(0, last + 1)
    .map((set) => `${set.a}:${set.b}`)
    .join(', ');
}

function rowLabel(event: MatchEvent, state: MatchState): string {
  if (event.type === 'game/increment') return `${state.teams[event.team].name} won the game`;
  if (event.type === 'game/decrement') return `${state.teams[event.team].name} game removed`;
  return describeEvent(event);
}

/** Newest event first. Each row shows the full set score after the event. */
export function historyRows(start: MatchState, events: readonly MatchEvent[]): HistoryRow[] {
  const rows: HistoryRow[] = [];
  let state = start;
  for (const event of events) {
    const before = state;
    const after = matchReducer(before, event);
    state = after;
    rows.push({
      at: event.at,
      label: rowLabel(event, after),
      score: markedSets(before, after),
    });
  }
  rows.reverse();
  return rows;
}

export function currentHistory(log: MatchLog): HistoryRow[] {
  const events = currentMatchEvents(log);
  const prefix = log.events.slice(0, log.events.length - events.length);
  const start = prefix.reduce(matchReducer, log.base);
  return historyRows(start, events);
}

export function archivedHistory(
  id: string,
  at: number,
  nameA: string,
  nameB: string,
  events: readonly MatchEvent[],
): HistoryRow[] {
  return historyRows(createMatch(at, id, { a: nameA, b: nameB }), events);
}
