/* global fetch */

// Fail a real deploy unless the GitHub environment exists.
// Production must have a custom deployment branch policy that contains only main.
// The environment payload says whether custom policies are on. The branch names are a second request.
// Staging only has to exist.
// DEPLOY_ENV_FIXTURE is for the unit test. It is not set in GitHub Actions.

function productionBranchPolicyIsMainOnly(environment, policies) {
  const policy = environment?.deployment_branch_policy;
  if (!policy || policy.custom_branch_policies !== true || policy.protected_branches !== false) {
    return false;
  }
  if (!policies || policies.total_count !== 1 || !Array.isArray(policies.branch_policies)) {
    return false;
  }
  if (policies.branch_policies.length !== 1) return false;
  const only = policies.branch_policies[0];
  return Boolean(only) && only.name === 'main' && only.type === 'branch';
}

function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'padel-counter-deploy',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function readFixture() {
  return JSON.parse(process.env.DEPLOY_ENV_FIXTURE);
}

async function loadEnvironment(name) {
  if (process.env.DEPLOY_ENV_FIXTURE) {
    const parsed = readFixture();
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
    headers: githubHeaders(token),
  });
  if (!response.ok) {
    console.error(`environment ${name} is not available (${response.status})`);
    process.exit(1);
  }
  return response.json();
}

async function loadBranchPolicies(name) {
  if (process.env.DEPLOY_ENV_FIXTURE) {
    const parsed = readFixture();
    if (parsed.branch_policy_status && parsed.branch_policy_status !== 200) {
      console.error(`deployment branch policy for ${name} is not available (${parsed.branch_policy_status})`);
      process.exit(1);
    }
    const body = parsed.body ?? parsed;
    return {
      total_count: body.total_count,
      branch_policies: body.branch_policies,
    };
  }
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) {
    console.error('GITHUB_TOKEN and GITHUB_REPOSITORY are required');
    process.exit(1);
  }
  const response = await fetch(
    `https://api.github.com/repos/${repo}/environments/${encodeURIComponent(name)}/deployment-branch-policies?per_page=100`,
    { headers: githubHeaders(token) },
  );
  if (!response.ok) {
    console.error(`deployment branch policy for ${name} is not available (${response.status})`);
    process.exit(1);
  }
  try {
    return await response.json();
  } catch {
    console.error(`deployment branch policy for ${name} is not available`);
    process.exit(1);
  }
}

const name = process.env.ENV_NAME;
if (name !== 'production' && name !== 'staging') {
  console.error('ENV_NAME must be production or staging');
  process.exit(1);
}

const body = await loadEnvironment(name);
if (name === 'production') {
  const policies = await loadBranchPolicies(name);
  if (!productionBranchPolicyIsMainOnly(body, policies)) {
    console.error('production environment needs a deployment branch policy restricted to main');
    process.exit(1);
  }
}
console.log(`${name} environment check passed`);
