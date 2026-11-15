# ADR-003: Eingefrorene Kompatibilitäts-Fixtures für Speicher und Protokoll
Status: **vorgeschlagen** (15.11.2026)

## Kontext
Die Tests erzeugen Speicherstände und Nachrichten meist inline mit dem **aktuellen** Code. Ändert sich das Format, ändern sich Test und Code gemeinsam, und die Regression fällt nicht auf.

## Entscheid (Vorschlag)
- Ordner `packages/core/fixtures/compat/`:
  - `log-v1-*.json`, `log-v2-2.3.8-*.json` und `archive-v1-*.json` stammen aus echten App-Versionen. Erzeugt werden sie einmal per Skript aus den Git-Tags bzw. Commits und dann **nie mehr geändert**.
  - `ws-2.3.8-*.jsonl` enthält aufgezeichnete Client↔Worker-Nachrichten (Hello, Play, Ack, Restore).
  - `expected/*.json` hält erwartete Spielstände nach dem Replay fest (Sätze, Games, Aufschlag, Sieger).
- Der Test `compat.test.ts` prüft für jede Fixture:
  - Lesen gelingt.
  - Das Replay ergibt den erwarteten Spielstand.
  - Zurückschreiben und erneutes Lesen ergibt dasselbe (Round-trip).
- Der Worker-Test spielt die WS-Transkripte gegen den aktuellen `MatchRoom` ab.
- Regel: Wer das Format ändert, legt **neue** Fixtures dazu und ändert keine alten.

## Folgen
- Nur zusätzliche Tests, keine Änderung am Produktcode.
- Risiko: **gering**.
