import { isUuid } from './id';
import { codePointLength, isValidStoredName } from './names';
import { isPlausibleSetScore } from './rules';
import {
  SCHEMA_VERSION,
  isPlayerSlot,
  isSetIndex,
  isTeamId,
  isTimestamp,
  type MatchEvent,
  type MatchState,
  type Server,
  type SetScore,
  type TeamId,
} from './types';

export const MAX_EVENTS = 500;
export const MAX_RAW_LENGTH = 96_000;
const MAX_REVISION = 10_000_000;
const MAX_RENAME_CODE_POINTS = 80;

export interface MatchLog {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly base: MatchState;
  readonly events: readonly MatchEvent[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Copy own keys onto a null-prototype object so a payload cannot reach `Object.prototype`. */
function plain(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    copy[key] = value[key];
  }
  return copy;
}

function parseScore(value: unknown): SetScore | null {
  const record = plain(value);
  if (!record) return null;
  const a = record.a;
  const b = record.b;
  if (typeof a !== 'number' || typeof b !== 'number') return null;
  if (!isPlausibleSetScore(a, b)) return null;
  return { a, b };
}

function parseServe(value: unknown): Server | null | undefined {
  if (value === null) return null;
  const record = plain(value);
  if (!record) return undefined;
  if (!isTeamId(record.team) || !isPlayerSlot(record.player)) return undefined;
  return { team: record.team, player: record.player };
}

function parseState(value: unknown): MatchState | null {
  const record = plain(value);
  if (!record) return null;
  if (record.schemaVersion !== SCHEMA_VERSION) return null;
  if (!isUuid(record.matchId)) return null;
  if (typeof record.revision !== 'number' || !Number.isInteger(record.revision)) return null;
  if (record.revision < 0 || record.revision > MAX_REVISION) return null;
  if (!isTimestamp(record.createdAt) || !isTimestamp(record.updatedAt)) return null;
  if (!isSetIndex(record.activeSet)) return null;
  if (!Array.isArray(record.sets) || record.sets.length !== 3) return null;

  const set0 = parseScore(record.sets[0]);
  const set1 = parseScore(record.sets[1]);
  const set2 = parseScore(record.sets[2]);
  if (!set0 || !set1 || !set2) return null;

  const teams = plain(record.teams);
  const teamA = teams ? plain(teams.a) : null;
  const teamB = teams ? plain(teams.b) : null;
  if (!teamA || !teamB) return null;
  if (!isValidStoredName(teamA.name) || !isValidStoredName(teamB.name)) return null;

  const parsed = parseServe(record.serve);
  if (parsed === undefined) return null;
  let serveAsk: TeamId | null = null;
  if (record.serveAsk !== undefined && record.serveAsk !== null) {
    if (!isTeamId(record.serveAsk)) return null;
    serveAsk = record.serveAsk;
  }
  if (record.servePrompt !== undefined && typeof record.servePrompt !== 'boolean') return null;
  if (record.ended !== undefined && typeof record.ended !== 'boolean') return null;

  return {
    schemaVersion: SCHEMA_VERSION,
    matchId: record.matchId.toLowerCase(),
    revision: record.revision,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    activeSet: record.activeSet,
    teams: {
      a: { name: teamA.name },
      b: { name: teamB.name },
    },
    sets: [set0, set1, set2],
    serve: parsed,
    serveAsk,
    servePrompt: record.servePrompt === true,
    ended: record.ended === true,
  };
}

/** Known court events only. Undo and any other type are rejected. */
export function parseStoredEvent(value: unknown): MatchEvent | null {
  const record = plain(value);
  if (!record || !isTimestamp(record.at)) return null;

  switch (record.type) {
    case 'game/increment':
    case 'game/decrement':
      if (!isTeamId(record.team)) return null;
      return { type: record.type, team: record.team, at: record.at };
    case 'set/select':
      if (!isSetIndex(record.index)) return null;
      return { type: 'set/select', index: record.index, at: record.at };
    case 'team/rename':
      if (!isTeamId(record.team) || typeof record.name !== 'string') return null;
      if (codePointLength(record.name) > MAX_RENAME_CODE_POINTS) return null;
      return { type: 'team/rename', team: record.team, name: record.name, at: record.at };
    case 'match/reset':
    case 'match/new':
      if (typeof record.matchId !== 'string' || !isUuid(record.matchId)) return null;
      return { type: record.type, matchId: record.matchId.toLowerCase(), at: record.at };
    case 'match/end':
      return { type: 'match/end', at: record.at };
    case 'match/resume':
      return { type: 'match/resume', at: record.at };
    case 'serve/set':
      if (record.team === null && record.player === null) {
        return { type: 'serve/set', team: null, player: null, at: record.at };
      }
      if (!isTeamId(record.team) || !isPlayerSlot(record.player)) return null;
      return { type: 'serve/set', team: record.team, player: record.player, at: record.at };
    default:
      return null;
  }
}

export function parseMatchLog(input: unknown): MatchLog | null {
  try {
    const record = plain(input);
    if (!record || record.schemaVersion !== SCHEMA_VERSION) return null;
    const base = parseState(record.base);
    if (!base) return null;
    if (!Array.isArray(record.events) || record.events.length > MAX_EVENTS) return null;
    const events: MatchEvent[] = [];
    for (const item of record.events) {
      const event = parseStoredEvent(item);
      if (!event) return null;
      events.push(event);
    }
    return { schemaVersion: SCHEMA_VERSION, base, events };
  } catch {
    return null;
  }
}
