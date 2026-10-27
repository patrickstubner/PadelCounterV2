import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App';
import { ARCHIVE_KEY, listMatches, saveArchive } from '../domain/archive';
import { appendEvent, createLog, formatMatchStamp } from '../domain/log';
import { STORAGE_KEY, serializeLog } from '../domain/persistence';
import { sessionReducer } from '../domain/session';
import { HistoryPage } from './HistoryPage';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ID = '00000000-0000-4000-8000-0000000000aa';
const NEXT = '00000000-0000-4000-8000-0000000000bb';
const T0 = new Date(2026, 9, 12, 9, 1, 2).getTime();

function memoryStore() {
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
  return store;
}

describe('history page', () => {
  beforeEach(() => {
    memoryStore();
  });

  it('stays off the court until History is opened', () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain('data-testid="open-matches"');
    expect(html).toContain('data-testid="history-open"');
    expect(html).toContain('>History</button>');
    expect(html).not.toContain('data-testid="history-page"');
    expect(html).not.toContain('data-testid="serve-label"');
  });

  it('shows the current match newest-first and the played matches newest-first', () => {
    let log = createLog(T0, ID, { a: 'Lobos', b: 'Team B' });
    log = appendEvent(log, { type: 'game/increment', team: 'a', at: T0 + 1_000 });
    log = appendEvent(log, { type: 'game/increment', team: 'b', at: T0 + 2_000 });
    const archived = sessionReducer({ log, archive: [] }, {
      type: 'record',
      event: { type: 'match/reset', matchId: NEXT, at: T0 + 86_400_000 },
    });
    const store = memoryStore();
    store.set(STORAGE_KEY, serializeLog(archived.log));
    saveArchive(archived.archive, localStorage);
    expect(store.get(ARCHIVE_KEY)).toContain('Lobos');

    const matches = listMatches(archived.log, archived.archive);
    const past = matches.find((match) => !match.live);
    const live = matches.find((match) => match.live);
    expect(past?.nameA).toBe('Lobos');
    expect(formatMatchStamp(past!.at)).toContain('10/12/2026');
    expect(live?.status).toBe('in progress');

    const page = renderToStaticMarkup(
      <HistoryPage
        mode="list"
        live={{ nameA: 'Team A', nameB: 'Team B', gameA: 0, gameB: 0, setsLabel: '0:0', detail: 'Set 1' }}
        rows={[
          { at: T0 + 2_000, label: 'Team B won the game', who: null, score: [{ a: 1, b: 1, aChanged: false, bChanged: true }] },
          { at: T0 + 1_000, label: 'Lobos won the game', who: null, score: [{ a: 1, b: 0, aChanged: true, bChanged: false }] },
        ]}
        played={past ? [past] : []}
        selected={null}
        onOpen={() => undefined}
        onBack={() => undefined}
        onAskDelete={() => undefined}
      />,
    );
    expect(page).toContain('data-testid="history-back"');
    expect(page).toContain('>Match</button>');
    expect(page).toContain('data-testid="history-current"');
    expect(page).toContain('>0:0<');
    expect(page.indexOf('Team B won the game')).toBeLessThan(page.indexOf('Lobos won the game'));
    expect(page).toContain('<mark class="history-changed">1</mark>:<span>0</span>');
    expect(page).toContain('<span>1</span>:<mark class="history-changed">1</mark>');
    expect(page).toContain('Played matches');
    expect(page).toContain('ended early');
    expect(page).toContain('data-testid="delete-match"');
    expect(page).toContain('>Delete</button>');
    expect(page).toContain('aria-label="Delete match Lobos versus Team B"');
    const currentBlock = page.slice(page.indexOf('data-testid="history-current"'), page.indexOf('Played matches'));
    expect(currentBlock).not.toContain('delete-match');
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../app.css'), 'utf8');
    const rule = css.slice(css.indexOf('.history-page {'), css.indexOf('.history-bar'));
    expect(rule).not.toContain('position: fixed');
    expect(rule).toContain('flex: 1 1 auto');
    const row = css.slice(css.indexOf('.history-row {'), css.indexOf('.history-row time'));
    expect(row).toContain('grid-template-columns');
    expect(row).toContain('text-align: left');
  });

  it('opens a played match without a way to resume it', () => {
    const past = {
      id: ID,
      at: T0,
      nameA: 'Lobos',
      nameB: 'Team B',
      score: '1–0',
      status: 'ended early',
      statusKind: 'ended-early' as const,
      events: [{ type: 'game/increment' as const, team: 'a' as const, at: T0 + 1_000 }],
      live: false,
    };
    const detail = renderToStaticMarkup(
      <HistoryPage
        mode="detail"
        live={{ nameA: 'Team A', nameB: 'Team B', gameA: 0, gameB: 0, setsLabel: '0:0', detail: 'Set 1' }}
        rows={[]}
        played={[past]}
        selected={past}
        onOpen={() => undefined}
        onBack={() => undefined}
        onAskDelete={() => undefined}
      />,
    );
    expect(detail).toContain('data-testid="match-detail"');
    expect(detail).toContain('>Back</button>');
    expect(detail).toContain('Lobos won the game');
    expect(detail).toContain('<mark class="history-changed">1</mark>');
    expect(detail).toContain('>0<');
    expect(detail).not.toContain('Resume');
    expect(detail).not.toContain('delete-match');
    expect(detail.indexOf('data-testid="history-back"')).toBeLessThan(detail.indexOf('Lobos won the game'));
  });

  it('says when a saved match is missing', () => {
    const html = renderToStaticMarkup(
      <HistoryPage
        mode="detail"
        live={{ nameA: 'Team A', nameB: 'Team B', gameA: 0, gameB: 0, setsLabel: '0:0', detail: 'Set 1' }}
        rows={[]}
        played={[]}
        selected={null}
        onOpen={() => undefined}
        onBack={() => undefined}
        onAskDelete={() => undefined}
      />,
    );
    expect(html).toContain('Match not found.');
    expect(html).toContain('data-testid="history-back"');
  });
});
