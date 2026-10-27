import { describe, expect, it } from 'vitest';
import { JOIN_TOKEN_TTL_MS, MAX_PLAYERS, decideJoin } from './join';
import { ROOM_MESSAGES } from './messages';

const now = 1_700_000_000_000;

function join(overrides: Partial<Parameters<typeof decideJoin>[0]> = {}) {
  return decideJoin({
    role: 'player',
    connectedPlayers: 0,
    expiresAt: now + JOIN_TOKEN_TTL_MS,
    now,
    revoked: false,
    ...overrides,
  });
}

describe('join admission', () => {
  it('admits a player while the room is under the cap', () => {
    expect(join({ connectedPlayers: 0 }).ok).toBe(true);
    expect(join({ connectedPlayers: MAX_PLAYERS - 1 }).ok).toBe(true);
  });

  it('rejects the 5th player with a clear message', () => {
    const decision = join({ connectedPlayers: MAX_PLAYERS });
    expect(decision.ok).toBe(false);
    expect(decision.code).toBe('match_full');
    expect(decision.message).toBe(ROOM_MESSAGES.match_full);
    expect(decision.message).toBe('This match already has 4 players.');
    expect(join({ connectedPlayers: MAX_PLAYERS + 3 }).ok).toBe(false);
  });

  it('rejects a spectator even when the room is empty', () => {
    const decision = join({ role: 'spectator', connectedPlayers: 0 });
    expect(decision.ok).toBe(false);
    expect(decision.code).toBe('spectator_not_available');
    expect(decision.message).toBe('View-only links are not available yet.');
  });

  it('rejects expired and revoked codes before checking the cap', () => {
    expect(join({ expiresAt: now }).code).toBe('expired');
    expect(join({ expiresAt: now - 1 }).message).toBe('This code has expired. Ask for a new one.');
    expect(join({ revoked: true }).code).toBe('revoked');
  });
});
