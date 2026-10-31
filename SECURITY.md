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

There is no account. A phone that holds a valid, unexpired player token can read the match and change games. The match id on its own grants nothing. The creating phone holds a longer player token with `host: true`. Any admitted player can show the current shared code. Review 24 records who may do that, and what New match may move.

The role is `'player' | 'spectator'` and is stored with the token hash. `canPerform` denies every action to a spectator, including a forged `host: true`. `decideJoin` rejects a spectator even when the room is empty. `issueInvite` refuses to create a spectator token. Spectator QR codes are not built. The checks exist so a later read-only code can be added without a new permission model.

At most 4 admitted player sockets are allowed, including the creator. The Durable Object counts sockets that have already completed hello, excluding the socket being admitted, and calls `decideJoin`. The fifth socket is sent `{ type: 'error', code: 'match_full' }` and closed. The sentence the UI shows is the fixed string “This match is full.” Disconnecting frees a place. The same QR token may be used by more than one phone; the cap is connections, not token redemptions.

## Controls in this scaffold

- Join tokens are 16 random bytes, unpadded base64url (`/^[A-Za-z0-9_-]{22}$/`). Only the SHA-256 hex digest is stored. Lookup of that digest uses a length-checked comparison that does not return on the first differing character. The raw token is returned once in the create or invite response and is not written to the worker logs by this code.
- Player invite lifetime is 2 hours. The host credential lifetime is 12 hours. A new player code revokes older non-host codes. Sockets that are already open stay open.
- The token is not placed in the query string. The QR target is `…/#/join?t=<token>`. The match id is not in that link. A shared short code is a different fragment, `…/#join=<code>`, for example `https://patrickstubner.github.io/PadelCounterV2/#join=K7M4-2QAB`. The code is not in the query string, so the static host does not log it and it is not a Referer. Boot reads either fragment before paint. `history.replaceState` removes it even when `sessionStorage` throws. A token is kept in memory for that join. A short code is not written to storage. The page asks before a short-code link is used. Only Join sends it, through the same `POST /join` path as a typed code, so the same rate limits and the same expiry apply. A started match is copied into History first. The prefix is matched without regard to case. A live host removes the fragment and is told the link was not used. The code can remain in a chat, a share target, and the browser history of the phone that opened the link, because the browser may record the address before this page removes the fragment. It works for two hours, or until New code. This app does not store that fragment. The accepted fragment is exactly `join=` plus eight symbols from the short-code alphabet, with at most one hyphen. The text is not decoded before that check. Any other `join=` fragment is removed and shown as an invalid code. It does not call the network, it is not written into the page, and it is not used as a navigation target. A copy of a token is written to `sessionStorage` (`pcv2:join`) only when storage works, and that copy is dropped once the join has started. A join fragment that is not a 128-bit token is removed and shown as an invalid code. It does not call the network. A `hashchange` while the court is already open takes the same path. A live host tab strips either fragment and does not replace its credential. The host token and its match id are kept in `sessionStorage` for this tab, so a reload can mint a new player code for the same match. They are not written to `localStorage`. A browser WebSocket cannot set `Authorization`, so `POST /join` exchanges the bearer token for a 30-second single-use ticket and the socket is `GET /ws/<ticket>`. The ticket is not the match id and not the long-lived token. `GET /matches/:id/ws` is not a route.
- The WebSocket URL has no token. The first message is `{ type: 'hello', protocol: 2, token, clientNow }`. Protocol 1 is refused with `upgrade_required` and the socket is closed. The socket attachment stores the role, the host flag, an HMAC of the client address (`socket-ip` with a fixed scope, so one address still shares the pending cap), and the clamped clock offset. It does not store the raw token or the raw address. The Durable Object refuses the socket when `QUOTA_HMAC_KEY` is missing, instead of keeping the address.
- Hello and each later action run on the Durable Object. A spectator credential cannot pass `canPerform`. `undo` and unknown event types fail parsing. `match/new` and `match/reset` are not applied on a live room. The server stores `event.at` as its own clock. `capturedAt` is the phone's capture time plus the clamped offset, and is not used to merge. A game that the reducer refuses (for example 7–4, or minus at zero) is not stored. A repeated event id is acknowledged and not appended twice, and that acknowledgement is not broadcast. A score event must name its parent event and the board before and after the point. A parent that is not a UUID, a seed id, or null is rejected. A claim with the wrong type, an extra field, a revision outside 0–10000000, or a score that is not a possible set is rejected and not stored. The event table is insert-only.
- HTTP routes are `GET /health`, `POST /matches`, `POST /matches/:id/invites`, `POST /matches/:id/carry`, `POST /join`, and `GET /ws/<ticket>`. `POST /auth/*` returns 501 `{ error: 'not_available' }`. Delete, `/create`, `/invite`, `/discard`, `/reconnect-info`, `/carry-invite`, and `/notify` are not public routes. The worker calls those internal paths itself on the Durable Object stub.
- CORS allows the origin `https://patrickstubner.github.io` only, plus `http://localhost:<port>` and `http://127.0.0.1:<port>` when `ENVIRONMENT` is `development`. Staging and production set `ENVIRONMENT` to `staging` and `production`. There is no custom domain. CORS cannot see the path, so `/PadelCounter/` and `/PadelCounterV2/` are not separated by the allowlist. The token is what protects a match. Responses vary on `Origin` and do not echo a rejected origin. Credentials (cookies) are not allowed. The browser must send `Authorization: Bearer <token>` on invite, join, and carry. A WebSocket upgrade with a missing or foreign `Origin` is rejected.
- The worker generates the match id. The id inside the client log is rewritten to that id before it is stored. Team renames are passed through `sanitizeTeamName` before they are stored, so the stored name is at most 20 characters.
- A live change is broadcast as one event. The full log is sent on the opening snapshot only. An invalid event or a rate limit sends `{ type: 'error', code }` and leaves the socket open. The socket is closed for admission failures (`bad_token`, `expired`, `revoked`, `spectator_not_available`, `upgrade_required`, `match_full`, `unavailable`).
- Court CSP: `default-src 'self'`, no `unsafe-inline`, no `unsafe-eval`. `media-src` is `'self'` so the silent stay-awake clip can play, and it does not allow remote hosts, `blob:`, or `data:`. `connect-src` gains the API origin and its `wss:` scheme when `PUBLIC_API_URL` is an `https` `*.workers.dev` URL at build time. `ws:` is added only for an `http` API while developing, and not for an https production build. CI leaves the variable empty, and `verify-build` fails if `index.html` then contains any http(s) URL. The QR is drawn as SVG rectangles from the module matrix. There is no `innerHTML` and no `dangerouslySetInnerHTML`. The accessible name of the QR does not include the token.
- The client renders `ROOM_MESSAGES[code]`. A `message` field on the wire is ignored, including a message that contains markup. Player counts outside 0–4 are ignored.
- Create, invite, carry, `POST /join`, and `GET /ws/*` hit a Workers Rate Limiting binding before anything else. The binding is `REQUEST_LIMIT` (`[[ratelimits]]` in `wrangler.toml`): 30 requests per 60 seconds per HMAC of `CF-Connecting-IP`. The HMAC uses `QUOTA_HMAC_KEY` and a fixed scope, so the binding’s own window can accumulate. The raw address is not the key. Over the limit the worker returns `429 slow_down` and does not write D1. The count is per Cloudflare location and approximate. Staging and dev use different namespace ids (`1002` and `1003`) from production (`1001`). After that, the same routes share a limit of 20 per minute per address inside one isolate. The check runs before any Durable Object is named. Each admitted socket is limited to 10 messages per second, and a ping uses that same budget. A websocket is forwarded only when D1 already has the match id, so an unknown id does not create SQLite storage. Tables are created in the create handler, not when the object wakes. Create writes that id to D1 before it writes the Durable Object. If the object write fails, the worker deletes the D1 row and calls `storage.deleteAll()` on the object. `/discard` is not a public route.
- Un-helloed sockets are closed after 5 seconds. One room accepts at most 16 of them, and one client address accepts at most 8. Admitted sockets count toward neither cap. Eight is enough for four phones on one court Wi-Fi to each hold a handshake and one reconnect. A seventeenth silent socket is refused even when it comes from a new address.
- Body size is capped (about 96 KB for a match log, 8 KB for a socket message). SQL uses bound parameters. Parsed objects are copied onto a null-prototype object before fields are read. Team names are length-limited and rendered as React text.
- Storage keys use the prefix `pcv2:` (`pcv2:log`, `pcv2:matches`, `pcv2:celebrated`, `pcv2:join`, `pcv2:device`, `pcv2:fanfare`, `pcv2:haptic`). The app does not read or write v1 keys (`padel-counter.v1`, `padel-counter.matches`, `padel-counter.celebrated`). The service worker cache id is `padel-counter-v2-2.3.4`. `cleanupOutdatedCaches`, `skipWaiting`, and `clientsClaim` are on, so a phone that still has `padel-counter-v2` drops that cache and loads this client. The pages base is `/PadelCounterV2/`. The installed name is Padel Counter V2.
- A win plays `06_crowd-in-hardrock.mp3` from this origin. The service worker precaches that file. It is not loaded from a third-party host. `media-src` stays `'self'`. The menu toggle defaults to on and is stored at `pcv2:fanfare`. An early end does not play it. If the browser refuses playback, the app stays silent. The CC0 sources are in `CREDITS.md`.
- While a match is running, the court asks the Screen Wake Lock API to keep the display on. The request is repeated when the page becomes visible again, and on the next pointer gesture if the lock is missing. iOS Safari needs that gesture. The sentinel's `release` event clears the held lock. Ending the match, or hiding the page, releases it. When the API is missing or refuses (older iOS, and the home-screen app before 18.4), a same-origin silent MP4 (`stay-awake.mp4`) loops instead. Playback starts from a pointer press, a pointer release, or a click, the element stays in the layout at one pixel (hiding it by taking it out of the layout stops iOS), and it is paused when the match ends or the page is hidden. `media-src` is `'self'` for that file only. The clip was encoded for this repository. It is not loaded from a CDN, and the file contains no URL. The element is muted. The file includes a silent audio track because older iOS only keeps the backlight on for a video that has audio.
- `POST /matches` allows 10 creates per UTC day for one device id, and 100 for one network address, counted in D1 (`create_quota`). The stored key is an HMAC of the worker secret `QUOTA_HMAC_KEY` with the UTC day, not a plain hash of the address. The 11th create on that device is `429 device_daily_limit`. The 101st create from that network is `429 network_daily_limit`. A failed create releases both counts. The two increments run in one D1 batch and roll back together. A unique match-id collision is retried up to three times. The response is not 201 when every attempt fails.
- The live room stops accepting scores one day after the last server-stamped event (`closed`). Seed times from the phone are replaced with the server clock when the match is created, and `by` on those seed rows is `host`. `last_activity` in D1 moves at most once a minute while the match is played. History is 730 days from that column, then a scheduled job discards the Durable Object and deletes the row. The same job deletes create-quota rows and join-quota rows older than two days, and expired websocket tickets. The one-day close does not delete the row. A last-change time in the future does not keep the room open. The cron is on production and staging only.
- `POST /join` reads the credential, and the match row, before it writes. A failed token (missing, invalid, expired, revoked, or a match that is not in D1) writes only the network failure row, one write, and only while the isolate still allows it. The device id is chosen by the client (`d` and 8 hex digits). Nothing ties it to the phone, so the device cap does not stop an attacker who sends a new id. The device counter moves only after a valid token, 20 successful joins per minute, and the 21st is `429 join_device_limit`. One network may record 60 failed attempts per minute. A successful join does not increment that row, so phones on one court Wi-Fi or one CGNAT address are not locked out by playing. A valid token is still admitted when that failure counter is already full. Both keys are an HMAC of `QUOTA_HMAC_KEY` with the minute in the message. The 61st failure from that network is `429 join_network_limit`. The 60th failure still returns the original error and leaves the counter at 60. Inside one isolate, failed joins are throttled earlier than the shared 20: 5 failures per minute per address, then `429 slow_down` with no further D1 write. A missing or malformed `device` is `400 invalid_device` and writes neither row. A new index over the same database still sees the count.
- Joining phones get `p2`, `p3`, and then higher ids. An id already bound to a device is not given to another phone. When no free id remains, the hello is rejected.
- A new player code revokes older player codes and inserts the new hash in one D1 batch. A websocket ticket is consumed with one `DELETE ... RETURNING`.
- A phone that starts a new match while other phones are connected must confirm. Yes moves only devices that have already joined, at most three besides the phone that starts the new match. The server chooses that list. Connected phones switch immediately. An offline phone is moved when it reconnects, while its old code is still valid. No keeps the previous behaviour: the creating phone ends the shared match and starts alone, and another phone leaves the shared match on that phone only. Review 24 is the current decision. Ending a match early does not record a winner. A winner exists only when a team has two sets.
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
| Low | Host token stays in the tab | The host token and match id are in `sessionStorage`, so a refresh can mint a new player code for the same match. Closing the tab drops them. They are not in `localStorage`. A script on this origin could read them; the CSP is what prevents that script. | Keep them out of `localStorage`. When login exists, mint codes from the session instead of a 12-hour bearer token. |
| Low | D1 holds only the match id | Live scoring still does not read the event log from D1. D1 is the index that must contain a match id before a websocket or invite is forwarded. The checked-in database ids are documentation placeholders. A deploy with those ids will fail at migration time, which is preferable to writing to the wrong database. | Replace the ids before the first real deploy. Apply `migrations/0001_init.sql` as part of that deploy. Do not treat the placeholders as secrets. |
| Low | Parser is hand-rolled | Bounds, types, plausible set scores, and a null-prototype copy are checked. There is no second schema library. A new event field can be forgotten. | Add a schema library when the event list grows. Until then, extend `parseStoredEvent` and the core tests together. Unknown types, including `undo`, already return null. |
| Info | No login, no shared delete | `POST /auth/*` is a stub. Deleting a match in the UI removes it from this browser only. Only the creator and Patrick may delete a shared match later. Others may only hide it. There is still no server delete route. | Login stays out of this pull request. |
| Info | P1-02 Retention | Resolved. Scoring stops one day after the last event. D1 history is deleted after two years by the scheduled job. UI delete is still this device only. | Keep both periods on the Privacy page. |
| Info | P1-03 New match while one is open | Resolved. The host confirms Finish & new. Reconnect is optional, host-only, device-bound, and only within one hour. A non-host leaves locally. | Do not end a match silently. |
| Info | P1-04 Create without login | Resolved, then tightened by P3-06. Ten creates per device per UTC day, plus 100 per network, in one D1 batch. The key is an HMAC. | Keep the isolate limit as a second line. |
| Info | P1-06 Custom domain | Resolved. No custom domain. The app stays at `https://patrickstubner.github.io/PadelCounterV2/` beside v1. CORS allows that origin only. | The path is not a CORS boundary. |
| Info | P1-10 Deploy approval | Resolved. Production uses the `production` environment, checks out `github.sha`, and ships the worker and Pages together. The job fails unless the deployment branch policy is custom and contains only `main`. There is no required reviewer. | Keep the `production` branch policy restricted to `main`, and keep `staging`, before the first deploy. |
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

