# Security review

Date: 2026-10-27.

This note covers the first Padel Counter v2 scaffold: the court in `apps/web`, the shared rules in `packages/core`, and the Cloudflare worker in `adapters/cloudflare`. It is a review of this tree, not a penetration test, and it is not legal advice.

## Sources

- `docs/architektur-report.md` in this repository (decisions for the worker, the QR fragment, CORS, and what stays out of the first version).
- Padel Counter v1 `docs/SECURITY.md`, dated 2026-10-13, for the court controls that were carried over (CSP, no third-party script hosts, pinned `lottie-web` 5.13.0, service-worker checks). v1 was read only. It was not modified.
- The code reviewed on 2026-10-27: `packages/core/src` (scoring, `access.ts`, `join.ts`, `parse.ts`, `messages.ts`), `adapters/cloudflare/src` (router, `MatchRoom`, room admission, token hashing, CORS), `adapters/cloudflare/wrangler.toml`, `apps/web/src/live`, `apps/web/src/components/QrCode.tsx`, `apps/web/src/index.html`, `apps/web/rsbuild.config.ts`, `apps/web/scripts/verify-build.mjs`, and `.github/workflows`.
- Dependency pins in the workspace `package.json` files, installed with pnpm 10.33.4. `pnpm audit --audit-level=moderate` is part of CI. Versions below are the ones pinned for this review, not floating ranges.
- Cloudflare Workers types `5.20261027.1` and Wrangler `4.153.0`.

The architecture note suggested zod in the core package. This scaffold does not use zod. Events are checked by the hand-rolled parser in `packages/core/src/parse.ts`. That is recorded as a residual choice under findings, not as a claim that zod is present.

## What this version trusts

There is no account. A phone that holds a valid, unexpired player token can read the match and change games. The match id on its own grants nothing. The creating phone holds a longer player token with `host: true` and is the only one that can mint a QR code.

The role is `'player' | 'spectator'` and is stored with the token hash. `canPerform` denies every action to a spectator, including a forged `host: true`. `decideJoin` rejects a spectator even when the room is empty. `issueInvite` refuses to create a spectator token. Spectator QR codes are not built. The checks exist so a later read-only code can be added without a new permission model.

At most 4 admitted player sockets are allowed, including the creator. The Durable Object counts sockets that have already completed hello, excluding the socket being admitted, and calls `decideJoin`. The fifth socket is sent `{ type: 'error', code: 'match_full' }` and closed. The sentence the UI shows is the fixed string “This match already has 4 players.” Disconnecting frees a place. The same QR token may be used by more than one phone; the cap is connections, not token redemptions.

## Controls in this scaffold

