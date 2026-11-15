// Parität der zwei Event-Parser (Befund P-02, ADR-004, Testplan T-04).
// web: apps/web/src/domain/persistence.ts (lokaler Speicher), core: packages/core/src/parse.ts (Live/Server).
import { parseStoredEvent as coreParse } from '@padel/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseStoredEvent as webParse } from './persistence';

const T0 = 1_700_000_000_000;
const uuid = '00000000-0000-4000-8000-0000000000d1';
const team = fc.constantFrom('a', 'b', 'c', 1, null);
const by = fc.option(fc.constantFrom('host', 'device', 'p1', 'p2', 'x', ''), { nil: undefined });

const kandidat = fc.oneof(
  fc.record({ type: fc.constantFrom('game/increment', 'game/decrement'), team, at: fc.constantFrom(T0, -1, 'x'), by }),
  fc.record({ type: fc.constant('set/select'), index: fc.constantFrom(0, 1, 2, 3, -1, '1'), at: fc.constant(T0), by }),
  fc.record({ type: fc.constantFrom('match/reset', 'match/new'), matchId: fc.constantFrom(uuid, uuid.toUpperCase(), 'kein-uuid'), at: fc.constant(T0), by }),
  fc.record({ type: fc.constantFrom('match/end', 'match/resume'), at: fc.constant(T0), by }),
  fc.record({ type: fc.constant('serve/set'), team, player: fc.constantFrom(1, 2, 3, null), at: fc.constant(T0), by }),
  fc.record({ type: fc.constant('unbekannt'), at: fc.constant(T0) }),
);

describe('Parser-Parität web ↔ core (ohne team/rename)', () => {
  it('beide akzeptieren oder verwerfen dasselbe Event gleich', () => {
    fc.assert(
      fc.property(kandidat, (raw) => {
        const w = webParse(raw);
        const c = coreParse(raw);
        expect(w === null, JSON.stringify(raw)).toBe(c === null);
        if (w && c) expect(w).toMatchObject({ type: c.type, at: c.at });
      }),
    );
  });
});

describe('Bekannte Abweichung team/rename (IST, P-02)', () => {
  it('web verwirft Namen über 80 Zeichen, core kürzt sie', () => {
    const raw = { type: 'team/rename', team: 'a', name: 'x'.repeat(100), at: T0 };
    expect(webParse(raw)).toBeNull();
    expect(coreParse(raw)).not.toBeNull();
  });
});
