# Deploy preparation

Do these in order before the first real deploy of Padel Counter V2. Nothing here needs a paid Cloudflare plan or a credit card. There is no custom domain. The worker host is `https://padel-counter.<workers.dev subdomain>.workers.dev`. Staging is `https://padel-counter-staging.<workers.dev subdomain>.workers.dev`. The court stays at `https://patrickstubner.github.io/PadelCounterV2/`.

The deploy workflow skips the worker when `CLOUDFLARE_API_TOKEN` or the account id is missing, and that skip is a success. Pages does not run unless the repository variable `DEPLOY_PAGES` is `true`. Do not merge this checklist into a deploy by hand from a laptop unless the same checks in `.github/workflows/deploy.yml` would pass.

Each step is marked **Owner must do (browser/account)** or **can be scripted with wrangler/gh once a token exists**.

## 1. Cloudflare account and workers.dev subdomain

**Owner must do (browser/account).**

Create a Cloudflare account on the free plan. In Workers & Pages, choose the workers.dev subdomain. That name is the `<workers.dev subdomain>` below. It is not knowable before the account exists. The public production host will be `https://padel-counter.<workers.dev subdomain>.workers.dev`.

## 2. API token

**Owner must do (browser/account).**

Create a custom API token. Do not use the Global API Key.

Minimal permissions, restricted to this account:

- Account, Workers Scripts, Edit
- Account, D1, Edit

Do not grant a zone permission. This project has no zone. Do not grant account-wide admin. Do not add Account Settings: Read yet. Step 11 checks whether these two permissions are enough. Add Account Settings: Read only if that first staging deploy says the token cannot read account settings.

## 3. Account id

**can be scripted with wrangler/gh once a token exists.**

With `CLOUDFLARE_API_TOKEN` set in the environment, from `adapters/cloudflare`:

```sh
pnpm exec wrangler whoami
```

Copy the account id from that output. The dashboard shows the same id under Workers & Pages. The workflow accepts it as the environment secret `CLOUDFLARE_ACCOUNT_ID` or the variable of the same name.

## 4. D1 databases and migrations

**can be scripted with wrangler/gh once a token exists.**

From `adapters/cloudflare`, with the token and `CLOUDFLARE_ACCOUNT_ID` set:

```sh
pnpm exec wrangler d1 create padel-counter
pnpm exec wrangler d1 create padel-counter-staging
```

Keep the local placeholder database id `22222222-2222-4222-8222-222222222222` unless a `padel-counter-dev` database is created on purpose. The dev worker name is `padel-counter-dev`.

The staging and production jobs apply migrations before deploy:

```sh
pnpm exec wrangler d1 migrations apply DB --env staging --remote
pnpm exec wrangler d1 migrations apply DB --env production --remote
```

That applies `migrations/0001_init.sql`, `migrations/0002_quota_credentials.sql`, `migrations/0003_quota_cap.sql`, and `migrations/0004_join_quota.sql`. Live scores stay in the Durable Object. Do not point these commands at a database you do not own.

## 5. wrangler.toml database ids

**can be scripted with wrangler/gh once a token exists.**

Put the ids from step 4 into `adapters/cloudflare/wrangler.toml` and commit them:

- `11111111-1111-4111-8111-111111111111` on the top-level database and on `env.production` (database name `padel-counter`)
- `33333333-3333-4333-8333-333333333333` on `env.staging` (database name `padel-counter-staging`)

Leave the `env.dev` id as the local placeholder unless step 4 created a dev database. The checked-in placeholders are not live databases. A deploy that still has them fails at migration time.

## 6. QUOTA_HMAC_KEY

**can be scripted with wrangler/gh once a token exists.**

Generate one long random string and store it outside the repo. Do not commit it. Do not put it in a GitHub secret. From `adapters/cloudflare`:

```sh
pnpm exec wrangler secret put QUOTA_HMAC_KEY --env staging
pnpm exec wrangler secret put QUOTA_HMAC_KEY --env production
```

Use the same value on both workers if both should accept the same phones, or two values if the environments must not share counters. The worker refuses a create and a join with `503 not_configured` until the secret exists. `.dev.vars.example` names the key and has no value. Local `wrangler dev` reads `.dev.vars`, which is gitignored.

## 7. GitHub environment secrets

**can be scripted with wrangler/gh once a token exists.** The environments themselves are already in place.