- Join tokens are 16 random bytes, unpadded base64url (`/^[A-Za-z0-9_-]{22}$/`). Only the SHA-256 hex digest is stored. Lookup of that digest uses a length-checked comparison that does not return on the first differing character. The raw token is returned once in the create or invite response and is not written to the worker logs by this code.
- Player invite lifetime is 2 hours. The host credential lifetime is 12 hours. A new player code revokes older non-host codes. Sockets that are already open stay open.
- The token is not placed in the query string. The QR target is `…/#/join?t=<token>`. The match id is not in that link. The page strips the token into `sessionStorage` (`pcv2:join`) and replaces the fragment. The host token is kept in a ref in the creating tab and is not written to `localStorage`. A browser WebSocket cannot set `Authorization`, so `POST /join` exchanges the bearer token for a 30-second single-use ticket and the socket is `GET /ws/<ticket>`. The ticket is not the match id and not the long-lived token. `GET /matches/:id/ws` is not a route.
- The WebSocket URL has no token. The first message is `{ type: 'hello', protocol: 1, token }`. The socket attachment stores the role, the host flag, and an HMAC of the client address (`socket-ip` with a fixed scope, so one address still shares the pending cap). It does not store the raw token or the raw address. The Durable Object refuses the socket when `QUOTA_HMAC_KEY` is missing, instead of keeping the address.
- Hello and each later action run on the Durable Object. A spectator credential cannot pass `canPerform`. `undo` and unknown event types fail parsing. `match/new` and `match/reset` are not applied on a live room. The server replaces `event.at` with its own clock. A game that the reducer refuses (for example 7–4, or minus at zero) is not stored. A repeated event id is acknowledged and not appended twice. The event table is insert-only.
- HTTP routes are `GET /health`, `POST /matches`, `POST /matches/:id/invites`, `POST /matches/:id/carry`, `POST /join`, and `GET /ws/<ticket>`. `POST /auth/*` returns 501 `{ error: 'not_available' }`. Delete, `/create`, `/invite`, `/discard`, `/reconnect-info`, `/carry-invite`, and `/notify` are not public routes. The worker calls those internal paths itself on the Durable Object stub.
- CORS allows the origin `https://patrickstubner.github.io` only, plus `http://localhost:<port>` and `http://127.0.0.1:<port>` when `ENVIRONMENT` is `development`. Staging and production set `ENVIRONMENT` to `staging` and `production`. There is no custom domain. CORS cannot see the path, so `/PadelCounter/` and `/PadelCounterV2/` are not separated by the allowlist. The token is what protects a match. Responses vary on `Origin` and do not echo a rejected origin. Credentials (cookies) are not allowed. The browser must send `Authorization: Bearer <token>` on invite, join, and carry. A WebSocket upgrade with a missing or foreign `Origin` is rejected.
- The worker generates the match id. The id inside the client log is rewritten to that id before it is stored. Team renames are passed through `sanitizeTeamName` before they are stored, so the stored name is at most 20 characters.
- A live change is broadcast as one event. The full log is sent on the opening snapshot only. An invalid event or a rate limit sends `{ type: 'error', code }` and leaves the socket open. The socket is closed for admission failures (`bad_token`, `expired`, `revoked`, `spectator_not_available`, `upgrade_required`, `match_full`, `unavailable`).
- Court CSP: `default-src 'self'`, no `unsafe-inline`, no `unsafe-eval`. `connect-src` gains the API origin only when `PUBLIC_API_URL` is an `https` `*.workers.dev` URL at build time. CI leaves it empty, and `verify-build` fails if `index.html` then contains any http(s) URL. The QR is drawn as SVG rectangles from the module matrix. There is no `innerHTML` and no `dangerouslySetInnerHTML`. The accessible name of the QR does not include the token.
- The client renders `ROOM_MESSAGES[code]`. A `message` field on the wire is ignored, including a message that contains markup. Player counts outside 0–4 are ignored.
- Create, invite, carry, `POST /join`, and `GET /ws/*` hit a Workers Rate Limiting binding before anything else. The binding is `REQUEST_LIMIT` (`[[ratelimits]]` in `wrangler.toml`): 30 requests per 60 seconds per HMAC of `CF-Connecting-IP`. The HMAC uses `QUOTA_HMAC_KEY` and a fixed scope, so the binding’s own window can accumulate. The raw address is not the key. Over the limit the worker returns `429 slow_down` and does not write D1. The count is per Cloudflare location and approximate. Staging and dev use different namespace ids (`1002` and `1003`) from production (`1001`). After that, the same routes share a limit of 20 per minute per address inside one isolate. The check runs before any Durable Object is named. Each admitted socket is limited to 10 messages per second, and a ping uses that same budget. A websocket is forwarded only when D1 already has the match id, so an unknown id does not create SQLite storage. Tables are created in the create handler, not when the object wakes. Create writes that id to D1 before it writes the Durable Object. If the object write fails, the worker deletes the D1 row and calls `storage.deleteAll()` on the object. `/discard` is not a public route.
- Un-helloed sockets are closed after 5 seconds. One room accepts at most 16 of them, and one client address accepts at most 8. Admitted sockets count toward neither cap. Eight is enough for four phones on one court Wi-Fi to each hold a handshake and one reconnect. A seventeenth silent socket is refused even when it comes from a new address.
- Body size is capped (about 96 KB for a match log, 8 KB for a socket message). SQL uses bound parameters. Parsed objects are copied onto a null-prototype object before fields are read. Team names are length-limited and rendered as React text.
- Storage keys use the prefix `pcv2:` (`pcv2:log`, `pcv2:matches`, `pcv2:celebrated`, `pcv2:join`, `pcv2:device`, `pcv2:fanfare`). The app does not read or write v1 keys (`padel-counter.v1`, `padel-counter.matches`, `padel-counter.celebrated`). The service worker cache id is `padel-counter-v2-2`. `cleanupOutdatedCaches`, `skipWaiting`, and `clientsClaim` are on, so a phone that still has `padel-counter-v2` drops that cache and loads this client. The pages base is `/PadelCounterV2/`. The installed name is Padel Counter V2.
- A win plays one short fanfare from Web Audio oscillators. There is no audio file, so there is no extra licence and the CSP is unchanged (`media-src 'none'` stays). The menu toggle defaults to on and is stored at `pcv2:fanfare`. If the browser refuses playback, the app stays silent.
- `POST /matches` allows 10 creates per UTC day for one device id, and 100 for one network address, counted in D1 (`create_quota`). The stored key is an HMAC of the worker secret `QUOTA_HMAC_KEY` with the UTC day, not a plain hash of the address. The 11th create on that device is `429 device_daily_limit`. The 101st create from that network is `429 network_daily_limit`. A failed create releases both counts. The two increments run in one D1 batch and roll back together. A unique match-id collision is retried up to three times. The response is not 201 when every attempt fails.
- The live room stops accepting scores one day after the last server-stamped event (`closed`). Seed times from the phone are replaced with the server clock when the match is created, and `by` on those seed rows is `host`. `last_activity` in D1 moves at most once a minute while the match is played. History is 730 days from that column, then a scheduled job discards the Durable Object and deletes the row. The same job deletes create-quota rows and join-quota rows older than two days, and expired websocket tickets. The one-day close does not delete the row. A last-change time in the future does not keep the room open. The cron is on production and staging only.
- `POST /join` reads the credential, and the match row, before it writes. A failed token (missing, invalid, expired, revoked, or a match that is not in D1) writes only the network failure row, one write, and only while the isolate still allows it. The device id is chosen by the client (`d` and 8 hex digits). Nothing ties it to the phone, so the device cap does not stop an attacker who sends a new id. The device counter moves only after a valid token, 20 successful joins per minute, and the 21st is `429 join_device_limit`. One network may record 60 failed attempts per minute. A successful join does not increment that row, so phones on one court Wi-Fi or one CGNAT address are not locked out by playing. A valid token is still admitted when that failure counter is already full. Both keys are an HMAC of `QUOTA_HMAC_KEY` with the minute in the message. The 61st failure from that network is `429 join_network_limit`. The 60th failure still returns the original error and leaves the counter at 60. Inside one isolate, failed joins are throttled earlier than the shared 20: 5 failures per minute per address, then `429 slow_down` with no further D1 write. A missing or malformed `device` is `400 invalid_device` and writes neither row. A new index over the same database still sees the count.
- Joining phones get `p2`, `p3`, and then higher ids. An id already bound to a device is not given to another phone. When no free id remains, the hello is rejected.
- A new player code revokes older player codes and inserts the new hash in one D1 batch. A websocket ticket is consumed with one `DELETE ... RETURNING`.
- A host who starts a new match while one is open must confirm. Finish & new sends `match/end` the same way End match does, so the match stays in history and the creator can reopen it. Inside one hour, and only when the host confirms, previously connected devices are offered `Join new match?`. The invite is bound to those device ids, is host-initiated, and token expiry and revocation are checked on every event. Anyone who does not confirm stays out. After one hour there is no reconnect offer. A non-host who starts a new match leaves the shared match on that phone only and does not send `match/end`.
- End match is allowed at any score. Reopen is `match/resume`, not a general undo. The creator can always reopen. The person who ended it can reopen too, unless the creator was the one who ended it. The server checks this. Minus can correct a finished set (6:0 back to 5:1). The event log is append-only and keeps `by`.
- `.dev.vars`, `.env`, and `.env.*` are gitignored. `.dev.vars.example` names `QUOTA_HMAC_KEY` and does not contain a value. Wrangler database ids in the repo are placeholders, not live databases. `env.dev` is named `padel-counter-dev`, so a local deploy cannot overwrite the production worker name.
- CI runs lint, typecheck, unit tests, the production web build, a wrangler dry-run, and `pnpm audit --audit-level=moderate`. Deploy jobs do nothing until Cloudflare credentials exist, and Pages does not run until the repository variable `DEPLOY_PAGES` is `true`.

