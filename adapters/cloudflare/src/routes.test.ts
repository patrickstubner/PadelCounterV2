import { describe, expect, it } from 'vitest';
import { isAllowedOrigin } from './cors';
import { allowRate } from './rate';
import { classifyPath, matchIdFrom } from './routes';

const ID = '00000000-0000-4000-8000-0000000000aa';

describe('public routes', () => {
  it('exposes health, create, invite, and the match socket only', () => {
    expect(classifyPath('GET', '/health')).toBe('health');
    expect(classifyPath('POST', '/matches')).toBe('create');
    expect(classifyPath('POST', `/matches/${ID}/invites`)).toBe('invite');
    expect(classifyPath('GET', `/matches/${ID}/ws`)).toBe('socket');
    expect(classifyPath('POST', '/auth/google')).toBe('auth');
  });

  it('does not route internal or delete paths', () => {
    expect(classifyPath('POST', '/create')).toBe('none');
    expect(classifyPath('POST', '/internal/create')).toBe('none');
    expect(classifyPath('DELETE', `/matches/${ID}`)).toBe('none');
    expect(classifyPath('GET', '/matches/not-a-uuid/ws')).toBe('none');
    expect(matchIdFrom(`/matches/${ID}/ws`)).toBe(ID);
    expect(matchIdFrom('/matches')).toBeNull();
  });
});

describe('origin allowlist', () => {
  it('allows the pages origin and localhost only in development', () => {
    expect(isAllowedOrigin('https://patrickstubner.github.io', 'production')).toBe(true);
    expect(isAllowedOrigin('https://evil.example', 'production')).toBe(false);
    expect(isAllowedOrigin('http://localhost:4173', 'production')).toBe(false);
    expect(isAllowedOrigin('http://localhost:4173', 'development')).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:8787', 'development')).toBe(true);
    expect(isAllowedOrigin('http://localhost', 'development')).toBe(false);
    expect(isAllowedOrigin(null, 'development')).toBe(false);
  });
});

describe('rate limit', () => {
  it('stops the 11th call inside one second', () => {
    let stamps: readonly number[] = [];
    for (let i = 0; i < 10; i += 1) {
      const next = allowRate(stamps, 1_000 + i);
      expect(next.ok).toBe(true);
      stamps = next.stamps;
    }
    expect(allowRate(stamps, 1_009).ok).toBe(false);
    expect(allowRate(stamps, 2_100).ok).toBe(true);
  });
});
