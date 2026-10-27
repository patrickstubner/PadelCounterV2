# Padel Counter V2

<https://patrickstubner.github.io/PadelCounterV2/>

This link goes live after the first deploy. Until then the page is not up yet.

Padel Counter V2 keeps the score of a padel match on your phone. You can play alone, or share one live match with other phones.

## What the app does

- **Scoring.** A set is won with 6 games and a lead of 2, or 7–5. At 6–6 the next game is the tiebreak and counts as one game, so the set can finish 7–6. A match is best of 3 sets. You can always open an extra set. Tap **+** to give a team a game. Tap **−** to take a game back.
- **QR join, up to 4 players.** The phone that starts the live match shows a QR code. Other phones scan it and can change the score. At most 4 phones can be in the match. The next phone is told: “This match already has 4 players.”
- **End match and reopen.** End match finishes the match at any score and locks the court. The phone that started the match can reopen it. If another phone ended it, that phone can reopen it too, unless the starting phone was the one that ended it. The starting phone can always reopen it.
- **Corrections.** **+** and **−** still work after a set has finished. A set that shows 6:0 can be corrected to 5:1. History keeps every change, with the time and which phone made it. Nothing is overwritten.
- **New match and reconnect.** If a match is still open, New match asks “Finish current match and start a new one?”. Cancel leaves the current match. Finish & new ends it, saves it in History, and starts a fresh one. If the last change was within the last hour, the same question can offer “Reconnect players from last match”. Only phones that were already connected are invited. Each of them sees “Join new match?” and joins with one tap, without scanning. A phone that does not confirm stays out. If the last change was more than an hour ago, share a new QR code. A phone that did not start the match can start its own match. That leaves the shared match on that phone only. The starter’s match stays open.
- **Victory sound.** When a match is won, a short fanfare plays once, together with the celebration. Turn it on or off in the menu with **Victory sound**. The sound is made in the browser. If the phone blocks sound, the celebration still shows and the app stays quiet.
- **How long data is kept.** The score on this phone stays in this browser. A live match stops taking scores one day after the last change. After that, nobody can change the games. The match stays on the server as history for two years, then it is deleted. The app does not ask for a name, an email, or a sign-in.

The privacy note in the menu says the same thing in the app. It is not legal advice.

## How to use

1. Open the app. The court shows Team A and Team B, both on 0.
2. Tap **+** beside a team when that team wins a game. Tap **−** if that game should not have counted.
3. To share the match, open the menu and choose **Connect players**. Hold up the QR code. The other phones scan it. Up to four phones can score.
4. When you are done, open the menu and choose **End match**, then confirm. The score stays. Choose **Resume** later if the match should continue.
5. To start another match, open the menu and choose **New match**. If the current match is still open, choose **Finish & new** or **Cancel**. Within one hour you can turn on **Reconnect players from last match**. Those phones tap **Join** on “Join new match?”.
6. Open **History** in the menu to read the games, who changed them, and the score after each change.
7. Open the menu and use **Victory sound** to turn the win fanfare on or off.

## For developers

The court is the earlier game counter, plus a live match that phones share with a QR code. The worker name is `padel-counter`. Sign-in, a shared delete, and a view-only QR code are not in this version.

### Layout

| Path | Package | Role |
| --- | --- | --- |
| `apps/web` | `@padel/web` | React court, GitHub Pages, service worker |
| `packages/core` | `@padel/core` | Scoring, roles, join rules, log parser. No DOM. |
| `adapters/cloudflare` | `@padel/worker` | Worker, one Durable Object per match, D1 migrations |
| `docs/architektur-report.md` | | Architecture notes this scaffold follows |

Live scoring is stored in the Durable Object. D1 stores the match id, the daily create counters, hashed credentials, and short-lived websocket tickets. A socket is opened only with a one-use ticket from `POST /join`, so a match id on its own does not create storage. The worker chooses the match id and retries if that id is already taken. The dev worker name is `padel-counter-dev`. One device can create 10 live matches per UTC day. One network can create 100. The counters are an HMAC of a worker secret named `QUOTA_HMAC_KEY`, and the UTC day is part of the hash, so it changes every day. The scheduled job deletes those rows after two days.

A live match stops taking scores one day after the last live score. That clock is the server time stored when the match is created and when a score is saved. A time sent by the phone is not used. The server keeps the match as history for two years after the last score, then the scheduled job deletes it. The Privacy page says both.

There is no custom domain. The court and the earlier app share `https://patrickstubner.github.io`. CORS allows that origin and cannot see the path, so the join token is what protects a match. On-device storage keys start with `pcv2:`.

### Scripts

Requires Node 22 and pnpm 10.33.4 (`packageManager` in the root `package.json`).

```sh
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm dev
```

`pnpm dev` starts the court. `pnpm dev:worker` starts `wrangler dev --env dev` from `adapters/cloudflare`. Copy `adapters/cloudflare/.dev.vars.example` to `.dev.vars` and set `QUOTA_HMAC_KEY` to a long random string. There are no OAuth secrets to fill in.

To point a local court at a local worker, start the worker and run the court with `PUBLIC_API_URL=http://127.0.0.1:8787`. The dev worker allows that origin. Production and staging do not.

### Before the first deploy

Nothing here requires a paid Cloudflare plan or a credit card. Do these in order. Until the Cloudflare secrets exist, the deploy workflow skips the worker and exits successfully, and Pages does not run. Do not run the staging or production worker deploy until step 4, the edge rate-limit rule, is saved and `EDGE_RATE_LIMIT_RULE` is `confirmed`.

