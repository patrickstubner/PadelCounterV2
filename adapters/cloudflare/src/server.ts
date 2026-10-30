import {
  HOST_TOKEN_TTL_MS,
  JOIN_TOKEN_TTL_MS,
  LIVE_PROTOCOL,
  ROOM_MESSAGES,
  assignMatchId,
  joinCodeCompact,
  joinWindow,
  networkPrefix,
  parseLiveTeamName,
  prepareLiveLog,
  replayScore,
  carryDeviceIds,
  createMatchId,
  isDeviceId,
  isJoinToken,
  isRoomCode,
  normalizeJoinCode,
  parseMatchLog,
  quotaDay,
  randomJoinCode,
  type Role,
} from '@padel/core';
import { corsHeaders, isAllowedOrigin } from './cors';
import { clientAddress, clientIpHeaders, d1MatchIndex, isIdConflict, type D1Like, type MatchIndex } from './match-index';
import { takeJoinFailure, takeMatchRoute } from './rate';
import { classifyPath, limitsMatchRoute, matchIdFrom, ticketFrom } from './routes';
import { quotaMac, quotaSecret, randomToken, safeEqualHex, sha256Hex } from './tokens';

export interface RoomNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(input: Request | string, init?: RequestInit): Promise<Response> };
}

/** Workers Rate Limiting binding. The real type is `RateLimit` from workers-types. */
export interface RequestLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface ServerEnv {
  MATCH_ROOMS: RoomNamespace;
  ENVIRONMENT: string;
  DB: D1Like;
  /** Wrangler secret. HMAC key for the daily create counters and the rate-limit key. */
  QUOTA_HMAC_KEY?: string;
  /** `[[ratelimits]]` binding `REQUEST_LIMIT`. Missing means the worker is not configured. */
  REQUEST_LIMIT?: RequestLimit;
}

const routeBuckets = new Map<string, readonly number[]>();
const joinFailureBuckets = new Map<string, readonly number[]>();

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
        Response.json({ ok: true, service: 'padel-counter', protocol: LIVE_PROTOCOL }),
        origin,
        environment,
      );
    }
    if (kind === 'auth') return error(501, 'not_available', origin, environment);
    if (kind === 'none') return error(404, 'not_found', origin, environment);
    if (origin && !isAllowedOrigin(origin, environment)) return error(403, 'origin', origin, environment);
    if (kind === 'socket' && !isAllowedOrigin(origin, environment)) return error(403, 'origin', origin, environment);
    if (limitsMatchRoute(kind)) {
      const blocked = await enforceMatchRouteLimit(request, env, origin, environment);
      if (blocked) return blocked;
    }

    if (kind === 'socket') return openSocket(request, env, url.pathname);
    if (kind === 'ticket') return withCors(await mintTicket(request, env), origin, environment);
    if (kind === 'create') return withCors(await createMatch(request, env), origin, environment);
    if (kind === 'invite') return withCors(await createInvite(request, env, url.pathname), origin, environment);
    if (kind === 'carry') return withCors(await carryPlayers(request, env, url.pathname), origin, environment);
    return error(404, 'not_found', origin, environment);
  } catch {
    return error(500, 'unavailable', origin, environment);
  }
}

const CREATE_ATTEMPTS = 3;
const TICKET_TTL_MS = 30_000;
/** Fixed scope so the binding's own 60 second window can accumulate. A minute in the MAC would reset the key. */
const RATE_LIMIT_SCOPE = 'binding';

async function enforceMatchRouteLimit(
  request: Request,
  env: ServerEnv,
  origin: string | null,
  environment: string,
): Promise<Response | null> {
  const secret = quotaSecret(env.QUOTA_HMAC_KEY);
  const limiter = env.REQUEST_LIMIT;
  if (!secret || !limiter) return error(503, 'not_configured', origin, environment);
  const key = await quotaMac(secret, 'rate-ip', clientAddress(request), RATE_LIMIT_SCOPE);
  const outcome = await limiter.limit({ key });
  if (!outcome.success) return error(429, 'slow_down', origin, environment);
  if (!takeMatchRoute(routeBuckets, clientAddress(request), Date.now())) {
    return error(429, 'slow_down', origin, environment);
  }
  return null;
}

