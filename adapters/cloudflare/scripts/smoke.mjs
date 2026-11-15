#!/usr/bin/env node
/* global Buffer, setTimeout */
// Smoke-Test nach einem Deploy (ADR-002, Testplan T-08). Keine Abhängigkeiten, keine Schreibzugriffe:
//  1. GET /health → 200, ok, protocol === LIVE_PROTOCOL
//  2. GET /ws/<zufälliges Ticket> ohne Upgrade → 426 upgrade_required (alte App ohne WebSocket)
//  3. GET /ws/<zufälliges Ticket> mit Upgrade → 401 bad_token (unbekanntes Ticket, nichts wird angelegt)
//  4. optional SMOKE_PAGES_URL: version.json → protocol === LIVE_PROTOCOL, commit === SMOKE_EXPECT_COMMIT
// Umgebung: SMOKE_BASE_URL (Worker), SMOKE_PAGES_URL (optional), SMOKE_EXPECT_COMMIT (optional),
// SMOKE_RETRIES (Versuche im Abstand von 10 s, Standard 1, höchstens 10).
// Ein voller Hello mit LIVE_PROTOCOL-1 braucht ein Ticket, also ein neues Match. Das prüft der
// Worker-Test (live.worker.test.ts) in der CI, nicht der Smoke-Test.
import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const here = import.meta.dirname;
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 10_000);

function constantFrom(file, pattern, label) {
  const match = pattern.exec(readFileSync(file, 'utf8'));
  if (!match) throw new Error(`${label} nicht gefunden`);
  return match[1];
}

export const LIVE_PROTOCOL = Number(
  constantFrom(join(here, '../../../packages/core/src/messages.ts'), /export const LIVE_PROTOCOL = (\d+);/, 'LIVE_PROTOCOL'),
);
export const PAGES_ORIGIN = constantFrom(join(here, '../src/cors.ts'), /const PAGES_ORIGIN = '([^']+)';/, 'PAGES_ORIGIN');

/** Nur https, ausser lokal für Tests. Keine Zugangsdaten, kein Pfad ausser «/». */
export function checkBaseUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const local = url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
  if (url.protocol !== 'https:' && !local) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return url;
}

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = send(url, { method: 'GET', headers, timeout: TIMEOUT_MS }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size <= 64_000) chunks.push(chunk);
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    // Ein Upgrade auf 101 wäre ein Fehler (unbekanntes Ticket darf nicht durchkommen).
    req.on('upgrade', (res, socket) => {
      socket.destroy();
      resolve({ status: res.statusCode ?? 101, body: '' });
    });
    req.on('timeout', () => req.destroy(new Error('Zeitüberschreitung')));
    req.on('error', reject);
    req.end();
  });
}

function parse(body) {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

const ticket = () => randomBytes(16).toString('base64url').slice(0, 22);

export async function smoke({ base, pages, expectCommit }) {
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok, detail });

  const health = await get(new URL('/health', base));
  const h = parse(health.body);
  check('health', health.status === 200 && h?.ok === true && h?.protocol === LIVE_PROTOCOL, `${health.status} protocol=${h?.protocol}`);

  const origin = { origin: PAGES_ORIGIN };
  const plain = await get(new URL(`/ws/${ticket()}`, base), origin);
  check('ws ohne Upgrade', plain.status === 426 && parse(plain.body)?.error === 'upgrade_required', String(plain.status));

  const upgrade = await get(new URL(`/ws/${ticket()}`, base), {
    ...origin,
    connection: 'Upgrade',
    upgrade: 'websocket',
    'sec-websocket-version': '13',
    'sec-websocket-key': randomBytes(16).toString('base64'),
  });
  check('ws unbekanntes Ticket', upgrade.status === 401 && parse(upgrade.body)?.error === 'bad_token', String(upgrade.status));

  if (pages) {
    const version = await get(new URL('version.json', pages));
    const v = parse(version.body);
    const commitOk = !expectCommit || v?.commit === expectCommit;
    check('version.json', version.status === 200 && v?.protocol === LIVE_PROTOCOL && commitOk, `${version.status} protocol=${v?.protocol} commit=${v?.commit}`);
  }
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rawBase = process.env.SMOKE_BASE_URL ?? '';
  if (!rawBase) {
    console.log('::notice::SMOKE_BASE_URL fehlt, Smoke-Test übersprungen');
    process.exit(0);
  }
  const base = checkBaseUrl(rawBase);
  const pages = process.env.SMOKE_PAGES_URL ? checkBaseUrl(process.env.SMOKE_PAGES_URL.replace(/\/?$/, '/')) : null;
  if (!base || (process.env.SMOKE_PAGES_URL && !pages)) {
    console.error('smoke: ungültige URL (nur https, ohne Zugangsdaten und Query)');
    process.exit(2);
  }
  try {
    // Pages und workers.dev brauchen nach dem Deploy manchmal einige Sekunden.
    const attempts = Math.min(Math.max(Number(process.env.SMOKE_RETRIES ?? 1) || 1, 1), 10);
    let results = [];
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      results = await smoke({ base, pages, expectCommit: process.env.SMOKE_EXPECT_COMMIT || undefined });
      if (results.every((r) => r.ok) || attempt === attempts) break;
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
    for (const r of results) console.log(`smoke: ${r.ok ? 'ok  ' : 'FAIL'} ${r.name} (${r.detail})`);
    process.exit(results.every((r) => r.ok) ? 0 : 1);
  } catch (error) {
    console.error(`smoke: ${error instanceof Error ? error.message : 'Fehler'}`);
    process.exit(1);
  }
}
