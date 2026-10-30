/** Sealed invite material. The raw token is not stored next to its hash. */

function bytesToB64(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function b64ToBytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 4096) return null;
  const padded = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(value.length + ((4 - (value.length % 4)) % 4), '=');
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

async function aesKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`padel-invite-seal\0${secret}`));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function sealText(secret: string, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await aesKey(secret),
    new TextEncoder().encode(plain),
  );
  return `${bytesToB64(iv)}.${bytesToB64(new Uint8Array(cipher))}`;
}

export async function openText(secret: string, sealed: string): Promise<string | null> {
  const parts = sealed.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const iv = b64ToBytes(parts[0]);
  const cipher = b64ToBytes(parts[1]);
  if (!iv || iv.length !== 12 || !cipher) return null;
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await aesKey(secret), cipher);
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
