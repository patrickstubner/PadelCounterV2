import { assignMatchId, createMatchId, isRoomCode, parseMatchLog, ROOM_MESSAGES, type Role } from '@padel/core';
import { corsHeaders, isAllowedOrigin } from './cors';
import { clientAddress, clientIpHeaders, d1MatchIndex, type D1Like, type MatchIndex } from './match-index';
import { takeMatchRoute } from './rate';
import { classifyPath, limitsMatchRoute, matchIdFrom } from './routes';
import { randomToken } from './tokens';

export interface RoomNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(input: Request | string, init?: RequestInit): Promise<Response> };
}

export interface ServerEnv {
  MATCH_ROOMS: RoomNamespace;
  ENVIRONMENT: string;
  DB: D1Like;
}

const routeBuckets = new Map<string, readonly number[]>();

function withCors(response: Response, origin: string | null, environment: string): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of corsHeaders(origin, environment)) headers.set(key, value);
  return new Response(response.body, { status: response.status, headers });
}

function error(status: number, code: string, origin: string | null, environment: string): Response {
  const message = isRoomCode(code) ? ROOM_MESSAGES[code] : undefined;
  const body = message ? { error: code, message } : { error: code };
  return withCors(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    }),
    origin,
    environment,
  );
}

function bearer(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer ([A-Za-z0-9_-]{22})$/.exec(header);
  return match?.[1] ?? null;
}

async function readJson(request: Request, max: number): Promise<unknown | undefined> {
  const text = await request.text();
  if (text.length === 0 || text.length > max) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export async function handleFetch(request: Request, env: ServerEnv): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  const environment = env.ENVIRONMENT || 'production';
  if (request.method === 'OPTIONS') {
    if (!isAllowedOrigin(origin, environment)) return new Response(null, { status: 403 });
    return withCors(new Response(null, { status: 204 }), origin, environment);
  }

  const kind = classifyPath(request.method, url.pathname);
  try {
    if (kind === 'health') {
      return withCors(
        Response.json({ ok: true, service: 'padel-counter', protocol: 1 }),
        origin,
        environment,
      );
    }
    if (kind === 'auth') return error(501, 'not_available', origin, environment);
    if (kind === 'none') return error(404, 'not_found', origin, environment);
    if (origin && !isAllowedOrigin(origin, environment)) return error(403, 'origin', origin, environment);
    if (kind === 'socket' && !isAllowedOrigin(origin, environment)) return error(403, 'origin', origin, environment);
    if (limitsMatchRoute(kind) && !takeMatchRoute(routeBuckets, clientAddress(request), Date.now())) {
      return error(429, 'slow_down', origin, environment);
    }

    if (kind === 'socket') return openSocket(request, env, url.pathname);
    if (kind === 'create') return withCors(await createMatch(request, env), origin, environment);
    if (kind === 'invite') return withCors(await createInvite(request, env, url.pathname), origin, environment);
    return error(404, 'not_found', origin, environment);
  } catch {
    return error(500, 'unavailable', origin, environment);
  }
}

async function createMatch(request: Request, env: ServerEnv): Promise<Response> {
  const body = await readJson(request, 96_000);
  if (!body || typeof body !== 'object') return Response.json({ error: 'invalid_match' }, { status: 400 });
  const parsed = parseMatchLog((body as { log?: unknown }).log);
  const matchId = createMatchId();
  const log = parsed ? assignMatchId(parsed, matchId) : null;
  if (!log) return Response.json({ error: 'invalid_match' }, { status: 400 });
  const hostToken = randomToken();
  const index = d1MatchIndex(env.DB);
  await index.insert(matchId, Date.now());
  const stub = env.MATCH_ROOMS.get(env.MATCH_ROOMS.idFromName(matchId));
  let stored: Response;
  try {
    stored = await stub.fetch('https://match.internal/create', {
      method: 'POST',
      body: JSON.stringify({ log, hostToken }),
    });
  } catch (error) {
    await discardMatch(index, stub, matchId);
    throw error;
  }
  if (!stored.ok) {
    await discardMatch(index, stub, matchId);
    return pass(stored);
  }
  const payload = (await stored.json()) as { expiresAt?: number };
  return Response.json(
    { matchId, hostToken, expiresAt: payload.expiresAt ?? null, protocol: 1 },
    { status: 201, headers: { 'cache-control': 'no-store' } },
  );
}

async function discardMatch(
  index: MatchIndex,
  stub: { fetch(input: Request | string, init?: RequestInit): Promise<Response> },
  matchId: string,
): Promise<void> {
  let failure: unknown;
  try {
    await index.remove(matchId);
  } catch (error) {
    failure = error;
  }
  try {
    const cleared = await stub.fetch('https://match.internal/discard', { method: 'POST' });
    if (!cleared.ok && failure === undefined) failure = new Error('discard failed');
  } catch (error) {
    if (failure === undefined) failure = error;
  }
  if (failure !== undefined) throw failure;
}

async function createInvite(request: Request, env: ServerEnv, pathname: string): Promise<Response> {
  const matchId = matchIdFrom(pathname);
  const hostToken = bearer(request);
  if (!matchId || !hostToken) return Response.json({ error: 'bad_token', message: ROOM_MESSAGES.bad_token }, { status: 401 });
  if (!(await d1MatchIndex(env.DB).find(matchId))) return Response.json({ error: 'not_found' }, { status: 404 });
  const body = await readJson(request, 1000);
  const role = body && typeof body === 'object' && (body as { role?: unknown }).role;
  if (role !== 'player' && role !== 'spectator') return Response.json({ error: 'invalid_match' }, { status: 400 });
  const inviteToken = randomToken();
  const stub = env.MATCH_ROOMS.get(env.MATCH_ROOMS.idFromName(matchId));
  const stored = await stub.fetch('https://match.internal/invite', {
    method: 'POST',
    body: JSON.stringify({ hostToken, inviteToken, role: role satisfies Role }),
  });
  if (!stored.ok) return pass(stored);
  const payload = (await stored.json()) as { expiresAt?: number };
  return Response.json(
    { matchId, token: inviteToken, role: 'player', expiresAt: payload.expiresAt ?? null },
    { status: 201, headers: { 'cache-control': 'no-store' } },
  );
}

async function openSocket(request: Request, env: ServerEnv, pathname: string): Promise<Response> {
  const matchId = matchIdFrom(pathname);
  if (!matchId) return Response.json({ error: 'not_found' }, { status: 404 });
  if (!(await d1MatchIndex(env.DB).find(matchId))) return Response.json({ error: 'not_found' }, { status: 404 });
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    return Response.json({ error: 'upgrade_required', message: ROOM_MESSAGES.upgrade_required }, { status: 426 });
  }
  const forwarded = new Request(request, { headers: clientIpHeaders(request) });
  const stub = env.MATCH_ROOMS.get(env.MATCH_ROOMS.idFromName(matchId));
  return stub.fetch(forwarded);
}

async function pass(response: Response): Promise<Response> {
  const text = await response.text();
  let body: unknown = { error: 'unavailable' };
  try {
    const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
    if (parsed && typeof parsed.error === 'string' && parsed.error.length <= 40) {
      body = isRoomCode(parsed.error)
        ? { error: parsed.error, message: ROOM_MESSAGES[parsed.error] }
        : { error: parsed.error };
    }
  } catch {
    body = { error: 'unavailable' };
  }
  return Response.json(body, { status: response.status, headers: { 'cache-control': 'no-store' } });
}
