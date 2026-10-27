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
- The token is not placed in the query string. The QR target is `…/#/join/<matchId>?t=<token>`. The page strips the token into `sessionStorage` (`padel-counter-v2.join`) and replaces the fragment. The host token is kept in a ref in the creating tab and is not written to `localStorage`.
- The WebSocket URL has no token. The first message is `{ type: 'hello', protocol: 1, token }`. The socket attachment stores the role and the host flag, not the raw token.
- Hello and each later action run on the Durable Object. A spectator credential cannot pass `canPerform`. `undo` and unknown event types fail parsing. `match/new` and `match/reset` are not applied on a live room. The server replaces `event.at` with its own clock. A game that the reducer refuses (for example 7–4, or minus at zero) is not stored. A repeated event id is acknowledged and not appended twice. The event table is insert-only.
- HTTP routes are `GET /health`, `POST /matches`, `POST /matches/:id/invites`, and `GET /matches/:id/ws`. `POST /auth/*` returns 501 `{ error: 'not_available' }`. Delete, `/create`, and `/invite` are not public routes. The worker calls those internal paths itself on the Durable Object stub.
- CORS allows `https://patrickstubner.github.io` only, plus `http://localhost:<port>` and `http://127.0.0.1:<port>` when `ENVIRONMENT` is `development`. Staging and production set `ENVIRONMENT` to `staging` and `production`. Responses vary on `Origin` and do not echo a rejected origin. Credentials (cookies) are not allowed. The browser must send `Authorization: Bearer <token>` on invite. A WebSocket upgrade with a missing or foreign `Origin` is rejected.
- Court CSP: `default-src 'self'`, no `unsafe-inline`, no `unsafe-eval`. `connect-src` gains the API origin only when `PUBLIC_API_URL` is an `https` `*.workers.dev` URL at build time. CI leaves it empty, and `verify-build` fails if `index.html` then contains any http(s) URL. The QR is drawn as SVG rectangles from the module matrix. There is no `innerHTML` and no `dangerouslySetInnerHTML`. The accessible name of the QR does not include the token.
- The client renders `ROOM_MESSAGES[code]`. A `message` field on the wire is ignored, including a message that contains markup. Player counts outside 0–4 are ignored.
- Create requests are limited to 20 per minute per `CF-Connecting-IP` inside one isolate. Each admitted socket is limited to 10 messages per second. A room accepts at most 16 sockets and at most 4 that have not finished hello.
- Body size is capped (about 96 KB for a match log, 8 KB for a socket message). SQL uses bound parameters. Parsed objects are copied onto a null-prototype object before fields are read. Team names are length-limited and rendered as React text.
- Storage keys are `padel-counter-v2.log`, `padel-counter-v2.matches`, and `padel-counter-v2.celebrated`. The service worker cache id is `padel-counter-v2`. The pages base is `/PadelCounterV2/`. v1 keys and the v1 service-worker scope are not reused.
- `.dev.vars`, `.env`, and `.env.*` are gitignored. `.dev.vars.example` contains `ENVIRONMENT=development` and no secret. Wrangler database ids in the repo are placeholders, not live databases.
- CI runs lint, typecheck, unit tests, the production web build, a wrangler dry-run, and `pnpm audit --audit-level=moderate`. Deploy jobs do nothing until Cloudflare credentials exist, and Pages does not run until the repository variable `DEPLOY_PAGES` is `true`.

## Findings

