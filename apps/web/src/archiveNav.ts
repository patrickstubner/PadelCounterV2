import { isUuid } from './domain/id';

export type ArchiveScreen =
  | { readonly view: 'court' }
  | { readonly view: 'matches' }
  | { readonly view: 'detail'; readonly id: string }
  | { readonly view: 'privacy' }
  | { readonly view: 'connect' };

export function screenFromHistory(state: unknown): ArchiveScreen {
  if (typeof state !== 'object' || state === null) return { view: 'court' };
  const record = state as Record<string, unknown>;
  if (record.padelArchive === 'matches') return { view: 'matches' };
  if (record.padelArchive === 'privacy') return { view: 'privacy' };
  if (record.padelArchive === 'connect') return { view: 'connect' };
  if (record.padelArchive === 'detail' && isUuid(record.id)) return { view: 'detail', id: record.id.toLowerCase() };
  return { view: 'court' };
}

export function matchesHistoryState(): { readonly padelArchive: 'matches' } {
  return { padelArchive: 'matches' };
}

export function detailHistoryState(id: string): { readonly padelArchive: 'detail'; readonly id: string } {
  return { padelArchive: 'detail', id };
}

export function privacyHistoryState(): { readonly padelArchive: 'privacy' } {
  return { padelArchive: 'privacy' };
}

export function connectHistoryState(): { readonly padelArchive: 'connect' } {
  return { padelArchive: 'connect' };
}
