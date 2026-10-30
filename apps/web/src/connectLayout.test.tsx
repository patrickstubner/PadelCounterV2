import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConnectPage } from './components/ConnectPage';
import { JoinMatchPage } from './components/JoinMatchPage';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'app.css'), 'utf8');

function block(marker: string): string {
  const start = css.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('}', css.indexOf('{', start)) + 1);
}

describe('connect dialog layout', () => {
  it('has no bottom Close button on the connect or join dialogs', () => {
    const connect = renderToStaticMarkup(
      <ConnectPage
        configured
        mode="choose"
        status="off"
        players={0}
        qr={null}
        code={null}
        error={null}
        onShow={() => undefined}
        onScan={() => undefined}
        onRotate={() => undefined}
        onLeave={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(connect).toContain('data-testid="connect-close-x"');
    expect(connect).toContain('data-testid="connect-backdrop"');
    expect(connect).not.toContain('data-testid="connect-close"');
    expect(connect).not.toContain('>Close<');
    const join = renderToStaticMarkup(
      <JoinMatchPage
        configured
        error={null}
        pageHref="https://patrickstubner.github.io/PadelCounterV2/"
        onCode={() => undefined}
        onToken={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(join).toContain('data-testid="join-match-close"');
    expect(join).toContain('data-testid="join-match-backdrop"');
    expect(join).not.toContain('data-testid="join-match-dismiss"');
    expect(join).not.toContain('>Close<');
  });

  it('aligns the dialog buttons in portrait and in landscape', () => {
    const portrait = css.slice(css.indexOf('@media (orientation: portrait) {'));
    const portraitConnect = portrait.slice(0, portrait.indexOf('@media (orientation: landscape)'));
    expect(portraitConnect).toContain('.connect-dialog:not(.join-scanning) .text-btn');
    expect(portraitConnect).toContain('width: 100%');
    expect(portraitConnect).toContain('justify-items: stretch');
    expect(portraitConnect).toContain('align-items: stretch');
    expect(portraitConnect).toContain('transform: none');
    expect(portraitConnect).toContain('.join-scan-bottom');
    expect(portraitConnect).toContain('margin-left: auto');

    const landscape = css.slice(css.lastIndexOf('@media (orientation: landscape)'));
    expect(landscape).toContain('.connect-dialog .text-btn');
    expect(landscape).toContain('width: 100%');
    expect(landscape).toContain('transform: none');
    expect(landscape).toContain('writing-mode: horizontal-tb');
    expect(landscape).toContain('.join-scan-bottom');
    expect(landscape).toContain('justify-content: flex-end');
    expect(landscape).toContain('align-items: center');
    expect(landscape).toContain('.join-scanning .join-scan-bottom .text-btn');
    expect(landscape).not.toContain('skew');
    expect(landscape).not.toContain('rotate');

    const actions = block('.connect-actions {');
    expect(actions).toContain('display: grid');
    expect(actions).toContain('justify-items: stretch');
    const buttons = css.slice(css.indexOf('.connect-dialog .text-btn,'), css.indexOf('.connect-choice {' , css.indexOf('.connect-dialog .text-btn,')));
    expect(buttons).toContain('width: 100%');
    expect(buttons).toContain('transform: none');
    expect(buttons).toContain('align-items: center');
  });
});
