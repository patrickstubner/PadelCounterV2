# ADR-001: Lokale Daten nie stillschweigend überschreiben
Status: **vorgeschlagen** (15.11.2026)

## Kontext
`useMatch` lädt `pcv2:log` und `pcv2:matches`. Schlägt das Parsen fehl (unbekannte `schemaVersion`, ein ungültiger Archiv-Eintrag, strengerer Parser), entsteht ein neuer Zustand, und der Effekt überschreibt sofort den Speicher. Bei Schema-Bumps, Rollbacks oder gecachten alten PWA-Versionen bedeutet das Datenverlust.

## Entscheid (Vorschlag)
1. **Quarantäne:** Bevor ein nicht lesbarer Rohwert ersetzt wird, wird er unter `pcv2:quarantine:<key>:<epochMs>` gesichert (max. 3 Kopien, ältere fallen weg).
2. **Vorwärts-Schutz:** Ist `schemaVersion` grösser als bekannt, schreibt die App **nicht**. Sie startet ein temporäres Match im Speicher und zeigt: «Diese Daten stammen von einer neueren Version. Bitte App aktualisieren.»
3. **Archiv tolerant:** Ungültige Einträge werden einzeln übersprungen und in Quarantäne gelegt. Der Rest bleibt erhalten.
4. **Migrationskette:** `migrate(vN → vN+1)` als reine Funktionen im core. Jede Version bekommt eine Fixture-Datei.
5. **Expand/Contract:** Ein neues Feld wird zuerst optional gelesen (Version N), erst in N+1 geschrieben und frühestens in N+2 verpflichtend.

## Folgen
- Geringer Code-Umfang. Betroffen sind nur `persistence.ts`, `archive.ts` und `useMatch.ts`.
- Zuerst kommen die Tests (Golden-Fixtures, siehe testplan.md T-01/T-02), danach die Änderung. Das verhält sich für heutige Daten identisch.
- Risiko für den laufenden Code: **gering bis mittel**. Das Verhalten ändert sich nur im Fehlerfall.
