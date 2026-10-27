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
