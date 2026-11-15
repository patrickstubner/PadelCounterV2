import { spawnSync } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { LIVE_PROTOCOL } from '@padel/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error Node-Skript ohne Typen
import { checkBaseUrl, LIVE_PROTOCOL as SCRIPT_PROTOCOL, smoke } from '../scripts/smoke.mjs';

type Mode = 'gut' | 'altes-protokoll' | 'ticket-offen';
let mode: Mode = 'gut';

function handler(req: IncomingMessage, res: ServerResponse) {
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.url === '/health') return json(200, { ok: true, service: 'padel-counter', protocol: mode === 'altes-protokoll' ? LIVE_PROTOCOL - 1 : LIVE_PROTOCOL });
  if (req.url?.startsWith('/ws/')) {
    if (req.headers.upgrade !== 'websocket') return json(426, { error: 'upgrade_required' });
    if (mode === 'ticket-offen') return json(200, { error: 'none' });
    return json(401, { error: 'bad_token' });
  }
  if (req.url === '/app/version.json') return json(200, { version: '2.3.8', commit: 'abc', protocol: LIVE_PROTOCOL });
  return json(404, { error: 'not_found' });
}

describe('Smoke-Skript (T-08)', () => {
  const server = createServer(handler);
  let base: URL;
  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('liest LIVE_PROTOCOL aus core', () => {
    expect(SCRIPT_PROTOCOL).toBe(LIVE_PROTOCOL);
  });

  it('meldet einen gesunden Worker und eine passende version.json', async () => {
    mode = 'gut';
    const results = await smoke({ base, pages: new URL('/app/', base), expectCommit: 'abc' });
    expect(results.map((r: { ok: boolean }) => r.ok)).toEqual([true, true, true, true]);
  });

  it('schlägt bei falschem Protokoll, falschem Commit oder offenem Ticket fehl', async () => {
    mode = 'altes-protokoll';
    expect((await smoke({ base }))[0].ok).toBe(false);
    mode = 'ticket-offen';
    expect((await smoke({ base }))[2].ok).toBe(false);
    mode = 'gut';
    expect((await smoke({ base, pages: new URL('/app/', base), expectCommit: 'anders' }))[3].ok).toBe(false);
  });

  it('akzeptiert nur https oder lokales http, ohne Zugangsdaten', () => {
    expect(checkBaseUrl('https://padel-counter-staging.x.workers.dev')).not.toBeNull();
    expect(checkBaseUrl('http://example.com')).toBeNull();
    expect(checkBaseUrl('https://user:pw@example.com')).toBeNull();
    expect(checkBaseUrl('https://example.com/?x=1')).toBeNull();
    expect(checkBaseUrl('kein-url')).toBeNull();
  });

  it('überspringt ohne SMOKE_BASE_URL mit Exit 0', () => {
    const script = fileURLToPath(new URL('../scripts/smoke.mjs', import.meta.url));
    const env = { ...process.env };
    delete env.SMOKE_BASE_URL;
    const result = spawnSync(process.execPath, [script], { env, encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('übersprungen');
  });
});