## Findings

| Sev. | Topic | What is true now | Proposed fix |
| --- | --- | --- | --- |
| Medium | Open match creation | `POST /matches` needs no login. A client that can reach the worker can still create Durable Objects up to the limit below. Unknown websocket ids no longer create storage: the worker checks D1 first. | Require a signed-in creator when login exists. |
| Medium | QR token is the whole permission | Anyone who sees the code can score, until it expires, is rotated, or the room already has 4 players. The token is not bound to a device. | This is the product for this version. Later: a shorter TTL, a read-only spectator code (the role check is already there), and login. Tell players not to photograph the code for people who should not score. The privacy page says this. |
| Low | Sockets that never say hello | Fixed. One address may hold 8 un-helloed sockets, so four players on one Wi-Fi can each reconnect once. The room also refuses a 17th un-helloed socket, from any address. A Durable Object alarm closes them after 5 seconds. Admitted sockets do not use either budget. | Keep both caps. A zone WAF rule is not available on `workers.dev`. |
| Low | Rate limits are per isolate | The Workers binding runs first and is per location, not global. Its 30 and the D1 network cap of 60 are both above the isolate cap of 20, so one isolate never reaches them. They matter across isolates and locations. Create, invite, carry, `POST /join`, and websocket upgrades share 20 requests per minute per address inside one isolate. Failed joins stop at 5 per minute in that isolate and then do not write D1. The device id is client-chosen, so the device cap does not stop an attacker. Pings share the per-socket event budget. The isolate map resets when the isolate stops. | Keep the binding, both isolate maps, and the D1 counters. Do not require a zone WAF rule for `*.workers.dev`. See “Required before the first deploy”. |
| Info | Cost and availability without a zone | Accepted by Patrick on 27 October 2026. There is no zone, so a WAF rule cannot stop a flood of the `workers.dev` host. On the Workers Free plan that flood is an outage, not an invoice: Error 1027 after 100,000 requests in a day, and D1 errors after 100,000 rows written or 5 million rows read, until 00:00 UTC. Cloudflare emails the D1 limit on its own. A bill starts only if the account is later Paid. The binding is approximate and per location. | Accepted. Do not add a custom domain for this. Do not add a usage notification while the plan is Free. See `docs/DEPLOY.md` step 14. |
| Low | Fifth-player test does not boot a Durable Object | The cap, the exact sentence, the spectator refusal, and `canPerform` are unit-tested. The socket count passed into those functions is not exercised inside `workerd`. | Add a Miniflare or `wrangler dev` test that opens five WebSockets and expects the fifth close with `match_full`. |
| Low | Join token in `sessionStorage` | A script running on the page origin could read the token. The CSP and the HTML-injection lint rule are what prevent that script. | Keep the CSP. Do not add a tag manager, a CDN script, or inline script. Do not put the token back into the query string or `localStorage`. |
| Low | Host token dies with the tab | The creating phone cannot mint a new code after refresh, because the host token is memory-only. That avoids a long-lived secret on disk. Someone who can read the tab’s JS heap during the session can still read it. | Keep it out of `localStorage`. When login exists, mint codes from the session instead of a 12-hour bearer token. |
| Low | D1 holds only the match id | Live scoring still does not read the event log from D1. D1 is the index that must contain a match id before a websocket or invite is forwarded. The checked-in database ids are documentation placeholders. A deploy with those ids will fail at migration time, which is preferable to writing to the wrong database. | Replace the ids before the first real deploy. Apply `migrations/0001_init.sql` as part of that deploy. Do not treat the placeholders as secrets. |
| Low | Parser is hand-rolled | Bounds, types, plausible set scores, and a null-prototype copy are checked. There is no second schema library. A new event field can be forgotten. | Add a schema library when the event list grows. Until then, extend `parseStoredEvent` and the core tests together. Unknown types, including `undo`, already return null. |
| Info | No login, no shared delete | `POST /auth/*` is a stub. Deleting a match in the UI removes it from this browser only. Only the creator and Patrick may delete a shared match later. Others may only hide it. There is still no server delete route. | Login stays out of this pull request. |
| Info | P1-02 Retention | Resolved. Scoring stops one day after the last event. D1 history is deleted after two years by the scheduled job. UI delete is still this device only. | Keep both periods on the Privacy page. |
| Info | P1-03 New match while one is open | Resolved. The host confirms Finish & new. Reconnect is optional, host-only, device-bound, and only within one hour. A non-host leaves locally. | Do not end a match silently. |
| Info | P1-04 Create without login | Resolved, then tightened by P3-06. Ten creates per device per UTC day, plus 100 per network, in one D1 batch. The key is an HMAC. | Keep the isolate limit as a second line. |
| Info | P1-06 Custom domain | Resolved. No custom domain. The app stays at `https://patrickstubner.github.io/PadelCounterV2/` beside v1. CORS allows that origin only. | The path is not a CORS boundary. |
| Info | P1-10 Deploy approval | Resolved. Production uses the `production` environment, checks out `github.sha`, and ships the worker and Pages together. The job fails if that environment has no required reviewer. | Create `production` with a required reviewer, and `staging`, before the first deploy. |
| Info | Code scanning is not in CI | Adding CodeQL while the repository has code scanning turned off fails the workflow. | Enable code scanning, then add a pinned CodeQL workflow. |
| Info | Dependencies | Direct pins include React 19.3.0, `lottie-web` 5.13.0, `qrcode` 1.5.4, TypeScript 6.0.3, Vitest 5.0.4, ESLint 10.12.0, Wrangler 4.153.0, `@cloudflare/workers-types` 5.20261027.1, Rsbuild 2.2.13, and `happy-dom` 21.0.4 (tests only). TypeScript 7 and a newer ESLint exist upstream; this tree stays on the v1 TypeScript and ESLint pins on purpose. `happy-dom` 20.14.6 was the v1 pin and is inside GHSA-834v-8h66-3h79, so the test runner is on 21.0.4. `glob` 11.1.0 is a deprecated transitive of the existing Workbox pin. | Keep `pnpm audit` at moderate or higher in CI. Review Dependabot PRs. Do not bump TypeScript or the lottie player without re-running the court tests and the lottie source check. |

