# STATUS.md – Stand 16.11.2026, Basis main 0b0d6e5 (2.3.9), Branch `chore/cloud-agent-setup`

## Nachtrag 16.11.2026: Cloud-Agent-Setup
Branch `chore/cloud-agent-setup` (Draft-PR, nicht mergen bis Stabschef und Projektinhaber Ja sagen).
- `.cursor/environment.json` und `.cursor/install-dev-tools.sh`: ripgrep 14.1.1, ast-grep 0.51.2, codebase-memory-mcp 0.12.1, Versionen und SHA-256 gepinnt. Bei `pnpm-lock.yaml`: `pnpm install --frozen-lockfile` über corepack mit `packageManager` `pnpm@10.33.4` (Node 22).
- Binaries nur unter `~/.local/bin` (kein `sudo`); PATH setzt das Skript in `~/.profile` und `~/.bashrc`.
- `.cursorignore` für Lockfiles, Build, Index-Ordner. `packages/`, `apps/`, `adapters/` und Fixtures bleiben im Kontext.
- `.codebase-memory/` in `.gitignore` und `.cursorignore`.
- Abschnitt «Cursor Cloud specific instructions» in AGENTS.md ergänzt.

## Aktuelles Ziel
Regressionsschutz: Updates dürfen laufende Matches, gespeicherte Daten und verbundene Handys nicht brechen. Ab 27.11.2026 nur kleine Anpassungen (Reserve-Kontingent).

## Erledigt
- 2.3.9 auf `main` (PR #48, 15.11.2026): Regressionsnetze PC-1 bis PC-7, Smoke-Test nach Deploy, Release-Gate gleicher SHA. Staging-Deploy grün.
- 2.3.8 live: dritter Satz nach 2:0 zählbar, kein Reset beim Mitnehmen der Handys (PR #47, 10.11.2026)
- Architekturprüfung lokal ohne Cloud Agent (15.11.2026), ADR-001 bis ADR-004 (vorgeschlagen) in docs/adr
- Repo-Variable `STAGING_API_URL` gesetzt (15.11.2026)
- Sicherheitsprüfung Review 36 in SECURITY.md (höchstens Low)
- AGENTS.md mit den Arbeitsregeln vom 15./16.11.2026 nachgeführt (PR #49 gemergt, live seit 16.11.2026)

## In Arbeit
- dieser Draft-PR: Cloud-Agent-Setup (nicht mergen bis Stabschef und Projektinhaber Ja sagen).

## Plan ab 27.11.2026
- Majors (Dependabot) erst ab 27.11., je PR mit Sicherheitsprüfung und Stabschef-Prüfung.

## Offene PRs (16.11.2026)
- #40 pnpm/action-setup 4.2.0 → 6.1.1 (Dependabot, Major, CI grün) – wartet bis 27.11.
- #5 actions/configure-pages 5 → 6, #4 actions/upload-pages-artifact 4 → 5, #3 actions/deploy-pages 4.0.5 → 5.0.1 (Dependabot, Majors) – warten bis 27.11.
- dieser Draft-PR: Cloud-Agent-Setup (`chore/cloud-agent-setup`)

## Offen / Entscheide nötig (wer?)
- PC-8 (ADR-001 umsetzen): macht die `it.fails`-Tests grün – Patrick
- ADR-001 bis ADR-004 annehmen? – Patrick
- Required Reviewer auf dem Environment `production` wieder einschalten? Heute nur Branch-Regel. – Patrick
- Eigenes Secret für das Einladungs-Siegel (S-02)? – Patrick

## Bekannte Probleme / Risiken
- P-01: Ladefehler überschreibt lokale Daten (latent, relevant beim nächsten Schema-Bump oder Rollback)
- P-02: zwei Parser für dasselbe Log-Format
- `pnpm audit`: 1 niedriger Fund (deepmerge, nur Build) ohne Patch
- Kein Ruleset auf `main` (keine Pflicht-Checks)

## Genutzte lokale Tools & vermiedene Cloud-Agent-Nutzung
- 15.11.: codebase-memory-mcp (Aufrufer von matchReducer/replayScore/parsePersisted, geschätzt ~40k Token gespart), codegraph explore (Persistenzpfad, Parser-Dopplung entdeckt), gitleaks, pnpm audit, vitest, Playwright lokal (geschätzt 1 Cloud-Agent-Lauf vermieden)
- 16.11. (dieser PR): gh (PRs, Variablen, Environments), `pnpm audit` lokal, rg. Kein Cloud Agent.
- 16.11. (Cloud-Agent-Setup): pnpm-fähiges Install-Skript, lokal lint/typecheck/Unit-Tests/Build, kein Cloud Agent.
