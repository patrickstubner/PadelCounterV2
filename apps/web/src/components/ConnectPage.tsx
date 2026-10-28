import { useEffect, useId, useRef } from 'react';
import { QrCode } from './QrCode';

interface ConnectPageProps {
  readonly configured: boolean;
  readonly host: boolean;
  readonly status: 'off' | 'connecting' | 'live';
  readonly players: number;
  readonly qr: string | null;
  readonly error: string | null;
  readonly onShare: () => void;
  readonly onRotate: () => void;
  readonly onLeave: () => void;
  readonly onClose: () => void;
}

function focusable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
    (node) => !node.hasAttribute('disabled'),
  );
}

export function ConnectPage({
  configured,
  host,
  status,
  players,
  qr,
  error,
  onShare,
  onRotate,
  onLeave,
  onClose,
}: ConnectPageProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = focusable(panel);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const index = items.indexOf(document.activeElement as HTMLElement);
      event.preventDefault();
      const next = event.shiftKey
        ? items[(index <= 0 ? items.length : index) - 1]
        : items[index < 0 || index === items.length - 1 ? 0 : index + 1];
      next?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const restore = previous;
      queueMicrotask(() => {
        const hidden = restore?.closest('[hidden]');
        if (restore && restore !== document.body && restore.isConnected && !hidden) {
          restore.focus();
          return;
        }
        const opener = document.querySelector<HTMLElement>('[data-testid="menu-toggle"]')
          ?? document.querySelector<HTMLElement>('[data-testid="connect-open"]');
        opener?.focus();
      });
    };
  }, []);

  return (
    <div
      className="connect-overlay"
      data-testid="connect-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="connect-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="connect-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="connect-dialog-bar">
          <button
            ref={closeRef}
            type="button"
            className="connect-x"
            data-testid="connect-close-x"
            aria-label="Close"
            onClick={onClose}
          >
            X
          </button>
        </div>
        <h2 id={titleId}>Connect players</h2>
        <p>Players who scan this code see the match and can change the games. Up to 4 phones.</p>
        {configured ? null : (
          <p data-testid="connect-unconfigured">
            Live sharing is not configured in this build. The score stays on this device.
          </p>
        )}
        {error ? <p data-testid="connect-error">{error}</p> : null}
        {status === 'connecting' ? <p data-testid="connect-waiting">Connecting…</p> : null}
        {status === 'live' ? <p data-testid="player-count">{`Live · ${players} of 4 players`}</p> : null}
        {qr ? (
          <>
            <QrCode text={qr} />
            <p>The code works for 2 hours. A new code turns this one off. Phones that already joined stay connected.</p>
          </>
        ) : null}
        <div className="connect-actions">
          {configured && host && !qr && status !== 'connecting' ? (
            <button type="button" className="text-btn" data-testid="share-match" onClick={onShare}>
              Show QR code
            </button>
          ) : null}
          {qr ? (
            <button type="button" className="text-btn" data-testid="rotate-code" onClick={onRotate}>
              New code
            </button>
          ) : null}
          {status === 'live' ? (
            <button type="button" className="text-btn" data-testid="leave-live" onClick={onLeave}>
              Leave live match
            </button>
          ) : null}
          <button type="button" className="text-btn" data-testid="connect-close" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
