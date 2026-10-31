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

export function PhoneIcon() {
  return (
    <svg className="phone-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="7" y="2.5" width="10" height="19" rx="2.2" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M10 5.2h4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="12" cy="17.6" r="0.9" fill="currentColor" />
    </svg>
  );
}

export function BallIcon() {
  return (
    <svg className="ball-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="ball-felt" cx="12" cy="12" r="8.35" />
      <path className="ball-seam" d="M8.05 5.15c2.15 2.35 2.15 11.35 0 13.7M15.95 5.15c-2.15 2.35-2.15 11.35 0 13.7" />
    </svg>
  );
}
