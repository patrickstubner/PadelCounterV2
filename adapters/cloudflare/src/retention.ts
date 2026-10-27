import type { MatchIndex } from './match-index';

/** Deletes quota rows older than two days and expired tickets, then history older than two years. */
export async function purgeExpiredHistory(
  index: MatchIndex,
  now: number,
  discard: (id: string) => Promise<void>,
): Promise<number> {
  await index.purgeEphemeral(now);
  const ids = await index.expiredMatchIds(now);
  for (const id of ids) {
    try {
      await discard(id);
    } catch {
      // The index row still has to go. An empty object can be removed later.
    }
    await index.remove(id);
  }
  return ids.length;
}
