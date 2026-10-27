import { isRoomCode, parseMatchLog, replayScore, ROOM_MESSAGES, type Role } from '@padel/core';
import { corsHeaders, isAllowedOrigin } from './cors';
import { MatchRoom } from './match-room';
import { allowRate } from './rate';
import { classifyPath, matchIdFrom } from './routes';
import { randomToken } from './tokens';

export { MatchRoom };

export interface Env {
  MATCH_ROOMS: DurableObjectNamespace<MatchRoom>;
  ENVIRONMENT: string;
}

const createBuckets = new Map<string, readonly number[]>();

function clientAddress(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? 'missing';
}

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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

      if (kind === 'socket') {
        if (!isAllowedOrigin(origin, environment)) return error(403, 'origin', origin, environment);
        return openSocket(request, env, url.pathname);
      }
      if (origin && !isAllowedOrigin(origin, environment)) return error(403, 'origin', origin, environment);
      if (kind === 'create') return withCors(await createMatch(request, env), origin, environment);
      if (kind === 'invite') return withCors(await createInvite(request, env, url.pathname), origin, environment);
      return error(404, 'not_found', origin, environment);
    } catch {
      return error(500, 'unavailable', origin, environment);
    }
  },
} satisfies ExportedHandler<Env>;

async function createMatch(request: Request, env: Env): Promise<Response> {
  const address = clientAddress(request);
  if (createBuckets.size > 1000) createBuckets.clear();
  const rate = allowRate(createBuckets.get(address) ?? [], Date.now(), 20, 60_000);
  createBuckets.set(address, rate.stamps);
  if (!rate.ok) return Response.json({ error: 'slow_down', message: ROOM_MESSAGES.slow_down }, { status: 429 });

  const body = await readJson(request, 96_000);
  if (!body || typeof body !== 'object') return Response.json({ error: 'invalid_match' }, { status: 400 });
  const log = parseMatchLog((body as { log?: unknown }).log);
  if (!log) return Response.json({ error: 'invalid_match' }, { status: 400 });
  const matchId = replayScore(log.base, log.events).matchId;
  const hostToken = randomToken();
  const stub = env.MATCH_ROOMS.get(env.MATCH_ROOMS.idFromName(matchId));
  const stored = await stub.fetch('https://match.internal/create', {
    method: 'POST',
    body: JSON.stringify({ log, hostToken }),
  });
  if (!stored.ok) return pass(stored);
  const payload = (await stored.json()) as { expiresAt?: number };
  return Response.json(
    { matchId, hostToken, expiresAt: payload.expiresAt ?? null, protocol: 1 },
    { status: 201, headers: { 'cache-control': 'no-store' } },
  );
}

async function createInvite(request: Request, env: Env, pathname: string): Promise<Response> {
  const matchId = matchIdFrom(pathname);
  const hostToken = bearer(request);
  if (!matchId || !hostToken) return Response.json({ error: 'bad_token', message: ROOM_MESSAGES.bad_token }, { status: 401 });
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

function openSocket(request: Request, env: Env, pathname: string): Response | Promise<Response> {
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    return Response.json({ error: 'upgrade_required', message: ROOM_MESSAGES.upgrade_required }, { status: 426 });
  }
  const matchId = matchIdFrom(pathname);
  if (!matchId) return Response.json({ error: 'not_found' }, { status: 404 });
  const stub = env.MATCH_ROOMS.get(env.MATCH_ROOMS.idFromName(matchId));
  return stub.fetch(request);
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
