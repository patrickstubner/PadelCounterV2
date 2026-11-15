# AGENTS.md
## Projekt
- Zweck: Padel-Zähler als Offline-PWA. Mehrere Handys können live dasselbe Match zählen (QR/Code).
- Stack: pnpm-Monorepo. React 19/TS PWA (Rsbuild, Workbox), Cloudflare Worker + Durable Object + D1. Vitest, @cloudflare/vitest-plugin, Playwright.
- Wichtige Ordner:
  - `packages/core` (reine Logik: Regeln, Reducer, Parser, Protokoll)
  - `apps/web/src/domain` (Persistenz, Archiv, Session)
  - `apps/web/src/live` (Live-Sync, QR)
  - `adapters/cloudflare` (Worker, MatchRoom, Migrationen)
- Architektur-Doku: ARCHITECTURE.md, ADRs in docs/adr/, Deploy in docs/DEPLOY.md

## Arbeitsregeln für Agents
- Vor jedem Cloud-Agent-Start STATUS.md lesen. Fehlt Kontext, zuerst nachfragen.
- Struktur-Fragen lokal beantworten statt grep + ganze Dateien:
  - `cbm index .`, dann `cbm callers workspace-padelcounterv2 matchReducer 2`
  - `codegraph explore "<Frage>"` für Code + Aufrufpfade
  - `serena-repl . 's.lsp.find_referencing_symbols("<Symbol>","<Datei>")'`
- Index-Ordner nie committen: .codegraph/, graphify-out/, .serena/ gehören in .gitignore.
- Befehle:
  - `pnpm install --frozen-lockfile`
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test` (inkl. Playwright)
  - `pnpm build`
  - `pnpm audit --audit-level=moderate`
  - `node adapters/cloudflare/scripts/check-migrations.mjs`
  - Smoke lokal: siehe docs/DEPLOY.md Schritt 12
  - `actionlint` für Workflow-Änderungen
- Pflicht-Checks:
  - core importiert nichts aus react, cloudflare:* oder node:* (ESLint).
  - Fixtures in `packages/core/fixtures/compat/` und `packages/core/fixtures/score/` werden **nie geändert**, nur ergänzt.
  - Ein Speicherformat- oder Protokollwechsel braucht einen ADR und neue Fixtures.
  - D1-Migrationen nur additiv (expand/contract).
- Laufender Betrieb hat Vorrang: Gespeicherte Daten dürfen nie stillschweigend überschrieben werden (ADR-001).
- Nach jeder Code-Änderung eine Sicherheitsprüfung (Abhängigkeiten, Eingaben, Geheimnisse) mit Schweregrad melden.
- Merges nur mit ausdrücklichem OK von Patrick. Production-Deploy nur per workflow_dispatch nach grünem Staging.
- Altes Repo Padel-Counter (v1) nicht anfassen.
