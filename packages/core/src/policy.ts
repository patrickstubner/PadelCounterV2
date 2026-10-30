import type { Role } from './access';
import type { MatchEvent, MatchState } from './types';

/** How long a previous match can still offer a reconnect. */
export const RECONNECT_WINDOW_MS = 60 * 60 * 1000;

/** The live room stops taking scores this long after the last event. */
export const ROOM_CLOSE_MS = 24 * 60 * 60 * 1000;

/** D1 keeps a finished match this long, then the scheduled job deletes it. Two years is 730 days. */
export const HISTORY_RETAIN_MS = 730 * 24 * 60 * 60 * 1000;

/** Unauthenticated creates allowed for one device on one UTC day. */
export const MATCHES_PER_DAY = 10;

/** Abuse cap for one network address on one UTC day. Shared court Wi-Fi still has room. */
export const MATCHES_PER_NETWORK_PER_DAY = 100;

/** Create-quota rows older than this are deleted by the scheduled job. */
export const QUOTA_RETAIN_MS = 2 * 24 * 60 * 60 * 1000;

/** Successful POST /join for one device inside one minute. A failed token does not count. The id is chosen by the client. */
export const JOINS_PER_DEVICE = 20;

/** Failed POST /join attempts for one network address inside one minute. A successful join does not count. */
export const JOINS_PER_NETWORK = 60;

export const JOIN_WINDOW_MS = 60_000;

export function joinWindow(now: number): number {
  if (!Number.isInteger(now)) return 0;
  return Math.floor(now / JOIN_WINDOW_MS);
}

/** Highest `pN` id handed to a joining phone. Host is not in this range. */
export const MAX_PLAYER_ACTOR = 32;

export const HOST_ACTOR = 'host';

/** 128 random bits, written as hex with a leading d. */
export const DEVICE_ID_PATTERN = /^d[a-f0-9]{32}$/;

/** Ids stored before 2.2.6. Accepted only as a one-time upgrade of the same phone. */
export const LEGACY_DEVICE_ID_PATTERN = /^d[a-f0-9]{8}$/;

export function isDeviceId(value: unknown): value is string {
  return typeof value === 'string' && DEVICE_ID_PATTERN.test(value);
}

export function isLegacyDeviceId(value: unknown): value is string {
  return typeof value === 'string' && LEGACY_DEVICE_ID_PATTERN.test(value);
}

/** New codes a match may mint in one hour. Showing the current code does not count. */
export const MINT_PER_MATCH = 10;

/** Times the host may replace the shared invite in one hour. Guests do not spend this. */
export const ROTATE_PER_MATCH = 5;

/** Times one guest phone may replace the shared invite in one hour. */
export const GUEST_ROTATE_PER_DEVICE = 2;

/** Times one phone may move the court. Another phone keeps its own count. */
export const CARRY_PER_DEVICE = 3;

/** Same number as {@link CARRY_PER_DEVICE}. The cap is per starter phone, not per match. */
export const CARRY_PER_MATCH = CARRY_PER_DEVICE;

/** A scanned code that never says hello is dropped after this. */
export const UNUSED_MINT_MS = 3 * 60 * 1000;

export const MATCH_BUDGET_WINDOW_MS = 60 * 60 * 1000;

/** An offline phone is still part of the court for this long after it was last seen. */
export const MEMBER_SEEN_MS = RECONNECT_WINDOW_MS;

export function actorId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (value === 'host' || value === 'device') return value;
  if (isDeviceId(value)) return value;
  const player = /^p([1-9]\d*)$/.exec(value);
  if (!player) return undefined;
  const n = Number(player[1]);
  if (n >= 2 && n <= MAX_PLAYER_ACTOR) return value;
  return undefined;
}

export function withActor(event: MatchEvent, by: unknown): MatchEvent {
  const id = actorId(by);
  return id ? { ...event, by: id } : event;
}

export function whoLabel(by: string | undefined): string | null {
  if (!by) return null;
  if (by === HOST_ACTOR) return 'Host';
  if (by === 'device' || isDeviceId(by)) return 'This phone';
  const player = /^p([1-9]\d*)$/.exec(by);
  if (player && actorId(by)) return `Player ${player[1]}`;
  return null;
}

export function quotaDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function offerReconnect(lastChangeAt: number, now: number): boolean {
  if (!Number.isInteger(lastChangeAt) || !Number.isInteger(now)) return false;
  if (now < lastChangeAt) return false;
  return now - lastChangeAt <= RECONNECT_WINDOW_MS;
}

export function lastChangeAt(createdAt: number, eventTimes: readonly number[]): number {
  let last = createdAt;
  for (const at of eventTimes) {
    if (Number.isInteger(at) && at > last) last = at;
  }
  return last;
}

export interface CarryInvite {
  readonly tokenHash: string;
  readonly host: boolean;
  readonly deviceId?: string | null;
}

/** Other phones moved with the starter. The starter is the fourth seat. */
export const CARRY_LIMIT = 3;

export interface CarryMember {
  readonly deviceId: string;
  readonly connected: boolean;
}