Production deploy is `workflow_dispatch` on `main` and uses the GitHub environment `production`. The job checks out `github.sha` and fails if `HEAD` is anything else. The worker and GitHub Pages of that same commit ship together. Pages runs only after that job. Before the first deploy, `production` must exist and its deployment branch policy must be custom and contain only `main`, and `staging` must exist. The workflow asks GitHub and fails the deploy if that branch policy is missing or names any other branch. There is no required reviewer. Until the Cloudflare secrets exist, the job skips and stays green, and Pages does not run.

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

The checklist for the account, the token, D1, secrets, Pages, and the first deploy is `docs/DEPLOY.md`. `production` must keep a custom deployment branch policy that contains only `main`. Set `QUOTA_HMAC_KEY` on both workers before the first create.

## Review 3, 2026-10-27

A review of pull request 1 at `45dff86` asked for the following. They are in the tree this note now describes. The later README commit is unchanged by these fixes.

- P3-01. On create, every seed `at` and `createdAt` is replaced with the server time. The one-day close and the one-hour reconnect use `meta.created_at` and live events only. A last-change time in the future does not keep the room open and does not offer a reconnect.
- P3-02. A joining phone never receives an id that is already bound to a device or held by a connected phone. Ids continue `p5`, `p6`, and so on. When none remain, hello is rejected.
- P3-03. Create counters are an HMAC of the Wrangler secret `QUOTA_HMAC_KEY` with the UTC day in the message. The scheduled job deletes `create_quota` rows older than two days and expired tickets.
- P3-04. A deploy that has Cloudflare credentials fails unless the `production` environment has a custom deployment branch policy containing only `main`. `staging` and `production` have to exist before that deploy. Review 12 records why the required reviewer is no longer part of this check.
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

