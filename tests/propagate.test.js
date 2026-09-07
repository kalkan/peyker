import { describe, it, expect } from 'vitest';
import { parseTLE, propagateAt, predictPasses } from '../src/sat/propagate.js';

// Real ISS (ZARYA) TLE, epoch 2024-01-01. Column layout is what matters
// to satellite.js; propagation near this epoch is well-conditioned.
const ISS_L1 = '1 25544U 98067A   24001.00000000  .00016717  00000+0  30777-3 0  9990';
const ISS_L2 = '2 25544  51.6416 208.9163 0006317  69.9862 290.2906 15.49560004432155';
const EPOCH_MS = Date.parse('2024-01-01T00:00:00Z');

const GS_ISTANBUL = { lat: 41.0, lon: 29.0, alt: 0.05 };

describe('parseTLE + propagateAt', () => {
  it('parses and propagates to a plausible LEO state at epoch', () => {
    const satrec = parseTLE(ISS_L1, ISS_L2);
    const pos = propagateAt(satrec, new Date(EPOCH_MS));
    expect(pos).toBeTruthy();
    expect(pos.alt).toBeGreaterThan(300);
    expect(pos.alt).toBeLessThan(500);
    expect(Math.abs(pos.lat)).toBeLessThanOrEqual(52);   // ISS inclination 51.64°
    expect(pos.lon).toBeGreaterThanOrEqual(-180);
    expect(pos.lon).toBeLessThanOrEqual(180);
  });

  it('latitude never exceeds inclination across an orbit', () => {
    const satrec = parseTLE(ISS_L1, ISS_L2);
    for (let m = 0; m <= 95; m += 5) {
      const pos = propagateAt(satrec, new Date(EPOCH_MS + m * 60_000));
      expect(pos).toBeTruthy();
      expect(Math.abs(pos.lat)).toBeLessThanOrEqual(52);
    }
  });
});

describe('predictPasses', () => {
  const satrec = parseTLE(ISS_L1, ISS_L2);

  it('finds ordered passes over a mid-latitude station in one day', () => {
    const passes = predictPasses(satrec, GS_ISTANBUL, 1, 60, EPOCH_MS);
    expect(passes.length).toBeGreaterThan(0);
    for (const p of passes) {
      expect(p.aos.getTime()).toBeLessThan(p.los.getTime());
      expect(p.tca.getTime()).toBeGreaterThanOrEqual(p.aos.getTime());
      expect(p.tca.getTime()).toBeLessThanOrEqual(p.los.getTime());
      expect(p.maxEl).toBeGreaterThan(0);
      expect(p.maxEl).toBeLessThanOrEqual(90);
    }
    // Chronological order
    for (let i = 1; i < passes.length; i++) {
      expect(passes[i].aos.getTime()).toBeGreaterThan(passes[i - 1].los.getTime());
    }
  });

  it('sweeps backwards from a past startTime (history mode)', () => {
    const startMs = EPOCH_MS - 86_400_000;  // one day before epoch
    const passes = predictPasses(satrec, GS_ISTANBUL, 1, 60, startMs);
    expect(passes.length).toBeGreaterThan(0);
    for (const p of passes) {
      expect(p.aos.getTime()).toBeGreaterThanOrEqual(startMs);
      expect(p.los.getTime()).toBeLessThanOrEqual(EPOCH_MS + 600_000);
    }
  });

  it('a polar station sees more ISS-inclination passes than the equator', () => {
    const eq = predictPasses(satrec, { lat: 0, lon: 29, alt: 0 }, 1, 60, EPOCH_MS);
    const hi = predictPasses(satrec, { lat: 51, lon: 29, alt: 0 }, 1, 60, EPOCH_MS);
    expect(hi.length).toBeGreaterThanOrEqual(eq.length);
  });
});
