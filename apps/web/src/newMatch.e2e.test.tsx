/** @vitest-environment happy-dom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { ARCHIVE_KEY } from './domain/archive';
import { FANFARE_KEY } from './domain/fanfare';
import { appendEvent, createLog } from './domain/log';
import { STORAGE_KEY, serializeLog } from './domain/persistence';

const LIVE = '00000000-0000-4000-8000-0000000000bb';
const T0 = 1_700_000_000_000;

async function mount(): Promise<{ root: Root; container: HTMLDivElement }> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<App />);
  });
  return { root, container };
}

async function unmount(root: Root, container: HTMLDivElement): Promise<void> {
  await act(async () => {
    root.unmount();
  });
  container.remove();
}

async function press(testId: string): Promise<void> {
  const node = document.querySelector(`[data-testid="${testId}"]`);
  if (!(node instanceof HTMLButtonElement)) throw new Error(`missing button ${testId}`);
  await act(async () => {
    node.click();
  });
}

function scoreA(): string {
  return document.querySelector('[data-testid="current-a"]')?.textContent ?? '';
}

describe('new match dialog', () => {
  const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

  afterEach(async () => {
    for (const view of mounted.splice(0)) await unmount(view.root, view.container);
    localStorage.clear();
    history.replaceState(null, '');
  });

  it('does not end a blank court, and cancel leaves the score', async () => {
    const view = await mount();
    mounted.push(view);
    await press('new-match');
    expect(document.body.textContent).toContain('New match?');
    expect(document.querySelector('[data-testid="reconnect-players"]')).toBeNull();
    await press('cancel-new-match');
    expect(document.body.textContent).not.toContain('Finish current match');
    expect(scoreA()).toContain('0');
    expect(localStorage.getItem(STORAGE_KEY)).not.toContain('match/end');
  });

  it('asks before finishing an open match and cancel does not end it', async () => {
    const view = await mount();
    mounted.push(view);
    await press('increment-a');
    await press('new-match');
    expect(document.body.textContent).toContain('Finish current match and start a new one?');
    expect(document.body.textContent).toContain('Finish & new');
    const toggle = document.querySelector('[data-testid="reconnect-players"]');
    expect(toggle).toBeInstanceOf(HTMLInputElement);
    expect((toggle as HTMLInputElement).checked).toBe(false);
    await press('cancel-new-match');
    expect(scoreA()).toContain('1');
    expect(localStorage.getItem(STORAGE_KEY)).not.toContain('match/end');
  });

  it('finish and new archives the ended match', async () => {
    let log = createLog(T0, LIVE);
    log = appendEvent(log, { type: 'game/increment', team: 'a', at: T0 + 1 });
    localStorage.setItem(STORAGE_KEY, serializeLog(log));
    const view = await mount();
    mounted.push(view);
    await press('increment-a');
    await press('new-match');
    await press('finish-and-new');
    expect(scoreA()).toContain('0');
    expect(localStorage.getItem(ARCHIVE_KEY)).toContain(LIVE);
    expect(localStorage.getItem(ARCHIVE_KEY)).toContain('match/end');
  });

  it('hides reconnect when the last game is older than an hour', async () => {
    let log = createLog(T0, LIVE);
    log = appendEvent(log, { type: 'game/increment', team: 'a', at: T0 + 1 });
    localStorage.setItem(STORAGE_KEY, serializeLog(log));
    const view = await mount();
    mounted.push(view);
    await press('new-match');
    expect(document.body.textContent).toContain('Finish current match and start a new one?');
    expect(document.querySelector('[data-testid="reconnect-players"]')).toBeNull();
    await press('cancel-new-match');
    expect(scoreA()).toContain('1');
  });

  it('stores the victory sound choice under pcv2 and defaults to on', async () => {
    const view = await mount();
    mounted.push(view);
    expect(document.querySelector('[data-testid="fanfare-toggle"]')?.textContent).toContain('Victory sound: On');
    await press('fanfare-toggle');
    expect(localStorage.getItem(FANFARE_KEY)).toBe('off');
    expect(document.querySelector('[data-testid="fanfare-toggle"]')?.textContent).toContain('Victory sound: Off');
  });
});
