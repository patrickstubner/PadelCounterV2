/** @vitest-environment happy-dom */
import { ROOM_MESSAGES } from '@padel/core';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JoinMatchPage } from './JoinMatchPage';

const PAGE = 'https://patrickstubner.github.io/PadelCounterV2/';
const TOKEN = 'abcdefghijklmnopqrstuv';

let root: Root | null = null;

afterEach(() => {
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

function camera() {
  const stop = vi.fn();
  const stream = new MediaStream();
  Object.defineProperty(stream, 'getTracks', { value: () => [{ stop }] });
  const getUserMedia = vi.fn(async () => stream);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
  HTMLVideoElement.prototype.play = () => Promise.resolve();
  return { stop, getUserMedia };
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
    expect(scanned).toBeGreaterThan(0);
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
      setter?.call(input, 'k7m42q');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      document.querySelector<HTMLButtonElement>('[data-testid="join-by-code"]')?.click();
    });
    expect(codes).toEqual(['K7M-42Q']);
  });
});
