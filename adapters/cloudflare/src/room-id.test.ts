import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveRoomMatchId } from './room-id';

const STORED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const UPPER = 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB';

describe('resolveRoomMatchId', () => {
  it('ignores a name that is not a uuid and uses the stored id', () => {
    expect(resolveRoomMatchId('not-a-uuid', STORED)).toBe(STORED);
    expect(resolveRoomMatchId('not-a-uuid', null)).toBeNull();
  });

  it('returns a lowercase id from the name or from the stored id', () => {
    expect(resolveRoomMatchId(UPPER, null)).toBe(UPPER.toLowerCase());
    expect(resolveRoomMatchId(undefined, UPPER)).toBe(UPPER.toLowerCase());
  });

  it('uses the stored id when the object name is missing', () => {
    expect(resolveRoomMatchId(undefined, STORED)).toBe(STORED);
    expect(resolveRoomMatchId('', STORED)).toBe(STORED);
  });

  it('prefers a uuid object name over a different stored id', () => {
    expect(resolveRoomMatchId(UPPER, STORED)).toBe(UPPER.toLowerCase());
  });
});

describe('room id fallback in the durable object', () => {
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'match-room.ts'), 'utf8');

  it('checks the room id before End match is stored and retries a revoke', () => {
    const guard = source.indexOf("result.event.event.type === 'match/end' && this.durableMatchId() === null");
    const insertAt = source.indexOf('insertEvent(sql, result.event)');
    const retry = source.indexOf("} else if (result.event.event.type === 'match/end')");
    expect(guard).toBeGreaterThan(0);
    expect(insertAt).toBeGreaterThan(guard);
    expect(retry).toBeGreaterThan(insertAt);
    expect(source.slice(retry, retry + 300)).toContain('revokeSharedRoom');
    expect(source).not.toContain("throw new Error('room')");
    const method = source.slice(source.indexOf('private durableMatchId'), source.indexOf('async fetch'));
    expect(method).toContain('resolveRoomMatchId');
    expect(method).not.toContain('base.matchId');
    const activityAt = source.indexOf('if (last !== null && shouldTouchActivity');
    const activity = source.slice(activityAt, source.indexOf('private sendTail'));
    expect(activity.match(/markActivityTouch\(sql, last\)/g)).toHaveLength(2);
  });
});
