import { useEffect, useRef, useState } from 'react';

interface SplitFlapProps {
  value: string;
}

/** Plus sends the old digit up. Minus brings the new digit in from above. */
export function flapMotion(from: string, to: string): 'up' | 'down' {
  const previous = Number(from);
  const next = Number(to);
  if (Number.isFinite(previous) && Number.isFinite(next) && next < previous) return 'down';
  return 'up';
}

export function SplitFlap({ value }: SplitFlapProps) {
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

  const flipping = outgoing !== null;
  const classes = ['flap', 'num', flipping ? 'is-flipping' : '', flipping && motion === 'down' ? 'is-down' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <span className={classes} data-motion={flipping ? motion : undefined} aria-hidden="true">
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
