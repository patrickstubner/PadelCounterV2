import { useEffect, useId, useRef, useState } from 'react';
import { ROOM_MESSAGES, normalizeJoinCode } from '@padel/core';
import { tokenFromJoinQr } from '../live/protocol';
import { readQrVideo } from '../live/readQr';

interface JoinMatchPageProps {
  readonly configured: boolean;
  readonly error: string | null;
  readonly pageHref: string;
  readonly onCode: (code: string) => void;
  readonly onToken: (token: string) => void;
  readonly onClose: () => void;
  readonly scanFrame?: (video: HTMLVideoElement) => Promise<string | null>;
}

function focusable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
    (node) => !node.hasAttribute('disabled'),
  );
}

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => {
    track.stop();
  });
}

export function JoinMatchPage({
  configured,
  error,
  pageHref,
  onCode,
  onToken,
  onClose,
  scanFrame,
}: JoinMatchPageProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [camera, setCamera] = useState(false);
  const [draft, setDraft] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const onTokenRef = useRef(onToken);
  const onCloseRef = useRef(onClose);
  onTokenRef.current = onToken;
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
      previous?.focus();
    };
  }, []);

  useEffect(() => {
    if (!camera) return;
    const video = videoRef.current;
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer = 0;
    const stop = () => {
      stopped = true;
      window.clearTimeout(timer);
      stopStream(stream);
      stream = null;
      if (video) video.srcObject = null;
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') {
        stop();
        setCamera(false);
      }
    };
    document.addEventListener('visibilitychange', onHide);
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' } },
        });
      } catch {
        setLocalError('The camera did not start.');
        setCamera(false);
        return;
      }
      if (stopped || !video) {
        stopStream(stream);
        return;
      }
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        stop();
        setLocalError('The camera did not start.');
        setCamera(false);
        return;
      }
      const look = async () => {
        if (stopped) return;
        try {
          const text = await (scanFrame ?? readQrVideo)(video);
          if (stopped) return;
          if (text) {
            const token = tokenFromJoinQr(text, pageHref);
            stop();
            setCamera(false);
            if (token) onTokenRef.current(token);
            else setLocalError(ROOM_MESSAGES.join_code);
            return;
          }
        } catch {
          if (stopped) return;
        }
        timer = window.setTimeout(() => {
          void look();
        }, 200);
      };
      void look();
    })();
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      stop();
    };
  }, [camera, pageHref, scanFrame]);

  const shown = localError ?? error;

  return (
    <div className="connect-overlay" data-testid="join-match-backdrop" onClick={(event) => {
      if (event.target === event.currentTarget) onCloseRef.current();
    }}>
      <div
        ref={panelRef}
        className="connect-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="join-match-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="connect-dialog-bar">
          <button ref={closeRef} type="button" className="connect-x" data-testid="join-match-close" aria-label="Close" onClick={onClose}>
            X
          </button>
        </div>
        <h2 id={titleId}>Join match</h2>
        <p>Scan the QR code with this phone, or type the short code. A link in the browser still works.</p>
        {configured ? null : (
          <p data-testid="join-unconfigured">Live sharing is not configured in this build.</p>
        )}
        {shown ? <p data-testid="join-match-error">{shown}</p> : null}
        {camera ? (
          <video ref={videoRef} className="join-camera" data-testid="join-camera" muted playsInline autoPlay />
        ) : (
          <button type="button" className="text-btn" data-testid="use-camera" onClick={() => {
            setLocalError(null);
            setCamera(true);
          }}>
            Use camera
          </button>
        )}
        <form
          className="join-code-form"
          onSubmit={(event) => {
            event.preventDefault();
            const code = normalizeJoinCode(draft);
            if (!code) {
              setLocalError(ROOM_MESSAGES.join_code);
              return;
            }
            setLocalError(null);
            onCode(code);
          }}
        >
          <label htmlFor="match-code-input">Match code</label>
          <input
            id="match-code-input"
            data-testid="match-code-input"
            value={draft}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={16}
            inputMode="text"
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit" className="text-btn" data-testid="join-by-code">
            Join
          </button>
        </form>
        <button type="button" className="text-btn" data-testid="join-match-dismiss" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
