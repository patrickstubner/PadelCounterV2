import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './ErrorBoundary';
import { holdJoin, readJoinToken } from './live/protocol';
import { registerServiceWorker } from './registerServiceWorker';
import './app.css';

function sessionOrNull(win: Window): Storage | null {
  try {
    return win.sessionStorage;
  } catch {
    return null;
  }
}

/** Strip a join fragment before paint and keep the token even when storage throws. */
export function bootPage(win: Window): void {
  holdJoin(readJoinToken(win.location, win.history, sessionOrNull(win)));
}

bootPage(window);

const root = document.getElementById('root');
if (!root) {
  throw new Error('Missing root');
}

const reactRoot = createRoot(root);
export function unmountPage(): void {
  reactRoot.unmount();
}

reactRoot.render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

if (import.meta.env.PROD) {
  registerServiceWorker();
}
