import { create } from 'qrcode';

export function QrCode({ text }: { readonly text: string }) {
  const qr = create(text, { errorCorrectionLevel: 'M' });
  const size = qr.modules.size;
  const cells: { x: number; y: number }[] = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (qr.modules.get(y, x)) cells.push({ x, y });
    }
  }
  return (
    <svg className="qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="QR code for players">
      <rect width={size} height={size} fill="#ffffff" />
      <g fill="#000000">
        {cells.map((cell) => (
          <rect key={`${cell.x}-${cell.y}`} x={cell.x} y={cell.y} width={1} height={1} />
        ))}
      </g>
    </svg>
  );
}
