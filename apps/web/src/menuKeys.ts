/** Keyboard movement inside the match menu. Disabled rows are skipped. */
export function nextMenuIndex(key: string, index: number, enabled: readonly boolean[]): number | 'close' | null {
  const count = enabled.length;
  if (key === 'Escape' || key === 'Tab') return 'close';
  if (count === 0) return null;

  if (key === 'Home') {
    const first = enabled.findIndex(Boolean);
    return first >= 0 ? first : null;
  }
  if (key === 'End') {
    for (let cursor = count - 1; cursor >= 0; cursor -= 1) {
      if (enabled[cursor]) return cursor;
    }
    return null;
  }

  const step = key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0;
  if (step === 0) return null;
  for (let hop = 1; hop <= count; hop += 1) {
    const cursor = (index + step * hop + count * hop) % count;
    if (enabled[cursor]) return cursor;
  }
  return null;
}
