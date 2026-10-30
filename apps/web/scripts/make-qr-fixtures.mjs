/**
 * Build the scanner fixtures: photographs of a display, not clean rasters.
 * Run from the repo root: `node apps/web/scripts/make-qr-fixtures.mjs`
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { create } from 'qrcode';

const PAYLOAD = 'https://patrickstubner.github.io/PadelCounterV2/#/join?t=abcdefghijklmnopqrstuv';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '../src/live/fixtures');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function concat(parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function u32(value) {
  const bytes = new Uint8Array(4);
  bytes[0] = (value >>> 24) & 255;
  bytes[1] = (value >>> 16) & 255;
  bytes[2] = (value >>> 8) & 255;
  bytes[3] = value & 255;
  return bytes;
}

function chunk(type, data) {
  const name = new Uint8Array([type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)]);
  const body = concat([name, data]);
  return concat([u32(data.length), body, u32(crc32(body))]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (stride + 1);
    raw[row] = 0;
    for (let x = 0; x < stride; x += 1) raw[row + 1 + x] = rgba[y * stride + x];
  }
  const ihdr = new Uint8Array(13);
  ihdr.set(u32(width), 0);
  ihdr.set(u32(height), 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  return concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function blank(width, height, red, green, blue) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = red;
    data[i + 1] = green;
    data[i + 2] = blue;
    data[i + 3] = 255;
  }
  return { data, width, height };
}

function symbol() {
  const qr = create(PAYLOAD, { errorCorrectionLevel: 'H' });
  const size = qr.modules.size;
  const quiet = 4;
  return {
    span: size + quiet * 2,
    dark(x, y) {
      if (x < quiet || y < quiet || x >= size + quiet || y >= size + quiet) return false;
      return Boolean(qr.modules.get(y - quiet, x - quiet));
    },
  };
}

function paintCode(image, scale, originX, originY, foreground, background) {
  const code = symbol();
  const pixel = code.span * scale;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const sx = x - originX;
      const sy = y - originY;
      if (sx < 0 || sy < 0 || sx >= pixel || sy >= pixel) continue;
      const dark = code.dark(Math.floor(sx / scale), Math.floor(sy / scale));
      const color = dark ? foreground : background;
      const offset = (y * image.width + x) * 4;
      image.data[offset] = color[0];
      image.data[offset + 1] = color[1];
      image.data[offset + 2] = color[2];
    }
  }
}

function sample(image, x, y) {
  const cx = Math.max(0, Math.min(image.width - 1, Math.floor(x)));
  const cy = Math.max(0, Math.min(image.height - 1, Math.floor(y)));
  const nx = Math.max(0, Math.min(image.width - 1, cx + 1));
  const ny = Math.max(0, Math.min(image.height - 1, cy + 1));
  const fx = x - Math.floor(x);
  const fy = y - Math.floor(y);
  const at = (px, py) => {
    const offset = (py * image.width + px) * 4;
    return [image.data[offset], image.data[offset + 1], image.data[offset + 2]];
  };
  const a = at(cx, cy);
  const b = at(nx, cy);
  const c = at(cx, ny);
  const d = at(nx, ny);
  return [0, 1, 2].map((band) => {
    const top = a[band] + (b[band] - a[band]) * fx;
    const bottom = c[band] + (d[band] - c[band]) * fx;
    return Math.max(0, Math.min(255, Math.round(top + (bottom - top) * fy)));
  });
}

function warp(source, width, height, map) {
  const out = blank(width, height, 18, 18, 20);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const point = map(x, y);
      if (!point) continue;
      const color = sample(source, point.x, point.y);
      const offset = (y * width + x) * 4;
      out.data[offset] = color[0];
      out.data[offset + 1] = color[1];
      out.data[offset + 2] = color[2];
    }
  }
  return out;
}

function boxBlur(image, radius) {
  const out = blank(image.width, image.height, 0, 0, 0);
  const { width, height, data } = image;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let count = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        const sy = Math.max(0, Math.min(height - 1, y + dy));
        for (let dx = -radius; dx <= radius; dx += 1) {
          const sx = Math.max(0, Math.min(width - 1, x + dx));
          const offset = (sy * width + sx) * 4;
          red += data[offset];
          green += data[offset + 1];
          blue += data[offset + 2];
          count += 1;
        }
      }
      const to = (y * width + x) * 4;
      out.data[to] = Math.round(red / count);
      out.data[to + 1] = Math.round(green / count);
      out.data[to + 2] = Math.round(blue / count);
    }
  }
  return out;
}

function noise(image, seed, amount) {
  const random = mulberry32(seed);
  for (let i = 0; i < image.data.length; i += 4) {
    const delta = (random() * 2 - 1) * amount;
    for (let band = 0; band < 3; band += 1) {
      image.data[i + band] = Math.max(0, Math.min(255, Math.round(image.data[i + band] + delta)));
    }
  }
}

function shade(image, map) {
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4;
      for (let band = 0; band < 3; band += 1) {
        image.data[offset + band] = Math.max(0, Math.min(255, Math.round(map(image.data[offset + band], x, y))));
      }
    }
  }
}

function screenWithCode(scale) {
  const code = symbol();
  const pixel = code.span * scale;
  const pad = Math.round(scale * 3);
  const width = pixel + pad * 2;
  const height = pixel + pad * 2;
  const image = blank(width, height, 236, 236, 236);
  paintCode(image, scale, pad, pad, [12, 12, 14], [248, 248, 248]);
  return image;
}

function placeStraight(scale) {
  const screen = screenWithCode(scale);
  const photo = blank(640, 480, 24, 24, 26);
  const originX = Math.round((640 - screen.width) / 2);
  const originY = Math.round((480 - screen.height) / 2);
  for (let y = 0; y < screen.height; y += 1) {
    for (let x = 0; x < screen.width; x += 1) {
      const dx = originX + x;
      const dy = originY + y;
      if (dx < 0 || dy < 0 || dx >= 640 || dy >= 480) continue;
      const from = (y * screen.width + x) * 4;
      const to = (dy * 640 + dx) * 4;
      photo.data[to] = screen.data[from];
      photo.data[to + 1] = screen.data[from + 1];
      photo.data[to + 2] = screen.data[from + 2];
    }
  }
  return photo;
}

function angled() {
  const screen = screenWithCode(7);
  const angle = (7 * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const scale = 0.86;
  return warp(screen, 640, 480, (x, y) => {
    const dx = x - 320;
    const dy = y - 240;
    return {
      x: (cos * dx + sin * dy) / scale + screen.width / 2,
      y: (-sin * dx + cos * dy) / scale + screen.height / 2,
    };
  });
}

const code = symbol();
const fixtures = {
  skewed: () => {
    const image = boxBlur(angled(), 1);
    noise(image, 11, 6);
    return image;
  },
  blurred: () => {
    const image = boxBlur(placeStraight(8), 2);
    noise(image, 19, 4);
    return image;
  },
  small: () => {
    const image = placeStraight(3);
    noise(image, 23, 5);
    return image;
  },
  bright: () => {
    const image = placeStraight(8);
    shade(image, (value) => 168 + value * 0.32);
    noise(image, 29, 3);
    return image;
  },
  dark: () => {
    const image = placeStraight(8);
    shade(image, (value) => value * 0.33);
    noise(image, 31, 3);
    return image;
  },
  glare: () => {
    const image = placeStraight(8);
    shade(image, (value, x, y) => {
      const dx = x - 320;
      const dy = y - 230;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const blob = distance < 78 ? (1 - distance / 78) * 110 : 0;
      const glow = 18 * (1 - Math.min(1, Math.abs(y - 80) / 480));
      return value + blob + glow;
    });
    noise(image, 37, 4);
    return image;
  },
};

mkdirSync(OUT, { recursive: true });
for (const [name, draw] of Object.entries(fixtures)) {
  const image = draw();
  const png = encodePng(image.width, image.height, image.data);
  writeFileSync(join(OUT, `${name}.png`), png);
  console.log(`${name}.png ${image.width}x${image.height} modules=${code.span} bytes=${png.length}`);
}
