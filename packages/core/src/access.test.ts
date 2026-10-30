import { describe, expect, it } from 'vitest';
import { actionForEvent, canPerform, type Credential } from './access';

const player: Credential = { role: 'player', host: false };
const host: Credential = { role: 'player', host: true };
const spectator: Credential = { role: 'spectator', host: false };
const spectatorHost: Credential = { role: 'spectator', host: true };

describe('role checks', () => {
  it('lets a player score, rename, choose serve, and end the match', () => {
    expect(canPerform(player, 'score')).toBe(true);
    expect(canPerform(player, 'rename')).toBe(true);
    expect(canPerform(player, 'select_set')).toBe(true);
    expect(canPerform(player, 'serve')).toBe(true);
    expect(canPerform(player, 'end_match')).toBe(true);
    expect(canPerform(player, 'resume_match')).toBe(true);
  });

  it('lets any player show an invite and still refuses a spectator', () => {
    expect(canPerform(host, 'issue_invite')).toBe(true);
    expect(canPerform(player, 'issue_invite')).toBe(true);
    expect(canPerform(spectator, 'issue_invite')).toBe(false);
  });

  it('denies every action to a spectator, including a forged host flag', () => {
    const actions = ['score', 'rename', 'select_set', 'serve', 'end_match', 'resume_match', 'issue_invite'] as const;
    for (const action of actions) {
      expect(canPerform(spectator, action)).toBe(false);
      expect(canPerform(spectatorHost, action)).toBe(false);
    }
  });

  it('maps court events to actions and drops undo', () => {
    expect(actionForEvent('game/increment')).toBe('score');
    expect(actionForEvent('game/decrement')).toBe('score');
    expect(actionForEvent('team/rename')).toBe('rename');
    expect(actionForEvent('undo')).toBeNull();
    expect(actionForEvent('game_won')).toBeNull();
  });
});
