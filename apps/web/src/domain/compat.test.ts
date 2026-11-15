// Kompatibilitäts-Fixtures (ADR-003, Testplan T-01/T-02).
// Die Dateien in packages/core/fixtures/compat/ werden nie geändert, nur ergänzt.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ARCHIVE_KEY, loadArchive, parseArchive, saveArchive } from './archive';
import { createLog, replay, type MatchLog } from './log';
import { STORAGE_KEY, loadLog, parsePersisted, saveLog, serializeLog, type MatchStorage } from './persistence';

const DIR = new URL('../../../../packages/core/fixtures/compat/', import.meta.url);
const raw = (name: string) => readFileSync(new URL(name, DIR), 'utf8');
const json = (name: string): unknown => JSON.parse(raw(name));

function memory(initial: Record<string, string> = {}): MatchStorage & { values(): string[] } {
  const data = new Map(Object.entries(initial));
  return {
    values: () => [...data.values()],
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

function summary(log: MatchLog) {
  const s = replay(log);
  return { matchId: s.matchId, activeSet: s.activeSet, sets: s.sets, teams: s.teams, serve: s.serve, ended: s.ended, events: log.events.length };
}

/** Bildet den Start in useMatch nach: laden, sonst neu anlegen, danach sofort speichern. */
function appStart(storage: MatchStorage) {
  const log = loadLog(storage) ?? createLog(1_800_000_000_000, '00000000-0000-4000-8000-0000000000ff');
  const archive = loadArchive(storage);
  saveLog(log, storage);
  saveArchive(archive, storage);
  return { log, archive };
}

const logFixtures = readdirSync(DIR).filter((f) => /^log-v[12]-.*\.json$/.test(f));

describe('T-01: gespeicherte Logs aus früheren Versionen', () => {
  it('es gibt Fixtures für v1 und v2', () => {
    expect(logFixtures.some((f) => f.startsWith('log-v1-'))).toBe(true);
    expect(logFixtures.some((f) => f.startsWith('log-v2-'))).toBe(true);
  });

  describe.each(logFixtures)('%s', (name) => {
    it('wird gelesen und ergibt den erwarteten Spielstand', () => {
      const log = loadLog(memory({ [STORAGE_KEY]: raw(name) }));
      expect(log).not.toBeNull();
      expect(summary(log as MatchLog)).toEqual(json(`expected/${name}`));
    });

    it('Round-trip: speichern und wieder lesen ergibt denselben Spielstand', () => {
      const log = parsePersisted(json(name)) as MatchLog;
      const again = parsePersisted(JSON.parse(serializeLog(log)));
      expect(again).not.toBeNull();
      expect(summary(again as MatchLog)).toEqual(summary(log));
    });
  });
});

describe('T-01: Archiv v1', () => {
  it('liest das Match aus 2.3.8 vollständig', () => {
    const archive = parseArchive(json('archive-v1-2.3.8-ein-match.json'));
    expect(archive).toHaveLength(1);
    expect(archive[0]?.status).toBe('winner-a');
    expect(archive[0]?.sets).toEqual([{ a: 6, b: 4 }, { a: 6, b: 2 }, { a: 0, b: 0 }]);
    expect(archive[0]?.events).toHaveLength(23);
  });

  it('Round-trip über localStorage', () => {
    const archive = parseArchive(json('archive-v1-2.3.8-ein-match.json'));
    const s = memory();
    expect(saveArchive(archive, s)).toBe(true);
    expect(loadArchive(s)).toEqual(archive);
  });
});

describe('T-02: Daten nie stillschweigend überschreiben (ADR-001)', () => {
  it('IST: ein Log einer neueren Version wird heute nicht gelesen', () => {
    expect(loadLog(memory({ [STORAGE_KEY]: raw('log-v3-zukunft-unbekannt.json') }))).toBeNull();
  });

  it('IST: ein kaputter Eintrag verwirft heute das ganze Archiv', () => {
    expect(parseArchive(json('archive-v1-ein-eintrag-kaputt.json'))).toEqual([]);
  });

  // Die folgenden Tests beschreiben das Soll nach ADR-001 (PC-8). Heute schlagen sie fehl,
  // deshalb it.fails. Wird PC-8 umgesetzt, meldet Vitest sie als «unerwartet grün»: dann `.fails` entfernen.
  it.fails('SOLL: nach dem Start mit einem Log einer neueren Version sind die Rohdaten noch vorhanden', () => {
    const original = raw('log-v3-zukunft-unbekannt.json');
    const s = memory({ [STORAGE_KEY]: original });
    appStart(s);
    expect(s.values()).toContain(original);
  });

  it.fails('SOLL: ein kaputter Archiv-Eintrag kostet nur diesen Eintrag', () => {
    expect(parseArchive(json('archive-v1-ein-eintrag-kaputt.json'))).toHaveLength(1);
  });

  it.fails('SOLL: nach dem Start mit einem teilweise kaputten Archiv bleibt das gültige Match erhalten', () => {
    const s = memory({ [ARCHIVE_KEY]: raw('archive-v1-ein-eintrag-kaputt.json') });
    appStart(s);
    expect(loadArchive(s)).toHaveLength(1);
  });
});
