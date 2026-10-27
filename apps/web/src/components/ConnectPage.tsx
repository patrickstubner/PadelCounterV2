import { QrCode } from './QrCode';

interface ConnectPageProps {
  readonly configured: boolean;
  readonly status: 'off' | 'connecting' | 'live';
  readonly players: number;
  readonly qr: string | null;
  readonly error: string | null;
  readonly onShare: () => void;
  readonly onRotate: () => void;
  readonly onLeave: () => void;
  readonly onBack: () => void;
}

export function ConnectPage({
  configured,
  status,
  players,
  qr,
  error,
  onShare,
  onRotate,
  onLeave,
  onBack,
}: ConnectPageProps) {
  return (
    <section className="history-page" data-testid="connect-page" aria-label="Connect players">
      <div className="history-bar">
        <button type="button" className="history-back" data-testid="connect-back" onClick={onBack}>
          Match
        </button>
        <h1 className="history-title">Connect players</h1>
      </div>
      <div className="history-scroll privacy-copy">
        <p>Players who scan this code see the match and can change the games. Up to 4 phones.</p>
        {configured ? null : (
          <p data-testid="connect-unconfigured">
            Live sharing is not configured in this build. The score stays on this device.
          </p>
        )}
        {error ? <p data-testid="connect-error">{error}</p> : null}
        {status === 'live' ? <p data-testid="player-count">{`Live · ${players} of 4 players`}</p> : null}
        {qr ? (
          <>
            <QrCode text={qr} />
            <p>The code works for 2 hours. A new code turns this one off. Phones that already joined stay connected.</p>
          </>
        ) : null}
        <div className="connect-actions">
          {configured && !qr ? (
            <button type="button" className="text-btn" data-testid="share-match" onClick={onShare}>
              {status === 'connecting' ? 'Connecting…' : 'Show QR code'}
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
        </div>
      </div>
    </section>
  );
}
