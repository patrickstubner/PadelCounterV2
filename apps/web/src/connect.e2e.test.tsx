/** @vitest-environment happy-dom */
import { createMatch } from '@padel/core';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { JOIN_KEY } from './live/protocol';

const TOKEN = 'abcdefghijklmnopqrstuv';
const TICKET = 'zzzzzzzzzzzzzzzzzzzzzz';
const HOST = 'hhhhhhhhhhhhhhhhhhhhhh';
const INVITE = 'iiiiiiiiiiiiiiiiiiiiii';
const MATCH = '11111111-1111-4111-8111-111111111111';
const API = 'https://padel-counter.example.workers.dev';

interface FetchCall {
  readonly url: string;
  readonly init?: RequestInit;
}

const fetchCalls: FetchCall[] = [];
const sockets: FakeSocket[] = [];
let joinMode: 'ok' | 'expired' | 'bad' = 'ok';
let createMode: 'ok' | 'down' = 'ok';
let snapshot: unknown = null;
let snapshotHost = false;

class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  url: string;
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: Event) => void) | null = null;
  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
    sockets.push(this);
    queueMicrotask(() => {
      if (this.readyState === 3) return;
      this.readyState = 1;
      this.onopen?.(new Event('open'));
    });
  }

  send(data: string): void {
    this.sent.push(data);
    const parsed = JSON.parse(data) as { type?: string };
    if (parsed.type !== 'hello' || snapshot === null) return;
    const log = snapshot;
    queueMicrotask(() => {
      this.onmessage?.({
        data: JSON.stringify({ type: 'snapshot', protocol: 1, host: snapshotHost, players: 2, log }),
      });
      this.onmessage?.({ data: JSON.stringify({ type: 'presence', players: 2 }) });
    });
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.(new Event('close'));
  }
}

function liveLog(): unknown {
  const base = createMatch(1_700_000_000_000, MATCH);
  return {
    schemaVersion: 2,
    base: {
      ...base,
      sets: [
        { a: 4, b: 2 },
        { a: 0, b: 0 },
        { a: 0, b: 0 },
      ],
    },
    events: [],
  };
}

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  fetchCalls.push({ url, init });
  if (url.endsWith('/join')) {
    if (joinMode === 'expired') return Response.json({ error: 'expired', message: '<b>expired</b>' }, { status: 401 });
    if (joinMode === 'bad') return Response.json({ error: 'bad_token', message: '<img src=x onerror=alert(1)>' }, { status: 401 });
    return Response.json({ ticket: TICKET }, { status: 201 });
  }
  if (url.endsWith('/matches')) {
    if (createMode === 'down') {
      return Response.json({ error: 'not_configured', message: '<script>alert(1)</script>' }, { status: 503 });
    }
    return Response.json({ matchId: MATCH, hostToken: HOST }, { status: 201 });
  }
  if (url.endsWith('/invites')) {
    return Response.json({ token: INVITE, role: 'player', matchId: MATCH, expiresAt: Date.now() + 3_600_000 }, { status: 201 });
  }
  return Response.json({ error: 'not_found' }, { status: 404 });
}

async function mount(): Promise<{ root: Root; container: HTMLDivElement }> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<App />);
  });
  return { root, container };
}

async function unmount(root: Root, container: HTMLDivElement): Promise<void> {
  await act(async () => {
    root.unmount();
  });
  container.remove();
}

async function press(testId: string): Promise<void> {
  const node = document.querySelector(`[data-testid="${testId}"]`);
  if (!(node instanceof HTMLButtonElement)) throw new Error(`missing button ${testId}`);
  await act(async () => {
    node.click();
  });
}

async function waitFor(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (check()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
    });
  }
  throw new Error(`timed out: ${document.body.textContent ?? ''}`);
}

function scoreA(): string {
  return document.querySelector('[data-testid="current-a"]')?.textContent ?? '';
}

