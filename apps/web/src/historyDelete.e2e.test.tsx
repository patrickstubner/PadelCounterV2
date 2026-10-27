/** @vitest-environment happy-dom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { ARCHIVE_KEY, saveArchive } from './domain/archive';
import { CELEBRATED_KEY, saveCelebrated } from './domain/celebration';
import { appendEvent, createLog } from './domain/log';
import { STORAGE_KEY, serializeLog } from './domain/persistence';
import { sessionReducer } from './domain/session';

const PAST = '00000000-0000-4000-8000-0000000000aa';
const LIVE = '00000000-0000-4000-8000-0000000000bb';
const T0 = 1_700_000_000_000;

function seed(celebratedId: string | null): void {
  let log = createLog(T0, PAST, { a: 'Lobos', b: 'Team B' });
  log = appendEvent(log, { type: 'game/increment', team: 'a', at: T0 + 1 });
  const archived = sessionReducer(
    { log, archive: [] },
    { type: 'record', event: { type: 'match/new', matchId: LIVE, at: T0 + 2 } },
  );
  localStorage.clear();
  localStorage.setItem(STORAGE_KEY, serializeLog(archived.log));
  saveArchive(archived.archive, localStorage);
  if (celebratedId) saveCelebrated({ matchId: celebratedId, at: T0 + 1 }, localStorage);
  history.replaceState(null, '');
}

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

function deleteButton(): HTMLButtonElement | null {
  const node = document.querySelector('[data-testid="delete-match"]');
  return node instanceof HTMLButtonElement ? node : null;
}

describe('delete a match from History', () => {
  const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

  afterEach(async () => {
    for (const view of mounted.splice(0)) await unmount(view.root, view.container);
    localStorage.clear();
    history.replaceState(null, '');
  });

  async function openHistory(): Promise<void> {
    const view = await mount();
    mounted.push(view);
    await press('open-matches');
  }

  it('keeps the match when Cancel is chosen, including after a reload', async () => {
    seed(null);
    await openHistory();
    expect(document.querySelector('[data-testid="history-current"]')?.textContent).toContain('0:0');
    expect(document.querySelector('[data-testid="history-current"] [data-testid="delete-match"]')).toBeNull();
    expect(deleteButton()?.getAttribute('aria-label')).toBe('Delete match Lobos versus Team B');

    await press('delete-match');
    expect(document.body.textContent).toContain('Delete this match?');
    expect(document.querySelector('[data-testid="cancel-delete"]')?.textContent).toBe('Cancel');
    expect(document.querySelector('[data-testid="confirm-delete"]')?.textContent).toBe('Delete');
    await press('cancel-delete');
    expect(document.body.textContent).not.toContain('Delete this match?');
    expect(deleteButton()).not.toBeNull();
    expect(localStorage.getItem(ARCHIVE_KEY)).toContain(PAST);

    for (const view of mounted.splice(0)) await unmount(view.root, view.container);
    history.replaceState(null, '');
    await openHistory();
    expect(deleteButton()?.getAttribute('data-match-id')).toBe(PAST);
    expect(localStorage.getItem(ARCHIVE_KEY)).toContain(PAST);
    expect(localStorage.getItem(STORAGE_KEY)).toContain(LIVE);
  });

  it('removes the match on Delete and keeps it gone after a reload', async () => {
    seed(PAST);
    await openHistory();
    await press('delete-match');
    await press('confirm-delete');
    expect(document.body.textContent).not.toContain('Delete this match?');
    expect(deleteButton()).toBeNull();
    expect(document.body.textContent).toContain('No other matches.');
    expect(document.body.textContent).toContain('0:0');
    expect(localStorage.getItem(ARCHIVE_KEY)).not.toContain(PAST);
    expect(localStorage.getItem(CELEBRATED_KEY)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toContain(LIVE);
    expect(localStorage.getItem(STORAGE_KEY)).not.toContain(PAST);
    expect(localStorage.getItem(STORAGE_KEY)).not.toContain('Lobos');

    for (const view of mounted.splice(0)) await unmount(view.root, view.container);
    history.replaceState(null, '');
    await openHistory();
    expect(deleteButton()).toBeNull();
    expect(document.body.textContent).toContain('No other matches.');
    expect(localStorage.getItem(ARCHIVE_KEY)).not.toContain(PAST);
    expect(document.querySelector('[data-testid="current-a"]')).toBeNull();
    await press('history-back');
    expect(document.querySelector('[data-testid="current-a"]')?.textContent).toContain('0');
    expect(document.querySelector('[data-testid="current-b"]')?.textContent).toContain('0');
  });

  it('does not bring a deleted match back when a new match starts', async () => {
    seed(PAST);
    const view = await mount();
    mounted.push(view);
    await press('increment-a');
    await press('open-matches');
    await press('delete-match');
    await press('confirm-delete');
    expect(localStorage.getItem(STORAGE_KEY)).not.toContain(PAST);
    expect(localStorage.getItem(STORAGE_KEY)).not.toContain('Lobos');
    expect(localStorage.getItem(CELEBRATED_KEY)).toBeNull();

    await press('history-back');
    expect(document.querySelector('[data-testid="current-a"]')?.textContent).toContain('1');
    expect(document.body.textContent).not.toContain('Lobos');
    expect(document.querySelector('[data-testid="undo"]')).toBeNull();

    for (const open of mounted.splice(0)) await unmount(open.root, open.container);
    history.replaceState(null, '');
    const reloaded = await mount();
    mounted.push(reloaded);
    expect(document.body.textContent).not.toContain('Lobos');
    expect(localStorage.getItem(STORAGE_KEY)).not.toContain(PAST);

    await press('new-match');
    await press('finish-and-new');
    await press('open-matches');
    expect(document.body.textContent).not.toContain('Lobos');
    expect(deleteButton()?.getAttribute('data-match-id')).toBe(LIVE);
    expect(localStorage.getItem(ARCHIVE_KEY)).toContain(LIVE);
    expect(localStorage.getItem(ARCHIVE_KEY)).not.toContain(PAST);

    for (const open of mounted.splice(0)) await unmount(open.root, open.container);
    history.replaceState(null, '');
    await openHistory();
    expect(document.body.textContent).not.toContain('Lobos');
    expect(deleteButton()?.getAttribute('data-match-id')).toBe(LIVE);
    expect(localStorage.getItem(STORAGE_KEY)).not.toContain(PAST);
    expect(localStorage.getItem(ARCHIVE_KEY)).not.toContain(PAST);
  });

  it('leaves the live celebration key alone when another match is deleted', async () => {
    seed(LIVE);
    await openHistory();
    expect(document.querySelector(`[data-match-id="${LIVE}"]`)).toBeNull();
    await press('delete-match');
    await press('confirm-delete');
    expect(localStorage.getItem(CELEBRATED_KEY)).toContain(LIVE);
    expect(localStorage.getItem(STORAGE_KEY)).toContain(LIVE);
  });
});
