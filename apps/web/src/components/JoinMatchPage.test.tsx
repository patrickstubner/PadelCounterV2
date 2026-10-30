/** @vitest-environment happy-dom */
import { ROOM_MESSAGES } from '@padel/core';
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DECODE_WAIT_MS } from '../live/readQr';
import { CAMERA_LIMIT_MS, JoinMatchPage } from './JoinMatchPage';

const PAGE = 'https://patrickstubner.github.io/PadelCounterV2/';
const TOKEN = 'abcdefghijklmnopqrstuv';

let root: Root | null = null;

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  act(() => {
    root?.unmount();
  });
  root = null;
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

function render(node: ReactNode): HTMLDivElement {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(node);
  });
  return host;
}

function paceFrames(): void {
  window.requestAnimationFrame = (callback) => window.setTimeout(() => callback(0), 16);
  window.cancelAnimationFrame = (id) => {
    window.clearTimeout(id);
  };
}

function camera(trackCount = 1) {
  paceFrames();
  const stops = Array.from({ length: trackCount }, () => vi.fn());
  const tracks = stops.map((stop) => ({ stop, kind: 'video' as const, getCapabilities: () => ({}) }));
  const stream = new MediaStream();
  Object.defineProperty(stream, 'getTracks', { value: () => tracks });
  Object.defineProperty(stream, 'getVideoTracks', { value: () => tracks });
  const getUserMedia = vi.fn(async () => stream);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
  HTMLVideoElement.prototype.play = () => Promise.resolve();
  return { stop: stops[0] ?? vi.fn(), stops, getUserMedia };
}

