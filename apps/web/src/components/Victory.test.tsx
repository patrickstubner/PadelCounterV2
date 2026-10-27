import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App';
import { CELEBRATED_KEY, celebrationKey, currentWin } from '../domain/celebration';
import { appendEvent, createLog, undoLog } from '../domain/log';
import { STORAGE_KEY, serializeLog } from '../domain/persistence';
import type { MatchLog } from '../domain/log';
import type { TeamId } from '../domain/types';
import { Victory } from './Victory';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const ID = '00000000-0000-4000-8000-00000000000c';
const T0 = 1_700_000_000_000;

function games(log: MatchLog, team: TeamId, count: number, at: number): MatchLog {
  let next = log;
  for (let i = 0; i < count; i += 1) {
    next = appendEvent(next, { type: 'game/increment', team, at: at + i });
  }
  return next;
}

function save(log: MatchLog): void {
  localStorage.setItem(STORAGE_KEY, serializeLog(log));
}

describe('victory celebration', () => {
  beforeEach(() => {
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
  });

  it('shows a calm card without a confetti canvas when motion is reduced', () => {
    const html = renderToStaticMarkup(<Victory name="Team A" team="a" reducedMotion onClose={() => undefined} />);
    expect(html).toContain('Team A wins!');
    expect(html).toContain('is-calm');
    expect(html).toContain('Tap to close');
    expect(html).not.toContain('<canvas');
  });

  it('stays quiet for an already won match on first start', () => {
    const wonLog = games(games(createLog(T0, ID), 'a', 6, T0 + 1), 'a', 6, T0 + 20);
    save(wonLog);
    const won = renderToStaticMarkup(<App />);
    expect(won).not.toContain('data-testid="victory"');
    expect(won).toContain('data-testid="final-score"');
    expect(won).toContain('Final score');
    expect(won).toContain('>6<');
    expect(won).not.toContain('data-testid="undo"');
    const win = currentWin(wonLog);
    expect(win).not.toBeNull();
    expect(localStorage.getItem(CELEBRATED_KEY)).toBe(JSON.stringify(win));

    save(games(createLog(T0, ID), 'a', 6, T0 + 1));
    localStorage.removeItem(CELEBRATED_KEY);
    expect(renderToStaticMarkup(<App />)).not.toContain('data-testid="victory"');

    save(appendEvent(createLog(T0, ID), { type: 'match/end', at: T0 + 1 }));
    localStorage.removeItem(CELEBRATED_KEY);
    expect(renderToStaticMarkup(<App />)).not.toContain('data-testid="victory"');

    const split = appendEvent(games(games(createLog(T0, ID), 'a', 6, T0 + 1), 'b', 6, T0 + 20), {
      type: 'match/end',
      at: T0 + 40,
    });
    save(split);
    localStorage.removeItem(CELEBRATED_KEY);
    expect(renderToStaticMarkup(<App />)).not.toContain('data-testid="victory"');

    const ended = appendEvent(games(createLog(T0, ID), 'b', 6, T0 + 1), { type: 'match/end', at: T0 + 20 });
    save(ended);
    localStorage.removeItem(CELEBRATED_KEY);
    const endedQuiet = renderToStaticMarkup(<App />);
    expect(endedQuiet).not.toContain('data-testid="victory"');
    expect(endedQuiet).toContain('data-testid="final-score"');
    expect(endedQuiet).not.toContain('data-testid="undo"');
    expect(localStorage.getItem(CELEBRATED_KEY)).toBe(JSON.stringify(currentWin(ended)));

    const continued = appendEvent(
      appendEvent(games(games(createLog(T0, ID), 'a', 6, T0 + 1), 'a', 6, T0 + 20), {
        type: 'set/select',
        index: 2,
        at: T0 + 40,
      }),
      { type: 'game/increment', team: 'a', at: T0 + 41 },
    );
    save(continued);
    localStorage.removeItem(CELEBRATED_KEY);
    const thirdSet = renderToStaticMarkup(<App />);
    expect(thirdSet).not.toContain('data-testid="victory"');
    expect(thirdSet).toContain('data-testid="final-score"');
    save(appendEvent(continued, { type: 'game/increment', team: 'b', at: T0 + 42 }));
    expect(renderToStaticMarkup(<App />)).not.toContain('data-testid="victory"');

    const css = readFileSync(join(root, 'src/app.css'), 'utf8');
    const top = css.slice(css.indexOf('.top {'), css.indexOf('.top {') + 180);
    expect(top).toContain('z-index: 4');
    expect(css).toContain('.victory {');
    expect(css).toContain('z-index: 3');
    expect(css).toContain('.victory-canvas { display: none; }');
  });

  it('opens again after undo removes the win and the team wins again', () => {
    const wonLog = games(games(createLog(T0, ID), 'a', 6, T0 + 1), 'a', 6, T0 + 20);
    save(wonLog);
    expect(renderToStaticMarkup(<App />)).not.toContain('data-testid="victory"');
    const first = currentWin(wonLog);
    expect(first).not.toBeNull();
    expect(localStorage.getItem(CELEBRATED_KEY)).toBe(JSON.stringify(first));

    const undone = undoLog(wonLog);
    save(undone);
    expect(renderToStaticMarkup(<App />)).not.toContain('data-testid="victory"');

    const again = appendEvent(undone, { type: 'game/increment', team: 'a', at: T0 + 80 });
    save(again);
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain('data-testid="victory"');
    expect(html).toContain('Team A wins!');
    expect(html).toContain('<canvas');
    expect(html).toContain('data-testid="victory-lottie"');
    const win = currentWin(again);
    expect(win).not.toBeNull();
    if (!first || !win) throw new Error('expected both wins');
    expect(celebrationKey(win)).not.toBe(celebrationKey(first));
    expect(html).not.toContain('data-testid="undo"');
  });

  it('opens again after undo of End match and End match again', () => {
    const ended = appendEvent(games(createLog(T0, ID), 'b', 6, T0 + 1), { type: 'match/end', at: T0 + 20 });
    save(ended);
    expect(renderToStaticMarkup(<App />)).not.toContain('data-testid="victory"');

    save(undoLog(ended));
    expect(renderToStaticMarkup(<App />)).not.toContain('data-testid="victory"');

    save(appendEvent(undoLog(ended), { type: 'match/end', at: T0 + 30 }));
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain('data-testid="victory"');
    expect(html).toContain('Team B wins!');
  });
});