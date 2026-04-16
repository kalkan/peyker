/**
 * Helpers for inspecting TLE freshness.
 *
 * The SGP4 model degrades gradually after the TLE's epoch — error grows
 * roughly as the cube of days-since-epoch. We surface a simple
 * traffic-light freshness indicator (fresh / aging / stale) that any tool
 * can render to warn the user before they run a long propagation against
 * a TLE that's a month old.
 */

/**
 * Extract epoch (as Date) from a satrec.
 */
export function epochFromSatrec(satrec) {
  if (!satrec || satrec.epochyr == null || satrec.epochdays == null) return null;
  const year = satrec.epochyr < 57 ? 2000 + satrec.epochyr : 1900 + satrec.epochyr;
  const d = new Date(Date.UTC(year, 0, 1));
  d.setTime(d.getTime() + (satrec.epochdays - 1) * 86400000);
  return d;
}

/**
 * Days elapsed since the TLE epoch (signed; negative = epoch in the future).
 */
export function ageDays(satrec, now = new Date()) {
  const epoch = epochFromSatrec(satrec);
  if (!epoch) return null;
  return (now.getTime() - epoch.getTime()) / 86400000;
}

/**
 * Classify TLE freshness:
 *   fresh:  ≤ 7 days
 *   aging:  ≤ 14 days
 *   stale:  ≤ 30 days
 *   ancient: > 30 days
 */
export function freshnessLevel(ageInDays) {
  if (ageInDays == null) return 'unknown';
  const a = Math.abs(ageInDays);
  if (a <= 7) return 'fresh';
  if (a <= 14) return 'aging';
  if (a <= 30) return 'stale';
  return 'ancient';
}

/**
 * Build a small descriptor: { ageDays, level, label, color }.
 * Convenient for badges.
 */
export function describeTleAge(satrec, now = new Date()) {
  const days = ageDays(satrec, now);
  const level = freshnessLevel(days);
  const labels = {
    fresh:   `Taze (${days != null ? days.toFixed(1) : '?'} g)`,
    aging:   `Yaslanıyor (${days.toFixed(1)} g)`,
    stale:   `Eski (${days.toFixed(1)} g)`,
    ancient: `Çok eski (${days.toFixed(0)} g)`,
    unknown: 'TLE epoch bilinmiyor',
  };
  const colors = {
    fresh: '#3fb950',
    aging: '#d29922',
    stale: '#f0883e',
    ancient: '#f85149',
    unknown: '#8b949e',
  };
  return { ageDays: days, level, label: labels[level], color: colors[level] };
}
