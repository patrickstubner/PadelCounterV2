import { create } from 'qrcode';

/** Spec quiet zone. Kept inside the graphic so a rounded corner cannot clip a finder. */
export const QR_QUIET_MODULES = 4;

export function QrCode({ text }: { readonly text: string }) {
  const qr = create(text, { errorCorrectionLevel: 'H' });
  const size = qr.modules.size;
  const span = size + QR_QUIET_MODULES * 2;
  const cells: { x: number; y: number }[] = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (qr.modules.get(y, x)) cells.push({ x: x + QR_QUIET_MODULES, y: y + QR_QUIET_MODULES });
    }
  }
  return (
    <svg className="qr" viewBox={`0 0 ${span} ${span}`} role="img" aria-label="QR code for players" data-testid="match-qr">
      <rect width={span} height={span} fill="#ffffff" />
      <g fill="#000000">
        {cells.map((cell) => (
          <rect key={`${cell.x}-${cell.y}`} x={cell.x} y={cell.y} width={1} height={1} />
        ))}
      </g>
    </svg>
  );
}
