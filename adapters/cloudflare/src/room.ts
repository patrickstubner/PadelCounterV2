import {
  HOST_TOKEN_TTL_MS,
  JOIN_TOKEN_TTL_MS,
  MAX_EVENTS,
  ROOM_MESSAGES,
  actionForEvent,
  actorId,
  canPerform,
  canReopen,
  credentialAllowsEvent,
  decideJoin,
  lastChangeAt,
  parseStoredEvent,
  replayScore,
  roomAcceptsScore,
  type Credential,
  type MatchEvent,
  type MatchLog,
  type Role,
  type RoomCode,
} from '@padel/core';
import { safeEqualHex } from './tokens';

export interface InviteRow {
  readonly tokenHash: string;
  readonly role: Role;
  readonly host: boolean;
  readonly expiresAt: number;
  readonly revokedAt: number | null;
  /** Set only for a reconnect invite. A QR invite leaves this empty. */
  readonly deviceId?: string | null;
}

export interface StoredEvent {
  readonly eventId: string;
  readonly event: MatchEvent;
}

export interface RoomRecord {
  readonly base: MatchLog['base'];
  readonly events: readonly StoredEvent[];
  readonly invites: readonly InviteRow[];
}

export interface RoomFailure {
  readonly ok: false;
  readonly code: RoomCode;
  readonly message: string;
}

function fail(code: RoomCode): RoomFailure {
  return { ok: false, code, message: ROOM_MESSAGES[code] };
}

export function createRoom(log: MatchLog, hostHash: string, now: number): {
  readonly record: RoomRecord;
  readonly expiresAt: number;
} {
  const expiresAt = now + HOST_TOKEN_TTL_MS;
  return {
    expiresAt,
    record: {
      base: log.base,
      events: log.events.map((event, index) => ({ eventId: `seed-${index + 1}`, event })),
      invites: [
        { tokenHash: hostHash, role: 'player', host: true, expiresAt, revokedAt: null },
      ],
    },
  };
}

function credentialFor(row: InviteRow): Credential {
  return { role: row.role, host: row.host };
}

export function issueInvite(
  record: RoomRecord,
  hostHash: string,
  role: Role,
  inviteHash: string,
  now: number,
): { readonly ok: true; readonly record: RoomRecord; readonly expiresAt: number } | RoomFailure {
  const host = record.invites.find((row) => safeEqualHex(row.tokenHash, hostHash));
  if (!host || host.revokedAt !== null || now >= host.expiresAt) return fail('bad_token');
  if (!canPerform(credentialFor(host), 'issue_invite')) return fail('forbidden');
  if (role !== 'player') return fail('spectator_not_available');
  const expiresAt = now + JOIN_TOKEN_TTL_MS;
  const invites = record.invites.map((row) =>
    row.host || row.revokedAt !== null ? row : { ...row, revokedAt: now },
  );
  return {
    ok: true,
    expiresAt,
    record: {
      ...record,
      invites: [
        ...invites,
        { tokenHash: inviteHash, role: 'player', host: false, expiresAt, revokedAt: null },
      ],
    },
  };
}

export function admit(
  record: RoomRecord,
  tokenHash: string,
  connectedPlayers: number,
  now: number,
  deviceId?: string | null,
): { readonly ok: true; readonly credential: Credential } | RoomFailure {
  const row = record.invites.find((invite) => safeEqualHex(invite.tokenHash, tokenHash));
  if (!row) return fail('bad_token');
  if (row.deviceId && row.deviceId !== deviceId) return fail('bad_token');
  const decision = decideJoin({
    role: row.role,
    connectedPlayers,
    expiresAt: row.expiresAt,
    now,
    revoked: row.revokedAt !== null,
  });
  if (!decision.ok) return fail(decision.code ?? 'bad_token');
  return { ok: true, credential: credentialFor(row) };
}

export interface ClientPayload {
  readonly type: string;
  readonly protocol?: number;
  readonly code?: RoomCode;
  readonly message?: string;
  readonly role?: Role;
  readonly host?: boolean;
  readonly players?: number;
  readonly log?: MatchLog;
  readonly eventIds?: readonly string[];
  readonly eventId?: string;
  readonly event?: MatchEvent;
  readonly duplicate?: boolean;
}

