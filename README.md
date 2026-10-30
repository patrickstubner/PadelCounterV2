# Padel Counter V2

<https://patrickstubner.github.io/PadelCounterV2/>

This link goes live after the first deploy. Until then the page is not up yet.

Padel Counter V2 keeps the score of a padel match on your phone. You can play alone, or share one live match with other phones.

## What the app does

- **Scoring.** A set is won with 6 games and a lead of 2, or 7–5. At 6–6 the next game is the tiebreak and counts as one game, so the set can finish 7–6. A match is best of 3 sets. You can always open an extra set. Tap **+** to give a team a game. Tap **−** to take a game back.
- **QR join, up to 4 players.** The phone that starts the live match shows a QR code and a short code such as K7M4-2QAB. Other phones can scan the QR in the app, type the short code, or open the link. At most 4 phones can be in the match. The next phone is told: “This match is full.”
- **End match and reopen.** End match finishes the match at any score and locks the court. The phone that started the match can reopen it. If another phone ended it, that phone can reopen it too, unless the starting phone was the one that ended it. The starting phone can always reopen it.
- **Corrections.** **+** and **−** still work after a set has finished. A set that shows 6:0 can be corrected to 5:1. History keeps every change, with the time and which phone made it. Nothing is overwritten.
- **New match.** If other phones are in the live match, New match asks “Take the connected phones into the new match?”. Yes moves every phone that already joined. They do not scan again. A phone that is offline joins when it reconnects, while its code is still valid. If that code has expired, the phone stays on the ended match and says the others continued. No starts the new match on this phone only: the phone that started the shared match ends it, and another phone leaves the shared match on that phone only. Cancel leaves the current match. A blank court asks before it resets.
- **Victory sound.** When a team wins two sets, a short crowd clip plays once, together with the celebration. Ending the match early does not play it and does not name a winner. The court says who is leading, or Draw. Turn the sound on or off in the menu with **Victory sound**. The clip is stored in this app. If the phone blocks sound, the celebration still shows and the app stays quiet. Sources are in `CREDITS.md`.
- **How long data is kept.** The score on this phone stays in this browser. A live match stops taking scores one day after the last change. After that, nobody can change the games. The match stays on the server as history for two years, then it is deleted. The app does not ask for a name, an email, or a sign-in.

The privacy note in the menu says the same thing in the app. It is not legal advice.

## How to use

1. Open the app. The court shows Team A and Team B, both on 0.
2. Tap **+** beside a team when that team wins a game. Tap **−** if that game should not have counted.
3. To share the match, open the menu and choose **Connect**, then **Show QR code**. Turn that screen to full brightness and hold it flat. The QR code is large, with a white margin, and a short code is under it. Send code shares a link such as `https://patrickstubner.github.io/PadelCounterV2/#join=K7M4-2QAB`, or copies that link. The code is only after the `#`, so it is not sent to the site that hosts the page. Opening the link asks before it joins, including in Safari, and then the code is removed from the address bar. A match already on this phone is kept in History. Any phone already in the match can show that same code. Close Connect with X or a tap outside. The other phones open **Connect**, then **Scan QR code**, then Use camera. The camera fills the screen. Enter code sits on the picture. Close the scanner with X or a tap outside. Up to four phones can score.
4. When you are done, open the menu and choose **End match**, then confirm. The score stays. Choose **Resume** later if the match should continue.
5. To start another match, open the menu and choose **New match**. If other phones are connected, choose **Take phones** or **Just this phone**. Cancel leaves the current match.
6. Open **History** in the menu to read the games, who changed them, and the score after each change.
7. Open the menu and use **Victory sound** to turn the win clip on or off.

## For developers

The court is the earlier game counter, plus a live match that phones share with a QR code. The worker name is `padel-counter`. Sign-in, a shared delete, and a view-only QR code are not in this version.

### Layout

| Path | Package | Role |
| --- | --- | --- |
| `apps/web` | `@padel/web` | React court, GitHub Pages, service worker |
| `packages/core` | `@padel/core` | Scoring, roles, join rules, log parser. No DOM. |
| `adapters/cloudflare` | `@padel/worker` | Worker, one Durable Object per match, D1 migrations |
| `docs/architektur-report.md` | | Architecture notes this scaffold follows |

