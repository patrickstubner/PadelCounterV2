import type { Role } from './access';
import { ROOM_MESSAGES, type RoomCode } from './messages';

/** Simultaneous player connections in one match. The creator counts as one. */
export const MAX_PLAYERS = 4;

/** QR join codes. Short enough that a photographed code dies the same afternoon. */
export const JOIN_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

/** The creating phone. Longer than a QR code, still not permanent. */
export const HOST_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

export const JOIN_TOKEN_BYTES = 16;

/** 16 bytes, unpadded base64url. */
export const JOIN_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export function isJoinToken(value: unknown): value is string {
  return typeof value === 'string' && JOIN_TOKEN_PATTERN.test(value);
}

export interface JoinDecision {
  readonly ok: boolean;
  readonly code?: RoomCode;
  readonly message?: string;
}

function deny(code: RoomCode): JoinDecision {
  return { ok: false, code, message: ROOM_MESSAGES[code] };
}

/**
 * Whether a new socket may enter.
 * Spectator is a real role in the check, but this version does not accept it.
 * `connectedPlayers` is the number of sockets already in the room, not including the new one.
 */
export function decideJoin(input: {
  readonly role: Role;
  readonly connectedPlayers: number;
  readonly expiresAt: number;
  readonly now: number;
  readonly revoked: boolean;
}): JoinDecision {
  if (!Number.isInteger(input.connectedPlayers) || input.connectedPlayers < 0) return deny('bad_token');
  if (!Number.isInteger(input.expiresAt) || !Number.isInteger(input.now)) return deny('bad_token');
  if (input.revoked) return deny('revoked');
  if (input.now >= input.expiresAt) return deny('expired');
  if (input.role !== 'player') return deny('spectator_not_available');
  if (input.connectedPlayers >= MAX_PLAYERS) return deny('match_full');
  return { ok: true };
}
