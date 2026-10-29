import { MAX_REVISION } from './parse';
import { matchReducer } from './reducer';
import { isPlausibleSetScore } from './rules';
import {
  isSetIndex,
  type MatchEvent,
  type MatchState,
  type SetIndex,
  type SetScore,
} from './types';

/**
 * A score event names the board it started from and the board it produces.
 * On reconnect the phone compares that chain with the server board.
 * The same resulting board is not applied again. A board the server never
 * passed through is a conflict: the server board stays, and the phone drops
 * the stale events. The match history is the server log; a dropped event is
 * not inserted.
 */
export const MAX_PENDING_EVENTS = 64;

const SCORE_TYPES: ReadonlySet<string> = new Set([
  'game/increment',
  'game/decrement',
  'set/select',
  'match/end',
  'match/resume',
]);

const CLAIM_KEYS: ReadonlySet<string> = new Set(['before', 'after', 'baseRevision']);
const BOARD_KEYS: ReadonlySet<string> = new Set(['sets', 'activeSet', 'ended']);
const SET_KEYS: ReadonlySet<string> = new Set(['a', 'b']);

export interface ScoreBoard {
  readonly sets: readonly [SetScore, SetScore, SetScore];
  readonly activeSet: SetIndex;
  readonly ended: boolean;
}

/** `before` is the board the phone scored from. `after` is the board that point produces. */
export interface ScoreClaim {
  readonly before: ScoreBoard;
  readonly after: ScoreBoard;
  /** Revision the phone had for that board. Checked for type and range, not used as the winner. */
  readonly baseRevision: number;
}

export interface PendingScore {
  readonly id: string;
  readonly event: MatchEvent;
  readonly claim: ScoreClaim | null;
}

export type ScoreDecision =
  | { readonly kind: 'not_score' }
  | { readonly kind: 'reject' }
  | { readonly kind: 'already' }
  | { readonly kind: 'apply' }
  | { readonly kind: 'conflict' };

export interface ReconcilePlan {
  /** Events that still need the server. Score events already on the server are omitted. */
  readonly send: readonly PendingScore[];
  /** Score events left out, plus every queued event when the server wins a conflict. */
  readonly droppedIds: readonly string[];
  /**
   * `already`: the server board is the last queued score.
   * `suffix`: the server board is in the middle of the queue; only the rest is sent.
   * `current`: the server board is the start of the queue.
   * `conflict`: the server board is not on this chain. Nothing is sent.
   */
  readonly reason: 'already' | 'suffix' | 'current' | 'conflict';
}

export function isScoreEvent(type: string): boolean {
  return SCORE_TYPES.has(type);
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

function exactKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  const keys = Object.keys(record);
  if (keys.length !== allowed.size) return false;
  for (const key of keys) {
    if (!allowed.has(key)) return false;
  }
  return true;
}

function copySet(score: SetScore | undefined): SetScore {
  return { a: score?.a ?? 0, b: score?.b ?? 0 };
}

export function scoreBoard(state: MatchState): ScoreBoard {
  return {
    sets: [copySet(state.sets[0]), copySet(state.sets[1]), copySet(state.sets[2])],
    activeSet: state.activeSet,
    ended: state.ended,
  };
}

export function sameBoard(left: ScoreBoard, right: ScoreBoard): boolean {
  if (left.activeSet !== right.activeSet || left.ended !== right.ended) return false;
  for (let index = 0; index < 3; index += 1) {
    const a = left.sets[index];
    const b = right.sets[index];
    if (!a || !b || a.a !== b.a || a.b !== b.b) return false;
  }
  return true;
}

function parseSet(value: unknown): SetScore | null {
  const record = plain(value);
  if (!record || !exactKeys(record, SET_KEYS)) return null;
  const { a, b } = record;
  if (typeof a !== 'number' || typeof b !== 'number' || !isPlausibleSetScore(a, b)) return null;
  return { a, b };
}

function parseBoard(value: unknown): ScoreBoard | null {
  const record = plain(value);
  if (!record || !exactKeys(record, BOARD_KEYS)) return null;
  if (!isSetIndex(record.activeSet) || typeof record.ended !== 'boolean') return null;
  if (!Array.isArray(record.sets) || record.sets.length !== 3) return null;
  const sets: SetScore[] = [];
  for (const item of record.sets) {
    const score = parseSet(item);
    if (!score) return null;
    sets.push(score);
  }
  const set0 = sets[0];
  const set1 = sets[1];
  const set2 = sets[2];
  if (!set0 || !set1 || !set2) return null;
  return { sets: [set0, set1, set2], activeSet: record.activeSet, ended: record.ended };
}

/** Rejects a claim whose shape, types, or game bounds are wrong. Does not check that the event produces it. */
export function parseScoreClaim(value: unknown): ScoreClaim | null {
  const record = plain(value);
  if (!record || !exactKeys(record, CLAIM_KEYS)) return null;
  const before = parseBoard(record.before);
  const after = parseBoard(record.after);
  const revision = record.baseRevision;
  if (!before || !after) return null;
  if (typeof revision !== 'number' || !Number.isInteger(revision)) return null;
  if (revision < 0 || revision > MAX_REVISION) return null;
  return { before, after, baseRevision: revision };
}