## Review 9, 2026-10-28

Connect players opens a dialog over the court. A scanned invite joins the match and shows the live score. The follow-up on pull request 11 corrected the socket CSP, the boot capture, and which errors the court shows.

- Input validation. `parseJoinHash` accepts only `#/join?t=` and a token matching `/^[A-Za-z0-9_-]{22}$/`. Any other join fragment is stripped with `replaceState` and is not sent. `POST /join` is called only after `isJoinToken`. The device id on that request stays `d` plus 8 hex digits. The dialog does not navigate to a new document. `bootPage` in `index.tsx` does this before paint, including when `sessionStorage` throws, and a `hashchange` does it again if a link is opened in the same tab. A dev-only API override exists for tests and is omitted from the production bundle.
- Token handling in the URL. The QR still uses the fragment, so the static host does not receive the token. The token is kept in memory for the join. It is written to `sessionStorage` only when that storage works. Review 10 keeps that tab copy until Leave, or until the server rejects the code, so a dropped socket can reconnect. `replaceState` always removes the fragment, including an invalid one and including the case where storage throws. The token is not copied into the query string, the history state, the dialog text, or the accessible name of the QR. Review 12 also keeps the host credential in `sessionStorage` for this tab, with the match id. It is not only a ref, and it is not in `localStorage`.
- XSS. The dialog, the QR, and the join error are React text or SVG rectangles from the module matrix. There is no `innerHTML` and no `dangerouslySetInnerHTML`. A `message` field on a join response or a socket error is ignored. The UI uses `ROOM_MESSAGES` or the fixed sentence “The live match did not accept that.” The invite token is not interpolated into HTML.
- Error messages. A failed join shows “Could not join this match.” plus the fixed sentence, and that banner is cleared when the snapshot arrives. A later socket error, and a failure while creating or rotating a QR, are shown separately and are not hidden by a join. An invalid code says “This code is not valid.” An expired code says “This code has expired. Ask for a new one.” The court stays mounted. The scanning phone is not left on the QR dialog. The server’s raw body is not shown.
- Who can share. Connect players and Show QR code are hidden once this phone is a connected non-host. Creating the live match runs when Show QR code is used, not when the menu opens.
- Socket CSP. `connect-src` lists the https API origin and `wss://` for the same host. `ws://` is added only for an http API in development. Without `wss:`, the browser blocks the live socket.

## Review 10, 2026-10-28

Two phones could change the score on their own screens and not see each other's later points. The opening snapshot still arrived.

- The court treated a live point as sent only when `WebSocket.readyState` was `OPEN`, and it did not change the local score until the echo came back. `onclose` then cleared that sender. iOS Safari drops the socket when the page is hidden, and nothing opened it again, so the next point stayed on that phone. The invite token had also been removed from `sessionStorage` after the snapshot, so a reload of the same tab could not resume.
- The Durable Object stored the event and only then awaited the once-a-minute D1 activity write before telling the other sockets. A `send` that threw on one closed peer stopped the loop. The fix stores the event, sends it to every other admitted socket immediately, and only then touches D1. Each `send` is isolated. Sockets are accepted with the hibernation tag `court` so `getWebSockets('court')` still lists them after the isolate wakes.
- A point is applied on the phone that tapped it, and sent on the open socket in the same turn with a new event id. The echo and any repeat of that id do not add a second point. A refusal removes that one optimistic point. `visibilitychange` and `pageshow` open the socket again with the token still held for this tab. Leave, and a rejected code, drop it. The token is still not put back into the URL.

## Review 11, 2026-10-28

A live point stays on the phone until the server accepts that exact event. The court color shows whether a live match is still reached. The color is not a security control and does not change who may score.

- Event ids are trimmed and lowercased. The client and `applyPlay` treat a mixed-case repeat as one id. A refusal includes that id. The phone removes only the optimistic point with that id. After a snapshot, any unacked point for this token and this match that the snapshot did not contain is sent again. Points for another token or match are dropped.
- A point still unacked after 1.5 seconds is sent once more, with a ping. If it is still missing, the socket is closed and opened again. A page that stays hidden for more than 15 seconds closes the socket even when the browser still reports it open.
- Reconnect waits with exponential backoff and jitter, and for about two seconds after `slow_down`. `bad_token`, `expired`, `revoked`, `match_full`, `spectator_not_available`, and `upgrade_required` clear the sender, the queue, and the token, and the court says Disconnected. `offline`, `slow_down`, `not_configured`, and `unavailable` keep the token. `unavailable` still closes the socket.
- The tab stores the token with an expiry: 2 hours for a player and 12 hours for the host. A stored expiry in the past is removed. A joined player can choose Leave live match, which drops the token. The host still leaves from the connect dialog.
- Black (`#000000`) is a match with no live connection. `#163056` is a live match that is connected. `#3a1016` is a live match that has had no server for 1.5 seconds and is still counting on the phone. The word Offline is shown as well, so the state is not color alone. A short reconnect stays on the blue. White and the gray court text on both colors are at least 5.2:1 (`offlineCourt.test.ts`). Assistive text announces connected, offline, and disconnected.

## Review 12, 2026-10-28

Production deploy aborted with `production environment needs a required reviewer before deploy`. Patrick removed that reviewer from the GitHub environment `production` on purpose on 2026-10-28. Production stays protected by a custom deployment branch policy that contains only `main`, and by a manual-only `workflow_dispatch`.

- The script no longer checks for a required reviewer. It fails a production deploy unless `deployment_branch_policy` is custom (`custom_branch_policies` true and `protected_branches` false) and the custom branch policies contain only the branch `main`. Any other policy, including every branch, every protected branch, another name, or a tag named `main`, fails the job. Staging still only has to exist. The check does not print tokens or the environment body.
- Rationale: the reviewer rule was blocking a deploy that the branch policy and the manual workflow already gate. Keeping the reviewer check would fail every production run after that rule was removed.
- Replacing a socket removes its handlers before `close`, and the next connection starts in that turn. An unexpected drop still waits with the backoff from Review 11. A page that is shown again opens the socket immediately.
- The host token and the match id are stored in `sessionStorage` (`pcv2:join`) with the expiry. A reload of the creating tab restores them. Show QR code and New code mint a new player code for that same match. They do not create another match. The host token is not in `localStorage` and not in the page URL. A `hashchange` while this phone is the live host is ignored, so a join fragment cannot replace that credential. The fragment is still removed from the address bar.
- A snapshot clears the error banner. “Too many changes. Wait a moment.” also clears when a later point is accepted, or after 5 seconds if nothing is accepted.
- Disconnected shows that taps are not applied. The terminal codes from Review 11 still clear the token. The court colors are unchanged.

## Review 13, 2026-10-28

- A reconnect whose `POST /join` fails for a transient reason waits with the same backoff and jitter, then tries again. The browser `online` event starts that attempt without waiting out a backoff that was only for a dead network. `slow_down` still waits about two seconds. A rejected code still stops.
- Disconnected still clears the token. Points tapped after that stay on this phone and are not sent. The hint says that. It does not say that the taps are ignored.
- Show QR code after a reload shows the player code that is still inside its two hours. It does not call `POST /matches/:id/invites`, so it does not revoke that code. New code is the action that replaces it. The dialog says “New code turns this code off and replaces it.” The raw player code is stored next to the host credential in `sessionStorage` for this tab only, and not in `localStorage` or the address bar.
- A failed New code leaves the live connection up. A retry does not clear the error banner; the snapshot still does.
- The README and `docs/architektur-report.md` no longer say that production deploy waits for a required reviewer. Production is a manual workflow on `main`, and the deployment branch policy contains only `main`.

## Review 14, 2026-10-28

- A connected phone can rename a team. The server stores `team/rename` in the match log, so the name is in the history, and it broadcasts `{ type: 'team_renamed', team, name, seq }`. The name is trimmed, at most 24 characters, and is refused when it contains a control character. The court renders that name as text. A later `seq` wins. Renames are limited to 3 per second on one connection. A match that is not live still renames only on that phone. Review 15 uses the same 24-character limit there.
- `slow_down` waits at least two seconds, and that wait is used once. The next retry uses the normal backoff. A successful reconnect clears the previous error. Repeated `online` events inside two seconds do not each open a socket.
- A join fragment in the host tab does not replace the host token in `sessionStorage`. Reloading the tab does not extend `expiresAt`.
- The dialog and the README say that New code disconnects the phones that joined with the current code.

