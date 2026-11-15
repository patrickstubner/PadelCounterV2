import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../scripts/check-release-gate.mjs', import.meta.url));
const SHA = 'a'.repeat(40);
const TOKEN = 'ghs_should_not_print';

const run = (fixture: unknown, sha = SHA) =>
  spawnSync(process.execPath, [script], {
    env: { ...process.env, GATE_SHA: sha, GITHUB_TOKEN: TOKEN, RELEASE_GATE_FIXTURE: JSON.stringify(fixture) },
    encoding: 'utf8',
  });

const ci = (conclusion: string) => ({ workflow_runs: [{ id: 1, status: 'completed', conclusion }] });
const deploy = { workflow_runs: [{ id: 7, status: 'completed', conclusion: 'success' }] };
const jobs = (job: string, smoke: string) => ({
  7: { jobs: [{ name: 'Staging worker', conclusion: job, steps: [{ name: 'Smoke test', conclusion: smoke }] }] },
});

describe('Production-Gate gleicher SHA (T-09)', () => {
  it('lässt durch, wenn CI und Staging mit Smoke-Test grün sind', () => {
    const result = run({ ciRuns: ci('success'), deployRuns: deploy, jobsByRun: jobs('success', 'success') });
    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).not.toContain(TOKEN);
  });

  it('sperrt bei roter CI, rotem Staging, übersprungenem Smoke-Test oder fehlendem Lauf', () => {
    expect(run({ ciRuns: ci('failure'), deployRuns: deploy, jobsByRun: jobs('success', 'success') }).status).toBe(1);
    expect(run({ ciRuns: ci('success'), deployRuns: deploy, jobsByRun: jobs('failure', 'success') }).status).toBe(1);
    expect(run({ ciRuns: ci('success'), deployRuns: deploy, jobsByRun: jobs('success', 'skipped') }).status).toBe(1);
    expect(run({ ciRuns: ci('success'), deployRuns: { workflow_runs: [] }, jobsByRun: {} }).status).toBe(1);
  });

  it('verlangt einen vollen SHA', () => {
    expect(run({}, 'main').status).toBe(2);
  });

  it('deploy.yml ruft das Gate vor dem Production-Deploy auf und hat nur actions: read dazu', () => {
    const yaml = readFileSync(new URL('../../../.github/workflows/deploy.yml', import.meta.url), 'utf8');
    const prod = yaml.slice(yaml.indexOf('\n  production:'), yaml.indexOf('\n  pages:'));
    expect(prod).toContain('check-release-gate.mjs');
    expect(prod.indexOf('check-release-gate.mjs')).toBeLessThan(prod.indexOf('wrangler deploy --env production'));
    expect(prod).toContain('actions: read');
    expect(prod).not.toMatch(/actions: write|contents: write/);
    const staging = yaml.slice(yaml.indexOf('\n  staging:'), yaml.indexOf('\n  production:'));
    expect(staging).toContain('name: Smoke test');
    expect(staging).toContain('scripts/smoke.mjs');
  });
});
