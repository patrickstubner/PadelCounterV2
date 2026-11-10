/** @vitest-environment happy-dom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { saveArchive, type ArchivedMatch } from './domain/archive';
import { appendEvent, createLog, replay } from './domain/log';
import { STORAGE_KEY, loadLog, serializeLog } from './domain/persistence';
import { matchWinner } from './domain/rules';
import type { TeamId } from './domain/types';

const T0 = 1_700_000_000_000;
const CURRENT = '00000000-0000-4000-8000-0000000000c1';
const PAST = '00000000-0000-4000-8000-0000000000c2';

function six(team: TeamId): TeamId[] {
  return Array.from({ length: 6 }, () => team);
}

function archived(sides: readonly TeamId[]): ArchivedMatch {
  let log = createLog(T0, PAST, { a: 'Lobos', b: 'Team B' });
  for (const team of sides) {
    log = appendEvent(log, { type: 'game/increment', team, at: T0 + log.events.length + 1 });
  }
  log = appendEvent(log, { type: 'match/end', at: T0 + 800, by: 'host' });
  const state = replay(log);
  const won = state.sets.filter((set) => set.a >= 6 || set.b >= 6).length >= 2;
  return {
    id: PAST,
    at: state.updatedAt,
    teams: { a: 'Lobos', b: 'Team B' },
    sets: [state.sets[0], state.sets[1], state.sets[2]],
    status: won ? 'winner-a' : 'ended-early',
    events: log.events,
  };
}

function seed(sides: readonly TeamId[]): void {
  let current = createLog(T0 + 5_000, CURRENT);
  current = appendEvent(current, { type: 'game/increment', team: 'b', at: T0 + 5_001 });
  localStorage.setItem(STORAGE_KEY, serializeLog(current));
  saveArchive([archived(sides)], localStorage);
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

/** The saved court, so a flip animation in the digits cannot hide the real score. */
function court() {
  const log = loadLog(localStorage);
  if (!log) throw new Error('missing court log');
  return replay(log);
}

function plus(team: TeamId): HTMLButtonElement {
  const node = document.querySelector(`[data-testid="increment-${team}"]`);
  if (!(node instanceof HTMLButtonElement)) throw new Error(`missing plus ${team}`);
  return node;
}

function scoreA(): string {
  return document.querySelector('[data-testid="current-a"]')?.textContent ?? '';
}