## Review 15, 2026-10-28

- A `team_renamed` frame is applied whenever its server sequence is newer, including when the event id is this phone’s own. Two phones that rename at the same time end on the name the server stored last.
- Team names use one limit, `MAX_TEAM_NAME_LENGTH` (24), on the court, in the archive, and in the worker. D1 does not store team names. A played match with a 24-character name stays in History after a reload.
- `{ type: 'event', event: { type: 'team/rename' } }` is refused. Renames go through `team_renamed`, which keeps the 3-per-second limit and rejects a name instead of shortening it.
- A new name is refused when it is only a blank filler (`U+3164`, `U+115F`, `U+2800`) or only variation selectors. Review 16 limits combining marks per base character.
- A successful New code clears the error that an earlier attempt left on the court.
- The match still holds at most 500 events. Three connections renaming at the limit can fill that in about a minute, the same way repeated score taps can. After that the room refuses further changes. New code still disconnects phones that joined with the old code. This is noted, not changed.

## Review 16, 2026-10-28

- Combining marks are limited per base character, at most four in a row. They are not counted across the whole name. A Hindi, Thai, Bengali, Arabic, or Hebrew name is stored unchanged. `sanitizeTeamName` does not drop or reorder marks that are already valid.
- `isValidStoredName` checks that a saved name is NFC, already trimmed, free of control and format characters, free of an unpaired surrogate, and at most 24 characters. It does not rewrite a no-break space. The filler and mark rules apply only to a new name, so a name saved by an older build still loads.
- A local name that is only variation selectors becomes Team A or Team B. The server already refuses that name.
- A phone still on 2.1.3 sends a live rename as `{ type: 'event', event: { type: 'team/rename' } }`. The server refuses that path. That phone can rename a team in a live match only after it updates.

## Review 17, 2026-10-28

- Join match can read a QR code with the camera. The camera starts only after Use camera. The stream stops when the dialog closes, when a code is read, and when the page is hidden. The browser’s BarcodeDetector is used when it exists. Otherwise the decoder is `qr` 0.7.2 (Paul Miller, MIT OR Apache-2.0, no dependencies). Snyk lists no known vulnerabilities for 0.7.2. It runs on the main thread from canvas pixels, so `media-src` stays `none` and `worker-src` stays `'self'`. A scanned value is kept only when it is a join link for this origin and this path, with the token in the fragment. Anything else shows “That code did not work.”
- The host also sees a short code such as `K7M4-2QAB` and can send that text with the Web Share API. If sharing is missing, the same text is copied. The QR link remains. Escape closes Join match and stops the camera. Back does the same, because the dialog is a history entry.
- The code is 8 symbols from a 31-character alphabet with no 0, O, 1, I, or L, shown as `XXXX-XXXX`. `31^8 = 852,891,037,441` (about 2^39.6). A random byte is used only when it is below 248, so the symbol is not biased. The code lasts as long as the player invite, 2 hours, which is 120 minutes. Every attempt, hit or miss, is counted before the code is read. One IPv4 address, or one IPv6 /64, may make 10 attempts per minute. Over those 2 hours that is 1,200 guesses. `1200 / 31^8` is about `1.4e-9`. Ten is under the isolate route cap of 20, so a court can still join, and past that cap the answer is 429 for every code, including a valid one, so the status does not reveal a hit. A global counter records attempts and alarms at 10,000 per minute. It does not reject, so one network cannot lock the code for everyone. `POST /join` with a code returns the player token and the websocket ticket together, so a join is two limited requests (the code, then the socket) rather than three. The code is stored as an HMAC of the server secret, not a plain SHA-256. The raw code and the secret are not written to a log. D1 stores that HMAC, plus the hash of the current player invite and the match id. The code is not derived from the token or the match id.
- Typing the code mints at most 8 device tokens for that match. The same device replaces its previous token instead of adding another, and that mint uses the same per-device join quota as a bearer join. The 4 player cap is unchanged. New code, and End match, revoke the short code and the player invites. A phone still on an older build can join with the QR link.
- Creating a live match runs the log through replay and then `parseLiveTeamName`. A name that came from a rename is included. Extra marks beyond four on one character are removed before the match is stored, so the snapshot does not keep the stack. A name that already fits is unchanged.

## Review 18, 2026-10-28

- A device token is granted inside one Durable Object transaction, and the D1 insert is one statement that checks the count of eight. Parallel redeems cannot add a ninth active token.
- When this network has used its code attempts, the 429 says to use the QR link. That limit is unchanged.
- The global counter is recorded in D1. The upsert returns the new count (`RETURNING n`). When that count becomes exactly 10,000 the worker logs the fixed line `short code attempts recorded`. The line has no address and no code.
- A successful code or scan removes the Join match history entry, so Back does not open the dialog again.
- The worker returns 503 `not_configured` when `QUOTA_HMAC_KEY` is missing or shorter than 32 characters. The body is the usual message and does not include the secret. The deploy check applies the same length rule and does not print the value. Deploy copies the GitHub environment secret onto the worker with `wrangler secret put`, passing the value on stdin. That GitHub secret is the single source for staging and for production.
- Replacing `QUOTA_HMAC_KEY` expires open short codes and quota counters. That is accepted. Phones need a new QR code or a new short code. `docs/DEPLOY.md` says so.
- A code token that finds the court already full, and whose device has no admitted socket, is revoked, so the slot can be used again. The phone is told “This match is full.” A phone that already has a seat can reconnect while the court is full. Its previous socket is closed, and the token stays.
- A failed D1 claim does not drop the device token it was replacing. The previous room invite is restored.

## Review 19, 2026-10-29

- iPhone Safari does not provide a working `BarcodeDetector` (WebKit bug 281848, still failing with the Shape Detection flag on). The scanner reads a centred square at 640, 480, and 720 pixels through `qr` 0.7.2 and does not start a second decode while one is running. `media-src` stays `none`.
- A scanned string is kept only when it is an `http` or `https` URL for this page’s origin and the app base path `/PadelCounterV2`, with the token only in the fragment. `index.html`, extra slashes, and the page’s own query are not compared. A query that contains the token, or a URL with a username or password, is rejected. The scanned text is not opened, not written into the page, and not sent to the static host.
- One frame shares about 80 ms across crops and efforts. A detect or decode that does not settle is abandoned, so the next frame can run. The camera stops on its own after 90 seconds, the stream is released, and the page says to tap Use camera again.

## Review 20, 2026-10-29

- While a match is running, the screen stays on. The Screen Wake Lock is requested when the match is running and the page is visible, again when the page returns to visible, and again on a pointer gesture if the lock is not held. The sentinel `release` event is listened for, so a lock the browser drops is not treated as still held. Ending the match or hiding the page releases the lock and pauses the fallback.
- iOS Safari, including a home-screen app on iOS before 18.4, often has no working Wake Lock, and a request without a user gesture is refused. The fallback is a one-second 16×16 silent MP4 at `stay-awake.mp4`, constrained baseline H.264 plus a silent AAC track, generated for this repository. `video.play()` is called in the pointer-down, pointer-up, and click turns, before any await. The element is muted, plays inline, loops, and is one pixel in the layout. It is not removed from the layout by the CSS display property, because that stops playback on iOS. No NoSleep package and no third-party host are used.
- CSP `media-src` changes from `'none'` to `'self'`. That is the smallest change that lets this origin play the clip. `blob:` and `data:` stay refused, so a script cannot aim a media element at an arbitrary payload. The camera scanner still does not load a media file. The fanfare is still Web Audio oscillators, not a file. Reviews 17 and 19 recorded `media-src 'none'` before this clip existed.
- The service worker does not precache `stay-awake.mp4`. A precached answer is 200 with no `Content-Range`, and Safari will not play that in the home-screen app. The clip is loaded at runtime. A `Range` request is answered with 206 and a `Content-Range`. The file is still same-origin, is not a script, and is not loaded from another origin.

## Review 21, 2026-10-29

Two phones in one match could count the same games twice. A phone that lost its connection kept scoring. The other phone scored those games on the server. When the first phone reconnected, its queue was appended again. Version 2.2.4 gives every score event a parent id and a before/after board, and merges that chain. Pull request 20 (2.2.3, screen stay-awake) is already on `main`. This review is the score chain, the display clock, and protocol 2.

A follow-up on the same pull request compared two ways to tell a repeated point from a new one. A one-minute window on the phone's clock can mistake two games, or miss one game entered late. The parent id cannot: it names the server event the point was scored on. The merge uses that chain and the server's accept order. It does not use the phone clock. The clock is stored only so History can show when the point was tapped, on each phone in that phone's local time.