describe('connect overlay and scanned join', () => {
  const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];
  const originalFetch = globalThis.fetch;
  const OriginalSocket = globalThis.WebSocket;

  afterEach(async () => {
    for (const view of mounted.splice(0)) await unmount(view.root, view.container);
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = OriginalSocket;
    delete (globalThis as { __PADEL_TEST_API__?: string }).__PADEL_TEST_API__;
    fetchCalls.splice(0);
    sockets.splice(0);
    joinMode = 'ok';
    createMode = 'ok';
    snapshot = null;
    snapshotHost = false;
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it('opens the QR over the court and closes from X, Close, backdrop, and Esc', async () => {
    const view = await mount();
    mounted.push(view);
    expect(document.querySelector('[data-testid="connect-dialog"]')).toBeNull();
    expect(scoreA()).toContain('0');

    await press('connect-open');
    const dialog = document.querySelector('[data-testid="connect-dialog"]');
    expect(dialog?.getAttribute('role')).toBe('dialog');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.getAttribute('aria-labelledby')).toBeTruthy();
    expect(document.querySelector('[data-testid="current-a"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="app-version"]')?.textContent).toMatch(/^v2\./);
    expect(document.activeElement).toBe(document.querySelector('[data-testid="connect-close-x"]'));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(document.querySelector('[data-testid="connect-close"]'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(document.querySelector('[data-testid="connect-close-x"]'));

    (document.querySelector('[data-testid="connect-dialog"]') as HTMLElement).click();
    expect(document.querySelector('[data-testid="connect-dialog"]')).not.toBeNull();

    await press('connect-close-x');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.querySelector('[data-testid="connect-dialog"]')).toBeNull();
    expect(scoreA()).toContain('0');
    const returned = document.activeElement?.getAttribute('data-testid');
    expect(returned === 'menu-toggle' || returned === 'connect-open').toBe(true);

    await press('connect-open');
    await press('connect-close');
    expect(document.querySelector('[data-testid="connect-dialog"]')).toBeNull();

    await press('connect-open');
    await act(async () => {
      (document.querySelector('[data-testid="connect-backdrop"]') as HTMLElement).click();
    });
    expect(document.querySelector('[data-testid="connect-dialog"]')).toBeNull();

    await press('connect-open');
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('[data-testid="connect-dialog"]')).toBeNull();
    expect(document.querySelector('[data-testid="current-a"]')).not.toBeNull();
  });

  it('shows the QR in the overlay and not on a separate page', async () => {
    (globalThis as { __PADEL_TEST_API__?: string }).__PADEL_TEST_API__ = API;
    globalThis.fetch = fakeFetch as typeof fetch;
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
    const view = await mount();
    mounted.push(view);
    await press('connect-open');
    expect(fetchCalls.some((call) => call.url.endsWith('/matches'))).toBe(false);
    await press('share-match');
    await waitFor(() => document.querySelector('.qr') !== null);
    expect(document.querySelector('[data-testid="connect-dialog"] .qr')).not.toBeNull();
    expect(document.querySelector('[data-testid="current-a"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain(INVITE);
    expect(document.body.textContent).not.toContain(HOST);
  });

  it('joins from a scanned url onto the live score and drops the token', async () => {
    (globalThis as { __PADEL_TEST_API__?: string }).__PADEL_TEST_API__ = API;
    globalThis.fetch = fakeFetch as typeof fetch;
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
    snapshot = liveLog();
    window.history.replaceState(null, '', `/PadelCounterV2/#/join?t=${TOKEN}`);
    const view = await mount();
    mounted.push(view);
    await waitFor(() => scoreA().includes('4'));
    expect(document.querySelector('[data-testid="join-error"]')).toBeNull();
    expect(document.querySelector('[data-testid="connect-open"]')).toBeNull();
    expect(document.querySelector('[data-testid="connect-dialog"]')).toBeNull();
    expect(window.location.href).not.toContain(TOKEN);
    expect(window.location.hash).toBe('');
    expect(sessionStorage.getItem(JOIN_KEY)).toContain(TOKEN);
    expect(document.body.textContent).not.toContain(TOKEN);
    const join = fetchCalls.find((call) => call.url === `${API}/join`);
    expect(join?.init?.method).toBe('POST');
    expect(new Headers(join?.init?.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
    const body = JSON.parse(String(join?.init?.body)) as { device?: string };
    expect(body.device).toMatch(/^d[a-f0-9]{8}$/);
    expect(fetchCalls.some((call) => call.url.includes('/ws/'))).toBe(false);
    const socket = sockets.at(-1);
    await act(async () => {
      socket?.onmessage?.({ data: JSON.stringify({ type: 'error', code: 'not_applied', message: '<i>raw</i>' }) });
    });
    expect(document.querySelector('[data-testid="live-error"]')?.textContent).toContain('That change was not applied.');
    expect(document.querySelector('[data-testid="live-error"]')?.textContent).not.toContain('raw');
    expect(document.querySelector('[data-testid="join-error"]')).toBeNull();
  });

  it('shows a fixed error for an expired or invalid invite and does not render the server message', async () => {
    (globalThis as { __PADEL_TEST_API__?: string }).__PADEL_TEST_API__ = API;
    globalThis.fetch = fakeFetch as typeof fetch;
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
    joinMode = 'expired';
    window.history.replaceState(null, '', `/PadelCounterV2/#/join?t=${TOKEN}`);
    const expired = await mount();
    mounted.push(expired);
    await waitFor(() => document.querySelector('[data-testid="join-error"]') !== null);
    const alert = document.querySelector('[data-testid="join-error"]');
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(alert?.textContent).toContain('Could not join this match.');
    expect(alert?.textContent).toContain('This code has expired. Ask for a new one.');
    expect(alert?.textContent).not.toContain('<b>');
    expect(document.querySelector('[data-testid="connect-dialog"]')).toBeNull();
    expect(scoreA()).toContain('0');
    expect(window.location.href).not.toContain(TOKEN);
    expect(sessionStorage.getItem(JOIN_KEY)).toBeNull();
    expect(globalThis.WebSocket).toBe(FakeSocket as unknown as typeof WebSocket);
    expect(fetchCalls.filter((call) => call.url.endsWith('/join'))).toHaveLength(1);

    await unmount(expired.root, expired.container);
    mounted.splice(0);
    fetchCalls.splice(0);
    sessionStorage.clear();
    joinMode = 'bad';
    window.history.replaceState(null, '', `/PadelCounterV2/#/join?t=${TOKEN}`);
    const invalid = await mount();
    mounted.push(invalid);
    await waitFor(() => (document.querySelector('[data-testid="join-error"]')?.textContent ?? '').includes('This code is not valid.'));
    expect(document.body.textContent).not.toContain('onerror');
    expect(document.body.textContent).not.toContain(TOKEN);
    expect(window.location.hash).toBe('');

    await unmount(invalid.root, invalid.container);
    mounted.splice(0);
    fetchCalls.splice(0);
    window.history.replaceState(null, '', '/PadelCounterV2/#/join?t=short');
    const malformed = await mount();
    mounted.push(malformed);
    await waitFor(() => (document.querySelector('[data-testid="join-error"]')?.textContent ?? '').includes('This code is not valid.'));
    expect(fetchCalls).toHaveLength(0);
    expect(window.location.href).not.toContain('short');
    expect(window.location.hash).toBe('');
    expect(document.querySelector('[data-testid="current-a"]')).not.toBeNull();
  });

  it('joins a hash that changes while the court is already open', async () => {
    (globalThis as { __PADEL_TEST_API__?: string }).__PADEL_TEST_API__ = API;
    globalThis.fetch = fakeFetch as typeof fetch;
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
    snapshot = liveLog();
    window.history.replaceState(null, '', '/PadelCounterV2/');
    const view = await mount();
    mounted.push(view);
    expect(scoreA()).toContain('0');
    await act(async () => {
      window.location.hash = `#/join?t=${TOKEN}`;
    });
    await waitFor(() => scoreA().includes('4'));
    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toContain(TOKEN);
    expect(document.querySelector('[data-testid="connect-open"]')).toBeNull();
  });

  it('shows a share failure in the dialog without clearing a join error', async () => {
    (globalThis as { __PADEL_TEST_API__?: string }).__PADEL_TEST_API__ = API;
    globalThis.fetch = fakeFetch as typeof fetch;
    createMode = 'down';
    window.history.replaceState(null, '', '/PadelCounterV2/#/join?t=short');
    const view = await mount();
    mounted.push(view);
    await waitFor(() => (document.querySelector('[data-testid="join-error"]')?.textContent ?? '').includes('This code is not valid.'));
    await press('connect-open');
    await press('share-match');
    await waitFor(() => document.querySelector('[data-testid="connect-error"]') !== null);
    expect(document.querySelector('[data-testid="connect-error"]')?.textContent).toContain('Live sharing is not configured in this build.');
    expect(document.querySelector('[data-testid="connect-error"]')?.textContent).not.toContain('script');
    expect(document.querySelector('[data-testid="join-error"]')?.textContent).toContain('This code is not valid.');
    expect(fetchCalls.some((call) => call.url.endsWith('/matches'))).toBe(true);
  });

  it('rotates the same match after the host reloads', async () => {
    (globalThis as { __PADEL_TEST_API__?: string }).__PADEL_TEST_API__ = API;
    globalThis.fetch = fakeFetch as typeof fetch;
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
    snapshot = liveLog();
    snapshotHost = true;
    const first = await mount();
    mounted.push(first);
    await press('connect-open');
    await press('share-match');
    await waitFor(() => document.querySelector('[data-testid="connect-dialog"] .qr') !== null);
    expect(fetchCalls.filter((call) => call.url.endsWith('/matches'))).toHaveLength(1);
    const stored = JSON.parse(sessionStorage.getItem(JOIN_KEY) ?? '{}') as {
      token?: string;
      host?: boolean;
      matchId?: string;
      expiresAt?: number;
    };
    expect(stored.token).toBe(HOST);
    expect(stored.host).toBe(true);
    expect(stored.matchId).toBe(MATCH);
    const expiresAt = stored.expiresAt;

    await unmount(first.root, first.container);
    mounted.splice(0);
    fetchCalls.splice(0);
    sockets.splice(0);
    window.history.replaceState(null, '', '/PadelCounterV2/');
    const again = await mount();
    mounted.push(again);
    await waitFor(() => document.querySelector('[data-testid="connect-open"]') !== null);
    expect(JSON.parse(sessionStorage.getItem(JOIN_KEY) ?? '{}').expiresAt).toBe(expiresAt);
    await press('connect-open');
    await press('share-match');
    await waitFor(() => document.querySelector('[data-testid="connect-dialog"] .qr') !== null);
    expect(fetchCalls.some((call) => call.url.endsWith('/matches'))).toBe(false);
    expect(fetchCalls.some((call) => call.url.endsWith('/invites'))).toBe(false);
    expect(document.querySelector('[data-testid="new-code-note"]')?.textContent).toBe(
      'New code turns this code off and disconnects the phones that joined with it.',
    );
    expect(document.body.textContent).not.toContain(INVITE);
    await press('rotate-code');
    await waitFor(() => fetchCalls.filter((call) => call.url.endsWith('/invites')).length === 1);
    expect(fetchCalls.filter((call) => call.url === `${API}/matches/${MATCH}/invites`)).toHaveLength(1);
    expect(new Headers(fetchCalls.find((call) => call.url.endsWith('/invites'))?.init?.headers).get('authorization')).toBe(`Bearer ${HOST}`);
    expect(fetchCalls.some((call) => call.url.endsWith('/matches'))).toBe(false);
  });

  it('ignores a join fragment while this phone is the live host', async () => {
    (globalThis as { __PADEL_TEST_API__?: string }).__PADEL_TEST_API__ = API;
    globalThis.fetch = fakeFetch as typeof fetch;
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
    snapshot = liveLog();
    snapshotHost = true;
    window.history.replaceState(null, '', `/PadelCounterV2/#/join?t=${HOST}`);
    const view = await mount();
    mounted.push(view);
    await waitFor(() => document.querySelector('[data-testid="connect-open"]') !== null);
    const joins = fetchCalls.filter((call) => call.url.endsWith('/join')).length;
    await act(async () => {
      window.history.replaceState(null, '', `/PadelCounterV2/#/join?t=${TOKEN}`);
      window.dispatchEvent(new Event('hashchange'));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(fetchCalls.filter((call) => call.url.endsWith('/join'))).toHaveLength(joins);
    expect(window.location.hash).toBe('');
    expect(sessionStorage.getItem(JOIN_KEY)).toContain(HOST);
    expect(sessionStorage.getItem(JOIN_KEY)).not.toContain(TOKEN);
  });

  it('clears an error when the snapshot arrives and drops the slow banner after success or five seconds', async () => {
    (globalThis as { __PADEL_TEST_API__?: string }).__PADEL_TEST_API__ = API;
    globalThis.fetch = fakeFetch as typeof fetch;
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
    snapshot = liveLog();
    window.history.replaceState(null, '', `/PadelCounterV2/#/join?t=${TOKEN}`);
    const view = await mount();
    mounted.push(view);
    await waitFor(() => scoreA().includes('4'));
    const socket = sockets.at(-1);
    await act(async () => {
      socket?.onmessage?.({ data: JSON.stringify({ type: 'error', code: 'not_applied' }) });
    });
    expect(document.querySelector('[data-testid="live-error"]')?.textContent).toContain('That change was not applied.');
    await act(async () => {
      socket?.onmessage?.({
        data: JSON.stringify({ type: 'snapshot', protocol: 1, host: false, players: 2, eventIds: [], log: liveLog() }),
      });
    });
    expect(document.querySelector('[data-testid="live-error"]')).toBeNull();

    await act(async () => {
      socket?.onmessage?.({ data: JSON.stringify({ type: 'error', code: 'slow_down' }) });
    });
    expect(document.querySelector('[data-testid="live-error"]')?.textContent).toContain('Too many changes.');
    await act(async () => {
      socket?.onmessage?.({
        data: JSON.stringify({
          type: 'event',
          eventId: '00000000-0000-4000-8000-0000000000aa',
          duplicate: false,
          players: 2,
          event: { type: 'game/increment', team: 'b', at: 1_700_000_000_100 },
        }),
      });
    });
    expect(document.querySelector('[data-testid="live-error"]')).toBeNull();

    await act(async () => {
      socket?.onmessage?.({ data: JSON.stringify({ type: 'error', code: 'slow_down' }) });
    });
    expect(document.querySelector('[data-testid="live-error"]')?.textContent).toContain('Too many changes.');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5_200));
    });
    expect(document.querySelector('[data-testid="live-error"]')).toBeNull();
  }, 8_000);
});
