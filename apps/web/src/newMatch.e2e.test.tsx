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

  const named = (scoredAgo: number, names: { a?: string; b?: string } = { a: 'Anna & Ben', b: 'Carla & Dan' }) => {
    const scoredAt = Date.now() - scoredAgo;
    let log = createLog(scoredAt - 1_000, LIVE);
    if (names.a) log = appendEvent(log, { type: 'team/rename', team: 'a', name: names.a, at: scoredAt - 500 });
    if (names.b) log = appendEvent(log, { type: 'team/rename', team: 'b', name: names.b, at: scoredAt - 400 });
    log = appendEvent(log, { type: 'game/increment', team: 'a', at: scoredAt });
    localStorage.setItem(STORAGE_KEY, serializeLog(log));
  };
  const box = (testId: string) => document.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`);
  const teamName = (team: 'a' | 'b') => document.querySelector(`.team-${team} .team-name`)?.textContent ?? '';

  it('keeps typed team names by default inside the hour, without a phones box', async () => {
    named(10 * 60_000);
    const view = await mount();
    mounted.push(view);
    await press('new-match');
    expect(box('carry-names')?.checked).toBe(true);
    expect(box('carry-phones')).toBeNull();
    expect(document.body.textContent).toContain('Keep team names (Anna & Ben · Carla & Dan)');
    const dialog = document.querySelector('dialog[aria-labelledby="new-match-title"]');
    expect(dialog?.querySelectorAll('button')).toHaveLength(2);
    await press('finish-and-new');
    expect(scoreA()).toContain('0');
    expect(teamName('a')).toBe('Anna & Ben');
    expect(teamName('b')).toBe('Carla & Dan');
    expect(localStorage.getItem(ARCHIVE_KEY)).toContain(LIVE);
  });

  it('leaves the names box off more than an hour after the last score change', async () => {
    named(60 * 60_000 + 5_000);
    const view = await mount();
    mounted.push(view);
    await press('new-match');
    expect(box('carry-names')?.checked).toBe(false);
    await press('finish-and-new');
    expect(teamName('a')).toBe('Team A');
    expect(teamName('b')).toBe('Team B');
  });

  it('starts with Team A and Team B when the names box is cleared', async () => {
    named(60_000);
    const view = await mount();
    mounted.push(view);
    await press('new-match');
    await act(async () => {
      box('carry-names')?.click();
    });
    expect(box('carry-names')?.checked).toBe(false);
    await press('finish-and-new');
    expect(teamName('a')).toBe('Team A');
    expect(teamName('b')).toBe('Team B');
  });

  it('keeps one typed name and the default on the other side', async () => {
    named(60_000, { b: 'Lions' });
    const view = await mount();
    mounted.push(view);
    await press('new-match');
    expect(document.body.textContent).toContain('Keep team names (Team A · Lions)');
    await press('finish-and-new');
    expect(teamName('a')).toBe('Team A');
    expect(teamName('b')).toBe('Lions');
  });

  it('cancel keeps the match, its score and its names', async () => {
    named(60_000);
    const view = await mount();
    mounted.push(view);
    await press('new-match');
    await press('cancel-new-match');
    expect(scoreA()).toContain('1');
    expect(teamName('a')).toBe('Anna & Ben');
    expect(localStorage.getItem(STORAGE_KEY)).not.toContain('match/end');
  });

  it('shows no names box while the teams are still Team A and Team B', async () => {
    named(60_000, {});
    const view = await mount();
    mounted.push(view);
    await press('new-match');
    expect(document.body.textContent).toContain('Finish current match and start a new one?');
    expect(box('carry-names')).toBeNull();
    expect(box('carry-phones')).toBeNull();
    await press('cancel-new-match');
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
