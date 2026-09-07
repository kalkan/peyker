/**
 * Generates the app icon set from a single SVG template:
 *
 *   public/icon.svg              rounded, browser tab / manifest "any"
 *   public/apple-touch-icon.png  180×180 full-bleed (macOS Dock / iOS mask it)
 *   public/icon-192.png          192×192 rounded, manifest
 *   public/icon-512.png          512×512 rounded, manifest
 *   public/icon-maskable-512.png 512×512 full-bleed, content in safe zone
 *
 * Run: node scripts/gen-icons.js  (requires devDependency `sharp`)
 */

import sharp from 'sharp';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pub = join(__dirname, '..', 'public');
mkdirSync(pub, { recursive: true });

/**
 * @param {number} cornerR  background corner radius (0 = full bleed)
 * @param {number} scale    content scale (maskable icons need a safe zone)
 */
function iconSvg(cornerR, scale = 1) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="space" cx="35%" cy="25%" r="90%">
      <stop offset="0%" stop-color="#16213c"/>
      <stop offset="55%" stop-color="#0d1424"/>
      <stop offset="100%" stop-color="#080c16"/>
    </radialGradient>
    <linearGradient id="body" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#b8c4d4"/>
      <stop offset="45%" stop-color="#7d8aa0"/>
      <stop offset="100%" stop-color="#4a5568"/>
    </linearGradient>
    <linearGradient id="panel" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#1a4fc4"/>
      <stop offset="50%" stop-color="#2f6fe8"/>
      <stop offset="100%" stop-color="#1a4fc4"/>
    </linearGradient>
    <linearGradient id="earth" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#2ea8ff"/>
      <stop offset="60%" stop-color="#1866c9"/>
      <stop offset="100%" stop-color="#0b3d8f"/>
    </linearGradient>
    <clipPath id="bg"><rect width="512" height="512" rx="${cornerR}"/></clipPath>
  </defs>

  <g clip-path="url(#bg)">
    <rect width="512" height="512" fill="url(#space)"/>
    <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">

      <!-- stars -->
      <g fill="#ffffff">
        <circle cx="88" cy="96" r="4" opacity="0.9"/>
        <circle cx="430" cy="70" r="3" opacity="0.7"/>
        <circle cx="360" cy="140" r="2.5" opacity="0.5"/>
        <circle cx="60" cy="230" r="2.5" opacity="0.5"/>
        <circle cx="470" cy="210" r="2" opacity="0.6"/>
        <circle cx="150" cy="55" r="2" opacity="0.45"/>
        <circle cx="250" cy="90" r="2" opacity="0.4"/>
      </g>

      <!-- earth horizon -->
      <circle cx="256" cy="810" r="430" fill="url(#earth)"/>
      <circle cx="256" cy="810" r="430" fill="none" stroke="#6fd1ff" stroke-width="6" opacity="0.75"/>
      <circle cx="256" cy="810" r="446" fill="none" stroke="#3f9dff" stroke-width="14" opacity="0.18"/>

      <!-- orbit arc + ground-track dot -->
      <path d="M -20 330 Q 256 130 532 330" fill="none" stroke="#7ee787"
            stroke-width="7" stroke-dasharray="2 26" stroke-linecap="round" opacity="0.85"/>

      <!-- satellite -->
      <g transform="translate(256 225) rotate(-18)">
        <!-- panel arms -->
        <rect x="-150" y="-7" width="300" height="14" rx="7" fill="#39434f"/>
        <!-- left panel -->
        <g>
          <rect x="-226" y="-46" width="132" height="92" rx="10" fill="url(#panel)" stroke="#0d2b66" stroke-width="4"/>
          <path d="M -182 -46 V 46 M -138 -46 V 46 M -226 0 H -94" stroke="#0d2b66" stroke-width="4" fill="none"/>
        </g>
        <!-- right panel -->
        <g>
          <rect x="94" y="-46" width="132" height="92" rx="10" fill="url(#panel)" stroke="#0d2b66" stroke-width="4"/>
          <path d="M 138 -46 V 46 M 182 -46 V 46 M 94 0 H 226" stroke="#0d2b66" stroke-width="4" fill="none"/>
        </g>
        <!-- body -->
        <rect x="-62" y="-62" width="124" height="124" rx="22" fill="url(#body)" stroke="#2b3442" stroke-width="5"/>
        <rect x="-40" y="-40" width="80" height="80" rx="14" fill="#232c3a"/>
        <!-- lens -->
        <circle cx="0" cy="0" r="26" fill="#0f1522" stroke="#58a6ff" stroke-width="5"/>
        <circle cx="-8" cy="-8" r="8" fill="#9ecbff" opacity="0.85"/>
        <!-- antenna -->
        <line x1="0" y1="-62" x2="0" y2="-96" stroke="#b8c4d4" stroke-width="6" stroke-linecap="round"/>
        <circle cx="0" cy="-104" r="9" fill="#7ee787"/>
      </g>

      <!-- downlink beam to earth -->
      <path d="M 236 320 L 256 420 L 276 320 Z" fill="#58a6ff" opacity="0.28"/>
    </g>
  </g>
</svg>`;
}

const rounded = iconSvg(100);
const fullBleed = iconSvg(0);
const maskable = iconSvg(0, 0.78);

writeFileSync(join(pub, 'icon.svg'), rounded);

const jobs = [
  ['apple-touch-icon.png', fullBleed, 180],
  ['icon-192.png', rounded, 192],
  ['icon-512.png', rounded, 512],
  ['icon-maskable-512.png', maskable, 512],
];

for (const [name, svg, size] of jobs) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(join(pub, name));
  console.log(`  ${name} (${size}×${size})`);
}
console.log('Icon set generated in public/.');
