import { useEffect, useRef } from 'react';
import trophyAnimation from '../assets/trophy.json';
import { DISTRIBUTION_NOTICE } from '../assets/distribution-notice';
import type { TeamId } from '../domain/types';

interface VictoryProps {
  name: string;
  team: TeamId;
  reducedMotion: boolean;
  onClose: () => void;
}

const COLORS = ['#e4ff47', '#ffb020', '#ffffff', '#7cffcb', '#ff5d73', '#ffe56a'];

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  rot: number;
  spin: number;
  color: string;
  life: number;
}

function burst(width: number, count: number): Piece[] {
  const pieces: Piece[] = [];
  for (let i = 0; i < count; i += 1) {
    pieces.push({
      x: Math.random() * width,
      y: -20 - Math.random() * 280,
      vx: (Math.random() - 0.5) * 3.4,
      vy: 1.6 + Math.random() * 3.2,
      w: 6 + Math.random() * 8,
      h: 8 + Math.random() * 12,
      rot: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.28,
      color: COLORS[i % COLORS.length] ?? '#ffffff',
      life: 3,
    });
  }
  return pieces;
}

/** Drawn trophy once the trim-path animation has finished. */
const STILL_FRAME = 40;

function Trophy() {
  return (
    <svg className="victory-trophy" viewBox="0 0 64 64" aria-hidden="true">
      <path
        fill="currentColor"
        d="M18 8h28v6c0 8.2-5.4 15.2-12.6 17.2V38h8.2v6H22.4v-6h8.2v-6.8C23.4 29.2 18 22.2 18 14V8z"
      />
      <path fill="currentColor" d="M18 12H10c0 8 4.2 12.6 10 14.2V12zm28 0v14.2C49.8 24.6 54 20 54 12h-8z" />
      <path fill="#fff4b0" d="M24 14h16v4c0 5.4-3.4 9.6-8 10.6-4.6-1-8-5.2-8-10.6v-4z" />
      <path fill="currentColor" d="M20 48h24v6H20z" />
    </svg>
  );
}

export function Victory({ name, team, reducedMotion, onClose }: VictoryProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trophyRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const container = trophyRef.current;
    if (!container) return;
    let cancelled = false;
    let item: { destroy: () => void } | null = null;
    const animationData = { ...trophyAnimation, license: DISTRIBUTION_NOTICE };
    void import('lottie-web/build/player/lottie_light')
      .then((mod) => {
        if (cancelled || !trophyRef.current) return;
        const animation = mod.default.loadAnimation({
          container: trophyRef.current,
          renderer: 'svg',
          loop: !reducedMotion,
          autoplay: !reducedMotion,
          animationData,
          rendererSettings: { preserveAspectRatio: 'xMidYMid meet' },
        });
        if (reducedMotion) animation.goToAndStop(STILL_FRAME, true);
        item = animation;
      })
      .catch(() => {
        container.replaceChildren();
      });
    return () => {
      cancelled = true;
      item?.destroy();
    };
  }, [reducedMotion]);

  useEffect(() => {
    if (reducedMotion) return;
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    let frame = 0;
    let raf = 0;
    const draw = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const bufferW = Math.max(1, Math.floor(width * ratio));
      const bufferH = Math.max(1, Math.floor(height * ratio));
      if (canvas.width !== bufferW || canvas.height !== bufferH) {
        canvas.width = bufferW;
        canvas.height = bufferH;
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      let alive = false;
      for (const piece of pieces) {
        if (piece.life <= 0 && piece.y > height + 30) continue;
        alive = true;
        piece.vy += 0.08;
        piece.x += piece.vx;
        piece.y += piece.vy;
        piece.rot += piece.spin;
        if (piece.y > height + 24) {
          piece.life -= 1;
          if (piece.life > 0) {
            piece.x = Math.random() * width;
            piece.y = -16;
            piece.vy = 1.8 + Math.random() * 2.4;
          }
        }
        context.save();
        context.translate(piece.x, piece.y);
        context.rotate(piece.rot);
        context.fillStyle = piece.color;
        context.fillRect(-piece.w / 2, -piece.h / 2, piece.w, piece.h);
        context.restore();
      }
      frame += 1;
      if (alive && frame < 60 * 12) raf = requestAnimationFrame(draw);
    };

    const pieces = burst(canvas.clientWidth || 800, 220);
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [reducedMotion]);

  return (
    <button
      type="button"
      className={reducedMotion ? 'victory is-calm' : 'victory'}
      data-testid="victory"
      onClick={onClose}
    >
      {reducedMotion ? null : <canvas ref={canvasRef} className="victory-canvas" aria-hidden="true" />}
      <span className="victory-card">
        <span ref={trophyRef} className="victory-lottie" data-testid="victory-lottie" />
        <Trophy />
        <span className={`victory-title victory-${team}`} data-testid="victory-name">
          {name} wins!
        </span>
        <span className="victory-hint">Tap to close</span>
      </span>
    </button>
  );
}