Live scoring is stored in the Durable Object. Each score event names the server event it was scored on, and the board before and after the point (`docs/live-score-sync.md`). A reconnect does not count a point that is already stored. Points only one phone recorded are added. History shows the time the point was tapped. D1 stores the match id, the daily create counters, the per-minute join counters, hashed credentials, hashed short codes, and short-lived websocket tickets. A socket is opened only with a one-use ticket from `POST /join`, so a match id on its own does not create storage. The worker chooses the match id and retries if that id is already taken. The dev worker name is `padel-counter-dev`. One device can create 10 live matches per UTC day. One network can create 100. `POST /join` reads the token before it writes. A device id is chosen by the phone, so the cap of 20 successful joins per minute does not stop someone who changes that id. A network allows 60 failed attempts per minute; a successful join does not count, so one shared Wi-Fi is not locked out. Inside one isolate, failed joins stop after 5 per minute and then do not write. Those counters are an HMAC of a worker secret named `QUOTA_HMAC_KEY`. The UTC day is part of the create hash, and the minute is part of the join hash. The scheduled job deletes those rows after two days. Create, invite, carry, `/join`, and `/ws/*` also pass a Workers rate-limit binding of 30 requests per 60 seconds per HMAC of the client address before those D1 writes. That binding is per Cloudflare location and approximate. Thirty and the network cap of 60 are both above the isolate cap of 20, so they apply across isolates and locations, not inside one isolate alone.

A live match stops taking scores one day after the last live score. That clock is the server time stored when the match is created and when a score is saved. A time sent by the phone is not used. The server keeps the match as history for two years after the last score, then the scheduled job deletes it. That history clock moves at most once a minute. The Privacy page says both.

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

`pnpm dev` starts the court. `pnpm dev:worker` starts `wrangler dev --env dev` from `adapters/cloudflare`. Copy `adapters/cloudflare/.dev.vars.example` to `.dev.vars` and set `QUOTA_HMAC_KEY` to a random string of at least 32 characters. There are no OAuth secrets to fill in.

To point a local court at a local worker, start the worker and run the court with `PUBLIC_API_URL=http://127.0.0.1:8787`. The dev worker allows that origin. Production and staging do not.

### Before the first deploy

Nothing here requires a paid Cloudflare plan or a credit card. Follow `docs/DEPLOY.md` in order. Until the Cloudflare secrets exist, the deploy workflow skips the worker and exits successfully. Pages does not run until the repository variable `DEPLOY_PAGES` is `true`.

A WAF rate-limiting rule cannot be attached to `*.workers.dev`, because those rules belong to a zone and this project has no custom domain. Do not block a deploy on that rule. The Workers binding and the D1 join counters are what run on this host. Create, invite, carry, `/join`, and `/ws/*` also share an isolate limit of 20 requests per minute per address. If a zone is added later, the Free plan allows one rule with the three paths OR-ed together and a period of 10 seconds. The reason, with the Cloudflare doc links, is in `SECURITY.md`. Patrick accepted the remaining cost and availability risk of having no zone on 27 October 2026.

Staging deploys the worker on every push to `main` when the Cloudflare secret and account id are present. Production deploys only from Actions, “Deploy”, “Run workflow”, on `main`. The `production` environment has no required reviewer. Its deployment branch policy is custom and contains only `main`. Both skip cleanly when the secrets are absent. Pages runs in that same production run, after the worker, and only for that commit, when `DEPLOY_PAGES` is `true`.

Do not create sign-in providers yet. They belong to a later change: a Google client, a Facebook app secret, a GitHub OAuth client secret, a passkey relying party of the pages host, and a signing key. No Apple Developer account, no X API, and no mail domain.

### Security

Details are in `SECURITY.md`. The short version:

- The QR code carries a 128-bit token in the URL fragment (`#/join?t=<token>`), not in the query string and not next to the match id. The scanning phone removes that fragment with `history.replaceState` and then joins. Join match in the app accepts that link only when the origin and the path are this app. A short code is a separate random value. The server stores its hash and maps it to the current player invite. It is not derived from the token or the match id. The camera scan, and what still has to be tried on a real iPhone, is described in `docs/qr-scan.md`.
- The token expires after 2 hours. The creating phone’s credential expires after 12 hours and is kept in this tab’s `sessionStorage`, so a refresh can show the current code. It is not in `localStorage`.
- New code revokes the previous code and disconnects the phones that joined with it. Showing the current code does not.
- The worker stores SHA-256 hashes of tokens. The raw token is returned once.
- The role is stored with the token. This version issues `player` only. `spectator` is rejected with “View-only links are not available yet.”
- The Durable Object admits at most 4 player sockets, including the creator. Disconnecting frees a place.
- `POST /auth/*` returns 501. Deleting a match in the app removes it from this device only. A later shared delete is limited to the creator and one admin. Other players will only be able to hide a match. That is not enforced here because the server has no delete route.
- There is no undo control and no undo event. Minus removes one game, and the log keeps the earlier events.
