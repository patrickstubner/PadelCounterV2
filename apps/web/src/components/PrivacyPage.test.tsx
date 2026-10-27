import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PrivacyPage } from './PrivacyPage';

describe('privacy page', () => {
  it('names the device id, the quota hashes, and how long codes are kept', () => {
    const html = renderToStaticMarkup(<PrivacyPage onBack={() => undefined} />);
    expect(html).toContain('pcv2:device');
    expect(html).toContain('joined list');
    expect(html).toContain('keyed hash of the network address');
    expect(html).toContain('deleted after two days');
    expect(html).toContain('2 hours');
    expect(html).toContain('12 hours');
    expect(html).toContain('30 seconds');
    expect(html).toContain('two years');
  });
});