| Sev. | Topic | What is true now | Proposed fix |
| --- | --- | --- | --- |
| Medium | Open match creation | `POST /matches` needs no login. A client that can reach the worker can create Durable Objects and store a log. The 20/minute limit lives in isolate memory, resets when the isolate dies, and collapses to one bucket when `CF-Connecting-IP` is missing. | Add a Cloudflare rate-limiting rule on `POST /matches` and `POST /matches/*/invites`. Require a signed-in creator when login exists. |
| Medium | QR token is the whole permission | Anyone who sees the code can score, until it expires, is rotated, or the room already has 4 players. The token is not bound to a device. | This is the product for this version. Later: a shorter TTL, a read-only spectator code (the role check is already there), and login. Tell players not to photograph the code for people who should not score. The privacy page says this. |
| Low | Sockets that never say hello | Four unauthenticated sockets can sit on a room, and sixteen sockets is the hard cap. There is no idle timeout, so a client can hold those places until it disconnects. | Close a socket that does not complete hello within a few seconds (Durable Object alarm). |
| Low | Rate limits are per isolate | Create and message limits are not shared across Cloudflare’s edge. Many clients can exceed 20 creates per minute. | A rate-limiting rule, or one small counter Durable Object, in front of create and invite. |
| Low | Fifth-player test does not boot a Durable Object | The cap, the exact sentence, the spectator refusal, and `canPerform` are unit-tested. The socket count passed into those functions is not exercised inside `workerd`. | Add a Miniflare or `wrangler dev` test that opens five WebSockets and expects the fifth close with `match_full`. |
| Low | Join token in `sessionStorage` | A script running on the page origin could read the token. The CSP and the HTML-injection lint rule are what prevent that script. | Keep the CSP. Do not add a tag manager, a CDN script, or inline script. Do not put the token back into the query string or `localStorage`. |
| Low | Host token dies with the tab | The creating phone cannot mint a new code after refresh, because the host token is memory-only. That avoids a long-lived secret on disk. Someone who can read the tab’s JS heap during the session can still read it. | Keep it out of `localStorage`. When login exists, mint codes from the session instead of a 12-hour bearer token. |
| Low | D1 is unused | Live scoring never reads D1. The checked-in database ids are documentation placeholders. A deploy with those ids will fail at migration time, which is preferable to writing to the wrong database. | Replace the ids before the first real deploy. Do not treat the placeholders as secrets. |
| Low | Parser is hand-rolled | Bounds, types, plausible set scores, and a null-prototype copy are checked. There is no second schema library. A new event field can be forgotten. | Add a schema library when the event list grows. Until then, extend `parseStoredEvent` and the core tests together. Unknown types, including `undo`, already return null. |
| Info | No login, no shared delete | `POST /auth/*` is a stub. Deleting a match in the UI removes it from this browser only. The later rule (only the creator and Patrick may delete a shared match; others may only hide it) is not enforceable yet because the server has no delete route. | Keep delete off the public router until accounts exist. Do not add a delete route that trusts the match id. |
| Info | Retention is not implemented | A two-year retention period was discussed. No scheduled job deletes old matches. | Do not describe retention as active. Add an explicit job later, with a dry-run, rather than a hidden TTL. |
| Info | Code scanning is not in CI | Adding CodeQL while the repository has code scanning turned off fails the workflow. | Enable code scanning, then add a pinned CodeQL workflow. |
| Info | Dependencies | Direct pins include React 19.3.0, `lottie-web` 5.13.0, `qrcode` 1.5.4, TypeScript 6.0.3, Vitest 5.0.4, ESLint 10.12.0, Wrangler 4.153.0, `@cloudflare/workers-types` 5.20261027.1, Rsbuild 2.2.13, and `happy-dom` 21.0.4 (tests only). TypeScript 7 and a newer ESLint exist upstream; this tree stays on the v1 TypeScript and ESLint pins on purpose. `happy-dom` 20.14.6 was the v1 pin and is inside GHSA-834v-8h66-3h79, so the test runner is on 21.0.4. `glob` 11.1.0 is a deprecated transitive of the existing Workbox pin. | Keep `pnpm audit` at moderate or higher in CI. Review Dependabot PRs. Do not bump TypeScript or the lottie player without re-running the court tests and the lottie source check. |

No critical or high issue was left open in this review. The medium items are the lack of login on create, and the fact that the QR code itself is the capability. Both match the scope Patrick set for this pull request.

## Out of scope

OAuth client secrets, passkeys, admin user ids, and a production delete API were not added. No secret for those features should be committed when they are built. Put provider secrets in Wrangler and in GitHub environment secrets, not in `PUBLIC_*` build variables.
