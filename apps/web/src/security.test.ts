import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PAGE_BASE } from './base';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function filesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...filesUnder(full));
    else found.push(full);
  }
  return found;
}

describe('shipped source stays local and text-only', () => {
  const needles = [
    'dangerouslySetInnerHTML',
    'innerHTML',
    'outerHTML',
    'insertAdjacentHTML',
    'document.write',
    'eval(',
    'new Function',
    'java' + 'script:',
    'fonts.googleapis',
    'fonts.gstatic',
    'googletagmanager',
    'google-analytics',
    'storage.googleapis.com',
    'cdn.jsdelivr.net',
    'unpkg.com',
    '«',
    '»',
  ];

  it('does not reference HTML injection or external hosts', () => {
    const paths = [...filesUnder(join(repoRoot, 'src')), ...filesUnder(join(repoRoot, 'public'))].filter(
      (file) =>
        !file.endsWith('.test.ts') &&
        !file.endsWith('.png') &&
        !file.endsWith('.ico') &&
        !file.endsWith('.mp4') &&
        !file.endsWith('.mp3'),
    );
    for (const file of paths) {
      const text = readFileSync(file, 'utf8');
      for (const needle of needles) {
        expect(text, relative(repoRoot, file)).not.toContain(needle);
      }
    }
  });

  it('pins the pages base path in the shell and the readme', () => {
    const live = `https://patrickstubner.github.io${PAGE_BASE}/`;
    const html = readFileSync(join(repoRoot, 'src/index.html'), 'utf8');
    const manifest = readFileSync(join(repoRoot, 'public/manifest.webmanifest'), 'utf8');
    const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8');
    expect(html).toContain('<%= assetPrefix %>/');
    expect(html).not.toContain(`${PAGE_BASE}/`);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('Content-Security-Policy');
    expect(mediaSrcDirective(html)).toBe("'self'");
    expect(html).not.toContain("media-src 'none'");
    expect(html).not.toContain('media-src blob:');
    expect(html).not.toContain('media-src data:');
    expect(html).toContain("worker-src 'self'");
    const notice = readFileSync(join(repoRoot, 'public/NOTICE.txt'), 'utf8');
    expect(notice).toContain('qr 0.7.2');
    expect(notice).toContain('Copyright (c) 2023 Paul Miller');
    expect(notice).toContain('qrcode 1.5.4');
    expect(notice).toContain('Copyright (c) 2012 Ryan Day');
    expect(html).not.toContain('unsafe-inline');
    expect(html).not.toContain('unsafe-eval');
    const rsbuild = readFileSync(join(repoRoot, 'rsbuild.config.ts'), 'utf8');
    expect(rsbuild).toContain('assetPrefix: PAGE_BASE');
    expect(rsbuild).toContain('escapeRegExp(prefix)');
    const manifestJson = JSON.parse(manifest) as { start_url: string; icons: { src: string }[] };
    expect(manifestJson.start_url).toBe('./');
    expect(manifestJson.icons.every((icon) => icon.src.startsWith('icons/'))).toBe(true);
    expect(readme).toContain(live);
  });

  it('ships the install icons named by the manifest', () => {
    const manifest = JSON.parse(readFileSync(join(repoRoot, 'public/manifest.webmanifest'), 'utf8')) as {
      lang: string;
      description: string;
      name: string;
      short_name: string;
      display: string;
      theme_color: string;
      background_color: string;
      icons: { src: string; sizes: string; purpose: string; type: string }[];
    };
    expect(manifest.lang).toBe('en');
    expect(manifest.description).toBe('Game counter for padel. The score stays on this device until you share it.');
    expect(manifest.name).toBe('Padel Counter V2');
    expect(manifest.short_name).toBe('Padel Counter V2');
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toBe('#0a1a3f');
    expect(manifest.background_color).toBe('#0a1a3f');
    expect(manifest.icons).toEqual([
      { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'icons/icon-1024.png', sizes: '1024x1024', type: 'image/png', purpose: 'any' },
      { src: 'icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ]);
    for (const icon of manifest.icons) {
      const file = join(repoRoot, 'public', icon.src);
      expect(existsSync(file), icon.src).toBe(true);
      const size = Number(icon.sizes.split('x')[0]);
      const png = pngInfo(file);
      expect(png.width).toBe(size);
      expect(png.height).toBe(size);
    }
    expect(pngInfo(join(repoRoot, 'public/icons/apple-touch-icon-180.png'))).toEqual({
      width: 180,
      height: 180,
      colorType: 2,
    });
    expect(pngInfo(join(repoRoot, 'public/favicon-16.png')).width).toBe(16);
    expect(pngInfo(join(repoRoot, 'public/favicon-32.png')).width).toBe(32);
    expect(existsSync(join(repoRoot, 'public/favicon.ico'))).toBe(true);
    const html = readFileSync(join(repoRoot, 'src/index.html'), 'utf8');
    expect(html).toContain('apple-touch-icon');
    expect(html).toContain('icons/apple-touch-icon-180.png');
    expect(html).toContain('favicon-16.png');
    expect(html).toContain('favicon-32.png');
    expect(html).toContain('favicon.ico');
    expect(html).toContain('apple-mobile-web-app-capable');
    expect(html).toContain('apple-mobile-web-app-status-bar-style" content="black-translucent"');
    expect(html).toContain('apple-mobile-web-app-title" content="Padel Counter V2"');
    expect(mediaSrcDirective(html)).toBe("'self'");
    expect(html).not.toContain('blob:');
    expect(html).not.toContain('data:');
    const fanfare = readFileSync(join(repoRoot, 'src/domain/fanfare.ts'), 'utf8');
    expect(fanfare).toContain('06_crowd-in-hardrock.mp3');
    expect(fanfare).toContain('withBase');
    expect(fanfare).not.toContain('AudioContext');
    expect(fanfare).not.toContain('http://');
    expect(fanfare).not.toContain('https://');
    const buildConfig = readFileSync(join(repoRoot, 'rsbuild.config.ts'), 'utf8');
    expect(buildConfig).toContain("'**/icon-1024.png'");
    expect(html).toContain('content="#0a1a3f"');
  });

  it('allows only the same-origin stay-awake clip as media', () => {
    const html = readFileSync(join(repoRoot, 'src/index.html'), 'utf8');
    expect(mediaSrcDirective(html)).toBe("'self'");
    const file = join(repoRoot, 'public/stay-awake.mp4');
    const bytes = readFileSync(file);
    expect(bytes.subarray(4, 8).toString('ascii')).toBe('ftyp');
    expect(bytes.length).toBeGreaterThan(32);
    expect(bytes.length).toBeLessThan(8_192);
    const latin = bytes.toString('latin1');
    expect(latin).not.toContain('http');
    expect(latin).not.toContain('https');
    const video = readFileSync(join(repoRoot, 'src/stayAwakeVideo.ts'), 'utf8');
    const hook = readFileSync(join(repoRoot, 'src/useWakeLock.ts'), 'utf8');
    expect(video).toContain("setAttribute('playsinline', '')");
    expect(video).toContain('stay-awake.mp4');
    expect(video).not.toContain('http://');
    expect(video).not.toContain('https://');
    expect(video).not.toContain('blob:');
    expect(hook).toContain('STAY_AWAKE_FILE');
    expect(hook).toContain('withBase(');
    expect(hook).not.toContain('http://');
    expect(hook).not.toContain('https://');
    expect(hook).not.toContain('blob:');
    expect(hook).not.toContain('data:');
    const build = readFileSync(join(repoRoot, 'rsbuild.config.ts'), 'utf8');
    const cache = readFileSync(join(repoRoot, 'src/stayAwakeCache.ts'), 'utf8');
    expect(build).toContain('stayAwakeRuntimeCaching');
    expect(build).toContain("'**/stay-awake.mp4'");
    expect(build).not.toContain('txt,mp4');
    expect(cache).toContain('rangeRequests: true');
    expect(cache).toContain('stay-awake\\.mp4');
    expect(hook).toContain("'pointerup'");
    expect(hook).toContain("'click'");
  });

  it('pins the light lottie player and keeps the trophy license with the file', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies['lottie-web']).toBe('5.13.0');
    const player = readFileSync(join(repoRoot, 'node_modules/lottie-web/build/player/lottie_light.js'), 'utf8');
    expect(player.includes('eval(')).toBe(false);
    expect(player.includes('new Function')).toBe(false);
    expect(player.includes('WebAssembly')).toBe(false);
    const notice = readFileSync(join(repoRoot, 'NOTICE'), 'utf8');
    const published = readFileSync(join(repoRoot, 'public/NOTICE.txt'), 'utf8');
    expect(published).toBe(notice);
    expect(notice).toContain('Lottie Simple License');
    expect(notice).toContain('https://lottiefiles.com/free-animation/trophy-RMNQJVdkXj');
    expect(notice).toContain('https://lottiefiles.com/page/license');
    expect(notice).toContain('lottie-web 5.13.0');
    expect(notice).toContain('lottie_light.js');
    const trophy = readFileSync(join(repoRoot, 'src/assets/trophy.json'), 'utf8');
    expect(trophy).not.toContain('http://');
    expect(trophy).not.toContain('https://');
    expect(trophy).not.toContain('eval(');
    const victory = readFileSync(join(repoRoot, 'src/components/Victory.tsx'), 'utf8');
    expect(victory).toContain('lottie-web/build/player/lottie_light');
    expect(victory).toContain('license: DISTRIBUTION_NOTICE');
  });
});

function mediaSrcDirective(html: string): string {
  const policy = html.match(/content="([^"]*media-src[^"]*)"/)?.[1] ?? '';
  return policy.match(/media-src\s+([^;]+)/)?.[1]?.trim() ?? '';
}

function pngInfo(file: string): { width: number; height: number; colorType: number } {
  const bytes = readFileSync(file);
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colorType: bytes[25] ?? -1 };
}
