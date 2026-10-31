import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createMatch, matchReducer } from '../domain/reducer';
import { matchWinner } from '../domain/rules';
import type { MatchEvent, MatchState, TeamId } from '../domain/types';
import { BallIcon } from './icons';
import { TeamPanel } from './TeamPanel';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, '../..');
const css = readFileSync(join(here, '../app.css'), 'utf8');

const noop = () => undefined;
const ID = '00000000-0000-4000-8000-000000000001';
const T0 = 1_700_000_000_000;

function classOf(html: string, id: string): string {
  const at = html.indexOf(`data-testid="${id}"`);
  const start = html.lastIndexOf('<', at);
  const tag = html.slice(start, html.indexOf('>', at));
  return /class="([^"]*)"/.exec(tag)?.[1] ?? '';
}

function panels(state: MatchState): string {
  return renderToStaticMarkup(
    <>
      <TeamPanel team="a" state={state} onIncrement={noop} onDecrement={noop} onRename={noop} onSelectSet={noop} onServe={noop} />
      <TeamPanel team="b" state={state} onIncrement={noop} onDecrement={noop} onRename={noop} onSelectSet={noop} onServe={noop} />
    </>,
  );
}

function play(state: MatchState, team: TeamId, times: number): MatchState {
  let next = state;
  for (let i = 0; i < times; i += 1) {
    const event: MatchEvent = { type: 'game/increment', team, at: next.updatedAt + 1 };
    next = matchReducer(next, event);
  }
  return next;
}

function keyframeBlock(name: string): string {
  const marker = `@keyframes ${name} {`;
  const start = css.indexOf(marker);
  if (start < 0) throw new Error(`missing @keyframes ${name}`);
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(start, i + 1);
    }
  }
  throw new Error(`unclosed @keyframes ${name}`);
}

function frames(block: string): { selector: string; body: string }[] {
  const inner = block.slice(block.indexOf('{') + 1, block.lastIndexOf('}'));
  const found: { selector: string; body: string }[] = [];
  let depth = 0;
  let cursor = 0;
  let selector = '';
  for (let i = 0; i < inner.length; i += 1) {
    if (inner[i] === '{') {
      if (depth === 0) selector = inner.slice(cursor, i).trim();
      depth += 1;
      cursor = i + 1;
    } else if (inner[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        found.push({ selector, body: inner.slice(cursor, i) });
        cursor = i + 1;
      }
    }
  }
  return found;
}

interface ShadowLayer {
  blur: number;
  spread: number;
  alpha: number;
}