async function createMatch(request: Request, env: ServerEnv): Promise<Response> {
  const body = await readJson(request, 96_000);
  if (!body || typeof body !== 'object') return Response.json({ error: 'invalid_match' }, { status: 400 });
  const record = body as { log?: unknown; device?: unknown; previousHostToken?: unknown; carry?: unknown };
  const parsed = parseMatchLog(record.log);
  if (!parsed) return Response.json({ error: 'invalid_match' }, { status: 400 });
  const settled = prepareLiveLog(parsed);
  const played = replayScore(settled.base, settled.events);
  if (parseLiveTeamName(played.teams.a.name) !== played.teams.a.name || parseLiveTeamName(played.teams.b.name) !== played.teams.b.name) {
    return Response.json({ error: 'invalid_match' }, { status: 400 });
  }
  if (!isDeviceId(record.device)) {
    return Response.json({ error: 'invalid_match' }, { status: 400 });
  }
  const secret = quotaSecret(env.QUOTA_HMAC_KEY);
  if (!secret) return Response.json({ error: 'not_configured', message: ROOM_MESSAGES.not_configured }, { status: 503 });
  const index = d1MatchIndex(env.DB);
  const now = Date.now();
  const day = quotaDay(now);
  const deviceHash = await quotaMac(secret, 'device', record.device, day);
  const ipHash = await quotaMac(secret, 'ip', clientAddress(request), day);
  const quota = await index.takeCreateQuota(deviceHash, ipHash, now);
  if (!quota.ok) {
    const code = quota.reason === 'network' ? 'network_daily_limit' : 'device_daily_limit';
    return Response.json({ error: code, message: ROOM_MESSAGES[code] }, { status: 429 });
  }
  const release = () => index.releaseCreateQuota(deviceHash, ipHash, now);
  let lastConflict = false;
  for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt += 1) {
    const matchId = createMatchId();
    const log = assignMatchId(settled, matchId);
    if (!log) {
      await release();
      return Response.json({ error: 'invalid_match' }, { status: 400 });
    }
    const hostToken = randomToken();
    const hostHash = await sha256Hex(hostToken);
    const expiresAt = now + HOST_TOKEN_TTL_MS;
    try {
      await index.insert(matchId, now);
      lastConflict = false;
    } catch (error) {
      if (isIdConflict(error) && attempt < CREATE_ATTEMPTS - 1) {
        lastConflict = true;
        continue;
      }
      await release();
      throw error;
    }
    const stub = env.MATCH_ROOMS.get(env.MATCH_ROOMS.idFromName(matchId));
    try {
      await index.insertCredential({ tokenHash: hostHash, matchId, host: true, expiresAt, revokedAt: null });
      const stored = await stub.fetch('https://match.internal/create', {
        method: 'POST',
        body: JSON.stringify({ log, hostToken }),
      });
      if (!stored.ok) {
        await discardMatch(index, stub, matchId);
        await release();
        return pass(stored);
      }
      const payload = (await stored.json()) as { expiresAt?: number };
      const reconnect = await reconnectOffer(env, index, record.previousHostToken, now);
      return Response.json(
        {
          matchId,
          hostToken,
          expiresAt: payload.expiresAt ?? expiresAt,
          protocol: LIVE_PROTOCOL,
          reconnectOffered: reconnect.offered,
          reconnectPlayers: reconnect.players,
        },
        { status: 201, headers: { 'cache-control': 'no-store' } },
      );
    } catch (error) {
      await discardMatch(index, stub, matchId);
      if (isIdConflict(error) && attempt < CREATE_ATTEMPTS - 1) continue;
      await release();
      throw error;
    }
  }
  await release();
  void lastConflict;
  return Response.json({ error: 'unavailable' }, { status: 500 });
}

