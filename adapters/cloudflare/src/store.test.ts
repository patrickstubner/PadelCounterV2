import { describe, expect, it } from 'vitest';
import { loadRoom, openRoomForCreate, readRoom, type RoomSql } from './store';

function memory(): { sql: RoomSql; queries: string[] } {
  const queries: string[] = [];
  const tables = new Set<string>();
  return {
    queries,
    sql: {
      exec(query: string) {
        queries.push(query);
        if (query.startsWith('CREATE TABLE')) {
          const name = /CREATE TABLE IF NOT EXISTS (\w+)/.exec(query)?.[1];
          if (name) tables.add(name);
          return { toArray: () => [] };
        }
        if (!tables.has('meta')) throw new Error('no such table: meta');
        return { toArray: () => [] };
      },
    },
  };
}

describe('sqlite tables', () => {
  it('does not create tables when a room is only read', () => {
    const { sql, queries } = memory();
    expect(readRoom(sql)).toBeNull();
    expect(queries.some((query) => query.startsWith('CREATE'))).toBe(false);
  });

  it('creates tables when a match is created', () => {
    const { sql, queries } = memory();
    expect(openRoomForCreate(sql)).toBeNull();
    expect(queries.filter((query) => query.startsWith('CREATE TABLE'))).toHaveLength(6);
    expect(loadRoom(sql)).toBeNull();
  });
});
