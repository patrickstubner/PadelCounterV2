import { isUuid } from './id';
import { MAX_EVENTS, replay, type MatchLog } from './log';
import { isValidStoredName } from './names';
import { parseStoredEvent } from './persistence';
import { celebrationWinner, isPlausibleSetScore } from './rules';
import { isTimestamp, type MatchEvent, type MatchState, type SetScore, type TeamId } from './types';

export const ARCHIVE_KEY = 'pcv2:matches';
export const ARCHIVE_SCHEMA = 1 as const;
export const MAX_ARCHIVED_MATCHES = 100;
export const MAX_ARCHIVE_RAW = 1_500_000;

export type ArchiveStatus = 'winner-a' | 'winner-b' | 'ended-early';

export interface ArchivedMatch {
  readonly id: string;
  readonly at: number;
  readonly teams: { readonly a: string; readonly b: string };
  readonly sets: readonly [SetScore, SetScore, SetScore];
  readonly status: ArchiveStatus;
  readonly events: readonly MatchEvent[];
}

export type ListedStatus = ArchiveStatus | 'in-progress';

export interface ListedMatch {
  readonly id: string;
  readonly at: number;
  readonly nameA: string;
  readonly nameB: string;
  readonly score: string;
  readonly status: string;
  readonly statusKind: ListedStatus;
  readonly events: readonly MatchEvent[];
  readonly live: boolean;
}

export interface ArchiveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function plain(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value)) copy[key] = value[key];
  return copy;
}

/** Events after the latest New match. Earlier matches are already archived. */
export function currentMatchEvents(log: MatchLog): MatchEvent[] {
  let start = 0;
  for (let index = 0; index < log.events.length; index += 1) {
    const event = log.events[index];
    if (event?.type === 'match/reset' || event?.type === 'match/new') start = index + 1;
  }
  return log.events.slice(start);
}

export function setScoreLine(sets: readonly [SetScore, SetScore, SetScore]): string {
  let last = -1;
  sets.forEach((set, index) => {
    if (set.a !== 0 || set.b !== 0) last = index;
  });
  if (last < 0) return '0–0';
  return sets
    .slice(0, last + 1)
    .map((set) => `${set.a}–${set.b}`)
    .join(', ');
}

export function liveStatus(state: MatchState): ListedStatus {
  const winner = celebrationWinner(state);
  if (winner === 'a') return 'winner-a';
  if (winner === 'b') return 'winner-b';
  if (state.ended) return 'ended-early';
  return 'in-progress';
}

export function statusLabel(status: ListedStatus, names: { readonly a: string; readonly b: string }): string {
  if (status === 'winner-a') return `${names.a} wins`;
  if (status === 'winner-b') return `${names.b} wins`;
  if (status === 'ended-early') return 'ended early';
  return 'in progress';
}

function archiveStatus(state: MatchState): ArchiveStatus {
  const winner = celebrationWinner(state);
  if (winner === 'a' || winner === 'b') return winner === 'a' ? 'winner-a' : 'winner-b';
  return 'ended-early';
}

function blankMatch(state: MatchState, events: readonly MatchEvent[]): boolean {
  if (state.ended || events.length > 0) return false;
  return state.sets.every((set) => set.a === 0 && set.b === 0);
}

/** Snapshot taken when a match is left behind by New match. A blank court is skipped. */
export function snapshotMatch(log: MatchLog): ArchivedMatch | null {
  const state = replay(log);
  const events = currentMatchEvents(log);
  if (blankMatch(state, events)) return null;
  return {
    id: state.matchId,
    at: state.updatedAt,
    teams: { a: state.teams.a.name, b: state.teams.b.name },
    sets: [state.sets[0], state.sets[1], state.sets[2]],
    status: archiveStatus(state),
    events,
  };
}