async function reconnectOffer(
  env: ServerEnv,
  index: MatchIndex,
  previousHostToken: unknown,
  now: number,
): Promise<{ offered: boolean; players: number }> {
  if (!isJoinToken(previousHostToken)) return { offered: false, players: 0 };
  try {
    const previous = await index.findCredential(await sha256Hex(previousHostToken));
    if (!previous || previous.revokedAt !== null || now >= previous.expiresAt) {
      return { offered: false, players: 0 };
    }
    const info = await roomInfo(env, previous.matchId, previousHostToken);
    if (!info) return { offered: false, players: 0 };
    const players = carryDeviceIds({
      confirm: true,
      memberInitiated: true,
      members: info.members,
    });
    return { offered: players.length > 0, players: players.length };
  } catch {
    return { offered: false, players: 0 };
  }
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
  const memberToken = bearer(request);
  if (!matchId || !memberToken) return Response.json({ error: 'bad_token', message: ROOM_MESSAGES.bad_token }, { status: 401 });
  const index = d1MatchIndex(env.DB);
  if (!(await index.find(matchId))) return Response.json({ error: 'not_found' }, { status: 404 });
  const body = await readJson(request, 1000);
  const role = body && typeof body === 'object' && (body as { role?: unknown }).role;
  const rotate = Boolean(body && typeof body === 'object' && (body as { rotate?: unknown }).rotate === true);
  if (role !== 'player' && role !== 'spectator') return Response.json({ error: 'invalid_match' }, { status: 400 });
  const now = Date.now();
  const credential = await index.findCredential(await sha256Hex(memberToken));
  if (!credential || credential.matchId !== matchId || credential.revokedAt !== null || now >= credential.expiresAt) {
    return Response.json({ error: 'bad_token', message: ROOM_MESSAGES.bad_token }, { status: 401 });
  }
  const secret = quotaSecret(env.QUOTA_HMAC_KEY);
  if (!secret) return Response.json({ error: 'not_configured', message: ROOM_MESSAGES.not_configured }, { status: 503 });
  const inviteToken = randomToken();
  const code = randomJoinCode();
  const stub = env.MATCH_ROOMS.get(env.MATCH_ROOMS.idFromName(matchId));
  const stored = await stub.fetch('https://match.internal/invite', {
    method: 'POST',
    body: JSON.stringify({ memberToken, inviteToken, role: role satisfies Role, rotate, code }),
  });
  if (!stored.ok) return pass(stored);
  const payload = (await stored.json()) as {
    expiresAt?: number;
    reuse?: unknown;
    token?: unknown;
    code?: unknown;
    keepHash?: unknown;
    sessionToken?: unknown;
    sessionDevice?: unknown;
    sessionExpiresAt?: unknown;
  };
  if (payload.reuse === true && isJoinToken(payload.token)) {
    const reusedCode = typeof payload.code === 'string' ? payload.code : null;
    return Response.json(
      {
        matchId,
        token: payload.token,
        role: 'player',
        expiresAt: payload.expiresAt ?? now + JOIN_TOKEN_TTL_MS,
        ...(reusedCode ? { code: reusedCode } : {}),
      },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  }
  const expiresAt = payload.expiresAt ?? now + JOIN_TOKEN_TTL_MS;
  const inviteHash = await sha256Hex(inviteToken);
  const kept = typeof payload.keepHash === 'string' && /^[0-9a-f]{64}$/.test(payload.keepHash) ? payload.keepHash : undefined;
  await index.replacePlayerCredential(matchId, now, {
    tokenHash: inviteHash,
    matchId,
    host: false,
    expiresAt,
    revokedAt: null,
  }, kept, !rotate);
  if (isJoinToken(payload.sessionToken) && isDeviceId(payload.sessionDevice)) {
    await index.insertCredential({
      tokenHash: await sha256Hex(payload.sessionToken),
      matchId,
      host: false,
      expiresAt: typeof payload.sessionExpiresAt === 'number' ? payload.sessionExpiresAt : expiresAt,
      revokedAt: null,
      deviceId: payload.sessionDevice,
    });
  }
  let savedCode: string | null = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const next = attempt === 0 ? code : randomJoinCode();
    try {
      await index.putJoinCode(matchId, now, {
        codeHash: await quotaMac(secret, 'join-code', joinCodeCompact(next), 'code'),
        matchId,
        tokenHash: inviteHash,
        expiresAt,
        revokedAt: null,
      });
      savedCode = next;
      break;
    } catch (error) {
      if (!isIdConflict(error) || attempt === 4) throw error;
    }
  }
  try {
    await index.deleteRevokedAccess(matchId);
  } catch {
    // The new code is already stored. Old rows can wait for the next purge.
  }
  if (savedCode && savedCode !== code) {
    await stub.fetch('https://match.internal/invite', {
      method: 'POST',
      body: JSON.stringify({ memberToken: inviteToken, inviteToken, role: 'player', reseal: true, code: savedCode }),
    });
  }
  return Response.json(
    {
      matchId,
      token: inviteToken,
      role: 'player',
      expiresAt,
      ...(savedCode ? { code: savedCode } : {}),
      ...(isJoinToken(payload.sessionToken) ? { sessionToken: payload.sessionToken } : {}),
    },
    { status: 201, headers: { 'cache-control': 'no-store' } },
  );
}

