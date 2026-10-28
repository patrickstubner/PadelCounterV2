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

The ids from step 4 are committed in `adapters/cloudflare/wrangler.toml` (checked 2026-10-27):

- `f7d1464e-628a-4959-83bd-9ac0739a0078` on the top-level database and on `env.production` (database name `padel-counter`)
- `b3420f8a-7ee5-41ba-bdb5-9ee06290e541` on `env.staging` (database name `padel-counter-staging`)

A D1 database id is an identifier, not a credential. Leave the `env.dev` id as the local placeholder `22222222-2222-4222-8222-222222222222` unless step 4 creates a dev database. That placeholder is not a live database. If the databases are ever recreated, replace the two ids above and nothing else.

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

`staging` and `production` already exist. `production` has no required reviewer. Patrick removed that rule on 2026-10-28. Deploy to production is a manual `workflow_dispatch`, and the environment's deployment branch policy is custom and contains only `main`. The deploy job checks that policy and fails if it is missing, if it allows protected branches instead, or if the custom policies are anything other than the branch `main`. Confirm the policy in the GitHub environment settings if it is ever cleared. **Owner must do (browser/account)** only to change that branch policy. Creating the environments again is not part of this pass.

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
- One isolate allows 20 of those requests per minute per address. That counter dies with the isolate.
- A failed `POST /join` is tighter than that: 5 failures per minute per address inside the same isolate. The worker reads the credential first. While those 5 remain, the only D1 write is the network failure row. The next failure returns 429 and does not write. A successful join does not use this budget.
- `POST /join` writes D1 table `join_quota` only after that read. The device id is sent by the client (`d` and 8 hex digits) and is not checked against the phone, so the device cap does not stop an attacker who changes the id. It counts 20 successful joins per minute for one id. It does not count a failed token. One network may record 60 failed attempts per minute. A successful join does not increment the network row, so several phones on one court Wi-Fi or one CGNAT address are not locked out by playing. The stored key is an HMAC, not the device id or the address. Migration `0004_join_quota.sql` is applied by step 4.

The binding’s 30 and the network failure cap of 60 are both above the isolate cap of 20. One isolate never reaches them. They apply only when more than one isolate, or more than one Cloudflare location, sees the same key. `SECURITY.md` states this.

Do not create `EDGE_RATE_LIMIT_RULE`. Do not pass `edge_rate_limit_confirmed`. The deploy workflow does not read either. A custom domain would make a zone WAF rule possible, and this project does not add one.

If a zone is added later, the Free plan allows one rate limiting rule, a counting period of 10 seconds, and a mitigation timeout of 10 seconds. The counting characteristic is IP. The expression can use path. Source: the availability table on [Rate limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/) (last updated 25 August 2026). Use one rule whose expression ORs the three paths:

```txt
(starts_with(http.request.uri.path, "/matches") or http.request.uri.path eq "/join" or starts_with(http.request.uri.path, "/ws/"))
```

Characteristic IP, action Block, period 10 seconds, mitigation timeout 10 seconds, 10 requests per period. Ten requests in 10 seconds is the Free-plan stand-in for 60 requests in a minute: the Free plan cannot count over 60 seconds. `/matches/:id/ws` is not a route. That rule is documentation only. It is not a deploy step.

## 11. First staging deploy

**can be scripted with wrangler/gh once a token exists.**

Push to `main` after steps 1–7. The staging job runs on that push. It migrates `padel-counter-staging` and deploys the worker `padel-counter-staging`. Watch the Actions log. A missing token skips successfully and does not deploy. Staging does not need the production branch policy. It only has to exist.

On this first staging run, confirm that the token from step 2 is enough. Workers Scripts: Edit and D1: Edit are the intended set. If `wrangler d1 migrations apply` or `wrangler deploy` fails because the token is not allowed to read account settings, add Account Settings: Read and rerun the job. Do not add that permission before the failure.

## 12. Smoke test

**can be scripted with wrangler/gh once a token exists** for the HTTP checks below. **Owner must do (browser/account)** for a pass on the court.

Run this against the staging worker from step 11, after step 6. Without `QUOTA_HMAC_KEY`, `POST /matches` and `POST /join` return `503` and `not_configured`. Send `Origin: https://patrickstubner.github.io` on every call except `/health` and the foreign-origin check. Staging is not `development`, so a localhost origin is refused. `/health` does not check `Origin`.

