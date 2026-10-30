/** @vitest-environment happy-dom */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

describe('blocked storage', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

  afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
  });

  it('renders the court when localStorage throws', async () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked');
      },
    });
    const { App } = await import('./App');
    const html = renderToStaticMarkup(createElement(App));
    expect(html).toContain('data-testid="increment-a"');
    expect(html).toContain('Team A');
  });
});
