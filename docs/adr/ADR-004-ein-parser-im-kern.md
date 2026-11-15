# ADR-004: Ein Parser für das Match-Log im Kern
Status: **vorgeschlagen** (15.11.2026)

## Kontext
`packages/core/src/parse.ts` und `apps/web/src/domain/persistence.ts` validieren dasselbe Log-Format getrennt. Weichen sie voneinander ab, akzeptiert der Server etwas, das der lokale Speicher verwirft (→ P-01).

## Entscheid (Vorschlag)
1. Zuerst ein Paritätstest (fast-check):
   - Zufällige gültige und ungültige Logs gehen durch beide Parser.
   - Die Ergebnisse müssen gleich sein.
   - Abweichungen werden dokumentiert, z. B. die lokalen Limits.
2. Danach nutzt `persistence.ts` nur noch die Kernfunktionen (`parseStoredEvent`, `parseState`), ergänzt um lokale Limits als Parameter.
3. Der alte lokale Parser wird gelöscht (Aufrufer migrieren, dann löschen).

## Folgen
- Risiko: **mittel**, weil Produktcode im Speicherpfad betroffen ist. Nur hinter ADR-001 und ADR-003 (Netz zuerst).
