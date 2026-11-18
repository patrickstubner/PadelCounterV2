# ARCHITECTURE.md – PadelCounterV2 (Stand 18.11.2026, Commit aa0c48b, Version 2.3.9)

## Überblick
```
apps/web (PWA, React)  ──┐
                         ├──> packages/core (reine Logik, keine I/O)
adapters/cloudflare ─────┘     rules · reducer/replayScore · parse · scoreSync · policy · messages (LIVE_PROTOCOL)
 (Worker, MatchRoom-DO, D1)
```
- **core:**
  - Einzige Quelle für Zählregeln (FIP), Event-Replay, Score-Sync, Join-Policy und feste Servertexte.
  - Keine Imports aus react, cloudflare oder node.
- **web:**
  - Lokaler Event-Log (`pcv2:log`, schemaVersion 2) und Archiv (`pcv2:matches`, Schema 1) in localStorage.
  - Der Live-Modus über WebSocket kommt hinzu, der lokale Modus funktioniert immer offline.
- **worker:**
  - HTTP-Routen `/health`, `/matches`, `/join` und `/auth`.
  - Je Match ein Durable Object `MatchRoom` (SQLite).
  - D1 für Quoten, Join-Codes und Credentials.
  - Rate-Limit-Binding.
- **Datenfluss Zählen:**
  - UI → `useMatch.publish` → (live: Server bestätigt) → `appendEvent` → `replay` → Anzeige.
  - Server: `MatchRoom.play` → `replayScore` → Broadcast.

## Versionen und Verträge
| Vertrag | Version | Ort | Regel |
|---|---|---|---|
| Lokales Log | 2 (v1 wird migriert) | `packages/core/src/types.ts` `SCHEMA_VERSION` | Neue Felder optional lesen, dann schreiben (ADR-001) |
| Archiv | 1 | `apps/web/src/domain/archive.ts` | ungültige Einträge einzeln überspringen (ADR-001) |
| Live-Protokoll | 2 | `packages/core/src/messages.ts` `LIVE_PROTOCOL` (auch in `version.json` und `/health`) | Ältere Clients bekommen `upgrade_required` |
| D1 | Migrationen 0001–0008 | `adapters/cloudflare/migrations` | nur additiv, vor dem Worker-Deploy; `scripts/check-migrations.mjs` |

## Deploy
- **PR/Push:** Die CI führt Lint, Typecheck, vitest, Playwright, Build/Dry-run, die Prüfung der befristeten Audit-Ausnahme (`.github/scripts/check-audit-exception.sh`, ab 28.11.2026 rot, solange die Ausnahme steht) und `pnpm audit --audit-level=moderate` aus.
- **Push main:** Staging (D1-Migrationen + Worker), danach der Smoke-Test `adapters/cloudflare/scripts/smoke.mjs` (ADR-002).
- **workflow_dispatch:**
  - Release-Gate `scripts/check-release-gate.mjs`: CI und Staging-Smoke für denselben SHA grün.
  - Prod-Worker, danach GitHub Pages.
  - Danach der Smoke-Test.
- **Rollback:**
  - Worker per `wrangler rollback`.
  - Pages per Re-Run des vorigen Commits.
  - Migrationen werden nie zurückgerollt.

## Regressionsnetze
- Speicher-Fixtures `packages/core/fixtures/compat/` → `apps/web/src/domain/compat.test.ts`
- Score-Sequenzen `packages/core/fixtures/score/` → `scoreGolden.test.ts`, Properties `scoreProperties.test.ts`
- Parser-Parität `apps/web/src/domain/parserParity.test.ts` (Abweichung team/rename dokumentiert, P-02)

## Entscheide
ADR-001 (lokale Daten nie überschreiben), ADR-002 (Deploy-Gates), ADR-003 (Kompatibilitäts-Fixtures), ADR-004 (ein Parser im Kern). Alle vorgeschlagen am 15.11.2026.

## Lokale Analyse (Basis Commit aa0c48b, 18.11.2026)
Methode: codebase-memory-mcp 0.12.1 (`cbm index`, `get_architecture` mit hotspots/boundaries, `callers`), codegraph 1.6.2 (`init -i`, `explore`), dazu `rg` und `git log`. Graphify und Serena nicht genutzt. Die Roh-Indizes bleiben lokal (`.codegraph/`, `graphify-out/`, `.serena/`, `.codebase-memory/` stehen in `.gitignore`). Neu indexieren nur bei Code-Änderungen (der Commit ist der Auslöser).

