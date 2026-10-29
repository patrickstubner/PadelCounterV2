import { DurableObject } from 'cloudflare:workers';
import { LIVE_PROTOCOL, MAX_MINTED_TOKENS, ROOM_MESSAGES, clampClockOffset, connectionCloses, isJoinToken, isRole, isRoomCode, liveTeamSide, parseLiveTeamName, parseMatchLog, prepareLiveLog, replayScore, type Credential, type Role } from '@padel/core';
import { allowPending, expiredHello, nextHelloAlarm, type SocketView } from './admission';
import { CLIENT_IP_HEADER, d1MatchIndex, shouldTouchActivity, touchMatchActivity, type D1Like } from './match-index';
import { allowRate, RENAME_PER_SECOND, takeLiveMessage } from './rate';
import { applyLiveEvent, chooseActor, createRoom, eventDelta, helloPayload, invitesForCarry, issueInvite, serverLastChange } from './room';
import { ensureActivityColumn, grantMintedInvite, insertEvent, insertInvite, insertJoined, insertRoom, latestEventSeq, markActivityTouch, openRoomForCreate, readActivityTouch, readEventSeq, readJoined, readRoom, restoreInviteHashes, revokeInviteHash, revokePlayerInvites, type RoomSql } from './store';
import { quotaMac, quotaSecret, safeEqualHex, sha256Hex } from './tokens';

/** Fixed scope. A minute in the MAC would split one address across two pending caps. */
const SOCKET_IP_SCOPE = 'socket';
/** Hibernation tag so a broadcast can see every court socket after the isolate wakes. */
const COURT_TAG = 'court';

interface PendingState {
  readonly admitted: false;
  /** HMAC of the client address. Never the address itself. */
  readonly ip: string;
  readonly openedAt: number;
}

