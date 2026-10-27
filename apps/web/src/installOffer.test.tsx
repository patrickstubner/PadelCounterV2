import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import {
  IOS_INSTALL_HINT,
  installOffer,
  isIosSafari,
  isRunningStandalone,
  listenForInstallPrompt,
  readInstallClient,
  runInstallPrompt,
  storedPromptAfter,
  type InstallPromptLike,
} from './installOffer';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD_SAFARI =
  'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD_OS =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0.6613.98 Mobile/15E148 Safari/604.1';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.6613.88 Mobile Safari/537.36';

function rememberStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  });
}

function setClient(ua: string, platform: string, touch: number, standalone = false) {
  vi.stubGlobal('navigator', {
    userAgent: ua,
    platform,
    maxTouchPoints: touch,
    standalone,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('install offer', () => {
  it('recognises iOS Safari and ignores other browsers', () => {
    expect(isIosSafari({ userAgent: IPHONE_SAFARI, platform: 'iPhone', maxTouchPoints: 5 })).toBe(true);
    expect(isIosSafari({ userAgent: IPAD_SAFARI, platform: 'iPad', maxTouchPoints: 5 })).toBe(true);
    expect(isIosSafari({ userAgent: IPAD_OS, platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true);
    expect(isIosSafari({ userAgent: IPAD_OS, platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false);
    expect(isIosSafari({ userAgent: IPHONE_CHROME, platform: 'iPhone', maxTouchPoints: 5 })).toBe(false);
    expect(isIosSafari({ userAgent: ANDROID_CHROME, platform: 'Linux armv8l', maxTouchPoints: 5 })).toBe(false);
    expect(isIosSafari({ userAgent: 'Node.js/22', platform: 'Linux', maxTouchPoints: 0 })).toBe(false);
  });

  it('hides the offer when the app is already standalone', () => {
    expect(isRunningStandalone({ displayModeStandalone: true, navigatorStandalone: false })).toBe(true);
    expect(isRunningStandalone({ displayModeStandalone: false, navigatorStandalone: true })).toBe(true);
    expect(installOffer({ standalone: true, iosSafari: true, canPrompt: true })).toBe('hidden');
    expect(installOffer({ standalone: false, iosSafari: false, canPrompt: true })).toBe('prompt');
    expect(installOffer({ standalone: false, iosSafari: true, canPrompt: false })).toBe('ios');
    expect(installOffer({ standalone: false, iosSafari: false, canPrompt: false })).toBe('hidden');
  });

  it('captures beforeinstallprompt and calls prompt on request', async () => {
    const host = new EventTarget();
    const seen: InstallPromptLike[] = [];
    const stop = listenForInstallPrompt(host, (event) => seen.push(event));
    const bare = new Event('beforeinstallprompt', { cancelable: true });
    host.dispatchEvent(bare);
    expect(bare.defaultPrevented).toBe(false);
    expect(seen).toHaveLength(0);

    let prompted = 0;
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.assign(event, {
      prompt() {
        prompted += 1;
        expect(this).toBe(event);
        return Promise.resolve();
      },
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    });
    host.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    const captured = seen[0];
    if (!captured) throw new Error('missing prompt');
    await expect(runInstallPrompt(captured)).resolves.toBe('accepted');
    expect(prompted).toBe(1);

    stop();
    const again = new Event('beforeinstallprompt', { cancelable: true });
    Object.assign(again, { prompt: () => Promise.resolve() });
    host.dispatchEvent(again);
    expect(seen).toHaveLength(1);
    expect(again.defaultPrevented).toBe(false);
  });

  it('reports a dismissed install prompt', async () => {
    const outcome = await runInstallPrompt({
      prompt: () => Promise.resolve(),
      userChoice: Promise.resolve({ outcome: 'dismissed' }),
    });
    expect(outcome).toBe('dismissed');
    await expect(runInstallPrompt({ prompt: () => Promise.resolve() })).resolves.toBe('unknown');
  });

  it('keeps the stored event when prompt() fails and drops it after success', async () => {
    const event: InstallPromptLike = {
      prompt: () => Promise.reject(new Error('blocked')),
    };
    await expect(runInstallPrompt(event)).resolves.toBe('failed');
    expect(storedPromptAfter(event, 'failed')).toBe(event);
    expect(storedPromptAfter(event, 'accepted')).toBeNull();
    expect(storedPromptAfter(event, 'dismissed')).toBeNull();
    expect(storedPromptAfter(event, 'unknown')).toBeNull();
    await expect(runInstallPrompt({
      prompt: () => Promise.resolve(),
      userChoice: Promise.reject(new Error('closed')),
    })).resolves.toBe('unknown');
  });
});

describe('Add to Home Screen in the app', () => {
  it('shows the iOS instruction as the last menu item', () => {
    rememberStorage();
    setClient(IPHONE_SAFARI, 'iPhone', 5);
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain('>Add to Home Screen<');
    expect(html).toContain(`>${IOS_INSTALL_HINT}<`);
    expect(IOS_INSTALL_HINT).toBe('Share → Add to Home Screen');
    expect(html).toContain('role="note"');
    expect(html).not.toContain('aria-disabled');
    expect(html.indexOf('data-testid="new-match"')).toBeLessThan(html.indexOf('data-testid="add-to-home-screen"'));
    expect(html).toContain('data-testid="menu-toggle"');
  });

  it('hides the item when already running standalone', () => {
    rememberStorage();
    setClient(IPHONE_SAFARI, 'iPhone', 5, true);
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(display-mode: standalone)',
      addEventListener() {},
      removeEventListener() {},
    }));
    const html = renderToStaticMarkup(<App />);
    expect(readInstallClient().displayModeStandalone).toBe(true);
    expect(html).not.toContain('Add to Home Screen');
    expect(html).not.toContain(IOS_INSTALL_HINT);
    expect(html).toContain('data-testid="new-match"');
  });

  it('stays hidden on a desktop browser until beforeinstallprompt', () => {
    rememberStorage();
    setClient(ANDROID_CHROME, 'Linux armv8l', 5);
    const html = renderToStaticMarkup(<App />);
    expect(html).not.toContain('Add to Home Screen');
    expect(html).toContain('data-testid="menu-toggle"');
  });
});
