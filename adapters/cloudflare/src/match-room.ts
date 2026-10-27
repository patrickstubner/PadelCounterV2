import { DurableObject } from 'cloudflare:workers';
import { connectionCloses, isJoinToken, isRole, isRoomCode, parseMatchLog, type Credential, type Role } from '@padel/core';
import { allowPending, expiredHello, nextHelloAlarm, type SocketView } from './admission';
import { CLIENT_IP_HEADER } from './match-index';
import { takeLiveMessage } from './rate';
import { applyPlay, createRoom, eventDelta, helloPayload, issueInvite } from './room';
import { insertEvent, insertInvite, insertRoom, openRoomForCreate, readRoom, revokePlayerInvites, type RoomSql } from './store';
import { sha256Hex } from './tokens';

interface PendingState {
  readonly admitted: false;
  readonly ip: string;
  readonly openedAt: number;
}

interface AdmittedState {
  readonly admitted: true;
  readonly credential: Credential;
  readonly stamps: readonly number[];
  readonly ip: string;
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

export class MatchRoom extends DurableObject {
  private sql(): RoomSql {
    return this.ctx.storage.sql as unknown as RoomSql;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') return this.openSocket(request);
      if (request.method === 'POST' && url.pathname === '/create') return this.create(request);
      if (request.method === 'POST' && url.pathname === '/invite') return this.invite(request);
      return json(404, { error: 'not_found' });
    } catch {
      return json(500, { error: 'unavailable' });
    }
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      const state = this.readState(ws);
      if (!state || state.admitted) continue;
      if (expiredHello([this.view(state)], now).length === 0) continue;
      ws.send(JSON.stringify({ type: 'error', code: 'slow_down' }));
      ws.close(1008, 'slow_down');
    }
    await this.armAlarm(Date.now());
  }

  private async openSocket(request: Request): Promise<Response> {
    const ip = request.headers.get(CLIENT_IP_HEADER) ?? 'missing';
    const views = this.views();
    if (!allowPending(views, ip)) return json(429, { error: 'slow_down' });
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    const openedAt = Date.now();
    server.serializeAttachment({ admitted: false, ip, openedAt } satisfies PendingState);
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
    const budget = takeLiveMessage(state.stamps, record.type, Date.now());
    ws.serializeAttachment({ ...state, stamps: budget.stamps });
    if (!budget.ok) {
      this.reject(ws, budget.code);
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
    if (record.protocol !== 1 || !isJoinToken(record.token)) {
      this.reject(ws, record.protocol === 1 ? 'bad_token' : 'upgrade_required');
      return;
    }
    const room = readRoom(this.sql());
    if (!room) {
      this.reject(ws, 'unavailable');
      return;
    }
    const tokenHash = await sha256Hex(record.token);
    const connected = this.ctx.getWebSockets().filter((socket) => {
      if (socket === ws) return false;
      return this.readState(socket)?.admitted === true;
    }).length;
    const result = helloPayload(room, tokenHash, connected, Date.now());
    if (!result.ok) {
      this.reject(ws, result.code);
      return;
    }
    const next: AdmittedState = {
      admitted: true,
      credential: result.credential,
      stamps: [],
      ip: pending && !pending.admitted ? pending.ip : 'missing',
    };
    ws.serializeAttachment(next);
    ws.send(JSON.stringify(result.payload));
    this.broadcastPresence();
    await this.armAlarm(Date.now());
  }

  private async play(ws: WebSocket, state: AdmittedState, record: Record<string, unknown>): Promise<void> {
    const room = readRoom(this.sql());
    if (!room) {
      this.reject(ws, 'unavailable');
      return;
    }
    if (typeof record.eventId !== 'string') {
      this.reject(ws, 'not_applied');
      return;
    }
    const result = applyPlay(room, state.credential, record.eventId, record.event, Date.now());
    if (!result.ok) {
      this.reject(ws, result.code);
      return;
    }
    if (!result.duplicate) {
      try {
        insertEvent(this.sql(), result.event);
      } catch {
        this.reject(ws, 'unavailable');
        return;
      }
    }
    const payload = JSON.stringify(
      eventDelta({
        eventId: result.event.eventId,
        event: result.event.event,
        duplicate: result.duplicate,
        players: this.admittedCount(),
      }),
    );
    for (const socket of this.ctx.getWebSockets()) {
      if (this.readState(socket)?.admitted !== true) continue;
      socket.send(payload);
    }
  }

  private async create(request: Request): Promise<Response> {
    if (openRoomForCreate(this.sql())) return json(409, { error: 'unavailable' });
    const body = await readBody(request, 96_000);
    if (!body || typeof body !== 'object') return json(400, { error: 'invalid_match' });
    const log = parseMatchLog((body as { log?: unknown }).log);
    const hostToken = (body as { hostToken?: unknown }).hostToken;
    if (!log || !isJoinToken(hostToken)) return json(400, { error: 'invalid_match' });
    const now = Date.now();
    const created = createRoom(log, await sha256Hex(hostToken), now);
    insertRoom(this.sql(), created.record, now);
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
    revokePlayerInvites(this.sql(), now);
    const created = issued.record.invites.find((row) => row.revokedAt === null && !row.host);
    if (!created) return json(500, { error: 'unavailable' });
    insertInvite(this.sql(), created);
    return json(201, { role: 'player' satisfies Role, expiresAt: issued.expiresAt });
  }

  private admittedCount(): number {
    return this.ctx.getWebSockets().filter((socket) => this.readState(socket)?.admitted === true).length;
  }

  private broadcastPresence(): void {
    const payload = JSON.stringify({ type: 'presence', players: this.admittedCount() });
    for (const socket of this.ctx.getWebSockets()) {
      if (this.readState(socket)?.admitted !== true) continue;
      socket.send(payload);
    }
  }

  private reject(ws: WebSocket, code: string): void {
    ws.send(JSON.stringify({ type: 'error', code }));
    if (isRoomCode(code) && connectionCloses(code)) ws.close(1008, code.slice(0, 120));
  }

  private readState(ws: WebSocket): SocketState | null {
    const state = ws.deserializeAttachment() as SocketState | null;
    if (!state || (state.admitted !== true && state.admitted !== false)) return null;
    if (typeof state.ip !== 'string') return null;
    return state;
  }

  private view(state: SocketState): SocketView {
    return { ip: state.ip, admitted: state.admitted, openedAt: state.admitted ? 0 : state.openedAt };
  }

  private views(): SocketView[] {
    const views: SocketView[] = [];
    for (const socket of this.ctx.getWebSockets()) {
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
