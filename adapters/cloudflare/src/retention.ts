import type { MatchIndex } from './match-index';

/** Deletes D1 history older than two years and asks the room to drop its storage. */
export async function purgeExpiredHistory(
  index: MatchIndex,
  now: number,
  discard: (id: string) => Promise<void>,
): Promise<number> {
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
