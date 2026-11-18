# AGENTS.md – PadelCounterV2
Stand: Commit aa0c48b (18.11.2026)

## Projekt
- Zweck: Padel-Zähler als Offline-PWA. Mehrere Handys können live dasselbe Match zählen (QR/Code).
- Stack: pnpm-Monorepo. React 19/TS PWA (Rsbuild, Workbox), Cloudflare Worker + Durable Object + D1. Vitest, @cloudflare/vitest-plugin, Playwright.
- Wichtige Ordner:
  - `packages/core` (reine Logik: Regeln, Reducer, Parser, Protokoll)
  - `apps/web/src/domain` (Persistenz, Archiv, Session)
  - `apps/web/src/live` (Live-Sync, QR)
  - `adapters/cloudflare` (Worker, MatchRoom, Migrationen)
- Architektur-Doku: ARCHITECTURE.md, ADRs in docs/adr/, Deploy in docs/DEPLOY.md
- Stand und Plan: STATUS.md

## Befehle (aus package.json und .github/workflows/ci.yml)
- `pnpm install --frozen-lockfile`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test` (inkl. Playwright)
- `pnpm build`
- `pnpm audit --audit-level=moderate` (CI)
- `node adapters/cloudflare/scripts/check-migrations.mjs`
- Smoke lokal: siehe docs/DEPLOY.md Schritt 12
- `actionlint` für Workflow-Änderungen

## Projektregeln
Pflicht-Checks und Regeln:
- core importiert nichts aus react, cloudflare:* oder node:* (ESLint).
- Fixtures in `packages/core/fixtures/compat/` und `packages/core/fixtures/score/` werden **nie geändert**, nur ergänzt.
- Ein Speicherformat- oder Protokollwechsel braucht einen ADR und neue Fixtures.
- D1-Migrationen nur additiv (expand/contract).
- Laufender Betrieb hat Vorrang: Gespeicherte Daten dürfen nie stillschweigend überschrieben werden (ADR-001).
- Production-Deploy nur per `workflow_dispatch` nach grünem Staging (Release-Gate, gleicher SHA).
- PadelCounter V1 (altes Repo) nicht anfassen: gilt für Code und weitere Änderungen weiterhin. Die Doku-Ergänzung vom 16.11.2026 dort (AGENTS/ARCHITECTURE/STATUS) war eine einmalige, vom Projektinhaber angeordnete Ausnahme.
- Sicherheit: SECURITY.md im Wurzelordner.
- Befristete Audit-Ausnahme (18.11.2026): `package.json` enthält unter `pnpm.auditConfig.ignoreGhsas` genau eine ID, GHSA-fc5q-39xc-vjpf (picomatch, nur Entwicklungspfad, kein Patch). Gültig bis einschliesslich 27.11.2026. `.github/scripts/check-audit-exception.sh` (CI-Schritt «Check audit exception expiry») schlägt fehl, wenn eine andere GHSA-ID eingetragen ist oder die Ausnahme ab 28.11.2026 noch drin steht. Keine weiteren Ausnahmen ohne ausdrückliches Ok des Projektinhabers und Prüfung durch Stabschef. Begründung und Plan: SECURITY.md.
- Diese Datei, STATUS.md und ARCHITECTURE.md nach jedem Merge auf `main` mit dem neuen Commit nachführen.

## Arbeitsregeln für Agents

### Vor dem Start
- Vor jedem Cloud-Agent-Start AGENTS.md, ARCHITECTURE.md und STATUS.md lesen. Sie müssen aktuell sein. Fehlt etwas oder ist es unklar: zuerst konkret nachfragen, keinen Cloud Agent starten.
- Zuerst lokal arbeiten, mit den lokalen Tools. Für neue Features oder grössere Umbauten zuerst einen klickbaren Prototyp und eine klare Spezifikation, erst dann einen Cloud Agent.
- Kontext schlank halten: Struktur-Fragen mit den Tools unten beantworten statt ganze Dateien zu lesen. STATUS.md nach jedem Arbeitspaket nachführen.
- Pro grösserem Paket in STATUS.md festhalten: welche lokalen Tools genutzt wurden, wie viel Cloud-Agent-Nutzung das vermieden hat, Rückmeldung zu den Tools.
- Keine Werte erfinden. Was nicht belegt ist, steht als «offen» da.

### Lokale Tools (gemeinsamer Rechner, Anleitung `dev-tools/README.md`)
- codebase-memory-mcp, Standard für «wer ruft X»: `cbm index <pfad>`, dann `cbm callers <projekt> <Symbol> 2`, `cbm get_architecture '{"project":"<projekt>"}'`
- codegraph, wenn Code und Aufrufpfade gebraucht werden: `codegraph explore "<Frage>"`
- Serena für exakte Referenzen (nur eigene Repos): `serena-repl . 's.lsp.find_referencing_symbols("<Symbol>","<Datei>")'`
- ast-grep für Muster: `ast-grep run -p '<Muster>' -l tsx src`
- `rg` für einfache Zeilensuchen
- Graphify: für GitHub-Repos den Connector. Die lokale CLI nur für ungepushten Code und immer mit `--code-only` bzw. `--no-label`, sonst ruft sie ein LLM auf (Kosten, Code verlässt den Rechner).
- Index-Ordner `.codegraph/`, `graphify-out/` und `.serena/` nie committen, sie stehen in `.gitignore`.

### Sicherheit (Dauerregel)
- Nach jeder Code-Erstellung oder -Änderung eine detaillierte Sicherheitsprüfung: Eingabevalidierung, Injection, Geheimnisse und Zugangsdaten, Berechtigungen, Abhängigkeiten inklusive indirekter, CDN und GitHub Actions auf bekannte Schwachstellen, Fehlermeldungen mit sensiblen Daten, Angriffsflächen. Ergebnis mit Schweregrad und Fix-Vorschlag im PR.
- Verwundbare Libraries auf die nächste sichere Version heben. Bei einem grossen oder brechenden Sprung (Major) vorher den Projektinhaber fragen.
- Updates und offene Risiken in SECURITY.md nachführen.
- Keine Geheimnisse und keine personenbezogenen Daten ins Repo (das Repo ist öffentlich).

### Prüfung und Merge
- Jede Code-Änderung, jeder Merge und jedes Update (auch grüne Dependabot-PRs) wird von Stabschef unabhängig geprüft (Entscheid des Projektinhabers, 16.11.2026).
- Vor jedem Merge oder Push auf `main` den Head-SHA an Stabschef geben und auf das Ok warten. Merge nur mit ausdrücklichem Ok des Projektinhabers.
- Keine bezahlten Dienste und kein On-Demand ohne Ja des Projektinhabers.
- Merge immer als Squash-Merge mit `--match-head-commit <SHA>`. Autor und Committer nur mit der GitHub-noreply-Adresse des Repo-Kontos.

## Cursor Cloud specific instructions

Cloud Agents starten in einer eigenen Ubuntu-VM, ohne den gemeinsamen Rechner. Diese Hinweise gelten nur dort.

### Zuerst lesen
- AGENTS.md, ARCHITECTURE.md und STATUS.md, in dieser Reihenfolge.
- Sind sie unklar oder nicht aktuell: konkret nachfragen, nicht raten.

### Werkzeuge in dieser Umgebung
Das Install-Skript `.cursor/install-dev-tools.sh` legt im Build bereit:
- `rg` (ripgrep 14.1.1) für Zeilensuche
- `ast-grep` (0.51.2) für strukturelle Suche; auf Linux den Befehl `ast-grep` nutzen, nicht `sg`
- `codebase-memory-mcp` (0.12.1) für Aufrufer, Impact und Architektur. Der Index liegt unter `~/.cache/codebase-memory-mcp/` und wird im Build erzeugt.

Die Binaries liegen nur unter `~/.local/bin` (kein Kopieren nach `/usr/local/bin`, kein `sudo`). Das Skript hängt `~/.local/bin` an PATH in `~/.profile` und `~/.bashrc`. Fehlt ein Befehl in einer Sitzung: `export PATH="$HOME/.local/bin:$PATH"`. `environment.json` setzt PATH nicht selbst: das offizielle Schema erlaubt kein `env`-Feld.

Weitere Tools können später im selben Skript ergänzt werden (Version und SHA-256 pinnen, kein `curl|bash`).

Abhängigkeiten: das Skript erkennt `package-lock.json` (`npm ci --ignore-scripts`) oder `pnpm-lock.yaml` (`pnpm install --frozen-lockfile`, pnpm über corepack mit der in `packageManager` gepinnten Version). Node muss die `engines` in `package.json` erfüllen (typisch >= 22); das Skript installiert Node nicht.

### Reihenfolge bei Struktur-Fragen
1. STATUS.md und ARCHITECTURE.md.
2. Index-Tool, bevor ganze Dateien gelesen werden:
   - `codebase-memory-mcp cli --quiet list_projects '{}'`
   - `codebase-memory-mcp cli --quiet trace_path '{"project":"<name>","function_name":"<Symbol>","direction":"inbound","depth":2}'`
   - `codebase-memory-mcp cli --quiet get_architecture '{"project":"<name>"}'`
3. `ast-grep` oder `rg` für Muster und exakte Zeichenketten.
4. Dateien nur gezielt lesen.

### Graphify-MCP (gehostet, falls verbunden)
Wenn unter cursor.com/agents ein HTTP-MCP namens `graphify` auf `https://api.graphify.com/mcp` eingerichtet und per OAuth angemeldet ist, den Graphen für Aufrufer, Impact und Tests nutzen (`list_repositories`, `graphify_find`, `graphify_callers`, `graphify_impact`). Der gehostete Graph zeigt den indexierten GitHub-Stand, keine uncommitteten lokalen Änderungen. Fehlt die Verbindung oder weicht der Stand ab: `codebase-memory-mcp` in dieser VM verwenden.

Nicht `codebase-memory-mcp install` oder `update` ausführen (ändert Agent-Konfigurationen oder lädt Binaries). Index-Ordner `.codegraph/`, `graphify-out/`, `.serena/` und `.codebase-memory/` nicht committen (stehen in `.gitignore` und `.cursorignore`).