interface AdmittedState {
  readonly admitted: true;
  readonly credential: Credential;
  readonly stamps: readonly number[];
  readonly renameStamps?: readonly number[];
  /** HMAC of the client address. Never the address itself. */
  readonly ip: string;
  readonly actor: string;
  readonly tokenHash: string;
  readonly deviceId: string | null;
  /** Server clock minus the phone clock at hello. Display only. */
  readonly clockOffset: number;
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

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') return this.openSocket(request);
      if (request.method === 'POST' && url.pathname === '/discard') {
        await this.ctx.storage.deleteAll();
        return json(200, { ok: true });
      }
      if (request.method === 'POST' && url.pathname === '/reconnect-info') return this.reconnectInfo(request);
      if (request.method === 'POST' && url.pathname === '/carry-invite') return this.carryInvite(request);
      if (request.method === 'POST' && url.pathname === '/notify') return this.notify(request);
      if (request.method === 'POST' && url.pathname === '/create') return this.create(request);
      if (request.method === 'POST' && url.pathname === '/invite') return this.invite(request);
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
    server.serializeAttachment({ admitted: false, ip: ipMac, openedAt } satisfies PendingState);
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
    void ws;
    void code;
    void reason;
    void wasClean;
    this.broadcastPresence();
    await this.armAlarm(Date.now());
  }

  private async hello(ws: WebSocket, record: Record<string, unknown>, pending: SocketState | null): Promise<void> {
    if (record.protocol !== LIVE_PROTOCOL || !isJoinToken(record.token)) {
      this.reject(ws, record.protocol === LIVE_PROTOCOL ? 'bad_token' : 'upgrade_required');
      return;
    }
    const room = readRoom(this.sql());
    if (!room) {
      this.reject(ws, 'unavailable');
      return;
    }
    const tokenHash = await sha256Hex(record.token);
    const deviceId = typeof record.device === 'string' && /^d[a-f0-9]{8}$/.test(record.device) ? record.device : null;
    const seated = this.seatedSockets(ws, deviceId);
    const result = helloPayload(room, tokenHash, seated.others, Date.now(), deviceId);
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
    const actor = this.assignActor(result.credential.host, tokenHash, deviceId);
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
    this.closeSuperseded(seated.same);
    this.broadcastPresence();
    await this.armAlarm(Date.now());
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
      try {
        const sql = this.sql();
        insertEvent(sql, result.event);
        ensureActivityColumn(sql);
        if (result.event.event.type === 'match/end') {
          const endedAt = Date.now();
          revokePlayerInvites(sql, endedAt);
          await d1MatchIndex(this.env.DB).revokeSharedAccess(room.base.matchId, endedAt);
        }
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
    if (result.reconciled !== 'already') this.broadcast(payload, ws);
    try {
      ws.send(payload);
    } catch {
      // The sender already showed the point. The ack is only for reconciliation.
    }
    if (!result.duplicate) {
      const at = result.event.event.at;
      const sql = this.sql();
      const last = readActivityTouch(sql);
      if (last !== null && shouldTouchActivity(last, at)) {
        markActivityTouch(sql, at);
        try {
          await touchMatchActivity(this.env.DB, room.base.matchId, at);
        } catch {
          markActivityTouch(sql, last);
        }
      }
    }
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
    insertRoom(this.sql(), created.record);
    return json(201, { expiresAt: created.expiresAt });
  }

  private async invite(request: Request): Promise<Response> {
    const body = await readBody(request, 4000);
    if (!body || typeof body !== 'object') return json(400, { error: 'invalid_match' });
    const fields = body as { hostToken?: unknown; role?: unknown; inviteToken?: unknown };
    if (!isJoinToken(fields.hostToken) || !isJoinToken(fields.inviteToken) || !isRole(fields.role)) {
      return json(400, { error: 'invalid_match' });
    }
    const room = readRoom(this.sql());
    if (!room) return json(404, { error: 'unavailable' });
    const now = Date.now();
    const issued = issueInvite(
      room,
      await sha256Hex(fields.hostToken),
      fields.role,
      await sha256Hex(fields.inviteToken),
      now,
    );
    if (!issued.ok) return json(issued.code === 'spectator_not_available' ? 403 : 401, { error: issued.code });
    const created = issued.record.invites.find((row) => row.revokedAt === null && !row.host);
    if (!created) return json(500, { error: 'unavailable' });
    this.ctx.storage.transactionSync(() => {
      const sql = this.sql();
      revokePlayerInvites(sql, now);
      insertInvite(sql, created);
    });
    return json(201, { role: 'player' satisfies Role, expiresAt: issued.expiresAt });
  }

  private assignActor(host: boolean, tokenHash: string, deviceId: string | null): string | null {
    const joined = readJoined(this.sql());
    const connected: { actor: string; deviceId: string | null }[] = [];
    for (const socket of this.ctx.getWebSockets(COURT_TAG)) {
      const state = this.readState(socket);
      if (state?.admitted) connected.push({ actor: state.actor, deviceId: state.deviceId });
    }
    const actor = chooseActor({ host, tokenHash, deviceId, joined, connected });
    if (!actor || !deviceId) return actor;
    const already = joined.some((row) => row.tokenHash === tokenHash && row.deviceId === deviceId);
    if (!already) insertJoined(this.sql(), tokenHash, actor, deviceId);
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

  private async reconnectInfo(request: Request): Promise<Response> {
    const body = await readBody(request, 2000);
    const hostToken = body && typeof body === 'object' ? (body as { hostToken?: unknown }).hostToken : undefined;
    const room = await this.requireHost(hostToken);
    if (!room) return json(401, { error: 'bad_token' });
    const joined = readJoined(this.sql());
    return json(200, {
      lastChangeAt: serverLastChange(room),
      joinedHashes: [...new Set(joined.filter((row) => row.playerId !== 'host' && row.deviceId).map((row) => row.tokenHash))],
      invites: invitesForCarry(room.invites, joined),
    });
  }

  private async playerInvite(request: Request): Promise<Response> {
    const body = await readBody(request, 2000);
    const fields = body && typeof body === 'object'
      ? (body as { token?: unknown; deviceId?: unknown; expiresAt?: unknown; replaceHash?: unknown })
      : {};
    if (!isJoinToken(fields.token) || typeof fields.expiresAt !== 'number' || !Number.isInteger(fields.expiresAt)) {
      return json(400, { error: 'invalid_match' });
    }
    if (typeof fields.deviceId !== 'string' || !/^d[a-f0-9]{8}$/.test(fields.deviceId)) {
      return json(400, { error: 'invalid_match' });
    }
    if (!readRoom(this.sql())) return json(404, { error: 'unavailable' });
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
    }, Date.now(), MAX_MINTED_TOKENS));
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
    if (typeof fields.deviceId !== 'string' || !/^d[a-f0-9]{8}$/.test(fields.deviceId)) {
      return json(400, { error: 'invalid_match' });
    }
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
    const fields = body && typeof body === 'object' ? (body as { hostToken?: unknown; offers?: unknown }) : {};
    const room = await this.requireHost(fields.hostToken);
    if (!room) return json(401, { error: 'bad_token' });
    const offers = Array.isArray(fields.offers) ? fields.offers : [];
    for (const offer of offers) {
      if (!offer || typeof offer !== 'object') continue;
      const row = offer as { deviceId?: unknown; token?: unknown };
      if (!isJoinToken(row.token) || typeof row.deviceId !== 'string') continue;
      const payload = JSON.stringify({ type: 'join_offer', token: row.token });
      for (const socket of this.ctx.getWebSockets(COURT_TAG)) {
        const state = this.readState(socket);
        if (state?.admitted !== true || state.deviceId !== row.deviceId) continue;
        try {
          socket.send(payload);
        } catch {
          // A closed peer must not stop the offer.
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
