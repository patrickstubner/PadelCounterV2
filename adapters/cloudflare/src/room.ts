import {
  HOST_ACTOR,
  HOST_TOKEN_TTL_MS,
  JOIN_TOKEN_TTL_MS,
  MAX_EVENTS,
  MAX_PLAYER_ACTOR,
  ROOM_MESSAGES,
  canonicalEventId,
  canScoreGame,
  actionForEvent,
  actorId,
  canPerform,
  canReopen,
  credentialAllowsEvent,
  decideJoin,
  lastChangeAt,
  LIVE_PROTOCOL,
  capturedInstant,
  claimMatchesEvent,
  decideScore,
  isScoreEvent,
  isTeamId,
  parseParentId,
  parseScoreClaim,
  planMerge,
  parseStoredEvent,
  replayScore,
  roomAcceptsScore,
  type CausalEvent,
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
  /** Set when this invite belongs to one phone. A shared QR invite leaves this empty. */
  readonly deviceId?: string | null;
}

export interface StoredEvent {
  readonly eventId: string;
  readonly event: MatchEvent;
}

export interface RoomRecord {
  /** Durable Object `meta.created_at`. This is the server clock, not the phone's. */
  readonly serverCreatedAt: number;
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

/** Seed rows take the server clock and the host as the actor. A phone time on the seed cannot be a future or ancient History row. */
export function stampSeed(log: MatchLog, now: number): MatchLog {
  return {
    schemaVersion: log.schemaVersion,
    base: { ...log.base, createdAt: now, updatedAt: now },
    events: log.events.map((event) => {
      const raw = typeof event.capturedAt === 'number' ? event.capturedAt : event.at;
      const capturedAt = capturedInstant(Math.min(raw, now), 0, now, now) ?? now;
      return { ...event, at: now, capturedAt, by: HOST_ACTOR };
    }),
  };
}

export function createRoom(log: MatchLog, hostHash: string, now: number): {
  readonly record: RoomRecord;
  readonly expiresAt: number;
} {
  const stamped = stampSeed(log, now);
  const expiresAt = now + HOST_TOKEN_TTL_MS;
  return {
    expiresAt,
    record: {
      serverCreatedAt: now,
      base: stamped.base,
      events: stamped.events.map((event, index) => ({
        eventId: `seed-${index + 1}`,
        event: { ...event, parentId: index === 0 ? null : `seed-${index}` },
      })),
      invites: [
        { tokenHash: hostHash, role: 'player', host: true, expiresAt, revokedAt: null },
      ],
    },
  };
}

/** One hour and one day both use this. Seed rows are not a clock. */
export function serverLastChange(record: RoomRecord): number {
  const live: number[] = [];
  for (const item of record.events) {
    if (item.eventId.startsWith('seed-')) continue;
    if (Number.isInteger(item.event.at)) live.push(item.event.at);
  }
  return lastChangeAt(record.serverCreatedAt, live);
}

export interface ActorChoice {
  readonly host: boolean;
  readonly tokenHash: string;
  readonly deviceId: string | null;
  readonly joined: readonly { readonly tokenHash: string; readonly playerId: string; readonly deviceId: string | null }[];
  readonly connected: readonly { readonly actor: string; readonly deviceId: string | null }[];
}

/**
 * A joining phone keeps the id it already has. A new phone gets the lowest free `pN`.
 * An id bound to a device, or held by any connected socket, is never given out again.
 * A socket counts even when the phone has not sent a device id.
 */
export function chooseActor(input: ActorChoice): string | null {
  if (input.host) return HOST_ACTOR;
  if (input.deviceId) {
    const existing = input.joined.find((row) => row.tokenHash === input.tokenHash && row.deviceId === input.deviceId);
    if (existing && actorId(existing.playerId)) return existing.playerId;
  }
  const used = new Set<string>();
  for (const row of input.joined) {
    if (row.deviceId) used.add(row.playerId);
  }
  for (const socket of input.connected) {
    used.add(socket.actor);
  }
  for (let n = 2; n <= MAX_PLAYER_ACTOR; n += 1) {
    const id = `p${n}`;
    if (!used.has(id)) return id;
  }
  return null;
}

function credentialFor(row: InviteRow): Credential {
  return { role: row.role, host: row.host };
}

/** The one shared QR. Device-bound seats are not this row. */
export function currentSharedInvite(record: RoomRecord, now: number): InviteRow | null {
  let found: InviteRow | null = null;
  for (const row of record.invites) {
    if (row.host || row.deviceId || row.role !== 'player' || row.revokedAt !== null || now >= row.expiresAt) continue;
    found = row;
  }
  return found;
}

export function issueInvite(
  record: RoomRecord,
  callerHash: string,
  role: Role,
  inviteHash: string,
  now: number,
  keepHash?: string,
): { readonly ok: true; readonly record: RoomRecord; readonly expiresAt: number } | RoomFailure {
  const caller = record.invites.find((row) => safeEqualHex(row.tokenHash, callerHash));
  if (!caller || caller.revokedAt !== null || now >= caller.expiresAt) return fail('bad_token');
  if (!canPerform(credentialFor(caller), 'issue_invite')) return fail('forbidden');
  if (role !== 'player') return fail('spectator_not_available');
  const expiresAt = now + JOIN_TOKEN_TTL_MS;
  const invites = record.invites.map((row) => {
    if (row.host || row.revokedAt !== null) return row;
    if (keepHash && row.deviceId && safeEqualHex(row.tokenHash, keepHash)) return row;
    return { ...row, revokedAt: now };
  });
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
      protocol: LIVE_PROTOCOL,
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
  claim?: unknown,
  clientParent?: unknown,
  clockOffset = 0,
):
  | {
      readonly ok: true;
      readonly record: RoomRecord;
      readonly event: StoredEvent;
      readonly duplicate: boolean;
      readonly reconciled?: 'already' | 'merged';
    }
  | RoomFailure {
  const blocked = credentialAllowsEvent({
    role: invite.role,
    expiresAt: invite.expiresAt,
    revokedAt: invite.revokedAt,
    now,
  });
  if (blocked) return fail(blocked);
  if (!roomAcceptsScore(serverLastChange(record), now)) return fail('closed');
  const parsed = parseStoredEvent(rawEvent);
  if (parsed?.type === 'match/resume') {
    const allowed = canReopen({
      events: record.events.map((item) => item.event),
      actorId: actor,
      actorIsHost: invite.host,
    });
    if (!allowed) return fail('forbidden');
  }
  return applyPlay(record, credentialFor(invite), eventId, rawEvent, now, actor, claim, clientParent, clockOffset);
}

export function applyPlay(
  record: RoomRecord,
  credential: Credential,
  eventId: string,
  rawEvent: unknown,
  now: number,
  actor?: string,
  claim?: unknown,
  clientParent?: unknown,
  clockOffset = 0,
):
  | {
      readonly ok: true;
      readonly record: RoomRecord;
      readonly event: StoredEvent;
      readonly duplicate: boolean;
      readonly reconciled?: 'already' | 'merged';
    }
  | RoomFailure {
  const canonical = canonicalEventId(eventId);
  if (!canonical) return fail('not_applied');
  const existing = record.events.find((item) => item.eventId === canonical);
  if (existing) return { ok: true, record, event: existing, duplicate: true };

  const parsed = parseStoredEvent(rawEvent);
  if (!parsed) return fail('not_applied');
  const action = actionForEvent(parsed.type);
  if (!action || !canPerform(credential, action)) return fail('forbidden');
  if (parsed.type === 'match/new' || parsed.type === 'match/reset') return fail('not_applied');

  const headId = record.events[record.events.length - 1]?.eventId ?? null;
  const parent = clientParent === undefined ? headId : parseParentId(clientParent);
  if (parent === undefined) return fail('not_applied');
  const capturedAt = capturedInstant(parsed.at, clockOffset, now, record.serverCreatedAt);
  if (capturedAt === null) return fail('not_applied');
  const stamped: MatchEvent = actorId(actor)
    ? { ...parsed, at: now, capturedAt, parentId: headId, by: actorId(actor) }
    : { ...parsed, at: now, capturedAt, parentId: headId };

  if (parsed.type === 'game/increment') {
    const head = replayScore(record.base, record.events.map((item) => item.event));
    if (!isTeamId(parsed.team) || !canScoreGame(head, parsed.team)) return fail('not_applied');
  }

  if (isScoreEvent(parsed.type) && parsed.type !== 'match/end') {
    const parsedClaim = parseScoreClaim(claim);
    if (!parsedClaim || !claimMatchesEvent(parsed, parsedClaim)) return fail('not_applied');
    const incoming: CausalEvent = { id: canonical, parentId: parent, event: parsed, claim: parsedClaim };
    const plan = planMerge(record.base, causalChain(record), [incoming]);
    if (plan.reason === 'ambiguous') return fail('score_kept');
    if (plan.send.length === 0) {
      return { ok: true, record, duplicate: true, reconciled: 'already', event: { eventId: canonical, event: stamped } };
    }
    if (plan.reason === 'merged') {
      const current = replayScore(record.base, record.events.map((item) => item.event));
      const next = replayScore(current, [stamped]);
      if (next === current) return fail('not_applied');
      if (record.events.length >= MAX_EVENTS) return fail('not_applied');
      const event: StoredEvent = { eventId: canonical, event: stamped };
      return {
        ok: true,
        duplicate: false,
        reconciled: 'merged',
        event,
        record: { ...record, events: [...record.events, event] },
      };
    }
  } else if (parsed.type === 'match/end') {
    const current = replayScore(record.base, record.events.map((item) => item.event));
    const decision = decideScore(current, parsed, claim);
    if (decision.kind === 'reject') return fail('not_applied');
    if (decision.kind === 'already') {
      return { ok: true, record, duplicate: true, reconciled: 'already', event: { eventId: canonical, event: stamped } };
    }
  }
  if (record.events.length >= MAX_EVENTS) return fail('not_applied');

  const current = replayScore(record.base, record.events.map((item) => item.event));
  const next = replayScore(current, [stamped]);
  if (next === current) return fail('not_applied');
  const event: StoredEvent = { eventId: canonical, event: stamped };
  return { ok: true, duplicate: false, event, record: { ...record, events: [...record.events, event] } };
}

function causalChain(record: RoomRecord): CausalEvent[] {
  return record.events.map((item, index) => ({
    id: item.eventId,
    parentId: item.event.parentId === undefined ? (index === 0 ? null : record.events[index - 1]?.eventId ?? null) : item.event.parentId,
    event: item.event,
    claim: null,
  }));
}

/** One applied event. The full log stays on the snapshot that opened the socket. */
export function eventDelta(input: {
  readonly eventId: string;
  readonly event: MatchEvent;
  readonly duplicate: boolean;
  readonly players: number;
  readonly reconciled?: 'already' | 'merged';
}): {
  readonly type: 'event';
  readonly eventId: string;
  readonly event: MatchEvent;
  readonly duplicate: boolean;
  readonly players: number;
  readonly reconciled?: 'already' | 'merged';
} {
  return {
    type: 'event',
    eventId: input.eventId,
    event: input.event,
    duplicate: input.duplicate,
    players: input.players,
    ...(input.reconciled ? { reconciled: input.reconciled } : {}),
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
