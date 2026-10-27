import { describe, expect, it } from 'vitest';
import type { MatchIndex } from './match-index';
import { purgeExpiredHistory } from './retention';

function index(ids: readonly string[]): { store: MatchIndex; removed: string[] } {
  const removed: string[] = [];
  const store = {
    async expiredMatchIds() {
      return ids;
    },
    async remove(id: string) {
      removed.push(id);
    },
  } as unknown as MatchIndex;
  return { store, removed };
}

describe('history purge', () => {
  it('discards each expired room and then drops the index row', async () => {
    const { store, removed } = index(['match-a', 'match-b']);
    const discarded: string[] = [];
    const count = await purgeExpiredHistory(store, 1, async (id) => {
      discarded.push(id);
    });
    expect(count).toBe(2);
    expect(discarded).toEqual(['match-a', 'match-b']);
    expect(removed).toEqual(['match-a', 'match-b']);
  });

  it('still drops the index row when the room discard fails', async () => {
    const { store, removed } = index(['match-a']);
    const count = await purgeExpiredHistory(store, 1, async () => {
      throw new Error('gone');
    });
    expect(count).toBe(1);
    expect(removed).toEqual(['match-a']);
  });
});
