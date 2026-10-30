import { useEffect, useId, useRef, useState } from 'react';
import { copyPlainCode, copyTextFallback, sendMatchCode } from '../live/protocol';
import { QrCode } from './QrCode';

interface ConnectPageProps {
  readonly configured: boolean;
  readonly mode: 'choose' | 'show';
  readonly status: 'off' | 'connecting' | 'live';
  readonly players: number;
  readonly qr: string | null;
  readonly code: string | null;
  readonly error: string | null;
  readonly onShow: () => void;
  readonly onScan: () => void;
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
  mode,
  status,
  players,
  qr,
  code,
  error,
  onShow,
  onScan,
  onRotate,
  onLeave,
  onClose,
}: ConnectPageProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [sent, setSent] = useState<'copied' | 'code' | null>(null);
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
        className={mode === 'show' && qr ? 'connect-dialog connect-bright' : 'connect-dialog'}
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
        <h2 id={titleId}>Connect</h2>
        {mode === 'choose' ? (
          <p>Show the code for another phone, or scan a code to join. Up to 4 phones.</p>
        ) : (
          <p>Players who scan this code see the match and can change the games. Up to 4 phones.</p>
        )}
        {configured ? null : (
          <p data-testid="connect-unconfigured">
            Live sharing is not configured in this build. The score stays on this device.
          </p>
        )}
        {mode === 'show' && error ? <p data-testid="connect-error">{error}</p> : null}
        {mode === 'show' && status === 'connecting' ? <p data-testid="connect-waiting">Connecting…</p> : null}
        {mode === 'show' && status === 'live' ? <p data-testid="player-count">{`Live · ${players} of 4 players`}</p> : null}
        {mode === 'show' && qr ? (
          <div className="qr-stage" data-testid="qr-stage">
            <QrCode text={qr} />
            <p data-testid="qr-brightness">Turn this screen to full brightness, then hold it flat toward the other phone.</p>
            <p data-testid="qr-note">This code works for 2 hours.</p>
            <p data-testid="new-code-note">New code turns this code off and disconnects the phones that joined with it.</p>
            {code ? (
              <>
                <p className="match-code" data-testid="match-code">{code}</p>
                <div className="code-actions">
                  <button
                    type="button"
                    className="text-btn"
                    data-testid="share-code"
                    onClick={() => {
                      const pageHref = typeof location === 'undefined' ? '' : location.href;
                      void sendMatchCode(code, pageHref, {
                        share: typeof navigator.share === 'function' ? (data) => navigator.share(data) : undefined,
                        clipboard: typeof navigator.clipboard?.writeText === 'function' ? navigator.clipboard : undefined,
                      }).then((result) => {
                        setSent(result === 'copied' ? 'copied' : null);
                      });
                    }}
                  >
                    Share link
                  </button>
                  <button
                    type="button"
                    className="text-btn"
                    data-testid="copy-code"
                    onClick={() => {
                      void copyPlainCode(code, async (value) => {
                        const clip = navigator.clipboard;
                        if (clip && typeof clip.writeText === 'function') {
                          try {
                            await clip.writeText(value);
                            return;
                          } catch {
                            // A blocked clipboard still has the temporary-field fallback.
                          }
                        }
                        if (!copyTextFallback(value)) throw new Error('copy');
                      }).then((result) => {
                        setSent(result === 'copied' ? 'code' : null);
                      });
                    }}
                  >
                    Copy code
                  </button>
                </div>
                {sent === 'copied' ? <p data-testid="code-copied">Copied.</p> : null}
                {sent === 'code' ? <p data-testid="code-only-copied">Copied.</p> : null}
              </>
            ) : null}
          </div>
        ) : null}
        {mode === 'choose' ? (
          <div className="connect-choices">
            <button type="button" className="connect-choice" data-testid="show-qr" onClick={onShow}>
              Show QR code
              <small>Connect another player. Includes a code to type.</small>
            </button>
            <button type="button" className="connect-choice" data-testid="scan-qr" onClick={onScan}>
              Scan QR code
              <small>Join a match with the camera or a typed code.</small>
            </button>
          </div>
        ) : null}
        {mode === 'show' && (qr || status === 'live') ? (
          <div className="connect-actions">
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
          </div>
        ) : null}
      </div>
    </div>
  );
}
