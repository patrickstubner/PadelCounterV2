import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { appendEvent, createLog, replay } from '../domain/log';
import type { MatchState, TeamId } from '../domain/types';
import { TeamPanel } from './TeamPanel';

const ID = '00000000-0000-4000-8000-00000000000c';
const T0 = 1_700_000_000_000;

function markup(state: MatchState, team: TeamId = 'a'): string {
  return renderToStaticMarkup(
    <TeamPanel
      team={team}
      state={state}
      onIncrement={() => undefined}
      onDecrement={() => undefined}
      onRename={() => undefined}
      onSelectSet={() => undefined}
      onServe={() => undefined}
    />,
  );
}

function button(html: string, set: number): string {
  const match = html.match(new RegExp(`<button[^>]*data-testid="set-a-${set}"[^>]*>`));
  expect(match, `set ${set}`).not.toBeNull();
  return match?.[0] ?? '';
}

describe('set row under the team name', () => {
  it('orders the sets from the left and names each tap target Set N', () => {
    const html = markup(replay(createLog(T0, ID)));
    const first = html.indexOf('data-testid="set-a-1"');
    const second = html.indexOf('data-testid="set-a-2"');
    const third = html.indexOf('data-testid="set-a-3"');
    expect(first).toBeGreaterThan(-1);
    expect(first).toBeLessThan(second);
    expect(second).toBeLessThan(third);
    expect(html).not.toContain('set-label');
    expect(button(html, 1)).toContain('aria-label="Set 1"');
    expect(button(html, 2)).toContain('aria-label="Set 2"');
    expect(button(html, 3)).toContain('aria-label="Set 3"');
    expect(button(html, 1)).toContain('is-active');
    expect(button(html, 1)).toContain('aria-pressed="true"');
    expect(button(html, 2)).toContain('is-upcoming');
    expect(button(html, 3)).toContain('is-upcoming');
    expect(html).toContain('data-testid="current-a"');
  });

  it('keeps played sets large and marks the selected set', () => {
    let log = createLog(T0, ID);
    for (let i = 0; i < 6; i += 1) log = appendEvent(log, { type: 'game/increment', team: 'a', at: T0 + 1 + i });
    const html = markup(replay(log));
    expect(button(html, 1)).toContain('is-played');
    expect(button(html, 1)).toContain('is-won');
    expect(button(html, 1)).toContain('aria-pressed="false"');
    expect(button(html, 2)).toContain('is-active');
    expect(button(html, 2)).toContain('aria-pressed="true"');
    expect(html).toContain('>6<');
    expect(html).toContain('>0<');
  });

  it('disables every set while the match is ended', () => {
    let log = createLog(T0, ID);
    log = appendEvent(log, { type: 'match/end', at: T0 + 1 });
    const html = markup(replay(log));
    expect(button(html, 1)).toContain('disabled');
    expect(button(html, 2)).toContain('disabled');
    expect(button(html, 3)).toContain('disabled');
  });
});