function byAge(left: ArchivedMatch, right: ArchivedMatch): number {
  if (left.at !== right.at) return left.at - right.at;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

/** Keeps the newest matches. The oldest timestamp is dropped first. */
export function fitArchive(matches: readonly ArchivedMatch[], maxRaw = MAX_ARCHIVE_RAW): ArchivedMatch[] {
  const sorted = [...matches].sort(byAge);
  let list = sorted.length > MAX_ARCHIVED_MATCHES ? sorted.slice(sorted.length - MAX_ARCHIVED_MATCHES) : sorted;
  while (list.length > 0 && JSON.stringify({ schemaVersion: ARCHIVE_SCHEMA, matches: list }).length > maxRaw) {
    list = list.slice(1);
  }
  return list;
}

export function rememberMatch(archive: readonly ArchivedMatch[], match: ArchivedMatch): ArchivedMatch[] {
  return fitArchive([...archive.filter((item) => item.id !== match.id), match]);
}

function parseScore(value: unknown): SetScore | null {
  const record = plain(value);
  if (!record) return null;
  const { a, b } = record;
  if (typeof a !== 'number' || typeof b !== 'number' || !isPlausibleSetScore(a, b)) return null;
  return { a, b };
}

function parseStatus(value: unknown): ArchiveStatus | null {
  if (value === 'winner-a' || value === 'winner-b' || value === 'ended-early') return value;
  return null;
}

function parseArchived(value: unknown): ArchivedMatch | null {
  const record = plain(value);
  if (!record || !isUuid(record.id) || !isTimestamp(record.at)) return null;
  const status = parseStatus(record.status);
  const teams = plain(record.teams);
  if (!status || !teams || !isValidStoredName(teams.a) || !isValidStoredName(teams.b)) return null;
  if (!Array.isArray(record.sets) || record.sets.length !== 3) return null;
  const set0 = parseScore(record.sets[0]);
  const set1 = parseScore(record.sets[1]);
  const set2 = parseScore(record.sets[2]);
  if (!set0 || !set1 || !set2) return null;
  if (!Array.isArray(record.events) || record.events.length > MAX_EVENTS) return null;
  const events: MatchEvent[] = [];
  for (const item of record.events) {
    const event = parseStoredEvent(item);
    if (!event) return null;
    events.push(event);
  }
  return {
    id: record.id.toLowerCase(),
    at: record.at,
    teams: { a: teams.a, b: teams.b },
    sets: [set0, set1, set2],
    status,
    events,
  };
}

/** One invalid match rejects the whole archive. A missing key is an empty list. */
export function parseArchive(input: unknown): ArchivedMatch[] {
  try {
    const record = plain(input);
    if (!record || record.schemaVersion !== ARCHIVE_SCHEMA || !Array.isArray(record.matches)) return [];
    if (record.matches.length > MAX_ARCHIVED_MATCHES) return [];
    const matches: ArchivedMatch[] = [];
    for (const item of record.matches) {
      const match = parseArchived(item);
      if (!match) return [];
      matches.push(match);
    }
    return matches;
  } catch {
    return [];
  }
}

export function loadArchive(storage: Pick<ArchiveStorage, 'getItem'>): ArchivedMatch[] {
  try {
    const raw = storage.getItem(ARCHIVE_KEY);
    if (raw === null || raw.length === 0 || raw.length > MAX_ARCHIVE_RAW) return [];
    return parseArchive(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

export function saveArchive(matches: readonly ArchivedMatch[], storage: Pick<ArchiveStorage, 'setItem'>): boolean {
  try {
    const raw = JSON.stringify({ schemaVersion: ARCHIVE_SCHEMA, matches: fitArchive(matches) });
    if (raw.length > MAX_ARCHIVE_RAW) return false;
    storage.setItem(ARCHIVE_KEY, raw);
    return true;
  } catch {
    return false;
  }
}

export function listMatches(log: MatchLog, archive: readonly ArchivedMatch[]): ListedMatch[] {
  const state = replay(log);
  const names = { a: state.teams.a.name, b: state.teams.b.name };
  const kind = liveStatus(state);
  const live: ListedMatch = {
    id: state.matchId,
    at: state.updatedAt,
    nameA: names.a,
    nameB: names.b,
    score: setScoreLine(state.sets),
    status: statusLabel(kind, names),
    statusKind: kind,
    events: currentMatchEvents(log),
    live: true,
  };
  const past: ListedMatch[] = archive
    .filter((match) => match.id !== live.id)
    .map((match) => ({
      id: match.id,
      at: match.at,
      nameA: match.teams.a,
      nameB: match.teams.b,
      score: setScoreLine(match.sets),
      status: statusLabel(match.status, match.teams),
      statusKind: match.status,
      events: match.events,
      live: false,
    }));
  return [live, ...past].sort((left, right) => right.at - left.at || Number(right.live) - Number(left.live));
}

export function winnerTeam(status: ListedStatus): TeamId | null {
  if (status === 'winner-a') return 'a';
  if (status === 'winner-b') return 'b';
  return null;
}
