import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../scripts/check-deploy-env.mjs', import.meta.url));

const TOKEN_SENTINEL = 'ghp_test_secret_should_not_print';

function runCheck(
  envName: string,
  fixture: unknown,
  quotaKey = 'k'.repeat(32),
): { status: number | null; stderr: string; stdout: string } {
  const result = spawnSync(process.execPath, [script], {
    env: {
      ...process.env,
      ENV_NAME: envName,
      DEPLOY_ENV_FIXTURE: JSON.stringify(fixture),
      GITHUB_TOKEN: TOKEN_SENTINEL,
      QUOTA_HMAC_KEY: quotaKey,
    },
    encoding: 'utf8',
  });
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

function mainOnlyPolicy(extra: Record<string, unknown> = {}) {
  return {
    deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
    total_count: 1,
    branch_policies: [{ name: 'main', type: 'branch' }],
    ...extra,
  };
}

describe('production deploy gate', () => {
  const yaml = readFileSync(new URL('../../../.github/workflows/deploy.yml', import.meta.url), 'utf8');

  it('ships the worker and the pages build of one dispatched head', () => {
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

  it('fails production unless the deployment branch policy is custom and only main, and lets staging exist without one', () => {
    const allowed = runCheck('production', mainOnlyPolicy());
    expect(allowed.status).toBe(0);
    expect(allowed.stderr).not.toContain('required reviewer');
    expect(allowed.stdout).not.toContain(TOKEN_SENTINEL);
    expect(allowed.stderr).not.toContain(TOKEN_SENTINEL);

    expect(runCheck('production', mainOnlyPolicy({ protection_rules: [] })).status).toBe(0);
    expect(runCheck('production', mainOnlyPolicy({
      protection_rules: [{ type: 'required_reviewers', reviewers: [] }],
    })).status).toBe(0);

    const missing = runCheck('production', { protection_rules: [] });
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain('production environment needs a deployment branch policy restricted to main');
    expect(missing.stderr).not.toContain('required reviewer');
    expect(missing.stdout).not.toContain(TOKEN_SENTINEL);
    expect(missing.stderr).not.toContain(TOKEN_SENTINEL);

    const otherBranch = runCheck('production', {
      deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
      total_count: 1,
      branch_policies: [{ name: 'super-secret-branch-name', type: 'branch' }],
    });
    expect(otherBranch.status).not.toBe(0);
    expect(otherBranch.stderr).not.toContain('super-secret-branch-name');
    expect(otherBranch.stderr).not.toContain(TOKEN_SENTINEL);

    expect(runCheck('production', {
      deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
      total_count: 0,
      branch_policies: [],
    }).status).not.toBe(0);
    expect(runCheck('production', {
      deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
      total_count: 2,
      branch_policies: [
        { name: 'main', type: 'branch' },
        { name: 'release', type: 'branch' },
      ],
    }).status).not.toBe(0);
    expect(runCheck('production', {
      deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
      total_count: 2,
      branch_policies: [{ name: 'main', type: 'branch' }],
    }).status).not.toBe(0);
    expect(runCheck('production', {
      deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
      total_count: 1,
      branch_policies: [{ name: 'main', type: 'tag' }],
    }).status).not.toBe(0);
    expect(runCheck('production', {
      deployment_branch_policy: null,
      total_count: 1,
      branch_policies: [{ name: 'main', type: 'branch' }],
    }).status).not.toBe(0);
    expect(runCheck('production', {
      ...mainOnlyPolicy(),
      branch_policy_status: 404,
    }).status).not.toBe(0);
    expect(runCheck('staging', { protection_rules: [] }).status).toBe(0);
    expect(runCheck('production', { status: 404 }).status).not.toBe(0);
    expect(runCheck('staging', { status: 404 }).status).not.toBe(0);
  });

  it('rejects a short QUOTA_HMAC_KEY and does not print the value', () => {
    const short = 'short-hmac-value-not-for-logs';
    const rejected = runCheck('staging', { protection_rules: [] }, short);
    expect(rejected.status).not.toBe(0);
    expect(rejected.stderr).toContain('QUOTA_HMAC_KEY is missing or shorter than 32 characters');
    expect(rejected.stdout).not.toContain(short);
    expect(rejected.stderr).not.toContain(short);
    const missing = runCheck('production', mainOnlyPolicy(), '');
    expect(missing.status).not.toBe(0);
    expect(missing.stdout).not.toContain('k'.repeat(32));
    expect(missing.stderr).not.toContain('k'.repeat(32));
    const source = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');
    expect(source).toContain("const CODE_ALARM_LOG = 'short code attempts recorded'");
    expect(source).toContain('console.log(CODE_ALARM_LOG)');
  });
});
