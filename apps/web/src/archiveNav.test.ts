import { describe, expect, it } from 'vitest';
import { detailHistoryState, matchesHistoryState, screenFromHistory } from './archiveNav';

const ID = '00000000-0000-4000-8000-0000000000aa';

describe('archive back stack', () => {
  it('reads the two history levels and ignores anything else', () => {
    expect(screenFromHistory(null)).toEqual({ view: 'court' });
    expect(screenFromHistory(matchesHistoryState())).toEqual({ view: 'matches' });
    expect(screenFromHistory(detailHistoryState(ID))).toEqual({ view: 'detail', id: ID });
    expect(screenFromHistory({ padelArchive: 'detail', id: 'not-a-match' })).toEqual({ view: 'court' });
    expect(screenFromHistory({ padelArchive: 'court' })).toEqual({ view: 'court' });
  });
});
