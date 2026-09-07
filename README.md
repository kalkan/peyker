# Satellite Ground Track Planner

A fully static 2D satellite ground track planning and visualization web app with a modern glassmorphism UI. Deployable to GitHub Pages with no backend, no database, and no secret API keys.

## Features

- **Multi-satellite tracking** — Add satellites by NORAD ID or use quick-add presets (IMECE, Gokturk-2)
- **SGP4 orbit propagation** — Accurate ground track computation using satellite.js
- **2D Leaflet map** — OpenStreetMap default + optional satellite imagery basemap (ESRI)
- **Date/time selection** — Render ground tracks for any selected UTC day or custom time window
- **Live position mode** — Real-time satellite position markers with auto-refresh
- **Swath/coverage visualization** — Roll-angle-based ground coverage polygon overlay
- **KML export** — Export single or multi-satellite tracks, positions, and swath polygons
- **Anti-meridian handling** — Correct polyline splitting at the date line
- **Persistent state** — Satellite list and settings saved to localStorage
- **Responsive design** — Works on desktop and mobile

## Stack

| Component | Library |
|-----------|---------|
| Build tool | Vite |
| Map | Leaflet 1.9 |
| Orbit propagation | satellite.js 5.x |
| Language | Vanilla JavaScript (ES modules) |
| Styling | Custom CSS (glassmorphism dark theme) |

## Quick Start

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Local Development

```bash
npm install
npm run dev
```

The dev server opens at `http://localhost:5173` (or the next available port).

## Build

```bash
npm run build
```

Output goes to `./dist/`. This folder is a fully static SPA ready for any static hosting.

## GitHub Pages Deployment

### Option A: Manual

1. Run `npm run build`
2. Push the `dist/` folder contents to the `gh-pages` branch:
   ```bash
   npx gh-pages -d dist
   ```
   Or configure GitHub Pages to serve from `docs/` and copy `dist/` to `docs/`.

### Option B: GitHub Actions

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run build
      - uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./dist
```

### Base path

If deploying to a subdirectory (e.g., `https://user.github.io/repo-name/`), update `vite.config.js`:

```js
export default defineConfig({
  base: '/repo-name/',
  // ...
});
```

## Data Sources

| Data | Source | Auth Required | CORS |
|------|--------|--------------|------|
| TLE (primary) | [CelesTrak GP API](https://celestrak.org/NORAD/elements/gp.php) | No | Yes (friendly) |
| Metadata | CelesTrak GP JSON / SATCAT | No | Varies |
| Basemap | OpenStreetMap | No | Yes |
| Satellite imagery | ESRI World Imagery | No | Yes |

- **Core functionality requires only TLE data** from CelesTrak.
- If SATCAT/metadata fetch fails (CORS, network), the app continues in TLE-only mode.
- All orbital parameters can be derived from TLE; metadata adds launch date, designator, etc.

## Swath Model Assumptions

The coverage/swath visualization is an **approximate planning tool**, not a rigorous sensor model.

**Assumptions:**
- Spherical Earth model (R = 6,371 km)
- Roll angle defines the maximum off-nadir viewing angle on each side
- For angles ≤ 30°: flat-Earth tangent approximation (`half_width = altitude × tan(roll)`)
- For angles > 30°: spherical geometry correction using Earth central angle
- Ground projection is computed perpendicular to the instantaneous track direction
- No atmospheric refraction, terrain elevation, or Earth oblateness corrections
- The sensor is assumed symmetric (same roll angle left and right)

**Use this for:**
- Mission planning and coverage estimation
- Visual assessment of ground swath overlap
- Educational/demonstration purposes

**Do not use this for:**
- Precision sensor footprint analysis
- Operational tasking decisions
- Regulatory compliance calculations

## Known Limitations

1. **TLE accuracy** — SGP4 propagation from TLE degrades over time. TLEs are typically updated every few days; old TLEs may produce inaccurate positions.
2. **Metadata availability** — CelesTrak SATCAT may be blocked by CORS in some browsers. The app falls back gracefully to TLE-only mode.
3. **Satellite imagery basemap** — ESRI World Imagery tiles may not load in restrictive network environments. The app falls back to OpenStreetMap.
4. **Anti-meridian polygons** — Swath polygons crossing the anti-meridian are split into segments, which may show small visual gaps at the crossing.
5. **No offline mode** — TLE fetching requires internet access. The app cannot propagate without first fetching a TLE.
6. **Browser storage** — localStorage is used for persistence. Private/incognito modes may not persist state.
7. **Large time ranges** — Propagating many hours with very small step sizes may be slow on low-powered devices.

## License

MIT — see [LICENSE](./LICENSE).
