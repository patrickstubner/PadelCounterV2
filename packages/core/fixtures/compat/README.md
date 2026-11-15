# Kompatibilitäts-Fixtures (ADR-003)

Eingefrorene Speicherstände. **Nie ändern, nur ergänzen.** Wer ein Format ändert, legt neue Dateien dazu.

| Datei | Herkunft |
|---|---|
| `log-v2-2.3.8-*.json` | erzeugt am 15.11.2026 mit App 2.3.8 (Commit 85f24e4) über `createLog`/`appendEvent`/`serializeLog` |
| `archive-v1-2.3.8-ein-match.json` | ebenso, `snapshotMatch` des Sieg-Logs, gespeichert wie `saveArchive` |
| `log-v1-rekonstruiert-*.json` | Schema 1 aus dem Lese-Vertrag in `apps/web/src/domain/persistence.ts` rekonstruiert (die Git-Historie beginnt bei Schema 2) |
| `log-v3-zukunft-unbekannt.json` | Negativfall: Log einer künftigen Version mit unbekanntem Feld |
| `archive-v1-ein-eintrag-kaputt.json` | Negativfall: ein gültiges und ein ungültiges Match |
| `expected/<log>.json` | erwarteter Spielstand nach dem Replay |

Test: `apps/web/src/domain/compat.test.ts`.