No critical or high issue was left open in this review. The medium items are the lack of login on create, and the fact that the QR code itself is the capability. Both match the scope Patrick set for this pull request. P1-02, P1-03, P1-04, P1-06, and P1-10 are resolved below.

## Resolved product decisions

### P1-02 Retention and deletion

The live room stops taking scores one day after the last event. After that the server answers `closed` and nobody can change the games. D1 keeps the match as history for two years (730 days from `last_activity`). A scheduled job then discards the Durable Object and deletes the row. The one-day close is not a delete. The Privacy page states both periods. Deleting a match in the UI still removes it from this device only. Later, only the match creator and Patrick may delete a shared match, and other players may only hide it. There is no server delete route in this pull request.

### P1-03 New match while one is open

The host sees “Finish current match and start a new one?” with “Finish & new” and “Cancel”. The match is never ended silently. Finish & new sends `match/end`, so the match goes to history and the creator can reopen it. When the last event is at most one hour old, the same dialog shows “Reconnect players from last match”, preselected when someone else was connected. Only those device ids get “Join new match?”. One tap joins. Anyone who does not confirm stays out. The invite is host-initiated, bound to those devices, and expiry and revocation are checked on every event. After one hour the toggle is absent and a new QR is required. A non-host who starts a new match creates their own match on that phone. The host’s open match is unchanged, and the phone does not send `match/end`.

