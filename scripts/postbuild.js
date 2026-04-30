/**
 * Post-build script: copies built output to repo root so the app
 * can be served directly from the repository root as a static site.
 *
 * - dist/dev.html → ./index.html (renamed)
 * - dist/*-src.html → ./*.html
 * - dist/assets/* → ./assets/*
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, existsSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const dist = join(root, 'dist');

// [srcName, dstName] pairs. Extension .html added automatically.
const PAGES = [
  ['dev', 'index'],
  ['mobile-src', 'mobile'],
  ['antenna-src', 'antenna'],
  ['gs-planner-src', 'gs-planner'],
  ['imaging-planner-src', 'imaging-planner'],
  ['imaging-planner-3d-src', 'imaging-planner-3d'],
  ['pass-tracker-src', 'pass-tracker'],
  ['gag-src', 'gag'],
  ['imaging-src', 'imaging'],
  ['stations-src', 'stations'],
  ['constellation-src', 'constellation'],
  ['animation-src', 'animation'],
  ['satellites-tr-src', 'satellites-tr'],
];

for (const [src, dst] of PAGES) {
  const srcPath = join(dist, `${src}.html`);
  if (!existsSync(srcPath)) continue;
  const html = readFileSync(srcPath, 'utf8');
  writeFileSync(join(root, `${dst}.html`), html);
  console.log(`  Copied dist/${src}.html → ${dst}.html`);
}

// Copy assets
const assetsDir = join(dist, 'assets');
const targetAssets = join(root, 'assets');

if (!existsSync(targetAssets)) {
  mkdirSync(targetAssets, { recursive: true });
} else {
  // Clean old assets
  for (const file of readdirSync(targetAssets)) {
    unlinkSync(join(targetAssets, file));
  }
}

for (const file of readdirSync(assetsDir)) {
  copyFileSync(join(assetsDir, file), join(targetAssets, file));
  console.log(`  Copied dist/assets/${file} → assets/${file}`);
}

console.log('Post-build complete: app is ready to serve from repo root.');