/**
 * Devices that may enter the next match.
 * The caller must be a member. The list itself comes from the room, not from the client.
 * Connected phones come first, then phones that joined and are offline. At most three.
 */
export function carryDeviceIds(input: {
  readonly confirm: boolean;
  readonly memberInitiated: boolean;
  readonly members: readonly CarryMember[];
  readonly excludeDeviceId?: string | null;
  readonly limit?: number;
}): readonly string[] {
  if (input.confirm !== true || input.memberInitiated !== true) return [];
  const limit = input.limit ?? CARRY_LIMIT;
  const exclude = input.excludeDeviceId ?? null;
  const seen = new Set<string>();
  const connected: string[] = [];
  const offline: string[] = [];
  for (const member of input.members) {
    if (!isDeviceId(member.deviceId)) continue;
    if (member.deviceId === exclude || seen.has(member.deviceId)) continue;
    seen.add(member.deviceId);
    if (member.connected) connected.push(member.deviceId);
    else offline.push(member.deviceId);
  }
  return [...connected, ...offline].slice(0, limit);
}

/** Previously joined devices, and only after a member confirmed. */
export function carryTokenHashes(input: {
  readonly confirm: boolean;
  readonly memberInitiated: boolean;
  readonly joinedHashes: readonly string[];
  readonly invites: readonly CarryInvite[];
  readonly excludeDeviceId?: string | null;
}): readonly CarryInvite[] {
  if (input.confirm !== true || input.memberInitiated !== true) return [];
  const joined = new Set(input.joinedHashes);
  const carried: CarryInvite[] = [];
  for (const invite of input.invites) {
    if (!invite.deviceId || invite.deviceId === input.excludeDeviceId) continue;
    if (!joined.has(invite.tokenHash)) continue;
    if (carried.some((row) => row.deviceId === invite.deviceId)) continue;
    carried.push(invite);
  }
  return carried.slice(0, CARRY_LIMIT);
}

export function credentialAllowsEvent(input: {
  readonly role: Role;
  readonly expiresAt: number;
  readonly revokedAt: number | null;
  readonly now: number;
}): 'expired' | 'revoked' | 'forbidden' | null {
  if (!Number.isInteger(input.expiresAt) || !Number.isInteger(input.now)) return 'forbidden';
  if (input.revokedAt !== null) return 'revoked';
  if (input.now >= input.expiresAt) return 'expired';
  if (input.role !== 'player') return 'forbidden';
  return null;
}

export function roomAcceptsScore(lastAt: number, now: number): boolean {
  if (!Number.isInteger(lastAt) || !Number.isInteger(now)) return false;
  // A last-change time ahead of the server is not usable. The room stays closed.
  if (now < lastAt) return false;
  return now - lastAt < ROOM_CLOSE_MS;
}

export function historyExpired(lastActivity: number, now: number): boolean {
  if (!Number.isInteger(lastActivity) || !Number.isInteger(now)) return false;
  return now - lastActivity >= HISTORY_RETAIN_MS;
}

/**
 * Reopen is the undo of End match.
 * The creator can always reopen. The person who ended it can reopen too,
 * unless the creator was the one who ended it.
 */
export function canReopen(input: {
  readonly events: readonly Pick<MatchEvent, 'type' | 'by'>[];
  readonly actorId: string;
  readonly actorIsHost: boolean;
}): boolean {
  let ended = false;
  let endedBy: string | null = null;
  for (const event of input.events) {
    if (event.type === 'match/end') {
      ended = true;
      endedBy = event.by ?? HOST_ACTOR;
    } else if (event.type === 'match/resume') {
      ended = false;
      endedBy = null;
    }
  }
  if (!ended) return false;
  if (input.actorIsHost) return true;
  if (endedBy === HOST_ACTOR) return false;
  return input.actorId === endedBy;
}

export function isOpenMatch(state: MatchState): boolean {
  if (state.ended) return false;
  if (state.sets.some((set) => set.a > 0 || set.b > 0)) return true;
  return state.updatedAt !== state.createdAt;
}

export interface NewMatchPlan {
  readonly kind: 'finish' | 'leave' | 'reset';
  readonly showReconnect: boolean;
  readonly reconnectSelected: boolean;
  /**
   * The phone that started the live match can take the other phones along.
   * A guest leaves on this phone only. They cannot move the court.
   */
  readonly askCarry: boolean;
}

export function planNewMatch(input: {
  readonly host: boolean;
  readonly open: boolean;
  readonly lastEventAt: number;
  readonly now: number;
  readonly coPlayers: number;
}): NewMatchPlan {
  const askCarry = input.host && input.open && input.coPlayers > 0;
  if (!input.host) return { kind: 'leave', showReconnect: false, reconnectSelected: false, askCarry: false };
  if (!input.open) return { kind: 'reset', showReconnect: false, reconnectSelected: false, askCarry: false };
  const recent = offerReconnect(input.lastEventAt, input.now);
  const coPlayers = input.coPlayers > 0;
  return {
    kind: 'finish',
    showReconnect: recent && !askCarry,
    reconnectSelected: recent && coPlayers && !askCarry,
    askCarry,
  };
}