```sh
BASE="https://padel-counter-staging.<workers.dev subdomain>.workers.dev"
ORIGIN="https://patrickstubner.github.io"

curl -fsS "$BASE/health"
```

Expect `200` and JSON with `"ok": true`, `"service": "padel-counter"`, and `"protocol": 1`.

`POST /matches` expects `201`. The body is a device id (`d` plus 8 hex digits) and a schema 2 log. The server replaces `matchId`. Names are NFC, trimmed, and 1–20 code points. `createdAt` and `updatedAt` are positive integers below `10000000000000`.

```sh
curl -sS -o /tmp/padel-match.json -w "%{http_code}\n" \
  -H "origin: $ORIGIN" -H "content-type: application/json" \
  -d '{"device":"d00000001","log":{"schemaVersion":2,"base":{"schemaVersion":2,"matchId":"11111111-1111-4111-8111-111111111111","revision":0,"createdAt":1700000000000,"updatedAt":1700000000000,"teams":{"a":{"name":"Team A"},"b":{"name":"Team B"}},"sets":[{"a":0,"b":0},{"a":0,"b":0},{"a":0,"b":0}],"activeSet":0,"serve":null},"events":[]}}' \
  "$BASE/matches"
```

Expect `201` and JSON with `matchId` and `hostToken`. Use those values as `MATCH` and `HOST`.

`POST /matches/:id/invites` expects `201`. The bearer is the host token. The role is `player`. A spectator role is refused.

```sh
curl -sS -o /tmp/padel-invite.json -w "%{http_code}\n" \
  -H "origin: $ORIGIN" -H "content-type: application/json" \
  -H "authorization: Bearer $HOST" \
  -d '{"role":"player"}' \
  "$BASE/matches/$MATCH/invites"
```

Expect `201` and JSON with `token`, `role` `"player"`, `matchId`, and `expiresAt`. Use `token` as `INVITE`.

`POST /join` with an unknown but well-formed bearer (22 URL-safe characters, for example 22 `a`s) and a valid device expects `401` and `{ "error": "bad_token", "message": "This code is not valid." }`. One such call is enough. It records a failed attempt. Do not repeat it.

```sh
curl -sS -o /tmp/padel-join-bad.json -w "%{http_code}\n" \
  -H "origin: $ORIGIN" -H "content-type: application/json" \
  -H "authorization: Bearer aaaaaaaaaaaaaaaaaaaaaa" \
  -d '{"device":"d00000002"}' \
  "$BASE/join"
```

The same path with the invite token expects `201` and JSON with `ticket` and `expiresAt`. The host token is also valid here. The ticket lasts 30 seconds and is single-use. The next two calls do not consume it. The WebSocket upgrade does. Run all three within those 30 seconds.

```sh
curl -sS -o /tmp/padel-join.json -w "%{http_code}\n" \
  -H "origin: $ORIGIN" -H "content-type: application/json" \
  -H "authorization: Bearer $INVITE" \
  -d '{"device":"d00000002"}' \
  "$BASE/join"
```

`GET /ws/:ticket` with the Pages origin and no `Upgrade` header expects `426` and `{ "error": "upgrade_required", "message": "Update the app to keep scoring." }`. A missing origin on this path is `403`, so the `426` check must send the Pages origin.

```sh
curl -sS -o /tmp/padel-ws-plain.json -w "%{http_code}\n" \
  -H "origin: $ORIGIN" \
  "$BASE/ws/$TICKET"
```

The same URL with a foreign origin, for example `https://example.com`, expects `403` and `{ "error": "origin" }`. That call does not consume the ticket either.

```sh
curl -sS -o /tmp/padel-ws-origin.json -w "%{http_code}\n" \
  -H "origin: https://example.com" \
  "$BASE/ws/$TICKET"
```

Open a WebSocket to `wss://padel-counter-staging.<workers.dev subdomain>.workers.dev/ws/$TICKET` with `Origin: https://patrickstubner.github.io`. Expect HTTP `101`. `curl` does not complete this handshake or read the frames; use a WebSocket client such as `websocat`. The first client message is `{"type":"hello","protocol":1,"token":"<invite token>","device":"d00000002"}`. The server then sends a text frame `{ "type": "snapshot", "protocol": 1, ... }` and a text frame `{ "type": "presence", "players": <number> }`. A second upgrade with the same ticket expects `401` and `bad_token`.

Then open the court, share a match, and join from a second browser only after production Pages has the `PUBLIC_API_URL` from step 9. A staging worker and the published court are different hosts until that variable is the production origin and Pages has been deployed.

