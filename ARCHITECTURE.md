# ARCHITECTURE.md – PadelCounterV2 (Stand 16.11.2026, Commit bc78fc3, Version 2.3.9)

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
- **PR/Push:** Die CI führt Lint, Typecheck, vitest, Playwright, Build/Dry-run und Audit aus.
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