describe('join match in the app', () => {
  it('does not open the camera until Use camera, then stops it when the page hides', async () => {
    const media = camera();
    let scanned = 0;
    render(
      <JoinMatchPage
        configured
        error={null}
        pageHref={PAGE}
        onCode={() => undefined}
        onToken={() => undefined}
        onClose={() => undefined}
        scanFrame={async () => {
          scanned += 1;
          return null;
        }}
      />,
    );
    expect(media.getUserMedia).not.toHaveBeenCalled();
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="use-camera"]')?.click();
      for (let attempt = 0; attempt < 20 && scanned === 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    });
    expect(media.getUserMedia).toHaveBeenCalledTimes(1);
    expect(media.getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });
    expect(document.querySelector('[data-testid="join-match-dialog"]')?.classList.contains('join-scanning')).toBe(true);
    expect(document.querySelector('[data-testid="enter-code"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="match-code-input"]')).toBeNull();
    expect(document.querySelector('[data-testid="scan-hint"]')?.textContent).toContain('Fill the frame');
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="enter-code"]')?.click();
    });
    expect(document.querySelector('[data-testid="match-code-input"]')).not.toBeNull();
    expect(scanned).toBeGreaterThan(0);
    const video = document.querySelector('video');
    expect(video?.muted).toBe(true);
    expect(video?.playsInline).toBe(true);
    expect(video?.autoplay).toBe(true);
    expect(video?.getAttribute('playsinline')).not.toBeNull();
    expect(video?.getAttribute('webkit-playsinline')).not.toBeNull();
    await act(async () => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(media.stop).toHaveBeenCalled();
  });

  it('ignores a QR code from another origin and accepts this app', async () => {
    const media = camera();
    const tokens: string[] = [];
    const frames = [
      `https://evil.example/PadelCounterV2/#/join?t=${TOKEN}`,
      `${PAGE}#/join?t=${TOKEN}`,
    ];
    render(
      <JoinMatchPage
        configured
        error={null}
        pageHref={PAGE}
        onCode={() => undefined}
        onToken={(token) => {
          tokens.push(token);
        }}
        onClose={() => undefined}
        scanFrame={async () => frames.shift() ?? null}
      />,
    );
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="use-camera"]')?.click();
      for (let attempt = 0; attempt < 20 && !document.querySelector('[data-testid="join-match-error"]'); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    });
    expect(document.querySelector('[data-testid="join-match-error"]')?.textContent).toBe(ROOM_MESSAGES.join_code);
    expect(document.body.textContent ?? '').not.toContain('evil.example');
    expect(document.body.textContent ?? '').not.toContain(TOKEN);
    expect(tokens).toEqual([]);
    expect(media.stop).toHaveBeenCalled();

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="use-camera"]')?.click();
      for (let attempt = 0; attempt < 20 && tokens.length === 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    });
    expect(tokens).toEqual([TOKEN]);
  });

  it('joins from a scanned frame and closes the dialog', async () => {
    const media = camera(2);
    const tokens: string[] = [];
    const order: string[] = [];
    media.stops.forEach((stop) => {
      stop.mockImplementation(() => {
        order.push('stop');
      });
    });
    const page = 'https://patrickstubner.github.io/PadelCounterV2/index.html?source=pwa';
    const link = `${PAGE}#/join?t=${TOKEN}`;
    function Harness() {
      const [open, setOpen] = useState(true);
      if (!open) return null;
      return (
        <JoinMatchPage
          configured
          error={null}
          pageHref={page}
          onCode={() => undefined}
          onToken={(token) => {
            order.push('token');
            tokens.push(token);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
          scanFrame={async () => link}
        />
      );
    }
    render(<Harness />);
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="use-camera"]')?.click();
      for (let attempt = 0; attempt < 30 && tokens.length === 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    });
    expect(tokens).toEqual([TOKEN]);
    expect(order[0]).toBe('stop');
    expect(order).toContain('token');
    expect(media.stops.every((stop) => stop.mock.calls.length > 0)).toBe(true);
    expect(document.querySelector('[data-testid="join-match-dialog"]')).toBeNull();
    expect(document.body.textContent ?? '').not.toContain(TOKEN);
    expect(document.body.textContent ?? '').not.toContain('evil.example');
    expect(media.stop).toHaveBeenCalled();
  });

  it('shows a message when the camera cannot play', async () => {
    const media = camera();
    HTMLVideoElement.prototype.play = () => Promise.reject(new DOMException('not allowed', 'NotAllowedError'));
    render(
      <JoinMatchPage
        configured
        error={null}
        pageHref={PAGE}
        onCode={() => undefined}
        onToken={() => undefined}
        onClose={() => undefined}
      />,
    );
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="use-camera"]')?.click();
      for (let attempt = 0; attempt < 20 && !document.querySelector('[data-testid="join-match-error"]'); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    });
    expect(document.querySelector('[data-testid="join-match-error"]')?.textContent).toBe('The camera did not start.');
    expect(document.querySelector('[data-testid="join-camera"]')).toBeNull();
    expect(media.stop).toHaveBeenCalled();
  });

  it('stops the camera after 90 seconds and shows how to start again', async () => {
    vi.useFakeTimers();
    const media = camera();
    render(
      <JoinMatchPage
        configured
        error={null}
        pageHref={PAGE}
        onCode={() => undefined}
        onToken={() => undefined}
        onClose={() => undefined}
        scanFrame={async () => null}
      />,
    );
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="use-camera"]')?.click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(document.querySelector('[data-testid="join-camera"]')).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CAMERA_LIMIT_MS);
    });
    expect(document.querySelector('[data-testid="join-camera"]')).toBeNull();
    expect(document.querySelector('[data-testid="join-camera-hint"]')?.textContent).toBe(
      'Camera stopped. Tap Use camera to try again.',
    );
    expect(media.stop).toHaveBeenCalled();
  });

  it('looks again when a scan does not return', async () => {
    vi.useFakeTimers();
    camera();
    let calls = 0;
    render(
      <JoinMatchPage
        configured
        error={null}
        pageHref={PAGE}
        onCode={() => undefined}
        onToken={() => undefined}
        onClose={() => undefined}
        scanFrame={() => {
          calls += 1;
          return new Promise(() => undefined);
        }}
      />,
    );
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="use-camera"]')?.click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(calls).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DECODE_WAIT_MS + 200);
    });
    expect(calls).toBeGreaterThan(1);
    expect(document.querySelector('[data-testid="join-camera"]')).not.toBeNull();
  });

  it('submits a short code without caring about case or a hyphen', () => {
    const codes: string[] = [];
    render(
      <JoinMatchPage
        configured
        error={null}
        pageHref={PAGE}
        onCode={(code) => {
          codes.push(code);
        }}
        onToken={() => undefined}
        onClose={() => undefined}
      />,
    );
    const input = document.querySelector<HTMLInputElement>('[data-testid="match-code-input"]');
    const form = input?.form;
    if (!input || !form) throw new Error('code field missing');
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, 'k7m42qab');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      document.querySelector<HTMLButtonElement>('[data-testid="join-by-code"]')?.click();
    });
    expect(codes).toEqual(['K7M4-2QAB']);
  });

  it('closes on Escape and keeps focus inside the dialog', () => {
    let closed = false;
    render(
      <JoinMatchPage
        configured
        error={null}
        pageHref={PAGE}
        onCode={() => undefined}
        onToken={() => undefined}
        onClose={() => {
          closed = true;
        }}
      />,
    );
    expect(document.activeElement).toBe(document.querySelector('[data-testid="join-match-close"]'));
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).not.toBe(document.body);
    expect(document.querySelector('[data-testid="join-match-dialog"]')?.contains(document.activeElement)).toBe(true);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(closed).toBe(true);
  });
});