**Umfang:** 253 Dateien, 195 TypeScript, rund 3000 Symbole. Aufteilung nach Symbolen: web 804, cloudflare 482, core 196.

**Modulgrenzen:**
- `apps/web` (`@padel/web`) und `adapters/cloudflare` (`@padel/worker`) hängen nur von `@padel/core` ab (`workspace:*` in beiden `package.json`). Per `rg` gibt es keinen Import zwischen web und cloudflare.
- Der Aufrufgraph von codebase-memory-mcp zählt 141 Aufrufe web → core, 132 cloudflare → core, aber auch 23 web → cloudflare und 4 cloudflare → web. Das sind namensgleiche Funktionen (Heuristik des Index), keine echten Abhängigkeiten. Nicht als Verstoss werten.
- core importiert nichts aus react, cloudflare:* oder node:* (ESLint-Regel, siehe AGENTS.md).

**Hotspots (Fan-in laut codebase-memory-mcp):**
| Symbol | Fan-in | Ort |
|---|---|---|
| `matchReducer` | 40 | `packages/core/src/reducer.ts` |
| `createMatch` | 36 | `adapters/cloudflare/src/server.ts` |
| `appendEvent` | 30 | `apps/web/src/domain/log.ts` |
| `MatchRoom.sql` | 29 | `adapters/cloudflare/src/match-room.ts` |
| `createLog` | 29 | `apps/web/src/domain/log.ts` |
| `isJoinToken` | 28 | `packages/core/src/join.ts` |
| `replayScore` | 28 | `packages/core/src/reducer.ts` |
| `replay` | 26 | `apps/web/src/domain/log.ts` |

- Direkte Aufrufer: `replayScore` 12 (Worker `MatchRoom`/`room`/`server`, Web `log`/`useLive`, Kern `reducer`), `matchReducer` 11 (`scoreSync`, `log`, `history`, `celebration`, `replayScore`), `appendEvent` 7, `parsePersisted` 1 (`persistence.loadLog`, relevant für P-01).
- Änderungen an `matchReducer`, `replayScore` oder `appendEvent` wirken auf Web und Worker zugleich (codegraph: 52 bzw. 37 Aufrufer inklusive Tests). Dafür gelten Fixtures (ADR-003) und ein ADR bei Format-Änderungen.

**Grosse Dateien (Zeilen):** `apps/web/src/live/useLive.ts` 1351, `adapters/cloudflare/src/match-room.ts` 1267, `apps/web/src/App.tsx` 822, `adapters/cloudflare/src/server.ts` 772. Das sind die Orte mit dem grössten Änderungsrisiko.

**Änderungshäufigkeit (git log, 60 Tage bis aa0c48b, 63 Commits, ohne `pnpm-lock.yaml`):**
- Meist geändert: `SECURITY.md` 35, `apps/web/package.json` 30, `README.md` 20, `CHANGELOG.md` 20, `apps/web/src/app.css` 18, `apps/web/src/App.tsx` 18.
- Code mit dem meisten Wechsel: `apps/web/src/connect.e2e.test.tsx` 17, `apps/web/src/live/useLive.ts` 16, `apps/web/rsbuild.config.ts` 16, `apps/web/src/live/protocol.ts` 13, `adapters/cloudflare/src/match-room.ts` 12, `adapters/cloudflare/src/server.ts` 11, `packages/core/src/index.ts` 10.

**Risiken:**
- Live-Sync (`useLive.ts`, `protocol.ts`, `match-room.ts`) ist zugleich gross und häufig geändert. Änderungen nur mit den Live-Tests und dem Smoke-Test.
- Zwei Parser für dasselbe Log-Format (P-02, ADR-004) und überschreibender Ladefehler (P-01, ADR-001) bleiben offen, siehe STATUS.md.
- Dev-Abhängigkeit picomatch mit befristeter Audit-Ausnahme bis 27.11.2026 (SECURITY.md).