- Input validation. `parseScoreClaim` accepts only `before`, `after`, and `baseRevision`, each copied onto a null-prototype object. `before` and `after` accept only `sets`, `activeSet`, and `ended`. Each set accepts only integer `a` and `b`, and only a score `isPlausibleSetScore` allows (so 7–4, 8–0, and a float are rejected). `activeSet` is 0, 1, or 2. `ended` is a boolean. `baseRevision` is an integer from 0 through 10,000,000. Any other key is rejected. `after` must be the board the reducer produces from `before`. `parentId` must be null, a lowercase UUID, or `seed-` plus 1 to 4 digits. `clientNow` on hello is an integer timestamp or it is ignored (offset 0). The offset is clamped to ±12 hours. `capturedAt` is the capture time plus that offset, clamped to the match's creation time and to five seconds ahead of the server. A capture time that is not a timestamp rejects the event. Hello `protocol` must be 2. Protocol 1 gets `upgrade_required` and the socket closes.
- Replay and idempotency. The event id is still the first check. The same id is acknowledged, not inserted, and not broadcast. A new id is merged with `planMerge`. The same parent and the same resulting board are one point (`duplicate`, `reconciled: 'already'`), and that acknowledgement is not broadcast. Points that exist only on the offline phone are appended, including a minus. A plus and a minus of the same team and set on that phone cancel first, so an offline +1/−1 does not remove the online +1 (the score stays 4:2, not 4:1) and an offline +2/−1 does not remove one of the online two (the score stays 4:3, not 4:2). Two phones that both go from 4:1 to 4:3 stay at 4:3. A parent the server has never stored, a broken chain, or more than 64 queued events is `score_kept`. Nothing is written. The phone lists those points and **Add them** appends them once, on top of the current score. `match/end` is stored whenever the match is still open. It is not refused because the scoreboard differs, so Finish & new does not need to read `score_kept` before it drops the socket.
- History. The log order is the server accept time. The row's clock is `capturedAt` when present. A skipped duplicate is not inserted, so the log does not list the same game twice and does not gain a row for an ambiguous chain. Writing a note per rejection would let a client fill the 500-event cap.
- Queue size. The phone keeps at most 64 unsent events. A further tap is not applied. A list longer than 64 is not merged. A tap made while an earlier score is still unacknowledged stays queued and is sent after that answer, so it is not lost between reconnect and the acknowledgement. Each socket message is still about 8 KB, and each admitted socket still shares 10 messages a second with pings. An `already` or `score_kept` result does not write SQLite. A new point still stops at 500 stored events. Those bounds do not raise the Workers Free plan caps already accepted in this file.
- Follow-up on the same review. A phone advances its parent on every point and every newer rename from the other phone, so online alternation does not send a stale parent. On reconnect the phone sends the merge plan's before/after board, not the board from before the other phone scored. A rename or a serve change between the fork and a point is skipped while matching, so it cannot make the same point look new. `score_kept` reloads the server log once and retries that point with the new claim. A second refusal is listed and not written. The list says the points could not be matched and that counting them again may count a point twice. A reconnect does not clear the list. Seed rows clamp `capturedAt` to the server clock. The same validation and the same 64-event cap still apply. Nothing in this follow-up writes on `already` or `score_kept`.
- Second follow-up. Two phones that tap the same team from the same point are one point. The `already` answer is not broadcast, and the sender is given the server log so its court matches that one point. Points since the fork match by team and direction in any order, so a point from a third phone in front of the chain is not counted again. An ended match is shown as the server left it; phones that had already joined can still read that score, and a new code still cannot. A new code closes the phones that joined with the old one and tells them the code is no longer valid. `already` and `score_kept` still do not write. The retry is still one attempt per event id.
- Third follow-up. A point merged onto a different board, including a tap that lands in the next set, sends that sender only the events after the shared point. A tail longer than eight events is sent at most once every two seconds; the light acknowledgement is always sent. After the match ends, a hello is accepted only for a token and device that already joined. A new device with the same code is refused and does not receive the log. The court does not offer to count a point again when that point is already in the score, and the button does not apply it a second time. `already` and `score_kept` still do not write.

## Review 22, 2026-10-30

An iPhone home-screen app could not read the QR shown on an Android screen. The camera window was a 16rem preview. The other direction worked once, with effort. Version 2.2.5 is the scanner and the host code. Pull request 21 (2.2.4, score merge) is already on `main`.

- Camera permission. `getUserMedia` runs only after Use camera. Opening Join match, typing a code, or loading the court does not ask. Audio is not requested. The first constraint set is an ideal 1920×1080 rear camera, then 1280×720, then any rear camera. Exact sizes are not used, because iOS rejects them. When the track lists `focusMode: continuous`, the page requests it. iOS Safari does not expose that mode, so a refusal is ignored and the camera stays on. Every track is stopped when a code is recognised, before that text is parsed as a token, and again when Close, Escape, a hidden page, the 90-second limit, or unmount runs.
- Decoder input. A frame whose side is under 8 pixels or over 4096, or whose buffer is shorter than its dimensions, is not decoded. The browser `BarcodeDetector` is used only when the constructor exists, and only as a first attempt. A miss, a throw, or a missing constructor falls through to `qr` 0.7.2 (Paul Miller, MIT OR Apache-2.0, no dependencies, no worker, no WASM, no CDN). Snyk lists no known vulnerabilities for 0.7.2. The published photo comparison in that package shows it ahead of jsQR and level with zxing-wasm on ordinary frames, without `'wasm-unsafe-eval'`. jsQR was not added. zxing-wasm was not added: compiling WASM under this CSP would require `script-src 'wasm-unsafe-eval'`, and the build rejects `unsafe-eval`. A decode result that is not a string, or is longer than 2048 characters, is dropped.
- Join payload. The decoded text is accepted only by `tokenFromJoinQr`: an `http` or `https` URL for this page's origin and the app base path, with the token only in the fragment, matching `/^[A-Za-z0-9_-]{22}$/`. Any other text shows the fixed invalid-code sentence. It is not opened, not written into the page, and not sent. The picture is not uploaded.
- Host QR. The symbol is SVG rectangles at error correction H, with a four-module quiet zone inside the graphic, so the corner finders are not on the edge and a radius cannot clip them. The accessible name does not include the token. The dialog behind the code is white and asks for full brightness. The page cannot set the screen brightness. There is no new host, no new permission, and no new request.
- Dependencies and licence. No new runtime package. `qr` 0.7.2 and `qrcode` 1.5.4 stay exact pins. NOTICE already records both licences. The fixture PNGs are generated in this repo. The test PNG reader uses the platform `DecompressionStream`. It is not part of the client bundle.

## Review 23, 2026-10-30

Follow-up on the 2.2.5 scanner, still on the same pull request. No new dependency, no new host, and no change to the content security policy.

- The decoder reads the whole frame, with the long edge about 960 pixels, and the top and bottom squares, as well as the centre. A white frame on the preview is that area. A code next to Close is not ignored.
- A camera attempt reads the centre and one rotating pass, then waits until 120 ms have passed since it started. That is about 8 tries a second. Enter code pauses the loop, so typing is not waiting on a decode. The picture is still not uploaded.
- `NotAllowedError` and `SecurityError` stop the constraint fallback. The page shows “Allow camera access in Settings, then tap Use camera.” The browser's own message is not shown. `OverconstrainedError`, `NotReadableError`, and `AbortError` still try the next size.
- A decoded string longer than 2048 characters is still dropped, including one returned by `BarcodeDetector`. An empty native result still falls through to `qr` 0.7.2. Closing the scanner, including while `getUserMedia` has not resolved, stops every track.

## Review 24, 2026-10-30

Version 2.2.6. Pull requests 21 and 22 are already on `main`. This review is who may show the shared code, what New match may move, and when a score is a win. No new dependency, no new host, and no change to the content security policy.

Threats considered:

- A guest shows the QR and invites more phones than the court allowed.
- A guest rotates the code and disconnects the other phones.
- Showing the code again mints a second live token, or extends the two-hour life.
- The raw token is written to a log, a URL query, or D1 so a database read becomes a join.
- New match accepts a client-supplied list of phones and pulls in someone who never joined.
- An offline phone is moved with an expired or revoked code, or a stranger who knows the match id follows the move.
- End match on a partial score is stored as a win and the celebration plays.

Decisions:

