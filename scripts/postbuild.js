/**
 * Post-build script: copies built output to repo root so the app
 * can be served directly from the repository root as a static site.
 *
 * - dist/dev.html → ./index.html (renamed)
 * - dist/assets/* → ./assets/*
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const dist = join(root, 'dist');

// Copy dev.html → index.html (at repo root)
const devHtml = readFileSync(join(dist, 'dev.html'), 'utf8');
// Fix asset paths: ./assets/dev-xxx → ./assets/dev-xxx (already correct)
writeFileSync(join(root, 'index.html'), devHtml);
console.log('  Copied dist/dev.html → index.html');

// Copy assets
const assetsDir = join(dist, 'assets');
const targetAssets = join(root, 'assets');

if (!existsSync(targetAssets)) {
  mkdirSync(targetAssets, { recursive: true });
}

// Clean old assets
if (existsSync(targetAssets)) {
  for (const file of readdirSync(targetAssets)) {
    const { unlinkSync } = await import('fs');
    unlinkSync(join(targetAssets, file));
  }
}

// Copy new assets
for (const file of readdirSync(assetsDir)) {
  copyFileSync(join(assetsDir, file), join(targetAssets, file));
  console.log(`  Copied dist/assets/${file} → assets/${file}`);
}

console.log('Post-build complete: app is ready to serve from repo root.');
