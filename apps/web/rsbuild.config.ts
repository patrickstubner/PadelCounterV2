import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type RsbuildPlugin } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { generateSW } from 'workbox-build';
import { PAGE_BASE } from './src/base';
import { connectSrcExtra } from './src/csp';

const appVersion = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version;
const apiUrl = process.env.PUBLIC_API_URL ?? '';
const connectSrc = connectSrcExtra(apiUrl, process.env.NODE_ENV !== 'production');

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applyPageBase(dist: string): void {
  const root = `${PAGE_BASE}/`;
  for (const name of readdirSync(dist)) {
    if (!name.endsWith('.webmanifest')) continue;
    const manifestPath = join(dist, name);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      id: string;
      start_url: string;
      scope: string;
      icons: { src: string }[];
    };
    manifest.id = root;
    manifest.start_url = root;
    manifest.scope = root;
    for (const icon of manifest.icons) {
      icon.src = `${root}${icon.src.replace(/^\.?\//, '')}`;
    }
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
}

const workboxPlugin: RsbuildPlugin = {
  name: 'padel-workbox',
  setup(api) {
    api.onAfterBuild(async () => {
      if (api.context.action !== 'build') return;
      const dist = api.context.distPath;
      const swDest = join(dist, 'sw.js');
      const prefix = `${PAGE_BASE}/`;
      applyPageBase(dist);
      await generateSW({
        swDest,
        globDirectory: dist,
        globPatterns: ['**/*.{html,js,css,webmanifest,png,svg,ico,txt,mp4}'],
        globIgnores: ['**/sw.js', '**/*.map', '**/icon-1024.png'],
        modifyURLPrefix: { '': prefix },
        inlineWorkboxRuntime: true,
        mode: 'production',
        sourcemap: false,
        clientsClaim: true,
        skipWaiting: true,
        cacheId: 'padel-counter-v2-2',
        cleanupOutdatedCaches: true,
        disableDevLogs: true,
        navigateFallback: `${prefix}index.html`,
        navigateFallbackDenylist: [new RegExp(`^${escapeRegExp(prefix)}.+\\.[a-z0-9]+$`, 'i')],
        directoryIndex: 'index.html',
      });
      const original = readFileSync(swDest, 'utf8');
      const stripped = original
        .replace(/\/\*\*[\s\S]*?Welcome to your Workbox[\s\S]*?\*\//, '')
        .replaceAll('https://bit.ly/wb-precache', 'Workbox precache guidance');
      if (stripped !== original) writeFileSync(swDest, stripped);
      const commit = process.env.GITHUB_SHA ?? 'dev';
      writeFileSync(
        join(dist, 'version.json'),
        `${JSON.stringify({ version: appVersion, commit, protocol: 1 })}\n`,
      );
    });
  },
};

export default defineConfig({
  plugins: [pluginReact(), workboxPlugin],
  source: {
    entry: {
      index: './src/index.tsx',
    },
    define: {
      'import.meta.env.APP_VERSION': JSON.stringify(appVersion),
      'import.meta.env.PUBLIC_API_URL': JSON.stringify(apiUrl),
    },
  },
  html: {
    template: './src/index.html',
    title: 'Padel Counter V2',
    mountId: 'root',
    templateParameters: {
      connectSrc,
    },
  },
  server: {
    base: PAGE_BASE,
    port: 4173,
    strictPort: true,
  },
  output: {
    assetPrefix: PAGE_BASE,
    distPath: 'dist',
    legalComments: 'none',
    sourceMap: false,
    inlineScripts: false,
    inlineStyles: false,
    dataUriLimit: 0,
    polyfill: 'off',
  },
});
