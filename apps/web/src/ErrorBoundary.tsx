import { Component, type ReactNode } from 'react';
import { ARCHIVE_KEY } from './domain/archive';
import { CELEBRATED_KEY } from './domain/celebration';
import { STORAGE_KEY } from './domain/persistence';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  failed: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="fatal" role="alert">
        <p>Padel Counter could not show the score.</p>
        <button
          type="button"
          onClick={() => {
            try {
              localStorage.removeItem(STORAGE_KEY);
              localStorage.removeItem(ARCHIVE_KEY);
              localStorage.removeItem(CELEBRATED_KEY);
            } catch {
              // Storage may be blocked; reload anyway.
            }
            window.location.reload();
          }}
        >
          Reload
        </button>
        <p className="fatal-note">The score and saved matches on this device will be deleted.</p>
      </div>
    );
  }
}
