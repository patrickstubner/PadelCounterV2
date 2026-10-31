import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createMatch, matchReducer } from '../domain/reducer';
import { MinusIcon, PlusIcon } from './icons';
import { TeamPanel } from './TeamPanel';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../app.css'), 'utf8');

const noop = () => undefined;

describe('serve marker', () => {
  it('shows the server number beside the ball and not in the middle', () => {
    const state = {
      ...createMatch(1_700_000_000_000, '00000000-0000-4000-8000-000000000001'),
      serve: { team: 'b' as const, player: 2 as const },
    };
    const html = renderToStaticMarkup(
      <>
        <TeamPanel team="a" state={state} onIncrement={noop} onDecrement={noop} onRename={noop} onSelectSet={noop} onServe={noop} />
        <TeamPanel team="b" state={state} onIncrement={noop} onDecrement={noop} onRename={noop} onSelectSet={noop} onServe={noop} />
      </>,
    );
    expect(html).toContain('data-testid="serve-player-b"');
    expect(html).toContain('>2<');
    expect(html).not.toContain('data-testid="serve-player-a"');
  });

  it('highlights the tiebreak team without a player number', () => {
    const state = {
      ...createMatch(1_700_000_000_000, '00000000-0000-4000-8000-000000000001'),
      serve: null,
      serveAsk: 'b' as const,
    };
    const html = renderToStaticMarkup(
      <>
        <TeamPanel team="a" state={state} onIncrement={noop} onDecrement={noop} onRename={noop} onSelectSet={noop} onServe={noop} />
        <TeamPanel team="b" state={state} onIncrement={noop} onDecrement={noop} onRename={noop} onSelectSet={noop} onServe={noop} />
      </>,
    );
    expect(html).toContain('Choose the player for Team B');
    expect(html).not.toContain('data-testid="serve-player-b"');
    expect(html).not.toContain('data-testid="serve-player-a"');
    expect(html).toContain('class="ball is-on"');
  });
});

describe('plus and minus controls', () => {
  it('disables plus for both teams when the match is already won and keeps minus', () => {
    let state = createMatch(1_700_000_000_000, '00000000-0000-4000-8000-000000000001');
    for (let i = 0; i < 12; i += 1) {
      state = matchReducer(state, { type: 'game/increment', team: 'a', at: state.updatedAt + 1 });
    }
    const html = renderToStaticMarkup(
      <>
        <TeamPanel team="a" state={state} onIncrement={noop} onDecrement={noop} onRename={noop} onSelectSet={noop} onServe={noop} />
        <TeamPanel team="b" state={state} onIncrement={noop} onDecrement={noop} onRename={noop} onSelectSet={noop} onServe={noop} />
      </>,
    );
    const tag = (id: string) => {
      const at = html.indexOf(`data-testid="${id}"`);
      return html.slice(at, html.indexOf('>', at));
    };
    expect(tag('increment-a')).toContain('disabled=""');
    expect(tag('increment-a')).toContain('aria-disabled="true"');
    expect(tag('increment-b')).toContain('disabled');
    expect(tag('increment-b')).toContain('aria-disabled="true"');
    expect(tag('decrement-a')).not.toContain('disabled');
    expect(tag('decrement-b')).toContain('disabled');

    const third = renderToStaticMarkup(
      <TeamPanel team="b" state={{ ...state, activeSet: 2 }} onIncrement={noop} onDecrement={noop} onRename={noop} onSelectSet={noop} onServe={noop} />,
    );
    const thirdPlus = third.slice(third.indexOf('data-testid="increment-b"'), third.indexOf('>', third.indexOf('data-testid="increment-b"')));
    expect(thirdPlus).toContain('disabled');
    expect(thirdPlus).toContain('aria-disabled="true"');
  });

  it('widens only the portrait buttons and keeps a bold high-contrast sign there', () => {
    const plus = renderToStaticMarkup(<PlusIcon />);
    const minus = renderToStaticMarkup(<MinusIcon />);
    expect(plus).toContain('class="glyph"');
    expect(plus).toContain('d="M10.2 3h3.6v7.2H21v3.6h-7.2V21h-3.6v-7.2H3v-3.6h7.2V3z"');
    expect(plus).toContain('class="glyph-bold"');
    expect(plus).toContain('d="M8 2h8v6h6v8h-6v6H8v-6H2V8h6V2z"');
    expect(minus).toContain('d="M3 10.2h18v3.6H3z"');
    expect(minus).toContain('d="M2 8h20v8H2z"');

    const icon = css.slice(css.indexOf('.icon {'), css.indexOf('.glyph-bold { display: none; }'));
    expect(icon).toContain('width: 42%');
    expect(icon).toContain('height: 42%');
    expect(icon).toContain('max-width: 4.25rem');
    expect(icon).toContain('max-height: 4.25rem');

    const landscape = css.slice(css.indexOf('.team {'), css.indexOf('.team-a'));
    expect(landscape).toContain('grid-template-columns: 5.6rem minmax(0, 1fr) 5.6rem');
    expect(landscape).not.toContain('7.25rem');
    expect(landscape).not.toContain('safe-area-inset-left');

    const portrait = css.slice(css.indexOf('@media (orientation: portrait)'), css.indexOf('.team-a .team-head'));
    expect(portrait).toContain('calc(4rem + 0.7rem - env(safe-area-inset-left, 0px) - 3px)');
    expect(portrait).toContain('calc(4rem + 0.7rem - env(safe-area-inset-right, 0px) - 3px)');
    expect(portrait).toContain('minmax(0, 1fr)');
    expect(portrait).toContain('padding-left: calc(env(safe-area-inset-left, 0px) + 3px)');
    expect(portrait).toContain('padding-right: calc(env(safe-area-inset-right, 0px) + 3px)');
    expect(portrait).toContain('column-gap: 0');
    expect(portrait).not.toContain('padding-inline: 0');
    expect(portrait).toContain('width: min(88cqw, 78cqh)');
    expect(portrait).toContain('.icon .glyph { display: none; }');
    expect(portrait).toContain('.icon .glyph-bold { display: inline; }');
    expect(portrait).not.toContain('4rem minmax(0, 1fr) 4rem');
  });

  it('makes portrait team names a little larger without letting them wrap', () => {
    const beforePortrait = css.slice(0, css.indexOf('@media (orientation: portrait)'));
    expect(beforePortrait).toContain('font-size: clamp(1rem, 2.5vh, 1.45rem)');
    const nameStart = css.indexOf('\n.team-name {');
    const name = css.slice(nameStart, css.indexOf('\n.team-name-input {', nameStart));
    expect(name).toContain('overflow: hidden');
    expect(name).toContain('text-overflow: ellipsis');
    expect(name).toContain('white-space: nowrap');
    const portrait = css.slice(css.indexOf('@media (orientation: portrait)'), css.indexOf('.victory {'));
    expect(portrait).toContain('font-size: clamp(1.2rem, 3vh, 1.75rem)');
    expect(portrait).toContain('.team-head { height: 2.75rem; }');
    expect(portrait).not.toContain('2.5vh');
  });
});
