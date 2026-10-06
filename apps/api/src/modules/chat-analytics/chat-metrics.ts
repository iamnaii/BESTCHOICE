export function minutesUntil(start: Date, at: Date | null): number | null {
  if (at === null) return null;
  const diff = at.getTime() - start.getTime();
  if (!Number.isFinite(diff) || diff < 0) throw new RangeError('Invalid response time');
  return diff / 60000;
}
export function percentileNearestRank(samples: number[], p: number): number | null {
  if (!Number.isFinite(p) || p <= 0 || p > 1 || samples.some((x) => !Number.isFinite(x) || x < 0))
    throw new RangeError('Invalid percentile/sample');
  if (!samples.length) return null;
  return [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * p) - 1];
}
