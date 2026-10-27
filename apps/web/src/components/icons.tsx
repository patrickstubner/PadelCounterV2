export function PlusIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path className="glyph" d="M10.2 3h3.6v7.2H21v3.6h-7.2V21h-3.6v-7.2H3v-3.6h7.2V3z" fill="currentColor" />
      <path className="glyph-bold" d="M8 2h8v6h6v8h-6v6H8v-6H2V8h6V2z" fill="currentColor" />
    </svg>
  );
}

export function MinusIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path className="glyph" d="M3 10.2h18v3.6H3z" fill="currentColor" />
      <path className="glyph-bold" d="M2 8h20v8H2z" fill="currentColor" />
    </svg>
  );
}

export function BallIcon() {
  return (
    <svg className="ball-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.1" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <path
        d="M8.1 5.4c2.6 2.3 2.6 10.9 0 13.2M15.9 5.4c-2.6 2.3-2.6 10.9 0 13.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
