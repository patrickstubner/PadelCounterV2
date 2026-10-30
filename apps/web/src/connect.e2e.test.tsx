/** @vitest-environment happy-dom */
import { createMatch } from '@padel/core';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { ARCHIVE_KEY } from './domain/archive';
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
let joinMode: 'ok' | 'expired' | 'bad' | 'limited' | 'shaped' = 'ok';
let createMode: 'ok' | 'down' = 'ok';
let snapshot: unknown = null;
let snapshotHost = false;
let inviteFails = 0;

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
    if (joinMode === 'limited') return Response.json({ error: 'code_limited', message: '<a href="https://evil.example">go</a>' }, { status: 429 });
    if (joinMode === 'shaped') return Response.json({ token: '<b>nope</b>', ticket: 1, message: '<img src=x onerror=alert(1)>' }, { status: 201 });
    const parsed = init?.body ? JSON.parse(String(init.body)) as { code?: unknown } : {};
    if (typeof parsed.code === 'string') {
      return Response.json({ token: INVITE, ticket: TICKET, expiresAt: Date.now() + 3_600_000 }, { status: 201 });
    }
    return Response.json({ ticket: TICKET }, { status: 201 });
  }
  if (url.endsWith('/matches')) {
    if (createMode === 'down') {
      return Response.json({ error: 'not_configured', message: '<script>alert(1)</script>' }, { status: 503 });
    }
    return Response.json({ matchId: MATCH, hostToken: HOST }, { status: 201 });
  }
  if (url.endsWith('/invites')) {
    if (inviteFails > 0) {
      inviteFails -= 1;
      return Response.json({ error: 'offline' }, { status: 503 });
    }
    return Response.json({
      token: INVITE,
      role: 'player',
      matchId: MATCH,
      code: 'K7M4-2QAB',
      expiresAt: Date.now() + 3_600_000,
    }, { status: 201 });
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
    inviteFails = 0;
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it('closes Join match on Escape and on Back, and joins with one ticket request', async () => {
    (globalThis as { __PADEL_TEST_API__?: string }).__PADEL_TEST_API__ = API;
    globalThis.fetch = fakeFetch as typeof fetch;
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
    const view = await mount();
    mounted.push(view);
    await press('connect-open');
    await press('scan-qr');
    expect(document.querySelector('[data-testid="join-match-dialog"]')).not.toBeNull();
    expect(window.history.state).toEqual({ padelArchive: 'join' });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.querySelector('[data-testid="join-match-dialog"]')?.contains(document.activeElement)).toBe(true);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('[data-testid="join-match-dialog"]')).toBeNull();

    await press('connect-open');
    await press('scan-qr');
    await act(async () => {
      window.history.back();
    });
    expect(document.querySelector('[data-testid="join-match-dialog"]')).toBeNull();

    await press('connect-open');
    await press('scan-qr');
    const input = document.querySelector<HTMLInputElement>('[data-testid="match-code-input"]');
    if (!input) throw new Error('code field missing');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, 'k7m42qab');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await press('join-by-code');
    await waitFor(() => sockets.length > 0);
    const joins = fetchCalls.filter((call) => call.url.endsWith('/join'));
    expect(joins).toHaveLength(1);
    expect(String(joins[0]?.init?.body)).toContain('K7M4-2QAB');
    expect(sockets[0]?.url).toContain(`/ws/${TICKET}`);
    expect((window.history.state as { padelArchive?: string } | null)?.padelArchive).not.toBe('join');
  });

  it('opens the QR over the court and closes from X, the backdrop, and Esc', async () => {
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
    expect(document.activeElement).toBe(document.querySelector('[data-testid="show-qr"]'));
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
    expect(document.querySelector('[data-testid="connect-close"]')).toBeNull();
    expect(document.querySelector('[data-testid="connect-dialog"]')?.textContent).not.toContain('Close');
    await act(async () => {
      (document.querySelector('[data-testid="connect-backdrop"]') as HTMLElement).click();
    });
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
    await press('show-qr');
    await waitFor(() => document.querySelector('.qr') !== null);
    expect(document.querySelector('[data-testid="connect-dialog"] .qr')).not.toBeNull();
    expect(document.querySelector('[data-testid="connect-dialog"]')?.classList.contains('connect-bright')).toBe(true);
    expect(document.querySelector('[data-testid="qr-brightness"]')?.textContent).toContain('full brightness');
    expect(document.querySelector('[data-testid="match-qr"]')?.getAttribute('aria-label')).toBe('QR code for players');
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
    expect(document.querySelector('[data-testid="connect-open"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="connect-dialog"]')).toBeNull();
    expect(window.location.href).not.toContain(TOKEN);
    expect(window.location.hash).toBe('');
    expect(sessionStorage.getItem(JOIN_KEY)).toContain(TOKEN);
    expect(document.body.textContent).not.toContain(TOKEN);
    const join = fetchCalls.find((call) => call.url === `${API}/join`);
    expect(join?.init?.method).toBe('POST');
    expect(new Headers(join?.init?.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
    const body = JSON.parse(String(join?.init?.body)) as { device?: string };
    expect(body.device).toMatch(/^d[a-f0-9]{32}$/);
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
    expect(document.querySelector('[data-testid="connect-open"]')).not.toBeNull();
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
    await press('show-qr');
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
    await press('show-qr');
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
    await press('show-qr');
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
    expect(String(fetchCalls.find((call) => call.url.endsWith('/invites'))?.init?.body)).toContain('"rotate":true');
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

  it('follows a moved match without asking, and does not decline', async () => {
    (globalThis as { __PADEL_TEST_API__?: string }).__PADEL_TEST_API__ = API;
    globalThis.fetch = fakeFetch as typeof fetch;
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
    snapshot = liveLog();
    const view = await mount();
    mounted.push(view);
    await press('connect-open');
    await press('scan-qr');
    const input = document.querySelector<HTMLInputElement>('[data-testid="match-code-input"]');
    if (!input) throw new Error('code field missing');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, 'k7m42qab');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await press('join-by-code');
    await waitFor(() => sockets.length > 0 && sockets[0]?.sent.some((entry) => entry.includes('"hello"')) === true);
    await waitFor(() => scoreA().includes('4'));
    const joinsBefore = fetchCalls.filter((call) => call.url.endsWith('/join')).length;
    const moved = 'bbbbbbbbbbbbbbbbbbbbbb';
    await act(async () => {
      sockets[0]?.onmessage?.({ data: JSON.stringify({ type: 'match_moved', token: moved, seat: 'p3' }) });
    });
    expect(document.querySelector('[data-testid="join-new-match"]')).toBeNull();
    expect(document.querySelector('[data-testid="new-match-notice"]')?.textContent).toBe('New match');
    expect(document.body.textContent).not.toContain('Join the new match?');
    const joins = fetchCalls.filter((call) => call.url.endsWith('/join'));
    expect(joins).toHaveLength(joinsBefore + 1);
    expect(sockets[0]?.sent.some((entry) => entry.includes('"decline_move"'))).toBe(false);
    expect(String(joins.at(-1)?.init?.headers && new Headers(joins.at(-1)?.init?.headers).get('authorization'))).toContain(moved);
  });

  it('joins a fragment code the same way as a typed code, then strips it', async () => {
    (globalThis as { __PADEL_TEST_API__?: string }).__PADEL_TEST_API__ = API;
    globalThis.fetch = fakeFetch as typeof fetch;
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
    snapshot = liveLog();
    const origin = window.location.origin;
    window.history.replaceState(null, '', '/PadelCounterV2/#join=K7M4-2QAB');
    const view = await mount();
    mounted.push(view);
    expect(fetchCalls.filter((call) => call.url.endsWith('/join'))).toHaveLength(0);
    expect(document.querySelector('[data-testid="confirm-join-link"]')).not.toBeNull();
    expect(document.body.textContent).toContain('The score on this phone will be replaced.');
    await press('cancel-join-link');
    expect(document.querySelector('[data-testid="confirm-join-link"]')).toBeNull();
    expect(fetchCalls.filter((call) => call.url.endsWith('/join'))).toHaveLength(0);
    expect(scoreA()).toContain('0');
    await act(async () => {
      window.location.hash = '#join=k7m42qab';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await press('confirm-join-link');
    expect(document.querySelectorAll('[data-testid="confirm-join-link"]')).toHaveLength(0);
    await waitFor(() => scoreA().includes('4'));
    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toContain('K7M4-2QAB');
    expect(window.location.origin).toBe(origin);
    expect(window.location.pathname).toBe('/PadelCounterV2/');
    expect(document.body.textContent).not.toContain('K7M4-2QAB');
    const join = fetchCalls.find((call) => call.url.endsWith('/join'));
    const body = JSON.parse(String(join?.init?.body)) as { code?: string; device?: string };
    expect(body.code).toBe('K7M4-2QAB');
    expect(body.device).toMatch(/^d[a-f0-9]{32}$/);
    expect(join?.url.startsWith(API)).toBe(true);
    expect(sockets[0]?.url).toContain(`/ws/${TICKET}`);
  });

  it('refuses a malicious fragment and does not navigate or render it', async () => {
    (globalThis as { __PADEL_TEST_API__?: string }).__PADEL_TEST_API__ = API;
    globalThis.fetch = fakeFetch as typeof fetch;
    const origin = window.location.origin;
    const scheme = 'java' + 'script:';
    window.history.replaceState(null, '', `/PadelCounterV2/#join=${scheme}alert(1)`);
    const malicious = await mount();
    mounted.push(malicious);
    await waitFor(() => (document.querySelector('[data-testid="join-error"]')?.textContent ?? '').includes('This code is not valid.'));
    expect(fetchCalls).toHaveLength(0);
    expect(window.location.hash).toBe('');
    expect(window.location.origin).toBe(origin);
    expect(window.location.pathname).toBe('/PadelCounterV2/');
    expect(window.location.href).not.toContain(scheme);
    expect(window.location.href).not.toContain('alert');
    expect(document.body.textContent ?? '').not.toContain(scheme);
    expect(document.querySelector('img')).toBeNull();

    await unmount(malicious.root, malicious.container);
    mounted.splice(0);
    window.history.replaceState(null, '', '/PadelCounterV2/#join=K7M4-2QAB&next=https://evil.example');
    const extra = await mount();
    mounted.push(extra);
    await waitFor(() => (document.querySelector('[data-testid="join-error"]')?.textContent ?? '').includes('This code is not valid.'));
    expect(fetchCalls).toHaveLength(0);
    expect(window.location.href).not.toContain('evil.example');
    expect(window.location.href).not.toContain('K7M4');
    expect(document.body.textContent).not.toContain('evil.example');
    expect(window.location.origin).toBe(origin);
  });

  it('shows the fixed limit sentence for a fragment code and does not render the server body', async () => {
    (globalThis as { __PADEL_TEST_API__?: string }).__PADEL_TEST_API__ = API;
    globalThis.fetch = fakeFetch as typeof fetch;
    joinMode = 'limited';
    window.history.replaceState(null, '', '/PadelCounterV2/#join=k7m42qab');
    const view = await mount();
    mounted.push(view);
    expect(fetchCalls.filter((call) => call.url.endsWith('/join'))).toHaveLength(0);
    await press('confirm-join-link');
    expect(document.querySelectorAll('[data-testid="confirm-join-link"]')).toHaveLength(0);
    await waitFor(() => (document.querySelector('[data-testid="join-error"]')?.textContent ?? '').includes('Too many tries from this network.'));
    expect(document.body.textContent).not.toContain('evil.example');
    expect(document.body.textContent).not.toContain('k7m42qab');
    expect(document.body.textContent).not.toContain('K7M4-2QAB');
    expect(window.location.hash).toBe('');
    expect(fetchCalls.filter((call) => call.url.endsWith('/join'))).toHaveLength(1);
  });

  it('shares the fragment link and copies it when the share sheet is missing', async () => {
    (globalThis as { __PADEL_TEST_API__?: string }).__PADEL_TEST_API__ = API;
    globalThis.fetch = fakeFetch as typeof fetch;
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
    const shared: Array<{ text?: string; url?: string; title?: string }> = [];
    const copied: string[] = [];
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: (data: { text?: string; url?: string; title?: string }) => {
        shared.push(data);
        return Promise.resolve();
      },
    });
    const view = await mount();
    mounted.push(view);
    await press('connect-open');
    await press('show-qr');
    await waitFor(() => document.querySelector('[data-testid="share-code"]') !== null);
    await press('share-code');
    await waitFor(() => shared.length === 1);
    const sent = shared[0];
    const text = sent?.text ?? '';
    expect(sent?.url).toBeUndefined();
    expect(sent?.title).toBeUndefined();
    expect(text.endsWith('#join=K7M4-2QAB')).toBe(true);
    expect(text.split('#')[0]).not.toContain('K7M4');
    expect(new URL(text).search).toBe('');
    expect(new URL(text).origin).toBe(window.location.origin);

    Reflect.deleteProperty(navigator, 'share');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (value: string) => {
        copied.push(value);
        return Promise.resolve();
      } },
    });
    await press('share-code');
    await waitFor(() => copied.length === 1);
    expect(copied[0]).toBe(text);
    expect(document.querySelector('[data-testid="code-copied"]')?.textContent).toBe('Copied.');
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('closes Join match from X and the backdrop, with no bottom Close button', async () => {
    const view = await mount();
    mounted.push(view);
    await press('connect-open');
    await press('scan-qr');
    expect(document.querySelector('[data-testid="join-match-dismiss"]')).toBeNull();
    expect(document.querySelector('[data-testid="join-match-close"]')).not.toBeNull();
    const dialog = document.querySelector('[data-testid="join-match-dialog"]');
    expect(dialog?.textContent).not.toMatch(/\bClose\b/);
    (dialog as HTMLElement).click();
    expect(document.querySelector('[data-testid="join-match-dialog"]')).not.toBeNull();
    await act(async () => {
      (document.querySelector('[data-testid="join-match-backdrop"]') as HTMLElement).click();
    });
    expect(document.querySelector('[data-testid="join-match-dialog"]')).toBeNull();
    await press('connect-open');
    await press('scan-qr');
    await press('join-match-close');
    expect(document.querySelector('[data-testid="join-match-dialog"]')).toBeNull();
  });

  it('asks before a link replaces a started match and keeps that match in History', async () => {
    (globalThis as { __PADEL_TEST_API__?: string }).__PADEL_TEST_API__ = API;
    globalThis.fetch = fakeFetch as typeof fetch;
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
    snapshot = liveLog();
    const view = await mount();
    mounted.push(view);
    await press('increment-a');
    expect(scoreA()).toContain('1');
    await act(async () => {
      window.location.hash = '#join=K7M4-2QAB';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(document.querySelector('[data-testid="confirm-join-link"]')).not.toBeNull();
    expect(fetchCalls.filter((call) => call.url.endsWith('/join'))).toHaveLength(0);
    expect(scoreA()).toContain('1');
    expect(localStorage.getItem(ARCHIVE_KEY) ?? '').not.toContain('game/increment');
    await press('cancel-join-link');
    expect(scoreA()).toContain('1');
    expect(window.location.hash).toBe('');
    await act(async () => {
      window.location.hash = '#JOIN=K7M4-2QAB';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await press('confirm-join-link');
    expect(document.querySelectorAll('[data-testid="confirm-join-link"]')).toHaveLength(0);
    expect(localStorage.getItem(ARCHIVE_KEY) ?? '').toContain('game/increment');
    await waitFor(() => scoreA().includes('4'));
    expect(window.location.href).not.toContain('K7M4');
    expect(localStorage.getItem(ARCHIVE_KEY) ?? '').toContain('game/increment');
  });

  it('removes a code fragment from a live host and says the link was not used', async () => {
    (globalThis as { __PADEL_TEST_API__?: string }).__PADEL_TEST_API__ = API;
    globalThis.fetch = fakeFetch as typeof fetch;
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
    snapshot = liveLog();
    snapshotHost = true;
    const view = await mount();
    mounted.push(view);
    await press('connect-open');
    await press('show-qr');
    await waitFor(() => document.querySelector('.app.is-online') !== null);
    const joinsBefore = fetchCalls.filter((call) => call.url.endsWith('/join')).length;
    await act(async () => {
      window.location.hash = '#JOIN=K7M4-2QAB';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toContain('K7M4');
    expect(document.querySelector('[data-testid="host-link-ignored"]')?.textContent).toContain('You are already the host');
    expect(document.querySelector('[data-testid="confirm-join-link"]')).toBeNull();
    expect(fetchCalls.filter((call) => call.url.endsWith('/join'))).toHaveLength(joinsBefore);
  });

  it('keeps Join match open when the code is refused or the response is not a token', async () => {
    (globalThis as { __PADEL_TEST_API__?: string }).__PADEL_TEST_API__ = API;
    globalThis.fetch = fakeFetch as typeof fetch;
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
    joinMode = 'bad';
    const refused = await mount();
    mounted.push(refused);
    await press('connect-open');
    await press('scan-qr');
    const input = document.querySelector<HTMLInputElement>('[data-testid="match-code-input"]');
    if (!input) throw new Error('code field missing');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, 'k7m42qab');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await press('join-by-code');
    await waitFor(() => (document.querySelector('[data-testid="join-match-error"]')?.textContent ?? '').includes('This code is not valid.'));
    expect(document.querySelector('[data-testid="join-match-dialog"]')).not.toBeNull();
    expect(sockets).toHaveLength(0);
    const body = JSON.parse(String(fetchCalls.find((call) => call.url.endsWith('/join'))?.init?.body)) as { code?: string };
    expect(body.code).toBe('K7M4-2QAB');

    await unmount(refused.root, refused.container);
    mounted.splice(0);
    fetchCalls.splice(0);
    sockets.splice(0);
    joinMode = 'shaped';
    const shaped = await mount();
    mounted.push(shaped);
    await press('connect-open');
    await press('scan-qr');
    const again = document.querySelector<HTMLInputElement>('[data-testid="match-code-input"]');
    if (!again) throw new Error('code field missing');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(again, 'K7M4-2QAB');
      again.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await press('join-by-code');
    await waitFor(() => (document.querySelector('[data-testid="join-match-error"]')?.textContent ?? '').includes('That code did not work.'));
    expect(document.querySelector('[data-testid="join-match-dialog"]')).not.toBeNull();
    expect(sockets).toHaveLength(0);
    expect(document.body.textContent).not.toContain('onerror');
    expect(document.body.textContent).not.toContain('<b>');
  });
});
