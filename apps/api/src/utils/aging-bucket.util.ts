/**
 * Canonical 4-way receivables aging split (by days overdue / outstanding):
 *   ≤30 → labels[0]   31-60 → labels[1]   61-90 → labels[2]   90+ → labels[3]
 *
 * Single source of truth for the standard 0-30 / 31-60 / 61-90 / 90+ boundary
 * shared by the AR aging report (accounting) and the inter-company outstanding
 * report. Returns the caller-supplied label for the matched bucket, so each
 * consumer keeps its own label strings (which are part of its API/report
 * contract) while the boundary rule lives in one place.
 *
 * NOTE: bad-debt provisioning intentionally does NOT use this — it needs a
 * finer 5-way split (…/91-180/180+) whose labels key the regulated ECL
 * provision-rate table (NPAEs Ch.13).
 */
export function agingBucket<T>(daysOverdue: number, labels: readonly [T, T, T, T]): T {
  if (daysOverdue <= 30) return labels[0];
  if (daysOverdue <= 60) return labels[1];
  if (daysOverdue <= 90) return labels[2];
  return labels[3];
}
