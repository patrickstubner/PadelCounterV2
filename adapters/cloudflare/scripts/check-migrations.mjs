#!/usr/bin/env node
// Migrations-Lint (Testplan T-06, AGENTS.md «D1-Migrationen nur additiv»):
// - Dateinamen NNNN_name.sql, lückenlos ab 0001
// - DROP oder RENAME nur mit ADR-Verweis («-- ADR-123») in derselben Datei
// Aufruf: node scripts/check-migrations.mjs [ordner]. Liest nur Dateien, schreibt nichts.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Vor Einführung der Regel gemergt und in Staging/Prod angewendet (Umbau create_quota, 0003).
const GRANDFATHERED = new Set(['0003_quota_cap.sql']);
const DESTRUCTIVE = /\b(DROP\s+(TABLE|COLUMN|INDEX|VIEW|TRIGGER)|RENAME\s+(TO|COLUMN))\b/i;

export function checkMigrations(dir) {
  const errors = [];
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  files.forEach((file, index) => {
    const match = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(file);
    if (!match) {
      errors.push(`${file}: Name muss NNNN_name.sql sein`);
      return;
    }
    if (Number(match[1]) !== index + 1) errors.push(`${file}: Nummer ${match[1]} erwartet ${String(index + 1).padStart(4, '0')}`);
    const text = readFileSync(join(dir, file), 'utf8');
    const code = text.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    if (DESTRUCTIVE.test(code) && !/--\s*ADR-\d{3}/.test(text) && !GRANDFATHERED.has(file)) {
      errors.push(`${file}: DROP/RENAME nur mit ADR-Verweis (-- ADR-NNN), Migrationen sind additiv (expand/contract)`);
    }
  });
  return { files, errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] ?? join(import.meta.dirname, '..', 'migrations');
  const { files, errors } = checkMigrations(dir);
  for (const e of errors) console.error(`check-migrations: ${e}`);
  if (errors.length) process.exit(1);
  console.log(`check-migrations: ok (${files.length} Dateien)`);
}