`staging` and `production` already exist. `production` requires reviewer `patrickstubner` and allows the `main` branch. The deploy job checks that `production` has a required reviewer and fails if that rule is missing. Confirm that in the GitHub environment settings if it is ever cleared. **Owner must do (browser/account)** only to change that reviewer rule. Creating it again is not part of this pass.

`github-pages` is the Pages environment and is separate.

Set the Cloudflare token and the account id on both `staging` and `production`. The workflow reads `secrets.CLOUDFLARE_API_TOKEN` and `secrets.CLOUDFLARE_ACCOUNT_ID` (or `vars.CLOUDFLARE_ACCOUNT_ID`).

```sh
gh secret set CLOUDFLARE_API_TOKEN --env staging --repo patrickstubner/PadelCounterV2
gh secret set CLOUDFLARE_API_TOKEN --env production --repo patrickstubner/PadelCounterV2
gh secret set CLOUDFLARE_ACCOUNT_ID --env staging --repo patrickstubner/PadelCounterV2
gh secret set CLOUDFLARE_ACCOUNT_ID --env production --repo patrickstubner/PadelCounterV2
```

`gh` must already be logged in as someone who can edit those environments. The account id is not a token. Do not print the API token into a log.

## 8. Pages source and DEPLOY_PAGES

**Owner must do (browser/account)** for the Pages source. **can be scripted with wrangler/gh once a token exists** for the variable.

In the repository settings, Pages, set the source to GitHub Actions. Pages does not publish from the branch itself.

Then:

```sh
gh variable set DEPLOY_PAGES --body true --repo patrickstubner/PadelCounterV2
```

The production workflow builds Pages only after that commit’s worker deploy, and only when `DEPLOY_PAGES` is `true`. An ordinary push to `main` does not publish Pages.

## 9. PUBLIC_API_URL

**can be scripted with wrangler/gh once a token exists.**

The origin is known from the worker name and the subdomain in step 1. It does not have to wait for a successful deploy. Set the repository variable to the origin only, with no path and no trailing slash:

```sh
gh variable set PUBLIC_API_URL --body "https://padel-counter.<workers.dev subdomain>.workers.dev" --repo patrickstubner/PadelCounterV2
```

Replace `<workers.dev subdomain>` with the name from step 1. The Pages build copies that origin into `connect-src`. Leave it unset for CI. CI refuses an `index.html` that contains any http(s) URL. A Pages build may contain only that workers.dev origin.

## 10. Rate limit

**No dashboard step.** The measures ship in the repository.

A WAF rate-limiting rule cannot target `*.workers.dev`. Those rules belong to a zone, and this account does not attach the worker to a zone. `SECURITY.md` cites the Cloudflare docs and the date they were read.

What limits traffic on the workers.dev host, in this order:

- A Workers Rate Limiting binding, `REQUEST_LIMIT`, from `[[ratelimits]]` in `wrangler.toml`. It allows 30 requests per 60 seconds for one HMAC of the client address. The check runs before the D1 counters, on `POST /matches`, `POST /matches/:id/invites`, `POST /matches/:id/carry`, `POST /join`, and `GET /ws/*`. Over the limit the worker returns 429. The count is per Cloudflare location and is approximate: a burst can pass. Staging uses namespace `1002` and dev uses `1003`, so they do not share the production namespace `1001`. Source: [Rate Limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) (last updated 21 October 2026). The key is an HMAC of `QUOTA_HMAC_KEY`, not the raw address. The same page advises against a raw IP key because many people share one address; this project still keys on the address, because there is no account, and stores only the HMAC.
- `POST /join` writes D1 table `join_quota`. One device may try 20 times per minute. One network may record 60 failed attempts per minute (missing, invalid, expired, or revoked token, or a match that is not in D1). A successful join does not increment the network row, so several phones on one court Wi-Fi or one CGNAT address are not locked out by playing. The stored key is an HMAC, not the device id or the address. Migration `0004_join_quota.sql` is applied by step 4.
- Those same routes also share 20 requests per minute per address inside one isolate. That counter is not global.

Do not create `EDGE_RATE_LIMIT_RULE`. Do not pass `edge_rate_limit_confirmed`. The deploy workflow does not read either. A custom domain would make a zone WAF rule possible, and this project does not add one.

