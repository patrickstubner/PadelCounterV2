import { describe, expect, it } from 'vitest';
import { canonicalCausalId } from './id';

describe('canonicalCausalId', () => {
  it('accepts null, a uuid, and a seed id, and rejects any other string', () => {
    expect(canonicalCausalId(null)).toBeNull();
    expect(canonicalCausalId('00000000-0000-4000-8000-0000000000AB')).toBe('00000000-0000-4000-8000-0000000000ab');
    expect(canonicalCausalId('SEED-12')).toBe('seed-12');
    expect(canonicalCausalId('seed-9999')).toBe('seed-9999');
    expect(canonicalCausalId('seed-0')).toBeUndefined();
    expect(canonicalCausalId('seed-10000')).toBeUndefined();
    expect(canonicalCausalId('offline-not-on-server')).toBeUndefined();
    expect(canonicalCausalId('')).toBeUndefined();
    expect(canonicalCausalId(12)).toBeUndefined();
    expect(canonicalCausalId(undefined)).toBeUndefined();
  });
});
