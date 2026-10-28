/** @vitest-environment happy-dom */
import { createMatch } from '@padel/core';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { JOIN_KEY } from './live/protocol';

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
  /** echo, drop the first event, refuse it, or close the match. */
  static eventMode: 'echo' | 'drop-once' | 'reject' | 'close' = 'echo';
  static dropped = false;
  /** Later hellos stay quiet unless a test needs the court to become live again. */
  static snapshotMode: 'first' | 'every' = 'first';
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
      if (FakeSocket.snapshotMode === 'first' && FakeSocket.hellos > 1) return;
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
    if (parsed.type !== 'event' || !parsed.eventId) return;
    if (FakeSocket.eventMode === 'drop-once' && !FakeSocket.dropped) {
      FakeSocket.dropped = true;
      return;
    }
    if (FakeSocket.eventMode === 'reject') {
      queueMicrotask(() => {
        this.onmessage?.({
          data: JSON.stringify({ type: 'error', code: 'not_applied', eventId: parsed.eventId }),
        });
      });
      return;
    }
    if (FakeSocket.eventMode === 'close') {
      queueMicrotask(() => {
        this.onmessage?.({
          data: JSON.stringify({ type: 'error', code: 'bad_token', eventId: parsed.eventId }),
        });
      });
      return;
    }
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
    FakeSocket.eventMode = 'echo';
    FakeSocket.dropped = false;
    FakeSocket.snapshotMode = 'first';
    joins = 0;
    visible = 'visible';
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  const wait = async (ms: number) => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  };

  const court = () => document.querySelector('.app');

  const mountJoined = async () => {
    (globalThis as { __PADEL_TEST_API__?: string }).__PADEL_TEST_API__ = API;
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
    window.history.replaceState(null, '', `/PadelCounterV2/#/join?t=${TOKEN}`);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    mounted.push({ root, container });
    await act(async () => {
      root.render(<App />);
    });
    for (let attempt = 0; attempt < 80 && !document.querySelector('[data-testid="leave-live-menu"]'); attempt += 1) {
      await wait(20);
    }
    expect(document.querySelector('[data-testid="leave-live-menu"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="connect-open"]')).toBeNull();
    expect(court()?.classList.contains('is-online')).toBe(true);
    expect(court()?.classList.contains('is-offline')).toBe(false);
    expect(document.querySelector('[data-testid="court-offline"]')).toBeNull();
    expect(document.querySelector('[data-testid="court-connection"]')?.textContent).toContain('Live match connected');
  };

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

    const old = FakeSocket.sockets.at(-1);
    const started = Date.now();
    await act(async () => {
      old?.close();
      document.dispatchEvent(new Event('visibilitychange'));
    });
    for (let attempt = 0; attempt < 15 && joins <= baseline; attempt += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    }
    expect(Date.now() - started).toBeLessThan(400);
    expect(joins).toBe(baseline + 1);
    expect(FakeSocket.sockets.length).toBeGreaterThan(1);
  });

  it('stays black when the match was never live', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    mounted.push({ root, container });
    await act(async () => {
      root.render(<App />);
    });
    expect(court()?.className).toBe('app');
    expect(document.querySelector('[data-testid="court-offline"]')).toBeNull();
    expect(document.querySelector('[data-testid="court-connection"]')?.textContent).toBe('');
    await wait(1_700);
    expect(court()?.className).toBe('app');
    expect(document.querySelector('[data-testid="court-offline"]')).toBeNull();
  });

  it('turns dark red only after a live match has been offline for the debounce', async () => {
    let blockJoin = false;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/join')) {
        if (blockJoin) return Response.json({ error: 'offline' }, { status: 503 });
        joins += 1;
        return Response.json({ ticket: `${TICKET.slice(0, 21)}${joins}` }, { status: 201 });
      }
      return Response.json({ error: 'not_found' }, { status: 404 });
    }) as typeof fetch;
    await mountJoined();
    blockJoin = true;
    const baseline = joins;
    const started = Date.now();
    await act(async () => {
      FakeSocket.sockets.at(-1)?.close();
    });
    expect(court()?.classList.contains('is-online')).toBe(true);
    expect(court()?.classList.contains('is-offline')).toBe(false);
    expect(document.querySelector('[data-testid="court-offline"]')).toBeNull();
    await wait(400);
    expect(court()?.classList.contains('is-online')).toBe(true);
    expect(document.querySelector('[data-testid="court-offline"]')).toBeNull();
    await wait(1_400);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1_500);
    expect(court()?.classList.contains('is-offline')).toBe(true);
    expect(court()?.classList.contains('is-online')).toBe(false);
    expect(document.querySelector('[data-testid="court-offline"]')?.textContent).toBe('Offline');
    expect(document.querySelector('[data-testid="court-connection"]')?.textContent).toContain(
      'Live match offline. Points stay on this phone until the connection returns.',
    );
    expect(joins).toBeGreaterThanOrEqual(baseline);
  }, 8_000);

  it('stays blue when the live socket returns before the debounce', async () => {
    FakeSocket.snapshotMode = 'every';
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/join')) {
        joins += 1;
        return Response.json({ ticket: `${TICKET.slice(0, 21)}${joins}` }, { status: 201 });
      }
      return Response.json({ error: 'not_found' }, { status: 404 });
    }) as typeof fetch;
    await mountJoined();
    const baseline = joins;
    await act(async () => {
      FakeSocket.sockets.at(-1)?.close();
    });
    for (let attempt = 0; attempt < 40 && joins <= baseline; attempt += 1) await wait(50);
    expect(joins).toBe(baseline + 1);
    expect(court()?.classList.contains('is-online')).toBe(true);
    expect(court()?.classList.contains('is-offline')).toBe(false);
    await wait(1_700);
    expect(court()?.classList.contains('is-online')).toBe(true);
    expect(document.querySelector('[data-testid="court-offline"]')).toBeNull();
    expect(document.querySelector('[data-testid="court-connection"]')?.textContent).toContain('Live match connected');
  }, 8_000);

  it('returns to black when a joined player leaves', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/join')) {
        joins += 1;
        return Response.json({ ticket: TICKET }, { status: 201 });
      }
      return Response.json({ error: 'not_found' }, { status: 404 });
    }) as typeof fetch;
    await mountJoined();
    const toggle = document.querySelector<HTMLButtonElement>('[data-testid="menu-toggle"]');
    if (toggle) {
      await act(async () => {
        toggle.click();
      });
    }
    const leave = document.querySelector<HTMLButtonElement>('[data-testid="leave-live-menu"]');
    expect(leave).not.toBeNull();
    await act(async () => {
      leave?.click();
    });
    expect(court()?.className).toBe('app');
    expect(sessionStorage.getItem(JOIN_KEY)).toBeNull();
    expect(document.querySelector('[data-testid="court-offline"]')).toBeNull();
    await wait(1_700);
    expect(court()?.className).toBe('app');
    expect(document.querySelector('[data-testid="court-connection"]')?.textContent).toBe('');
  }, 8_000);

  it('sends a dropped point again and rolls back only the refused point', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/join')) {
        joins += 1;
        return Response.json({ ticket: TICKET }, { status: 201 });
      }
      return Response.json({ error: 'not_found' }, { status: 404 });
    }) as typeof fetch;
    FakeSocket.eventMode = 'drop-once';
    await mountJoined();
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="increment-a"]')?.click();
    });
    expect(document.querySelector('.sr-only')?.textContent).toContain('Team A 1');
    const first = FakeSocket.sockets.flatMap((socket) => socket.sent).map((line) => JSON.parse(line) as { type?: string; eventId?: string });
    const eventId = first.find((item) => item.type === 'event')?.eventId;
    expect(eventId).toBeTruthy();
    let copies = 1;
    for (let attempt = 0; attempt < 16 && copies < 2; attempt += 1) {
      await wait(250);
      copies = FakeSocket.sockets.flatMap((socket) => socket.sent)
        .map((line) => JSON.parse(line) as { type?: string; eventId?: string })
        .filter((item) => item.type === 'event' && item.eventId === eventId).length;
    }
    expect(copies).toBe(2);
    expect(document.querySelector('.sr-only')?.textContent).toContain('Team A 1');

    FakeSocket.eventMode = 'echo';
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="increment-a"]')?.click();
    });
    await wait(30);
    expect(document.querySelector('.sr-only')?.textContent).toContain('Team A 2');
    FakeSocket.eventMode = 'reject';
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="increment-a"]')?.click();
    });
    await wait(30);
    expect(document.querySelector('.sr-only')?.textContent).toContain('Team A 2');
    expect(document.querySelector('.sr-only')?.textContent).not.toContain('Team A 3');
  }, 10_000);

  it('clears the token and shows Disconnected when the server rejects the code', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/join')) {
        joins += 1;
        return Response.json({ ticket: TICKET }, { status: 201 });
      }
      return Response.json({ error: 'not_found' }, { status: 404 });
    }) as typeof fetch;
    FakeSocket.eventMode = 'close';
    await mountJoined();
    const baseline = joins;
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="increment-a"]')?.click();
    });
    await wait(30);
    expect(document.querySelector('[data-testid="live-disconnected"]')?.textContent).toBe('Disconnected.');
    expect(document.querySelector('[data-testid="disconnected-hint"]')?.textContent).toBe('Points stay on this phone.');
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="increment-a"]')?.click();
    });
    expect(document.querySelector('.sr-only')?.textContent).toContain('Team A 1');
    expect(document.querySelector('[data-testid="court-connection"]')?.textContent).toContain('Disconnected from the live match.');
    expect(sessionStorage.getItem(JOIN_KEY)).toBeNull();
    expect(window.location.href).not.toContain(TOKEN);
    expect(court()?.className).toBe('app');
    await wait(1_700);
    expect(joins).toBe(baseline);
    expect(court()?.className).toBe('app');
    expect(document.querySelector('[data-testid="court-offline"]')).toBeNull();
  }, 8_000);

  it('detaches the previous socket and joins the next code immediately', async () => {
    const other = 'bbbbbbbbbbbbbbbbbbbbbb';
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/join')) {
        joins += 1;
        return Response.json({ ticket: `${TICKET.slice(0, 21)}${joins}` }, { status: 201 });
      }
      return Response.json({ error: 'not_found' }, { status: 404 });
    }) as typeof fetch;
    await mountJoined();
    const old = FakeSocket.sockets.at(-1);
    const baseline = joins;
    expect(old?.onmessage).not.toBeNull();
    await act(async () => {
      window.history.replaceState(null, '', `/PadelCounterV2/#/join?t=${other}`);
      window.dispatchEvent(new Event('hashchange'));
    });
    for (let attempt = 0; attempt < 15 && joins <= baseline; attempt += 1) await wait(20);
    expect(joins).toBe(baseline + 1);
    expect(old?.onmessage).toBeNull();
    expect(old?.onclose).toBeNull();
    expect(document.querySelector('.sr-only')?.textContent).toContain('Team A 0');
  });

  it('retries a failed reconnect and tries again when the browser is online', async () => {
    let blockJoin = false;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/join')) {
        joins += 1;
        if (blockJoin) return Response.json({ error: 'offline' }, { status: 503 });
        return Response.json({ ticket: `${TICKET.slice(0, 21)}${joins}` }, { status: 201 });
      }
      return Response.json({ error: 'not_found' }, { status: 404 });
    }) as typeof fetch;
    await mountJoined();
    blockJoin = true;
    const baseline = joins;
    await act(async () => {
      FakeSocket.sockets.at(-1)?.close();
    });
    for (let attempt = 0; attempt < 50 && joins < baseline + 2; attempt += 1) await wait(80);
    expect(joins).toBeGreaterThanOrEqual(baseline + 2);
    await wait(100);
    const settled = joins;
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    for (let attempt = 0; attempt < 15 && joins <= settled; attempt += 1) await wait(20);
    expect(joins).toBeGreaterThan(settled);
  }, 12_000);
});