## 13. Production deploy

**Owner must do (browser/account).**

On `main`, run the Deploy workflow with “Run workflow”. Nothing in `production` asks for a reviewer. The job checks that the deployment branch policy is custom and contains only `main`, checks out that exact commit, migrates `padel-counter`, deploys the worker `padel-counter`, and, when `DEPLOY_PAGES` is `true`, publishes GitHub Pages for the same commit. Do not run it for a commit that has not passed CI. Do not mark a pull request ready just to deploy.

## 14. Usage and billing notifications

**Free: no notification needed.** This account stays on the Workers Free plan. Do not add a usage notification or a budget alert for it. Those notifications are for a paid account only.

Checked against the Cloudflare docs on 2026-10-27. The Durable Object figures below were added in review 8 (P8-02).

Workers Free, from [Pricing](https://developers.cloudflare.com/workers/platform/pricing/) (last updated 2 October 2026) and [Limits](https://developers.cloudflare.com/workers/platform/limits/) (last updated 12 October 2026):

- 100,000 requests per day.
- 10 milliseconds of CPU time per request.

The daily request limit resets at 00:00 UTC. Past it, Cloudflare returns Error 1027. That is an outage until the reset, not an invoice. A zone route can be fail open (the Worker is skipped) or fail closed (the 1027 page). This project has no zone route. CPU time over 10 milliseconds on one request is Error 1102, from the same Limits page. That is also not a bill.

D1 on Workers Free, from [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) (last updated 21 April 2026):

- 5 million rows read per day.
- 100,000 rows written per day.

Those limits reset at 00:00 UTC. Past either one, D1 queries return errors until then. Stored rows stay. The Free plan does not invoice the overage. The Workers Paid plan is what removes the daily cap and starts a bill.

[D1 enforces free tier daily query limits](https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/) (1 September 2026) says Cloudflare emails when that D1 daily limit is reached. The query error tells the account to wait until midnight UTC. Patrick does not configure that email.

Durable Objects on Workers Free, from [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) (last updated 18 October 2026) and [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/) (last updated 1 June 2026), both read on 2026-10-27. `MatchRoom` is a SQLite-backed Durable Object (`new_sqlite_classes`), which is the only kind the Free plan can use:

- 100,000 Durable Object requests per day. A request is an HTTP request, an RPC session, an alarm invocation, or a WebSocket message. For billing, the docs count incoming WebSocket messages at a 20 to 1 ratio, and opening the socket is one request. The page states that ratio for billing and does not say whether the Free daily counter applies it, so plan for the plain count.
- 13,000 GB-s of duration per day. Duration is wall-clock time while an object is active or cannot hibernate, billed as 128 MB. The room uses the WebSocket Hibernation API (`acceptWebSocket`), so an idle room with open sockets is not billed for duration once its handlers finish.
- 100,000 SQLite rows written per day, 5 million rows read per day, and 5 GB of SQL stored data in total for the account. Every accepted live event is inserted into the room table, and deletes, `setAlarm()` and key-value `put()` calls each count as rows written. This is the same budget size as D1, but it is a separate counter, and the room writes on every point. Heavy use reaches the Durable Object write cap before the D1 cap.
- Daily Free limits reset at 00:00 UTC. Past a cap, further operations of that type fail with an error. This is an outage until the reset, not an invoice.
- Per object: one object is single-threaded with a soft limit of 1,000 requests per second, and the Limits page lists a 2 MB cap for a row, string or blob and 10 GB of storage per object. Its text about a full object mentions 1 GB on the Free plan, which the table does not show. The Free account total of 5 GB is the number to rely on. CPU per request is 30 seconds by default for a Durable Object, but the Workers Free plan still has 10 milliseconds per request (Limits page above).

Paid only, if this account is later Workers Paid: [Usage-based billing](https://developers.cloudflare.com/billing/understand/usage-based-billing/) (last updated 29 May 2026) describes a Billable Usage notification for a Professional plan or higher, and says the email does not replace the invoice. [Platform Notifications](https://developers.cloudflare.com/notifications/notification-available/) (last updated 21 October 2026) lists Usage Based Billing for Professional plans or higher, with a note that those notifications are for Pay-as-you-go accounts. [Budget alerts](https://developers.cloudflare.com/billing/manage/budget-alerts/) (last updated 29 May 2026) are an account-wide dollar threshold under Billing, then Billable Usage, and they are Pay-as-you-go only. They do not pause usage. Leave all of these unset while the plan is Free.