A new QR still revokes the previous join token. Phones that are already connected stay connected. An expired or revoked token cannot score. An open socket is not closed when the 2-hour player token or the 12-hour host credential expires.

### P1-04 Create without login

`POST /matches` needs no account. One device may create 10 matches per UTC day, and one network may create 100. The counter is an HMAC of `QUOTA_HMAC_KEY`, not a plain hash of the address. See P3-06. Login with Google, Facebook, GitHub, and passkeys is out of this version. `POST /auth/*` returns 501 `{ error: 'not_available' }`.

### P1-06 Custom domain

There is no custom domain. v2 is served at `https://patrickstubner.github.io/PadelCounterV2/` next to v1. CORS allows only the origin `https://patrickstubner.github.io`. The path is not visible to CORS, so the token is what stops a request from being useful. Local storage uses `pcv2:` and does not touch v1 keys. The visible name is Padel Counter V2.

### P1-10 Deploy approval

Production deploy is `workflow_dispatch` on `main` and uses the GitHub environment `production`. The job checks out `github.sha` and fails if `HEAD` is anything else. The worker and GitHub Pages of that same commit ship together. Pages runs only after that job. Before the first deploy, `production` must exist and must have a required reviewer, and `staging` must exist. The workflow asks GitHub and fails the deploy if the production reviewer rule is missing. Until the Cloudflare secrets exist, the job skips and stays green, and Pages does not run.

### P1-17, P1-18, and P1-19

P1-17. The join link does not contain the match id. `POST /join` returns a 30-second single-use ticket. `GET /ws/<ticket>` resolves the match. Knowing a match id does not open a socket.

P1-18. A unique id collision on create retries with a new id, up to three times. A failed attempt does not return 201. D1 is still written before the Durable Object. On failure the row is removed and `/discard` runs `storage.deleteAll()`.

P1-19. A zone WAF rate-limiting rule cannot be attached to `*.workers.dev`, so the deploy does not wait for one. `POST /join` is limited in D1 instead. The isolate limit of 20 per minute per address remains, and it also covers `/matches*`, `/join`, and `/ws/*`. If the Cloudflare secrets are missing, the job still skips successfully so an unconfigured repository stays green. Pages still waits for the repository variable `DEPLOY_PAGES`.

## Required before the first deploy

