import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { QR_QUIET_MODULES, QrCode } from './QrCode';

const TOKEN = 'abcdefghijklmnopqrstuv';

describe('host QR', () => {
  it('keeps a quiet zone inside the graphic and does not print the token', () => {
    const html = renderToStaticMarkup(
      <QrCode text={`https://patrickstubner.github.io/PadelCounterV2/#/join?t=${TOKEN}`} />,
    );
    expect(html).toContain('aria-label="QR code for players"');
    expect(html).not.toContain(TOKEN);
    expect(html).toContain('fill="#ffffff"');
    expect(html).toContain('fill="#000000"');
    const modules = [...html.matchAll(/<rect x="(\d+)" y="(\d+)"/g)].map((match) => ({
      x: Number(match[1]),
      y: Number(match[2]),
    }));
    expect(modules.length).toBeGreaterThan(20);
    expect(Math.min(...modules.map((cell) => cell.x))).toBe(QR_QUIET_MODULES);
    expect(Math.min(...modules.map((cell) => cell.y))).toBe(QR_QUIET_MODULES);
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../app.css'), 'utf8');
    const qrRule = css.slice(css.indexOf('.qr {'));
    expect(qrRule.startsWith('.qr {')).toBe(true);
    expect(qrRule.slice(0, qrRule.indexOf('}'))).not.toContain('border-radius: 0.75rem');
    expect(qrRule).toContain('max-width: min(92vw, 76dvh)');
    const camera = css.slice(css.indexOf('.join-camera {'));
    expect(camera.slice(0, camera.indexOf('}'))).toContain('object-fit: cover');
    expect(camera.slice(0, camera.indexOf('}'))).toContain('inset: 0');
    expect(camera.slice(0, camera.indexOf('}'))).not.toContain('max-height: 16rem');
    expect(css).toContain('.join-scanning');
    expect(css).toContain('.connect-dialog.join-scanning');
    const scanning = css.slice(css.indexOf('.connect-dialog.join-scanning {'));
    expect(scanning.slice(0, scanning.indexOf('}'))).toContain('width: 100%');
    expect(scanning.slice(0, scanning.indexOf('}'))).toContain('height: 100%');
    expect(scanning.slice(0, scanning.indexOf('}'))).toContain('max-height: none');
    expect(css).toContain('.connect-bright');
  });
});
