import { DurableObject } from 'cloudflare:workers';
import { isJoinToken, isRole, parseMatchLog, type Credential, type Role } from '@padel/core';
import { allowRate } from './rate';
import {
  applyPlay,
  createRoom,
  helloPayload,
  issueInvite,
  toLog,
} from './room';
import {
  insertEvent,
  insertInvite,
  insertRoom,
  loadRoom,
  migrate,
  revokePlayerInvites,
  type RoomSql,
} from './store';
import { sha256Hex } from './tokens';

interface SocketState {
  readonly admitted: true;
  readonly credential: Credential;
  readonly stamps: readonly number[];
}

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
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      migrate(this.sql());
    });
  }

  private sql(): RoomSql {
    return this.ctx.storage.sql as unknown as RoomSql;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') return this.openSocket();
      if (request.method === 'POST' && url.pathname === '/create') return this.create(request);
      if (request.method === 'POST' && url.pathname === '/invite') return this.invite(request);
      return json(404, { error: 'not_found' });
    } catch {
      return json(500, { error: 'unavailable' });
    }
  }

  private openSocket(): Response {
    const sockets = this.ctx.getWebSockets();
    const pending = sockets.filter((socket) => {
      const state = socket.deserializeAttachment() as SocketState | null;
      return state?.admitted !== true;
    }).length;
    if (sockets.length >= 16 || pending >= 4) return json(429, { error: 'slow_down' });
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string' || message.length > 8192) {
      this.fail(ws, 'not_applied');
      return;
    }
    let body: unknown;
    try {
      body = JSON.parse(message) as unknown;
    } catch {
      this.fail(ws, 'not_applied');
      return;
    }
    if (typeof body !== 'object' || body === null) {
      this.fail(ws, 'not_applied');
      return;
    }
    const record = body as Record<string, unknown>;
    const state = ws.deserializeAttachment() as SocketState | null;
    if (!state?.admitted) {
      if (record.type !== 'hello') {
        this.fail(ws, 'bad_token');
        return;
      }
      await this.hello(ws, record);
      return;
    }
    if (record.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
      return;
    }
    if (record.type !== 'event') {
      this.fail(ws, 'not_applied');
      return;
    }
    await this.play(ws, state, record);
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    void ws;
    void code;
    void reason;
    void wasClean;
    this.broadcastPresence();
  }

  private async hello(ws: WebSocket, record: Record<string, unknown>): Promise<void> {
    if (record.protocol !== 1 || !isJoinToken(record.token)) {
      this.fail(ws, record.protocol === 1 ? 'bad_token' : 'upgrade_required');
      return;
    }
    const room = loadRoom(this.sql());
    if (!room) {
      this.fail(ws, 'unavailable');
      return;
    }
    const tokenHash = await sha256Hex(record.token);
    const connected = this.ctx.getWebSockets().filter((socket) => {
      if (socket === ws) return false;
      const current = socket.deserializeAttachment() as SocketState | null;
      return current?.admitted === true;
    }).length;
    const result = helloPayload(room, tokenHash, connected, Date.now());
    if (!result.ok) {
      ws.send(JSON.stringify(result.payload));
      ws.close(1008, result.code);
      return;
    }
    const next: SocketState = { admitted: true, credential: result.credential, stamps: [] };
    ws.serializeAttachment(next);
    ws.send(JSON.stringify(result.payload));
    this.broadcastPresence();
  }

  private async play(ws: WebSocket, state: SocketState, record: Record<string, unknown>): Promise<void> {
    const room = loadRoom(this.sql());
    if (!room) {
      this.fail(ws, 'unavailable');
      return;
    }
    const rate = allowRate(state.stamps, Date.now());
    ws.serializeAttachment({ ...state, stamps: rate.stamps });
    if (!rate.ok) {
      this.fail(ws, 'slow_down');
      return;
    }
    if (typeof record.eventId !== 'string') {
      this.fail(ws, 'not_applied');
      return;
    }
    const result = applyPlay(room, state.credential, record.eventId, record.event, Date.now());
    if (!result.ok) {
      this.fail(ws, result.code);
      return;
    }
    if (!result.duplicate) {
      try {
        insertEvent(this.sql(), result.event);
      } catch {
        this.fail(ws, 'unavailable');
        return;
      }
    }
    const payload = JSON.stringify({
      type: 'event',
      eventId: result.event.eventId,
      event: result.event.event,
      duplicate: result.duplicate,
      players: this.admittedCount(),
      log: toLog(result.record),
    });
    for (const socket of this.ctx.getWebSockets()) {
      const attached = socket.deserializeAttachment() as SocketState | null;
      if (!attached?.admitted) continue;
      socket.send(payload);
    }
  }

  private async create(request: Request): Promise<Response> {
    if (loadRoom(this.sql())) return json(409, { error: 'unavailable' });
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
    const room = loadRoom(this.sql());
    if (!room) return json(404, { error: 'unavailable' });
    const now = Date.now();
    const issued = issueInvite(
      room,
      await sha256Hex(fields.hostToken),
      fields.role,
      await sha256Hex(fields.inviteToken),
      now,
    );
    if (!issued.ok) return json(issued.code === 'spectator_not_available' ? 403 : 401, { error: issued.code, message: issued.message });
    revokePlayerInvites(this.sql(), now);
    const created = issued.record.invites.find((row) => row.revokedAt === null && !row.host);
    if (!created) return json(500, { error: 'unavailable' });
    insertInvite(this.sql(), created);
    return json(201, { role: 'player' satisfies Role, expiresAt: issued.expiresAt });
  }

  private admittedCount(): number {
    return this.ctx.getWebSockets().filter((socket) => {
      const state = socket.deserializeAttachment() as SocketState | null;
      return state?.admitted === true;
    }).length;
  }

  private broadcastPresence(): void {
    const payload = JSON.stringify({ type: 'presence', players: this.admittedCount() });
    for (const socket of this.ctx.getWebSockets()) {
      const state = socket.deserializeAttachment() as SocketState | null;
      if (!state?.admitted) continue;
      socket.send(payload);
    }
  }

  private fail(ws: WebSocket, code: string): void {
    ws.send(JSON.stringify({ type: 'error', code }));
    ws.close(1008, code.slice(0, 120));
  }
}
