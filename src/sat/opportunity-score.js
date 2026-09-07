/**
 * Heuristic 0–100 quality score for an imaging opportunity.
 *
 *   off-nadir (40 pt)  smaller is better (closer to nadir = sharper, less smear)
 *   sun       (35 pt)  35°–70° solar elevation is the sweet spot
 *   altitude  (15 pt)  lower altitude = better GSD
 *   distance  (10 pt)  shorter slant range = better atmospheric path
 *
 * When the opportunity carries a cloud forecast (opp.cloudCover.total, %),
 * the geometric score is scaled by a cloud factor: clear skies keep the
 * full score, fully overcast drops it to 25%. Forecast-less opportunities
 * are unaffected, so scores stay comparable when the weather API is down.
 *
 * Stars: 1..5 derived from score / 20.
 */
export function computeOpportunityScore(opp, opts = {}) {
  const maxRoll = opts.maxRollDeg || 30;
  const onScore = clamp(40 * (1 - Math.abs(opp.offNadirDeg) / maxRoll), 0, 40);
  const sunScore = sunQuality(opp.sunElevation) * 35;
  const altScore = clamp(15 * (1 - Math.min(1, (opp.altKm - 400) / 800)), 0, 15);
  const distScore = clamp(10 * (1 - Math.min(1, opp.groundDistKm / 1500)), 0, 10);
  let score = onScore + sunScore + altScore + distScore;
  if (opp.cloudCover && typeof opp.cloudCover.total === 'number') {
    score *= cloudFactor(opp.cloudCover.total);
  }
  const stars = Math.max(1, Math.min(5, Math.floor(score / 20 + 0.5)));
  return { score, stars };
}

// 1.0 for clear skies down to 0.25 fully overcast. Thin high clouds hurt
// less than the linear pct suggests, so the curve is gentle below ~30%.
function cloudFactor(totalPct) {
  const f = clamp(totalPct / 100, 0, 1);
  return 1 - 0.75 * f * f * (3 - 2 * f);  // smoothstep-shaped penalty
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Triangular preference centred at 50°, 0 below 0°, 0 above 85°.
function sunQuality(elDeg) {
  if (elDeg < 0) return 0;
  if (elDeg < 20) return elDeg / 20 * 0.6;             // 0..0.6
  if (elDeg <= 60) return 0.6 + (elDeg - 20) / 40 * 0.4; // 0.6..1.0
  if (elDeg <= 85) return 1.0 - (elDeg - 60) / 25 * 0.5; // 1.0..0.5
  return 0.3;
}