export function scoreClaimFor(state: MatchState, event: MatchEvent): ScoreClaim | null {
  if (!isScoreEvent(event.type)) return null;
  const next = matchReducer(state, event);
  if (next === state) return null;
  return {
    before: scoreBoard(state),
    after: scoreBoard(next),
    baseRevision: state.revision,
  };
}

/** True when `after` is exactly what this event does to `before`. A lie is rejected. */
export function claimMatchesEvent(event: MatchEvent, claim: ScoreClaim): boolean {
  if (!isScoreEvent(event.type)) return false;
  const blank = {
    schemaVersion: 2 as const,
    matchId: '00000000-0000-4000-8000-000000000001',
    revision: claim.baseRevision,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    teams: { a: { name: 'Team A' }, b: { name: 'Team B' } },
    sets: claim.before.sets,
    activeSet: claim.before.activeSet,
    serve: null,
    serveAsk: null,
    servePrompt: false,
    ended: claim.before.ended,
  };
  const next = matchReducer(blank, event);
  if (next === blank) return false;
  return sameBoard(scoreBoard(next), claim.after);
}

/**
 * One stored board against one event.
 * `already` means the server is already at `after` (do not append).
 * `apply` means the server is still at `before`.
 * `conflict` means the server is on neither board.
 */
export function decideScore(server: MatchState, event: MatchEvent, claim: unknown): ScoreDecision {
  if (!isScoreEvent(event.type)) return { kind: 'not_score' };
  const parsed = parseScoreClaim(claim);
  if (!parsed || !claimMatchesEvent(event, parsed)) return { kind: 'reject' };
  const board = scoreBoard(server);
  if (sameBoard(board, parsed.after)) return { kind: 'already' };
  if (sameBoard(board, parsed.before)) return { kind: 'apply' };
  return { kind: 'conflict' };
}

function conflict(pending: readonly PendingScore[]): ReconcilePlan {
  return { send: [], droppedIds: pending.map((item) => item.id), reason: 'conflict' };
}

/**
 * Compare a phone's queued events with the server board before they are sent again.
 * The score events must form one chain. Non-score events (a rename, a serve) stay
 * in the list unless the score chain conflicts, in which case the whole queue is dropped.
 */
export function reconcilePending(server: MatchState, pending: readonly PendingScore[]): ReconcilePlan {
  if (pending.length > MAX_PENDING_EVENTS) return conflict(pending);
  const scoreAt: number[] = [];
  for (let index = 0; index < pending.length; index += 1) {
    const item = pending[index];
    if (!item || !isScoreEvent(item.event.type)) continue;
    if (!item.claim || !claimMatchesEvent(item.event, item.claim)) return conflict(pending);
    scoreAt.push(index);
  }
  if (scoreAt.length === 0) return { send: pending, droppedIds: [], reason: 'current' };

  for (let index = 1; index < scoreAt.length; index += 1) {
    const previousAt = scoreAt[index - 1];
    const currentAt = scoreAt[index];
    if (previousAt === undefined || currentAt === undefined) return conflict(pending);
    const previous = pending[previousAt];
    const current = pending[currentAt];
    if (!previous?.claim || !current?.claim) return conflict(pending);
    if (!sameBoard(previous.claim.after, current.claim.before)) return conflict(pending);
  }

  const serverBoard = scoreBoard(server);
  const lastAt = scoreAt[scoreAt.length - 1];
  const last = lastAt === undefined ? undefined : pending[lastAt];
  if (last?.claim && sameBoard(serverBoard, last.claim.after)) {
    const dropped = new Set(scoreAt);
    return {
      send: pending.filter((_, index) => !dropped.has(index)),
      droppedIds: scoreAt.map((index) => pending[index]?.id ?? ''),
      reason: 'already',
    };
  }

  let matched = -1;
  for (let index = 0; index < scoreAt.length; index += 1) {
    const at = scoreAt[index];
    const item = at === undefined ? undefined : pending[at];
    if (item?.claim && sameBoard(serverBoard, item.claim.after)) matched = index;
  }
  if (matched >= 0) {
    const start = scoreAt[matched + 1];
    const next = start === undefined ? undefined : pending[start];
    if (start === undefined || !next?.claim || !sameBoard(serverBoard, next.claim.before)) return conflict(pending);
    const dropped = new Set(scoreAt.filter((index) => index < start));
    return {
      send: pending.filter((_, index) => !dropped.has(index)),
      droppedIds: [...dropped].map((index) => pending[index]?.id ?? ''),
      reason: 'suffix',
    };
  }

  const firstAt = scoreAt[0];
  const first = firstAt === undefined ? undefined : pending[firstAt];
  if (first?.claim && sameBoard(serverBoard, first.claim.before)) {
    return { send: pending, droppedIds: [], reason: 'current' };
  }
  return conflict(pending);
}
