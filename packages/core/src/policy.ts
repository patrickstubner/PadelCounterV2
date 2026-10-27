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

/** Highest `pN` id handed to a joining phone. Host is not in this range. */
export const MAX_PLAYER_ACTOR = 32;

export const HOST_ACTOR = 'host';

export function actorId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (value === 'host' || value === 'device') return value;
  if (/^d[a-f0-9]{8}$/.test(value)) return value;
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
  if (by === 'device' || /^d[a-f0-9]{8}$/.test(by)) return 'This phone';
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

/** Previously connected non-host devices, and only after the host confirmed. */
export function carryTokenHashes(input: {
  readonly confirm: boolean;
  readonly hostInitiated: boolean;
  readonly joinedHashes: readonly string[];
  readonly invites: readonly CarryInvite[];
}): readonly CarryInvite[] {
  if (input.confirm !== true || input.hostInitiated !== true) return [];
  const joined = new Set(input.joinedHashes);
  const carried: CarryInvite[] = [];
  for (const invite of input.invites) {
    if (invite.host || !invite.deviceId) continue;
    if (!joined.has(invite.tokenHash)) continue;
    if (carried.some((row) => row.deviceId === invite.deviceId)) continue;
    carried.push(invite);
  }
  return carried;
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
}

export function planNewMatch(input: {
  readonly host: boolean;
  readonly open: boolean;
  readonly lastEventAt: number;
  readonly now: number;
  readonly coPlayers: number;
}): NewMatchPlan {
  if (!input.host) return { kind: 'leave', showReconnect: false, reconnectSelected: false };
  if (!input.open) return { kind: 'reset', showReconnect: false, reconnectSelected: false };
  const recent = offerReconnect(input.lastEventAt, input.now);
  const coPlayers = input.coPlayers > 0;
  return {
    kind: 'finish',
    showReconnect: recent,
    reconnectSelected: recent && coPlayers,
  };
}