1. Create a Cloudflare account on the free plan and choose the workers.dev subdomain. Copy the account id from the dashboard (Workers & Pages, then the account). The public host will be `https://padel-counter.<that-subdomain>.workers.dev`. It is not knowable before the account exists.
2. Create an API token. Use a custom token, not the Global API Key. Permissions: Account, Workers Scripts, Edit; Account, D1, Edit. Restrict the token to this account. Do not grant account-wide admin.
3. Create two D1 databases, named `padel-counter` (production) and `padel-counter-staging` (staging). Copy each database id. In `adapters/cloudflare/wrangler.toml`, replace the placeholders:
   - `11111111-1111-4111-8111-111111111111` on the top-level database and on `env.production` (database `padel-counter`)
   - `33333333-3333-4333-8333-333333333333` on `env.staging` (database `padel-counter-staging`)
   - Leave `22222222-2222-4222-8222-222222222222` for local `env.dev`, or replace it if you create a `padel-counter-dev` database. The first deploy applies `migrations/0001_init.sql`, `migrations/0002_quota_credentials.sql`, and `migrations/0003_quota_cap.sql` (the workflow does this when the secrets exist). Live scores stay in the Durable Object.
4. Before any worker deploy, add a Cloudflare rate limiting rule. The free plan includes it. No credit card. In the dashboard open Security → WAF → Rate limiting rules, on the hostname that will serve the worker.
   - Expression: `starts_with(http.request.uri.path, "/matches")`, and the same IP block for `/join` and `/ws`. That covers create, invite, carry, the join ticket, and the websocket. `/matches/:id/ws` is not a route.
   - Characteristic: IP. Action: Block.
   - Threshold: 60 requests per minute per IP. That leaves room for four phones on one court Wi-Fi to connect, rotate a code, and reconnect.
   The worker also limits those routes to 20 per minute per address inside one isolate. That isolate limit is a second line. It is not a substitute. After the rule is saved, set the repository variable `EDGE_RATE_LIMIT_RULE` to `confirmed`. A deploy that has Cloudflare credentials fails without that variable. Production also requires the workflow input `edge_rate_limit_confirmed`. There is no custom domain. If the dashboard can attach the rule only to a zone, and not to `*.workers.dev`, do not point real clients at the worker until the rule exists (`SECURITY.md`).
5. Before the first deploy, create GitHub environments named `staging` and `production`. Pages uses the existing `github-pages` environment. On `production`, add a required reviewer. The deploy job reads that environment and fails if the required reviewer is missing. Staging has to exist as well. The workflow cannot create the reviewer for you.
6. On each of those environments, add:
   - Secret `CLOUDFLARE_API_TOKEN` (the token from step 2)
   - Secret or variable `CLOUDFLARE_ACCOUNT_ID` (the account id from step 1). The workflow accepts either. It is not highly sensitive, and it is not a token.
   - Wrangler secret `QUOTA_HMAC_KEY` on the staging worker and the production worker (`wrangler secret put QUOTA_HMAC_KEY`). It is a long random string. The worker uses it to key the daily create counters. It is not a GitHub secret. A create fails until it is set.
7. Repository settings, Pages: set the source to GitHub Actions. Pages publishes only from the production workflow, after that exact commit’s worker deploy. It does not publish on an ordinary push to `main`.
8. After the first worker deploy, add a repository variable `PUBLIC_API_URL` set to the origin only, for example `https://padel-counter.<subdomain>.workers.dev`, with no path and no trailing slash. The pages build copies that origin into `connect-src`. Leave it unset for the CI build. CI refuses an `index.html` that contains any http(s) URL. A pages build may contain only that workers.dev origin.
9. Turn on secret scanning, push protection, and Dependabot security updates. `dependabot.yml` is already in the repo. Code scanning (CodeQL) is recommended and is not wired in this workflow, so a repository without code scanning stays green.
10. Do not create sign-in providers yet. They belong to a later change: a Google client, a Facebook app secret, a GitHub OAuth client secret, a passkey relying party of the pages host, and a signing key. No Apple Developer account, no X API, and no mail domain.

Staging deploys the worker on every push to `main` when the Cloudflare secret and account id are present and `EDGE_RATE_LIMIT_RULE` is `confirmed`. Production deploys only from Actions, “Deploy”, “Run workflow”, on `main`, after the `production` environment approves that commit. Both skip cleanly when the secrets are absent. Pages runs in that same production run, after the worker, and only for that commit.

### Security

Details are in `SECURITY.md`. The short version:

- The QR code carries a 128-bit token in the URL fragment (`#/join?t=<token>`), not in the query string and not next to the match id.
- The token expires after 2 hours. The creating phone’s credential expires after 12 hours and is kept in memory only, so a refresh cannot mint a new code until you share again.
- A new code revokes the previous code. Phones that are already connected stay connected.
- The worker stores SHA-256 hashes of tokens. The raw token is returned once.
- The role is stored with the token. This version issues `player` only. `spectator` is rejected with “View-only links are not available yet.”
- The Durable Object admits at most 4 player sockets, including the creator. Disconnecting frees a place.
- `POST /auth/*` returns 501. Deleting a match in the app removes it from this device only. A later shared delete is limited to the creator and one admin. Other players will only be able to hide a match. That is not enforced here because the server has no delete route.
- There is no undo control and no undo event. Minus removes one game, and the log keeps the earlier events.
