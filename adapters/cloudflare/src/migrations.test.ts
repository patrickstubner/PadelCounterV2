import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../scripts/check-migrations.mjs', import.meta.url));
const run = (dir?: string) => spawnSync(process.execPath, dir ? [script, dir] : [script], { encoding: 'utf8' });

describe('Migrations-Lint (T-06)', () => {
  const temp: string[] = [];
  const dirWith = (files: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), 'mig-'));
    temp.push(dir);
    for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql);
    return dir;
  };
  afterEach(() => {
    for (const dir of temp.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('die echten Migrationen bestehen', () => {
    const result = run();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('DROP ohne ADR-Verweis schlägt fehl, mit Verweis nicht, im Kommentar zählt nicht', () => {
    expect(run(dirWith({ '0001_a.sql': 'CREATE TABLE t (x);', '0002_b.sql': 'DROP TABLE t;' })).status).toBe(1);
    expect(run(dirWith({ '0001_a.sql': 'CREATE TABLE t (x);', '0002_b.sql': '-- ADR-005\nDROP TABLE t;' })).status).toBe(0);
    expect(run(dirWith({ '0001_a.sql': '-- früher: DROP TABLE alt\nCREATE TABLE t (x);' })).status).toBe(0);
  });

  it('RENAME COLUMN, Lücke in der Nummerierung und falscher Name schlagen fehl', () => {
    expect(run(dirWith({ '0001_a.sql': 'ALTER TABLE t RENAME COLUMN a TO b;' })).status).toBe(1);
    expect(run(dirWith({ '0001_a.sql': 'SELECT 1;', '0003_c.sql': 'SELECT 1;' })).status).toBe(1);
    expect(run(dirWith({ '1_a.sql': 'SELECT 1;' })).status).toBe(1);
  });
});
