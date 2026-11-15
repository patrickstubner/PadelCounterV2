# STATUS.md – Stand 15.11.2026, Commit 85f24e4
## Aktuelles Ziel
Regressionsschutz: Updates dürfen laufende Matches, gespeicherte Daten und verbundene Handys nicht brechen.
## Erledigt
- 2.3.8 live: Dritter Satz nach 2:0 zählbar, Neues Match beim Verbinden (PR #47, 10.11.2026)
- Architekturprüfung lokal ohne Cloud Agent (15.11.2026, /workspace/padelcounterv2-architektur)
## In Arbeit
- (keins) – nächster Schritt: PC-1 bis PC-7 (Doku, Fixtures, Golden-Sequenzen, Smoke/Gate), nur mit Patricks Ja
## Offen / Entscheide nötig (wer?)
- ADR-001 bis ADR-004 annehmen? – wartet auf Patrick
- Required Reviewer auf `production` wieder einschalten? – Patrick
- Eigenes Secret für Einladungs-Siegel (S-02)? – Patrick
## Bekannte Probleme / Risiken
- P-01: Ladefehler überschreibt lokale Daten (latent, relevant beim nächsten Schema-Bump oder Rollback)
- P-02: Zwei Parser für dasselbe Log-Format
- P-03: Prod nicht an grünes Staging + Smoke gebunden
- deepmerge (low, nur Build) ohne Patch
## Genutzte lokale Tools & vermiedene Cloud-Agent-Nutzung
- codebase-memory-mcp: Aufrufer von matchReducer/replayScore/parsePersisted, geschätzt ~40k Token gespart
- codegraph explore: Persistenzpfad inkl. Blast-Radius, dabei die Parser-Dopplung entdeckt
- gitleaks, pnpm audit, vitest, Playwright lokal: geschätzt 1 Cloud-Agent-Lauf vermieden
