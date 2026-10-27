import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './ErrorBoundary';
import { captureJoinHash } from './live/protocol';
import { registerServiceWorker } from './registerServiceWorker';
import './app.css';

try {
  captureJoinHash(window.location, window.history, window.sessionStorage);
} catch {
  // The court still opens when storage is blocked.
}

const root = document.getElementById('root');
if (!root) {
  throw new Error('Missing root');
}

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

if (import.meta.env.PROD) {
  registerServiceWorker();
}
