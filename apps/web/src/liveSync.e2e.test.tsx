/** @vitest-environment happy-dom */
import { createMatch } from '@padel/core';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';

const TOKEN = 'abcdefghijklmnopqrstuv';
const TICKET = 'zzzzzzzzzzzzzzzzzzzzzz';
const API = 'https://padel-counter.example.workers.dev';
const MATCH = '11111111-1111-4111-8111-111111111111';

class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static sockets: FakeSocket[] = [];
  static hellos = 0;
  url: string;
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: Event) => void) | null = null;
  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
    FakeSocket.sockets.push(this);
    queueMicrotask(() => {
      if (this.readyState === 3) return;
      this.readyState = 1;
      this.onopen?.(new Event('open'));
    });
  }

  send(data: string): void {
    this.sent.push(data);
    const parsed = JSON.parse(data) as { type?: string; eventId?: string; event?: { team?: string } };
    if (parsed.type === 'hello') {
      FakeSocket.hellos += 1;
      if (FakeSocket.hellos > 1) return;
      const base = createMatch(1_700_000_000_000, MATCH);
      queueMicrotask(() => {
        this.onmessage?.({
          data: JSON.stringify({
            type: 'snapshot',
            protocol: 1,
            host: false,
            players: 2,
            eventIds: [],
            log: { schemaVersion: 2, base, events: [] },
          }),
        });
      });
      return;
    }
    if (parsed.type === 'event' && parsed.eventId) {
      queueMicrotask(() => {
        this.onmessage?.({
          data: JSON.stringify({
            type: 'event',
            eventId: parsed.eventId,
            duplicate: false,
            players: 2,
            event: { ...parsed.event, at: 1_700_000_000_100, by: 'p2' },
          }),
        });
      });
    }
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.(new Event('close'));
  }
}

describe('live socket reconnect', () => {
  const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];
  let joins = 0;
  let visible = 'visible';
  const originalFetch = globalThis.fetch;
  const OriginalSocket = globalThis.WebSocket;

  afterEach(async () => {
    for (const view of mounted) {
      await act(async () => {
        view.root.unmount();
      });
      view.container.remove();
    }
    mounted.splice(0);
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = OriginalSocket;
    delete (globalThis as { __PADEL_TEST_API__?: string }).__PADEL_TEST_API__;
    FakeSocket.sockets.splice(0);
    FakeSocket.hellos = 0;
    joins = 0;
    visible = 'visible';
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it('applies a point immediately and opens the socket again when the page is shown', async () => {
    (globalThis as { __PADEL_TEST_API__?: string }).__PADEL_TEST_API__ = API;
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visible,
    });
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/join')) {
        joins += 1;
        return Response.json({ ticket: `${TICKET.slice(0, 21)}${joins}` }, { status: 201 });
      }
      return Response.json({ error: 'not_found' }, { status: 404 });
    }) as typeof fetch;
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
    window.history.replaceState(null, '', `/PadelCounterV2/#/join?t=${TOKEN}`);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    mounted.push({ root, container });
    await act(async () => {
      root.render(<App />);
    });
    for (let attempt = 0; attempt < 40 && document.querySelector('[data-testid="connect-open"]'); attempt += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
    expect(document.querySelector('[data-testid="connect-open"]')).toBeNull();
    const baseline = joins;
    expect(baseline).toBeGreaterThan(0);
    expect(window.location.href).not.toContain(TOKEN);

    await act(async () => {
      (document.querySelector('[data-testid="increment-a"]') as HTMLButtonElement).click();
    });
    expect(document.querySelector('.sr-only')?.textContent).toContain('Team A 1');
    const bodies = FakeSocket.sockets.flatMap((socket) => socket.sent);
    expect(bodies.join('\n')).toContain('game/increment');

    await act(async () => {
      FakeSocket.sockets.at(-1)?.close();
      document.dispatchEvent(new Event('visibilitychange'));
    });
    for (let attempt = 0; attempt < 20 && joins <= baseline; attempt += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
    expect(joins).toBe(baseline + 1);
    expect(FakeSocket.sockets.length).toBeGreaterThan(1);
  });
});