interface RoomInfo {
  readonly lastChangeAt: number;
  readonly members: readonly { readonly deviceId: string; readonly connected: boolean }[];
}

async function roomInfo(env: ServerEnv, matchId: string, hostToken: string): Promise<RoomInfo | null> {
  const stub = env.MATCH_ROOMS.get(env.MATCH_ROOMS.idFromName(matchId));
  const response = await stub.fetch('https://match.internal/reconnect-info', {
    method: 'POST',
    body: JSON.stringify({ hostToken }),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as Partial<RoomInfo>;
  if (typeof body.lastChangeAt !== 'number' || !Array.isArray(body.members)) return null;
  return {
    lastChangeAt: body.lastChangeAt,
    members: body.members.flatMap((row) => {
      if (!row || typeof row !== 'object') return [];
      const member = row as { deviceId?: unknown; connected?: unknown };
      if (typeof member.deviceId !== 'string' || typeof member.connected !== 'boolean') return [];
      return [{ deviceId: member.deviceId, connected: member.connected }];
    }),
  };
}

async function mintTicket(request: Request, env: ServerEnv): Promise<Response> {
  const body = await readJson(request, 1000);
  const device = body && typeof body === 'object' ? (body as { device?: unknown }).device : undefined;
  if (!isDeviceId(device)) {
    return Response.json({ error: 'invalid_device', message: ROOM_MESSAGES.invalid_device }, { status: 400 });
  }
  const rawCode = body && typeof body === 'object' ? (body as { code?: unknown }).code : undefined;
  if (typeof rawCode === 'string' && !bearer(request)) return redeemJoinCode(request, env, device, rawCode);
  const secret = quotaSecret(env.QUOTA_HMAC_KEY);
  if (!secret) return Response.json({ error: 'not_configured', message: ROOM_MESSAGES.not_configured }, { status: 503 });
  const index = d1MatchIndex(env.DB);
  const now = Date.now();
  const window = joinWindow(now);
  const token = bearer(request);
  const credential = token ? await index.findCredential(await sha256Hex(token)) : null;
  const credentialOk = Boolean(credential && credential.revokedAt === null && now < credential.expiresAt);
  const matchOk = credentialOk && credential ? await index.find(credential.matchId) : false;
  if (!credentialOk || !matchOk || !credential) {
    if (!takeJoinFailure(joinFailureBuckets, clientAddress(request), now)) {
      return Response.json({ error: 'slow_down', message: ROOM_MESSAGES.slow_down }, { status: 429 });
    }
    const ipHash = await quotaMac(secret, 'join-ip', clientAddress(request), String(window));
    const networkQuota = await index.noteJoinFailure(ipHash, now);
    if (!networkQuota.ok) {
      return Response.json(
        { error: 'join_network_limit', message: ROOM_MESSAGES.join_network_limit },
        { status: 429 },
      );
    }
    if (!token || !credential || credential.revokedAt !== null || now >= credential.expiresAt) {
      return Response.json({ error: 'bad_token', message: ROOM_MESSAGES.bad_token }, { status: 401 });
    }
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  const deviceHash = await quotaMac(secret, 'join-device', device, String(window));
  const deviceQuota = await index.takeJoinDevice(deviceHash, now);
  if (!deviceQuota.ok) {
    return Response.json(
      { error: 'join_device_limit', message: ROOM_MESSAGES.join_device_limit },
      { status: 429 },
    );
  }
  if (!credential.host && !credential.deviceId) return bindSharedJoin(env, index, credential, device, now);
  const ticket = randomToken();
  await index.putTicket(await sha256Hex(ticket), credential.matchId, now + TICKET_TTL_MS);
  return Response.json({ ticket, expiresAt: now + TICKET_TTL_MS }, { status: 201, headers: { 'cache-control': 'no-store' } });
}

/** A scanned QR becomes this phone's own credential. The shared code stays for showing. */
async function bindSharedJoin(
  env: ServerEnv,
  index: MatchIndex,
  credential: { matchId: string; expiresAt: number },
  device: string,
  now: number,
): Promise<Response> {
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const stub = env.MATCH_ROOMS.get(env.MATCH_ROOMS.idFromName(credential.matchId));
  const added = await stub.fetch('https://match.internal/player-invite', {
    method: 'POST',
    body: JSON.stringify({ token, deviceId: device, expiresAt: credential.expiresAt }),
  });
  if (added.status === 409) return joinCodeRejected();
  if (!added.ok) return Response.json({ error: 'unavailable' }, { status: 503 });
  const minted = await readMintGrant(added);
  const claimed = await index.claimMinted({
    tokenHash,
    matchId: credential.matchId,
    host: false,
    expiresAt: credential.expiresAt,
    revokedAt: null,
    deviceId: device,
  }, now);
  if (!claimed) {
    await stub.fetch('https://match.internal/revoke-minted', {
      method: 'POST',
      body: JSON.stringify({ tokenHash, restore: minted.replaced, revokedAt: minted.revokedAt }),
    });
    return joinCodeRejected();
  }
  const ticket = randomToken();
  const ticketExpiresAt = now + TICKET_TTL_MS;
  await index.putTicket(await sha256Hex(ticket), credential.matchId, ticketExpiresAt);
  return Response.json(
    { token, expiresAt: credential.expiresAt, ticket, ticketExpiresAt },
    { status: 201, headers: { 'cache-control': 'no-store' } },
  );
}

function joinCodeRejected(): Response {
  return Response.json(
    { error: 'join_code', message: ROOM_MESSAGES.join_code },
    { status: 401, headers: { 'cache-control': 'no-store' } },
  );
}

async function readMintGrant(response: Response): Promise<{ replaced: readonly string[]; revokedAt: number }> {
  try {
    const body = (await response.json()) as { replaced?: unknown; revokedAt?: unknown };
    const replaced = Array.isArray(body.replaced)
      ? body.replaced.filter((hash): hash is string => typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash)).slice(0, 8)
      : [];
    const revokedAt = typeof body.revokedAt === 'number' && Number.isInteger(body.revokedAt) ? body.revokedAt : 0;
    return { replaced, revokedAt };
  } catch {
    return { replaced: [], revokedAt: 0 };
  }
}

function codeLimited(): Response {
  return Response.json(
    { error: 'code_limited', message: ROOM_MESSAGES.code_limited },
    { status: 429, headers: { 'cache-control': 'no-store' } },
  );
}

const CODE_ALARM_LOG = 'short code attempts recorded';

async function redeemJoinCode(request: Request, env: ServerEnv, device: string, rawCode: string): Promise<Response> {
  const secret = quotaSecret(env.QUOTA_HMAC_KEY);
  if (!secret) return Response.json({ error: 'not_configured', message: ROOM_MESSAGES.not_configured }, { status: 503 });
  const index = d1MatchIndex(env.DB);
  const now = Date.now();
  const window = String(joinWindow(now));
  const prefix = networkPrefix(clientAddress(request));
  const ipHash = await quotaMac(secret, 'code-ip', prefix, window);
  const attempt = await index.takeCodeAttempt(ipHash, now);
  const alarmed = await index.noteCodeAlarm(await quotaMac(secret, 'code-global', 'all', window), now);
  if (alarmed) console.log(CODE_ALARM_LOG);
  if (!attempt.ok) return codeLimited();
  const normalized = normalizeJoinCode(rawCode);
  const codeHash = await quotaMac(secret, 'join-code', normalized ? joinCodeCompact(normalized) : 'invalid', 'code');
  const row = normalized ? await index.findJoinCode(codeHash) : null;
  const codeMatches = safeEqualHex(row?.codeHash ?? '0'.repeat(64), codeHash);
  const credential = row && codeMatches ? await index.findCredential(row.tokenHash) : null;
  const live = Boolean(
    credential &&
    row &&
    codeMatches &&
    !credential.host &&
    credential.revokedAt === null &&
    now < credential.expiresAt &&
    row.revokedAt === null &&
    now < row.expiresAt &&
    credential.matchId === row.matchId &&
    safeEqualHex(credential.tokenHash, row.tokenHash) &&
    (await index.find(credential.matchId)),
  );
  if (!live || !credential || !row) return joinCodeRejected();
  const deviceHash = await quotaMac(secret, 'join-device', device, window);
  const deviceQuota = await index.takeJoinDevice(deviceHash, now);
  if (!deviceQuota.ok) {
    return Response.json(
      { error: 'join_device_limit', message: ROOM_MESSAGES.join_device_limit },
      { status: 429, headers: { 'cache-control': 'no-store' } },
    );
  }
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const stub = env.MATCH_ROOMS.get(env.MATCH_ROOMS.idFromName(credential.matchId));
  const added = await stub.fetch('https://match.internal/player-invite', {
    method: 'POST',
    body: JSON.stringify({ token, deviceId: device, expiresAt: credential.expiresAt }),
  });
  if (added.status === 409) return joinCodeRejected();
  if (!added.ok) return Response.json({ error: 'unavailable' }, { status: 503 });
  const minted = await readMintGrant(added);
  const claimed = await index.claimMinted({
    tokenHash,
    matchId: credential.matchId,
    host: false,
    expiresAt: credential.expiresAt,
    revokedAt: null,
    deviceId: device,
  }, now);
  if (!claimed) {
    await stub.fetch('https://match.internal/revoke-minted', {
      method: 'POST',
      body: JSON.stringify({
        tokenHash,
        restore: minted.replaced,
        revokedAt: minted.revokedAt,
      }),
    });
    return joinCodeRejected();
  }
  const ticket = randomToken();
  const ticketExpiresAt = now + TICKET_TTL_MS;
  await index.putTicket(await sha256Hex(ticket), credential.matchId, ticketExpiresAt);
  return Response.json(
    { token, expiresAt: credential.expiresAt, ticket, ticketExpiresAt },
    { status: 201, headers: { 'cache-control': 'no-store' } },
  );
}

async function openSocket(request: Request, env: ServerEnv, pathname: string): Promise<Response> {
  const ticket = ticketFrom(pathname);
  if (!ticket) return Response.json({ error: 'not_found' }, { status: 404 });
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    return Response.json({ error: 'upgrade_required', message: ROOM_MESSAGES.upgrade_required }, { status: 426 });
  }
  const index = d1MatchIndex(env.DB);
  const matchId = await index.takeTicket(await sha256Hex(ticket), Date.now());
  if (!matchId || !(await index.find(matchId))) {
    return Response.json({ error: 'bad_token', message: ROOM_MESSAGES.bad_token }, { status: 401 });
  }
  const forwarded = new Request(request, { headers: clientIpHeaders(request) });
  const stub = env.MATCH_ROOMS.get(env.MATCH_ROOMS.idFromName(matchId));
  return stub.fetch(forwarded);
}

async function carryPlayers(request: Request, env: ServerEnv, pathname: string): Promise<Response> {
  const matchId = matchIdFrom(pathname);
  const hostToken = bearer(request);
  if (!matchId || !hostToken) return Response.json({ error: 'bad_token', message: ROOM_MESSAGES.bad_token }, { status: 401 });
  const body = await readJson(request, 2000);
  const confirm = Boolean(body && typeof body === 'object' && (body as { confirm?: unknown }).confirm === true);
  const previousHostToken = body && typeof body === 'object' ? (body as { previousHostToken?: unknown }).previousHostToken : undefined;
  if (!isJoinToken(previousHostToken)) return Response.json({ error: 'bad_token', message: ROOM_MESSAGES.bad_token }, { status: 401 });
  const index = d1MatchIndex(env.DB);
  const now = Date.now();
  const host = await index.findCredential(await sha256Hex(hostToken));
  if (!host || !host.host || host.matchId !== matchId || host.revokedAt !== null || now >= host.expiresAt) {
    return Response.json({ error: 'bad_token', message: ROOM_MESSAGES.bad_token }, { status: 401 });
  }
  const previous = await index.findCredential(await sha256Hex(previousHostToken));
  if (!previous || previous.revokedAt !== null || now >= previous.expiresAt || previous.matchId === matchId) {
    return Response.json({ error: 'bad_token', message: ROOM_MESSAGES.bad_token }, { status: 401 });
  }
  if (!confirm) return Response.json({ carried: 0, offered: true }, { status: 200 });
  const previousStub = env.MATCH_ROOMS.get(env.MATCH_ROOMS.idFromName(previous.matchId));
  const claim = await previousStub.fetch('https://match.internal/carry-claim', {
    method: 'POST',
    body: JSON.stringify({ hostToken: previousHostToken }),
  });
  if (claim.status === 429) return pass(claim);
  if (!claim.ok) return Response.json({ error: 'bad_token', message: ROOM_MESSAGES.bad_token }, { status: 401 });
  const claimed = (await claim.json()) as { starterDevice?: unknown; starterSeat?: unknown; members?: unknown };
  const starterDevice = isDeviceId(claimed.starterDevice) ? claimed.starterDevice : null;
  const starterSeat = claimed.starterSeat === 'host' || (typeof claimed.starterSeat === 'string' && /^p[1-9]\d*$/.test(claimed.starterSeat))
    ? claimed.starterSeat
    : null;
  const members = Array.isArray(claimed.members)
    ? claimed.members.flatMap((row) => {
        if (!row || typeof row !== 'object') return [];
        const member = row as { deviceId?: unknown; connected?: unknown };
        if (!isDeviceId(member.deviceId) || typeof member.connected !== 'boolean') return [];
        return [{ deviceId: member.deviceId, connected: member.connected }];
      })
    : [];
  if (!starterDevice) return Response.json({ error: 'bad_token', message: ROOM_MESSAGES.bad_token }, { status: 401 });
  const players = carryDeviceIds({
    confirm: true,
    memberInitiated: true,
    members,
    excludeDeviceId: starterDevice,
  });
  if (!confirm || players.length === 0) return Response.json({ carried: 0, offered: true }, { status: 200 });
  const offers: { deviceId: string; token: string }[] = [];
  for (const deviceId of players) {
    const token = randomToken();
    const expiresAt = now + JOIN_TOKEN_TTL_MS;
    await index.insertCredential({
      tokenHash: await sha256Hex(token),
      matchId,
      host: false,
      expiresAt,
      revokedAt: null,
      deviceId,
    });
    const stub = env.MATCH_ROOMS.get(env.MATCH_ROOMS.idFromName(matchId));
    await stub.fetch('https://match.internal/carry-invite', {
      method: 'POST',
      body: JSON.stringify({ hostToken, token, deviceId, expiresAt }),
    });
    offers.push({ deviceId, token });
  }
  const notified = await previousStub.fetch('https://match.internal/notify', {
    method: 'POST',
    body: JSON.stringify({ hostToken: previousHostToken, offers, starterDevice, seat: starterSeat }),
  });
  if (notified.status === 429) return pass(notified);
  return Response.json({ carried: offers.length, offered: true }, { status: 200, headers: { 'cache-control': 'no-store' } });
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
