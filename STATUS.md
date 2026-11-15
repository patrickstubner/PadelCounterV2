# STATUS.md – Stand 15.11.2026, Basis 85f24e4, Branch chore/regressionsnetze (lokal)
## Aktuelles Ziel
Regressionsschutz: Updates dürfen laufende Matches, gespeicherte Daten und verbundene Handys nicht brechen.
## Erledigt
- 2.3.8 live: Dritter Satz nach 2:0 zählbar, Neues Match beim Verbinden (PR #47, 10.11.2026)
- Architekturprüfung lokal ohne Cloud Agent (15.11.2026, /workspace/padelcounterv2-architektur)
- PC-1 Doku, ADR-001..004 (vorgeschlagen) in docs/adr, Index-Ordner in .gitignore
- PC-2 Speicher-Fixtures (Log v1/v2, Archiv v1) in packages/core/fixtures/compat, Soll ADR-001 als it.fails
- PC-3 Score-Golden-Sequenzen, Property-Tests, Parser-Parität web/core
- PC-4 version.json-Protokoll aus LIVE_PROTOCOL, verify-build prüft
- PC-5 Migrations-Test auf leerer D1, Lint «kein DROP/RENAME ohne ADR»
- PC-6 Smoke-Test nach Staging, Prod-Worker und Pages (lokal gegen wrangler dev grün)
- PC-7 Release-Gate gleicher SHA, Rollback-Abschnitt in docs/DEPLOY.md
- Sicherheitsprüfung Review 36 in SECURITY.md (höchstens Low)
## In Arbeit
- Branch `chore/regressionsnetze` lokal, nicht gepusht. Nächster Schritt: Patricks Ja zu Push und PR, vorher `vars.STAGING_API_URL` setzen
## Offen / Entscheide nötig (wer?)
- Repo-Variable `STAGING_API_URL` setzen, sonst bleibt das Prod-Gate zu – Patrick
- PC-8 (ADR-001 umsetzen): macht die 3 it.fails-Tests grün – Patrick
- ADR-001 bis ADR-004 annehmen? – wartet auf Patrick
- Required Reviewer auf `production` wieder einschalten? – Patrick
- Eigenes Secret für Einladungs-Siegel (S-02)? – Patrick
## Bekannte Probleme / Risiken
- P-01: Ladefehler überschreibt lokale Daten (latent, relevant beim nächsten Schema-Bump oder Rollback)
- P-02: Zwei Parser für dasselbe Log-Format
- P-03: Prod-Gate und Smoke vorbereitet (PC-6/7), wirksam erst nach Merge und mit `vars.STAGING_API_URL`
- deepmerge (low, nur Build) ohne Patch
## Genutzte lokale Tools & vermiedene Cloud-Agent-Nutzung
- codebase-memory-mcp: Aufrufer von matchReducer/replayScore/parsePersisted, geschätzt ~40k Token gespart
- codegraph explore: Persistenzpfad inkl. Blast-Radius, dabei die Parser-Dopplung entdeckt
- gitleaks, pnpm audit, vitest, Playwright lokal: geschätzt 1 Cloud-Agent-Lauf vermieden
