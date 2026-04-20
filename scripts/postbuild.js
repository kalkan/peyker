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
writeFileSync(join(root, 'index.html'), devHtml);
console.log('  Copied dist/dev.html → index.html');

// Copy mobile-src.html → mobile.html (at repo root)
const mobilePath = join(dist, 'mobile-src.html');
if (existsSync(mobilePath)) {
  const mobileHtml = readFileSync(mobilePath, 'utf8');
  writeFileSync(join(root, 'mobile.html'), mobileHtml);
  console.log('  Copied dist/mobile-src.html → mobile.html');
}

// Copy antenna-src.html → antenna.html (at repo root)
const antennaPath = join(dist, 'antenna-src.html');
if (existsSync(antennaPath)) {
  const antennaHtml = readFileSync(antennaPath, 'utf8');
  writeFileSync(join(root, 'antenna.html'), antennaHtml);
  console.log('  Copied dist/antenna-src.html → antenna.html');
}

// Copy gs-planner-src.html → gs-planner.html (at repo root)
const gsPlannerPath = join(dist, 'gs-planner-src.html');
if (existsSync(gsPlannerPath)) {
  const gsPlannerHtml = readFileSync(gsPlannerPath, 'utf8');
  writeFileSync(join(root, 'gs-planner.html'), gsPlannerHtml);
  console.log('  Copied dist/gs-planner-src.html → gs-planner.html');
}

// Copy imaging-planner-src.html → imaging-planner.html (at repo root)
const imagingPlannerPath = join(dist, 'imaging-planner-src.html');
if (existsSync(imagingPlannerPath)) {
  const imagingPlannerHtml = readFileSync(imagingPlannerPath, 'utf8');
  writeFileSync(join(root, 'imaging-planner.html'), imagingPlannerHtml);
  console.log('  Copied dist/imaging-planner-src.html → imaging-planner.html');
}

// Copy imaging-planner-3d-src.html → imaging-planner-3d.html (at repo root)
const imaging3dPath = join(dist, 'imaging-planner-3d-src.html');
if (existsSync(imaging3dPath)) {
  const imaging3dHtml = readFileSync(imaging3dPath, 'utf8');
  writeFileSync(join(root, 'imaging-planner-3d.html'), imaging3dHtml);
  console.log('  Copied dist/imaging-planner-3d-src.html → imaging-planner-3d.html');
}

// Copy pass-tracker-src.html → pass-tracker.html (at repo root)
const passTrackerPath = join(dist, 'pass-tracker-src.html');
if (existsSync(passTrackerPath)) {
  const passTrackerHtml = readFileSync(passTrackerPath, 'utf8');
  writeFileSync(join(root, 'pass-tracker.html'), passTrackerHtml);
  console.log('  Copied dist/pass-tracker-src.html → pass-tracker.html');
}

// Copy gag-src.html → gag.html (at repo root)
const gagPath = join(dist, 'gag-src.html');
if (existsSync(gagPath)) {
  const gagHtml = readFileSync(gagPath, 'utf8');
  writeFileSync(join(root, 'gag.html'), gagHtml);
  console.log('  Copied dist/gag-src.html → gag.html');
}

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