function shadowLayers(body: string): ShadowLayer[] {
  return [...body.matchAll(/0\s+0\s+([\d.]+)rem\s+([\d.]+)rem\s+color-mix\([^%]*?([\d.]+)%/g)].map((match) => ({
    blur: Number(match[1]),
    spread: Number(match[2]),
    alpha: Number(match[3]),
  }));
}

function layer(layers: ShadowLayer[], index: number): ShadowLayer {
  const item = layers[index];
  if (!item) throw new Error(`missing shadow layer ${index}`);
  return item;
}

function tiebreakAsk(winner: TeamId): MatchState {
  let state = matchReducer(createMatch(T0, ID), { type: 'serve/set', team: 'a', player: 1, at: T0 + 1 });
  for (let i = 0; i < 6; i += 1) {
    state = play(state, 'a', 1);
    state = play(state, 'b', 1);
  }
  return play(state, winner, 1);
}

describe('serve ball glow', () => {
  it('uses no glow, the normal cue, or the stronger glow for the team that must choose', () => {
    const open = createMatch(T0, ID);
    let html = panels(open);
    expect(classOf(html, 'serve-a')).toBe('ball is-cue');
    expect(classOf(html, 'serve-b')).toBe('ball is-cue');

    const chosen = matchReducer(open, { type: 'serve/set', team: 'a', player: 1, at: T0 + 1 });
    html = panels(chosen);
    expect(classOf(html, 'serve-a')).toBe('ball is-on');
    expect(classOf(html, 'serve-b')).toBe('ball');
    expect(html).not.toContain('is-cue');
    expect(html).not.toContain('is-ask');

    const asked = tiebreakAsk('b');
    expect(asked.serve).toBeNull();
    expect(asked.serveAsk).toBe('b');
    expect(asked.ended).toBe(false);
    expect(matchWinner(asked.sets)).toBeNull();
    html = panels(asked);
    expect(classOf(html, 'serve-b')).toBe('ball is-on is-ask');
    expect(classOf(html, 'serve-a')).toBe('ball');
  });

  it('does not glow when the match has ended (P32-02)', () => {
    const open = createMatch(T0, ID);
    const endedOpen = matchReducer(open, { type: 'match/end', at: T0 + 1 });
    expect(endedOpen.ended).toBe(true);
    expect(endedOpen.serve).toBeNull();
    expect(matchWinner(endedOpen.sets)).toBeNull();
    let html = panels(endedOpen);
    expect(classOf(html, 'serve-a')).toBe('ball');
    expect(classOf(html, 'serve-b')).toBe('ball');

    const asked = tiebreakAsk('b');
    const endedAsk = matchReducer(asked, { type: 'match/end', at: asked.updatedAt + 1 });
    expect(endedAsk.ended).toBe(true);
    expect(endedAsk.serve).toBeNull();
    expect(endedAsk.serveAsk).toBe('b');
    expect(matchWinner(endedAsk.sets)).toBeNull();
    html = panels(endedAsk);
    expect(classOf(html, 'serve-b')).toBe('ball is-on');
    expect(classOf(html, 'serve-a')).toBe('ball');
  });

  it('does not glow when the match has a winner (P32-02)', () => {
    let state = tiebreakAsk('a');
    expect(state.sets[0]).toEqual({ a: 7, b: 6 });
    expect(state.serve).toBeNull();
    expect(state.serveAsk).toBe('b');
    expect(matchWinner(state.sets)).toBeNull();

    state = play(state, 'a', 5);
    expect(state.sets[1]).toEqual({ a: 5, b: 0 });
    expect(state.ended).toBe(false);
    expect(state.serve).toBeNull();
    expect(state.serveAsk).toBe('a');
    expect(matchWinner(state.sets)).toBeNull();
    let html = panels(state);
    expect(classOf(html, 'serve-a')).toBe('ball is-on is-ask');
    expect(classOf(html, 'serve-b')).toBe('ball');

    state = play(state, 'a', 1);
    expect(state.sets[1]).toEqual({ a: 6, b: 0 });
    expect(state.ended).toBe(false);
    expect(state.serve).toBeNull();
    expect(state.serveAsk).toBe('b');
    expect(matchWinner(state.sets)).toBe('a');
    html = panels(state);
    expect(classOf(html, 'serve-a')).toBe('ball');
    expect(classOf(html, 'serve-b')).toBe('ball is-on');
  });
});

describe('serve ball icon', () => {
  it('is an inline yellow-green ball with a curved seam and no external asset', () => {
    const html = renderToStaticMarkup(<BallIcon />);
    expect(html).toContain('class="ball-icon"');
    expect(html).toContain('class="ball-felt"');
    expect(html).toContain('class="ball-seam"');
    expect(html).not.toContain('ball-highlight');
    expect(html).toContain('d="M8.05 5.15c2.15 2.35 2.15 11.35 0 13.7M15.95 5.15c-2.15 2.35-2.15 11.35 0 13.7"');
    expect(html).not.toContain('currentColor');
    expect(html).not.toContain('<image');
    expect(html).not.toContain('xlink:href');
    expect(html).not.toContain('url(');
    expect(html).not.toMatch(/https?:/i);

    const felt = css.slice(css.indexOf('.ball-felt {'), css.indexOf('.ball-seam {'));
    expect(felt).toContain('fill: #d4ee4a');
    expect(felt).toContain('stroke: #5f7d10');
    const seam = css.slice(css.indexOf('.ball-seam {'), css.indexOf('.serve-player {'));
    expect(seam).toContain('stroke: #f7fff6');
    expect(seam).toContain('stroke-linecap: round');

    const forced = css.slice(css.indexOf('@media (forced-colors: active)'), css.indexOf('@media (forced-colors: active)') + 900);
    expect(forced).toContain('.ball-felt { fill: ButtonText; stroke: ButtonText; }');
    expect(forced).toContain('.ball-seam { stroke: ButtonFace; }');
  });
});

describe('serve glow motion', () => {
  it('shrinks the ring slightly and then grows it on the same keyframes as both glows', () => {
    const glow = frames(keyframeBlock('serve-glow'));
    const strong = frames(keyframeBlock('serve-glow-strong'));
    const ring = frames(keyframeBlock('serve-ring'));
    const selectors = glow.map((frame) => frame.selector);
    expect(selectors).toEqual(['0%, 100%', '20%', '50%']);
    expect(strong.map((frame) => frame.selector)).toEqual(selectors);
    expect(ring.map((frame) => frame.selector)).toEqual(selectors);

    const ringBody = (selector: string) => ring.find((frame) => frame.selector === selector)?.body ?? '';
    expect(ringBody('0%, 100%')).toContain('outline-offset: 0;');
    expect(ringBody('20%')).toContain('outline-offset: -0.14rem;');
    expect(ringBody('50%')).toContain('outline-offset: 0.32rem;');

    const cueRule = css.slice(css.indexOf('.ball.is-cue,\n.ball.is-ask {'), css.indexOf('.ball.is-ask {\n  --glow-reach: 2.9rem'));
    expect(cueRule).toContain('--glow-reach: 2.5rem');
    expect(cueRule).toContain('animation: serve-glow 1.4s ease-in-out infinite');
    const askRule = css.slice(css.indexOf('.ball.is-ask {\n  --glow-reach: 2.9rem'), css.indexOf('.ball.is-cue::after'));
    expect(askRule).toContain('animation-name: serve-glow-strong');
    expect(askRule).not.toContain('1.4s');
    const ringRule = css.slice(css.indexOf('.ball.is-cue::after'), css.indexOf('@keyframes serve-glow'));
    expect(ringRule).toContain('pointer-events: none');
    expect(ringRule).toContain('animation: serve-ring 1.4s ease-in-out infinite');

    const at = (list: { selector: string; body: string }[], selector: string) => shadowLayers(list.find((frame) => frame.selector === selector)?.body ?? '');
    const cueRest = layer(at(glow, '0%, 100%'), 1);
    const cueDip = layer(at(glow, '20%'), 1);
    const cuePeakInner = layer(at(glow, '50%'), 0);
    const cuePeak = layer(at(glow, '50%'), 1);
    const askPeakInner = layer(at(strong, '50%'), 0);
    const askPeak = layer(at(strong, '50%'), 1);
    expect(cueDip.blur + cueDip.spread).toBeLessThan(cueRest.blur + cueRest.spread);
    expect(cueRest.blur + cueRest.spread).toBeLessThan(cuePeak.blur + cuePeak.spread);
    expect(cuePeakInner.blur).toBeGreaterThan(1.05);
    expect(cuePeakInner.alpha).toBeGreaterThan(78);
    expect(cuePeak.alpha).toBeGreaterThan(36);
    expect(cuePeak.blur + cuePeak.spread).toBeCloseTo(2.5);
    expect(askPeakInner.blur).toBeGreaterThan(1.25);
    expect(askPeakInner.alpha).toBeGreaterThan(92);
    expect(askPeak.alpha).toBeGreaterThan(48);
    expect(askPeak.blur + askPeak.spread).toBeCloseTo(2.9);
    expect(askPeak.alpha).toBeGreaterThan(cuePeak.alpha);
  });

  it('keeps both glows still under reduced motion', () => {
    const reduce = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'), css.indexOf('.privacy-copy'));
    expect(reduce).toContain('animation: none');
    expect(reduce).toContain('border-color: var(--accent)');
    expect(reduce).toContain('background-clip: border-box');
    expect(reduce).toContain('content: none');
    expect(reduce).not.toContain('serve-ring');
    expect(reduce).not.toContain('outline-offset');
    const cue = shadowLayers(reduce.slice(reduce.indexOf('  .ball.is-cue,'), reduce.indexOf('  .ball.is-ask {\n    box-shadow')));
    const ask = shadowLayers(reduce.slice(reduce.indexOf('  .ball.is-ask {\n    box-shadow'), reduce.indexOf('  .ball.is-cue::after')));
    expect(cue).toHaveLength(2);
    expect(ask).toHaveLength(2);
    const cueOuter = layer(cue, 1);
    const askOuter = layer(ask, 1);
    expect(cueOuter.alpha).toBeGreaterThan(42);
    expect(askOuter.alpha).toBeGreaterThan(cueOuter.alpha);
    expect(askOuter.blur + askOuter.spread).toBeGreaterThan(cueOuter.blur + cueOuter.spread);
    expect(layer(ask, 0).alpha).toBeGreaterThan(layer(cue, 0).alpha);
  });
});

describe('court colours', () => {
  it('keeps the theme colours and the black manifest', () => {
    expect(css).toContain('--a: #e4ff47');
    expect(css).toContain('--b: #ffb020');
    expect(css).toContain('--a-bg: #071006');
    expect(css).toContain('--b-bg: #120e06');
    expect(css).toContain('--court: #000000');
    expect(css).toContain('--court-online: #163056');
    expect(css).toContain('--court-offline: #3a1016');
    expect(css).toContain('--bar: #000000');
    expect(css).toContain('--bar-online: #0a1a3f');
    expect(css).toContain('--bar-offline: #3a1016');
    const html = readFileSync(join(webRoot, 'src/index.html'), 'utf8');
    expect(html).toContain('name="theme-color" content="#000000"');
    const manifest = JSON.parse(readFileSync(join(webRoot, 'public/manifest.webmanifest'), 'utf8')) as {
      theme_color: string;
      background_color: string;
    };
    expect(manifest.theme_color).toBe('#000000');
    expect(manifest.background_color).toBe('#000000');
  });
});

describe('serve ball hit targets', () => {
  it('keeps the nine large windows in the layout check', () => {
    const spec = readFileSync(join(webRoot, 'e2e/court-layout.spec.ts'), 'utf8');
    const block = spec.slice(spec.indexOf('const largeWindows'), spec.indexOf("test('the serve ball accepts a click"));
    const sizes = [...block.matchAll(/width: (\d+), height: (\d+)/g)].map((match) => `${match[1]}x${match[2]}`);
    expect(sizes).toEqual([
      '960x540',
      '960x600',
      '1000x560',
      '1080x540',
      '1280x720',
      '1366x768',
      '1440x900',
      '1600x900',
      '1920x1080',
    ]);
    expect(spec).toContain('elementFromPoint');
    expect(spec).toContain('document.documentElement.scrollHeight <= window.innerHeight');
  });
});
