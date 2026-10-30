import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from '../App';
import { CourtHeader, type CourtAction } from './CourtHeader';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

const actions: readonly CourtAction[] = [
  { id: 'resume', label: 'Resume', testId: 'resume-match', disabled: true, emphasized: true, onSelect: () => undefined },
  { id: 'history', label: 'History', testId: 'history-open', onSelect: () => undefined },
  { id: 'end', label: 'End match', testId: 'end-match', onSelect: () => undefined },
  { id: 'reset', label: 'New match', testId: 'new-match', onSelect: () => undefined },
];

describe('court header', () => {
  it('puts the set name in the header and keeps the menu closed', () => {
    const html = renderToStaticMarkup(<CourtHeader setLabel="Set 2" onBrand={() => undefined} actions={actions} layout="menu" />);
    expect(html).toContain('>Padel Counter V2<');
    expect(html).toContain('data-testid="active-set"');
    expect(html).toContain('>Set 2<');
    expect(html).toContain('aria-label="Menu"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="');
    expect(html).toContain('role="menu"');
    expect(html).toContain('role="menuitem"');
    expect(html).toContain('hidden=""');
    const toggle = html.match(/<button[^>]*data-testid="menu-toggle"[^>]*>/)?.[0] ?? '';
    const controls = toggle.match(/aria-controls="([^"]+)"/)?.[1];
    expect(controls).toBeTruthy();
    expect(html).toContain(`id="${controls}"`);
    expect(html.indexOf('data-testid="active-set"')).toBeLessThan(html.indexOf('data-testid="menu-toggle"'));
  });

  it('uses one row of buttons when the landscape bar fits', () => {
    const html = renderToStaticMarkup(<CourtHeader setLabel="Set 1" onBrand={() => undefined} actions={actions} layout="bar" />);
    expect(html).not.toContain('data-testid="menu-toggle"');
    expect(html).toContain('data-testid="resume-match"');
    expect(html).toContain('data-testid="end-match"');
    expect(html).not.toContain('role="menu"');
  });

  it('keeps Add to Home Screen last in the menu and out of the landscape bar', () => {
    const install: CourtAction = {
      id: 'install',
      label: 'Add to Home Screen',
      testId: 'add-to-home-screen',
      menuOnly: true,
      textOnly: true,
      detail: 'Share → Add to Home Screen',
      onSelect: () => undefined,
    };
    const first = actions[0];
    if (!first) throw new Error('missing action');
    const mixed: readonly CourtAction[] = [first, install, ...actions.slice(1)];
    const menu = renderToStaticMarkup(<CourtHeader setLabel="Set 1" onBrand={() => undefined} actions={mixed} layout="menu" />);
    expect(menu.indexOf('data-testid="new-match"')).toBeLessThan(menu.indexOf('data-testid="add-to-home-screen"'));
    expect(menu.indexOf('>Add to Home Screen<')).toBeLessThan(menu.indexOf('Share → Add to Home Screen'));
    expect(menu).toContain('class="menu-note" role="note"');
    expect(menu).not.toContain('aria-disabled');
    const menuRole = menu.slice(menu.indexOf('role="menu"'), menu.indexOf('role="note"'));
    expect(menuRole).toContain('data-testid="new-match"');
    expect(menuRole).not.toContain('add-to-home-screen');
    const bar = renderToStaticMarkup(<CourtHeader setLabel="Set 1" onBrand={() => undefined} actions={mixed} layout="bar" />);
    expect(bar).not.toContain('add-to-home-screen');
    expect(bar).not.toContain('Add to Home Screen');
    expect(bar).toContain('data-testid="new-match"');
  });

  it('draws an inline phone before the connected count', () => {
    const menu = renderToStaticMarkup(
      <CourtHeader setLabel="Set 1" onBrand={() => undefined} actions={actions} layout="menu" phoneCount={3} onPhones={() => undefined} />,
    );
    const button = menu.slice(menu.indexOf('data-testid="phone-count"'), menu.indexOf('data-testid="menu-toggle"'));
    expect(button).toContain('aria-label="3 phones connected"');
    expect(button.indexOf('<svg')).toBeLessThan(button.indexOf('phone-count-num'));
    expect(button).toContain('>3<');
    expect(button).toContain('aria-hidden="true"');
    expect(button).not.toContain('<img');
    expect(button).not.toContain('http');
    expect(button).not.toContain('href=');
    const bar = renderToStaticMarkup(
      <CourtHeader setLabel="Set 1" onBrand={() => undefined} actions={actions} layout="bar" phoneCount={1} onPhones={() => undefined} />,
    );
    expect(bar).toContain('aria-label="1 phones connected"');
    expect(bar).toContain('class="phone-icon"');
    expect(bar).toContain('>1<');
  });

  it('gives menu rows at least 56px and tightens the title', () => {
    const css = readFileSync(join(root, 'src/app.css'), 'utf8');
    const item = css.slice(css.indexOf('.menu-item {'), css.indexOf('.menu-item.is-emphasis'));
    expect(item).toContain('height: 56px');
    expect(item).toContain('min-height: 56px');
    expect(item).toContain('white-space: nowrap');
    const menu = css.slice(css.indexOf('.match-menu {'), css.indexOf('.match-menu[hidden]'));
    expect(menu).toContain('position: absolute');
    expect(menu).toContain('gap: 0.5rem');
    expect(menu).toContain('overflow-y: auto');
    expect(menu).toContain('max-height: calc(100dvh - 4.25rem)');
    const note = css.slice(css.indexOf('.menu-note {'), css.indexOf('.menu-hint'));
    expect(note).toContain('border: 0');
    expect(note).toContain('color: #b4bdd4');
    expect(note).toContain('white-space: nowrap');
    expect(note).not.toContain('border: 2px solid');
    const hint = css.slice(css.indexOf('.menu-hint {'), css.indexOf('.menu-item:disabled'));
    expect(hint).toContain('white-space: nowrap');
    expect(hint).toContain('color: #b4bdd4');
    expect(css).not.toContain('.menu-item.has-detail');
    const brand = css.slice(css.indexOf('.brand {'), css.indexOf('.brand-btn'));
    expect(brand).toContain('letter-spacing: 0.08em');
    expect(brand).not.toContain('letter-spacing: 0.16em');
  });
});

describe('court header in the app', () => {
  it('moves Set 1 out from between the teams', () => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
      },
    });
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain('data-testid="active-set">Set 1<');
    expect(html).not.toContain('chip-set');
    expect(html).toContain('data-testid="menu-toggle"');
    expect(html).toContain('aria-expanded="false"');
    const mid = html.slice(html.indexOf('class="mid"'), html.indexOf('class="team team-b"'));
    expect(mid).not.toContain('Set 1');
  });
});