- An admitted player may show the current shared invite. The Durable Object checks the bearer hash against this room: role player, not revoked, not expired. A spectator, an unknown token, and a token for another match are refused. The worker also requires the credential row in D1 to name this match before it calls the object. Knowing the match id is not enough.
- There is one shared invite. Show QR returns that same token and the same short code. It does not revoke, and it does not move the expiry. New code is the explicit rotate. Rotate still revokes every non-host credential, closes the phones that joined with the old code, and mints one replacement. Entropy, the two-hour life, and the invite rate limits are unchanged. A connected player can turn the code off. That is the same effect the creating phone already had, and every player can already score and end the match.
- The raw token and the short code are sealed with AES-GCM in the Durable Object. The key is a SHA-256 of the worker secret and a fixed label, not the secret used as the key itself. D1 still stores only the token hash and the short-code HMAC. The seal is not a log line. The token still leaves the server only in the invite response (`cache-control: no-store`) and in the QR fragment, which is the existing design. It is not placed in a query string.
- The cap of 4 admitted sockets is unchanged. Showing or rotating a code does not add a seat. The fifth hello is still `match_full`.
- Take phones is allowed only for the host credential of the previous match, and only into a match that host just created. A guest credential and a shared QR cannot start it. The object builds the device list from phones that have already joined. The client cannot add a device. Connected phones are listed first, then offline phones, and at most three besides the host. Each of those devices gets its own new token and follows without a second question. The token is not put in a URL. An offline phone receives the same message when it says hello with its still-valid old code, until the move seal expires. An expired or revoked code is not moved. A phone that was not carried is told, with a fixed sentence and no token, that the other phones continued. Showing the new match’s code does not revoke those device-bound tokens. New code still does. The one-hour reconnect checkbox is not this path. Take phones is an explicit choice about the phones that joined, including when the last point is older than an hour. Just this phone does not move anyone. Review 31 records why a published code used to drop the carried phones, and the reopen rule for History.
- A winner is two sets. `match/end` stores no winner field. D1 has no winner column. The result is derived from the score. An early end is `leading` or `draw`. The celebration, the fanfare, and the history winner flag stay off.
- The connected-phone list is sent only on a socket that has already said hello with a valid player credential for this room. A socket that has not said hello does not receive it. There is no public HTTP route for it. A failed hello gets an error and no list. The Durable Object classifies `User-Agent` at the upgrade and stores only `iphone`, `android`, `desktop`, or `other`. The agent string, the address, and the token are not in the roster table and not in the `roster` message. The message is built by copying an allowlist (`seat`, `since`, `online`, `seen`, `kind`, `self`) onto a fresh object. `self` is true only on the socket whose device id matches that row. Other phones do not receive the device id. `seat` is the same actor id already stored on score events.

## Review 25, 2026-10-30

Follow-up on pull request 23 before it is merged. The checks below are in the tree this note now describes.

- P23-01. `POST /matches/:id/carry` ignores a device id in the body. The starter is the device bound to the previous credential, and only if that token and device have already joined. A shared QR, including one nobody has used, cannot move the court. A phone that scans the QR is given its own device credential for the socket; that credential can move the court, the shared code cannot. Each moved phone is asked to accept or decline. One match can do this three times, then the answer is `carry_limited`.
- P23-02. Any joined player may replace the shared code. The caller's own device credential is not revoked and their socket stays open. If their session was the shared code, the response includes a new session token and the app switches to it. Five replacements are allowed per match per hour, then `invite_limited`. Phones that joined with the old code are still disconnected.
- P23-03. A request for a spectator code is refused with `spectator_not_available` before the current player code is returned.
- P23-04. New codes, not repeat showings of the current code, count toward ten per match per hour. Replacing the code counts toward the five above. After a replacement the worker deletes revoked credential rows and revoked short codes for that match. The room drops joined rows and roster rows for those revoked credentials.
- P23-06. A carry only includes a device whose credential is still valid, and that is either connected or was seen in the last hour. A kicked phone, or one that left longer ago, does not take a seat.
- P23-07. An early end is a win only when a team has two sets. When the sets are level, the games decide who is leading, including a set that is not finished. 5–3 is “Team A leading”. Draw is only when the sets and the games are both level. Old history rows that already say `winner-a` or `winner-b` are left as they were.
- P23-08. A device id is 16 random bytes, written as `d` and 32 hex characters. The handover is given only to the token and device that had already joined, and only while the seal has not expired. A hello that names someone else's device id does not receive their token, and it does not store that pair, so a second hello still does not receive it.
- P23-09. The court stays in English: “leading”, “Draw”, “Accept”, “Decline”.

## Review 26, 2026-10-30

Follow-up on the second pass over pull request 23. A guest must not be able to use up the host’s move or the host’s new code, and a scan that never connects must not fill the court.

- P23r-01. A carry is counted on the phone that started it, and only when at least one other phone is actually offered the new match. Three carries from one phone do not stop another phone. The offer names the starter’s seat (Host or Player N), the same label the phone list already shows.
- P23r-02. The host’s new-code budget is separate. A guest phone may replace the code twice an hour. That does not spend the host’s five.
- P23r-03. A personal token from a scan counts toward the mint cap when the phone says hello. Until then it expires after three minutes and does not take a place. Connected phones are not dropped by unused scans.
- P23r-05. Decline deletes that phone’s move seal, so the same offer does not return on the next reconnect.
- P23r-06. If the browser cannot store a device id, the page keeps one id in memory for the rest of the visit. Join and hello use that same id.
- P23r-07. A device id saved as 32 bits is kept beside the new 128-bit id. The next hello moves the seat, the roster row, and the credential onto the new id. The old id is accepted only as that upgrade, and only for the credential that already had it.

Old archived matches are not rewritten. The sentences in the app stay English.

## Review 27, 2026-10-30

Version 2.2.7. Pull request 23 is already on `main`. This review is the shared short-code link, the connect dialog, and the win clip. No new dependency, no new host, and no change to the content security policy. `media-src` stays `'self'`.

Threats considered:

- The short code is placed in the query string, so the static host logs it or a later page receives it as a Referer.
- A fragment is decoded and then treated as a code, so an encoded payload becomes a request or HTML.
- A fragment is written into the page with `innerHTML`, or followed as a navigation, including `javascript:` and an `https://` address.
- A link opened in Safari, rather than the home-screen app, skips the join or skips the rate limit.
- The share sheet sends the raw code, or a failed share copies a string that was not allowlisted.
- The win clip is loaded from the credit URL, or an early end plays it.

Decisions:

- Send code shares `origin + /PadelCounterV2/ + #join=` and the canonical code, for example `https://patrickstubner.github.io/PadelCounterV2/#join=K7M4-2QAB`. The Web Share API receives that string once, as `text` only, so a share target does not show the link twice. If sharing is missing or throws for a reason other than cancel, the clipboard receives that string. A cancelled share copies nothing. A value that is not a short code is not shared and not copied.
- The fragment allowlist is `join=` plus four symbols, an optional hyphen, and four symbols. The symbols are the existing alphabet: no I, L, O, 0, or 1. The check runs on the raw fragment. It does not call `decodeURIComponent`. `normalizeJoinCode` runs only after that match. `#/join?t=` remains the QR token and is not this path.
- A matching code calls `joinByCode`, the same function a typed code uses. That is one `POST /join` with the device id and the code. The worker's attempt cap, the expiry of the player invite, and the fixed error sentences are unchanged. The code is not stored in `sessionStorage`. `history.replaceState` then sets the address to the current path and search, with the history state `{ padelArchive: 'court' }`. The replacement URL is not taken from the fragment.
- A `join=` fragment that fails the allowlist is removed the same way. It does not call the network. The court shows the fixed sentence “This code is not valid.” The fragment text is not inserted into the DOM. A live host tab strips the fragment and keeps the host credential. Opening the link in Safari uses this boot path. The home-screen app is not required.
- Nothing in this path assigns `location` from the fragment. An `https://` address, a `javascript:` URL, or an extra `&next=` parameter inside the fragment fails the allowlist. There is no `innerHTML` and no `dangerouslySetInnerHTML`.
- The connected-phone control is an inline SVG drawn with `currentColor`. It has no `href` and no external file. The count stays a number.
- Connect and Join match no longer render a bottom Close button. The X and a tap on the backdrop still close them, and Escape still closes them. The action buttons are a stretched column in portrait. In landscape the scanner actions are one row, aligned to the end, with `transform: none`.
- The win clip is `apps/web/public/06_crowd-in-hardrock.mp3`. SHA-256 `09f686627dc2b8db4e1a32dc4e7a943b48a15e30c581a0beeb2ca4632c097a13`, 112892 bytes. The service worker precaches it. `stay-awake.mp4` stays out of the precache. Playback uses `new Audio` on the path from `withBase`. A source that contains `://` is not played. The toggle at `pcv2:fanfare` still defaults to on. `shouldPlayFanfare` is still tied to the celebration, so an early end does not play the clip. The file is CC0. Credits for freesound 416190 (aceinet) and the SFXMint stadium cheer are in `CREDITS.md` and `NOTICE.txt`. Those pages are not requested at playback. Playback sets the element volume to one half, and closing the celebration pauses the clip.

