/** @vitest-environment happy-dom */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { COURT_CHROME, syncCourtChrome, type CourtChromeTone } from './chrome';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');

function meta(name: string, content: string): void {
  const node = document.createElement('meta');
  node.setAttribute('name', name);
  node.setAttribute('content', content);
  document.head.append(node);
}

function installChrome(): void {
  document.head.replaceChildren();
  meta('theme-color', '#000000');
  meta('apple-mobile-web-app-status-bar-style', 'black-translucent');
  document.documentElement.className = '';
}

describe('court chrome', () => {
  const roots: Root[] = [];

  afterEach(() => {
    for (const view of roots.splice(0)) view.unmount();
    document.body.replaceChildren();
    document.documentElement.className = '';
  });

  it('syncs theme-color with the header for solo, connected, and offline', () => {
    installChrome();
    const cases: Array<[CourtChromeTone, string, boolean, boolean]> = [
      ['local', COURT_CHROME.local, false, false],
      ['online', COURT_CHROME.online, true, false],
      ['offline', COURT_CHROME.offline, false, true],
      ['local', COURT_CHROME.local, false, false],
    ];
    for (const [tone, color, online, offline] of cases) {
      syncCourtChrome(tone, document);
      expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(color);
      expect(document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.getAttribute('content')).toBe('black-translucent');
      expect(document.documentElement.classList.contains('is-online')).toBe(online);
      expect(document.documentElement.classList.contains('is-offline')).toBe(offline);
    }
    expect(COURT_CHROME.online).toBe('#0a1a3f');
    expect(COURT_CHROME.offline).toBe('#3a1016');
    expect(COURT_CHROME.local).toBe('#000000');
  });

  it('paints the page and the safe area with the header colour', () => {
    const css = readFileSync(join(rootDir, 'src/app.css'), 'utf8');
    const page = css.slice(css.indexOf('html,\nbody,\n#root {'), css.indexOf('body {'));
    expect(page).toContain('background: var(--bar)');
    expect(page).not.toContain('background: var(--bg)');
    expect(css).toContain('html.is-online { --bar: var(--bar-online); }');
    expect(css).toContain('html.is-offline { --bar: var(--bar-offline); }');
    const shell = css.slice(css.indexOf('.app {'), css.indexOf('.top,'));
    expect(shell).toContain('background: var(--bar)');
    expect(shell).toContain('env(safe-area-inset-top)');
    expect(shell).toContain('env(safe-area-inset-bottom)');
    const portrait = css.indexOf('@media (orientation: portrait)');
    const foot = css.indexOf('.court-foot .rules { display: none; }');
    expect(foot).toBeGreaterThan(-1);
    expect(foot).toBeLessThan(portrait);
  });

  it('starts a solo court on the black header colour', async () => {
    installChrome();
    const holder = document.createElement('div');
    document.body.append(holder);
    const view = createRoot(holder);
    roots.push(view);
    await act(async () => {
      view.render(<App />);
    });
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#000000');
    expect(document.documentElement.classList.contains('is-online')).toBe(false);
    expect(document.documentElement.classList.contains('is-offline')).toBe(false);
    expect(document.querySelector('.app')?.className).toBe('app');
  });
});
