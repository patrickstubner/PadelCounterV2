import { describe, expect, it } from 'vitest';
import {
  deviceKindFromAgent,
  parsePublicPhones,
  publicPhoneList,
} from './phones';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile';
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0';

describe('device kind', () => {
  it('keeps only the coarse class', () => {
    expect(deviceKindFromAgent(IPHONE)).toBe('iphone');
    expect(deviceKindFromAgent(ANDROID)).toBe('android');
    expect(deviceKindFromAgent(DESKTOP)).toBe('desktop');
    expect(deviceKindFromAgent('SomeOtherPhone/1.0')).toBe('other');
    expect(deviceKindFromAgent('')).toBe('other');
    expect(deviceKindFromAgent(null)).toBe('other');
    expect(deviceKindFromAgent('x'.repeat(513))).toBe('other');
  });
});

describe('public phone list', () => {
  it('drops tokens, addresses, and the raw agent', () => {
    const listed = publicPhoneList(
      [
        {
          deviceId: 'd11111111000000000000000000000000',
          seat: 'host',
          since: 1_700_000_000_000,
          seen: 1_700_000_000_100,
          online: true,
          kind: 'iphone',
          token: 'abcdefghijklmnopqrstuv',
          ip: '203.0.113.10',
          userAgent: IPHONE,
        } as never,
      ],
      'd11111111000000000000000000000000',
    );
    expect(listed).toEqual([
      {
        seat: 'host',
        since: 1_700_000_000_000,
        seen: 1_700_000_000_100,
        online: true,
        kind: 'iphone',
        self: true,
      },
    ]);
    const wire = JSON.stringify({ type: 'roster', phones: listed });
    expect(wire).not.toContain('abcdefghijklmnopqrstuv');
    expect(wire).not.toContain('203.0.113.10');
    expect(wire).not.toContain('Mozilla');
    expect(wire).not.toContain('d11111111000000000000000000000000');
    expect(wire).not.toContain('userAgent');
  });

  it('marks only the matching device and ignores a forged kind', () => {
    const listed = publicPhoneList(
      [
        { deviceId: 'd22222222000000000000000000000000', seat: 'p2', since: 10, seen: 20, online: false, kind: 'android' },
        { deviceId: 'd33333333000000000000000000000000', seat: 'p3', since: 11, seen: 21, online: true, kind: 'not-a-kind' },
      ],
      'd11111111000000000000000000000000',
    );
    expect(listed).toEqual([
      { seat: 'p2', since: 10, seen: 20, online: false, kind: 'android', self: false },
    ]);
  });

  it('parses an allowlisted roster and ignores extra fields', () => {
    const parsed = parsePublicPhones([
      {
        seat: 'p2',
        since: 10,
        seen: 20,
        online: true,
        kind: 'desktop',
        self: true,
        token: 'abcdefghijklmnopqrstuv',
        ip: '198.51.100.20',
        userAgent: DESKTOP,
      },
    ]);
    expect(parsed).toEqual([
      { seat: 'p2', since: 10, seen: 20, online: true, kind: 'desktop', self: true },
    ]);
    expect(JSON.stringify(parsed)).not.toContain('token');
    expect(JSON.stringify(parsed)).not.toContain('198.51.100.20');
    expect(JSON.stringify(parsed)).not.toContain('Mozilla');
    expect(parsePublicPhones([{ seat: 'p2', since: 10, seen: 20, online: true, kind: 'phone', self: false }])).toBeNull();
    expect(parsePublicPhones('phones')).toBeNull();
  });
});
