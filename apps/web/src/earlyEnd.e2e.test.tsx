/** @vitest-environment happy-dom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { FANFARE_FILE, FANFARE_KEY } from './domain/fanfare';

const played: string[] = [];
const OriginalAudio = globalThis.Audio;

class Clip {
  src: string;
  preload = '';
  constructor(src?: string) {
    this.src = src ?? '';
  }
  play(): Promise<void> {
    played.push(this.src);
    return Promise.resolve();
  }
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

async function press(testId: string): Promise<void> {
  const node = document.querySelector(`[data-testid="${testId}"]`);
  if (!(node instanceof HTMLButtonElement)) throw new Error(`missing button ${testId}`);
  await act(async () => {
    node.click();
  });
}

async function games(team: 'a' | 'b', count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) await press(`increment-${team}`);
}

describe('early end is not a win', () => {
  const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

  beforeEach(() => {
    played.splice(0);
    globalThis.Audio = Clip as unknown as typeof Audio;
  });

  afterEach(async () => {
    for (const view of mounted.splice(0)) {
      await act(async () => {
        view.root.unmount();
      });
      view.container.remove();
    }
    localStorage.clear();
    globalThis.Audio = OriginalAudio;
  });

  it('celebrates a match that reached two sets and plays the crowd clip', async () => {
    const view = await mount();
    mounted.push(view);
    await games('a', 6);
    await games('a', 6);
    expect(document.querySelector('[data-testid="victory"]')).not.toBeNull();
    expect(document.body.textContent).toContain('Team A wins');
    expect(document.querySelector('[data-testid="match-result"]')).toBeNull();
    expect(played).toHaveLength(1);
    expect(played[0]?.endsWith(`/${FANFARE_FILE}`)).toBe(true);
    expect(played[0]?.includes('://')).toBe(false);
  });

  it('stays quiet when the victory sound is off', async () => {
    localStorage.setItem(FANFARE_KEY, 'off');
    const view = await mount();
    mounted.push(view);
    await games('a', 6);
    await games('a', 6);
    expect(document.querySelector('[data-testid="victory"]')).not.toBeNull();
    expect(played).toEqual([]);
  });

  it('shows a lead without a celebration when the match is ended early', async () => {
    const view = await mount();
    mounted.push(view);
    await games('a', 3);
    await games('b', 3);
    await games('a', 3);
    await games('a', 5);
    await games('b', 2);
    await press('end-match');
    await press('confirm-end');
    expect(document.querySelector('[data-testid="victory"]')).toBeNull();
    expect(document.querySelector('[data-testid="match-result"]')?.textContent).toBe('Team A leading');
    expect(document.body.textContent).not.toContain('wins!');
    expect(document.body.textContent).not.toContain('Team A wins');
    expect(played).toEqual([]);
  });

  it('treats 5-3 as a lead when the set is not finished', async () => {
    const view = await mount();
    mounted.push(view);
    await games('a', 5);
    await games('b', 3);
    await press('end-match');
    await press('confirm-end');
    expect(document.querySelector('[data-testid="victory"]')).toBeNull();
    expect(document.querySelector('[data-testid="match-result"]')?.textContent).toBe('Team A leading');
  });

  it('shows a draw without a celebration when neither team has won more sets', async () => {
    const view = await mount();
    mounted.push(view);
    await games('a', 6);
    await games('b', 6);
    await press('end-match');
    await press('confirm-end');
    expect(document.querySelector('[data-testid="victory"]')).toBeNull();
    expect(document.querySelector('[data-testid="match-result"]')?.textContent).toBe('Draw');
    expect(document.body.textContent).not.toContain('wins!');
  });
});
