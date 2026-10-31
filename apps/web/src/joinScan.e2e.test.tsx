/** @vitest-environment happy-dom */
import { createMatch } from '@padel/core';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

const TOKEN = 'abcdefghijklmnopqrstuv';
const TICKET = 'zzzzzzzzzzzzzzzzzzzzzz';
const MATCH = '11111111-1111-4111-8111-111111111111';
const API = 'https://padel-counter.example.workers.dev';

const scan = vi.hoisted(() => ({ text: null as string | null }));

vi.mock('./live/readQr', async () => {
  const actual = await vi.importActual<typeof import('./live/readQr')>('./live/readQr');
  return {
    ...actual,
    readQrVideo: () => Promise.resolve(scan.text),
  };
});

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

  constructor(url: string) {
    this.url = url;
    queueMicrotask(() => {
      if (this.readyState === 3) return;
      this.readyState = 1;
      this.onopen?.(new Event('open'));
    });
  }

  send(data: string): void {
    const parsed = JSON.parse(data) as { type?: string };
    if (parsed.type !== 'hello') return;
    const base = createMatch(1_700_000_000_000, MATCH);
    const log = {
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
    queueMicrotask(() => {
      this.onmessage?.({
        data: JSON.stringify({ type: 'snapshot', protocol: 1, host: false, players: 2, log }),
      });
      this.onmessage?.({ data: JSON.stringify({ type: 'presence', players: 2 }) });
    });
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.(new Event('close'));
  }
}

describe('scan to the match score', () => {
  let root: Root | null = null;
  const stops: ReturnType<typeof vi.fn>[] = [];

  afterEach(async () => {
    scan.text = null;
    stops.splice(0);
    await act(async () => {
      root?.unmount();
    });
    root = null;
    while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    delete (globalThis as { __PADEL_TEST_API__?: string }).__PADEL_TEST_API__;
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState(null, '', '/PadelCounterV2/');
  });

  it('stops every track when a code is read and shows the live score', async () => {
    (globalThis as { __PADEL_TEST_API__?: string }).__PADEL_TEST_API__ = API;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/join')) return Response.json({ ticket: TICKET }, { status: 201, headers: init?.headers });
      return Response.json({ error: 'not_found' }, { status: 404 });
    }) as typeof fetch;
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
    window.requestAnimationFrame = (callback) => window.setTimeout(() => callback(0), 16);
    window.cancelAnimationFrame = (id) => {
      window.clearTimeout(id);
    };
    const streamStops = [vi.fn(), vi.fn()];
    stops.push(...streamStops);
    const tracks = streamStops.map((stop) => ({ stop, kind: 'video' as const, getCapabilities: () => ({}) }));
    const stream = new MediaStream();
    Object.defineProperty(stream, 'getTracks', { value: () => tracks });
    Object.defineProperty(stream, 'getVideoTracks', { value: () => tracks });
    const getUserMedia = vi.fn(async () => stream);
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    HTMLVideoElement.prototype.play = () => Promise.resolve();

    window.history.replaceState(null, '', '/PadelCounterV2/');
    const container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<App />);
    });
    expect(getUserMedia).not.toHaveBeenCalled();

    const open = document.querySelector<HTMLButtonElement>('[data-testid="connect-open"]');
    if (!open) throw new Error('missing connect');
    await act(async () => {
      open.click();
    });
    expect(getUserMedia).not.toHaveBeenCalled();
    const scanQr = document.querySelector<HTMLButtonElement>('[data-testid="scan-qr"]');
    if (!scanQr) throw new Error('missing scan');
    scan.text = null;
    await act(async () => {
      scanQr.click();
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-testid="match-code-input"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="join-match-dialog"]')?.classList.contains('join-scanning')).toBe(true);
    const video = document.querySelector('[data-testid="join-camera"]');
    expect(video?.classList.contains('join-camera')).toBe(true);
    expect(streamStops.every((stop) => stop.mock.calls.length === 0)).toBe(true);

    scan.text = `${window.location.origin}/PadelCounterV2/#/join?t=${TOKEN}`;
    await act(async () => {
      for (
        let attempt = 0;
        attempt < 40 && !(document.querySelector('[data-testid="current-a"]')?.textContent ?? '').includes('4');
        attempt += 1
      ) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    });
    expect(streamStops.every((stop) => stop.mock.calls.length > 0)).toBe(true);
    expect(document.querySelector('[data-testid="join-camera"]')).toBeNull();
    expect(document.querySelector('[data-testid="join-match-dialog"]')).toBeNull();
    expect(document.querySelector('[data-testid="current-a"]')?.textContent ?? '').toContain('4');
    expect(document.body.textContent ?? '').not.toContain(TOKEN);
  });

  it('keeps the code field usable when the camera is denied and does not ask again', async () => {
    (globalThis as { __PADEL_TEST_API__?: string }).__PADEL_TEST_API__ = API;
    const getUserMedia = vi.fn(async () => {
      throw new DOMException('denied', 'NotAllowedError');
    });
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    window.history.replaceState(null, '', '/PadelCounterV2/');
    const container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<App />);
    });
    expect(getUserMedia).not.toHaveBeenCalled();
    const open = document.querySelector<HTMLButtonElement>('[data-testid="connect-open"]');
    await act(async () => {
      open?.click();
    });
    expect(getUserMedia).not.toHaveBeenCalled();
    const scanQr = document.querySelector<HTMLButtonElement>('[data-testid="scan-qr"]');
    await act(async () => {
      scanQr?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-testid="join-camera"]')).toBeNull();
    expect(document.querySelector('[data-testid="join-camera-hint"]')?.textContent).toContain('Allow camera access');
    const input = document.querySelector<HTMLInputElement>('[data-testid="match-code-input"]');
    expect(input).not.toBeNull();
    expect(input?.disabled).toBe(false);
    expect(document.body.textContent ?? '').not.toContain('denied');
  });
});
