// Migrationen auf leerer D1 (T-06): worker-setup.ts wendet alle migrations/*.sql an.
import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

async function columns(table: string): Promise<string[]> {
  const { results } = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  return results.map((r) => r.name);
}

describe('D1-Migrationen', () => {
  it('alle Dateien sind in Reihenfolge angewendet', async () => {
    const { results } = await env.DB.prepare('SELECT name FROM d1_migrations ORDER BY id').all<{ name: string }>();
    expect(results.map((r) => r.name)).toEqual(env.TEST_MIGRATIONS.map((m) => m.name));
    expect(results.length).toBeGreaterThanOrEqual(8);
  });

  it('erwartete Tabellen und additive Spalten existieren', async () => {
    const { results } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>();
    const tables = results.map((r) => r.name);
    for (const t of ['matches', 'create_quota', 'credentials', 'tickets', 'join_quota', 'join_codes']) expect(tables).toContain(t);
    expect(tables).not.toContain('create_quota_next');
    expect(await columns('credentials')).toEqual(expect.arrayContaining(['device_id', 'admitted', 'revoke_reason']));
  });

  it('erneutes Anwenden ist ohne Wirkung', async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
    const { results } = await env.DB.prepare('SELECT COUNT(*) AS n FROM d1_migrations').all<{ n: number }>();
    expect(results[0]?.n).toBe(env.TEST_MIGRATIONS.length);
  });
});
