import { useEffect, useId, useRef, useState } from 'react';
import { ROOM_MESSAGES, normalizeJoinCode } from '@padel/core';
import { preferContinuousFocus, requestScanCamera, scheduleScanFrame } from '../live/camera';
import { tokenFromJoinQr } from '../live/protocol';
import { DECODE_WAIT_MS, readQrVideo } from '../live/readQr';

interface JoinMatchPageProps {
  readonly configured: boolean;
  readonly error: string | null;
  readonly pageHref: string;
  readonly onCode: (code: string) => void;
  readonly onToken: (token: string) => void;
  readonly onClose: () => void;
  /** Permission prompt from the tap that opened this page. Absent until that tap. */
  readonly cameraRequest?: Promise<MediaStream> | null;
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

/** The camera preview stops on its own so an old phone is not left capturing. */
export const CAMERA_LIMIT_MS = 90_000;

/** At most about 8 scans a second. A faster loop keeps the main thread busy. */
const SCAN_GAP_MS = 120;

const CAMERA_STOPPED = 'Camera stopped. Tap Use camera to try again.';

const CAMERA_BLOCKED = 'Allow camera access in Settings, then tap Use camera.';

/** Safari will not show the camera unless the video is inline, muted, and play() is awaited. */
function prepareVideo(video: HTMLVideoElement): void {
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.setAttribute('autoplay', '');
}

function releaseVideo(video: HTMLVideoElement | null): void {
  if (!video) return;
  const source = video.srcObject;
  try {
    video.pause();
  } catch {
    // The element can already be detached.
  }
  video.srcObject = null;
  if (source instanceof MediaStream) stopStream(source);
  try {
    video.load();
  } catch {
    // Older WebKit builds throw if the element has no window.
  }
}

async function playCamera(video: HTMLVideoElement): Promise<void> {
  prepareVideo(video);
  const started = video.play();
  if (started) await started;
}

/** A scan that never settles must not leave the look loop stuck. */
function scanWithin(
  read: (video: HTMLVideoElement) => Promise<string | null>,
  video: HTMLVideoElement,
): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), DECODE_WAIT_MS);
    read(video).then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      () => {
        window.clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

function CodeForm({
  draft,
  onDraft,
  onSubmit,
  onFocus,
  onBlur,
}: {
  readonly draft: string;
  readonly onDraft: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onFocus?: () => void;
  readonly onBlur?: () => void;
}) {
  return (
    <form
      className="join-code-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
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
        onChange={(event) => onDraft(event.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
      />
      <button type="submit" className="text-btn" data-testid="join-by-code">
        Join
      </button>
    </form>
  );
}

export function JoinMatchPage({
  configured,
  error,
  pageHref,
  onCode,
  onToken,
  onClose,
  cameraRequest = null,
  scanFrame,
}: JoinMatchPageProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const requestRef = useRef<Promise<MediaStream> | null>(cameraRequest);
  const cameraGen = useRef({ n: 0 });
  const [camera, setCamera] = useState(cameraRequest != null);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [cameraHint, setCameraHint] = useState<string | null>(null);
  const onTokenRef = useRef(onToken);
  const onCloseRef = useRef(onClose);
  const pauseRef = useRef(false);
  const pauseScanRef = useRef<(() => void) | null>(null);
  const resumeScanRef = useRef<(() => void) | null>(null);
  onTokenRef.current = onToken;
  onCloseRef.current = onClose;
  pauseRef.current = typing;

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
    if (typing) pauseScanRef.current?.();
    else resumeScanRef.current?.();
  }, [camera, typing]);

  useEffect(() => {
    if (!camera) return;
    const video = videoRef.current;
    let stream: MediaStream | null = null;
    let stopped = false;
    let scanning = false;
    let waiting = false;
    let limit = 0;
    let gapTimer = 0;
    let cancelFrame: (() => void) | null = null;
    const stop = () => {
      stopped = true;
      waiting = false;
      window.clearTimeout(limit);
      window.clearTimeout(gapTimer);
      cancelFrame?.();
      cancelFrame = null;
      pauseScanRef.current = null;
      resumeScanRef.current = null;
      const current = stream;
      stream = null;
      releaseVideo(video);
      stopStream(current);
    };
    pauseScanRef.current = () => {
      window.clearTimeout(gapTimer);
      waiting = true;
    };
    resumeScanRef.current = () => {
      if (stopped || scanning || !waiting) return;
      waiting = false;
      void run();
    };
    limit = window.setTimeout(() => {
      if (stopped) return;
      stop();
      setLocalError(null);
      setCameraHint(CAMERA_STOPPED);
      setTyping(false);
      setCamera(false);
    }, CAMERA_LIMIT_MS);
    const onHide = () => {
      if (document.visibilityState === 'hidden') {
        stop();
        setCamera(false);
      }
    };
    document.addEventListener('visibilitychange', onHide);
    const gen = cameraGen.current;
    const mine = ++gen.n;
    const pending = requestRef.current;
    const run = async () => {
      if (stopped || scanning || !video || pauseRef.current) return;
      const started = performance.now();
      scanning = true;
      try {
        const text = await scanWithin(scanFrame ?? readQrVideo, video);
        if (stopped) return;
        if (text) {
          stop();
          setCamera(false);
          setTyping(false);
          const token = tokenFromJoinQr(text, pageHref);
          if (token) onTokenRef.current(token);
          else setLocalError(ROOM_MESSAGES.join_code);
          return;
        }
      } catch {
        if (stopped) return;
      } finally {
        scanning = false;
      }
      if (stopped || !video) return;
      if (pauseRef.current) {
        waiting = true;
        return;
      }
      const used = performance.now() - started;
      waiting = false;
      gapTimer = window.setTimeout(() => {
        void run();
      }, Math.max(0, SCAN_GAP_MS - used));
    };
    void (async () => {
      let opened: MediaStream;
      try {
        opened = pending ? await pending : await requestScanCamera();
      } catch (error) {
        if (stopped || gen.n !== mine) return;
        const name = error instanceof Error ? error.name : '';
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          setLocalError(null);
          setCameraHint(CAMERA_BLOCKED);
        } else {
          setLocalError('The camera did not start.');
        }
        setCamera(false);
        return;
      }
      if (gen.n !== mine) return;
      if (stopped || !video) {
        stopStream(opened);
        return;
      }
      stream = opened;
      requestRef.current = null;
      const track = stream.getVideoTracks()[0];
      if (track) await preferContinuousFocus(track);
      if (stopped) {
        stopStream(stream);
        stream = null;
        return;
      }
      prepareVideo(video);
      video.srcObject = stream;
      try {
        await playCamera(video);
      } catch {
        if (stopped) return;
        stop();
        setLocalError('The camera did not start.');
        setCamera(false);
        return;
      }
      if (stopped) return;
      if (typeof video.requestVideoFrameCallback === 'function') {
        cancelFrame = scheduleScanFrame(video, () => {
          void run();
        });
        return;
      }
      void run();
    })();
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onHide);
      queueMicrotask(() => {
        if (gen.n === mine) stop();
      });
    };
  }, [camera, pageHref, scanFrame]);

  const armCamera = () => {
    const request = requestScanCamera();
    request.catch(() => undefined);
    requestRef.current = request;
    setLocalError(null);
    setCameraHint(null);
    setTyping(false);
    setCamera(true);
  };

  const submitCode = () => {
    if (!normalizeJoinCode(draft)) {
      setLocalError(ROOM_MESSAGES.join_code);
      return;
    }
    setLocalError(null);
    setCamera(false);
    onCode(draft);
  };

  const shown = localError ?? error;

  return (
    <div className="connect-overlay" data-testid="join-match-backdrop" onClick={(event) => {
      if (event.target === event.currentTarget) onCloseRef.current();
    }}>
      <div
        ref={panelRef}
        className={camera ? 'connect-dialog join-scanning' : 'connect-dialog'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="join-match-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        {camera ? (
          <>
            <video
              ref={videoRef}
              className="join-camera"
              data-testid="join-camera"
              muted
              playsInline
              autoPlay
              width={1920}
              height={1080}
            />
            <div className="scan-target" data-testid="scan-target" aria-hidden="true" />
          </>
        ) : null}
        <div className={camera ? 'join-scan-ui' : undefined}>
          <div className="connect-dialog-bar">
            {camera ? <h2 id={titleId} className="join-scan-title">Join match</h2> : null}
            <button ref={closeRef} type="button" className="connect-x" data-testid="join-match-close" aria-label="Close" onClick={onClose}>
              X
            </button>
          </div>
          {camera ? (
            <div className="join-scan-bottom">
              <p className="join-scan-hint" data-testid="scan-hint">Hold the code inside the white frame.</p>
              {configured ? null : (
                <p data-testid="join-unconfigured">Live sharing is not configured in this build.</p>
              )}
              {shown ? <p data-testid="join-match-error">{shown}</p> : null}
              {cameraHint ? <p data-testid="join-camera-hint">{cameraHint}</p> : null}
              <CodeForm
                draft={draft}
                onDraft={setDraft}
                onSubmit={submitCode}
                onFocus={() => setTyping(true)}
                onBlur={() => setTyping(false)}
              />
            </div>
          ) : (
            <>
              <h2 id={titleId}>Join match</h2>
              <p>Scan the QR code with this phone, or type the short code. A link in the browser still works.</p>
              {configured ? null : (
                <p data-testid="join-unconfigured">Live sharing is not configured in this build.</p>
              )}
              {shown ? <p data-testid="join-match-error">{shown}</p> : null}
              {cameraHint ? <p data-testid="join-camera-hint">{cameraHint}</p> : null}
              <button
                type="button"
                className="text-btn"
                data-testid="use-camera"
                onClick={armCamera}
              >
                Use camera
              </button>
              <CodeForm
                draft={draft}
                onDraft={setDraft}
                onSubmit={submitCode}
                onFocus={() => setTyping(true)}
                onBlur={() => setTyping(false)}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
