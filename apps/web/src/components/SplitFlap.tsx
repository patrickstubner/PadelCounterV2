import { useEffect, useLayoutEffect, useRef, useState } from 'react';

interface SplitFlapProps {
  value: string;
}

const DIGIT_PROBE_PX = 200;
const DIGIT_SLACK_PX = 2;

/** Font size whose measured ink fills the column, limited by whichever side runs out first. */
export function portraitDigitFontPx(
  container: { readonly width: number; readonly height: number },
  ink: { readonly width: number; readonly height: number },
  probePx: number,
): number {
  if (container.width <= 4 || container.height <= 4 || ink.width <= 0 || ink.height <= 0 || probePx <= 0) return 0;
  return probePx * Math.min(
    (container.width - DIGIT_SLACK_PX) / ink.width,
    (container.height - DIGIT_SLACK_PX) / ink.height,
  );
}

function glyphInk(ctx: CanvasRenderingContext2D, text: string, px: number, weight: string, family: string): {
  width: number;
  height: number;
  ascent: number;
  descent: number;
  left: number;
  right: number;
} | null {
  ctx.font = `${weight} ${px}px ${family}`;
  const metrics = ctx.measureText(text);
  const width = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight;
  const height = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
  if (width <= 0 || height <= 0) return null;
  return {
    width,
    height,
    ascent: metrics.actualBoundingBoxAscent,
    descent: metrics.actualBoundingBoxDescent,
    left: metrics.actualBoundingBoxLeft,
    right: metrics.actualBoundingBoxRight,
  };
}

/** Size and center the portrait digit from its ink. Landscape set cells keep the stylesheet size. */
export function fitPortraitDigit(flap: HTMLElement): void {
  const container = flap.closest('.current-set');
  if (!(container instanceof HTMLElement) || getComputedStyle(container).display === 'none') {
    flap.style.fontSize = '';
    flap.style.transform = '';
    return;
  }
  const textEl = flap.querySelector('.flap-current');
  if (!(textEl instanceof HTMLElement)) return;
  const text = textEl.textContent ?? '';
  if (text.length === 0) return;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const style = getComputedStyle(textEl);
  const probe = glyphInk(ctx, text, DIGIT_PROBE_PX, style.fontWeight, style.fontFamily);
  const box = container.getBoundingClientRect();
  if (!probe) return;
  let size = portraitDigitFontPx(box, probe, DIGIT_PROBE_PX);
  if (size <= 0) return;
  // Glyph bounds do not scale in a straight line, so measure the chosen size and correct it.
  for (let pass = 0; pass < 2; pass += 1) {
    const check = glyphInk(ctx, text, size, style.fontWeight, style.fontFamily);
    if (!check) return;
    const fit = Math.min(
      (box.height - DIGIT_SLACK_PX) / check.height,
      (box.width - DIGIT_SLACK_PX) / check.width,
    );
    if (!Number.isFinite(fit) || fit <= 0) return;
    if (Math.abs(fit - 1) < 0.004) break;
    size *= fit;
  }
  const rounded = Math.round(size * 100) / 100;
  if (flap.style.fontSize !== `${rounded}px`) flap.style.fontSize = `${rounded}px`;
  flap.style.transform = 'none';
  const placed = glyphInk(ctx, text, rounded, style.fontWeight, style.fontFamily);
  if (!placed) return;
  const textBox = textEl.getBoundingClientRect();
  const marker = document.createElement('span');
  marker.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
  textEl.append(marker);
  const baseline = marker.getBoundingClientRect().top;
  marker.remove();
  const inkLeft = textBox.left - placed.left;
  const inkRight = textBox.left + placed.right;
  const inkTop = baseline - placed.ascent;
  const inkBottom = baseline + placed.descent;
  const shiftX = (box.left + box.width / 2) - ((inkLeft + inkRight) / 2);
  const shiftY = (box.top + box.height / 2) - ((inkTop + inkBottom) / 2);
  if (Number.isFinite(shiftX) && Number.isFinite(shiftY)) {
    flap.style.transform = `translate(${shiftX}px, ${shiftY}px)`;
  }
}

/** Plus sends the old digit up. Minus brings the new digit in from above. */
export function flapMotion(from: string, to: string): 'up' | 'down' {
  const previous = Number(from);
  const next = Number(to);
  if (Number.isFinite(previous) && Number.isFinite(next) && next < previous) return 'down';
  return 'up';
}

export function SplitFlap({ value }: SplitFlapProps) {
  const flapRef = useRef<HTMLSpanElement>(null);
  const previous = useRef(value);
  const [current, setCurrent] = useState(value);
  const [outgoing, setOutgoing] = useState<string | null>(null);
  const [motion, setMotion] = useState<'up' | 'down'>('up');

  useEffect(() => {
    if (value === previous.current) return;
    const from = previous.current;
    previous.current = value;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setCurrent(value);
      setOutgoing(null);
      return;
    }
    setMotion(flapMotion(from, value));
    setOutgoing(from);
    setCurrent(value);
    const timer = window.setTimeout(() => setOutgoing(null), 460);
    return () => window.clearTimeout(timer);
  }, [value]);

  useLayoutEffect(() => {
    const flap = flapRef.current;
    if (!flap) return;
    const textNode = () => flap.querySelector('.flap-current');
    const mutations = typeof MutationObserver === 'function' ? new MutationObserver(() => fit()) : null;
    const watch = () => {
      const text = textNode();
      if (text) mutations?.observe(text, { childList: true, characterData: true, subtree: true });
    };
    const fit = () => {
      mutations?.disconnect();
      try {
        fitPortraitDigit(flap);
      } finally {
        watch();
      }
    };
    fit();
    const container = flap.closest('.current-set');
    const observed = typeof ResizeObserver === 'function' && container instanceof HTMLElement
      ? new ResizeObserver(fit)
      : null;
    if (observed && container instanceof HTMLElement) observed.observe(container);
    const fonts = document.fonts;
    fonts?.addEventListener?.('loadingdone', fit);
    return () => {
      observed?.disconnect();
      mutations?.disconnect();
      fonts?.removeEventListener?.('loadingdone', fit);
    };
  }, [current]);

  const flipping = outgoing !== null;
  const classes = ['flap', 'num', flipping ? 'is-flipping' : '', flipping && motion === 'down' ? 'is-down' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <span ref={flapRef} className={classes} data-motion={flipping ? motion : undefined} aria-hidden="true">
      <span className="flap-current">{current}</span>
      {outgoing !== null ? (
        <>
          <span className="flap-leave">{outgoing}</span>
          <span className="flap-enter">{current}</span>
        </>
      ) : null}
    </span>
  );
}
