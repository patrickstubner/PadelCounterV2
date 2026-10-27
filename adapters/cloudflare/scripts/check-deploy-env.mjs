/* global fetch */

// Fail a real deploy unless the GitHub environment exists.
// Production must also have a required reviewer. Staging only has to exist.
// DEPLOY_ENV_FIXTURE is for the unit test. It is not set in GitHub Actions.

function productionHasReviewer(body) {
  const rules = Array.isArray(body?.protection_rules) ? body.protection_rules : [];
  return rules.some((rule) => {
    if (!rule || rule.type !== 'required_reviewers') return false;
    if (Array.isArray(rule.reviewers) && rule.reviewers.length === 0) return false;
    return true;
  });
}

async function loadEnvironment(name) {
  if (process.env.DEPLOY_ENV_FIXTURE) {
    const parsed = JSON.parse(process.env.DEPLOY_ENV_FIXTURE);
    if (parsed.status && parsed.status !== 200) {
      console.error(`environment ${name} is not available (${parsed.status})`);
      process.exit(1);
    }
    return parsed.body ?? parsed;
  }
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) {
    console.error('GITHUB_TOKEN and GITHUB_REPOSITORY are required');
    process.exit(1);
  }
  const response = await fetch(`https://api.github.com/repos/${repo}/environments/${encodeURIComponent(name)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'padel-counter-deploy',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) {
    console.error(`environment ${name} is not available (${response.status})`);
    process.exit(1);
  }
  return response.json();
}

const name = process.env.ENV_NAME;
if (name !== 'production' && name !== 'staging') {
  console.error('ENV_NAME must be production or staging');
  process.exit(1);
}

const body = await loadEnvironment(name);
if (name === 'production' && !productionHasReviewer(body)) {
  console.error('production environment needs a required reviewer before deploy');
  process.exit(1);
}
console.log(`${name} environment check passed`);
