import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const dist = join(root, 'dist');
const baseSource = readFileSync(join(root, 'src/base.ts'), 'utf8');
const pageBaseMatch = baseSource.match(/export const PAGE_BASE = '([^']+)';/);
if (!pageBaseMatch) fail('PAGE_BASE missing from src/base.ts');
const pageBase = `${pageBaseMatch[1]}/`;
const banned = [
  'storage.googleapis.com',
  'workbox-cdn',
  'fonts.googleapis',
  'fonts.gstatic',
  'googletagmanager',
  'google-analytics',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'goo.gl',
  'bit.ly',
];

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const htmlPath = join(dist, 'index.html');
const html = readFileSync(htmlPath, 'utf8');
if (!html.includes('Content-Security-Policy')) fail('CSP meta tag missing');
if (!html.includes("default-src 'self'")) fail('CSP is not restricted to self');
if (html.includes('unsafe-inline') || html.includes('unsafe-eval')) fail('CSP allows inline or eval');
const apiUrl = process.env.PUBLIC_API_URL ?? '';
let htmlUrls = html;
if (apiUrl) {
  let api;
  try {
    api = new URL(apiUrl);
  } catch {
    fail('PUBLIC_API_URL is not a URL');
  }
  if (!api || api.protocol !== 'https:' || !api.hostname.endsWith('.workers.dev') || api.username || api.password) {
    fail('PUBLIC_API_URL must be an https workers.dev origin');
  }
  const wss = `wss://${api.host}`;
  if (!html.includes(`connect-src 'self' ${api.origin} ${wss}`)) fail(`CSP connect-src missing ${wss}`);
  if (html.includes(`ws://${api.host}`)) fail('CSP connect-src allows ws:// for an https API');
  htmlUrls = html.split(api.origin).join('').split(wss).join('');
}
if (/https?:\/\//.test(htmlUrls)) fail(`external URL in index.html:\n${html}`);
if (/<script(?![^>]*\bsrc=)[^>]*>/.test(html)) fail('inline script in index.html');
if (/<style[\s>]/i.test(html)) fail('inline style in index.html');
if (!html.includes(pageBase)) fail('base path missing from index.html');

const manifestNames = readdirSync(dist).filter((name) => name.endsWith('.webmanifest'));
if (!manifestNames.includes('manifest.webmanifest')) fail('default manifest missing');
for (const name of manifestNames) {
  const manifest = JSON.parse(readFileSync(join(dist, name), 'utf8'));
  if (manifest.start_url !== pageBase || manifest.scope !== pageBase || manifest.id !== pageBase) {
    fail(`unexpected manifest scope in ${name}: ${manifest.start_url}`);
  }
  if (!manifest.icons.every((icon) => typeof icon.src === 'string' && icon.src.startsWith(pageBase))) {
    fail(`manifest icons are not under PAGE_BASE in ${name}`);
  }
  for (const icon of manifest.icons) {
    const relative = icon.src.slice(pageBase.length);
    if (!statSync(join(dist, relative)).isFile()) fail(`manifest icon missing from dist: ${relative}`);
  }
}

const precached = [
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-192.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon-180.png',
  'favicon.ico',
  'favicon-16.png',
  'favicon-32.png',
  'manifest.webmanifest',
  'NOTICE.txt',
];
const sw = readFileSync(join(dist, 'sw.js'), 'utf8');
for (const file of precached) {
  if (!sw.includes(`${pageBase}${file}`)) fail(`precache missing ${file}`);
}
if (sw.includes('icon-1024.png')) fail('icon-1024.png must not be precached');
if (!statSync(join(dist, 'icons/icon-1024.png')).isFile()) fail('icon-1024.png missing from dist');
if (sw.includes('importScripts(')) fail('service worker loads an external script');

for (const file of walk(dist)) {
  if (file.endsWith('.png') || file.endsWith('.ico')) continue;
  const text = readFileSync(file, 'utf8');
  if (text.includes('__PADEL_TEST_API__')) fail(`test API hook shipped in ${file}`);
  for (const host of banned) {
    if (text.includes(host)) fail(`${host} found in ${file}`);
  }
}

console.log('verify-build: ok');
