# PadelCounterV2

Padel Counter v2. The court is the v1 game counter, without undo, plus a live match that two phones can share with a QR code.

The installed app is intended to be served at <https://patrickstubner.github.io/PadelCounterV2/>. The worker name is `padel-counter`.

This repository is the first scaffold. Login, shared history, and delete rights are not in it.

## What you can do

- Count games the way v1 does. Six games, lead of two, 7–5, a tiebreak at 6–6 counted as one game, best of three. A third set can always be opened. Minus removes one game. There is no undo.
- Keep the score on this device when you are not connected. Storage keys start with `padel-counter-v2.` so a v1 install on the same phone is left alone.
- Connect players. The creating phone shows a QR code. Anyone who scans it sees the match and can change the games. At most 4 phones can be connected. The fifth is refused with “This match already has 4 players.”
- Read the privacy note in the app menu. It is not legal advice.

A second, view-only QR code is not available yet. The server already has a `player | spectator` role on the join token and checks it before every change. Only `player` can be issued.

## Layout

| Path | Package | Role |
| --- | --- | --- |
| `apps/web` | `@padel/web` | React court, GitHub Pages, service worker |
| `packages/core` | `@padel/core` | Scoring, roles, join rules, log parser. No DOM. |
| `adapters/cloudflare` | `@padel/worker` | Worker, one Durable Object per match, D1 migration stub |
| `docs/architektur-report.md` | | Architecture notes this scaffold follows |

Live scoring is stored in the Durable Object. D1 stores the match id. A websocket is forwarded only when that id is already there, so an unknown id does not create storage. The worker chooses the match id. The dev worker name is `padel-counter-dev`.

## Scripts

Requires Node 22 and pnpm 10.33.4 (`packageManager` in the root `package.json`).

```sh
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm dev
```

`pnpm dev` starts the court. `pnpm dev:worker` starts `wrangler dev --env dev` from `adapters/cloudflare`. Copy `adapters/cloudflare/.dev.vars.example` to `.dev.vars` for that. There are no OAuth secrets to fill in.

To point a local court at a local worker, start the worker and run the court with `PUBLIC_API_URL=http://127.0.0.1:8787`. The dev worker allows that origin. Production and staging do not.

## What Patrick has to create before a real deploy

Nothing here requires a paid Cloudflare plan or a credit card. Do these in order. Until the Cloudflare secrets exist, the deploy workflow skips the worker and exits successfully. GitHub Pages stays off until `DEPLOY_PAGES` is set, so a private repository is not asked to use a paid Pages plan.

1. Create a Cloudflare account on the free plan and choose the workers.dev subdomain. Copy the account id from the dashboard (Workers & Pages, then the account). The public host will be `https://padel-counter.<that-subdomain>.workers.dev`. It is not knowable before the account exists.
2. Create an API token. Use a custom token, not the Global API Key. Permissions: Account, Workers Scripts, Edit; Account, D1, Edit. Restrict the token to this account. Do not grant account-wide admin.
3. Create two D1 databases, named `padel-counter` (production) and `padel-counter-staging` (staging). Copy each database id. In `adapters/cloudflare/wrangler.toml`, replace the placeholders:
   - `11111111-1111-4111-8111-111111111111` on the top-level database and on `env.production` (database `padel-counter`)
   - `33333333-3333-4333-8333-333333333333` on `env.staging` (database `padel-counter-staging`)
   - Leave `22222222-2222-4222-8222-222222222222` for local `env.dev`, or replace it if you create a `padel-counter-dev` database. Live scoring does not query D1.
4. In the GitHub repository settings, create environments named `staging` and `production`. On `production`, add yourself as a required reviewer if the plan allows protection rules.
5. On each of those environments, add:
   - Secret `CLOUDFLARE_API_TOKEN` (the token from step 2)
   - Secret or variable `CLOUDFLARE_ACCOUNT_ID` (the account id from step 1). The workflow accepts either. It is not highly sensitive, and it is not a token.
6. Repository settings, Pages: set the source to GitHub Actions before turning pages on. Then add a repository variable `DEPLOY_PAGES` with the value `true`. Until that variable is exactly `true`, the pages job does not run.
7. After the first worker deploy, add a repository variable `PUBLIC_API_URL` set to the origin only, for example `https://padel-counter.<subdomain>.workers.dev`, with no path and no trailing slash. The pages build copies that origin into `connect-src`. Leave it unset for the CI build. CI refuses an `index.html` that contains any http(s) URL. A pages build may contain only that workers.dev origin.
8. Turn on secret scanning, push protection, and Dependabot security updates. `dependabot.yml` is already in the repo. Code scanning (CodeQL) is recommended and is not wired in this workflow, so a repository without code scanning stays green.
9. Do not create these yet. They belong to a later login change: Google client id, Facebook app secret, GitHub OAuth client secret, a passkey relying-party id of `patrickstubner.github.io`, a JWT signing key, and `ADMIN_USER_IDS` after your user id exists. No Apple Developer account, no X API, and no email domain.

Staging deploys on every push to `main` when the Cloudflare secret and account id are present. Production deploys only from Actions, “Deploy”, “Run workflow”, on `main`. Both skip cleanly when the secrets are absent. Pages deploys from `main` only when `DEPLOY_PAGES` is `true`.

## Join rules

- The QR code carries a 128-bit token in the URL fragment (`#/join/<matchId>?t=<token>`), not in the query string.
- The token expires after 2 hours. The creating phone’s credential expires after 12 hours and is kept in memory only, so a refresh cannot mint a new code until you share again.
- A new code revokes the previous code. Phones that are already connected stay connected.
- The worker stores SHA-256 hashes of tokens. The raw token is returned once.
- The role is stored with the token. This version issues `player` only. `spectator` is rejected with “View-only links are not available yet.”
- The Durable Object admits at most 4 player sockets, including the creator. Disconnecting frees a place.

## Not in this version

- No accounts. Google, Facebook, GitHub, and passkeys come later. `POST /auth/*` returns 501.
- No shared history and no server-side delete. Deleting a match removes it from this device only. The creator and an admin will be the only people who can delete a shared match later. Other players will only be able to hide it. That is not enforced here because there is nothing to delete on the server.
- No automatic deletion after two years. That retention period is a plan, not a job in this repository.
- No undo control and no undo event.
