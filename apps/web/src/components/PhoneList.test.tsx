/** @vitest-environment happy-dom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { PhoneList } from './PhoneList';
import type { PublicPhone } from '@padel/core';

const phones: readonly PublicPhone[] = [
  { seat: 'host', since: 1_700_000_000_000, seen: 1_700_000_000_000, online: true, kind: 'iphone', self: true },
  { seat: 'p2', since: 1_700_000_100_000, seen: 1_700_000_200_000, online: false, kind: 'android', self: false },
];

describe('phone list', () => {
  const mounted: Root[] = [];
  afterEach(() => {
    for (const view of mounted) view.unmount();
    mounted.length = 0;
    document.body.replaceChildren();
  });

  it('uses two lines, a status dot, and asks before removing another phone', async () => {
    const kicked: string[] = [];
    const host = document.createElement('div');
    document.body.appendChild(host);
    const view = createRoot(host);
    mounted.push(view);
    await act(async () => {
      view.render(<PhoneList phones={phones} onClose={() => undefined} onKick={(seat) => kicked.push(seat)} />);
    });
    const rows = [...document.querySelectorAll('[data-testid="phone-row"]')];
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.querySelectorAll('.phone-line')).toHaveLength(2);
    expect(document.body.textContent).toContain('Connected');
    expect(document.body.textContent).toContain('Not connected');
    expect(document.body.textContent).toContain('Since');
    expect(document.body.textContent).toContain('Last seen');
    expect(document.body.textContent).not.toContain('Online');
    expect(document.body.textContent).not.toContain('Offline');
    expect(document.querySelector('[data-self="yes"] [data-testid="phone-dot"].is-on')).not.toBeNull();
    expect(document.querySelector('[data-online="no"] [data-testid="phone-dot"].is-on')).toBeNull();
    expect(document.querySelector('[data-testid="kick-host"]')).toBeNull();
    expect(document.body.textContent).not.toContain('d11111111');
    await act(async () => {
      (document.querySelector('[data-testid="kick-p2"]') as HTMLButtonElement).click();
    });
    expect(document.body.textContent).toContain('Remove this phone?');
    expect(document.body.textContent).toContain('new code');
    expect(kicked).toEqual([]);
    await act(async () => {
      (document.querySelector('[data-testid="kick-cancel"]') as HTMLButtonElement).click();
    });
    expect(kicked).toEqual([]);
    await act(async () => {
      (document.querySelector('[data-testid="kick-p2"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      (document.querySelector('[data-testid="kick-confirm"]') as HTMLButtonElement).click();
    });
    expect(kicked).toEqual(['p2']);
  });
});