## Review 28, 2026-10-30

Follow-up on pull request 24 before it is merged. The checks below are in the tree this note now describes.

- P24-01. The close control of Connect stays at the top of the scrolling dialog. The white QR sheet keeps at least 1.25rem of backdrop on each side, in portrait and in landscape, so the sheet does not fill the viewport. A browser layout test checks 390×780, 844×390, and 568×320.
- P24-02. A `#join=` link does not join until the phone confirms. Cancel sends nothing. Join copies a started match into History and then uses the typed-code path.
- P24-03. The share sheet receives the link once, as `text` only.
- P24-04. The win clip plays at half volume and pauses when the celebration is closed.
- P24-05 and P24-06. `#JOIN=` is the same fragment as `#join=`. A live host removes it from the address bar. A refused code and a join response that is not a token leave Join match open. The request body is the canonical code.
- P24-07. A host who already has the match is told “You are already the host. This link was not used.”
- P24-08. One connected phone is “1 phone connected”. Any other count stays plural.
- P24-10. The fragment is not a Referer, a query, or an app store. It can remain in a chat, a share target, and the browser history of the open. The code lasts two hours, or until New code.

## Review 29, 2026-10-30

Version 2.2.8. Pull request 24 is on `main`. This review is the short tap on plus, minus, the serve ball, and a set change. No new dependency, no new host, and no change to the content security policy.

Threats considered:

- A duration or a pattern taken from the URL, the match, or another phone makes the device vibrate for a long time.
- The hidden switch takes focus from the score control, scrolls the court, or shifts the layout.
- The switch is announced by assistive technology, or it can be reached with the keyboard.
- The on/off choice is stored outside `pcv2:` or next to the join token.
- A phone with no Vibration API and no switch throws, and the point is not counted.
- The tick is loaded from a third-party script.

Decisions:

- One pulse of 15 ms, and only after a local tap on plus, minus, a serve ball, or a set that is not already selected. The duration is the constant `HAPTIC_MS` in `apps/web/src/domain/haptic.ts`. It is not read from storage, the network, or the URL. The score is applied before the tick. A tick that throws does not undo the point.
- The menu stores `on` or `off` at `pcv2:haptic`. A missing value means on. The join token stays in `sessionStorage` under `pcv2:join` and is not this key. Turning the tick off on one phone does not change the others.
- When `navigator.vibrate` is a function, that is the only call. The switch is not mounted.
- When it is not a function and `switch` is on `HTMLInputElement.prototype`, the app clicks the label of a checkbox that has the `switch` attribute. That is the iOS 18 tick. The checkbox is not in a form and has no name. The input is a sibling of the label, so the click is the label click.
- The host is `position: fixed`, 1×1 px, opacity 0, and `pointer-events: none`. It is not `display: none`, because that suppresses the iOS tick, and it is not in the score grid. The host, the input, and the label are `aria-hidden`. The input and the label use `tabIndex={-1}`. After the click, focus returns to the control that had it, with `preventScroll`, and the scroll position is put back if the browser moved it.
- Both paths are in try/catch. An older phone with neither API scores as before.
- Nothing is sent to the worker. CSP is unchanged.

## Review 30, 2026-10-30

Version 2.2.8, after pull request 24 is on `main`. This note is the leftover from that review. No new package is shipped, and the content security policy is unchanged.

- P24r-01. The `archive-current` action is removed. It copied the open match into History and left the same match on the court. `replace` already copies the previous log when a join switches to another match id. Confirming a link still keeps a started match in History. A join that never switches matches does not write a second copy first.
- P24r-02. Confirming Join removes the dialog before the request returns. `joinByCode` normalizes the code and does not call the network for a string outside the short-code alphabet, including `ungueltig`. A second play of the win clip pauses the first element.
- P24r-03. The layout test is part of `pnpm test`. CI installs Chrome with `playwright install --with-deps chrome` and then runs `apps/web/e2e/connect-layout.spec.ts`. That browser is a CI tool. The court bundle does not include it, and the test talks only to the local dev server.

## Review 31, 2026-10-30

Version 2.2.9. Pull request 25 is on `main`. This review is carry after a finished match, carry without a second question, continuing a match from History, an earlier tap on Android, and two leftovers from the 2.2.8 review. No new dependency, no new host, and no change to the content security policy.

### Why a guest who tapped Accept stayed on the old match

The host’s New match did three things in order: create the next match, `POST /carry`, then `POST /invites` to show the new code. Carry issued a device-bound credential and sent `match_moved` on the old socket, so the guest saw the question. The invite that followed revoked every non-host credential on the new match, including those carry credentials, in the Durable Object and in D1. Accept then called `POST /join` with a revoked token.

That showed up after a finished match because the guest was on the win screen and tapped Accept only after the invite had completed. It is the same revoke on an early end. It is not the three-minute unused-scan expiry: a carry row is not a pending mint (`minted_at` stays 0) and its lifetime is the normal join lifetime. It is not the rotate budget, and it is not the hello rule that refuses a new device on an ended match. The uploaded log ends with `match/new`, so the new room is not ended. iOS going to the background is not required.

The first code on a match now revokes only shared codes (`device_id` is null). Device-bound carry credentials stay valid, so a phone that follows immediately and a phone that follows after the code is shown both enter. **New code** still revokes device-bound credentials and disconnects phones that joined with the old code.

### Carry without a question

Threats considered:

- A shared QR, or a guest’s own credential, moves every phone with no question.
- A device id in the body adds a phone that never joined.
- A carry token is replayed from another phone, or kept forever for an offline phone.
- Publishing the new code, or rotating it, is confused with the fix above.
- The three-carry limit is dropped.

Decisions:

- `POST /carry` accepts the previous credential only when that credential is the host of the old match and that host phone has already joined. A shared QR and a guest credential are rejected. The device id in the body is still ignored. The starter phone is taken from the credential, as in review 23.
- Each carried phone gets its own device-bound token. Hello rejects a different device. The token is not put in a URL. Connected phones receive `match_moved` and follow at once. There is no Accept control. The court says “New match”.
- An offline member receives the same message on hello with its old credential, until that move seal expires (two hours, the join lifetime). The phone had to be connected, or seen within the last hour, when the host asked. A phone that was not carried gets a fixed sentence and no token.
- At most three carries per starter phone, and at most three other phones. Connected phones are listed first.
- A guest cannot start this. New match on a guest phone only leaves the shared match on that phone.

### Continue from History

Continuing is local. This phone leaves a live match first. It does not create a room and it does not carry anyone. The phones that are still in the live match stay there. A new live room would be a different match and would skip the reopen check on the original room.

The creator can continue. If someone else ended the match, only that phone can continue, unless the creator ended it: the creator still can. That is the same rule as Resume on a live match. The seat is known while this phone is still a guest of a live match. After it has left, History is this phone’s copy and this phone is treated as the local owner.

A match with three decided sets cannot be continued. An early end with no winner can, until a team wins two sets. A win with a set still open (2–0) can, and the open set is selected. The app asks first. The match on the court is archived before the old one is restored. A blank court is not archived.

### Haptic timing

Android vibration runs from pointer down, before the click that changes the score. The call is still `navigator.vibrate` for 15 ms and is still try/caught, so a throw does not drop the point. A move of more than 12 pixels, or a cancelled pointer, does not vibrate, and the click does not vibrate again. A click with no pointer (a keyboard) still vibrates once.

iPhone stays on the click. The tick is a label click on a checkbox with the `switch` attribute. That tick needs the user activation of the click that counts the point. A pointer-down handler is not that activation, and calling the label from pointer down does not replace it. The switch is still not mounted when `navigator.vibrate` exists, so the two paths cannot both tick.

### Review leftovers

