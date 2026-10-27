import { describe, expect, it } from 'vitest';
import { nextMenuIndex } from './menuKeys';

const rows = [true, false, true];

describe('match menu keys', () => {
  it('closes on Escape and Tab', () => {
    expect(nextMenuIndex('Escape', 0, rows)).toBe('close');
    expect(nextMenuIndex('Tab', 2, rows)).toBe('close');
  });

  it('moves between enabled rows and skips a disabled one', () => {
    expect(nextMenuIndex('ArrowDown', 0, rows)).toBe(2);
    expect(nextMenuIndex('ArrowDown', 2, rows)).toBe(0);
    expect(nextMenuIndex('ArrowUp', 0, rows)).toBe(2);
    expect(nextMenuIndex('Home', 2, rows)).toBe(0);
    expect(nextMenuIndex('End', 0, rows)).toBe(2);
  });

  it('ignores keys that do not move the menu', () => {
    expect(nextMenuIndex('Enter', 0, rows)).toBeNull();
    expect(nextMenuIndex('ArrowDown', 0, [])).toBeNull();
  });
});
