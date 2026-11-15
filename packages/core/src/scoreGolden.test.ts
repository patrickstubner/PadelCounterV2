// Score-Golden-Sequenzen (Testplan T-03). fixtures/score/sequenzen.json wird nie geändert, nur ergänzt.
import { describe, expect, it } from 'vitest';
import { createMatch, replayScore } from './reducer';
import { matchResult } from './rules';
import sequenzen from '../fixtures/score/sequenzen.json';
import { expand } from './scoreGolden.helpers';

type Golden = Record<string, { seq: string; expected: unknown }>;
const golden: Golden = sequenzen;

describe('Score-Golden-Sequenzen', () => {
  it('enthält die Pflichtfälle aus dem Testplan', () => {
    for (const name of [
      'sieg-6-4-6-4',
      'tiebreak-7-6-6-0',
      'satzausgleich-dritter-satz-6-3',
      'minus-und-null-grenze',
      'aufschlag-rotation',
    ])
      expect(golden[name], name).toBeDefined();
  });

  it.each(Object.entries(golden))('%s', (_name, { seq, expected }) => {
    const base = createMatch(1_700_000_000_000, '00000000-0000-4000-8000-0000000000b1');
    const s = replayScore(base, expand(seq));
    expect({
      sets: s.sets,
      activeSet: s.activeSet,
      serve: s.serve,
      ended: s.ended,
      matchId: s.matchId,
      names: [s.teams.a.name, s.teams.b.name],
      result: matchResult(s),
    }).toEqual(expected);
  });
});