- P25-02. CI no longer runs `playwright install --with-deps chrome`. That step installed an unpinned Chrome package as root. The layout test uses the Chrome already on the runner. A machine without Chrome can still install the pinned Playwright browser locally.
- P25-06. `initialSession` catches a throwing `localStorage` and starts from an empty court. The save effect catches the same failure and shows the existing “Saving on this device failed.” note. The join token is not written there.

## Review 32, 2026-10-30

Version 2.2.10. This note is P26-09. No new dependency, no new host, and no change to the content security policy.

A match created from an earlier one posts the whole log, ending in `match/new`, and may send `previousHostToken`. `assignMatchId` rewrites an id only when replay currently shows that same id. The new event's id becomes the Durable Object name. `base.matchId` stays the previous match. End match called `revokeSharedAccess` and `touchMatchActivity` with `base.matchId`, so the previous match was revoked again and the new match's code still redeemed (`201`). The previous match's code was already `401` from its own End match.

The room now uses `ctx.id.name`, the name passed to `idFromName`. That is the id written on the credential and the join code.

Places that read `base.matchId`, and what this version does with each:

| Place | Decision |
| --- | --- |
| `match-room.ts` End match, `revokeSharedAccess` | Fixed. Revokes the object name. |
| `match-room.ts` `touchMatchActivity` | Fixed. The chained match's `last_activity` moves. The previous row does not. |
| `server.ts` create, invite, New code, carry, join | Already the object name: the route id, or `credential.matchId` stored at create. Unchanged. |
| `assignMatchId` | Unchanged. Rewriting `base.matchId` on a chain would drop the earlier match from the log. Replay of the stored log is the object name. |
| `useLive.ts` snapshot session id | Fixed. The phone was storing `base.matchId`, so a later New code was sent to the previous match and rejected. The session id is now the replayed id, which is the object name. |
| `apps/web` `log.ts` `matchSegments` | Unchanged. `base.matchId` is the first segment. Later segments follow `match/new`. That is history, not the room key. |
| Leave live match | This phone drops its token. There is no server revoke, so the shared code stays valid for the other phones. `POST /matches/:id/leave` is not a route. |
| Kick | There is no kick route. `POST /matches/:id/kick` is `404`. New code is what disconnects phones that joined with the old code. |

A workerd test builds that chain with `previousHostToken`, carries a guest, and then `POST /join` with the code. After End match the code is `401`. After New code the previous code is `401`. After the socket closes, and after the missing leave and kick routes, the code is still `201`.

## Review 33, 2026-10-30

Version 2.3.0. Pull request 26 is on `main`. This review is removing one phone, the copy of the short code, and the serve cues. No new dependency, no new host, and no change to the content security policy. Review 32's rows for Leave and Kick describe 2.2.10. This review adds both.

Threats considered:

- A phone removes itself and then keeps scoring, or marks itself so nobody can remove it.
- A guest removes the phone that started the match, or two phones take turns removing each other.
- The kick names a device id, and that id is written into the roster or the error.
- Revoking one phone revokes the shared code, so the other phones are dropped.
- A removed phone reconnects with the old token or with the code that is still on the court.
- Copy code puts the join link, the token, or extra text on the clipboard.
- The serve hint states a rule the FIP book does not contain.

Decisions:

- Any admitted phone may remove any other phone except the starter. The starter is the `host` seat, and only the host credential receives it. A guest cannot take that seat, so a phone cannot protect itself by becoming the starter. The starter may remove every other phone, including one that is offline. No phone may remove its own seat. There is no protect switch.
- A successful removal revokes that device’s credential in the Durable Object and in D1, drops that device’s joined row and roster row, and closes its socket with `revoked`. The shared code is not revoked. The device is recorded in the room. `POST /join` with the current shared code will not mint a new token for it. A new code clears that record. That is the new invitation. Other phones stay.
- The client sends `{ type: 'kick', seat }` and the seat is the same public id already on the roster (`host`, `p2`, …). The roster allowlist is unchanged: `seat`, `since`, `online`, `seen`, `kind`, `self`. Device ids, addresses, and tokens are not added. A device id in the kick message is ignored and is not copied into the reply.
- One credential may remove 3 phones per 10 minutes. One match may absorb 8. A burst of attempts on one socket is `slow_down` after 5 in 10 seconds, and that does not close the socket. `kick_refused` and `kick_limited` do not close it either. `revoked` still does, for the phone that was removed.
- Copy code writes the canonical short code and nothing else. The clipboard API is tried first. If it is missing or throws, a temporary field is used and then removed. A string that is not a short code is not written. Share link is unchanged: the fragment link, or a copy of that link.
- The serve sentences are the ones in `docs/fip-serve.md`. A 6–4 or 7–5 ending does not get a “who serves next” sentence, because the December 2025 rulebook states that only for the set after a tie-break.
- P26-01. A mouse release outside the control does not score. `setPointerCapture` still tracks the drag. The click is ignored when that release was outside the button.
- P26-02. A dragged touch does not leave `suppressClick` set. The next keyboard tick still runs. `pointercancel` clears the flag. A mouse click after a drag still does not tick twice.
- P26-03. Continue stores the win key as already shown, so the celebration does not cover the court again.
- P26-04. Before a snapshot replaces a local score that is ahead, that log is archived. A later snapshot with fewer games does not overwrite it. The court says the points are in History.
- P26-05. Tests cover the first code leaving a device-bound seat in place, a guest continuing a match that has not ended, disconnect on continue while live, `join_offer` following the same path as a move, the new-match note clearing, `pointercancel`, the right mouse button, and a disabled control.
- P26-06. `POST /carry` is not in the per-address match-route budget. Phones on one network can still move after other requests have filled that budget. The per-phone carry cap in the durable object is unchanged.
- P26-07. Take phones counts every other phone on the roster, including offline ones. The roster is already only on an admitted socket.
- P26-09. D1 revocation for End match, activity, kick, and leave uses the durable object name, not `base.matchId`. The update is `token_hash` and `match_id` together. A later `match/new` in the log cannot aim the revoke at another row.
- Leave. `POST /matches/:id/leave` requires the caller’s bearer token. The worker checks that token against this match before it calls the durable object. The body is not read for a target, so a phone cannot name another device or seat. The object revokes that token only, and the D1 update uses the durable object name, never `base.matchId`. The shared player code (`device_id` is null) is not revoked, so the join code still works. Other sockets stay open. Five calls per credential per ten minutes, and the same per-address cap as invite and join. After that the answer is `leave_limited`. A missing or foreign token is `bad_token`.
- P28-01. Create writes the room id into `meta.match_id`. That value is the object name when the name is a UUID, otherwise the id replay already shows after the worker assigned it. It is not `base.matchId`. End match, activity, kick, and leave use `ctx.id.name` when that name is a UUID, and the stored id otherwise. A name that is not a UUID is not sent to D1. Both are lowercased. End match reads the id before it stores the event. If neither id is available, the event is not stored, so a retry is not a duplicate that skips the revoke. A repeated end runs the revoke again only while the match is still ended.
- P27-01. Remove says the phone is removed, and that other phones can still join with this code until New code. The block is the device id. A new device id with the same code is admitted. New code is what turns the code off.
- P27-02. A duplicate `match/end` revokes the shared code only when replay still shows the match as ended. After resume, sending that old event id again does not revoke a code issued since.
- P27-03. A guest does not see Remove on the starter’s row. The starter still does, for every other phone. Each Remove button’s accessible name includes its place in the list, so two phones of the same kind are not the same control.
- P27-04. In portrait the board and each team clip overflow, and the large digit’s line box matches the column, so the page is not taller than the screen.
- P27-06. Leave with the host credential revokes that credential. Coming back with the same token is rejected. The other phones stay, without a host seat. Carry runs before that disconnect. The way back is a local court or a new match.
- P27-07. Tests cover the ninth removal in one match, the room row revoked by a removal, the leaver’s socket closing, a duplicate end while the match is ended and after resume, the tie-break sentence only at 6–6, the next-set sentence after 6–7, and Leave when this phone disconnects.
- P28-02. A chained `log` notice sets the phone’s session id to the replay id, and New code is posted to that id. Tests cover a non-UUID name, an uppercase id, a missing name, and the activity marker being put back when the touch fails or the id is missing.
- P28-03. Chains ended before 2.2.10 still have the old D1 rows. Their codes were not revoked and `last_activity` was not moved. They expire on the normal lifetime. This version does not rewrite them.

## Out of scope

OAuth client secrets, passkeys, admin user ids, and a production delete API were not added. No secret for those features should be committed when they are built. Put provider secrets in Wrangler and in GitHub environment secrets, not in `PUBLIC_*` build variables.