The ordered checklist is `docs/DEPLOY.md`. This section is the rate-limit decision. Checked against the Cloudflare docs on 2026-10-27.

A WAF rate-limiting rule cannot apply to a `*.workers.dev` hostname. Rate limiting rules are zone rules: the dashboard and the API create them for a zone, in the `http_ratelimit` phase, and the API path includes the zone id (`/zones/$ZONE_ID/rulesets/...`). Account-level rate limiting rulesets exist for some Enterprise customers and are still deployed to zones. Sources, with the “Last updated” date on each page:

- [Rate limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/) (25 August 2026). Rules are a WAF product. Account-level rulesets deploy to Enterprise zones.
- [Create a rate limiting rule via API for a zone](https://developers.cloudflare.com/waf/rate-limiting-rules/create-api/) (16 April 2026). “Use the Rulesets API to create a rate limiting rule via API at the zone level.” The caller must have a zone id.
- [workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/) (22 September 2026). `workers.dev` is the account subdomain Cloudflare assigns. The page describes turning that route on or off. It is not a zone the account adds, and it has no place to attach a WAF rule.
- [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) (29 September 2026). A custom domain requires an active Cloudflare zone the account owns. That is how a Worker is placed on a hostname where zone WAF rules run.

This project does not use a custom domain, so there is no zone on which to save the rule. The deploy workflow does not ask for `EDGE_RATE_LIMIT_RULE` or `edge_rate_limit_confirmed`.

If a zone is added later, the Free plan allows one rate limiting rule. The counting period and the mitigation timeout are 10 seconds only. The counting characteristic is IP. The expression fields are path and verified bot. Source: the availability table on the same [Rate limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/) page (25 August 2026). One rule has to cover every path, so the expression ORs them:

```txt
(starts_with(http.request.uri.path, "/matches") or http.request.uri.path eq "/join" or starts_with(http.request.uri.path, "/ws/"))
```

Characteristic IP, action Block, period 10 seconds, mitigation timeout 10 seconds, 10 requests per period. Ten in 10 seconds stands in for 60 in a minute, because the Free plan cannot use a 60 second period. `/matches/:id/ws` is not a route. That rule is documentation only. It is not a deploy step. Three separate rules would exceed the Free plan.

What this deploy uses instead:

- Workers Rate Limiting binding (`[[ratelimits]]` in Wrangler), name `REQUEST_LIMIT`, 30 requests per 60 seconds. It runs inside the Worker, so it does not need a zone. `limit()` is called before the isolate map and before any D1 join write, on create, invite, carry, `POST /join`, and `GET /ws/*`. The key is an HMAC of the client address, not the address itself. The binding is approximate and counted separately in each Cloudflare location, so it is not one global limit. Requests can exceed the configured number while counts update. A strict cross-location limit would be a Durable Object. Source: [Rate Limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) (21 October 2026). The older `[[unsafe.bindings]]` type `ratelimit` is the pre-GA form and is not used. Production and the top-level config share namespace `1001`. Staging is `1002`. Dev is `1003`. The same namespace on one account shares counters inside a location, including across Workers, so the environments are split on purpose.
- D1 counters are on the free plan, are shared by every isolate, and do not reset when an isolate stops. `POST /join` reads the credential before it writes `join_quota` (migration `0004_join_quota.sql`). A failed token writes one network row, 60 failures per minute. The device counter moves only for a successful join, 20 per minute, and the id is chosen by the client, so it does not stop an attacker. The key is an HMAC of `QUOTA_HMAC_KEY` with the minute in the message. The scheduled job deletes rows older than two days.
- Create, invite, carry, `POST /join`, and `GET /ws/*` still share the isolate limit of 20 requests per minute per address, checked after the binding. Failed joins have a second isolate budget of 5 per minute. After that the worker does not write the network row. One isolate stops at 20, so it never reaches the binding’s 30 or the network cap of 60 by itself. Those two apply only across isolates in one location (the binding) or across locations (the D1 network row).

A custom domain on a free zone would make the WAF rule possible. This project does not add one.

Accepted residual risk, decision by Patrick on 27 October 2026: without a zone, nothing in front of the worker can shed a flood of `*.workers.dev`. On the Workers Free plan the result is an outage until 00:00 UTC, not an invoice. [Pricing](https://developers.cloudflare.com/workers/platform/pricing/) (2 October 2026) gives the Free plan 100,000 requests per day and 10 milliseconds of CPU per request. [Limits](https://developers.cloudflare.com/workers/platform/limits/) (12 October 2026) says the daily request limit returns Error 1027 and resets at midnight UTC. [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) (21 April 2026) gives the Free plan 5 million rows read per day and 100,000 rows written per day, resetting at 00:00 UTC, and says queries then fail. The [changelog of 1 September 2026](https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/) says Cloudflare emails when that D1 daily limit is reached. Durable Objects have their own Free caps, from [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) (18 October 2026, read 27 October 2026): 100,000 requests per day, 13,000 GB-s of duration per day, and 100,000 SQLite rows written per day, resetting at 00:00 UTC, after which operations fail until then. Every live event is a write in the room's SQLite, so the Durable Object write cap can be reached before the D1 cap. This is the same kind of outage, not an invoice. The full list is in step 14 of `docs/DEPLOY.md`. A bill exists only on Workers Paid. The binding reduces the flood per location and can be exceeded. Patrick accepted that residual risk. It does not block the first deploy. Step 14 of `docs/DEPLOY.md` says the Free plan needs no notification, and that usage notifications are for a paid account.

The checklist for the account, the token, D1, secrets, Pages, and the first deploy is `docs/DEPLOY.md`. `production` still needs its required reviewer. Set `QUOTA_HMAC_KEY` on both workers before the first create.

## Review 3, 2026-10-27

A review of pull request 1 at `45dff86` asked for the following. They are in the tree this note now describes. The later README commit is unchanged by these fixes.

- P3-01. On create, every seed `at` and `createdAt` is replaced with the server time. The one-day close and the one-hour reconnect use `meta.created_at` and live events only. A last-change time in the future does not keep the room open and does not offer a reconnect.
- P3-02. A joining phone never receives an id that is already bound to a device or held by a connected phone. Ids continue `p5`, `p6`, and so on. When none remain, hello is rejected.
- P3-03. Create counters are an HMAC of the Wrangler secret `QUOTA_HMAC_KEY` with the UTC day in the message. The scheduled job deletes `create_quota` rows older than two days and expired tickets.
- P3-04. A deploy that has Cloudflare credentials fails if the `production` environment has no required reviewer. `staging` and `production` have to exist before that deploy.
- P3-05. The Privacy page names the device id (`pcv2:device` and the joined table), the keyed network hash and its two-day retention, and the token hashes with their lifetimes.
- P3-06. The 10-a-day limit is per device id. One network address may create 100. The device message is “You've reached 10 new matches today on this device.” The network message is “Too many new matches from this network today.” Both counters move in one batch or not at all.
- P3-07. Seed events are stored with `by` set to `host` and `at` set to the server time.
- P3-08. A ticket is taken with `DELETE ... RETURNING`, one statement.
- P3-09. Live play updates `matches.last_activity`, and the two-year delete counts from that column. A later pass limits that write to once a minute per match.
- P3-10. Revoking the previous player credential and inserting the new one run in one D1 batch.

## Review 4, 2026-10-27

A review of pull request 1 at `81f0236` asked for the following. They are in the tree this note now describes.

- P4-01. Revoking the previous player invite and storing the new one run inside `ctx.storage.transactionSync`. Durable Object SQL is not given `BEGIN`, `COMMIT`, or `ROLLBACK`. The workerd test creates a match, invites a player, joins with the ticket, carries that player into a new match, and ends and reopens.
- P3-02 follow-up. A connected socket occupies its player id even when that socket has no device id.
- P3-09 follow-up. The room remembers the last D1 activity write and skips another write until a minute has passed. Creating the match counts as the first write.

## Review 5, 2026-10-27

- P5-01. `POST /join` is rate limited in D1 per HMAC of the device id and per HMAC of the network address, 20 and 60 per minute. The count is not stored in an isolate map. A zone WAF rule is not required for `*.workers.dev`. Review 6 changes the network half so that only a failed token counts, and puts the Workers binding in front of D1.

## Review 6, 2026-10-27

- P6-01 and P6-02. `[[ratelimits]]` binds `REQUEST_LIMIT` at 30 requests per 60 seconds. The worker calls it, with an HMAC of the client address as the key, before the isolate map and before the D1 counters, on `POST /join`, `GET /ws/*`, and `/matches*`. Over the limit the response is 429. The source and the date are in “Required before the first deploy”.
- P6-03. The network join limit of 60 per minute counts only a failed token. A valid token does not increment it and is still accepted when the counter is full.
- P6-04. A later zone on the Free plan gets one WAF rate limiting rule, three path expressions joined by `or`, period 10 seconds. The earlier note that listed three separate rules at 60 per minute was wrong for that plan.
- P6-05. A missing or malformed `device` on `POST /join` is `invalid_device`, not `invalid_match`. The service worker cache id is `padel-counter-v2-2` so an old client that omits `device` is replaced. Until that client loads, an unknown error code is shown as the offline sentence.
- P6-06. The first staging deploy checks whether Workers Scripts: Edit and D1: Edit are enough. Account Settings: Read is added only if that deploy fails for lack of it. `docs/DEPLOY.md` says so.
- Patrick, 27 October 2026: the remaining exposure on `workers.dev` without a zone is accepted. Review 7 corrects the Free-plan numbers: the flood stops the worker until 00:00 UTC and does not create an invoice.

## Review 7, 2026-10-27

- P7-01. `POST /join` reads the credential and the match before any join write. A failed token writes only the network row, one write. The device counter moves only for a valid token. After 5 failed joins per minute per address inside one isolate, further failures return 429 and do not write.
- P7-02. `docs/DEPLOY.md` step 14 uses the Free-plan figures from the Cloudflare docs, with the page dates: Workers 100,000 requests per day and 10 milliseconds of CPU per request; D1 100,000 rows written per day and 5 million rows read per day. Past those daily caps the Free plan returns Error 1027 or a D1 error until 00:00 UTC and does not invoice. Cloudflare emails the D1 cap on its own (changelog 1 September 2026). Free needs no notification. Notifications are for a paid account.
- P7-03. The device id is chosen by the client, so the device cap does not stop an attacker. The binding at 30 and the network failure cap at 60 sit above the isolate cap of 20 and apply only across isolates or locations.
- P7-04. The Privacy page says that, to limit abuse, Cloudflare receives a stable, non-reversible pseudonymous key (an HMAC) of the IP address.

## Review follow-up, 2026-10-27

A review of pull request 1 at `ea24348` asked for the following. They are in the tree this note now describes.

- P1-01. A websocket or invite for an id that is not in D1 returns 404 and does not call the Durable Object. SQLite tables are created in the create handler only. Create, invite, and the websocket upgrade share the `/matches*` rate limit.
- P1-05. Un-helloed sockets are limited per client address, not as one global pool of four, and a Durable Object alarm closes them after 5 seconds. The cap of 4 from that pass was too tight for one court Wi-Fi and left no room-wide cap. P1-13 replaces it.
- P1-07. `env.dev` is named `padel-counter-dev`.
- P1-08. A rename is stored only after `sanitizeTeamName`, which caps it at 20 characters.
- P1-09. Pings spend the same per-socket budget as scoring events. Later broadcasts are one event, not the whole log.
- P1-11. The worker generates the match id.
- P1-12. An invalid event sends an error code and does not close the socket. Admission failures still close it.

A re-review of `3cfe79a` asked for the following. They are in the tree this note now describes.

- P1-13. Pending sockets are capped at 8 per client address and 16 per room. Admitted sockets count toward neither. The 5-second alarm is unchanged. Four players on one Wi-Fi can each hold a handshake and one reconnect. A seventeenth silent socket is refused from any address.
- P1-14. P1-02, P1-03, P1-04, P1-06, and P1-10 are resolved in “Resolved product decisions”.
- P1-15. Create inserts the match id into D1 before it writes the Durable Object. If that write fails or throws, the worker deletes the D1 row and `POST`s `/discard`, which runs `storage.deleteAll()`. `/discard` is not a public route. The response is not 201.
- P1-16. A re-review asked for an edge rate limiting rule on `/matches*` before the first worker deploy. Review 5 found that a zone WAF rule cannot target `*.workers.dev`, so the deploy does not require one. `POST /join` is limited in D1. Review 6 corrects the later-zone note: the Free plan allows one rule, so `/matches*`, `/join`, and `/ws/*` share one expression joined by `or`, counted over 10 seconds.

## Review 8, 2026-10-27

- P8-02. The Free-plan figures for Durable Objects (requests, duration, rows written and read, stored data) were missing from the docs. They are now in step 14 of `docs/DEPLOY.md` and in the accepted residual risk above, with the Cloudflare page dates. The Durable Object write cap is a second daily budget that live play uses on every point.
- The two D1 database ids in `wrangler.toml` are real ids for the account that owns this project. An id is not a secret. The API token and `QUOTA_HMAC_KEY` are not in the repository.

## Out of scope

OAuth client secrets, passkeys, admin user ids, and a production delete API were not added. No secret for those features should be committed when they are built. Put provider secrets in Wrangler and in GitHub environment secrets, not in `PUBLIC_*` build variables.
