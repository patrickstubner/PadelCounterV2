import { withActor } from '@padel/core';
import { isUuid } from './id';
import { MAX_EVENTS, type MatchLog } from './log';
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
  type TeamId,
  type SetScore,
} from './types';

export const STORAGE_KEY = 'pcv2:log';

export const MAX_RAW_LENGTH = 96_000;
const MAX_REVISION = 10_000_000;
const MAX_RENAME_CODE_POINTS = 80;

export interface MatchStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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

function parseState(value: unknown, version: 1 | 2): MatchState | null {
  const record = plain(value);
  if (!record) return null;
  if (record.schemaVersion !== version) return null;
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

  let serve: Server | null = null;
  let serveAsk: TeamId | null = null;
  let servePrompt = false;
  let ended = false;
  if (version === 2) {
    const parsed = parseServe(record.serve);
    if (parsed === undefined) return null;
    serve = parsed;
    if (record.serveAsk !== undefined && record.serveAsk !== null) {
      if (!isTeamId(record.serveAsk)) return null;
      serveAsk = record.serveAsk;
    }
    if (record.servePrompt !== undefined) {
      if (typeof record.servePrompt !== 'boolean') return null;
      servePrompt = record.servePrompt;
    }
    if (record.ended !== undefined) {
      if (typeof record.ended !== 'boolean') return null;
      ended = record.ended;
    }
  }

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
    serve,
    serveAsk,
    servePrompt,
    ended,
  };
}

export function parseStoredEvent(value: unknown): MatchEvent | null {
  const record = plain(value);
  if (!record || !isTimestamp(record.at)) return null;

  switch (record.type) {
    case 'game/increment':
    case 'game/decrement': {
      if (!isTeamId(record.team)) return null;
      const event = { type: record.type, team: record.team, at: record.at };
      return withActor(event, record.by);
    }
    case 'set/select': {
      if (!isSetIndex(record.index)) return null;
      const event = { type: 'set/select' as const, index: record.index, at: record.at };
      return withActor(event, record.by);
    }
    case 'team/rename': {
      if (!isTeamId(record.team) || typeof record.name !== 'string') return null;
      if (codePointLength(record.name) > MAX_RENAME_CODE_POINTS) return null;
      const event = { type: 'team/rename' as const, team: record.team, name: record.name, at: record.at };
      return withActor(event, record.by);
    }
    case 'match/reset':
    case 'match/new': {
      if (typeof record.matchId !== 'string' || !isUuid(record.matchId)) return null;
      const event = { type: record.type, matchId: record.matchId.toLowerCase(), at: record.at };
      return withActor(event, record.by);
    }
    case 'match/end': {
      const event = { type: 'match/end' as const, at: record.at };
      return withActor(event, record.by);
    }
    case 'match/resume': {
      const event = { type: 'match/resume' as const, at: record.at };
      return withActor(event, record.by);
    }
    case 'serve/set': {
      if (record.team === null && record.player === null) {
        const cleared = { type: 'serve/set' as const, team: null, player: null, at: record.at };
        return withActor(cleared, record.by);
      }
      if (!isTeamId(record.team) || !isPlayerSlot(record.player)) return null;
      const event = { type: 'serve/set' as const, team: record.team, player: record.player, at: record.at };
      return withActor(event, record.by);
    }
    default:
      return null;
  }
}

export function parsePersisted(input: unknown): MatchLog | null {
  try {
    const record = plain(input);
    if (!record) return null;

    if (record.schemaVersion === 1) {
      const base = parseState(record.state, 1);
      if (!base) return null;
      return { schemaVersion: SCHEMA_VERSION, base, events: [] };
    }

    if (record.schemaVersion !== SCHEMA_VERSION) return null;
    const base = parseState(record.base, 2);
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

export function serializeLog(log: MatchLog): string {
  return JSON.stringify({ schemaVersion: SCHEMA_VERSION, base: log.base, events: log.events });
}

export function loadLog(storage: Pick<MatchStorage, 'getItem'>): MatchLog | null {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null || raw.length === 0 || raw.length > MAX_RAW_LENGTH) return null;
    return parsePersisted(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function saveLog(log: MatchLog, storage: Pick<MatchStorage, 'setItem'>): boolean {
  try {
    const raw = serializeLog(log);
    if (raw.length > MAX_RAW_LENGTH) return false;
    storage.setItem(STORAGE_KEY, raw);
    return true;
  } catch {
    return false;
  }
}
