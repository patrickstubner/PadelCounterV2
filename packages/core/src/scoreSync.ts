import { canonicalCausalId } from './id';
import { MAX_REVISION } from './parse';
import { matchReducer } from './reducer';
import { isPlausibleSetScore } from './rules';
import { isTimestamp } from './types';
import {
  isSetIndex,
  type MatchEvent,
  type MatchState,
  type SetIndex,
  type SetScore,
} from './types';

/**
 * A score event names the server event it was scored on (`parentId`) and the
 * board it produces. Merging uses that chain only. The phone's clock is not a
 * reason to drop or keep a point. It is stored, after a plausibility check, so
 * History can show when the point was tapped.
 */
export const MAX_PENDING_EVENTS = 64;

/** A phone clock more than this far from the server is clamped. Twelve hours covers a wrong timezone without accepting a clock set to another year. */
export const MAX_CLOCK_OFFSET_MS = 12 * 60 * 60 * 1000;

/** An event time this far ahead of the server is clamped back to the server clock. */
export const FUTURE_SLACK_MS = 5_000;

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
  readonly parentId?: string | null;
  readonly event: MatchEvent;
  readonly claim: ScoreClaim | null;
}

/** One event in a causal chain. `parentId` null means the start of the match. */
export interface CausalEvent {
  readonly id: string;
  readonly parentId: string | null;
  readonly event: MatchEvent;
  readonly claim: ScoreClaim | null;
}

export interface MergePlan {
  /**
   * `already`: nothing new to add.
   * `fast-forward`: the phone's events continue the server head.
   * `merged`: both sides added points; the phone's remaining points are kept.
   * `ambiguous`: the parent is missing or the chain is broken. Nothing is applied until someone asks.
   */
  readonly reason: 'already' | 'fast-forward' | 'merged' | 'ambiguous';
  readonly send: readonly CausalEvent[];
  readonly droppedIds: readonly string[];
  readonly ambiguous: readonly CausalEvent[];
}

export type ScoreDecision =
  | { readonly kind: 'not_score' }
  | { readonly kind: 'reject' }
  | { readonly kind: 'already' }
  | { readonly kind: 'apply' }
  | { readonly kind: 'conflict' };

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

/** Phone clock minus server clock, clamped. A missing or nonsense clock contributes no offset. */
export function clampClockOffset(clientNow: unknown, serverNow: number): number {
  if (!isTimestamp(clientNow) || !isTimestamp(serverNow)) return 0;
  const offset = serverNow - clientNow;
  if (!Number.isSafeInteger(offset)) return 0;
  if (offset > MAX_CLOCK_OFFSET_MS) return MAX_CLOCK_OFFSET_MS;
  if (offset < -MAX_CLOCK_OFFSET_MS) return -MAX_CLOCK_OFFSET_MS;
  return offset;
}

/**
 * Absolute instant for History. The phone's capture time is shifted by the
 * offset measured at hello, then clamped so a future or ancient clock cannot
 * be stored. This value is never used to decide whether two points are the same.
 */
export function capturedInstant(clientAt: number, offset: number, serverNow: number, earliest: number): number | null {
  if (!isTimestamp(clientAt) || !Number.isSafeInteger(offset) || !isTimestamp(serverNow)) return null;
  let at = clientAt + offset;
  if (!Number.isSafeInteger(at)) return null;
  if (at > serverNow + FUTURE_SLACK_MS) at = serverNow;
  if (isTimestamp(earliest) && at < earliest) at = earliest;
  return isTimestamp(at) ? at : null;
}

export function parseParentId(value: unknown): string | null | undefined {
  return canonicalCausalId(value);
}

/**
 * One stored board against one event, used when the event already sits on the server head.
 * Ending a match does not depend on the scoreboard matching.
 */
export function decideScore(server: MatchState, event: MatchEvent, claim: unknown): ScoreDecision {
  if (!isScoreEvent(event.type)) return { kind: 'not_score' };
  const parsed = parseScoreClaim(claim);
  if (!parsed || !claimMatchesEvent(event, parsed)) return { kind: 'reject' };
  if (event.type === 'match/end') return server.ended ? { kind: 'already' } : { kind: 'apply' };
  const board = scoreBoard(server);
  if (sameBoard(board, parsed.after)) return { kind: 'already' };
  if (sameBoard(board, parsed.before)) return { kind: 'apply' };
  return { kind: 'conflict' };
}

function blankFrom(board: ScoreBoard, revision: number): MatchState {
  return {
    schemaVersion: 2,
    matchId: '00000000-0000-4000-8000-000000000001',
    revision,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    teams: { a: { name: 'Team A' }, b: { name: 'Team B' } },
    sets: board.sets,
    activeSet: board.activeSet,
    serve: null,
    serveAsk: null,
    servePrompt: false,
    ended: board.ended,
  };
}

