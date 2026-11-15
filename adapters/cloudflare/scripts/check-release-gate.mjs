/* global fetch */

// Production gate (ADR-002, Testplan T-09): ship a SHA to production only when, for that exact SHA,
// - the CI workflow (ci.yml) finished a push run with success, and
// - the Deploy workflow (deploy.yml) finished a push run whose job «Staging worker» succeeded
//   and whose step «Smoke test» succeeded (a skipped staging deploy does not count).
// Reads only the GitHub Actions API with the job token (permission actions: read). Prints no token.
// RELEASE_GATE_FIXTURE is for the unit test. It is not set in GitHub Actions.

const STAGING_JOB = 'Staging worker';
const SMOKE_STEP = 'Smoke test';

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'padel-counter-release-gate',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

export function evaluateGate({ ciRuns, deployRuns, jobsByRun }) {
  const ciOk = (ciRuns?.workflow_runs ?? []).some((run) => run.status === 'completed' && run.conclusion === 'success');
  if (!ciOk) return { ok: false, reason: 'CI für diesen SHA ist nicht grün abgeschlossen' };
  const runs = (deployRuns?.workflow_runs ?? []).filter((run) => run.status === 'completed');
  for (const run of runs) {
    const job = (jobsByRun?.[run.id]?.jobs ?? []).find((item) => item.name === STAGING_JOB);
    const smoke = job?.steps?.find((step) => step.name === SMOKE_STEP);
    if (job?.conclusion === 'success' && smoke?.conclusion === 'success') return { ok: true, reason: `Staging-Lauf ${run.id} grün mit Smoke-Test` };
  }
  return { ok: false, reason: 'kein abgeschlossener Staging-Deploy mit grünem Smoke-Test für diesen SHA' };
}

async function load(sha) {
  if (process.env.RELEASE_GATE_FIXTURE) return JSON.parse(process.env.RELEASE_GATE_FIXTURE);
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('GITHUB_TOKEN und GITHUB_REPOSITORY sind nötig');
  const api = async (path) => {
    const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, { headers: headers(token) });
    if (!response.ok) throw new Error(`GitHub API ${response.status} für ${path.split('?')[0]}`);
    return response.json();
  };
  const query = `head_sha=${sha}&event=push&per_page=20`;
  const ciRuns = await api(`actions/workflows/ci.yml/runs?${query}`);
  const deployRuns = await api(`actions/workflows/deploy.yml/runs?${query}`);
  const jobsByRun = {};
  for (const run of (deployRuns.workflow_runs ?? []).filter((item) => item.status === 'completed').slice(0, 5)) {
    jobsByRun[run.id] = await api(`actions/runs/${Number(run.id)}/jobs`);
  }
  return { ciRuns, deployRuns, jobsByRun };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sha = process.env.GATE_SHA ?? '';
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    console.error('release gate: GATE_SHA muss ein 40-stelliger Commit-SHA sein');
    process.exit(2);
  }
  try {
    const result = evaluateGate(await load(sha));
    if (result.ok) {
      console.log(`release gate: ok (${result.reason})`);
    } else {
      console.error(`release gate: gesperrt, ${result.reason}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`release gate: ${error instanceof Error ? error.message : 'Fehler'}`);
    process.exit(1);
  }
}
