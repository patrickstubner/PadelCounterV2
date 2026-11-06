/** Header colours. Solo is black, a live match is blue, offline is dark red. */
export const COURT_CHROME = {
  local: '#000000',
  online: '#0a1a3f',
  offline: '#3a1016',
} as const;

export type CourtChromeTone = keyof typeof COURT_CHROME;

/**
 * Paint the browser chrome with the header colour.
 * `black-translucent` lets iPhone draw the page under the status bar, so the
 * safe area and `theme-color` can match the header. The meta value is not a colour.
 */
export function syncCourtChrome(tone: CourtChromeTone, doc: Document): void {
  const root = doc.documentElement;
  root.classList.toggle('is-online', tone === 'online');
  root.classList.toggle('is-offline', tone === 'offline');
  doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', COURT_CHROME[tone]);
  doc.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.setAttribute('content', 'black-translucent');
}