function gameDelta(claim: ScoreClaim): { set: 0 | 1 | 2; team: 'a' | 'b'; delta: 1 | -1 } | null {
  if (claim.before.ended !== claim.after.ended) return null;
  let found: { set: 0 | 1 | 2; team: 'a' | 'b'; delta: 1 | -1 } | null = null;
  for (let index = 0; index < 3; index += 1) {
    const before = claim.before.sets[index];
    const after = claim.after.sets[index];
    if (!before || !after) return null;
    const da = after.a - before.a;
    const db = after.b - before.b;
    if (da === 0 && db === 0) continue;
    if (found || (da !== 0 && db !== 0)) return null;
    const delta = da !== 0 ? da : db;
    if (delta !== 1 && delta !== -1) return null;
    const set = index === 0 || index === 1 || index === 2 ? index : null;
    if (set === null) return null;
    found = { set, team: da !== 0 ? 'a' : 'b', delta };
  }
  return found;
}

/** A rename or a serve change does not score a point, so it must not hide the point after it. */
function isSideEvent(event: MatchEvent): boolean {
  return event.type === 'team/rename' || event.type === 'serve/set';
}

/** A plus and a later minus of the same team and set cancel. The minus was undoing this phone's own point. */
function normalizeScoreChain(events: readonly CausalEvent[]): CausalEvent[] {
  const drop = new Set<number>();
  const stack: number[] = [];
  events.forEach((item, index) => {
    if (!item.claim) return;
    if (item.event.type !== 'game/increment' && item.event.type !== 'game/decrement') return;
    const delta = gameDelta(item.claim);
    if (!delta) return;
    if (item.event.type === 'game/increment' && delta.delta === 1) {
      stack.push(index);
      return;
    }
    if (item.event.type !== 'game/decrement' || delta.delta !== -1) return;
    for (let cursor = stack.length - 1; cursor >= 0; cursor -= 1) {
      const plusAt = stack[cursor];
      if (plusAt === undefined) continue;
      const plus = events[plusAt];
      const plusDelta = plus?.claim ? gameDelta(plus.claim) : null;
      if (!plus || plusDelta?.set !== delta.set || plusDelta.team !== delta.team) continue;
      drop.add(plusAt);
      drop.add(index);
      stack.splice(cursor, 1);
      return;
    }
  });
  if (drop.size === 0) return [...events];
  const origin = events[0];
  if (!origin?.claim) return events.filter((_, index) => !drop.has(index));
  let state = blankFrom(origin.claim.before, origin.claim.baseRevision);
  let parent = origin.parentId;
  const kept: CausalEvent[] = [];
  events.forEach((item, index) => {
    if (drop.has(index)) return;
    const claim = isScoreEvent(item.event.type) ? scoreClaimFor(state, item.event) : item.claim;
    const next = matchReducer(state, item.event);
    if (next === state) return;
    kept.push({ ...item, parentId: parent, claim });
    parent = item.id;
    state = next;
  });
  return kept;
}

function ambiguous(events: readonly CausalEvent[], droppedIds: readonly string[]): MergePlan {
  return { reason: 'ambiguous', send: [], droppedIds: [...droppedIds], ambiguous: events };
}

type PointEffect =
  | { readonly kind: 'point'; readonly team: 'a' | 'b'; readonly sign: 1 | -1; readonly set: 0 | 1 | 2 }
  | { readonly kind: 'select'; readonly index: 0 | 1 | 2 }
  | { readonly kind: 'end' }
  | { readonly kind: 'resume' };

/** The set a game point changed, plus the team and the direction. */
function pointEffect(before: MatchState, event: MatchEvent): PointEffect | 'side' | null {
  if (isSideEvent(event)) return 'side';
  if (event.type === 'set/select') return { kind: 'select', index: event.index };
  if (event.type === 'match/end') return { kind: 'end' };
  if (event.type === 'match/resume') return { kind: 'resume' };
  if (event.type !== 'game/increment' && event.type !== 'game/decrement') return null;
  const after = matchReducer(before, event);
  if (after === before) return null;
  let set: 0 | 1 | 2 = before.activeSet;
  for (let index = 0; index < 3; index += 1) {
    const left = before.sets[index];
    const right = after.sets[index];
    if (!left || !right || (left.a === right.a && left.b === right.b)) continue;
    set = index === 1 ? 1 : index === 2 ? 2 : 0;
    break;
  }
  return { kind: 'point', team: event.team, sign: event.type === 'game/increment' ? 1 : -1, set };
}

/**
 * Same team and same plus or minus. The set is remembered, and the same set is
 * preferred, but a set win on one phone does not turn the other phone's point
 * into a second point.
 */
function samePoint(left: PointEffect, right: PointEffect): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'point' && right.kind === 'point') return left.team === right.team && left.sign === right.sign;
  if (left.kind === 'select' && right.kind === 'select') return left.index === right.index;
  return true;
}

