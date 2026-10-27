import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../scripts/check-deploy-env.mjs', import.meta.url));

function runCheck(envName: string, fixture: unknown): { status: number | null; stderr: string } {
  const result = spawnSync(process.execPath, [script], {
    env: {
      ...process.env,
      ENV_NAME: envName,
      DEPLOY_ENV_FIXTURE: JSON.stringify(fixture),
    },
    encoding: 'utf8',
  });
  return { status: result.status, stderr: result.stderr };
}

describe('production deploy gate', () => {
  const yaml = readFileSync(new URL('../../../.github/workflows/deploy.yml', import.meta.url), 'utf8');

  it('ships the worker and the pages build of one approved head', () => {
    expect(yaml).toContain('workflow_dispatch:');
    expect(yaml).not.toContain('edge_rate_limit_confirmed');
    expect(yaml).not.toContain('EDGE_RATE_LIMIT_RULE');
    expect(yaml).toContain('vars.DEPLOY_PAGES');
    expect(yaml).toContain('environment: production');
    expect(yaml).toContain('environment: staging');
    expect(yaml).toContain('name: github-pages');
    expect(yaml).toContain('github.sha');
    expect(yaml).toContain('git rev-parse HEAD');
    expect(yaml).toContain('wrangler deploy --env production');
    expect(yaml).toContain('actions/deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e');
    expect(yaml).toContain('needs: production');
    expect(yaml).toContain('check-deploy-env.mjs');
    expect(yaml).toContain('ENV_NAME=production');
    expect(yaml).toContain('ENV_NAME=staging');
  });

  it('fails production when a required reviewer is missing and lets staging exist without one', () => {
    const reviewer = { protection_rules: [{ type: 'required_reviewers', reviewers: [{ type: 'User' }] }] };
    expect(runCheck('production', reviewer).status).toBe(0);
    expect(runCheck('production', { protection_rules: [] }).status).not.toBe(0);
    expect(runCheck('production', { protection_rules: [{ type: 'required_reviewers', reviewers: [] }] }).status).not.toBe(0);
    expect(runCheck('staging', { protection_rules: [] }).status).toBe(0);
    expect(runCheck('production', { status: 404 }).status).not.toBe(0);
    expect(runCheck('staging', { status: 404 }).status).not.toBe(0);
  });
});
