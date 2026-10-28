import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { connectSrcExtra } from './csp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://padel-counter.example.workers.dev';

describe('connect-src websocket scheme', () => {
  it('adds wss for https and ws only while developing', () => {
    expect(connectSrcExtra(API, false)).toBe(` ${API} wss://padel-counter.example.workers.dev`);
    expect(connectSrcExtra(API, true)).toBe(` ${API} wss://padel-counter.example.workers.dev`);
    expect(connectSrcExtra('http://127.0.0.1:8787', true)).toBe(' http://127.0.0.1:8787 ws://127.0.0.1:8787');
    expect(connectSrcExtra('http://127.0.0.1:8787', false)).toBe('');
    expect(connectSrcExtra('', true)).toBe('');
    expect(connectSrcExtra('not a url', false)).toBe('');
  });

  it('allows the websocket URL in the built CSP', () => {
    execFileSync('pnpm', ['exec', 'rsbuild', 'build'], {
      cwd: root,
      env: { ...process.env, PUBLIC_API_URL: API, NODE_ENV: 'production' },
      stdio: 'pipe',
    });
    const html = readFileSync(join(root, 'dist/index.html'), 'utf8');
    const policy = html.match(/Content-Security-Policy"\s+content="([^"]+)"/)?.[1] ?? '';
    expect(policy).toContain("connect-src 'self'");
    expect(policy).toContain(`${API} wss://padel-counter.example.workers.dev`);
    expect(policy).not.toContain('ws://padel-counter.example.workers.dev');

    execFileSync('pnpm', ['exec', 'rsbuild', 'build'], {
      cwd: root,
      env: { ...process.env, PUBLIC_API_URL: 'http://127.0.0.1:8787', NODE_ENV: 'development' },
      stdio: 'pipe',
    });
    const devHtml = readFileSync(join(root, 'dist/index.html'), 'utf8');
    expect(devHtml).toContain('http://127.0.0.1:8787 ws://127.0.0.1:8787');
  }, 60_000);
});