If a zone is added later, the Free plan allows one rate limiting rule, a counting period of 10 seconds, and a mitigation timeout of 10 seconds. The counting characteristic is IP. The expression can use path. Source: the availability table on [Rate limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/) (last updated 25 August 2026). Use one rule whose expression ORs the three paths:

```txt
(starts_with(http.request.uri.path, "/matches") or http.request.uri.path eq "/join" or starts_with(http.request.uri.path, "/ws/"))
```

Characteristic IP, action Block, period 10 seconds, mitigation timeout 10 seconds, 10 requests per period. Ten requests in 10 seconds is the Free-plan stand-in for 60 requests in a minute: the Free plan cannot count over 60 seconds. `/matches/:id/ws` is not a route. That rule is documentation only. It is not a deploy step.

## 11. First staging deploy

**can be scripted with wrangler/gh once a token exists.**

Push to `main` after steps 1–7. The staging job runs on that push. It migrates `padel-counter-staging` and deploys the worker `padel-counter-staging`. Watch the Actions log. A missing token skips successfully and does not deploy. A missing production reviewer is not required for staging.

On this first staging run, confirm that the token from step 2 is enough. Workers Scripts: Edit and D1: Edit are the intended set. If `wrangler d1 migrations apply` or `wrangler deploy` fails because the token is not allowed to read account settings, add Account Settings: Read and rerun the job. Do not add that permission before the failure.

## 12. Smoke test

**can be scripted with wrangler/gh once a token exists** for `/health`. **Owner must do (browser/account)** for a pass on the court.

```sh
curl -fsS "https://padel-counter-staging.<workers.dev subdomain>.workers.dev/health"
```

Expect JSON with `"ok": true` and `"service": "padel-counter"`. Then open the court, share a match, and join from a second browser only after production Pages has the `PUBLIC_API_URL` from step 9. A staging worker and the published court are different hosts until that variable is the production origin and Pages has been deployed.

## 13. Production approval

**Owner must do (browser/account).**

On `main`, run the Deploy workflow with “Run workflow”. `production` asks `patrickstubner` to approve. The job checks out that exact commit, migrates `padel-counter`, deploys the worker `padel-counter`, and, when `DEPLOY_PAGES` is `true`, publishes GitHub Pages for the same commit. Do not approve a commit that has not passed CI. Do not mark a pull request ready just to deploy.

## 14. Usage and billing notifications

**Owner must do (browser/account).** Patrick does this in the Cloudflare dashboard after the account in step 1 exists. It can wait until after the first staging deploy. It does not change the worker.

The free Workers plan includes 10 million requests and 30 million CPU milliseconds. Past that, Workers bills requests and CPU time. D1 bills rows read and rows written. Notifications do not stop usage and do not cap a bill. The monthly invoice is the source of truth.

Checked against the Cloudflare docs on 2026-10-27:

- [Usage-based billing](https://developers.cloudflare.com/billing/understand/usage-based-billing/) (last updated 29 May 2026). Workers billable metrics are requests and CPU time. Per-product email notifications are described for a Professional plan or higher: open the account, go to Notifications, and add a Billable Usage notification. The same page says those emails are informational.
- [Platform Notifications](https://developers.cloudflare.com/notifications/notification-available/) (last updated 21 October 2026). The catalog entry is Usage Based Billing, under Billing. The dashboard path on that page is Alerts, then Platform Notifications, then Create a Notification. It is included with Professional plans or higher, and the note says usage-based billing notifications are for Pay-as-you-go accounts only.
- [D1 billing](https://developers.cloudflare.com/d1/observability/billing/) (last updated 21 April 2026). D1 notifications cover Rows Read and Rows Written. The same page shows current usage under Billing, then Billable Usage. History there is kept for 30 days.
- [Budget alerts](https://developers.cloudflare.com/billing/manage/budget-alerts/) (last updated 29 May 2026). An account-wide dollar threshold is Billing, then Billable Usage, then Create budget alert. Pay-as-you-go only. The alert resets each billing period and does not pause usage.

Open both screens. If the dashboard shows Workers, set a notification for requests and for CPU time. If it shows D1, set one for Rows Read and one for Rows Written. If a budget alert is offered, add one low dollar threshold as well. If those controls are missing, that matches a free plan that is not Professional and not Pay-as-you-go. Do not buy a plan only to obtain the alert. The accepted residual risk in `SECURITY.md` covers cost and availability while the worker stays on `workers.dev` without a zone.