function takeEffect(effect: PointEffect, effects: readonly PointEffect[], used: Set<number>): number {
  let loose = -1;
  for (let index = 0; index < effects.length; index += 1) {
    if (used.has(index)) continue;
    const serverEffect = effects[index];
    if (!serverEffect || !samePoint(effect, serverEffect)) continue;
    if (effect.kind === 'point' && serverEffect.kind === 'point' && effect.set === serverEffect.set) return index;
    if (loose < 0) loose = index;
  }
  return loose;
}

/**
 * Merge a phone's chain onto the server log.
 * Points since the fork match as a set of team, set, and direction, in any order.
 * A point that exists only on the phone is added, including a minus.
 * The phone's clock is not read.
 */
export function planMerge(base: MatchState, server: readonly CausalEvent[], pending: readonly CausalEvent[]): MergePlan {
  if (pending.length > MAX_PENDING_EVENTS) return ambiguous(pending, pending.map((item) => item.id));
  const dropped: string[] = [];
  const known = new Set(server.map((item) => item.id));
  const fresh = pending.filter((item) => {
    if (known.has(item.id)) {
      dropped.push(item.id);
      return false;
    }
    return true;
  });
  if (fresh.length === 0) return { reason: 'already', send: [], droppedIds: dropped, ambiguous: [] };
  for (let index = 1; index < fresh.length; index += 1) {
    if (fresh[index]?.parentId !== fresh[index - 1]?.id) return ambiguous(fresh, dropped);
  }
  for (const item of fresh) {
    if (!isScoreEvent(item.event.type)) continue;
    if (!item.claim || !claimMatchesEvent(item.event, item.claim)) return ambiguous(fresh, dropped);
  }

  const normalized = normalizeScoreChain(fresh);
  const keptIds = new Set(normalized.map((item) => item.id));
  for (const item of fresh) {
    if (!keptIds.has(item.id)) dropped.push(item.id);
  }
  if (normalized.length === 0) return { reason: 'already', send: [], droppedIds: dropped, ambiguous: [] };

  const fork = normalized[0]?.parentId ?? null;
  if (fork !== null && !known.has(fork)) return ambiguous(normalized, dropped);

  let forkState = base;
  if (fork !== null) {
    let found = false;
    for (const item of server) {
      forkState = matchReducer(forkState, item.event);
      if (item.id === fork) {
        found = true;
        break;
      }
    }
    if (!found) return ambiguous(normalized, dropped);
  }
  const forkIndex = fork === null ? -1 : server.findIndex((item) => item.id === fork);
  const serverSuffix = server.slice(forkIndex + 1);
  const first = normalized[0];
  if (first?.claim && isScoreEvent(first.event.type) && !sameBoard(scoreBoard(forkState), first.claim.before)) {
    return ambiguous(normalized, dropped);
  }

  let serverCursor = forkState;
  const serverEffects: PointEffect[] = [];
  for (const item of serverSuffix) {
    const effect = pointEffect(serverCursor, item.event);
    const next = matchReducer(serverCursor, item.event);
    if (effect && effect !== 'side') serverEffects.push(effect);
    if (next !== serverCursor) serverCursor = next;
  }

  let clientCursor = forkState;
  const used = new Set<number>();
  const remainder: CausalEvent[] = [];
  for (const item of normalized) {
    const effect = pointEffect(clientCursor, item.event);
    const next = matchReducer(clientCursor, item.event);
    if (next !== clientCursor) clientCursor = next;
    if (!effect || effect === 'side') {
      if (effect === 'side') remainder.push(item);
      else dropped.push(item.id);
      continue;
    }
    const found = takeEffect(effect, serverEffects, used);
    if (found >= 0) {
      used.add(found);
      dropped.push(item.id);
      continue;
    }
    remainder.push(item);
  }
  if (remainder.length === 0) return { reason: 'already', send: [], droppedIds: dropped, ambiguous: [] };

  let head = base;
  for (const item of server) head = matchReducer(head, item.event);
  let pendingSend = remainder;
  if (head.ended) {
    const resumable = remainder.filter((item) => item.event.type === 'match/resume');
    for (const item of remainder) {
      if (item.event.type !== 'match/resume') dropped.push(item.id);
    }
    if (resumable.length === 0) return { reason: 'already', send: [], droppedIds: dropped, ambiguous: [] };
    pendingSend = resumable;
  }
  let parent: string | null = server.length > 0 ? server[server.length - 1]?.id ?? null : null;
  const send: CausalEvent[] = [];
  for (const item of pendingSend) {
    const claim = isScoreEvent(item.event.type) ? scoreClaimFor(head, item.event) : null;
    const next = matchReducer(head, item.event);
    if (next === head || (isScoreEvent(item.event.type) && !claim)) {
      dropped.push(item.id);
      continue;
    }
    send.push({ id: item.id, parentId: parent, event: item.event, claim });
    parent = item.id;
    head = next;
  }
  if (send.length === 0) return { reason: 'already', send: [], droppedIds: dropped, ambiguous: [] };
  const fast = used.size === serverEffects.length;
  return { reason: fast ? 'fast-forward' : 'merged', send, droppedIds: dropped, ambiguous: [] };
}
