import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { UpdateReady } from './UpdateReady';

describe('update ready hint', () => {
  it('names the update and does not reload by itself', () => {
    let reloads = 0;
    const html = renderToStaticMarkup(
      <UpdateReady
        onReload={() => {
          reloads += 1;
        }}
      />,
    );
    expect(html).toContain('data-testid="update-ready"');
    expect(html).toContain('>Update ready<');
    expect(reloads).toBe(0);
  });
});
