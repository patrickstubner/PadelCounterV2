# STATUS.md – Stand 27.11.2026, Branch `chore/pages-actions-majors`, Basis main 12ae3f8

## Nachtrag 27.11.2026: Pages-Actions-Majors
Branch `chore/pages-actions-majors` (Basis main 12ae3f8, nicht mergen bis Stabschef-Ok für genau den Head und Ja des Projektinhabers). Ersetzt die Dependabot-PRs #3, #4 und #5; diese bleiben offen, bis der gebündelte PR gemergt ist. Kein App-Code, kein Versionsbump, kein Cloud Agent, kein Production-Deploy.
- `actions/configure-pages` 5.0.0 → 6.0.0 (`45bfe0192ca1faeb007ade9deae92b16b8254a0d`), `actions/upload-pages-artifact` 4.0.0 → 5.0.0 (`fc324d3547104276b827a68afc52ff2a11cc49c9`), `actions/deploy-pages` 4.0.5 → 5.0.1 (`368f82528645a54fb793d4d04e342629a3f51346`). SHAs gegen die Release-Tags geprüft, keine neueren Versionen vorhanden. Pin in `adapters/cloudflare/src/deploy.test.ts` angepasst (das war der Grund, warum #3 in der CI rot war).
- Breaking Changes: `configure-pages` v6 und `deploy-pages` v5 nutzen die Node-24-Action-Laufzeit; `upload-pages-artifact` v5 pinnt transitiv `actions/upload-artifact` v7.0.0 (`bbbca2ddaa5d8feaa63e36b76fdaad77386f024f`). Der App-Build bleibt auf Node 22. Rechte im Pages-Job unverändert (`contents: read`, `pages: write`, `id-token: write`). Der Pages-Deploy-Job läuft nur per `workflow_dispatch` auf `main` (nach Production-Gate und `DEPLOY_PAGES=true`); die CI führt ihn nicht aus.
- Lokal (ohne Playwright-E2E, Port 4173 war durch ein anderes Projekt belegt): `pnpm lint`, `pnpm typecheck`, Unit-Tests (core 95, adapters 91 und 79, web 392 plus 3 erwartete Fehlschläge, `deploy.test.ts` 3/3), `pnpm build` und `pnpm audit --audit-level=moderate` (0 Funde) grün. Die befristete Ausnahme GHSA-fc5q-39xc-vjpf gilt noch bis einschliesslich 27.11.2026.

Production läuft unverändert auf Commit bc78fc3 (2.3.9, Deploy per `workflow_dispatch` am 15.11.2026). Seitdem nur Werkzeug, Doku und Abhängigkeiten, kein Nutzer-Effekt.


## Nachtrag 22.11.2026 (Nachmittag): pnpm-Prüfung
Branch `chore/pnpm-audit-fix` (Draft-PR, Basis main 599e9dd, nicht mergen bis Stabschef-Ok und Ja des Projektinhabers). Nur Doku, kein App-Code, kein Cloud Agent.
- Das Repo nutzt schon pnpm 10.33.4 (`packageManager`, `pnpm-lock.yaml`, CI mit `pnpm install --frozen-lockfile`). Nichts umgestellt.
- Geprüft lokal: `pnpm install --frozen-lockfile`, `pnpm audit` (0 Funde), Lint, Typecheck, Tests (core 95, adapters 91 und 79, web 392), Build grün.
- `AGENTS.md`: Regel «nur pnpm» (kein npm/yarn, kein `shamefully-hoist`; Install-Skripte nur für `onlyBuiltDependencies`), Verweise auf `npm audit`/`npm test` korrigiert. `README.md`: `corepack enable` und `--frozen-lockfile` im Start.
- Ausnahme `GHSA-fc5q-39xc-vjpf` in `pnpm.auditConfig` gilt weiter bis 27.11.2026 (Prüfskript `check-audit-exception.sh`).
- Mindestalter neuer Paketversionen 4 Tage: `pnpm-workspace.yaml` mit `minimumReleaseAge: 5760`, Regel in `AGENTS.md` und Sicherheitsnotiz, Dependabot-`cooldown` (mindestens 4 Tage). Lockfile geprüft: alle Pakete älter als 4 Tage (jüngstes: @cloudflare/workers-types 5.20261114.1, 8,6 Tage). **Übergangsausnahmen in `minimumReleaseAgeExclude` (Kommentar «Übergang Einführung 4-Tage-Regel, entfernen ab 26.11.2026»): keine, weil kein bestehendes Paket jünger als 4 Tage ist.** Sicherheits-Ausnahmen: keine nötig.

## Nachtrag 22.11.2026 (Abend): Korrekturen nach Stabschef-Prüfung
Commit `f07aa9b`. Nur Doku, kein App-Code, kein Cloud Agent.
- Abschnitt «Zusammenarbeit mehrerer Agents»: vor dem Merge geht der Head-SHA an Stabschef, auf dessen Ok warten, Merge erst nach dem Ja des Projektinhabers.
- Vornamen in `AGENTS.md` und `README.md` durch «Projektinhaber» bzw. «project owner» ersetzt.

## Nachtrag 22.11.2026: Vorbereitung für lokale Arbeit mit Google Antigravity
Branch `docs/antigravity-setup` (PR offen, nicht mergen bis Stabschef-Ok und Ja des Projektinhabers). Nur Doku und `.gitignore`, kein App-Code, kein Cloud Agent. `.cursor/`, `.cursorignore` und `package.json` (inklusive der befristeten Audit-Ausnahme) unverändert.
- `AGENTS.md`: neuer Abschnitt «Zusammenarbeit mehrerer Agents» (ein Branch pro Aufgabe und Agent, nur PRs, Sicherheitsprüfung nach jeder Änderung, STATUS.md mit Commit, keine Secrets, keine Kosten ohne Ja, empfohlene lokale MCP-Server). Antigravity liest `AGENTS.md` automatisch; keine zweite Regel-Datei. Der Abschnitt «Projektregeln» (Fixtures, Migrationen, Release-Gate) gilt unverändert auch für Antigravity.
- `README.md` (englisch): kurzer Absatz «Working with agents». Der lokale Start (`pnpm install`, `pnpm dev`, `pnpm dev:worker` mit `.dev.vars`) stand schon dort. `.gitignore`: `.agents/mcp_config.json` (`.dev.vars` war schon ignoriert).
- Stand `pnpm audit --audit-level=moderate` (22.11.2026): keine Funde. Die Ausnahme GHSA-fc5q-39xc-vjpf gilt bis 27.11.2026 und ist unverändert.

## Nachtrag 20.11.2026: MCP-Allowlist für Cloud-Agent-Umgebung
Branch `chore/mcp-allowlist` (Draft-PR, Basis main 95ce243, nicht mergen bis Stabschef-Ok und Ja des Projektinhabers). Kein Versionsbump.
- `.cursor/environment.json`: neu `mcpServerAllowlist` mit genau einem Eintrag, dem gehosteten Graphify-MCP (`https://api.graphify.com/mcp`). Alle anderen User- und Team-MCP-Server sind für Agents dieser Umgebung gesperrt, Cursor-eigene MCP-Server nicht. Feldnamen laut https://cursor.com/schemas/environment.schema.json; die Datei wurde gegen das Schema geprüft.
- AGENTS.md (Cloud-Abschnitt): Regel «MCP-Liste schlank halten; Serena nur nach positivem lokalem Test, dann ersetzt es codebase-memory-mcp».
- Die Datei wirkt nur, wenn «environment.json location» der Umgebung auf cursor.com auf dieses Repo zeigt. Sonst gleichen Eintrag im Dashboard von Hand setzen (Abschnitt «MCP servers» der Umgebung). Ungetestet: kein Cloud Agent gestartet (Kontingent bis 27.11.2026 erschöpft).

Production läuft auf Commit bc78fc3 (2.3.9, Deploy per `workflow_dispatch` am 15.11.2026). Seither ist nur Werkzeug, Doku und Abhängigkeiten geändert worden, kein Nutzer-Effekt. Production wurde am 18.11.2026 nicht deployt.

## Aktuelles Ziel
Regressionsschutz: Updates dürfen laufende Matches, gespeicherte Daten und verbundene Handys nicht brechen. Ab 27.11.2026 nur kleine Anpassungen (Reserve-Kontingent).

## Erledigt
- 18.11.2026, gemergt in dieser Reihenfolge (jeweils Squash, Stabschef-Prüfung auf genau den Head-SHA):
  - #53 `@cloudflare/workers-types` 5.20261107.1 → 5.20261114.1 → 504ca4e
  - #56 befristete Audit-Ausnahme GHSA-fc5q-39xc-vjpf (picomatch, nur Entwicklung, kein Patch) → da6c6db. Gültig bis 27.11.2026, ab 28.11.2026 schlägt die CI fehl (siehe SECURITY.md).
  - #55 `@rsbuild/core` 2.3.0 → 2.3.2 → 4e8805a
  - #52 `@cloudflare/vitest-plugin` 1.6.0 → 1.8.2 → 9b976dc
  - #54 `eslint` 10.14.0 → 10.15.0 → d8a2500
  - #51 `wrangler` 4.153.0 → 4.162.0 → aa0c48b
- Nach den Merges: Staging-Deploy und Smoke-Test grün (`/health` 200 mit `protocol=2`, WebSocket ohne Token 426/401). CI auf main grün inklusive Audit.
- 16.11.2026: Cloud-Agent-Umgebung mit lokalen Index-Tools (PR #50, `.cursor/`, `.cursorignore`) und AGENTS.md/ARCHITECTURE.md/STATUS.md mit den Arbeitsregeln vom 15./16.11. (PR #49) gemergt.
- 2.3.9 (PR #48, 15.11.2026): Regressionsnetze PC-1 bis PC-7, Smoke-Test nach Deploy, Release-Gate gleicher SHA. Live seit 15.11.2026.
- Architekturprüfung lokal ohne Cloud Agent (15.11.2026), ADR-001 bis ADR-004 (vorgeschlagen) in `docs/adr`.
- Repo-Variable `STAGING_API_URL` gesetzt (15.11.2026).
- Sicherheitsprüfungen Review 36 und 37 in SECURITY.md (höchstens Low), Eintrag zur Audit-Ausnahme vom 18.11.2026.

## In Arbeit
- Pages-Actions-Majors, Branch `chore/pages-actions-majors` (ersetzt #3, #4, #5; nicht mergen bis Stabschef-Ok).

## Plan ab 27.11.2026
- Audit-Fix am 27.11.2026: `ignoreGhsas` in `package.json` entfernen, sobald eine picomatch-Version mit Fix vorliegt. Eine Verlängerung der Ausnahme braucht eine neue ausdrückliche Freigabe des Projektinhabers.
- Verbesserungen am Ablauf-Skript `.github/scripts/check-audit-exception.sh` (nicht blockierend, Hinweis von Stabschef):
  - auch `pnpm-workspace.yaml` prüfen (pnpm 10 liest `auditConfig` dort ebenfalls, eine Ausnahme dort würde heute nicht erkannt)
  - GHSA-IDs ohne Beachtung der Gross-/Kleinschreibung erkennen (`grep -i`)
- Majors (Dependabot) ab 27.11., je PR mit Sicherheitsprüfung und Stabschef-Prüfung. Pages-Actions sind im Branch `chore/pages-actions-majors` gebündelt.

## Offene PRs (27.11.2026)
- Branch `chore/pages-actions-majors`: bündelt `configure-pages` v6, `upload-pages-artifact` v5 und `deploy-pages` v5.0.1 (ersetzt #3, #4, #5). #3, #4 und #5 bleiben offen, bis dieser PR gemergt ist.
- #3, #4, #5 (Dependabot, einzeln): durch den gebündelten Branch überholt, noch nicht schliessen.

## Offen / Entscheide nötig (wer?)
- PC-8 (ADR-001 umsetzen): macht die `it.fails`-Tests grün (4 Stück in `apps/web/src/domain/compat.test.ts`) – Projektinhaber
- ADR-001 bis ADR-004 annehmen? Alle stehen noch auf «vorgeschlagen». – Projektinhaber
- Required Reviewer auf dem Environment `production` wieder einschalten? Heute nur Branch-Regel. – Projektinhaber
- Eigenes Secret für das Einladungs-Siegel (S-02)? – Projektinhaber

## Bekannte Probleme / Risiken
- P-01: Ladefehler überschreibt lokale Daten (latent, relevant beim nächsten Schema-Bump oder Rollback)
- P-02: zwei Parser für dasselbe Log-Format
- `pnpm audit` (18.11.2026, lokal): kein offener Fund ausser der befristet ignorierten picomatch-Meldung GHSA-fc5q-39xc-vjpf (hoch, nur Entwicklungspfad `typescript-eslint` > `typescript-estree` > `tinyglobby` > `picomatch`, kein Patch). Der frühere Low-Fund in `deepmerge` taucht nicht mehr auf.
- Kein aktives Ruleset auf `main` (Ruleset `ProtectedBranch` ist deaktiviert, keine Pflicht-Checks). Geprüft am 18.11.2026 mit `gh`.

## Genutzte lokale Tools & vermiedene Cloud-Agent-Nutzung
- 15.11.: codebase-memory-mcp (Aufrufer von matchReducer/replayScore/parsePersisted, geschätzt ~40k Token gespart), codegraph explore (Persistenzpfad, Parser-Dopplung entdeckt), gitleaks, pnpm audit, vitest, Playwright lokal (geschätzt 1 Cloud-Agent-Lauf vermieden)
- 16.11.: gh (PRs, Variablen, Environments), `pnpm audit` lokal, rg. Cloud-Agent-Setup mit pnpm-fähigem Install-Skript, lokal lint/typecheck/Unit-Tests/Build. Kein Cloud Agent.
- 18.11.: Dependabot-PRs und Audit-Ausnahme mit gh und `pnpm audit` lokal geprüft. Dieser Doku-PR: codebase-memory-mcp 0.12.1 und codegraph 1.6.2 für die Analyse in ARCHITECTURE.md (Basis aa0c48b), gitleaks, rg, git log. Kein Cloud Agent.
- 25.11.: Dependabot-Minors/Patches #62, #61, #63–#70 und Major #40 (`pnpm/action-setup` 6.1.1) auf main gemergt (letzter Stand 12ae3f8).
- 27.11.: Pages-Actions-Majors lokal mit gh (Release-Tags und SHAs), actionlint, `pnpm lint`/`typecheck`/`test`/`build`/`audit`, gitleaks, rg. Kein Cloud Agent.
