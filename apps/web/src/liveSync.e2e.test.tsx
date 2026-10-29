/** @vitest-environment happy-dom */
import { createMatch, matchReducer, type MatchEvent, type MatchState } from '@padel/core';
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
  /** echo, drop the first event, refuse it, close the match, or answer already / score_kept. */
  static eventMode: 'echo' | 'drop-once' | 'reject' | 'close' | 'already' | 'keep' = 'echo';
  /** Snapshot returned with an already acknowledgement. */
  static alreadyLog: { schemaVersion: 2; base: MatchState; events: MatchEvent[] } | null = null;
  static alreadyIds: string[] = [];
  static dropped = false;
  /** Later hellos stay quiet unless a test needs the court to become live again. */
  static snapshotMode: 'first' | 'every' = 'first';
  static echoRename = true;
  /** When set, each hello consumes one log. The default hello stays an empty match. */
  static scriptedLogs: { schemaVersion: 2; base: MatchState; events: MatchEvent[] }[] | null = null;
  /** Deliver each event to every other open socket, as the other phone would see it. */
  static relay = false;
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
      const scripted = FakeSocket.scriptedLogs?.shift() ?? null;
      const base = scripted?.base ?? createMatch(1_700_000_000_000, MATCH);
      const events = scripted?.events ?? [];
      queueMicrotask(() => {
        this.onmessage?.({
          data: JSON.stringify({
            type: 'snapshot',
            protocol: 1,
            host: false,
            players: 2,
            eventIds: scripted
              ? events.map((_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`)
              : [],
            log: { schemaVersion: 2, base, events },
          }),
        });
      });
      return;
    }
    if (parsed.type === 'team_renamed') {
      if (!FakeSocket.echoRename) return;
      queueMicrotask(() => {
        this.onmessage?.({
          data: JSON.stringify({ ...parsed, seq: (parsed as { seq?: number }).seq ?? 1 }),
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
    if (FakeSocket.eventMode === 'keep') {
      queueMicrotask(() => {
        this.onmessage?.({
          data: JSON.stringify({ type: 'error', code: 'score_kept', eventId: parsed.eventId }),
        });
      });
      return;
    }
    if (FakeSocket.eventMode === 'already') {
      const scripted = FakeSocket.alreadyLog;
      queueMicrotask(() => {
        this.onmessage?.({
          data: JSON.stringify({
            type: 'event',
            eventId: parsed.eventId,
            duplicate: true,
            reconciled: 'already',
            players: 2,
            event: { ...parsed.event, at: 1_700_000_000_100, by: 'p2' },
          }),
        });
        this.onmessage?.({
          data: JSON.stringify({
            type: 'snapshot',
            protocol: 2,
            host: false,
            players: 2,
            eventIds: FakeSocket.alreadyIds,
            nameSeq: 1,
            log: scripted ?? { schemaVersion: 2, base: createMatch(1_700_000_000_000, MATCH), events: [] },
          }),
        });
      });
      return;
    }
    const delivered = JSON.stringify({
      type: 'event',
      eventId: parsed.eventId,
      duplicate: false,
      players: 2,
      event: { ...parsed.event, at: 1_700_000_000_100, by: 'p2' },
    });
    queueMicrotask(() => {
      this.onmessage?.({ data: delivered });
      if (!FakeSocket.relay) return;
      for (const other of FakeSocket.sockets) {
        if (other !== this && other.readyState === FakeSocket.OPEN) other.onmessage?.({ data: delivered });
      }
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
    FakeSocket.alreadyLog = null;
    FakeSocket.alreadyIds = [];
    FakeSocket.dropped = false;
    FakeSocket.snapshotMode = 'first';
    FakeSocket.echoRename = true;
    FakeSocket.scriptedLogs = null;
    FakeSocket.relay = false;
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
    expect(bodies.join('\n')).toContain('"claim"');
    expect(bodies.join('\n')).toContain('"baseRevision"');

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

  it('shows a renamed team on this phone and in the history', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/join')) {
        joins += 1;
        return Response.json({ ticket: TICKET }, { status: 201 });
      }
      return Response.json({ error: 'not_found' }, { status: 404 });
    }) as typeof fetch;
    await mountJoined();
    const socket = FakeSocket.sockets.at(-1);
    await act(async () => {
      socket?.onmessage?.({
        data: JSON.stringify({
          type: 'team_renamed',
          eventId: '00000000-0000-4000-8000-0000000000d1',
          team: 'A',
          name: 'Lobos',
          seq: 2,
        }),
      });
    });
    expect(document.querySelector('.team-a .team-name')?.textContent).toBe('Lobos');
    await act(async () => {
      socket?.onmessage?.({
        data: JSON.stringify({
          type: 'team_renamed',
          eventId: '00000000-0000-4000-8000-0000000000d0',
          team: 'A',
          name: 'Old name',
          seq: 1,
        }),
      });
    });
    expect(document.querySelector('.team-a .team-name')?.textContent).toBe('Lobos');
    const toggle = document.querySelector<HTMLButtonElement>('[data-testid="menu-toggle"]');
    if (toggle) {
      await act(async () => {
        toggle.click();
      });
    }
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="history-open"]')?.click();
    });
    expect(document.body.textContent).toContain('Name A · Lobos');
    expect(document.body.textContent).not.toContain('<b>');
  });

  it('applies this phone’s own rename when a later sequence confirms it', async () => {
    FakeSocket.echoRename = false;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/join')) {
        joins += 1;
        return Response.json({ ticket: TICKET }, { status: 201 });
      }
      return Response.json({ error: 'not_found' }, { status: 404 });
    }) as typeof fetch;
    await mountJoined();
    await act(async () => {
      document.querySelector<HTMLButtonElement>('.team-a .team-name')?.click();
    });
    const input = document.querySelector<HTMLInputElement>('.team-name-input');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, 'Mine');
      input?.dispatchEvent(new Event('input', { bubbles: true }));
      input?.blur();
    });
    expect(document.querySelector('.team-a .team-name')?.textContent).toBe('Mine');
    const socket = FakeSocket.sockets.at(-1);
    const sent = socket?.sent.map((line) => JSON.parse(line) as { type?: string; eventId?: string; name?: string })
      .find((item) => item.type === 'team_renamed');
    expect(sent?.eventId).toBeTruthy();
    await act(async () => {
      socket?.onmessage?.({
        data: JSON.stringify({
          type: 'team_renamed',
          eventId: '00000000-0000-4000-8000-0000000000e1',
          team: 'A',
          name: 'Theirs',
          seq: 1,
        }),
      });
    });
    expect(document.querySelector('.team-a .team-name')?.textContent).toBe('Theirs');
    await act(async () => {
      socket?.onmessage?.({
        data: JSON.stringify({
          type: 'team_renamed',
          eventId: sent?.eventId,
          team: 'A',
          name: 'Mine',
          seq: 2,
        }),
      });
    });
    expect(document.querySelector('.team-a .team-name')?.textContent).toBe('Mine');
  });

  it('does not apply a duplicate event and does apply a new one', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/join')) {
        joins += 1;
        return Response.json({ ticket: TICKET }, { status: 201 });
      }
      return Response.json({ error: 'not_found' }, { status: 404 });
    }) as typeof fetch;
    await mountJoined();
    const socket = FakeSocket.sockets.at(-1);
    const duplicate = {
      type: 'event',
      eventId: '00000000-0000-4000-8000-0000000000d1',
      duplicate: true,
      players: 2,
      event: { type: 'game/increment', team: 'a', at: 1_700_000_000_100 },
    };
    await act(async () => {
      socket?.onmessage?.({ data: JSON.stringify(duplicate) });
    });
    expect(document.querySelector('.sr-only')?.textContent).toContain('Team A 0');
    await act(async () => {
      socket?.onmessage?.({
        data: JSON.stringify({ ...duplicate, eventId: '00000000-0000-4000-8000-0000000000d2', duplicate: false }),
      });
    });
    expect(document.querySelector('.sr-only')?.textContent).toContain('Team A 1');
  });

  function played(teams: readonly ('a' | 'b')[]) {
    const base = createMatch(1_700_000_000_000, MATCH);
    const events: MatchEvent[] = [];
    let state = base;
    for (const team of teams) {
      const event: MatchEvent = { type: 'game/increment', team, at: base.createdAt + events.length + 1 };
      events.push(event);
      state = matchReducer(state, event);
    }
    return { schemaVersion: 2 as const, base, events, state };
  }

  const scoreLine = () => document.querySelector('.sr-only')?.textContent ?? '';

  async function reconnectOffline(nextLog: ReturnType<typeof played>, taps: readonly ('a' | 'b')[]) {
    let blockJoin = true;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/join')) {
        if (blockJoin) return Response.json({ error: 'offline' }, { status: 503 });
        joins += 1;
        return Response.json({ ticket: `${TICKET.slice(0, 21)}${joins}` }, { status: 201 });
      }
      return Response.json({ error: 'not_found' }, { status: 404 });
    }) as typeof fetch;
    FakeSocket.snapshotMode = 'every';
    await act(async () => {
      FakeSocket.sockets.at(-1)?.close();
    });
    for (const team of taps) {
      await act(async () => {
        document.querySelector<HTMLButtonElement>(`[data-testid="increment-${team}"]`)?.click();
      });
    }
    const mark = FakeSocket.sockets.length;
    FakeSocket.scriptedLogs = [nextLog, nextLog, nextLog];
    blockJoin = false;
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    for (let attempt = 0; attempt < 40 && FakeSocket.sockets.length === mark; attempt += 1) await wait(50);
    await wait(80);
    return FakeSocket.sockets.slice(mark);
  }

  it('does not turn 4:3 into 4:5 when the offline phone counted the same points', async () => {
    const fourOne = ['a', 'a', 'a', 'a', 'b'] as const;
    FakeSocket.scriptedLogs = [played(fourOne)];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/join')) {
        joins += 1;
        return Response.json({ ticket: `${TICKET.slice(0, 21)}${joins}` }, { status: 201 });
      }
      return Response.json({ error: 'not_found' }, { status: 404 });
    }) as typeof fetch;
    await mountJoined();
    expect(scoreLine()).toContain('Team A 4, Team B 1');
    const fresh = await reconnectOffline(played([...fourOne, 'b', 'b']), ['b', 'b']);
    expect(scoreLine()).toContain('Team A 4, Team B 3');
    expect(scoreLine()).not.toContain('Team B 5');
    const resent = fresh.flatMap((socket) => socket.sent).filter((line) => line.includes('game/increment'));
    expect(resent).toEqual([]);
  }, 8_000);

  it('sends only the offline point the server has not already counted', async () => {
    const fourOne = ['a', 'a', 'a', 'a', 'b'] as const;
    FakeSocket.scriptedLogs = [played(fourOne)];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/join')) {
        joins += 1;
        return Response.json({ ticket: `${TICKET.slice(0, 21)}${joins}` }, { status: 201 });
      }
      return Response.json({ error: 'not_found' }, { status: 404 });
    }) as typeof fetch;
    await mountJoined();
    const fresh = await reconnectOffline(played([...fourOne, 'b', 'b']), ['b', 'b', 'b']);
    await wait(50);
    expect(scoreLine()).toContain('Team A 4, Team B 4');
    expect(scoreLine()).not.toContain('Team B 6');
    const resent = fresh.flatMap((socket) => socket.sent).filter((line) => line.includes('game/increment'));
    expect(resent).toHaveLength(1);
    const body = JSON.parse(resent[0] ?? '{}') as { claim?: { before?: { sets?: { b?: number }[] }; after?: { sets?: { b?: number }[] } } };
    expect(body.claim?.before?.sets?.[0]?.b).toBe(3);
    expect(body.claim?.after?.sets?.[0]?.b).toBe(4);
  }, 8_000);

  it('adds the offline point on top of the other phone’s point', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/join')) {
        joins += 1;
        return Response.json({ ticket: `${TICKET.slice(0, 21)}${joins}` }, { status: 201 });
      }
      return Response.json({ error: 'not_found' }, { status: 404 });
    }) as typeof fetch;
    await mountJoined();
    expect(scoreLine()).toContain('Team A 0, Team B 0');
    const fresh = await reconnectOffline(played(['b']), ['a']);
    for (let attempt = 0; attempt < 40 && !scoreLine().includes('Team A 1, Team B 1'); attempt += 1) {
      await wait(50);
    }
    expect(scoreLine()).toContain('Team A 1, Team B 1');
    const resent = fresh.flatMap((socket) => socket.sent).filter((line) => line.includes('game/increment'));
    expect(resent).toHaveLength(1);
    const body = JSON.parse(resent[0] ?? '{}') as {
      parentId?: string;
      claim?: { before?: { sets?: { a?: number; b?: number }[] }; after?: { sets?: { a?: number; b?: number }[] } };
    };
    expect(body.parentId).toBe('00000000-0000-4000-8000-000000000001');
    expect(body.claim?.before?.sets?.[0]).toEqual({ a: 0, b: 1 });
    expect(body.claim?.after?.sets?.[0]).toEqual({ a: 1, b: 1 });
  }, 8_000);

  it('parents each alternating tap on the other phone’s latest point', async () => {
    FakeSocket.relay = true;
    FakeSocket.snapshotMode = 'every';
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/join')) {
        joins += 1;
        return Response.json({ ticket: `${TICKET.slice(0, 21)}${joins}` }, { status: 201 });
      }
      return Response.json({ error: 'not_found' }, { status: 404 });
    }) as typeof fetch;
    await mountJoined();
    const first = mounted[0]?.container;
    if (!first) throw new Error('first phone');
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    mounted.push({ root, container });
    await act(async () => {
      root.render(<App />);
    });
    for (let attempt = 0; attempt < 80 && !container.querySelector('[data-testid="leave-live-menu"]'); attempt += 1) {
      await wait(20);
    }
    expect(container.querySelector('[data-testid="leave-live-menu"]')).not.toBeNull();
    const click = async (scope: ParentNode, team: 'a' | 'b') => {
      await act(async () => {
        scope.querySelector<HTMLButtonElement>(`[data-testid="increment-${team}"]`)?.click();
      });
      await wait(30);
    };
    await click(first, 'a');
    await click(container, 'b');
    await click(first, 'a');
    await click(container, 'b');
    const eventsOf = (socket: FakeSocket | undefined) =>
      (socket?.sent ?? []).flatMap((line) => {
        const parsed = JSON.parse(line) as { type?: string; eventId?: string; parentId?: string | null };
        return parsed.type === 'event' ? [parsed] : [];
      });
    const phoneA = eventsOf(FakeSocket.sockets[0]);
    const phoneB = eventsOf(FakeSocket.sockets[1]);
    expect(phoneB[0]?.parentId).toBe(phoneA[0]?.eventId);
    expect(phoneA[1]?.parentId).toBe(phoneB[0]?.eventId);
    expect(phoneB[1]?.parentId).toBe(phoneA[1]?.eventId);
    expect(first.querySelector('.sr-only')?.textContent).toContain('Team A 2, Team B 2');
    expect(container.querySelector('.sr-only')?.textContent).toContain('Team A 2, Team B 2');
  }, 8_000);

  it('keeps an unmatched point on the list after a later reconnect', async () => {
    const one = played(['a']);
    FakeSocket.scriptedLogs = [one];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/join')) {
        joins += 1;
        return Response.json({ ticket: `${TICKET.slice(0, 21)}${joins}` }, { status: 201 });
      }
      return Response.json({ error: 'not_found' }, { status: 404 });
    }) as typeof fetch;
    await mountJoined();
    const empty = played([]);
    await reconnectOffline(empty, ['b']);
    for (let attempt = 0; attempt < 40 && !document.querySelector('[data-testid="restore-points"]'); attempt += 1) {
      await wait(50);
    }
    expect(document.querySelector('[data-testid="restore-points"]')?.textContent).toContain('could not be matched');
    expect(document.querySelector('[data-testid="restore-points-add"]')?.textContent).toContain('Count them again');
    const mark = FakeSocket.sockets.length;
    FakeSocket.scriptedLogs = [empty, empty];
    await act(async () => {
      FakeSocket.sockets.at(-1)?.close();
      window.dispatchEvent(new Event('online'));
    });
    for (let attempt = 0; attempt < 40 && FakeSocket.sockets.length === mark; attempt += 1) await wait(50);
    await wait(80);
    expect(document.querySelector('[data-testid="restore-points"]')).not.toBeNull();
  }, 8_000);

  it('reloads after score_kept and sends the point again', async () => {
    FakeSocket.eventMode = 'drop-once';
    FakeSocket.snapshotMode = 'every';
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/join')) {
        joins += 1;
        return Response.json({ ticket: `${TICKET.slice(0, 21)}${joins}` }, { status: 201 });
      }
      return Response.json({ error: 'not_found' }, { status: 404 });
    }) as typeof fetch;
    await mountJoined();
    const before = FakeSocket.hellos;
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="increment-a"]')?.click();
    });
    const socket = FakeSocket.sockets.at(-1);
    const sent = socket?.sent.map((line) => JSON.parse(line) as { type?: string; eventId?: string }).find((item) => item.type === 'event');
    await act(async () => {
      socket?.onmessage?.({
        data: JSON.stringify({ type: 'error', code: 'score_kept', eventId: sent?.eventId }),
      });
    });
    for (let attempt = 0; attempt < 40 && FakeSocket.hellos === before; attempt += 1) await wait(50);
    expect(FakeSocket.hellos).toBeGreaterThan(before);
    const resent = FakeSocket.sockets.slice(1).flatMap((item) => item.sent).flatMap((line) => {
      const parsed = JSON.parse(line) as { type?: string; claim?: { after?: { sets?: { a?: number; b?: number }[] } } };
      return parsed.type === 'event' ? [parsed] : [];
    });
    expect(resent[0]?.claim?.after?.sets?.[0]).toEqual({ a: 1, b: 0 });
  }, 8_000);

  it('stops applying taps after 64 unsent events', async () => {
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
    await act(async () => {
      FakeSocket.sockets.at(-1)?.close();
    });
    const setButton = (n: 1 | 2) => document.querySelector<HTMLButtonElement>(`[data-testid="set-a-${n}"]`);
    await act(async () => {
      for (let index = 0; index < 64; index += 1) setButton(index % 2 === 0 ? 2 : 1)?.click();
    });
    expect(document.querySelector('[data-testid="active-set"]')?.textContent).toBe('Set 1');
    await act(async () => {
      setButton(2)?.click();
    });
    expect(document.querySelector('[data-testid="active-set"]')?.textContent).toBe('Set 1');
    expect(document.querySelector('[data-testid="live-error"]')?.textContent).toContain('Too many changes');
    blockJoin = false;
  }, 8_000);

  it('reloads the server score when the same tap was already stored', async () => {
    FakeSocket.eventMode = 'drop-once';
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/join')) {
        joins += 1;
        return Response.json({ ticket: TICKET }, { status: 201 });
      }
      return Response.json({ error: 'not_found' }, { status: 404 });
    }) as typeof fetch;
    await mountJoined();
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="increment-a"]')?.click();
    });
    expect(scoreLine()).toContain('Team A 1, Team B 0');
    const foreign = '00000000-0000-4000-8000-0000000000f1';
    const socket = FakeSocket.sockets.at(-1);
    const mine = (socket?.sent ?? []).flatMap((line) => {
      const parsed = JSON.parse(line) as { type?: string; eventId?: string };
      return parsed.type === 'event' ? [parsed] : [];
    }).at(-1);
    await act(async () => {
      socket?.onmessage?.({
        data: JSON.stringify({
          type: 'event',
          eventId: foreign,
          duplicate: false,
          players: 2,
          event: { type: 'game/increment', team: 'a', at: 1_700_000_000_100 },
        }),
      });
    });
    expect(scoreLine()).toContain('Team A 2, Team B 0');
    await act(async () => {
      socket?.onmessage?.({
        data: JSON.stringify({
          type: 'event',
          eventId: mine?.eventId,
          duplicate: true,
          reconciled: 'already',
          players: 2,
          event: { type: 'game/increment', team: 'a', at: 1_700_000_000_100 },
        }),
      });
      socket?.onmessage?.({
        data: JSON.stringify({
          type: 'snapshot',
          protocol: 2,
          host: false,
          players: 2,
          eventIds: [foreign],
          nameSeq: 1,
          log: {
            schemaVersion: 2,
            base: createMatch(1_700_000_000_000, MATCH),
            events: [{ type: 'game/increment', team: 'a', at: 1_700_000_000_100 }],
          },
        }),
      });
    });
    expect(scoreLine()).toContain('Team A 1, Team B 0');
    expect(scoreLine()).not.toContain('Team A 2');
  });

  it('parents the next tap on a rename from the other phone', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/join')) {
        joins += 1;
        return Response.json({ ticket: TICKET }, { status: 201 });
      }
      return Response.json({ error: 'not_found' }, { status: 404 });
    }) as typeof fetch;
    await mountJoined();
    const renameId = '00000000-0000-4000-8000-0000000000aa';
    const socket = FakeSocket.sockets.at(-1);
    await act(async () => {
      socket?.onmessage?.({
        data: JSON.stringify({ type: 'team_renamed', eventId: renameId, team: 'A', name: 'Home', seq: 1 }),
      });
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="increment-a"]')?.click();
    });
    const sent = (socket?.sent ?? []).flatMap((line) => {
      const parsed = JSON.parse(line) as { type?: string; parentId?: string | null };
      return parsed.type === 'event' ? [parsed] : [];
    });
    expect(sent.at(-1)?.parentId).toBe(renameId);
  });

  it('reloads once after score_kept and does not reconnect again for that point', async () => {
    FakeSocket.eventMode = 'keep';
    FakeSocket.snapshotMode = 'every';
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/join')) {
        joins += 1;
        return Response.json({ ticket: `${TICKET.slice(0, 21)}${joins}` }, { status: 201 });
      }
      return Response.json({ error: 'not_found' }, { status: 404 });
    }) as typeof fetch;
    await mountJoined();
    const mark = FakeSocket.sockets.length;
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="increment-a"]')?.click();
    });
    for (let attempt = 0; attempt < 40 && FakeSocket.sockets.length === mark; attempt += 1) await wait(50);
    await wait(500);
    expect(FakeSocket.sockets.length).toBe(mark + 1);
    expect(document.querySelector('[data-testid="restore-points"]')).not.toBeNull();
  }, 8_000);

  it('shows the ended server score after an offline point', async () => {
    const fourOne = played(['a', 'a', 'a', 'a', 'b']);
    const ended = {
      ...fourOne,
      events: [...fourOne.events, { type: 'match/end' as const, at: fourOne.base.createdAt + 20 }],
    };
    FakeSocket.scriptedLogs = [played([])];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/join')) {
        joins += 1;
        return Response.json({ ticket: `${TICKET.slice(0, 21)}${joins}` }, { status: 201 });
      }
      return Response.json({ error: 'not_found' }, { status: 404 });
    }) as typeof fetch;
    await mountJoined();
    await reconnectOffline(ended, ['a']);
    for (let attempt = 0; attempt < 40 && !scoreLine().includes('Match ended'); attempt += 1) await wait(50);
    expect(scoreLine()).toContain('Match ended');
    expect(scoreLine()).toContain('4–1');
    expect(scoreLine()).not.toContain('5–1');
  }, 8_000);
});