describe('continue from history', () => {
  const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

  afterEach(async () => {
    for (const view of mounted.splice(0)) await unmount(view.root, view.container);
    localStorage.clear();
    history.replaceState(null, '');
  });

  it('asks, then resumes an early end and archives the court match', async () => {
    seed(['a', 'a', 'a']);
    const view = await mount();
    mounted.push(view);
    expect(scoreA()).toContain('0');
    await press('history-open');
    await press('match-row');
    await press('continue-match');
    expect(document.body.textContent).toContain('Continue this match?');
    expect(document.body.textContent).toContain('plays on alone');
    await press('cancel-continue');
    expect(document.querySelector('[data-testid="history-page"]')).not.toBeNull();
    await press('continue-match');
    await press('confirm-continue');
    expect(document.querySelector('[data-testid="active-set"]')?.textContent).toContain('Set 1');
    expect(scoreA()).toContain('3');
    expect(document.querySelector('[data-testid="match-status"]')).toBeNull();
    await press('increment-a');
    expect(scoreA()).toContain('4');
    expect(localStorage.getItem('pcv2:matches')).toContain(CURRENT);
    expect(localStorage.getItem('pcv2:matches')).not.toContain(PAST);
  });

  it('continues a 2–0 win on the open set and hides continue after three sets', async () => {
    seed([...six('a'), ...six('a')]);
    const twoNil = await mount();
    mounted.push(twoNil);
    await press('history-open');
    await press('match-row');
    await press('continue-match');
    expect(document.body.textContent).toContain('a set is still open');
    await press('confirm-continue');
    expect(document.querySelector('[data-testid="active-set"]')?.textContent).toContain('Set 3');
    // Regression guard: 2.3.1 left plus disabled here, so the reactivated 2–0 match could not record set 3.
    expect(court().activeSet).toBe(2);
    expect(plus('a').disabled).toBe(false);
    expect(plus('b').disabled).toBe(false);
    for (let i = 0; i < 6; i += 1) {
      expect(plus('b').disabled).toBe(false);
      await press('increment-b');
    }
    expect(court().sets).toEqual([{ a: 6, b: 0 }, { a: 6, b: 0 }, { a: 0, b: 6 }]);
    expect(matchWinner(court().sets)).toBe('a');
    expect(document.body.textContent).toContain('Win · Lobos');
    expect(document.body.textContent).not.toContain('Win · Team B');
    expect(plus('a').disabled).toBe(true);
    expect(plus('b').disabled).toBe(true);
    await press('decrement-b');
    expect(court().sets[2]).toEqual({ a: 0, b: 5 });
    expect(court().sets[1]).toEqual({ a: 6, b: 0 });
    expect(plus('a').disabled).toBe(false);
    await press('increment-a');
    expect(court().sets[2]).toEqual({ a: 1, b: 5 });
    expect(matchWinner(court().sets)).toBe('a');
    expect(document.body.textContent).toContain('Win · Lobos');
    await unmount(twoNil.root, twoNil.container);
    mounted.pop();

    localStorage.clear();
    seed([...six('a'), ...six('b'), ...six('a')]);
    const twoOne = await mount();
    mounted.push(twoOne);
    await press('history-open');
    await press('match-row');
    expect(document.querySelector('[data-testid="continue-match"]')).toBeNull();
  });

  it('opens plus on set 3 of a 2–0 win on the court and keeps the winner', async () => {
    let log = createLog(T0, CURRENT, { a: 'Lobos', b: 'Team B' });
    for (const team of [...six('a'), ...six('a')]) {
      log = appendEvent(log, { type: 'game/increment', team, at: T0 + log.events.length + 1 });
    }
    localStorage.setItem(STORAGE_KEY, serializeLog(log));
    const view = await mount();
    mounted.push(view);
    expect(court().activeSet).toBe(1);
    expect(plus('a').disabled).toBe(true);
    expect(plus('b').disabled).toBe(true);
    await press('set-b-3');
    expect(court().activeSet).toBe(2);
    expect(plus('a').disabled).toBe(false);
    expect(plus('b').disabled).toBe(false);
    await press('increment-b');
    await press('increment-b');
    await press('decrement-b');
    expect(court().sets[2]).toEqual({ a: 0, b: 1 });
    expect(matchWinner(court().sets)).toBe('a');
    expect(document.body.textContent).toContain('Win · Lobos');
  });

  it('does not show the celebration again after continue', async () => {
    let log = createLog(T0, PAST, { a: 'Lobos', b: 'Team B' });
    const sides: TeamId[] = [...six('a'), 'a', 'a', 'a', 'a', 'a'];
    for (const team of sides) {
      log = appendEvent(log, { type: 'game/increment', team, at: T0 + log.events.length + 1 });
    }
    localStorage.setItem(STORAGE_KEY, serializeLog(log));
    const view = await mount();
    mounted.push(view);
    expect(document.querySelector('[data-testid="victory"]')).toBeNull();
    await press('increment-a');
    expect(document.querySelector('[data-testid="victory"]')).not.toBeNull();
    await press('new-match');
    await press('finish-and-new');
    expect(document.querySelector('[data-testid="victory"]')).toBeNull();
    await press('history-open');
    await press('match-row');
    await press('continue-match');
    await press('confirm-continue');
    expect(document.querySelector('[data-testid="victory"]')).toBeNull();
    await press('increment-b');
    expect(court().sets[2]).toEqual({ a: 0, b: 1 });
    expect(document.querySelector('[data-testid="victory"]')).toBeNull();
  });
});
