import { describe, expect, it } from 'vitest';
import { isAllowedOrigin } from './cors';
import { JOIN_FAILURE_LIMIT, allowRate, takeJoinFailure, takeLiveMessage, takeMatchRoute } from './rate';
import { classifyPath, limitsMatchRoute, matchIdFrom } from './routes';

const ID = '00000000-0000-4000-8000-0000000000aa';

describe('public routes', () => {
  it('exposes health, create, invite, and the match socket only', () => {
    expect(classifyPath('GET', '/health')).toBe('health');
    expect(classifyPath('POST', '/matches')).toBe('create');
    expect(classifyPath('POST', `/matches/${ID}/invites`)).toBe('invite');
    expect(classifyPath('POST', '/join')).toBe('ticket');
    expect(classifyPath('GET', '/ws/abcdefghijklmnopqrstuv')).toBe('socket');
    expect(classifyPath('POST', `/matches/${ID}/carry`)).toBe('carry');
    expect(classifyPath('POST', '/auth/google')).toBe('auth');
  });

  it('does not route internal or delete paths', () => {
    expect(classifyPath('POST', '/create')).toBe('none');
    expect(classifyPath('POST', '/discard')).toBe('none');
    expect(classifyPath('POST', '/internal/create')).toBe('none');
    expect(classifyPath('POST', '/internal/discard')).toBe('none');
    expect(classifyPath('DELETE', `/matches/${ID}`)).toBe('none');
    expect(classifyPath('GET', `/matches/${ID}/ws`)).toBe('none');
    expect(classifyPath('GET', '/matches/not-a-uuid/ws')).toBe('none');
    expect(classifyPath('GET', '/ws/short')).toBe('none');
    expect(matchIdFrom(`/matches/${ID}/ws`)).toBe(ID);
    expect(matchIdFrom('/matches')).toBeNull();
  });

  it('rate-limits every /matches route and not health', () => {
    expect(limitsMatchRoute('create')).toBe(true);
    expect(limitsMatchRoute('invite')).toBe(true);
    expect(limitsMatchRoute('socket')).toBe(true);
    expect(limitsMatchRoute('ticket')).toBe(true);
    expect(limitsMatchRoute('carry')).toBe(true);
    expect(limitsMatchRoute('health')).toBe(false);
    expect(limitsMatchRoute('auth')).toBe(false);
    expect(limitsMatchRoute('none')).toBe(false);
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

  it('counts pings in the same per-socket budget as events', () => {
    let stamps: readonly number[] = [];
    for (let i = 0; i < 9; i += 1) {
      const ping = takeLiveMessage(stamps, 'ping', 5_000 + i);
      expect(ping.ok).toBe(true);
      if (ping.ok) stamps = ping.stamps;
    }
    const played = takeLiveMessage(stamps, 'event', 5_009);
    expect(played.ok).toBe(true);
    if (played.ok) stamps = played.stamps;
    const blocked = takeLiveMessage(stamps, 'ping', 5_010);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe('slow_down');
  });

  it('shares one budget across /matches routes for one address', () => {
    const buckets = new Map<string, readonly number[]>();
    for (let i = 0; i < 20; i += 1) expect(takeMatchRoute(buckets, '203.0.113.9', 10_000 + i)).toBe(true);
    expect(takeMatchRoute(buckets, '203.0.113.9', 10_020)).toBe(false);
    expect(takeMatchRoute(buckets, '203.0.113.10', 10_020)).toBe(true);
    expect(takeMatchRoute(buckets, '203.0.113.9', 80_000)).toBe(true);
  });

  it('throttles failed joins inside one isolate before the shared route budget is full', () => {
    const buckets = new Map<string, readonly number[]>();
    expect(JOIN_FAILURE_LIMIT).toBe(5);
    expect(JOIN_FAILURE_LIMIT).toBeLessThan(20);
    for (let i = 0; i < JOIN_FAILURE_LIMIT; i += 1) {
      expect(takeJoinFailure(buckets, '198.51.100.80', 10_000 + i)).toBe(true);
    }
    expect(takeJoinFailure(buckets, '198.51.100.80', 10_010)).toBe(false);
    expect(takeJoinFailure(buckets, '198.51.100.81', 10_010)).toBe(true);
    expect(takeMatchRoute(new Map(), '198.51.100.80', 10_010)).toBe(true);
  });
});
