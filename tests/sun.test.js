import { describe, it, expect } from 'vitest';
import { sunElevation, isDaylight } from '../src/sat/sun.js';

// Reference moments with well-known solar geometry (±2° tolerance is fine
// for the simplified Meeus implementation).
const EQUINOX_NOON = new Date('2024-03-20T12:00:00Z');   // sun ~overhead at (0°, 0°)
const EQUINOX_MIDNIGHT = new Date('2024-03-20T00:00:00Z');
const DEC_SOLSTICE_NOON = new Date('2024-12-21T12:00:00Z');

describe('sunElevation', () => {
  it('is near zenith at the equator at equinox local noon', () => {
    expect(sunElevation(EQUINOX_NOON, 0, 0)).toBeGreaterThan(80);
  });

  it('is deeply negative at the equator at equinox local midnight', () => {
    expect(sunElevation(EQUINOX_MIDNIGHT, 0, 0)).toBeLessThan(-60);
  });

  it('stays below the horizon at the north pole in December (polar night)', () => {
    expect(sunElevation(DEC_SOLSTICE_NOON, 89.9, 0)).toBeLessThan(-15);
  });

  it('roughly matches the solar declination limit at the December solstice', () => {
    // Subsolar latitude is ~-23.4°; at (−23.4°, 0°) local noon the sun is near zenith
    expect(sunElevation(DEC_SOLSTICE_NOON, -23.4, 0)).toBeGreaterThan(80);
  });

  it('shifts with longitude: local noon follows the sun westward', () => {
    // At 90°E, local solar noon is ~06:00 UTC and local midnight ~18:00 UTC
    const noonLocal = sunElevation(new Date('2024-03-20T06:00:00Z'), 0, 90);
    const midnightLocal = sunElevation(new Date('2024-03-20T18:00:00Z'), 0, 90);
    expect(noonLocal).toBeGreaterThan(80);
    expect(midnightLocal).toBeLessThan(-60);
  });
});

describe('isDaylight', () => {
  it('true at local noon, false at local midnight', () => {
    expect(isDaylight(EQUINOX_NOON, 0, 0)).toBe(true);
    expect(isDaylight(EQUINOX_MIDNIGHT, 0, 0)).toBe(false);
  });

  it('honours the minElevation threshold', () => {
    // Just after sunset the sun sits between -6° and 0°: civil twilight
    // should count as "day" with a -6° threshold but not with 0°.
    const dusk = new Date('2024-03-20T18:20:00Z');
    const elev = sunElevation(dusk, 0, 0);
    expect(elev).toBeLessThan(0);
    expect(elev).toBeGreaterThan(-6);
    expect(isDaylight(dusk, 0, 0)).toBe(false);
    expect(isDaylight(dusk, 0, 0, -6)).toBe(true);
  });
});
