/** IPv4 as itself. IPv6 as the first 64 bits, so a rotating interface id stays one budget. */
export function networkPrefix(address: string): string {
  const trimmed = address.trim().toLowerCase();
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(trimmed)) return trimmed;
  const groups = expandIPv6(trimmed);
  if (!groups) return trimmed.length > 0 ? trimmed : 'missing';
  const mapped = groups[0] === '0000' && groups[1] === '0000' && groups[2] === '0000' && groups[3] === '0000' && groups[4] === '0000' && groups[5] === 'ffff';
  if (mapped) {
    const hi = Number.parseInt(groups[6] ?? '0', 16);
    const lo = Number.parseInt(groups[7] ?? '0', 16);
    return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
  }
  return `${groups.slice(0, 4).join(':')}::/64`;
}

function expandIPv6(input: string): string[] | null {
  let value = input;
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1);
  const zone = value.indexOf('%');
  if (zone >= 0) value = value.slice(0, zone);
  const tail = value.match(/^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (tail?.[1] && tail[2]) {
    const parts = tail[2].split('.').map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
    const hi = ((parts[0] ?? 0) << 8) | (parts[1] ?? 0);
    const lo = ((parts[2] ?? 0) << 8) | (parts[3] ?? 0);
    value = `${tail[1]}${hi.toString(16)}:${lo.toString(16)}`;
  }
  if (!value.includes(':')) return null;
  const halves = value.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves[1] ? halves[1].split(':') : [];
  if (head.some((part) => !/^[0-9a-f]{1,4}$/.test(part)) || rest.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  if (halves.length === 1) {
    if (head.length !== 8) return null;
    return head.map((part) => part.padStart(4, '0'));
  }
  const missing = 8 - head.length - rest.length;
  if (missing < 0) return null;
  return [...head, ...Array.from({ length: missing }, () => '0'), ...rest].map((part) => part.padStart(4, '0'));
}
