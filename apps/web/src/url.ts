import { PAGE_BASE } from './base';

/** Join a path with the deployed base, keeping a trailing slash only for the root. */
export function withBase(path: string): string {
  const fromEnv = import.meta.env.BASE_URL || PAGE_BASE;
  const base = fromEnv.endsWith('/') ? fromEnv.slice(0, -1) : fromEnv;
  if (path === '') return `${base}/`;
  return `${base}/${path.replace(/^\//, '')}`;
}
