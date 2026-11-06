/** @vitest-environment happy-dom */
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./app.css', () => ({}));
vi.mock('./registerServiceWorker', () => ({ registerServiceWorker: () => undefined }));

const TOKEN = 'abcdefghijklmnopqrstuv';

let unmountPage: (() => void) | null = null;

function mountRoot(): void {
  document.body.replaceChildren();
  const root = document.createElement('div');
  root.id = 'root';
  document.body.append(root);
}

async function bootIndex(): Promise<void> {
  mountRoot();
  vi.resetModules();
  await act(async () => {
    const page = await import('./index');
    unmountPage = page.unmountPage;
  });
}

describe('index boot join', () => {
  afterEach(async () => {
    await act(async () => {
      unmountPage?.();
    });
    unmountPage = null;
    document.body.replaceChildren();
    vi.resetModules();
    vi.unstubAllGlobals();
    window.history.replaceState(null, '', '/');
  });

  it('strips a malicious short-code fragment before paint and does not render it', async () => {
    window.history.replaceState(null, '', '/PadelCounterV2/#join=EVILPAYLOAD');
    await bootIndex();
    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toContain('EVILPAYLOAD');
    expect(window.location.pathname).toBe('/PadelCounterV2/');
    expect(document.body.textContent).not.toContain('EVILPAYLOAD');
    expect(document.body.textContent).toContain('This code is not valid.');
  });

  it('does not follow a fragment that looks like another site', async () => {
    const origin = window.location.origin;
    window.history.replaceState(null, '', '/PadelCounterV2/#join=https://evil.example/steal');
    await bootIndex();
    expect(window.location.origin).toBe(origin);
    expect(window.location.pathname).toBe('/PadelCounterV2/');
    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toContain('evil.example');
    expect(document.body.textContent).not.toContain('evil.example');
  });

  it('shows an error for an invalid fragment and removes it', async () => {
    window.history.replaceState(null, '', `/PadelCounterV2/#/join?t=short`);
    await bootIndex();
    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toContain('short');
    expect(document.body.textContent).toContain('Could not join this match.');
    expect(document.body.textContent).toContain('This code is not valid.');
  });

  it('strips a valid token when sessionStorage throws and still starts the join', async () => {
    window.history.replaceState(null, '', `/PadelCounterV2/#/join?t=${TOKEN}`);
    vi.stubGlobal('sessionStorage', {
      get length() {
        throw new Error('blocked');
      },
      clear() {
        throw new Error('blocked');
      },
      getItem() {
        throw new Error('blocked');
      },
      key() {
        throw new Error('blocked');
      },
      removeItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    });
    await bootIndex();
    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toContain(TOKEN);
    expect(document.body.textContent).not.toContain(TOKEN);
    expect(document.body.textContent).toContain('Could not join this match.');
    expect(document.body.textContent).toContain('Live sharing is not configured in this build.');
  });
});