export function helloPayload(
  record: RoomRecord,
  tokenHash: string,
  connectedPlayers: number,
  now: number,
  deviceId?: string | null,
): { readonly ok: true; readonly credential: Credential; readonly payload: ClientPayload } | (RoomFailure & { readonly payload: ClientPayload }) {
  const admitted = admit(record, tokenHash, connectedPlayers, now, deviceId);
  if (!admitted.ok) {
    return { ...admitted, payload: { type: 'error', code: admitted.code, message: admitted.message } };
  }
  const players = connectedPlayers + 1;
  return {
    ok: true,
    credential: admitted.credential,
    payload: {
      type: 'snapshot',
      protocol: 1,
      role: admitted.credential.role,
      host: admitted.credential.host,
      players,
      log: toLog(record),
      eventIds: record.events.map((item) => item.eventId),
    },
  };
}

export function applyLiveEvent(
  record: RoomRecord,
  invite: InviteRow,
  actor: string,
  eventId: string,
  rawEvent: unknown,
  now: number,
):
  | { readonly ok: true; readonly record: RoomRecord; readonly event: StoredEvent; readonly duplicate: boolean }
  | RoomFailure {
  const blocked = credentialAllowsEvent({
    role: invite.role,
    expiresAt: invite.expiresAt,
    revokedAt: invite.revokedAt,
    now,
  });
  if (blocked) return fail(blocked);
  const last = lastChangeAt(record.base.createdAt, record.events.map((item) => item.event.at));
  if (!roomAcceptsScore(last, now)) return fail('closed');
  const parsed = parseStoredEvent(rawEvent);
  if (parsed?.type === 'match/resume') {
    const allowed = canReopen({
      events: record.events.map((item) => item.event),
      actorId: actor,
      actorIsHost: invite.host,
    });
    if (!allowed) return fail('forbidden');
  }
  return applyPlay(record, credentialFor(invite), eventId, rawEvent, now, actor);
}

export function applyPlay(
  record: RoomRecord,
  credential: Credential,
  eventId: string,
  rawEvent: unknown,
  now: number,
  actor?: string,
):
  | { readonly ok: true; readonly record: RoomRecord; readonly event: StoredEvent; readonly duplicate: boolean }
  | RoomFailure {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId)) {
    return fail('not_applied');
  }
  const existing = record.events.find((item) => item.eventId === eventId);
  if (existing) return { ok: true, record, event: existing, duplicate: true };

  const parsed = parseStoredEvent(rawEvent);
  if (!parsed) return fail('not_applied');
  const action = actionForEvent(parsed.type);
  if (!action || !canPerform(credential, action)) return fail('forbidden');
  if (parsed.type === 'match/new' || parsed.type === 'match/reset') return fail('not_applied');
  if (record.events.length >= MAX_EVENTS) return fail('not_applied');

  const stamped: MatchEvent = actorId(actor) ? { ...parsed, at: now, by: actorId(actor) } : { ...parsed, at: now };
  const current = replayScore(record.base, record.events.map((item) => item.event));
  const next = replayScore(current, [stamped]);
  if (next === current) return fail('not_applied');
  const event: StoredEvent = { eventId, event: stamped };
  return { ok: true, duplicate: false, event, record: { ...record, events: [...record.events, event] } };
}

/** One applied event. The full log stays on the snapshot that opened the socket. */
export function eventDelta(input: {
  readonly eventId: string;
  readonly event: MatchEvent;
  readonly duplicate: boolean;
  readonly players: number;
}): {
  readonly type: 'event';
  readonly eventId: string;
  readonly event: MatchEvent;
  readonly duplicate: boolean;
  readonly players: number;
} {
  return {
    type: 'event',
    eventId: input.eventId,
    event: input.event,
    duplicate: input.duplicate,
    players: input.players,
  };
}

/** QR invites have no device. Each phone that actually connected is listed on its own. */
export function invitesForCarry(
  invites: readonly InviteRow[],
  joined: readonly { readonly tokenHash: string; readonly deviceId: string | null }[],
): { readonly tokenHash: string; readonly host: boolean; readonly deviceId: string | null }[] {
  const listed: { tokenHash: string; host: boolean; deviceId: string | null }[] = [];
  for (const invite of invites) {
    const devices = joined.filter((row) => row.tokenHash === invite.tokenHash && row.deviceId);
    if (devices.length === 0) {
      listed.push({ tokenHash: invite.tokenHash, host: invite.host, deviceId: invite.deviceId ?? null });
      continue;
    }
    for (const device of devices) {
      listed.push({ tokenHash: invite.tokenHash, host: invite.host, deviceId: device.deviceId });
    }
  }
  return listed;
}

export function toLog(record: RoomRecord): MatchLog {
  return {
    schemaVersion: 2,
    base: record.base,
    events: record.events.map((item) => item.event),
  };
}
