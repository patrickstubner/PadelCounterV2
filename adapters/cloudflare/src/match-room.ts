import { DurableObject } from 'cloudflare:workers';
import { CARRY_PER_DEVICE, GUEST_ROTATE_PER_DEVICE, JOIN_TOKEN_TTL_MS, KICK_PER_ACTOR, KICK_PER_MATCH, KICK_WINDOW_MS, LEAVE_PER_ACTOR, LEAVE_WINDOW_MS, LIVE_PROTOCOL, MATCH_BUDGET_WINDOW_MS, MAX_MINTED_TOKENS, MEMBER_SEEN_MS, MINT_PER_MATCH, ROOM_MESSAGES, ROTATE_PER_MATCH, UNUSED_MINT_MS, actorId, canonicalCausalId, clampClockOffset, connectionCloses, decideKick, deviceKindFromAgent, isDeviceId, isDeviceKind, isJoinToken, isLegacyDeviceId, isRole, isRoomCode, liveTeamSide, parseLiveTeamName, parseMatchLog, prepareLiveLog, publicPhoneList, replayScore, type Credential, type DeviceKind, type Role } from '@padel/core';
import { allowPending, expiredHello, nextHelloAlarm, type SocketView } from './admission';
import { CLIENT_IP_HEADER, d1MatchIndex, shouldTouchActivity, touchMatchActivity, type D1Like } from './match-index';
import { allowRate, RENAME_PER_SECOND, takeLiveMessage } from './rate';
import { resolveRoomMatchId } from './room-id';
import { applyLiveEvent, chooseActor, createRoom, currentSharedInvite, eventDelta, helloPayload, issueInvite, serverLastChange, type RoomRecord } from './room';
import { openText, sealText } from './seal';
import { randomToken } from './tokens';
import { blockKickedDevice, clearKickedDevices, deleteSeal, dropJoinedDevice, dropMemberHashes, dropRosterDevice, ensureActivityColumn, ensureSealedTable, grantMintedInvite, hasMoveSeal, insertEvent, insertInvite, insertJoined, insertRoom, isKickedDevice, latestEventSeq, markActivityTouch, markRosterOffline, matchBudgetOpen, openRoomForCreate, pendingMintStale, readActivityTouch, readEventSeq, readJoined, readRoom, readRoomMatchId, readRoster, readSeal, restoreInviteHashes, revokeInviteHash, revokePlayerInvites, revokeSharedInvites, saveRosterPhone, takeMatchBudget, writeRoomMatchId, writeSeal, type RoomSql } from './store';
import { quotaMac, quotaSecret, safeEqualHex, sha256Hex } from './tokens';

function publicSeat(value: unknown): string | null {
  if (value === 'host') return 'host';
  if (typeof value !== 'string' || isDeviceId(value)) return null;
  return actorId(value) === value && /^p[1-9]\d*$/.test(value) ? value : null;
}

function packedMove(plain: string | null): { token: string | null; seat: string | null } {
  if (!plain) return { token: null, seat: null };
  if (!plain.startsWith('{')) return { token: plain, seat: null };
  try {
    const parsed = JSON.parse(plain) as { token?: unknown; seat?: unknown };
    return { token: typeof parsed.token === 'string' ? parsed.token : null, seat: publicSeat(parsed.seat) };
  } catch {
    return { token: null, seat: null };
  }
}

/** Fixed scope. A minute in the MAC would split one address across two pending caps. */
const SOCKET_IP_SCOPE = 'socket';
/** Hibernation tag so a broadcast can see every court socket after the isolate wakes. */
const COURT_TAG = 'court';

interface PendingState {
  readonly admitted: false;
  /** HMAC of the client address. Never the address itself. */
  readonly ip: string;
  readonly openedAt: number;
  /** Coarse class of the upgrade's User-Agent. The agent string is not stored. */
  readonly kind: DeviceKind;
}

interface AdmittedState {
  readonly admitted: true;
  readonly credential: Credential;
  readonly stamps: readonly number[];
  readonly renameStamps?: readonly number[];
  readonly kickStamps?: readonly number[];
  /** HMAC of the client address. Never the address itself. */
  readonly ip: string;
  readonly actor: string;
  readonly tokenHash: string;
  readonly deviceId: string | null;
  /** Server clock minus the phone clock at hello. Display only. */
  readonly clockOffset: number;
  /** Last time this socket was sent a score tail. Long tails are limited to one every two seconds. */
  readonly lastResyncAt?: number;
}

