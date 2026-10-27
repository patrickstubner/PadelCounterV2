import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('production deploy gate', () => {
  const yaml = readFileSync(new URL('../../../.github/workflows/deploy.yml', import.meta.url), 'utf8');

  it('ships the worker and the pages build of one approved head', () => {
    expect(yaml).toContain('workflow_dispatch:');
    expect(yaml).toContain('edge_rate_limit_confirmed:');
    expect(yaml).toContain('environment: production');
    expect(yaml).toContain('name: github-pages');
    expect(yaml).toContain('github.sha');
    expect(yaml).toContain('git rev-parse HEAD');
    expect(yaml).toContain('EDGE_RATE_LIMIT_RULE');
    expect(yaml).toContain('wrangler deploy --env production');
    expect(yaml).toContain('actions/deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e');
    expect(yaml).toContain('needs: production');
  });
});
