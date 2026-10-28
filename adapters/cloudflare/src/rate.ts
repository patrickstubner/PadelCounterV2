/** Create, invite, carry, POST /join, and the websocket upgrade share this budget. It is per isolate. The Workers rate-limit binding runs first, and the D1 join counters run after that. */
export const MATCH_ROUTE_LIMIT = 20;
export const MATCH_ROUTE_WINDOW_MS = 60_000;

/**
 * Failed POST /join attempts per address inside one isolate. Lower than MATCH_ROUTE_LIMIT so a bad
 * token stops writing D1 before the shared route budget is full. A successful join does not use it.
 */
export const JOIN_FAILURE_LIMIT = 5;

/** Best-effort limiter. The isolate map resets when the isolate dies; the match cap does not. */
export function allowRate(
  stamps: readonly number[],
  now: number,
  limit = 10,
  windowMs = 1000,
): { readonly ok: boolean; readonly stamps: readonly number[] } {
  const recent = stamps.filter((stamp) => now - stamp < windowMs && now - stamp >= 0);
  if (recent.length >= limit) return { ok: false, stamps: recent };
  return { ok: true, stamps: [...recent, now] };
}

export function takeMatchRoute(
  buckets: Map<string, readonly number[]>,
  ip: string,
  now: number,
): boolean {
  return takeBucket(buckets, ip, now, MATCH_ROUTE_LIMIT);
}

/** Counts a rejected POST /join. When this returns false the caller must not write D1. */
export function takeJoinFailure(
  buckets: Map<string, readonly number[]>,
  ip: string,
  now: number,
): boolean {
  return takeBucket(buckets, ip, now, JOIN_FAILURE_LIMIT);
}

function takeBucket(
  buckets: Map<string, readonly number[]>,
  ip: string,
  now: number,
  limit: number,
): boolean {
  if (buckets.size > 1000) buckets.clear();
  const next = allowRate(buckets.get(ip) ?? [], now, limit, MATCH_ROUTE_WINDOW_MS);
  buckets.set(ip, next.stamps);
  return next.ok;
}

/** Renames are a few per second on one connection, separate from scoring. */
export const RENAME_PER_SECOND = 3;

/** Pings and scoring events share one per-socket budget. */
export function takeLiveMessage(
  stamps: readonly number[],
  type: unknown,
  now: number,
):
  | { readonly ok: true; readonly command: 'ping' | 'event'; readonly stamps: readonly number[] }
  | { readonly ok: false; readonly code: 'slow_down' | 'not_applied'; readonly stamps: readonly number[] } {
  const charged = allowRate(stamps, now);
  if (!charged.ok) return { ok: false, code: 'slow_down', stamps: charged.stamps };
  if (type === 'ping') return { ok: true, command: 'ping', stamps: charged.stamps };
  if (type === 'event') return { ok: true, command: 'event', stamps: charged.stamps };
  return { ok: false, code: 'not_applied', stamps: charged.stamps };
}
