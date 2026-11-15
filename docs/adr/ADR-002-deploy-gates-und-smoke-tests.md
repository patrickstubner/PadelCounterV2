# ADR-002: Production nur nach grünem Staging-Smoke desselben Commits
Status: **vorgeschlagen** (15.11.2026)

## Kontext
Staging deployt automatisch bei einem Push auf main, Production manuell per `workflow_dispatch` auf main-HEAD. Es gibt keine Verknüpfung zwischen beiden und keinen Smoke-Test.

## Entscheid (Vorschlag)
1. **Smoke-Skript** `adapters/cloudflare/scripts/smoke.mjs` (Node, ohne Abhängigkeiten):
   - `GET /health` des Workers liefert 200 (die Route existiert, `routes.ts:7`).
   - Die Pages-`version.json` liefert `commit === github.sha` und `protocol === LIVE_PROTOCOL` (nur Prod, nach dem Pages-Job).
   - WebSocket-Hello mit `protocol: LIVE_PROTOCOL - 1` muss `upgrade_required` liefern. Mit aktuellem Protokoll und ungültigem Token muss `bad_token` kommen.
   - Diese Prüfung ist nur möglich, wenn der WS-Pfad ohne angelegtes Match erreichbar ist. Sonst läuft sie nur in Staging mit Test-Match, damit in Prod keine Quoten verbraucht werden.
2. **Staging-Job:** Nach dem Deploy läuft `smoke.mjs` gegen den Staging-Worker.
3. **Production-Job:**
   - Erster Schritt «Gate»: per `GITHUB_TOKEN` (actions: read) prüfen, dass für `github.sha` der Workflow CI und der Staging-Job `success` haben. Sonst Abbruch.
   - Nach dem Deploy `smoke.mjs` gegen Prod.
   - Bei einem Fehler wird **nicht** automatisch zurückgerollt, aber deutlich gemeldet. Der Rollback mit `wrangler rollback` ist in DEPLOY.md beschrieben.
4. **Optional, später:** Ein Staging-Frontend-Build als Artefakt (`PUBLIC_API_URL` = Staging), gegen den der Playwright-Smoke «Match anlegen, zählen, zweites Handy verbinden» läuft.

## Folgen
- Änderungen nur an `deploy.yml` und einem neuen Skript. Der App-Code bleibt unberührt.
- Risiko für den laufenden Code: **gering**. Ein falsch konfiguriertes Gate blockiert höchstens den nächsten Prod-Deploy, nicht den Betrieb.
- Kosten: keine (GitHub Actions free, workers.dev).
