import { describe, it, expect } from 'vitest';
import { computeOpportunityScore } from '../src/sat/opportunity-score.js';

const baseOpp = {
  offNadirDeg: 0,
  sunElevation: 50,
  altKm: 400,
  groundDistKm: 400,
};

describe('computeOpportunityScore', () => {
  it('scores a near-perfect opportunity high with 5 stars', () => {
    const { score, stars } = computeOpportunityScore({ ...baseOpp }, { maxRollDeg: 5 });
    expect(score).toBeGreaterThan(85);
    expect(stars).toBe(5);
  });

  it('always stays within 0–100 and 1–5 stars', () => {
    const worst = computeOpportunityScore(
      { offNadirDeg: 5, sunElevation: -10, altKm: 1400, groundDistKm: 3000 },
      { maxRollDeg: 5 },
    );
    expect(worst.score).toBeGreaterThanOrEqual(0);
    expect(worst.score).toBeLessThanOrEqual(100);
    expect(worst.stars).toBeGreaterThanOrEqual(1);
    expect(worst.stars).toBeLessThanOrEqual(5);
  });

  it('prefers better sun elevation', () => {
    const dim = computeOpportunityScore({ ...baseOpp, sunElevation: 5 }, { maxRollDeg: 5 });
    const good = computeOpportunityScore({ ...baseOpp, sunElevation: 50 }, { maxRollDeg: 5 });
    expect(good.score).toBeGreaterThan(dim.score);
  });

  it('prefers smaller off-nadir angles', () => {
    const nadir = computeOpportunityScore({ ...baseOpp, offNadirDeg: 0 }, { maxRollDeg: 5 });
    const edge = computeOpportunityScore({ ...baseOpp, offNadirDeg: 4.5 }, { maxRollDeg: 5 });
    expect(nadir.score).toBeGreaterThan(edge.score);
  });

  describe('cloud penalty', () => {
    it('leaves the score untouched without a forecast', () => {
      const noCloud = computeOpportunityScore({ ...baseOpp }, { maxRollDeg: 5 });
      const zeroCloud = computeOpportunityScore(
        { ...baseOpp, cloudCover: { total: 0 } }, { maxRollDeg: 5 },
      );
      expect(zeroCloud.score).toBeCloseTo(noCloud.score, 5);
    });

    it('cuts a fully overcast opportunity to a quarter of its score', () => {
      const clear = computeOpportunityScore({ ...baseOpp }, { maxRollDeg: 5 });
      const overcast = computeOpportunityScore(
        { ...baseOpp, cloudCover: { total: 100 } }, { maxRollDeg: 5 },
      );
      expect(overcast.score).toBeCloseTo(clear.score * 0.25, 3);
      expect(overcast.stars).toBeLessThan(5);
    });

    it('penalises monotonically with increasing cloud cover', () => {
      let prev = Infinity;
      for (const pct of [0, 25, 50, 75, 100]) {
        const { score } = computeOpportunityScore(
          { ...baseOpp, cloudCover: { total: pct } }, { maxRollDeg: 5 },
        );
        expect(score).toBeLessThanOrEqual(prev);
        prev = score;
      }
    });

    it('is gentle on thin cloud (≤30% keeps most of the score)', () => {
      const clear = computeOpportunityScore({ ...baseOpp }, { maxRollDeg: 5 });
      const thin = computeOpportunityScore(
        { ...baseOpp, cloudCover: { total: 30 } }, { maxRollDeg: 5 },
      );
      expect(thin.score).toBeGreaterThan(clear.score * 0.8);
    });
  });
});