type SocketState = PendingState | AdmittedState;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function readBody(request: Request, max: number): Promise<unknown | null> {
  const text = await request.text();
  if (text.length === 0 || text.length > max) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

interface RoomEnv {
  DB: D1Like;
  QUOTA_HMAC_KEY?: string;
}

export class MatchRoom extends DurableObject<RoomEnv> {
  private sql(): RoomSql {
    return this.ctx.storage.sql as unknown as RoomSql;
  }

  /**
   * The id this object was created with (`idFromName`), or the copy stored in `meta` when that name is missing.
   * It is not `base.matchId`: a later `match/new` in the log must not retarget D1.
   * A name that is not a UUID is ignored.
   */
  private durableMatchId(): string | null {
    const stored = readRoomMatchId(this.sql());
    const resolved = resolveRoomMatchId(this.ctx.id.name, stored);
    if (resolved && stored !== resolved) {
      try {
        writeRoomMatchId(this.sql(), resolved);
      } catch {
        // The next call stores it. This answer still uses the resolved id.
      }
    }
    return resolved;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') return this.openSocket(request);
      if (request.method === 'POST' && url.pathname === '/discard') {
        await this.ctx.storage.deleteAll();
        return json(200, { ok: true });
      }
      if (request.method === 'POST' && url.pathname === '/reconnect-info') return this.reconnectInfo(request);
      if (request.method === 'POST' && url.pathname === '/carry-claim') return this.carryClaim(request);
      if (request.method === 'POST' && url.pathname === '/carry-invite') return this.carryInvite(request);
      if (request.method === 'POST' && url.pathname === '/notify') return this.notify(request);
      if (request.method === 'POST' && url.pathname === '/create') return this.create(request);
      if (request.method === 'POST' && url.pathname === '/invite') return this.invite(request);
      if (request.method === 'POST' && url.pathname === '/leave') return this.leave(request);
      if (request.method === 'POST' && url.pathname === '/player-invite') return this.playerInvite(request);
      if (request.method === 'POST' && url.pathname === '/revoke-minted') return this.revokeMinted(request);
      return json(404, { error: 'not_found' });
    } catch {
      return json(500, { error: 'unavailable' });
    }
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets(COURT_TAG)) {
      const state = this.readState(ws);
      if (!state || state.admitted) continue;
      if (expiredHello([this.view(state)], now).length === 0) continue;
      ws.send(JSON.stringify({ type: 'error', code: 'slow_down' }));
      ws.close(1008, 'slow_down');
    }
    await this.armAlarm(Date.now());
  }

  private async openSocket(request: Request): Promise<Response> {
    const secret = quotaSecret(this.env.QUOTA_HMAC_KEY);
    if (!secret) return json(503, { error: 'not_configured', message: ROOM_MESSAGES.not_configured });
    const address = request.headers.get(CLIENT_IP_HEADER) ?? 'missing';
    const ipMac = await quotaMac(secret, 'socket-ip', address, SOCKET_IP_SCOPE);
    if (!allowPending(this.views(), ipMac)) return json(429, { error: 'slow_down' });
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server, [COURT_TAG]);
    const openedAt = Date.now();
    const kind = deviceKindFromAgent(request.headers.get('user-agent'));
    server.serializeAttachment({ admitted: false, ip: ipMac, openedAt, kind } satisfies PendingState);
    await this.armAlarm(openedAt);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const admitted = this.readState(ws)?.admitted === true;
    if (typeof message !== 'string' || message.length > 8192) {
      this.reject(ws, admitted ? 'not_applied' : 'bad_token');
      return;
    }
    let body: unknown;
    try {
      body = JSON.parse(message) as unknown;
    } catch {
      this.reject(ws, admitted ? 'not_applied' : 'bad_token');
      return;
    }
    if (typeof body !== 'object' || body === null) {
      this.reject(ws, admitted ? 'not_applied' : 'bad_token');
      return;
    }
    const record = body as Record<string, unknown>;
    const state = this.readState(ws);
    if (!state?.admitted) {
      if (record.type !== 'hello') {
        this.reject(ws, 'bad_token');
        return;
      }
      await this.hello(ws, record, state);
      return;
    }
    if (record.type === 'decline_move') {
      if (state.deviceId) deleteSeal(this.sql(), `move:${state.deviceId}`);
      return;
    }
    if (record.type === 'kick') {
      await this.kick(ws, state, record);
      return;
    }
    if (record.type === 'team_renamed') {
      const renameBudget = allowRate(state.renameStamps ?? [], Date.now(), RENAME_PER_SECOND, 1_000);
      ws.serializeAttachment({ ...state, renameStamps: renameBudget.stamps });
      if (!renameBudget.ok) {
        this.reject(ws, 'slow_down', record.eventId);
        return;
      }
      await this.rename(ws, { ...state, renameStamps: renameBudget.stamps }, record);
      return;
    }
    const budget = takeLiveMessage(state.stamps, record.type, Date.now());
    ws.serializeAttachment({ ...state, stamps: budget.stamps });
    if (!budget.ok) {
      this.reject(ws, budget.code, record.eventId);
      return;
    }
    if (budget.command === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
      return;
    }
    await this.play(ws, { ...state, stamps: budget.stamps }, record);
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    void code;
    void reason;
    void wasClean;
    const state = this.readState(ws);
    if (state?.admitted && state.deviceId) {
      const still = this.ctx.getWebSockets(COURT_TAG).some((socket) => {
        if (socket === ws) return false;
        const other = this.readState(socket);
        return other?.admitted === true && other.deviceId === state.deviceId;
      });
      if (!still) markRosterOffline(this.sql(), state.deviceId, Date.now());
    }
    this.broadcastPresence();
    this.sendRoster(ws);
    await this.armAlarm(Date.now());
  }

  private async hello(ws: WebSocket, record: Record<string, unknown>, pending: SocketState | null): Promise<void> {
    if (record.protocol !== LIVE_PROTOCOL || !isJoinToken(record.token)) {
      this.reject(ws, record.protocol === LIVE_PROTOCOL ? 'bad_token' : 'upgrade_required');
      return;
    }
    if (!readRoom(this.sql())) {
      this.reject(ws, 'unavailable');
      return;
    }
    const tokenHash = await sha256Hex(record.token);
    const deviceId = isDeviceId(record.device) ? record.device : null;
    const previousDevice = isLegacyDeviceId(record.previousDevice) ? record.previousDevice : null;
    if (deviceId && previousDevice) {
      this.rebindDevice(tokenHash, previousDevice, deviceId);
      try {
        await d1MatchIndex(this.env.DB).rebindCredential(tokenHash, previousDevice, deviceId);
      } catch {
        // The room binding is already moved. D1 can catch up on the next hello.
      }
    }
    if (pendingMintStale(this.sql(), tokenHash, Date.now(), UNUSED_MINT_MS)) {
      revokeInviteHash(this.sql(), tokenHash, Date.now());
      this.reject(ws, 'expired');
      return;
    }
    const room = readRoom(this.sql());
    if (!room) {
      this.reject(ws, 'unavailable');
      return;
    }
    const seated = this.seatedSockets(ws, deviceId);
    const result = helloPayload(room, tokenHash, seated.others, Date.now(), deviceId);
    if (result.ok && deviceId && isKickedDevice(this.sql(), deviceId)) {
      this.reject(ws, 'revoked');
      return;
    }
    if (!result.ok) {
      if (result.code === 'match_full' && seated.same.length === 0) {
        const invite = room.invites.find((row) => safeEqualHex(row.tokenHash, tokenHash));
        if (invite?.deviceId) {
          const now = Date.now();
          revokeInviteHash(this.sql(), tokenHash, now);
          try {
            await d1MatchIndex(this.env.DB).revokeCredential(tokenHash, now);
          } catch {
            // The room invite is already revoked, so this phone cannot take the slot.
          }
        }
      }
      this.reject(ws, result.code);
      return;
    }
    const playedNow = replayScore(room.base, room.events.map((item) => item.event));
    if (playedNow.ended && !result.credential.host) {
      const known = readJoined(this.sql()).some((row) => safeEqualHex(row.tokenHash, tokenHash) && deviceId !== null && row.deviceId === deviceId);
      if (!known) {
        this.reject(ws, 'revoked');
        return;
      }
    }
    const alreadyJoined = deviceId !== null && readJoined(this.sql()).some((row) => safeEqualHex(row.tokenHash, tokenHash) && row.deviceId === deviceId);
    const actor = this.assignActor(result.credential.host, tokenHash, deviceId, !this.liveMoveSeal(deviceId));
    if (!actor) {
      this.reject(ws, 'unavailable');
      return;
    }
    const clockOffset = clampClockOffset(record.clientNow, Date.now());
    const next: AdmittedState = {
      admitted: true,
      credential: result.credential,
      stamps: [],
      ip: pending && !pending.admitted ? pending.ip : 'missing',
      actor,
      tokenHash,
      deviceId,
      clockOffset,
    };
    ws.serializeAttachment(next);
    const played = replayScore(room.base, room.events.map((item) => item.event));
    ws.send(JSON.stringify({
      ...result.payload,
      clockOffset,
      names: { A: played.teams.a.name, B: played.teams.b.name },
      nameSeq: latestEventSeq(this.sql()),
    }));
    if (deviceId) {
      const kind = pending && pending.admitted === false && isDeviceKind(pending.kind) ? pending.kind : 'other';
      saveRosterPhone(this.sql(), { deviceId, seat: actor, kind, now: Date.now() });
    }
    if (!result.credential.host) {
      const invite = room.invites.find((row) => safeEqualHex(row.tokenHash, tokenHash));
      if (invite) {
        try {
          await d1MatchIndex(this.env.DB).admitCredential(tokenHash, invite.expiresAt);
        } catch {
          // The socket is already in the room. A later hello can mark the row.
        }
      }
    }
    await this.sendHandover(ws, deviceId, alreadyJoined);
    this.closeSuperseded(seated.same);
    this.broadcastPresence();
    this.sendRoster();
    await this.armAlarm(Date.now());
  }

  /** One roster per admitted socket. `self` is true only for that socket's device. */
  private sendRoster(except?: WebSocket): void {
    const live = new Set<string>();
    for (const socket of this.ctx.getWebSockets(COURT_TAG)) {
      if (socket === except) continue;
      const state = this.readState(socket);
      if (state?.admitted === true && state.deviceId) live.add(state.deviceId);
    }
    const rows = readRoster(this.sql()).map((row) => ({ ...row, online: live.has(row.deviceId) }));
    for (const socket of this.ctx.getWebSockets(COURT_TAG)) {
      const state = this.readState(socket);
      if (state?.admitted !== true) continue;
      try {
        socket.send(JSON.stringify({ type: 'roster', phones: publicPhoneList(rows, state.deviceId) }));
      } catch {
        // A closed peer must not stop the others.
      }
    }
  }

  /** Admitted sockets for this device do not take another seat. */
  private seatedSockets(self: WebSocket, deviceId: string | null): { others: number; same: WebSocket[] } {
    const same: WebSocket[] = [];
    let others = 0;
    for (const socket of this.ctx.getWebSockets(COURT_TAG)) {
      if (socket === self) continue;
      const state = this.readState(socket);
      if (state?.admitted !== true) continue;
      if (deviceId !== null && state.deviceId === deviceId) same.push(socket);
      else others += 1;
    }
    return { others, same };
  }

  /** Drop the previous half-open socket without a terminal room code. */
  private closeSuperseded(sockets: readonly WebSocket[]): void {
    for (const socket of sockets) {
      try {
        socket.close(4000, 'superseded');
      } catch {
        // The peer is already gone.
      }
    }
  }

  private async rename(ws: WebSocket, state: AdmittedState, record: Record<string, unknown>): Promise<void> {
    const room = readRoom(this.sql());
    if (!room) {
      this.reject(ws, 'unavailable', record.eventId);
      return;
    }
    const side = liveTeamSide(record.team);
    const name = parseLiveTeamName(record.name);
    if (!side || !name || typeof record.eventId !== 'string') {
      this.reject(ws, 'not_applied', record.eventId);
      return;
    }
    const invite = room.invites.find((row) => safeEqualHex(row.tokenHash, state.tokenHash));
    if (!invite) {
      this.reject(ws, 'bad_token', record.eventId);
      return;
    }
    const result = applyLiveEvent(room, invite, state.actor, record.eventId, {
      type: 'team/rename',
      team: side,
      name,
      at: Date.now(),
    }, Date.now());
    if (!result.ok) {
      this.reject(ws, result.code, record.eventId);
      return;
    }
    if (!result.duplicate) {
      try {
        insertEvent(this.sql(), result.event);
      } catch {
        this.reject(ws, 'unavailable', record.eventId);
        return;
      }
    }
    const seq = readEventSeq(this.sql(), result.event.eventId) ?? latestEventSeq(this.sql());
    const stored = result.event.event.type === 'team/rename' ? result.event.event.name : name;
    const payload = JSON.stringify({
      type: 'team_renamed',
      eventId: result.event.eventId,
      team: side === 'a' ? 'A' : 'B',
      name: stored,
      seq,
    });
    this.broadcast(payload, ws);
    try {
      ws.send(payload);
    } catch {
      // The sender already showed the name. The ack is only for reconciliation.
    }
  }

  private async play(ws: WebSocket, state: AdmittedState, record: Record<string, unknown>): Promise<void> {
    const room = readRoom(this.sql());
    if (!room) {
      this.reject(ws, 'unavailable');
      return;
    }
    if (typeof record.eventId !== 'string') {
      this.reject(ws, 'not_applied', record.eventId);
      return;
    }
    const rawEvent = record.event;
    if (typeof rawEvent === 'object' && rawEvent !== null && (rawEvent as { type?: unknown }).type === 'team/rename') {
      this.reject(ws, 'not_applied', record.eventId);
      return;
    }
    const invite = room.invites.find((row) => safeEqualHex(row.tokenHash, state.tokenHash));
    if (!invite) {
      this.reject(ws, 'bad_token', record.eventId);
      return;
    }
    const result = applyLiveEvent(
      room,
      invite,
      state.actor,
      record.eventId,
      record.event,
      Date.now(),
      record.claim,
      record.parentId,
      state.clockOffset,
    );
    if (!result.ok) {
      this.reject(ws, result.code, record.eventId);
      return;
    }
    if (!result.duplicate) {
      if (result.event.event.type === 'match/end' && this.durableMatchId() === null) {
        this.reject(ws, 'unavailable', record.eventId);
        return;
      }
      try {
        const sql = this.sql();
        insertEvent(sql, result.event);
        ensureActivityColumn(sql);
        if (result.event.event.type === 'match/end') await this.revokeSharedRoom(sql);
      } catch {
        this.reject(ws, 'unavailable', record.eventId);
        return;
      }
    } else if (result.event.event.type === 'match/end' && this.roomIsEnded()) {
      try {
        await this.revokeSharedRoom(this.sql());
      } catch {
        this.reject(ws, 'unavailable', record.eventId);
        return;
      }
    }
    const payload = JSON.stringify(
      eventDelta({
        eventId: result.event.eventId,
        event: result.event.event,
        duplicate: result.duplicate,
        players: this.admittedCount(),
        reconciled: result.reconciled,
      }),
    );
    // An already-counted point is not a new score. Other phones must not apply it.
    // A merged point was placed on a board this phone had not seen. The sender reloads the tail.
    if (result.reconciled === 'already' || result.reconciled === 'merged') {
      if (result.reconciled === 'merged') this.broadcast(payload, ws);
      try {
        ws.send(payload);
        const parsedParent = canonicalCausalId(record.parentId);
        const fork = parsedParent !== undefined
          ? parsedParent
          : result.reconciled === 'merged'
            ? result.record.events[result.record.events.length - 2]?.eventId ?? null
            : result.record.events[result.record.events.length - 1]?.eventId ?? null;
        this.sendTail(ws, state, result.record, fork);
      } catch {
        // The sender already showed the point. The next snapshot replaces it.
      }
    } else {
      this.broadcast(payload, ws);
      try {
        ws.send(payload);
      } catch {
        // The sender already showed the point. The ack is only for reconciliation.
      }
    }
    if (!result.duplicate) {
      const at = result.event.event.at;
      const sql = this.sql();
      const last = readActivityTouch(sql);
      if (last !== null && shouldTouchActivity(last, at)) {
        markActivityTouch(sql, at);
        const matchId = this.durableMatchId();
        if (!matchId) {
          markActivityTouch(sql, last);
        } else {
          try {
            await touchMatchActivity(this.env.DB, matchId, at);
          } catch {
            markActivityTouch(sql, last);
          }
        }
      }
    }
  }

  /**
   * Events after the fork only. A long tail is sent at most once every two seconds;
   * a short tail is sent every time so a set-ending merge can correct the sender.
   */
  private sendTail(ws: WebSocket, state: AdmittedState, record: RoomRecord, fork: string | null): void {
    const index = fork === null ? -1 : record.events.findIndex((item) => item.eventId === fork);
    const suffix = index >= 0 ? record.events.slice(index + 1) : record.events;
    const now = Date.now();
    const previous = state.lastResyncAt ?? 0;
    if (suffix.length > 8 && previous !== 0 && now - previous < 2_000) return;
    ws.serializeAttachment({ ...state, lastResyncAt: now });
    ws.send(JSON.stringify({
      type: 'tail',
      since: index >= 0 ? fork : null,
      protocol: LIVE_PROTOCOL,
      host: state.credential.host,
      players: this.admittedCount(),
      events: suffix.map((item) => item.event),
      eventIds: suffix.map((item) => item.eventId),
      nameSeq: latestEventSeq(this.sql()),
    }));
  }

  /** Deliver to admitted court sockets. One closed peer must not stop the rest. */
  private broadcast(payload: string, except?: WebSocket): void {
    for (const socket of this.ctx.getWebSockets(COURT_TAG)) {
      if (except && socket === except) continue;
      if (this.readState(socket)?.admitted !== true) continue;
      try {
        socket.send(payload);
      } catch {
        // The Hibernation API can still list a socket that has already closed.
      }
    }
  }

  private async create(request: Request): Promise<Response> {
    if (openRoomForCreate(this.sql())) return json(409, { error: 'unavailable' });
    const body = await readBody(request, 96_000);
    if (!body || typeof body !== 'object') return json(400, { error: 'invalid_match' });
    const parsed = parseMatchLog((body as { log?: unknown }).log);
    const hostToken = (body as { hostToken?: unknown }).hostToken;
    if (!parsed || !isJoinToken(hostToken)) return json(400, { error: 'invalid_match' });
    const log = prepareLiveLog(parsed);
    const played = replayScore(log.base, log.events);
    if (parseLiveTeamName(played.teams.a.name) !== played.teams.a.name || parseLiveTeamName(played.teams.b.name) !== played.teams.b.name) {
      return json(400, { error: 'invalid_match' });
    }
    const now = Date.now();
    const created = createRoom(log, await sha256Hex(hostToken), now);
    const replayId = replayScore(created.record.base, created.record.events.map((item) => item.event)).matchId;
    const roomId = resolveRoomMatchId(this.ctx.id.name, replayId);
    insertRoom(this.sql(), created.record, roomId);
    return json(201, { expiresAt: created.expiresAt });
  }

  private async invite(request: Request): Promise<Response> {
    const body = await readBody(request, 4000);
    if (!body || typeof body !== 'object') return json(400, { error: 'invalid_match' });
    const fields = body as {
      hostToken?: unknown;
      memberToken?: unknown;
      role?: unknown;
      inviteToken?: unknown;
      rotate?: unknown;
      reseal?: unknown;
      code?: unknown;
    };
    const memberToken = isJoinToken(fields.memberToken) ? fields.memberToken : fields.hostToken;
    if (!isJoinToken(memberToken) || !isRole(fields.role)) return json(400, { error: 'invalid_match' });
    if (fields.role !== 'player') return json(403, { error: 'spectator_not_available' });
    const room = readRoom(this.sql());
    if (!room) return json(404, { error: 'unavailable' });
    const now = Date.now();
    const callerHash = await sha256Hex(memberToken);
    const caller = room.invites.find((row) => safeEqualHex(row.tokenHash, callerHash));
    if (!caller || caller.revokedAt !== null || now >= caller.expiresAt || caller.role !== 'player') {
      return json(401, { error: 'bad_token' });
    }
    const rotate = fields.rotate === true;
    const current = currentSharedInvite(room, now);
    if (fields.reseal === true && isJoinToken(fields.inviteToken) && current) {
      const hash = await sha256Hex(fields.inviteToken);
      if (!safeEqualHex(current.tokenHash, hash)) return json(409, { error: 'unavailable' });
      const secret = quotaSecret(this.env.QUOTA_HMAC_KEY);
      if (!secret) return json(503, { error: 'not_configured' });
      const code = typeof fields.code === 'string' ? fields.code : null;
      const sealed = await sealText(secret, JSON.stringify({ token: fields.inviteToken, code }));
      ensureSealedTable(this.sql());
      writeSeal(this.sql(), 'invite', current.tokenHash, sealed, current.expiresAt);
      return json(200, { role: 'player' satisfies Role, expiresAt: current.expiresAt, reuse: true, token: fields.inviteToken, code });
    }
    if (!rotate && current) {
      const opened = await this.openInviteSeal(current.tokenHash);
      if (!opened) return json(409, { error: 'unavailable' });
      return json(200, {
        role: 'player' satisfies Role,
        expiresAt: current.expiresAt,
        token: opened.token,
        code: opened.code,
        reuse: true,
      });
    }
    if (!isJoinToken(fields.inviteToken)) return json(400, { error: 'invalid_match' });
    const guestDevice = isDeviceId(caller.deviceId) ? caller.deviceId : this.callerDevice(callerHash);
    const budgetKind = !rotate ? 'mint' : caller.host ? 'rotate:host' : `rotate:${guestDevice ?? callerHash.slice(0, 32)}`;
    const budgetLimit = !rotate ? MINT_PER_MATCH : caller.host ? ROTATE_PER_MATCH : GUEST_ROTATE_PER_DEVICE;
    if (!takeMatchBudget(this.sql(), budgetKind, now, budgetLimit, MATCH_BUDGET_WINDOW_MS)) {
      return json(429, { error: 'invite_limited' });
    }
    const code = typeof fields.code === 'string' ? fields.code : null;
    const keepHash = caller.deviceId ? caller.tokenHash : undefined;
    const issued = issueInvite(room, callerHash, fields.role, await sha256Hex(fields.inviteToken), now, keepHash);
    if (!issued.ok) return json(issued.code === 'spectator_not_available' ? 403 : 401, { error: issued.code });
    const created = issued.record.invites.find((row) => row.revokedAt === null && !row.host && !row.deviceId);
    if (!created) return json(500, { error: 'unavailable' });
    const secret = quotaSecret(this.env.QUOTA_HMAC_KEY);
    if (!secret) return json(503, { error: 'not_configured' });
    const sealed = await sealText(secret, JSON.stringify({ token: fields.inviteToken, code }));
    const callerDevice = this.callerDevice(callerHash);
    let sessionToken: string | null = null;
    let sessionDevice: string | null = null;
    if (rotate && !caller.deviceId && !caller.host && callerDevice) {
      sessionToken = randomToken();
      sessionDevice = callerDevice;
    }
    const revokedHashes = room.invites
      .filter((row) => !row.host && row.revokedAt === null && row.tokenHash !== keepHash && (rotate || !row.deviceId))
      .map((row) => row.tokenHash);
    const sessionHash = sessionToken ? await sha256Hex(sessionToken) : null;
    ensureSealedTable(this.sql());
    this.ctx.storage.transactionSync(() => {
      const sql = this.sql();
      if (rotate) {
        revokePlayerInvites(sql, now, keepHash);
        clearKickedDevices(sql);
      } else revokeSharedInvites(sql, now);
      insertInvite(sql, created);
      if (sessionHash && sessionDevice) {
        insertInvite(sql, {
          tokenHash: sessionHash,
          role: 'player',
          host: false,
          expiresAt: issued.expiresAt,
          revokedAt: null,
          deviceId: sessionDevice,
        });
      }
      writeSeal(sql, 'invite', created.tokenHash, sealed, issued.expiresAt);
      dropMemberHashes(sql, revokedHashes);
    });
    this.closeRevokedPlayers();
    return json(201, {
      role: 'player' satisfies Role,
      expiresAt: issued.expiresAt,
      reuse: false,
      ...(keepHash ? { keepHash } : {}),
      ...(sessionToken && sessionDevice ? { sessionToken, sessionDevice, sessionExpiresAt: issued.expiresAt } : {}),
    });
  }

  /** The admitted socket that is using this credential, if it sent a device id. */
  private callerDevice(tokenHash: string): string | null {
    for (const socket of this.ctx.getWebSockets(COURT_TAG)) {
      const state = this.readState(socket);
      if (state?.admitted === true && state.deviceId && safeEqualHex(state.tokenHash, tokenHash)) return state.deviceId;
    }
    return null;
  }

  private async openInviteSeal(tokenHash: string): Promise<{ token: string; code: string | null } | null> {
    const secret = quotaSecret(this.env.QUOTA_HMAC_KEY);
    if (!secret) return null;
    ensureSealedTable(this.sql());
    const row = readSeal(this.sql(), 'invite');
    if (!row || !safeEqualHex(row.tokenHash, tokenHash)) return null;
    const plain = await openText(secret, row.payload);
    if (!plain) return null;
    try {
      const parsed = JSON.parse(plain) as { token?: unknown; code?: unknown };
      if (!isJoinToken(parsed.token)) return null;
      const code = typeof parsed.code === 'string' && parsed.code.length > 0 ? parsed.code : null;
      return { token: parsed.token, code };
    } catch {
      return null;
    }
  }

  /** A phone that was offline follows the new match. Anyone else gets a notice and no token. */
  private async sendHandover(ws: WebSocket, deviceId: string | null, alreadyJoined: boolean): Promise<void> {
    ensureSealedTable(this.sql());
    const sql = this.sql();
    if (!hasMoveSeal(sql)) return;
    const secret = quotaSecret(this.env.QUOTA_HMAC_KEY);
    const row = deviceId ? readSeal(sql, `move:${deviceId}`) : null;
    const now = Date.now();
    if (!secret || !row || now >= row.expiresAt || !alreadyJoined) {
      try {
        ws.send(JSON.stringify({ type: 'match_notice', code: 'continued' }));
      } catch {
        // The peer is already gone.
      }
      return;
    }
    const opened = await openText(secret, row.payload);
    const packed = packedMove(opened);
    const token = packed.token;
    if (!isJoinToken(token)) {
      try {
        ws.send(JSON.stringify({ type: 'match_notice', code: 'continued' }));
      } catch {
        // The peer is already gone.
      }
      return;
    }
    try {
      ws.send(JSON.stringify({ type: 'match_moved', token, ...(packed.seat ? { seat: packed.seat } : {}) }));
    } catch {
      // The peer is already gone.
    }
  }

  /** True after match/end until a later match/resume. A duplicate end must not revoke a match that is open again. */
  private roomIsEnded(): boolean {
    const room = readRoom(this.sql());
    if (!room) return false;
    return replayScore(room.base, room.events.map((item) => item.event)).ended;
  }

  /**
   * Shared invites and the join code for this room.
   * A duplicate end calls this only while the match is still ended.
   */
  private async revokeSharedRoom(sql: RoomSql): Promise<void> {
    const matchId = this.durableMatchId();
    if (!matchId) return;
    const endedAt = Date.now();
    const keep = readJoined(sql).map((row) => row.tokenHash);
    const kept = new Set(keep);
    const open = readRoom(sql);
    if (open) {
      for (const invite of open.invites) {
        if (!invite.host && invite.revokedAt === null && !kept.has(invite.tokenHash)) {
          revokeInviteHash(sql, invite.tokenHash, endedAt);
        }
      }
    }
    await d1MatchIndex(this.env.DB).revokeSharedAccess(matchId, endedAt, keep);
  }

  /**
   * The caller drops their own credential. The shared join code is a different row and stays.
   * The body cannot name another phone. D1 is updated for the durable object id, or the id stored at create.
   */
  private async leave(request: Request): Promise<Response> {
    const body = await readBody(request, 2000);
    const token = body && typeof body === 'object' ? (body as { token?: unknown }).token : undefined;
    if (!isJoinToken(token)) return json(401, { error: 'bad_token' });
    const matchId = this.durableMatchId();
    if (!matchId) return json(503, { error: 'unavailable' });
    const room = readRoom(this.sql());
    if (!room) return json(404, { error: 'unavailable' });
    const tokenHash = await sha256Hex(token);
    const now = Date.now();
    const invite = room.invites.find((row) => safeEqualHex(row.tokenHash, tokenHash));
    if (!invite || invite.revokedAt !== null || now >= invite.expiresAt || invite.role !== 'player') {
      return json(401, { error: 'bad_token' });
    }
    if (!takeMatchBudget(this.sql(), `leave:${tokenHash}`, now, LEAVE_PER_ACTOR, LEAVE_WINDOW_MS)) {
      return json(429, { error: 'leave_limited' });
    }
    if (!invite.host && !invite.deviceId) return json(200, { revoked: false });
    const devices = readJoined(this.sql()).flatMap((row) => (
      safeEqualHex(row.tokenHash, tokenHash) && row.deviceId ? [row.deviceId] : []
    ));
    this.ctx.storage.transactionSync(() => {
      const sql = this.sql();
      revokeInviteHash(sql, tokenHash, now);
      for (const deviceId of devices) {
        dropJoinedDevice(sql, deviceId);
        dropRosterDevice(sql, deviceId);
        deleteSeal(sql, `move:${deviceId}`);
      }
    });
    try {
      await d1MatchIndex(this.env.DB).revokeCredentialInMatch(tokenHash, matchId, now);
    } catch {
      // The room row is already revoked, so hello with this token fails.
    }
    this.closeToken(tokenHash);
    this.broadcastPresence();
    this.sendRoster();
    return json(200, { revoked: true });
  }

  private closeToken(tokenHash: string): void {
    for (const socket of this.ctx.getWebSockets(COURT_TAG)) {
      const peer = this.readState(socket);
      if (peer?.admitted === true && safeEqualHex(peer.tokenHash, tokenHash)) this.reject(socket, 'revoked');
    }
  }

  /**
   * Remove one other phone. The target is a public seat, never a device id.
   * The device credential is revoked. The current shared code will not seat that device again.
   */
  private async kick(ws: WebSocket, state: AdmittedState, record: Record<string, unknown>): Promise<void> {
    const attempt = allowRate(state.kickStamps ?? [], Date.now(), 5, 10_000);
    const nextState: AdmittedState = { ...state, kickStamps: attempt.stamps };
    ws.serializeAttachment(nextState);
    if (!attempt.ok) {
      this.reject(ws, 'slow_down');
      return;
    }
    const targetSeat = publicSeat(record.seat);
    if (!targetSeat || !state.deviceId) {
      this.reject(ws, 'not_applied');
      return;
    }
    const verdict = decideKick(state.actor, targetSeat);
    if (verdict !== 'ok') {
      this.reject(ws, verdict === 'bad' ? 'not_applied' : 'kick_refused');
      return;
    }
    const target = readRoster(this.sql()).find((row) => row.seat === targetSeat);
    if (!target || !isDeviceId(target.deviceId) || target.deviceId === state.deviceId) {
      this.reject(ws, 'not_applied');
      return;
    }
    const now = Date.now();
    const actorKey = `kick:${state.tokenHash}`;
    const roomKey = 'kick:room';
    if (
      !matchBudgetOpen(this.sql(), actorKey, now, KICK_PER_ACTOR, KICK_WINDOW_MS)
      || !matchBudgetOpen(this.sql(), roomKey, now, KICK_PER_MATCH, KICK_WINDOW_MS)
    ) {
      this.reject(ws, 'kick_limited');
      return;
    }
    if (
      !takeMatchBudget(this.sql(), actorKey, now, KICK_PER_ACTOR, KICK_WINDOW_MS)
      || !takeMatchBudget(this.sql(), roomKey, now, KICK_PER_MATCH, KICK_WINDOW_MS)
    ) {
      this.reject(ws, 'kick_limited');
      return;
    }
    const room = readRoom(this.sql());
    const hashes = room
      ? room.invites
        .filter((row) => !row.host && row.deviceId === target.deviceId && row.revokedAt === null)
        .map((row) => row.tokenHash)
      : [];
    const deviceId = target.deviceId;
    this.ctx.storage.transactionSync(() => {
      const sql = this.sql();
      for (const hash of hashes) revokeInviteHash(sql, hash, now);
      dropJoinedDevice(sql, deviceId);
      dropRosterDevice(sql, deviceId);
      deleteSeal(sql, `move:${deviceId}`);
      blockKickedDevice(sql, deviceId, now);
    });
    const matchId = this.durableMatchId();
    if (matchId) {
      for (const hash of hashes) {
        try {
          await d1MatchIndex(this.env.DB).revokeCredentialInMatch(hash, matchId, now);
        } catch {
          // The room invite is already revoked, so the old token cannot hello.
        }
      }
    }
    this.closeDevice(deviceId);
    this.broadcastPresence();
    this.sendRoster();
  }

  private closeDevice(deviceId: string): void {
    for (const socket of this.ctx.getWebSockets(COURT_TAG)) {
      const peer = this.readState(socket);
      if (peer?.admitted === true && peer.deviceId === deviceId) this.reject(socket, 'revoked');
    }
  }

  private closeRevokedPlayers(): void {
    const room = readRoom(this.sql());
    if (!room) return;
    for (const socket of this.ctx.getWebSockets(COURT_TAG)) {
      const state = this.readState(socket);
      if (!state?.admitted || state.credential.host) continue;
      const invite = room.invites.find((row) => safeEqualHex(row.tokenHash, state.tokenHash));
      if (!invite || invite.revokedAt !== null) this.reject(socket, 'revoked');
    }
  }

  /** Move a stored 32-bit id onto the new 128-bit id for this credential only. */
  private rebindDevice(tokenHash: string, from: string, to: string): void {
    if (!isLegacyDeviceId(from) || !isDeviceId(to) || from === to) return;
    const sql = this.sql();
    sql.exec('UPDATE invites SET device_id = ? WHERE token_hash = ? AND device_id = ?', to, tokenHash, from);
    sql.exec('UPDATE joined SET device_id = ? WHERE token_hash = ? AND device_id = ?', to, tokenHash, from);
    try {
      sql.exec('UPDATE roster SET device_id = ? WHERE device_id = ?', to, from);
    } catch {
      // No roster yet.
    }
    try {
      ensureSealedTable(sql);
      sql.exec('UPDATE sealed SET id = ? WHERE id = ?', `move:${to}`, `move:${from}`);
    } catch {
      // No seal yet.
    }
  }

  /** Seat label already shown in the phone list. Never a device id. */
  private starterSeat(deviceId: string): string | null {
    const row = readJoined(this.sql()).find((item) => item.deviceId === deviceId);
    return row ? publicSeat(row.playerId) : null;
  }

  /** A sealed move for this device is still inside its lifetime. */
  private liveMoveSeal(deviceId: string | null): boolean {
    if (!deviceId) return false;
    ensureSealedTable(this.sql());
    const row = readSeal(this.sql(), `move:${deviceId}`);
    return row !== null && Date.now() < row.expiresAt;
  }

  private assignActor(host: boolean, tokenHash: string, deviceId: string | null, bindNewPair: boolean): string | null {
    const joined = readJoined(this.sql());
    const connected: { actor: string; deviceId: string | null }[] = [];
    for (const socket of this.ctx.getWebSockets(COURT_TAG)) {
      const state = this.readState(socket);
      if (state?.admitted) connected.push({ actor: state.actor, deviceId: state.deviceId });
    }
    const actor = chooseActor({ host, tokenHash, deviceId, joined, connected });
    if (!actor || !deviceId) return actor;
    const already = joined.some((row) => row.tokenHash === tokenHash && row.deviceId === deviceId);
    // A hello must not create the pair that would unlock someone else's move token.
    if (!already && bindNewPair) insertJoined(this.sql(), tokenHash, actor, deviceId);
    return actor;
  }

  private async requireHost(hostToken: unknown): Promise<ReturnType<typeof readRoom>> {
    if (!isJoinToken(hostToken)) return null;
    const room = readRoom(this.sql());
    if (!room) return null;
    const hostHash = await sha256Hex(hostToken);
    const now = Date.now();
    const host = room.invites.find((row) => row.host && safeEqualHex(row.tokenHash, hostHash));
    if (!host || host.revokedAt !== null || now >= host.expiresAt) return null;
    return room;
  }

  /** Any unexpired player credential for this room. The check is the row in this object, not the caller's claim. */
  private async requireMember(token: unknown): Promise<ReturnType<typeof readRoom>> {
    if (!isJoinToken(token)) return null;
    const room = readRoom(this.sql());
    if (!room) return null;
    const hash = await sha256Hex(token);
    const now = Date.now();
    const row = room.invites.find((invite) => safeEqualHex(invite.tokenHash, hash));
    if (!row || row.role !== 'player' || row.revokedAt !== null || now >= row.expiresAt) return null;
    return room;
  }

  private memberList(room: RoomRecord): { deviceId: string; connected: boolean }[] {
    const now = Date.now();
    const valid = new Set(
      room.invites
        .filter((row) => row.revokedAt === null && now < row.expiresAt && row.role === 'player')
        .map((row) => row.tokenHash),
    );
    const connected = new Set<string>();
    for (const socket of this.ctx.getWebSockets(COURT_TAG)) {
      const state = this.readState(socket);
      if (state?.admitted === true && state.deviceId) connected.add(state.deviceId);
    }
    const seenAt = new Map(readRoster(this.sql()).map((row) => [row.deviceId, row.seen]));
    const members: { deviceId: string; connected: boolean }[] = [];
    const seen = new Set<string>();
    for (const row of readJoined(this.sql())) {
      if (!row.deviceId || !isDeviceId(row.deviceId) || seen.has(row.deviceId)) continue;
      if (!valid.has(row.tokenHash)) continue;
      const online = connected.has(row.deviceId);
      const last = seenAt.get(row.deviceId) ?? 0;
      if (!online && (last === 0 || now - last > MEMBER_SEEN_MS)) continue;
      seen.add(row.deviceId);
      members.push({ deviceId: row.deviceId, connected: online });
    }
    return members;
  }

  /**
   * The phone that asked to move the court.
   * A shared QR has no device of its own and cannot start a move.
   * A host or a device-bound credential must already have joined with that device.
   */
  private starterDevice(room: RoomRecord, tokenHash: string): string | null {
    const now = Date.now();
    const row = room.invites.find((invite) => safeEqualHex(invite.tokenHash, tokenHash));
    if (!row || row.revokedAt !== null || now >= row.expiresAt || row.role !== 'player') return null;
    const joined = readJoined(this.sql()).filter((item) => safeEqualHex(item.tokenHash, tokenHash) && item.deviceId && isDeviceId(item.deviceId));
    if (row.deviceId) {
      return joined.some((item) => item.deviceId === row.deviceId) ? row.deviceId : null;
    }
    if (!row.host) return null;
    const live = new Set<string>();
    for (const socket of this.ctx.getWebSockets(COURT_TAG)) {
      const state = this.readState(socket);
      if (state?.admitted === true && state.deviceId) live.add(state.deviceId);
    }
    const connected = joined.filter((item) => item.deviceId && live.has(item.deviceId));
    if (connected.length === 1) return connected[0]?.deviceId ?? null;
    if (joined.length === 1) return joined[0]?.deviceId ?? null;
    return null;
  }

  private async reconnectInfo(request: Request): Promise<Response> {
    const body = await readBody(request, 2000);
    const token = body && typeof body === 'object' ? (body as { hostToken?: unknown }).hostToken : undefined;
    const room = await this.requireMember(token);
    if (!room) return json(401, { error: 'bad_token' });
    return json(200, {
      lastChangeAt: serverLastChange(room),
      members: this.memberList(room),
    });
  }

  private async carryClaim(request: Request): Promise<Response> {
    const body = await readBody(request, 2000);
    const token = body && typeof body === 'object' ? (body as { hostToken?: unknown }).hostToken : undefined;
    const room = await this.requireMember(token);
    if (!room || !isJoinToken(token)) return json(401, { error: 'bad_token' });
    const tokenHash = await sha256Hex(token);
    const caller = room.invites.find((invite) => safeEqualHex(invite.tokenHash, tokenHash));
    if (!caller?.host) return json(401, { error: 'bad_token' });
    const starter = this.starterDevice(room, tokenHash);
    if (!starter) return json(401, { error: 'bad_token' });
    const members = this.memberList(room).filter((member) => member.deviceId !== starter);
    const now = Date.now();
    if (members.length > 0 && !matchBudgetOpen(this.sql(), `carry:${starter}`, now, CARRY_PER_DEVICE, 0)) {
      return json(429, { error: 'carry_limited' });
    }
    return json(200, { starterDevice: starter, starterSeat: this.starterSeat(starter), members });
  }

  private async playerInvite(request: Request): Promise<Response> {
    const body = await readBody(request, 2000);
    const fields = body && typeof body === 'object'
      ? (body as { token?: unknown; deviceId?: unknown; expiresAt?: unknown; replaceHash?: unknown })
      : {};
    if (!isJoinToken(fields.token) || typeof fields.expiresAt !== 'number' || !Number.isInteger(fields.expiresAt)) {
      return json(400, { error: 'invalid_match' });
    }
    if (!isDeviceId(fields.deviceId)) return json(400, { error: 'invalid_match' });
    if (!readRoom(this.sql())) return json(404, { error: 'unavailable' });
    if (isKickedDevice(this.sql(), fields.deviceId)) return json(409, { error: 'join_code' });
    const expiresAt = fields.expiresAt;
    const deviceId = fields.deviceId;
    const tokenHash = await sha256Hex(fields.token);
    const decision = this.ctx.storage.transactionSync(() => grantMintedInvite(this.sql(), {
      tokenHash,
      role: 'player',
      host: false,
      expiresAt,
      revokedAt: null,
      deviceId,
    }, Date.now(), MAX_MINTED_TOKENS, UNUSED_MINT_MS));
    if (decision.status === 'full') return json(409, { error: 'join_code' });
    return json(201, { ok: true, replaced: decision.replaced, revokedAt: decision.revokedAt });
  }

  private async revokeMinted(request: Request): Promise<Response> {
    const body = await readBody(request, 4000);
    const fields = body && typeof body === 'object'
      ? (body as { tokenHash?: unknown; restore?: unknown; revokedAt?: unknown })
      : {};
    const tokenHash = fields.tokenHash;
    if (typeof tokenHash !== 'string' || !/^[0-9a-f]{64}$/.test(tokenHash)) return json(400, { error: 'invalid_match' });
    if (!readRoom(this.sql())) return json(404, { error: 'unavailable' });
    revokeInviteHash(this.sql(), tokenHash, Date.now());
    const restore = Array.isArray(fields.restore)
      ? fields.restore.filter((hash): hash is string => typeof hash === 'string').slice(0, MAX_MINTED_TOKENS)
      : [];
    if (typeof fields.revokedAt === 'number') restoreInviteHashes(this.sql(), restore, fields.revokedAt);
    return json(200, { ok: true });
  }

  private async carryInvite(request: Request): Promise<Response> {
    const body = await readBody(request, 2000);
    const fields = body && typeof body === 'object'
      ? (body as { hostToken?: unknown; token?: unknown; deviceId?: unknown; expiresAt?: unknown })
      : {};
    if (!isJoinToken(fields.token) || typeof fields.expiresAt !== 'number' || !Number.isInteger(fields.expiresAt)) {
      return json(400, { error: 'invalid_match' });
    }
    if (!isDeviceId(fields.deviceId)) return json(400, { error: 'invalid_match' });
    const room = await this.requireHost(fields.hostToken);
    if (!room) return json(401, { error: 'bad_token' });
    insertInvite(this.sql(), {
      tokenHash: await sha256Hex(fields.token),
      role: 'player',
      host: false,
      expiresAt: fields.expiresAt,
      revokedAt: null,
      deviceId: fields.deviceId,
    });
    return json(201, { ok: true });
  }

  private async notify(request: Request): Promise<Response> {
    const body = await readBody(request, 8000);
    const fields = body && typeof body === 'object'
      ? (body as { hostToken?: unknown; offers?: unknown; starterDevice?: unknown; seat?: unknown })
      : {};
    const room = await this.requireMember(fields.hostToken);
    if (!room) return json(401, { error: 'bad_token' });
    const secret = quotaSecret(this.env.QUOTA_HMAC_KEY);
    if (!secret) return json(503, { error: 'not_configured' });
    const starter = isDeviceId(fields.starterDevice) ? fields.starterDevice : null;
    const seat = publicSeat(fields.seat);
    const offers = Array.isArray(fields.offers) ? fields.offers : [];
    const allowed = new Set(this.memberList(room).map((member) => member.deviceId));
    const moving: { deviceId: string; token: string }[] = [];
    for (const offer of offers) {
      if (!offer || typeof offer !== 'object') continue;
      const row = offer as { deviceId?: unknown; token?: unknown };
      if (!isJoinToken(row.token) || !isDeviceId(row.deviceId) || !allowed.has(row.deviceId)) continue;
      if (row.deviceId === starter) continue;
      moving.push({ deviceId: row.deviceId, token: row.token });
    }
    if (moving.length === 0) return json(200, { ok: true });
    if (!starter) return json(401, { error: 'bad_token' });
    const now = Date.now();
    if (!takeMatchBudget(this.sql(), `carry:${starter}`, now, CARRY_PER_DEVICE, 0)) {
      return json(429, { error: 'carry_limited' });
    }
    ensureSealedTable(this.sql());
    for (const row of moving) {
      const expiresAt = now + JOIN_TOKEN_TTL_MS;
      writeSeal(
        this.sql(),
        `move:${row.deviceId}`,
        await sha256Hex(row.token),
        await sealText(secret, JSON.stringify({ token: row.token, seat })),
        expiresAt,
      );
      const payload = JSON.stringify({ type: 'match_moved', token: row.token, ...(seat ? { seat } : {}) });
      for (const socket of this.ctx.getWebSockets(COURT_TAG)) {
        const state = this.readState(socket);
        if (state?.admitted !== true || state.deviceId !== row.deviceId) continue;
        try {
          socket.send(payload);
        } catch {
          // A closed peer must not stop the move.
        }
      }
    }
    return json(200, { ok: true });
  }

  private admittedCount(): number {
    return this.ctx.getWebSockets(COURT_TAG).filter((socket) => this.readState(socket)?.admitted === true).length;
  }

  private broadcastPresence(): void {
    this.broadcast(JSON.stringify({ type: 'presence', players: this.admittedCount() }));
  }

  private reject(ws: WebSocket, code: string, eventId?: unknown): void {
    const id = typeof eventId === 'string' ? eventId.trim().toLowerCase() : '';
    const body = id.length > 0 && id.length <= 80 ? { type: 'error', code, eventId: id } : { type: 'error', code };
    try {
      ws.send(JSON.stringify(body));
    } catch {
      // The peer is already gone.
    }
    if (isRoomCode(code) && connectionCloses(code)) {
      try {
        ws.close(1008, code.slice(0, 120));
      } catch {
        // The peer is already gone.
      }
    }
  }

  private readState(ws: WebSocket): SocketState | null {
    const state = ws.deserializeAttachment() as SocketState | null;
    if (!state || (state.admitted !== true && state.admitted !== false)) return null;
    if (typeof state.ip !== 'string') return null;
    if (state.admitted && (typeof state.actor !== 'string' || typeof state.tokenHash !== 'string')) return null;
    return state;
  }

  private view(state: SocketState): SocketView {
    return { ip: state.ip, admitted: state.admitted, openedAt: state.admitted ? 0 : state.openedAt };
  }

  private views(): SocketView[] {
    const views: SocketView[] = [];
    for (const socket of this.ctx.getWebSockets(COURT_TAG)) {
      const state = this.readState(socket);
      if (state) views.push(this.view(state));
    }
    return views;
  }

  private async armAlarm(now: number): Promise<void> {
    const due = nextHelloAlarm(this.views(), now);
    if (due === null) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.ctx.storage.setAlarm(due);
  }
}
