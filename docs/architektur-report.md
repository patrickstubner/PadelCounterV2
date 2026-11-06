<cursor_untrusted_data_1337 source="ReadCanvas">

Canvas "Padel Counter v2 – Architektur-Report" (https://cursor.com/canvas/store-894cd74a-3bdf-4577-bfce-11ab7c1f6cc0/694cc45b-203f-4c37-b9d4-3dcc211b72a3):

import { Page, Section, Text, Callout, Table, Diagram, Steps, NumberedList, Properties, ProsCons, LinkCards, TableOfContents, Rows } from "grok/canvas";

export default function App() {
  return (
    <Page
      width="wide"
      title="Padel Counter v2 – Architektur-Report"
      summary="Empfehlung: Frontend bleibt auf GitHub Pages, Backend als Cloudflare Worker mit einem Durable Object (SQLite) pro Match, Sync über WebSockets und ein Event-Log. Alles im Free-Plan, Backend in TypeScript. Login zum Start: Google, Facebook, GitHub und Passkeys; erste Version = Funktionsumfang von v1 ohne Undo plus Live-Sync und ‹Mitspieler verbinden›."
    >
      <TableOfContents
        items={[
          { label: "Entscheide 23.10.2026", id: "entscheide" },
          { label: "Empfehlung", id: "empf" },
          { label: "Umfang erste Version", id: "umfang" },
          { label: "Vergleich der Anbieter", id: "vgl" },
          { label: "Architektur", id: "arch" },
          { label: "Datenmodell", id: "dm" },
          { label: "Spielregeln (Padel)", id: "regeln" },
          { label: "Regel-FAQ in der App", id: "faq" },
          { label: "Sync- und Konfliktstrategie", id: "sync" },
          { label: "QR-Join und Berechtigungen", id: "qr" },
          { label: "Login-Flow", id: "login" },
          { label: "Sicherheit", id: "sec" },
          { label: "Datenschutz", id: "datenschutz" },
          { label: "Free-Tier-Limits", id: "limits" },
          { label: "Umsetzungsplan", id: "plan" },
          { label: "Softwarearchitektur: Core + Adapter", id: "core" },
          { label: "Repository, Build und Deployment", id: "repo" },
          { label: "Aufbau- und Einführungsplan v2", id: "einfuehrung" },
          { label: "Offene Fragen", id: "fragen" },
          { label: "Quellen", id: "quellen" },
        ]}
      />

      <Section heading="Entscheide 23.10.2026" id="entscheide" caption="Patricks Entscheide vom 23.10.2026; alle Abschnitte sind angepasst.">
        <Table
          columns={["Thema", "Entscheid"]}
          rows={[
            ["Instagram-Login", "Gestrichen (API nur für Business-/Creator-Konten)"],
            ["X-Login", "Gestrichen (kein Gratis-Tarif)"],
            ["E-Mail/Passwort", "Verschoben. Start nur mit Google, Facebook, GitHub und Passkeys – keine eigene Domain nötig"],
            ["Match löschen", "Owner jederzeit; Patrick als Admin jedes Match (serverseitige Admin-Liste); Mitspieler und Zuschauer nie"],
            ["Umfang erste Version", "Funktionsumfang von v1 ohne Undo, plus Menüpunkt ‹Mitspieler verbinden› (QR-Code Spieler oder Zuschauer)"],
            ["Spielformat", "Irrelevant, nur Games werden gezählt; keine Punktezählung und keine Einstellung für Vorteil, Golden Point oder Star Point. Satz- und Tiebreak-Regeln auf Game-Ebene bleiben"],
            ["Datenschutz", "Schlanker Abschnitt ergänzt"],
            ["Design", "Wie v1; einzig im Hochformat etwas breitere Plus- und Minus-Buttons"],
            ["Subdomain", "Worker `padel-counter` → `padel-counter.<account>.workers.dev`"],
            ["Nachtrag 24.10.2026: Aus meiner History entfernen", "Spieler und Owner können ein Match aus der eigenen History ausblenden (pro Benutzer, löscht nichts, wieder einblendbar). Echtes Löschen bleibt bei Owner und Admin"],
          ]}
        />
      </Section>

      <Section heading="Empfehlung" id="empf">
        <Callout lead="Cloudflare Workers + Durable Objects (SQLite) + D1, Backend in TypeScript.">
          Jedes Match ist genau ein Durable Object: es hält die WebSockets aller Handys, speichert jedes Event sofort in seiner eigenen SQLite-DB und verteilt es live. Keine Pausierung, kein Kaltstart von Minuten, CHF 0 ohne Kreditkarte. Fallback: Supabase (Postgres, Auth, Realtime) – mit dem Risiko der Pausierung nach 1 Woche Inaktivität.
        </Callout>
        <ProsCons
          prosHeading="Warum Cloudflare"
          consHeading="Was man in Kauf nimmt"
          pros={[
            "Free-Plan offiziell mit SQLite-Durable-Objects, 100'000 Requests/Tag, 5 GB Speicher",
            "Ein Match = ein Objekt = natürliche Serialisierung aller Edits (keine Race Conditions)",
            "WebSocket Hibernation: idle Verbindungen kosten keine Dauer; eingehende WS-Nachrichten zählen 20:1",
            "Läuft am Edge nahe Zürich – Latenz typischerweise tief (nicht gemessen)",
            "Bei Überschreitung im Free-Plan: Fehler statt Rechnung – also nie Kosten",
            "TypeScript wie im Frontend; Typen für Events teilbar",
          ]}
          cons={[
            "Kein eingebautes Auth – OAuth für Google, GitHub, Facebook und Passkeys selbst bauen, ein generisches Modul im Worker",
            "Vendor Lock-in bei Durable Objects (Konzept, nicht API-kompatibel woanders)",
            "Worker-Free: 10 ms CPU pro Aufruf – genügt für Zähler, aber kein schwerer Code",
            "Rust via workers-rs möglich, aber Durable-Object-Support und Doku dünner; nicht für v2 empfohlen",
          ]}
        />
        <Text>Entschieden: Backend in TypeScript (final). Rust bleibt allenfalls ein späteres, isoliertes Lernprojekt.</Text>
      </Section>

      <Section heading="Umfang erste Version" id="umfang">
        <Properties
          items={[
            { label: "Aus v1 übernommen", value: "Games pro Team zählen (Plus/Minus), Flip-Animation, Teamnamen bearbeiten, Querformat mit 3 Sätzen und Hochformat mit gross dargestelltem aktuellem Satz, Satzwahl, Aufschlag-Anzeige, Match beenden/fortsetzen, neues Match, Sieger-Anzeige, Verlauf/Archiv, Offline-Betrieb als PWA mit Update-Hinweis" },
            { label: "Weggelassen", value: "Undo (Korrektur nur per Gegenaktion)" },
            { label: "Neu", value: "Login (Google, Facebook, GitHub, Passkey), Live-Sync, Menüpunkt ‹Mitspieler verbinden›: zeigt kurz einen QR-Code, umschaltbar Spieler (darf zählen) oder Zuschauer (nur ansehen), Match löschen für Owner/Admin, ‹Aus meiner History entfernen› für Spieler und Owner mit Ansicht ‹Ausgeblendete Matches› zum Wiederherstellen, Hinweis ‹Doppelt gezählt?›" },
            { label: "Design", value: "Unverändert wie v1. Einzige Änderung: im Hochformat etwas breitere Plus- und Minus-Buttons" },
            { label: "Später", value: "Regel-FAQ, Regel-Einstellungen pro Match (Mini-Set, Super-Tiebreak), E-Mail/Passwort, weitere Adapter. In der ersten Version gelten fest die Regeln von v1 (6 Games, Tiebreak bei 6:6, Best of 3, Zusatzsatz möglich)" },
          ]}
        />
      </Section>

      <Section heading="Vergleich der Anbieter" id="vgl" caption="Stand 23.10.2026, Werte von den offiziellen Preisseiten. ‹nicht verifiziert› = nicht auf der offiziellen Seite bestätigt.">
        <Table
          columns={["Option", "Kosten", "Realtime", "Offline", "Auth", "Pausierung / Kaltstart", "Lock-in", "Backend-Sprache"]}
          rows={[
            ["Cloudflare Workers + DO + D1", { text: "Free", tone: "success" }, "Eigene WebSockets im DO, sehr tief", "Selbst bauen (Event-Log, IndexedDB)", "Selbst bauen (OAuth)", { text: "Keine Pause; DO-Start ms", tone: "success" }, "Mittel–hoch", "TS/JS, Rust (workers-rs), Python"],
            ["Supabase Free", { text: "Free, 2 Projekte", tone: "success" }, "Realtime: 200 Verbindungen, 2 Mio. Nachrichten/Monat", "Kein Offline-Sync eingebaut", "Social OAuth inklusive, 50'000 MAU", { text: "Pausiert nach 1 Woche Inaktivität", tone: "warning" }, "Tief (Postgres)", "SQL, Edge Functions in TS"],
            ["Firebase Spark", { text: "Free", tone: "success" }, "Firestore Listener, gut", { text: "Eingebaute Offline-Persistenz", tone: "success" }, "Google, GitHub, Facebook, Apple u. a.", "Keine Pause", "Hoch", "Keine (Cloud Functions im Spark-Plan nicht verfügbar, verifiziert)"],
            ["Convex Free", { text: "Free, 1 Mio. Function Calls", tone: "success" }, "Reaktive Queries, gut", "Begrenzt, nicht verifiziert", "Convex Auth / OAuth", "Nicht verifiziert", "Mittel (Open Source)", "TypeScript"],
            ["InstantDB", { text: "Neue Anmeldungen geschlossen", tone: "danger" }, "Gut", "Offline-first", "Ja", "Cloud endet 31.08.2027", "–", "TS"],
            ["Turso Free (+ eigener Server)", { text: "Free DB", tone: "success" }, "Keine Realtime-Pushes, nicht verifiziert", "Embedded Replicas/Sync", "Keine", "–", "Tief (SQLite)", "Beliebig"],
            ["PocketBase auf Free-Host", { text: "Unsicher", tone: "warning" }, "SSE Realtime", "Selbst bauen", "OAuth2 eingebaut", "Free-Hosts schlafen oft ein, nicht verifiziert", "Tief", "Go (Erweiterung JS/Go)"],
          ]}
        />
        <Text>Firebase ist der stärkste Gegenkandidat wegen der eingebauten Offline-Persistenz, aber Konflikte löst Firestore per last-write-wins pro Feld – für einen Zähler mit mehreren Handys ist das falsch, man müsste trotzdem ein Event-Log modellieren. InstantDB fällt weg (Team zu OpenAI, Cloud wird abgeschaltet), Turso gehört künftig zu Supabase.</Text>
      </Section>

      <Section heading="Architektur" id="arch">
        <Diagram
          direction="horizontal"
          nodes={[
            { id: "a", label: "Handy A", detail: "React-App, IndexedDB-Outbox", kind: "person" },
            { id: "b", label: "Handy B", detail: "React-App, IndexedDB-Outbox", kind: "person" },
            { id: "gh", label: "GitHub Pages", detail: "Statisches Frontend + Service Worker", kind: "terminal" },
            { id: "w", label: "Worker (API)", detail: "/auth, /matches, WS-Upgrade, Rate Limit" },
            { id: "do", label: "Durable Object pro Match", detail: "WebSockets, SQLite: Events, Teilnehmer" },
            { id: "d1", label: "D1", detail: "Users, Match-Index" },
            { id: "g", label: "Google / GitHub OAuth", kind: "terminal" },
          ]}
          edges={[
            { from: "gh", to: "a", label: "lädt App", dashed: true },
            { from: "gh", to: "b", label: "lädt App", dashed: true },
            { from: "a", to: "w", label: "HTTPS + WSS" },
            { from: "b", to: "w", label: "HTTPS + WSS" },
            { from: "w", to: "g", label: "Token prüfen" },
            { from: "w", to: "do", label: "routet per matchId" },
            { from: "w", to: "d1", label: "SQL" },
          ]}
        />
        <Properties
          items={[
            { label: "Frontend", value: "Bleibt React + TS + Rsbuild auf GitHub Pages; neu: Service Worker (Offline-Shell), IndexedDB (z. B. via `idb`) für Outbox und Snapshot" },
            { label: "API", value: "Ein Cloudflare Worker namens `padel-counter` auf `padel-counter.<account>.workers.dev` (gratis, keine eigene Domain). Der Teil `<account>` ist die workers.dev-Subdomain des Cloudflare-Kontos und wird beim Anlegen des Kontos festgelegt; die genaue URL steht erst danach fest. Folgen: Cross-Origin zwischen `patrickstubner.github.io` und `workers.dev` – CORS-Allowlist exakt auf diesen Origin, Origin-Check beim WebSocket-Upgrade, Auth per `Authorization`-Header statt Cookies (Third-Party-Cookies werden blockiert). OAuth-Redirect-URI bei jedem Provider exakt registrieren, z. B. `https://padel-counter.<account>.workers.dev/auth/<provider>/callback`, danach Redirect zurück auf GitHub Pages mit einmaligem Code im Fragment." },
            { label: "Aufbewahrung", value: "Entscheid: Matches 2 Jahre nach letzter Aktivität löschen. Umsetzung: DO setzt bei jeder Aktivität ein Alarm auf jetzt + 2 Jahre; der Alarm löscht die DO-Daten (`deleteAll`) und den D1-Eintrag. Zusätzlich täglicher Cron-Worker als Netz, der D1-Referenzen mit `last_activity` älter als 2 Jahre entfernt. Datenschutz: klare Frist, Datenminimierung, in der App kommuniziert." },
            { label: "Match-Server", value: "Durable Object `MatchRoom`, Hibernatable WebSockets, SQLite-Tabellen pro Match" },
            { label: "Globale Daten", value: "D1: Benutzer, welche Matches einem Benutzer gehören, Listen-Ansicht" },
            { label: "Deploy", value: "GitHub Actions: Frontend nach Pages, Worker per `wrangler deploy` mit API-Token als GitHub Secret" },
          ]}
        />
      </Section>

      <Section heading="Datenmodell" id="dm" caption="Events sind die Wahrheit; Spielstände (Sets, Games) werden daraus berechnet.">
        <Table
          columns={["Tabelle", "Ort", "Felder", "Zweck"]}
          rows={[
            ["users", "D1", "`id`, `display_name`, `created_at`", "Ein Mensch, unabhängig vom Provider"],
            ["user_identities", "D1", "`user_id`, `kind` (social, passkey; später password), `provider` (google, github, facebook, webauthn), `provider_sub` (Social-`sub` oder Credential-ID), `linked_at`, `last_used_at`; eindeutig auf (`provider`, `provider_sub`)", "Ein Benutzer, mehrere Identitäten; letzte Identität darf nicht entfernt werden"],
            ["passkey_credentials", "D1", "`identity_id`, `public_key`, `sign_count`, `transports`, `backed_up`, `device_label`", "WebAuthn-Daten pro Passkey"],
            ["password_credentials", "D1", "Später (E-Mail/Passwort verschoben)", "Nicht in der ersten Version"],
            ["auth_tokens", "D1", "`token_hash`, `kind` (challenge; später verify, reset), `identity_id`, `expires_at`, `used_at`", "Einmal-Tokens und WebAuthn-Challenges"],
            ["matches", "D1 (Index) + DO (Meta)", "`id` (128 Bit zufällig), `owner_id`, `team_a`, `team_b`, `status`, `created_at`, `last_activity` (für 2-Jahres-Löschung), `deleted_by` nur im Audit-Log", "Liste meiner Matches; Meta im DO"],
            ["user_match_hidden", "D1", "`user_id`, `match_id`, `hidden_at`; Primärschlüssel (`user_id`, `match_id`)", "Pro Benutzer ausgeblendete Matches; löscht nichts, andere sehen das Match weiter; Zeile wird mit dem Match (Owner/Admin oder 2-Jahres-Frist) mitgelöscht"],
            ["participants", "DO-SQLite", "`user_id`, `role` (owner, editor, spectator), `joined_at`", "Wer darf was"],
            ["events", "DO-SQLite", "`seq` (Server), `event_id` (UUID vom Client), `match_id`, `user_id`, `device_id`, `type`, `payload`, `client_ts`, `server_ts`, `base_event_seq`, `expected_score` (JSON, nur Game-Events), `status` (applied, duplicate, pending, discarded), `duplicate_of` (seq)", "Append-only Operation-Log"],
            ["sets (abgeleitet)", "DO, Cache", "`set_no`, `games_a`, `games_b`", "Snapshot für schnelles Laden, jederzeit aus Events neu berechenbar"],
            ["invites", "DO-SQLite", "`token_hash`, `kind` (player, viewer), `expires_at`, `max_uses`, `revoked_at`", "Getrennte Spieler- und Zuschauer-Tokens"],
          ]}
        />
        <Text>{"Event-Typen: `game_won (team, set)`, `game_removed (team, set)`, `rules_set (...)` (erste Version: feste v1-Regeln), `team_renamed (team, name)`, `set_started (set_no)` (nur nötig für den Zusatzsatz nach entschiedenem Match); sonst ergeben sich Sets aus der Regel-Engine. Zusatzsatz-Events liegen im selben Log und tragen `set_no: 3`. Es gibt kein Undo-Event: Fehler werden mit Gegenaktionen korrigiert (ein Plus zu viel = ein Minus). Alle Events mit `server_ts`, `client_ts`, `user_id` und `device_id` bleiben unverändert in der Historie, bis das ganze Match gelöscht wird (durch Owner, Admin oder nach 2 Jahren Inaktivität; append-only, kein UPDATE/DELETE einzelner Events im Code), sodass nachvollziehbar bleibt, wer wann was gezählt hat – auch gleichzeitige doppelte Plus und deren spätere Korrektur. Das passt zu Patricks bestehendem Zustandsmodell, wenn dieses als Reducer über Events umgebaut wird."}</Text>
      </Section>

      <Section heading="Spielregeln (Padel)" id="regeln" caption="Grundlage: FIP Rules of Padel, gültig ab 1.1.2026. Die App zählt nur Games, keine Punkte; wie innerhalb eines Games gezählt wird (Vorteil, Golden Point, Star Point), ist für die App irrelevant.">
        <Table
          columns={["Regel", "FIP-Text", "Umsetzung auf Game-Ebene"]}
          rows={[
            ["Set", "6 Games mit mind. 2 Vorsprung; bei 5:5 bis 7:5", "Engine erkennt Set-Ende bei 6:0–6:4 oder 7:5 und öffnet automatisch das nächste Set"],
            ["Tiebreak", "Bei 6:6 Tie-break", "Tiebreak wird als ein Game erfasst: Plus beim Sieger → 7:6, Set-Flag `tiebreak`; Tiebreak-Punkte werden nicht gezählt"],
            ["Match", "Best of 3 Sets", "Sieger steht nach 2 gewonnenen Sets fest und ändert sich nicht mehr. Kein automatischer Abschluss: ein 3. Satz kann immer explizit gestartet werden (wie in v1), siehe ‹Zusatzsatz›"],
            ["3. Set ohne Tiebreak", "Bei 1:1 Sätzen, vorher vereinbart, 3. Satz mit 2 Games Vorsprung", "Später als Option `third_set: no_tiebreak` – Set läuft über 6:6 hinaus"],
            ["Super-Tiebreak statt 3. Satz", "FIP Alternative Score Methods: bei 1:1 Sätzen Super-Tiebreak bis 10 Punkte (2 Vorsprung), ersetzt den letzten Satz; ebenso Tiebreak bis 7", "Später als Option `third_set: super_tiebreak`: 3. Satz = ein einziges Game (1:0)"],
            ["Mini-Set", "FIP Alternative: Set auf 4 Games, Tiebreak bei 4:4", "Später als Option `games_per_set: 4`, `tiebreak_at: 4`"],
          ]}
        />
        <Rows
          rows={[
            { lead: "Einstellungen", title: "Regeln pro Match, gewählt vom Owner", detail: "Erste Version: feste Regeln wie v1 (6 Games, 2 Vorsprung, Tiebreak bei 6:6 → 7:6, Best of 3), ohne Einstellung. Später: Event `rules_set (sets_to_win, games_per_set, tiebreak_at, third_set)` als erstes Event, Änderung nur durch Owner und nur solange kein Set abgeschlossen ist. Keine Punkte-Einstellung (Vorteil/Golden/Star Point)." },
            { lead: "Zusatzsatz", title: "3. Satz immer möglich, auch nach 2:0 – ohne Modus oder Schalter", detail: "v1 verhält sich schon so (geprüft in `reducer.ts`/`rules.ts`): nach 2:0 springt die App nicht automatisch in Satz 3 und beendet das Match nicht; Satz 3 lässt sich per `set/select` wählen und zählen, `matchWinner` bleibt beim Sieger. v2: Ist der Sieger nach 2 Sätzen entschieden, startet ein Spieler Satz 3 explizit per Button ‹Zusatzsatz spielen› (Event `set_started (set_no: 3)`, idempotent). Die Engine schliesst das Match nie automatisch dagegen ab; nur `match/end` beendet es." },
            { lead: "Sieger", title: "Bestimmt allein durch die ersten zwei Sätze", detail: "`computeState` liefert `winner` aus Satz 1–2 und `extraSet: true` für Satz 3; dessen Games zählen normal mit Satzregeln (Tiebreak usw.), ändern aber weder Sieger noch Satzbilanz (Anzeige 2:0, nicht 2:1)." },
            { lead: "Anzeige", title: "Zusatzsatz klar markiert, auch für Zuschauer", detail: "Sieger-Banner bleibt sichtbar; Satz 3 erscheint mit Label ‹Zusatzsatz› und gedämpfter Farbe, Live-Stand normal. Historie und Export führen ihn im selben Event-Log." },
            { lead: "Engine", title: "Reine Funktion `computeState(rules, events)`", detail: "Spielt alle Events in `seq`-Reihenfolge ab und leitet Sets, Set-Ende, Tiebreak und Match-Ende ab. Sets ergeben sich aus der Regel; `set_started` braucht es nur für den Zusatzsatz. Läuft identisch im Frontend und im DO (geteilter TS-Code)." },
            { lead: "Gegenaktionen", title: "Minus kann ein Set-Ende wieder aufheben", detail: "Beispiel: 6:4 schliesst Set 1; ein Minus (falsch gezählt) ergibt 5:4, Set 1 ist wieder offen. Ein Minus bezieht sich immer auf ein Set (`set_no` im Event); Plus-Events für ein bereits geschlossenes Set werden ignoriert, bleiben aber in der Historie." },
            { lead: "Offline-Merge", title: "Konflikte am Set-Ende", detail: "Zwei Handys zählen offline beide das 6. Game: Engine ergibt 7:4 → nicht regelkonform. Regel: Plus, die ein geschlossenes Set überschreiten, werden verworfen (sichtbar als ‹ignoriert› in der Historie), sodass der Stand regelkonform bleibt." },
          ]}
        />
      </Section>

      <Section heading="Regel-FAQ in der App" id="faq" caption="Nicht in der ersten Version (später). Zusammenfassung in eigenen Worten nach FIP Rules of Padel (ab 1.1.2026). Im Ernstfall gilt der Originaltext bzw. das Turnier-/Clubreglement.">
        <Table
          columns={["Streitfall", "Was gilt (FIP)", "Regel"]}
          rows={[
            ["Ball trifft Gitter nach Aufprall beim Gegner", "Ball bleibt im Spiel, muss vor dem zweiten Aufprall zurückgespielt werden", "Rule 12.3–4, Rule 14.1c"],
            ["Eigener Schlag trifft direkt Gitter oder Wand beim Gegner (ohne Aufprall)", "Punkt verloren", "Rule 13.1g"],
            ["Eigener Schlag trifft eigenes Gitter", "Punkt verloren (eigene Wände sind erlaubt, Gitter nicht)", "Rule 13.1l, Rule 14.1b"],
            ["Aufschlag springt im Feld und trifft dann das Gitter", "Fehler", "Rule 7.1e"],
            ["Aufschlag ausserhalb des Aufschlagfelds", "Fehler (Linien zählen als gut)", "Rule 7.1c"],
            ["Aufschlag berührt Netz und landet im Feld", "Wiederholen (‹net›), ausser er trifft danach vor dem zweiten Aufprall das Gitter", "Rule 9.1a"],
            ["Empfänger war nicht bereit", "Wiederholen, ausser er hat versucht zu returnieren", "Rule 6.11, Rule 9.2a"],
            ["Spieler berührt das Netz", "Punkt verloren (Netz, Pfosten, Kabel, gegnerische Seite)", "Rule 13.1a"],
            ["Ball fliegt nach Aufprall aus dem Court", "Korrekter Schlag; Gegner darf nur bei erlaubtem Aussenspiel draussen weiterspielen", "Rule 14.1d, Rule 13.1d–e, Rule 16"],
            ["Ball geht durch ein Loch im Gitter oder bleibt stecken", "Punkt für den Schläger", "Rule 15.1a"],
            ["Ball landet in der Ecke Wand/Boden", "Korrekter Schlag", "Rule 14.1i"],
            ["Ungewollte Behinderung", "Punkt wiederholen; zweites Mal derselben Paarung = Punktverlust", "Rule 11"],
          ]}
        />
        <Rows
          rows={[
            { lead: "Verband", title: "FIP als Standard, Unterschiede markiert", detail: "Swiss Padel und Clubs: eigene Reglemente nicht geprüft – die Seite zeigt nur den Hinweis ‹Clubregeln können abweichen› und den Link, bis die Texte verifiziert sind." },
            { lead: "Verknüpfung", title: "Regelseite zeigt das Regelset des Matches", detail: "Kopf der FAQ: ‹Dieses Match: FIP, Tiebreak bei 6:6, Best of 3› aus dem `rules_set`-Event; Abweichungen werden hervorgehoben." },
            { lead: "Urheberrecht", title: "Eigene Formulierungen plus Links", detail: "Keine Volltexte aus den Rulebooks kopieren; kurze Zusammenfassung, Regelnummer und Link zum offiziellen PDF." },
            { lead: "Updates", title: "Statischer Inhalt im Frontend", detail: "FAQ als versionierte JSON/MDX-Datei im Repo, mit `rules_version` und Prüfdatum; per Service Worker offline verfügbar; Änderung = Pull Request mit Security- und Quellen-Review." },
          ]}
        />
      </Section>

      <Section heading="Sync- und Konfliktstrategie" id="sync">
        <Callout lead="Operation-Log mit Zählern als Summe (CRDT-ähnlicher PN-Counter), nicht Zustand überschreiben.">
          Jede Änderung wird als Event mit eigener UUID lokal gespeichert, sofort angezeigt und in eine Outbox gelegt. Online wird sie per WebSocket gesendet; das DO vergibt eine fortlaufende `seq`, speichert, bestätigt und verteilt. Gleiche `event_id` doppelt = ignoriert (idempotent).
        </Callout>
        <Rows
          rows={[
            { lead: "Games", title: "Score = Anzahl `game_won` minus `game_removed` pro Team und Set", detail: "Zwei Handys drücken offline beide +1 für Team A: Ergebnis +2. Das ist kommutativ und braucht keine Konfliktauflösung. Untergrenze 0 wird beim Berechnen geklemmt." },
            { lead: "Doppelzählung", title: "Erkennung über Basis + Zielstand", detail: "Jedes Game-Event trägt `baseEventSeq` und `expectedScore`; damit unterscheidet der Server Doppelzählung von echten Games – siehe Unterabschnitt ‹Absicht erkennen›." },
            { lead: "Korrektur", title: "Kein Undo – nur Gegenaktionen", detail: "Minus-Taste erzeugt `game_removed`. Kein einzelnes Event wird je verändert oder gelöscht, auch nicht durch den Owner; niemand kann fremde Events zurücknehmen. Zwei gleichzeitige Plus plus ein späteres Minus bleiben als drei Events sichtbar. Ein Minus bei Stand 0 wird gespeichert, wirkt aber nicht (Klemmen auf 0)." },
            { lead: "Historie", title: "Verlaufsansicht pro Match", detail: "Liste aller Events mit Zeit (Zurich), Autor und Gerät; Paare Plus/Minus kurz hintereinander werden als ‹korrigiert› markiert." },
            { lead: "Teamnamen", title: "Last-writer-wins nach Server-`seq`", detail: "Namen sind Register, keine Zähler; das spätere Event beim Server gewinnt." },
            { lead: "Set-Wechsel", title: "`set_started` mit Setnummer ist idempotent", detail: "Zwei Handys starten offline den Zusatzsatz: ein Satz 3, nicht zwei." },
            { lead: "Offline-Anzeige", title: "Klarer Status-Balken: Online, Offline (n ausstehend), Synchronisiere", detail: "Basierend auf WebSocket-Zustand plus `navigator.onLine`; Reconnect mit exponentiellem Backoff; nach Reconnect sendet Client `last_seq`, Server liefert fehlende Events." },
          ]}
        />
        <Text>Reihenfolge der Anzeige: bestätigte Events nach `seq`, darauf lokal ausstehende Events (optimistisch). Weil Zähler-Events kommutativ sind, springt der Stand beim Sync höchstens um fremde Games, nie zurück.</Text>
        <Section heading="Absicht erkennen: Event + Basis + Zielstand (Entscheid Patrick)">
          <Text>Jedes Event wird mit `event_id` (UUID), `match_id`, Autor, `client_ts`, `device_id`, `type` und `baseEventSeq` gesendet, also der letzten Server-`seq`, die das Gerät kannte. Game-Plus/-Minus tragen zusätzlich den Zielstand `expectedScore`. Der Stand wird nie allein gesendet. Gezählt wird weiterhin als Summe der Plus/Minus; der Zielstand ist nur Metadatum zur Erkennung von Duplikaten und Absicht.</Text>
          <Text>{'Beispiel: { "event_id": "7c1e…-uuid", "match_id": "m_9f…", "author": "u_42", "device_id": "d_a1", "client_ts": 1761219300000, "type": "game_won", "team": "a", "set_no": 2, "baseEventSeq": 17, "expectedScore": { "set": 2, "a": 3, "b": 2 } }'}</Text>
          <ProsCons
            prosHeading="Warum nicht nur Zustand senden"
            consHeading="Warum nicht nur Events ohne Ziel"
            pros={[
              "Zustände überschreiben sich: 3:2 von A und 3:2 von B ergeben ein stilles Last-write-wins",
              "Historie ginge verloren: wer wann gezählt hat, wäre nicht nachvollziehbar",
              "Server müsste dem Client-Zustand vertrauen – Manipulation trivial",
            ]}
            cons={[
              "Zwei Plus für Team A sehen identisch aus, egal ob zwei Games oder einmal doppelt gezählt",
              "Ohne Basis und Ziel kein Unterschied zwischen ‹mitgezählt› und ‹neues Game›",
              "Offline-Geräte würden beim Reconnect alles nochmals addieren",
            ]}
          />
          <Table
            columns={["Fall", "Bedingung", "Ergebnis", "Gezählt"]}
            rows={[
              ["1 Wiederholung", "Gleiche `event_id` schon gespeichert", "Ignoriert, gleiche Bestätigung zurück", "Nein (schon einmal)"],
              ["2 Gleiche Absicht gleichzeitig", "Gleiche Basis, gleiches Team, gleicher Zielstand, anderes Gerät, innerhalb Fenster (Vorschlag 4 s, konfigurierbar 3–5 s)", "Erstes angewendet, zweites als `duplicate` mit `duplicate_of` gespeichert", { text: "Nein", tone: "warning" }],
              ["3 Alte Basis, Ziel schon erreicht", "`baseEventSeq` veraltet, Zielstand existiert in der Historie bereits für dieses Team/Set", "`duplicate` (Gerät hat offline mitgezählt)", { text: "Nein", tone: "warning" }],
              ["4 Alte Basis, anderes Ziel", "Veraltet, Zielstand weicht ab (z. B. 4:2, obwohl 3:2 schon von anderem Gerät)", "`pending` + Prompt an Spieler: ‹Doppelt gezählt? Behalten / Verwerfen›", { text: "Erst nach ‹Behalten›", tone: "warning" }],
              ["Zusatzsatz-Start doppelt", "Zwei Geräte senden `set_started (3)`", "Erstes angewendet, zweites `duplicate` (idempotent über `set_no`)", "–"],
              ["Game im Zusatzsatz", "Wie jedes Game-Event mit `expectedScore` inkl. `set: 3`", "Fälle 1–5 gelten unverändert; Plus für Satz 3 ohne vorheriges `set_started` → abgewiesen", "–"],
              ["5 Verschiedene Absicht", "Anderes Team oder anderes Set (A und B gleichzeitig)", "Beide angewendet", { text: "Ja", tone: "success" }],
              ["Normalfall", "Basis aktuell, Zielstand = Serverstand + 1", "Angewendet", { text: "Ja", tone: "success" }],
            ]}
          />
          <Callout lead="Empfehlung zu Fall 4: halten statt anwenden.">
            Das Event bleibt `pending` und zählt nicht, bis ein Spieler ‹Behalten› (dann angewendet mit neuer `seq`) oder ‹Verwerfen› (Status `discarded`) tippt. So springt der Stand für Zuschauer nie hoch und wieder runter. Das ist kein Undo: ein verworfenes Pending-Event war nie gezählt und bleibt in der Historie. Eine spätere Korrektur eines gezählten Games läuft weiterhin nur über ein Gegen-Event. Der Prompt bleibt auf allen Spieler-Geräten sichtbar, bis entschieden ist; Entscheidung ist selbst ein Event (`pending_resolved`).
          </Callout>
          <Table
            columns={["Schritt", "Handy A", "Server (DO)", "Handy B"]}
            rows={[
              ["Online, gleichzeitig", "Stand 2:2, tippt +A → base 17, Ziel 3:2", "Wendet A an (seq 18), broadcast", "Tippt +A → base 17, Ziel 3:2 (0,8 s später)"],
              ["", "Sieht 3:2", "B: Fall 2 → `duplicate_of` 18, nicht gezählt", "Erhält Bestätigung ‹Duplikat›, Anzeige 3:2"],
              ["Offline", "Online, zählt +A (3:2, seq 18), +B (3:3, seq 19)", "", "Offline, zählt mit: +A Ziel 3:2, +B Ziel 3:3, dann +A Ziel 4:3 (alle base 17)"],
              ["Weiter offline", "Zählt +A → 4:3 (seq 20)", "Stand 4:3", "Noch offline"],
              ["Reconnect", "", "B-Outbox: Ziel 3:2 → Fall 3, Ziel 3:3 → Fall 3, Ziel 4:3 → Fall 3 (existiert schon) → nichts doppelt", "Erhält Events ab 17, Stand 4:3"],
              ["Variante", "", "Hätte B offline zusätzlich +A → Ziel 5:3 gezählt: Fall 4 → `pending`, Prompt an alle Spieler", "Prompt ‹Doppelt gezählt? Behalten / Verwerfen›"],
            ]}
          />
          <Text>Der Server ermittelt den Fall immer aus seinem eigenen, per Regel-Engine berechneten Stand; `expectedScore` dient nur dem Vergleich und wird nie übernommen.</Text>
        </Section>
      </Section>

      <Section heading="QR-Join und Berechtigungen" id="qr">
        <Steps
          steps={[
            { title: "Owner erstellt Match", detail: "Online oder offline; offline erhält das Match eine Client-UUID und wird beim ersten Sync registriert." },
            { title: "Owner öffnet im Menü ‹Mitspieler verbinden› und wählt die Art", detail: "Umschalter (zwei Buttons): ‹Spieler (darf zählen)› oder ‹Zuschauer (nur ansehen)›. Es wird immer nur EIN QR-Code kurz angezeigt; beim Umschalten wechseln QR-Code und Link, die Überschrift nennt klar die gewählte Rolle." },
            { title: "Server erzeugt das passende Token", detail: "Spieler: Einladungs-Token (128 Bit, kurz gültig, z. B. 2 h). Zuschauer: separates View-Token (128 Bit, gültig bis Match-Ende). Getrennte Tokens, nur Hashes gespeichert." },
            { title: "QR zeigt URL", detail: "Spieler: `.../#/join/<matchId>?t=<inviteToken>`; Zuschauer: `.../#/watch/<viewToken>` (ohne Match-ID). Token im Fragment, damit er nicht in Server-Logs landet." },
            { title: "Spieler-Handy scannt", detail: "Login nötig, dann `POST /matches/:id/join` mit Token → Eintrag in participants als editor." },
            { title: "Zuschauer scannt", detail: "Kein Login. Öffnet eine Read-only-WebSocket zu `/watch`; erhält Snapshot und Live-Events." },
          ]}
        />
        <Table
          columns={["Rolle", "Darf", "Login nötig"]}
          rows={[
            ["owner", "Wie editor (inkl. ‹Aus meiner History entfernen›), plus: Spieler- und Zuschauer-Token erzeugen, rotieren, widerrufen, Editoren entfernen, Match beenden, ganzes Match jederzeit löschen. Einzelne Events nie löschen oder ändern", "Ja"],
            ["editor", "Games zählen (Plus/Minus), Namen ändern; kein Zurücknehmen fremder oder eigener Events; darf nicht löschen, aber das Match ‹Aus meiner History entfernen› (nur für sich ausblenden, wieder einblendbar)", "Ja"],
            ["admin (Patrick)", "Jedes Match löschen (Datenbank-Administrator); Admin-Rolle über serverseitige Liste `ADMIN_USER_IDS` (Worker-Variable, nie im Client entschieden)", "Ja"],
            ["spectator (öffentlich)", "Nur lesen (Live) über View-Link; darf nicht löschen; hat keine History, Ausblenden entfällt", "Nein (Patricks Entscheid)"],
          ]}
        />
        <Rows
          rows={[
            { lead: "Trennung", title: "Zwei unabhängige, unratbare Tokens pro Match", detail: "Aus dem View-Token lässt sich weder die Match-ID noch das Spieler-Token ableiten. Schreibrechte hängen nie am Link, sondern am participants-Eintrag des eingeloggten Benutzers." },
            { lead: "Read-only", title: "Eigener WebSocket-Typ für Zuschauer", detail: "Das DO markiert Zuschauer-Sockets (Hibernation-Tag `viewer`) und verwirft serverseitig jede eingehende Schreibnachricht mit Fehler und Verbindungsabbruch; Zuschauer senden höchstens Pings." },
            { lead: "Rotation", title: "Owner kann beide Tokens einzeln erneuern oder widerrufen", detail: "Neues Token = alter Hash gelöscht; bestehende Sockets mit altem Token werden geschlossen. Spieler-Token rotiert automatisch nach Ablauf." },
            { lead: "Löschen", title: "Ganzes Match: Owner oder Admin", detail: "`DELETE /matches/:id`: Worker prüft `owner_id` bzw. `ADMIN_USER_IDS`, schliesst alle Sockets, löscht DO-Daten (`deleteAll`) und D1-Eintrag, schreibt einen Audit-Eintrag (Match-ID, wer, wann) ohne Spielinhalte." },
            { lead: "Ausblenden", title: "‹Aus meiner History entfernen› (Nachtrag 24.10.2026)", detail: "Für Spieler und Owner: `POST /matches/:id/hide` legt eine Zeile in `user_match_hidden` an; `listMine` filtert sie weg. Nichts wird gelöscht, andere Teilnehmer sehen das Match weiter, Events und Autoren bleiben. Rückgängig (empfohlen): Ansicht ‹Ausgeblendete Matches› mit ‹Wieder einblenden› (`DELETE /matches/:id/hide`). Die 2-Jahres-Frist gilt unverändert; ausgeblendete Matches werden dann wie alle gelöscht. Ist der Owner der einzige Teilnehmer, bleibt das Match trotzdem bestehen – löschen nur per ‹Match löschen›." },
            { lead: "Limits", title: "Rate Limits für öffentliche Zuschauer", detail: "Max. Zuschauer pro Match (z. B. 20), max. Verbindungsaufbauten pro IP und Minute, Snapshot nur einmal pro Verbindung. Schützt die 100'000 DO-Requests/Tag (ausgehende WS-Nachrichten sind gratis)." },
          ]}
        />
        <Text>Ohne Netz kann kein neues Handy joinen (der Server muss das Token prüfen). Bekannte Teilnehmer zählen offline weiter.</Text>
      </Section>

      <Section heading="Login-Flow" id="login">
        <Steps
          steps={[
            { title: "Google Identity Services im Frontend", detail: "Liefert ein signiertes ID-Token (JWT) – ohne Client-Secret, passt zu GitHub Pages." },
            { title: "`POST /auth/google` an den Worker", detail: "Worker prüft Signatur gegen Googles JWKS, `aud` = eigene Client-ID, `iss`, `exp`." },
            { title: "Worker legt/aktualisiert user in D1", detail: "Schlüssel: Provider + `sub`, keine E-Mail nötig." },
            { title: "Worker gibt eigenes Session-Token aus", detail: "Kurzlebiges JWT (z. B. 1 h) plus Refresh-Token (30 Tage, rotierend, Hash in D1). Signier-Schlüssel nur als Worker-Secret." },
            { title: "Offline", detail: "App merkt sich die Benutzer-ID; Events werden offline mit dieser ID erzeugt und beim Sync mit frischem Token authentifiziert." },
          ]}
        />
        <Table
          columns={["Provider", "Flow im Worker", "Kosten / Status"]}
          rows={[
            ["Google", "ID-Token (Google Identity Services) oder OAuth Code + PKCE", { text: "Gratis", tone: "success" }],
            ["GitHub", "OAuth Code-Flow, Client-Secret als Worker-Secret", { text: "Gratis", tone: "success" }],
            ["Facebook", "Facebook Login (OAuth Code), Meta for Developers, App-Review für mehr als `public_profile` nötig", { text: "Gratis", tone: "success" }],
            ["Passkey (WebAuthn)", "Zeremonie im Frontend (`navigator.credentials`), Prüfung im Worker mit `@simplewebauthn/server`; RP ID `patrickstubner.github.io`", { text: "Gratis", tone: "success" }],
            ["Instagram", "Gestrichen (23.10.2026): API nur für Business-/Creator-Konten", { text: "Entfällt", tone: "warning" }],
            ["X", "Gestrichen (23.10.2026): API pay-per-use, kein Gratis-Tarif", { text: "Entfällt", tone: "warning" }],
            ["Apple", "Gestrichen (Patricks Entscheid): Apple Developer Program kostet 100 USD/Jahr", { text: "Entfällt", tone: "warning" }],
            ["E-Mail + Passwort", "Verschoben (Entscheid 23.10.2026); bräuchte Mail-Versand mit eigener Domain", { text: "Später", tone: "warning" }],
          ]}
        />
        <Callout tone="info" lead="Warum Instagram und X gestrichen sind (geprüft am 23.10.2026)">
          Instagram: Meta hat die Basic Display API am 4.12.2024 abgeschaltet; die Instagram API with Instagram Login gilt nur für Business- und Creator-Konten (Quelle: developers.facebook.com/blog/post/2024/09/04/update-on-instagram-basic-display-api/). Facebook Login deckt Meta-Konten ab. X: Die X API ist laut docs.x.com pay-per-use mit Credits, ohne Gratis-Plan. Start daher mit Google, Facebook, GitHub und Passkeys.
        </Callout>
        <Text>Account-Linking: Ein Benutzer kann mehrere Provider und Passkeys verknüpfen (Tabelle `user_identities`). Automatisches Zusammenführen nur nach expliziter Bestätigung im eingeloggten Zustand, nie allein anhand gleicher E-Mail (GitHub liefert sie nicht immer verifiziert). Alle Client-Secrets nur als Worker-Secrets; Redirect-URIs exakt registriert; `state` und PKCE bei jedem Code-Flow.</Text>
        <Section heading="Passkeys (Start) und E-Mail/Passwort (später)">
          <Steps
            steps={[
              { title: "Reihenfolge Login-Screen", detail: "1. ‹Mit Passkey anmelden› (gross, plus Passkey-Autofill via `mediation: 'conditional'`), 2. Google, Facebook, GitHub. E-Mail/Passwort entfällt zum Start. Nach dem ersten Social-Login: Angebot ‹Passkey für dieses Gerät einrichten›." },
              { title: "Passkey registrieren", detail: "Frontend holt Challenge vom Worker (`/auth/passkey/register/options`), ruft `navigator.credentials.create()` mit `rp.id = 'patrickstubner.github.io'` auf, sendet Antwort an den Worker; dieser prüft mit `verifyRegistrationResponse` (expectedOrigin `https://patrickstubner.github.io`, expectedRPID) und speichert den Public Key." },
              { title: "Passkey anmelden", detail: "Discoverable Credential: kein Benutzername nötig. Worker prüft Signatur, Challenge (einmalig, 5 min) und Signatur-Zähler, gibt Session-JWT aus." },
            ]}
          />
          <Properties
            items={[
              { label: "Unterstützung", value: "Passkeys laufen in iOS Safari (ab iOS 16) und Android Chrome (ab 108), auch in installierten PWAs; synchronisiert über iCloud-Schlüsselbund bzw. Google Passwortmanager (Quelle: passkeys.dev Device Support). Feature-Check per `PublicKeyCredential.getClientCapabilities()` mit Fallback auf Social-Login." },
              { label: "RP ID", value: "Die RP ID muss die Domain des Frontends (oder ein registrierbares Suffix) sein, nicht die API-Domain. `github.io` steht auf der Public Suffix List, daher ist `patrickstubner.github.io` die engste gültige RP ID. Die Zeremonie läuft im Frontend, der Worker auf `workers.dev` prüft nur – das ist zulässig, weil Origin und RP ID in den signierten Daten stehen." },
              { label: "Folgen", value: "Passkeys gelten für den ganzen Origin `patrickstubner.github.io`, also auch v1 und andere Pages-Projekte von Patrick (kein Risiko, nur zu wissen). Eigene Domain ist nicht nötig. Wechselt man später auf eine eigene Domain, werden bestehende Passkeys unbrauchbar, ausser man nutzt Related Origin Requests: Datei `/.well-known/webauthn` auf `patrickstubner.github.io` (eigenes Repo `patrickstubner.github.io`), unterstützt ab Chrome 128 und Safari 18 (Quelle web.dev). Sonst Passkeys neu registrieren lassen." },
              { label: "Bibliothek", value: "`@simplewebauthn/browser` im Frontend, `@simplewebauthn/server` im Worker (laut Projekt kompatibel mit Cloudflare Workers). CPU-Bedarf der Prüfung im 10-ms-Limit nicht gemessen – in Staging testen." },
              { label: "E-Mail/Passwort (später)", value: "Verschoben, weil Bestätigungs- und Reset-Mails eine eigene Domain bräuchten (Resend Free sendet an beliebige Empfänger nur mit verifizierter eigener Domain; Cloudflare Email Sending nur im Paid-Plan). Bei späterer Einführung: PBKDF2-SHA-256 über WebCrypto mit 100'000 Iterationen (Workers-Grenze laut workerd-Issue #1346, nicht in der offiziellen Doku; OWASP empfiehlt 600'000), Salt + Pepper-Secret, Pwned-Passwords-Prüfung, Rate Limits, keine Konto-Enumeration, einmalige Reset-Tokens." },
              { label: "Aufwand", value: "Erste Version: Passkeys 2–3 Tage, Linking-UI 1 Tag. Später E-Mail/Passwort 3–4 Tage (Schätzung)." },
            ]}
          />
        </Section>
      </Section>

      <Section heading="Sicherheit" id="sec" caption="Gemäss Patricks Regel: jede Code-Änderung erhält ein detailliertes Security-Review.">
        <Table
          columns={["Thema", "Massnahme"]}
          rows={[
            ["Auth-Tokens", "ID-Token serverseitig verifizieren; eigene JWTs kurzlebig; Speicherung in Memory + IndexedDB, nicht in URL; WebSocket-Auth per erster Nachricht oder kurzlebigem Ticket statt Token in Query-String"],
            ["Match-ID-Raten", "IDs mit 128 Bit Zufall (`crypto.randomUUID`); Besitz der ID gibt keine Rechte – nur participants-Eintrag; Einladungs-Token getrennt, gehasht, ablaufend, widerrufbar"],
            ["Rate Limits", "Pro Benutzer und IP im Worker (Cloudflare Rate-Limiting-Binding, Free-Verfügbarkeit nicht verifiziert) bzw. Zähler im DO: z. B. max. 10 Events/s pro Socket, max. Matches pro Tag; schützt auch die 100'000 Requests/Tag"],
            ["Zielstand nie vertrauen", "`expectedScore` und `baseEventSeq` sind nur Hinweise: Server berechnet den Stand selbst und klassifiziert damit; ein Client kann keinen Stand setzen. Unplausible Werte (Basis grösser als aktuelle `seq`, Ziel mehr als +1 vom Basisstand, fremdes Set) → abgewiesen und geloggt. `device_id` ist zufällig, kein Fingerprint. Prompt-Entscheide nur durch Spieler, nicht Zuschauer."],
            ["Input-Validierung", "Schema-Validierung (z. B. zod) für jedes Event im DO; Teamnamen max. 40 Zeichen, Unicode normalisiert, als Text gerendert (kein `dangerouslySetInnerHTML`); Payload-Grösse begrenzen"],
            ["Autorisierung", "Jede Nachricht im DO gegen Rolle prüfen; Owner-Aktionen (Tokens, Editor entfernen, Match beenden, Match löschen) nur für `owner_id`; Löschen zusätzlich für Admins laut serverseitiger Liste `ADMIN_USER_IDS`; Mitspieler und Zuschauer nie; jede Löschung im Audit-Log (Match-ID, wer, wann); Events-Tabelle append-only, im Code kein UPDATE/DELETE einzelner Events"],
            ["Admin-Liste", "`ADMIN_USER_IDS` nur serverseitig (Worker-Variable pro Umgebung), enthält interne User-IDs, nicht E-Mails; Änderung nur per Deploy; Admin-Aktionen im Audit-Log"],
            ["CORS / Origin", "Origin-Prüfung bei HTTP und WebSocket-Upgrade auf die GitHub-Pages-Domain"],
            ["Secrets", "Keine Secrets im öffentlichen Repo: Google-Client-ID ist öffentlich ok; JWT-Schlüssel, GitHub- und Facebook-Secret via `wrangler secret`; Cloudflare-API-Token nur als GitHub Actions Secret; `.dev.vars` in `.gitignore`; Secret-Scanning und Dependabot aktivieren"],
            ["Passkeys", "Challenge einmalig, kurzlebig, serverseitig gespeichert; `expectedOrigin` und `expectedRPID` exakt prüfen; User Verification verlangen; Signatur-Zähler prüfen; Passkey-Entfernung nur nach erneuter Anmeldung"],
            ["OAuth (3 Provider)", "`state` + PKCE, exakte Redirect-URIs, Provider-Tokens nicht speichern (nur `sub`), Linking nur im eingeloggten Zustand bestätigen, nie per E-Mail-Gleichheit"],
            ["Öffentliche Zuschauer", "View-Token separat und widerrufbar; Read-only-Socket verwirft Schreibnachrichten serverseitig; Limit Zuschauer pro Match und Verbindungen pro IP; Zuschauer sehen keine Benutzer-IDs, nur Teamnamen und Stand"],
            ["Datenschutz", "Siehe Abschnitt Datenschutz"],
          ]}
        />
      </Section>

      <Section heading="Datenschutz" id="datenschutz" caption="Schlanker Entwurf, keine Rechtsberatung.">
        <Properties
          items={[
            { label: "Gespeicherte Daten", value: "Login-Kennung (Provider und dessen `sub` bzw. Passkey-Credential-ID mit Public Key), Anzeigename, Matches mit Teamnamen und Events (wer hat wann gezählt, Geräte-ID zufällig). Keine E-Mail-Adresse, kein Passwort, keine Standortdaten." },
            { label: "Datensparsamkeit", value: "Vom Provider nur `sub` und Name übernehmen; Provider-Tokens nicht speichern; Zuschauer ohne Login hinterlassen keine Personendaten ausser technisch nötigen Verbindungsdaten." },
            { label: "Aufbewahrung", value: "Matches werden 2 Jahre nach der letzten Aktivität automatisch gelöscht (DO-Alarm + Cron); Owner und Admin können früher löschen." },
            { label: "Kontolöschung", value: "Löscht Benutzer und alle Identitäten; Events in fremden Matches bleiben, der Autor wird pseudonymisiert (z. B. ‹Ehemaliger Spieler›)." },
            { label: "Keine Tracker", value: "Keine Analytics, keine Werbe- oder Social-Pixel, keine Drittanbieter-Skripte ausser dem gewählten Login-Provider beim Anmelden." },
            { label: "Auftragsverarbeiter", value: "Cloudflare (Worker, Durable Objects, D1) verarbeitet die Daten im Auftrag; Login-Provider (Google, Meta, GitHub) sind für den Login-Vorgang eigenständig verantwortlich. GitHub Pages liefert nur die statische App aus." },
            { label: "Recht", value: "Massgeblich ist das revDSG (Schweiz, in Kraft seit 1.9.2023). Spielen Personen in der EU mit, kann die DSGVO anwendbar sein; der Entwurf orientiert sich an beiden." },
            { label: "Datenschutzerklärung", value: "Kurze Seite in der App (offline verfügbar): Verantwortlicher (Patrick), gespeicherte Daten, Zweck (Spielstand teilen), Aufbewahrung, Auftragsverarbeiter, Rechte (Auskunft, Löschung), Kontakt. Link im Login-Screen und im Menü." },
          ]}
        />
      </Section>

      <Section heading="Free-Tier-Limits" id="limits">
        <Table
          columns={["Dienst", "Limit (Free)", "Bei Überschreitung"]}
          rows={[
            ["Workers Requests", "100'000/Tag, 10 ms CPU pro Aufruf", "Requests schlagen fehl, keine Kosten"],
            ["Durable Objects Requests", "100'000/Tag (inkl. WS-Nachrichten, eingehend 20:1)", "Fehler bis Reset 00:00 UTC (02:00 Zürich)"],
            ["Durable Objects Dauer", "13'000 GB-s/Tag", "Fehler; Hibernation hält Verbrauch tief"],
            ["DO SQLite", "5 Mio. Rows read, 100'000 Rows written/Tag, 5 GB total, 10 GB pro Objekt", "Schreibvorgänge schlagen fehl"],
            ["D1", "5 Mio. Rows read, 100'000 Rows written/Tag, 5 GB total", "Abfragen schlagen fehl bis Reset"],
            ["Supabase (Fallback)", "500 MB DB, 50'000 MAU, 200 Realtime-Verbindungen, 2 Mio. Nachrichten/Monat", "Pausiert nach 1 Woche Inaktivität; manuell reaktivieren"],
            ["Firebase Spark (Vergleich)", "1 GiB, 20'000 Writes und 50'000 Reads/Tag", "Quota-Fehler"],
          ]}
        />
        <Text>Grobe Rechnung (Schätzung): ein Match mit 3 Sets hat etwa 40–80 Events; selbst 50 Matches pro Tag liegen weit unter allen Limits. Offline-first fängt Ausfälle bei Limit-Erreichung ab: Events bleiben in der Outbox und werden nach dem Reset synchronisiert.</Text>
      </Section>

      <Section heading="Softwarearchitektur: Core + Adapter (portierbar)" id="core" caption="Hexagonal / Ports and Adapters, alles TypeScript. Ziel: Wechsel zwischen Cloudflare, Supabase und Firebase mit wenig Aufwand.">
        <Diagram
          direction="vertical"
          nodes={[
            { id: "web", label: "apps/web", detail: "React-UI, wählt Adapter per Build-Config" },
            { id: "sync", label: "packages/client-sync", detail: "Outbox, Offline-Queue, Reconnect" },
            { id: "core", label: "packages/core", detail: "Events, zod, Regel-Engine, Rechte, Merge, IDs, Retention-Regeln", kind: "decision" },
            { id: "ports", label: "Ports (Interfaces)", detail: "EventStore, RealtimeChannel, AuthProvider, MatchRepository, TokenService, RetentionScheduler, Clock" },
            { id: "cf", label: "adapters/cloudflare", detail: "Worker + DO (WebSocket, SQLite) + D1" },
            { id: "sb", label: "adapters/supabase", detail: "Postgres + Realtime + Auth + RLS" },
            { id: "fb", label: "adapters/firebase", detail: "Firestore + onSnapshot + Auth + Security Rules" },
          ]}
          edges={[
            { from: "web", to: "sync" },
            { from: "web", to: "core" },
            { from: "sync", to: "core" },
            { from: "core", to: "ports", label: "definiert" },
            { from: "cf", to: "ports", label: "implementiert", dashed: true },
            { from: "sb", to: "ports", label: "implementiert", dashed: true },
            { from: "fb", to: "ports", label: "implementiert", dashed: true },
          ]}
        />
        <Table
          columns={["Paket", "Inhalt", "Darf importieren"]}
          rows={[
            ["`packages/core`", "Event-Typen + zod-Schemas, `computeState(rules, events)`, Rechte (`can(role, action)` inkl. Löschen nur Owner/Admin), Merge/Dedupe nach `event_id`, ID-Erzeugung (`crypto.randomUUID`), Retention-Regel (`isExpired(lastActivity, now)` = 2 Jahre), Export-Format", "Nur `zod`; keine Plattform-, DOM- oder Node-Imports (per ESLint-Regel erzwungen)"],
            ["`packages/client-sync`", "Outbox in IndexedDB, Offline-Queue, Backoff, `last_seq`-Abgleich, Online-Status", "core + Ports"],
            ["`adapters/cloudflare`", "Client-Teil (WebSocket) und Server-Teil (Worker, DO `MatchRoom`)", "core, `@cloudflare/workers-types`"],
            ["`adapters/supabase`", "Client mit `@supabase/supabase-js`, SQL-Migrationen, RLS-Policies, Postgres-Funktionen", "core, supabase-js"],
            ["`adapters/firebase`", "Client mit Firebase JS SDK, `firestore.rules`, Indexe", "core, firebase"],
            ["`packages/contract-tests`", "Gemeinsame Tests gegen jeden Adapter", "core + Ports"],
            ["`apps/web`", "UI (Design wie v1), Adapter-Auswahl; Regel-FAQ später", "alles ausser Server-Code"],
          ]}
        />
        <Section heading="Ports (TypeScript-Signaturen)">
          <Table
            columns={["Port", "Signatur"]}
            rows={[
              ["EventStore", "`append(matchId: MatchId, events: NewEvent[]): Promise<AppendResult[]>` mit `AppendResult = { eventId, seq, status: 'applied' | 'duplicate' | 'pending' | 'ignored', duplicateOf?: number }` · `readSince(matchId: MatchId, seq: number): Promise<StoredEvent[]>` · `resolvePending(matchId: MatchId, eventId: EventId, keep: boolean): Promise<AppendResult>`"],
              ["Core (rein)", "`classify(state: MatchState, history: StoredEvent[], e: NewEvent, cfg: { windowMs: number }): Classification` – die fünf Fälle als reine Funktion, identisch in Server und Client"],
              ["RealtimeChannel", "`subscribe(matchId: MatchId, onEvent: (e: StoredEvent) => void, onStatus: (s: ConnStatus) => void): Unsubscribe` · `publish(matchId: MatchId, e: NewEvent): Promise<void>`"],
              ["AuthProvider", "`signIn(method: { kind: 'social', provider: 'google' | 'facebook' | 'github' } | { kind: 'passkey' }): Promise<Session>` · `registerPasskey(label: string): Promise<void>` · `currentUser(): Promise<UserRef | null>` · `listIdentities(): Promise<Identity[]>` · `linkIdentity(method: LinkMethod): Promise<void>` · `unlinkIdentity(id: IdentityId): Promise<void>` · `signOut(): Promise<void>` (später `signUpWithPassword`, `requestPasswordReset`)"],
              ["MatchRepository", "`create(meta: MatchMeta): Promise<MatchId>` · `get(id: MatchId): Promise<MatchMeta | null>` · `listMine(): Promise<MatchMeta[]>` · `setRole(id: MatchId, user: UserId, role: Role | null): Promise<void>` · `delete(id: MatchId): Promise<void>` (nur Owner oder Admin, serverseitig geprüft) · `hideForUser(id: MatchId): Promise<void>` · `unhideForUser(id: MatchId): Promise<void>` · `listHidden(): Promise<MatchMeta[]>` (nur eingeloggte Teilnehmer, wirkt nur für den aufrufenden Benutzer)"],
              ["TokenService", "`issue(id: MatchId, kind: 'player' | 'viewer', ttlMs: number): Promise<ShareToken>` · `redeem(token: string): Promise<Grant>` · `revoke(id: MatchId, kind: TokenKind): Promise<void>`"],
              ["RetentionScheduler", "`touch(id: MatchId, at: number): Promise<void>` · `purgeExpired(now: number): Promise<number>`"],
              ["Clock", "`now(): number` (Tests injizieren eine feste Uhr)"],
            ]}
          />
        </Section>
        <Section heading="Abbildung pro Adapter">
          <Table
            columns={["Port", "Cloudflare", "Supabase", "Firebase Spark"]}
            rows={[
              ["EventStore", "DO-SQLite-Tabelle `events`, `seq` vom DO", "Tabelle `events`, `seq` per `bigserial`; Insert via RPC-Funktion", "Subcollection `matches/{id}/events`, Dokument-ID = `event_id` (idempotent); Reihenfolge per Server-Timestamp, kein echtes `seq`"],
              ["RealtimeChannel", "WebSocket zum DO (Hibernation)", "Realtime Broadcast oder `postgres_changes` auf `events`", "`onSnapshot` auf der Events-Subcollection"],
              ["AuthProvider", "Eigener OAuth im Worker, eigenes JWT", "Supabase Auth (Social OAuth)", "Firebase Auth"],
              ["Passkeys", "Selbst gebaut mit SimpleWebAuthn im Worker", "Nativ, aber experimentell (Beta seit Mai 2026, Opt-in `experimental.passkey`, supabase-js ab 2.105.0)", "Nicht nativ GA (Public Preview noch nicht freigegeben); Erweiterung FirebaseWebAuthn braucht Cloud Functions → nicht auf Spark"],
              ["E-Mail/Passwort (später)", "Selbst gebaut (PBKDF2, eigene Mails, eigene Domain)", "Nativ inkl. Mails (eigener SMTP empfohlen)", "Nativ inkl. Mails"],
              ["Validierung + Rechte", "Server: core läuft im DO", "RLS-Policies + Postgres-Funktion (oder Edge Function in TS mit core)", "Nur Security Rules (Rechte, Felder, Typen, Längen); core-Logik wie Set-Ende nicht serverseitig"],
              ["TokenService", "DO speichert Hashes", "Tabelle `invites` + RPC `redeem` (security definer)", "Schwach: ohne Server nur ‹Token = Dokument-ID›, Rules prüfen Existenz; Rotation per Owner-Schreibzugriff"],
              ["RetentionScheduler", "DO-Alarm + Cron-Trigger", "`pg_cron` (Verfügbarkeit im Free-Plan nicht verifiziert)", "Kein Server-Job auf Spark: Firestore TTL-Policy auf `expireAt` (nicht verifiziert, ob auf Spark verfügbar)"],
            ]}
          />
          <Callout tone="warning" lead="Firebase Spark hat keine Cloud Functions (verifiziert).">
            Laut firebase.google.com/pricing sind Cloud Functions im Spark-Plan ‹Not applicable›. Validierung und Rechte müssen deshalb in Firestore Security Rules liegen; die Regel-Engine läuft dort nur im Client, der Server kann Regelverstösse (z. B. 7:4) nicht abweisen – die Engine ignoriert sie beim Berechnen, wie im Abschnitt Spielregeln beschrieben.
          </Callout>
        </Section>
        <Table
          columns={["Adapter", "Geschätzter Aufwand", "Bemerkung"]}
          rows={[
            ["Cloudflare (primär)", "8–12 Tage", "Meiste Eigenleistung (OAuth, Tokens), dafür volle Kontrolle"],
            ["Supabase", "4–6 Tage", "Auth und Realtime fertig; Aufwand in SQL, RLS, RPC"],
            ["Firebase", "4–7 Tage", "Auth und Sync fertig; Aufwand und Risiko in Security Rules"],
          ]}
        />
        <Text>Aufwand ist eine Schätzung für eine Person mit Patricks Profil, inklusive Contract-Tests, exklusive core und UI (die nur einmal entstehen).</Text>
        <Rows
          rows={[
            { lead: "Contract-Tests", title: "Eine Test-Suite, drei Läufe", detail: "`runContractTests(makeAdapter)` prüft: Idempotenz bei doppelter `event_id`, `readSince` vollständig, Zuschauer kann nicht schreiben, widerrufenes Token wird abgelehnt, Offline-Merge ergibt denselben Stand, Retention löscht, Match löschen nur durch Owner oder Admin (Editor und Zuschauer abgewiesen). Ausblenden: `hideForUser` blendet nur für den Aufrufer aus (andere sehen es in `listMine` weiter, Events unverändert), `unhideForUser` stellt es wieder her, idempotent bei doppeltem Aufruf, Zuschauer ohne Login abgewiesen, Retention löscht auch ausgeblendete Matches samt Hidden-Zeilen. Zusatzsatz: nach 2:0 kein Auto-Ende, `set_started (3)` erlaubt und idempotent, Games in Satz 3 ändern Sieger und Satzbilanz nicht, Zuschauer sehen Label ‹Zusatzsatz›. Dazu Absichts-Fälle: gleiche Absicht im Fenster → ein `duplicate`; gleiche Absicht ausserhalb Fenster mit aktueller Basis → beide gezählt; Offline-Gerät zählt mit → alle `duplicate`; anderes Ziel bei alter Basis → `pending`, Behalten/Verwerfen; A und B gleichzeitig → beide gezählt; gefälschter `expectedScore` ändert den Stand nicht."},
            { lead: "Firebase-Einschränkung", title: "Dedup ohne Server-Code", detail: "Spark hat keine Cloud Functions: `classify` läuft nur im Client (jeder Client wertet die Historie identisch aus); Security Rules können Felder, Rollen und `event_id` als Dokument-ID erzwingen, aber nicht die Fälle 2–4 serverseitig entscheiden. Folge: korrekt bei ehrlichen Clients, aber nicht manipulationssicher; `pending` ist nur ein Client-Zustand. Bei Cloudflare und Supabase (RPC) entscheidet der Server."},
            { lead: "Testumgebung", title: "Lokale Emulatoren in CI", detail: "Für Firebase prüfen die Contract-Tests die Client-Klassifikation. Läuft gegen `wrangler dev`, die lokale Supabase-CLI und den Firebase Emulator in CI." },
            { lead: "Auswahl", title: "Build-Time-Config", detail: "`BACKEND=cloudflare|supabase|firebase` als Rsbuild-Umgebungsvariable; `apps/web` importiert per Alias nur den gewählten Adapter, damit die anderen SDKs nicht im Bundle landen. Nur öffentliche Werte (URLs, Public Keys) in der Config." },
            { lead: "Nicht portierbar", title: "Plattformspezifisch bleibt", detail: "Auth-Provider-Konfiguration und Redirect-URIs, Admin-Liste, Retention-Jobs, Rate Limits, RLS bzw. Security Rules, Secrets, Deploy-Pipelines, Free-Tier-Limits." },
            { lead: "Export/Import", title: "Event-Log als JSON", detail: "Pro Match: `{ format: 'padel-events', version: 1, match: MatchMeta, rules, participants, events: StoredEvent[] }`, Events nach `seq`, Zeit in UTC-Millisekunden. Import = `append` in Reihenfolge; Idempotenz über `event_id`. Tokens werden nicht exportiert (neu ausstellen), Benutzer-IDs werden über Provider-`sub` neu verknüpft." },
          ]}
        />
      </Section>

      <Section heading="Umsetzungsplan für den Entwickler-Bot" id="plan">
        <Steps
          steps={[
            { title: "Phase 0 – Refactoring", detail: "Zustand als Reducer über Events; Event-Typen in `shared/` (TS). Undo-Funktion aus v1 entfernen; Unit-Tests für Score-Berechnung, Gegenaktionen, Klemmen auf 0. Design aus v1 übernehmen, im Hochformat breitere Plus/Minus-Buttons." },
            { title: "Phase 1 – Offline lokal", detail: "IndexedDB-Persistenz, Service Worker, Offline-Statusbalken. Noch kein Backend." },
            { title: "Phase 2 – Worker + DO", detail: "`wrangler`-Projekt im Repo (Worker `padel-counter`), `MatchRoom` mit SQLite und Hibernatable WebSockets, Sync-Protokoll (`hello last_seq`, `event`, `ack`, `broadcast`). Lokal mit `wrangler dev` testen." },
            { title: "Phase 3a – Login Google + GitHub", detail: "Generischer OAuth-Modul im Worker (PKCE, state), users + user_identities in D1, Session-JWT, Refresh-Rotation." },
            { title: "Phase 3b – Facebook", detail: "Meta-App (Free), Facebook Login. Instagram und X gestrichen." },
            { title: "Phase 3c – Passkeys", detail: "SimpleWebAuthn, Registrierung nach erstem Login, Autofill-Anmeldung, Tests auf iOS Safari und Android Chrome (Browser und PWA). Security-Review." },
            { title: "Phase 3d – Account-Linking", detail: "‹Weitere Anmeldemethode verknüpfen› für Social und Passkey; letzte Methode nicht entfernbar." },
            { title: "Phase 4 – Mitspieler verbinden", detail: "Menüpunkt ‹Mitspieler verbinden›: Umschalter Spieler/Zuschauer und ein kurz angezeigter QR-Code (z. B. `qrcode`-Paket), Join- und Watch-Route, Read-only-Socket, Rotation/Widerruf, Zuschauer-Limits." },
            { title: "Phase 5 – Härtung", detail: "Match löschen (Owner/Admin, Admin-Liste), Datenschutzerklärung, Rate Limits, Validierung, Origin-Checks, Konflikt-Tests mit zwei simulierten Offline-Clients, Security-Review, GitHub Actions Deploy." },
            { title: "Später", detail: "E-Mail/Passwort (mit eigener Mail-Domain), Regel-FAQ, Regel-Einstellungen pro Match, Verlaufsfilter, Rust-Experiment." },
          ]}
        />
      </Section>

      <Section heading="Repository, Build und Deployment" id="repo" caption="Plan, nichts angelegt. Abgestimmt auf Core + Adapter und auf die bestehende v1-Pipeline.">
        <Callout lead="Ein öffentliches Monorepo `patrickstubner/PadelCounterV2`.">
          Ein Repo statt zwei (Frontend/Backend), weil core und Event-Typen von Client und Server geteilt werden: eine Änderung am Event-Schema ist ein einziger, atomarer Pull Request mit Tests auf beiden Seiten; eine CI, ein Security-Review pro PR, keine Versionsdrift zwischen Paketen. Öffentlich ist unproblematisch, weil keine Secrets im Repo liegen und GitHub Pages für öffentliche Repos gratis ist.
        </Callout>
        <Table
          columns={["Pfad", "Inhalt"]}
          rows={[
            ["`apps/web/`", "React + Rsbuild: `src/`, `public/` (Icons, Manifest), `rsbuild.config.ts` (Base-Pfad, Workbox-SW); später `src/faq/` (Regel-FAQ, versioniert)"],
            ["`packages/core/`", "Events + zod, `computeState`, `classify`, Rechte, Retention-Regel, Export-Format, Ports (Interfaces); nur `zod` als Abhängigkeit"],
            ["`packages/client-sync/`", "Outbox (IndexedDB), Reconnect, Status"],
            ["`packages/contract-tests/`", "`runContractTests(makeAdapter)` + Fixtures"],
            ["`adapters/cloudflare/`", "`src/worker.ts` (Router, Auth, CORS), `src/match-room.ts` (Durable Object), `src/client.ts` (Browser-Adapter), `migrations/0001_init.sql` … (D1), `wrangler.toml` (`name = \"padel-counter\"`, Umgebungen `staging`/`production`, DO-Migrationen, Cron), `.dev.vars.example`"],
            ["`adapters/supabase/`", "`src/client.ts`, `supabase/migrations/*.sql` (Tabellen, RLS, RPC), `supabase/config.toml` – vorerst nur Gerüst + Contract-Tests"],
            ["`adapters/firebase/`", "`src/client.ts`, `firestore.rules`, `firestore.indexes.json`, `firebase.json` (Emulator) – vorerst nur Gerüst"],
            ["`docs/`", "Architektur, Protokoll (`protocol.md`), Entscheide (ADR), Datenschutzerklärung, Regelquellen"],
            ["`SECURITY.md`", "Bedrohungsmodell, Review-Log pro PR, Meldeweg (wie in v1 `docs/SECURITY.md`)"],
            ["`.github/workflows/`", "`ci.yml` (PR), `deploy.yml` (main, Tags), `codeql.yml`; `dependabot.yml`"],
            ["Wurzel", "`pnpm-workspace.yaml`, `package.json` (Skripte), `tsconfig.base.json`, `tsconfig.json` (References), `eslint.config.js`, `.gitignore` (inkl. `.dev.vars`, `.wrangler/`), `.nvmrc` (Node 22 wie v1)"],
          ]}
        />
        <Rows
          rows={[
            { lead: "Workspace", title: "pnpm Workspaces, Turborepo optional", detail: "v1 nutzt npm. pnpm wegen strikter Abhängigkeiten (ein Paket sieht nur, was es deklariert – schützt die ‹core ohne Plattform-Imports›-Regel), schneller Installation und `--filter` für Teil-Builds. Turborepo erst, wenn Builds spürbar langsam werden (Caching); bei drei Paketen nicht nötig. npm Workspaces wären die Alternative ohne neues Tool." },
            { lead: "TypeScript", title: "Project References", detail: "`tsconfig.base.json` (strict, `noUncheckedIndexedAccess`, `moduleResolution: bundler`); jedes Paket mit `composite: true`; Root-`tsconfig.json` referenziert alle; `tsc -b` prüft inkrementell. core ohne `lib: dom` und ohne Workers-Typen, damit Plattform-Imports nicht kompilieren." },
            { lead: "Frontend-Build", title: "Rsbuild wie v1, statische Dateien", detail: "`BACKEND=cloudflare` und `PUBLIC_API_URL=https://padel-counter.<account>.workers.dev` (bzw. Staging-URL `https://padel-counter-staging.<account>.workers.dev`) als Build-Variablen; nur öffentliche Werte. Base-Pfad `/PadelCounterV2/`. Workbox-SW wie v1 (`generateSW`, `cleanupOutdatedCaches`), eigener `cacheId`, API-URLs vom Caching ausgeschlossen. Build schreibt `version.json` (Commit, Protokollversion)." },
            { lead: "Backend-Build", title: "wrangler bündelt mit esbuild", detail: "`wrangler deploy --env staging|production` bündelt `adapters/cloudflare` inkl. core; DO-Klassen per `[[migrations]]` (`new_sqlite_classes`) in `wrangler.toml`; D1-Schema per `wrangler d1 migrations apply <db> --env … --remote` vor dem Deploy." },
          ]}
        />
        <Diagram
          direction="horizontal"
          nodes={[
            { id: "pr", label: "Pull Request", kind: "terminal" },
            { id: "ci", label: "CI", detail: "Lint, Typecheck, Unit, Contract-Tests, Audit/OSV, CodeQL, Build" },
            { id: "rev", label: "Security-Review", detail: "Pflicht vor Merge", kind: "decision" },
            { id: "main", label: "Merge auf main" },
            { id: "stg", label: "Staging", detail: "D1-Migration, Worker staging, Smoke-Test" },
            { id: "appr", label: "Freigabe", detail: "Environment `production`, manuell", kind: "decision" },
            { id: "prod", label: "Produktion", detail: "D1-Migration, Worker prod, dann Pages" },
          ]}
          edges={[
            { from: "pr", to: "ci" },
            { from: "ci", to: "rev" },
            { from: "rev", to: "main", label: "ok" },
            { from: "main", to: "stg" },
            { from: "stg", to: "appr" },
            { from: "appr", to: "prod", label: "genehmigt" },
          ]}
        />
        <Table
          columns={["Auslöser", "Jobs", "Bemerkung"]}
          rows={[
            ["Pull Request", "`pnpm install --frozen-lockfile`, `lint`, `tsc -b`, Unit (Vitest), Contract-Tests gegen Miniflare/`wrangler dev` (Cloudflare), Supabase-CLI lokal, Firebase Emulator; `pnpm audit` + OSV-Scanner; CodeQL; Build ohne Deploy", "Supabase-/Firebase-Contract-Tests nur bei Änderungen in core oder dem Adapter (Pfadfilter)"],
            ["Push auf main", "Wie PR, dann Deploy Staging (Worker), Pages-Artefakt für Staging-Smoke-Test", "Staging-Frontend: Build gegen Staging-API, als Artefakt (eine zweite Pages-Site pro Repo gibt es nicht)"],
            ["Freigabe `production`", "D1-Migration prod, `wrangler deploy --env production`, dann Frontend-Build gegen Prod-API und `actions/upload-pages-artifact` + `actions/deploy-pages`", "Manuelles `workflow_dispatch` auf `main`. Kein Required Reviewer. Die Deployment-Branch-Policy ist custom und enthält nur `main`."],
            ["Pfadfilter", "`apps/web/**` → nur Pages; `adapters/cloudflare/**` → nur Worker; `packages/core/**` → beides", "Via `dorny/paths-filter` oder `on.push.paths` (Ersteres nicht verifiziert)"],
            ["Zeitplan", "Wöchentlich Audit/OSV, Dependabot", "Wie v1"],
          ]}
        />
        <Table
          columns={["Secret / Wert", "Wo", "Regel"]}
          rows={[
            ["`CLOUDFLARE_API_TOKEN`", "GitHub Environment-Secret (staging bzw. production)", "Minimaler Scope: Workers Scripts Edit, D1 Edit, nur dieses Konto; kein Global API Key"],
            ["`CLOUDFLARE_ACCOUNT_ID`", "GitHub Variable", "Nicht geheim"],
            ["OAuth-Client-Secrets (GitHub, Facebook), JWT-Schlüssel", "Worker-Secrets via `wrangler secret put --env …`", "Nie im Repo, nie in CI-Logs; pro Umgebung verschieden; Rotation dokumentiert"],
            ["`ADMIN_USER_IDS`", "Worker-Variable bzw. Secret pro Umgebung", "Serverseitige Admin-Liste (Patrick); nie im Frontend"],
            ["Client-IDs, API-URL", "Build-Variablen / `wrangler.toml` `[vars]`", "Öffentlich, dürfen im Repo stehen"],
            ["Lokal", "`.dev.vars` (gitignored), Vorlage `.dev.vars.example` ohne Werte", "GitHub Secret Scanning + Push Protection aktiv"],
          ]}
        />
        <Rows
          rows={[
            { lead: "Versionierung", title: "Protokoll-Handshake", detail: "Client sendet `protocol: 1` und App-Version beim Verbindungsaufbau; Server akzeptiert aktuelle und vorige Protokollversion, sonst Antwort `upgrade_required` → UI ‹Update nötig›. Reihenfolge bei Brechungen: Backend zuerst (kann alt + neu), dann Frontend. D1-Migrationen nur additiv." },
            { lead: "Rollback", title: "Getrennt für Backend und Frontend", detail: "Backend: `wrangler rollback` auf die vorige Version (D1-Migrationen werden dabei nicht zurückgerollt – deshalb additiv). Frontend: vorigen Commit erneut deployen; v1 nutzt dafür ein erneutes Ausführen des Workflows, solange das Pages-Artefakt existiert (in v1 1 Tag). Für v2 längere Artefakt-Aufbewahrung oder Rebuild vom Tag." },
            { lead: "Lokal", title: "wrangler dev + rsbuild dev", detail: "`pnpm dev` startet `wrangler dev` (lokale DO + D1 via Miniflare, Port 8787) und `rsbuild dev` mit `PUBLIC_API_URL=http://localhost:8787`; CORS-Allowlist enthält `http://localhost:*` nur in der Dev-Umgebung. Passkeys lokal mit RP ID `localhost`." },
          ]}
        />
      </Section>

      <Section heading="Aufbau- und Einführungsplan v2" id="einfuehrung" caption="Stand Repo patrickstubner/PadelCounter v1.2.11, geprüft am 23.10.2026.">
        <Callout tone="info" lead="Keine Sprach- und keine Datenmigration.">
          v1 ist bereits TypeScript/React/Rsbuild, es gibt keine Server-Daten, und v1-Daten werden nicht nach v2 übernommen (Patricks Entscheid). v1 bleibt als eigenständige, funktionierende App parallel online; v2 ist ein neues, zusätzliches Angebot.
        </Callout>
        <Properties
          items={[
            { label: "v1 heute", value: "`localStorage`-Schlüssel `padel-counter.v1` (Schema 2: Basisstand + max. 500 Events), `padel-counter.matches` (Archiv, max. 100 Matches), `padel-counter.celebrated`; Workbox-Service-Worker `sw.js` mit Scope `/PadelCounter/`, `skipWaiting`, `clientsClaim`, `navigateFallback` auf `index.html`" },
            { label: "Wiederverwendbar", value: "v1 hat schon Event-Log, Reducer, Regel-Funktionen (`setWinner`, `matchWinner`) und Aufschlag-Tracking (`serve/set`). Diese Module werden nach v2 kopiert und angepasst (Undo entfernen, Events mit `event_id` und Autor)." },
            { label: "Empfehlung Koexistenz", value: "Separates Repo, z. B. `patrickstubner/PadelCounterV2` → `https://patrickstubner.github.io/PadelCounterV2/`. Kein Unterpfad `/PadelCounter/v2/`: der v1-Service-Worker hat Scope `/PadelCounter/` und würde Navigationen nach `/v2/` per `navigateFallback` auf die v1-`index.html` umleiten." },
            { label: "Kollisionen vermeiden", value: "Beide Apps teilen den Origin `patrickstubner.github.io`, also denselben `localStorage` und IndexedDB. v2 nutzt nur Präfix `padel-counter-v2.*` und IndexedDB `padel-counter-v2`; v2 löscht nie fremde Schlüssel. Eigener SW-Scope `/PadelCounterV2/`, eigener Cache-Präfix (Workbox `cacheId`), eigenes Manifest mit anderer `id`/`start_url`, damit beide installierbar sind." },
            { label: "Alternative", value: "Gleiches Repo, Branch `v2` mit eigenem Pages-Projekt ist auf GitHub Pages nicht möglich (eine Site pro Repo); daher separates Repo." },
          ]}
        />
        <Steps
          steps={[
            { title: "1. Repo und Gerüst", detail: "Ziel: v2-App läuft statisch offline. Aktionen: Repo `PadelCounterV2` anlegen, v1-Code als Ausgangsbasis übernehmen, Schlüssel/SW-Scope/Manifest umbenennen, Undo entfernen, Plus/Minus im Hochformat verbreitern, CI und Pages-Deploy. Fertig: v2 offline nutzbar, v1 unverändert erreichbar, keine gemeinsamen Schlüssel (Test). Rollback: Pages des neuen Repos deaktivieren. Security-Review." },
            { title: "2. Domain-Kern in `shared/`", detail: "Ziel: eine Regel-Engine für Client und Server. Aktionen: `computeState(rules, events)`, Event-Schema (zod), Unit-Tests inkl. Offline-Merge und Gegenaktionen. Fertig: Tests grün. Rollback: Revert-PR. Security-Review (Validierung, Grenzen)." },
            { title: "3. Cloudflare-Setup", detail: "Ziel: leeres Backend in Staging und Prod. Aktionen: Cloudflare-Konto (Free) mit workers.dev-Subdomain `<account>`, Worker `padel-counter-staging` und `padel-counter` auf `<account>.workers.dev`, D1-Datenbanken je Umgebung, Schema per `wrangler d1 migrations create/apply`, DO-Klasse `MatchRoom` mit SQLite-Migration in `wrangler.toml`, Deploy per GitHub Actions mit API-Token als Secret. Fertig: `/health` antwortet in beiden Umgebungen. Rollback: `wrangler rollback`. Security-Review (Token-Scope, keine Secrets im Repo)." },
            { title: "4. Aufbewahrung ab Tag 1", detail: "Ziel: 2-Jahres-Löschung vor dem ersten echten Match. Aktionen: DO-Alarm bei jeder Aktivität neu setzen, täglicher Cron-Trigger für D1-Aufräumen. Fertig: Test mit verkürzter Frist in Staging löscht DO-Daten und D1-Zeile. Rollback: Cron deaktivieren (keine Daten verloren, nur Löschung verzögert). Security-Review." },
            { title: "5. Sync hinter Feature-Flag", detail: "Ziel: Live-Sync opt-in, Offline-Modus bleibt Standard. Aktionen: Flag `sync` (lokal gespeichert, Standard aus), Outbox in IndexedDB, WebSocket-Protokoll, Status-Balken. Fertig: zwei Geräte synchron in Staging, Flag aus = reiner Offline-Betrieb. Rollback: Flag serverseitig per `/config` deaktivieren. Security-Review (Origin, Rate Limits)." },
            { title: "6. Login-Provider", detail: "Ziel: Identität. Aktionen: Google und GitHub, dann Facebook, dann Passkeys. Je Provider Redirect-URIs für Staging und Prod registrieren (`https://padel-counter.<account>.workers.dev/auth/<provider>/callback`), CORS-Allowlist nur `https://patrickstubner.github.io`. Fertig: Login + Linking in Staging. Rollback: Provider-Button per Config ausblenden. Security-Review (state, PKCE, Token-Lebensdauer)." },
            { title: "7. Mitspieler verbinden und Zuschauer", detail: "Ziel: QR-Join. Aktionen: Menüpunkt ‹Mitspieler verbinden›, Umschalter Spieler/Zuschauer, Tokens, Read-only-Socket, Rotation, Limits; Match löschen für Owner/Admin. Fertig: Zuschauer kann nicht schreiben, Editor kann nicht löschen (Tests). Rollback: Menüpunkt ausblenden. Security-Review (Token-Raten, Rechte)." },
            { title: "8. Datenschutz", detail: "Ziel: Datenschutzerklärung in der App (offline), Kontolöschung mit Pseudonymisierung. Fertig: Seite verlinkt im Login-Screen und Menü. Security-Review." },
            { title: "9. Go-live", detail: "Ziel: v2 öffentlich, v1 bleibt. Aktionen: Prod-Deploy Backend, dann Frontend; Flag für Patrick und Freunde aktivieren. Fertig: Checkliste unten erfüllt. Rollback: Flag aus, Frontend auf vorigen Commit; v1 nie betroffen." },
          ]}
        />
        <Rows
          rows={[
            { lead: "Zero Downtime", title: "Backend rein additiv, Frontend statisch", detail: "v1 läuft unverändert weiter; v2 Frontend funktioniert auch ohne Backend offline. Backend-Deploys sind atomar; D1-Migrationen nur additiv (neue Spalten/Tabellen), Protokoll versioniert (`protocol: 1`)." },
            { lead: "Cache-Busting", title: "Alte v2-Clients dürfen nicht brechen", detail: "Workbox mit Hash-Dateinamen und `cleanupOutdatedCaches` wie in v1; Server akzeptiert die letzte und vorletzte Protokollversion und meldet sonst ‹Update nötig›; v1s ‹Update ready›-Hinweis wird übernommen. API-Aufrufe nie vom SW cachen." },
          ]}
        />
        <Section heading="Wechsel von v1 zu v2 und Lebensdauer von v1">
          <Steps
            steps={[
              { title: "Vor dem Launch", detail: "v2 wird im neuen Repo `patrickstubner/PadelCounterV2` mit eigener Pages-URL gebaut; v1 bleibt unverändert unter `/PadelCounter/`." },
              { title: "Launch", detail: "v2 geht unter `https://patrickstubner.github.io/PadelCounterV2/` online. Wer v2 will, öffnet die neue URL (oder scannt einen QR-Code) und installiert sie als eigene App. Login nur für Live-Sync nötig." },
              { title: "Optional: Hinweis in v1", detail: "Kleines Release von v1 mit dezentem Link oder Banner ‹Neue Version mit Live-Sync› auf die v2-URL; ausblendbar, ohne v1-Daten zu berühren. Eigenes kurzes Security-Review." },
              { title: "Parallelbetrieb", detail: "Beide Apps laufen nebeneinander. Laufende v1-Matches werden in v1 zu Ende gezählt (keine Datenübernahme, Patricks Entscheid)." },
              { title: "Optional später: Archiv", detail: "Wenn Patrick es will: v1-Repo auf GitHub archivieren (read-only); die Pages-Site bleibt dabei nach unserem Verständnis online, das ist aber nicht verifiziert – vorher testen. Eine Abschaltung wäre nur das Deaktivieren von Pages." },
            ]}
          />
          <Properties
            items={[
              { label: "Wie lange ist v1 nutzbar?", value: "Unbegrenzt. v1 ist eine statische Offline-App ohne Backend; sie funktioniert, solange Repo und GitHub Pages (gratis) bestehen. Es gibt kein Abschaltdatum, ausser Patrick legt eines fest." },
              { label: "Nach dem v2-Launch?", value: "Ja, ohne Einschränkung und ohne Frist. Installierte v1-Apps laufen dank Service Worker sogar offline weiter, falls Pages einmal nicht erreichbar wäre." },
              { label: "Keine Kollision", value: "Unterschiedliche Pfade (`/PadelCounter/` vs. `/PadelCounterV2/`) trennen Service-Worker-Scopes und Caches. Weil beide auf demselben Origin `patrickstubner.github.io` liegen, teilen sie `localStorage`/IndexedDB: v2 nutzt ausschliesslich Präfix `padel-counter-v2.*` und fasst v1-Schlüssel (`padel-counter.v1`, `padel-counter.matches`, `padel-counter.celebrated`) nie an." },
            ]}
          />
        </Section>
        <Section heading="Go-live-Checkliste">
          <NumberedList
            items={[
              "Security-Review aller Phasen abgeschlossen und dokumentiert (`docs/SECURITY.md`)",
              "Keine Secrets im Repo; Secret-Scanning und Dependabot aktiv",
              "CORS und Origin-Checks nur für `https://patrickstubner.github.io`",
              "Redirect-URIs von Google, Facebook und GitHub für Prod registriert und getestet; Passkeys auf iOS und Android getestet",
              "Rate Limits und Zuschauer-Limits aktiv",
              "2-Jahres-Löschung (Alarm + Cron) in Prod aktiv; Match löschen nur Owner/Admin getestet",
              "Datenschutzerklärung in der App verlinkt",
              "Offline-Test: Flugmodus, zählen, wieder online, Sync korrekt",
              "v1 unter `/PadelCounter/` unverändert erreichbar, keine Schlüssel-Kollision",
              "Free-Tier-Verbrauch im Cloudflare-Dashboard geprüft",
            ]}
          />
        </Section>
      </Section>

      <Section heading="Offene Fragen für Patrick" id="fragen">
        <NumberedList
          items={[
            "Passkey als primäre Methode prominent zuerst anzeigen (Empfehlung) – einverstanden?",
            "Zuschauer-Link: Gültigkeit (bis Match-Ende, 24 h) und max. Zuschauer pro Match?",
            "Spieler-QR mehrfach verwendbar (z. B. 3 Handys) oder nur einmal?",
            "Darf nur der Owner ‹Mitspieler verbinden› öffnen, oder auch bereits verbundene Spieler (Empfehlung: nur Owner, Spieler nur Zuschauer-QR)?",
            "Später: alternative Formate anbieten (Mini-Set bis 4 Games, Super-Tiebreak statt 3. Satz)?",
            "Später: Swiss-Padel- und Clubregeln in die FAQ aufnehmen, sobald Quellen geprüft sind?",
          ]}
        />
        <Table
          columns={["Entschieden", "Entscheid (Patrick)"]}
          rows={[
            ["Login", "Start: Google, Facebook, GitHub und Passkeys. Instagram, X und Apple gestrichen; E-Mail/Passwort verschoben (23.10.2026)"],
            ["Zuschauer", "Ohne Login über öffentlichen Read-only-Link; ein QR-Code mit Umschalter Spieler/Zuschauer"],
            ["Undo", "Kein Undo; Korrektur nur per Gegenaktion; Historie append-only"],
            ["Padel-Regeln", "Game-Ebene (Satz, Tiebreak, Best of 3, Zusatzsatz); keine Punktezählung, kein Spielformat-Setting; Regel-FAQ später"],
            ["Match löschen", "Owner jederzeit, Admin (Patrick) jedes Match; Mitspieler/Zuschauer nie. Seit 24.10.2026: Spieler und Owner können ein Match aus der eigenen History ausblenden und wieder einblenden"],
            ["Umfang", "v1 ohne Undo plus Live-Sync, Login, ‹Mitspieler verbinden›"],
            ["Design", "Wie v1, im Hochformat breitere Plus/Minus-Buttons"],
            ["Konto-Löschung", "Events bleiben, Autor pseudonymisiert"],
            ["Domain", "Keine eigene Domain: Worker `padel-counter` auf `padel-counter.<account>.workers.dev`, Frontend auf GitHub Pages"],
            ["Sprache", "Backend in TypeScript (final)"],
            ["Speicherdauer", "2 Jahre nach letzter Aktivität, danach Löschung"],
          ]}
        />
      </Section>

      <Section heading="Quellen" id="quellen">
        <LinkCards
          links={[
            { title: "Durable Objects Pricing", site: "developers.cloudflare.com", href: "https://developers.cloudflare.com/durable-objects/platform/pricing/" },
            { title: "Durable Objects Limits", site: "developers.cloudflare.com", href: "https://developers.cloudflare.com/durable-objects/platform/limits/" },
            { title: "Workers Pricing", site: "developers.cloudflare.com", href: "https://developers.cloudflare.com/workers/platform/pricing/" },
            { title: "D1 Pricing", site: "developers.cloudflare.com", href: "https://developers.cloudflare.com/d1/platform/pricing/" },
            { title: "Supabase Pricing", site: "supabase.com", href: "https://supabase.com/pricing" },
            { title: "Supabase Realtime Limits", site: "supabase.com", href: "https://supabase.com/docs/guides/realtime/limits" },
            { title: "Firebase Pricing", site: "firebase.google.com", href: "https://firebase.google.com/pricing" },
            { title: "Convex Pricing", site: "convex.dev", href: "https://www.convex.dev/pricing" },
            { title: "Instant team joins OpenAI", site: "instantdb.com", href: "https://www.instantdb.com/pricing" },
            { title: "Turso Pricing", site: "turso.tech", href: "https://turso.tech/pricing" },
            { title: "Update on Instagram Basic Display API", site: "developers.facebook.com", href: "https://developers.facebook.com/blog/post/2024/09/04/update-on-instagram-basic-display-api/" },
            { title: "Instagram API with Instagram Login", site: "developers.facebook.com", href: "https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/" },
            { title: "X API Pay-per-use Pricing", site: "docs.x.com", href: "https://docs.x.com/x-api/getting-started/pricing" },
            { title: "FIP Rules of Padel (ab 1.1.2026)", site: "padelfip.com", href: "https://padelfip.com/wp-content/uploads/2025/12/FIP_Rules-of-Padel.pdf" },
            { title: "Passkeys Device Support", site: "passkeys.dev", href: "https://passkeys.dev/device-support/" },
            { title: "RP ID deep dive", site: "web.dev", href: "https://web.dev/articles/webauthn-rp-id" },
            { title: "Related Origin Requests", site: "web.dev", href: "https://web.dev/articles/webauthn-related-origin-requests" },
            { title: "W3C Web Authentication", site: "w3.org", href: "https://www.w3.org/TR/webauthn-3/" },
            { title: "SimpleWebAuthn Server", site: "simplewebauthn.dev", href: "https://simplewebauthn.dev/docs/packages/server" },
            { title: "Supabase Passkey authentication", site: "supabase.com", href: "https://supabase.com/docs/guides/auth/passkeys" },
            { title: "Firebase JS SDK Passkey Public Preview (PR)", site: "github.com", href: "https://github.com/firebase/firebase-js-sdk/pull/10141" },
            { title: "workerd: PBKDF2-Limit 100'000", site: "github.com", href: "https://github.com/cloudflare/workerd/issues/1346" },
            { title: "Resend Pricing", site: "resend.com", href: "https://resend.com/pricing" },
            { title: "Resend: 403 mit resend.dev", site: "resend.com", href: "https://resend.com/docs/knowledge-base/403-error-resend-dev-domain" },
            { title: "Cloudflare Email Service Pricing", site: "developers.cloudflare.com", href: "https://developers.cloudflare.com/email-service/platform/pricing/" },
          ]}
        />
      </Section>
    </Page>
  );
}


</cursor_untrusted_data_1337>