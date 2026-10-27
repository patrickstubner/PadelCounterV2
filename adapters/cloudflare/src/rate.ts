/** Every `/matches*` request shares this budget. It is per isolate, not a global edge rule. */
export const MATCH_ROUTE_LIMIT = 20;
export const MATCH_ROUTE_WINDOW_MS = 60_000;

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
  if (buckets.size > 1000) buckets.clear();
  const next = allowRate(buckets.get(ip) ?? [], now, MATCH_ROUTE_LIMIT, MATCH_ROUTE_WINDOW_MS);
  buckets.set(ip, next.stamps);
  return next.ok;
}

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
