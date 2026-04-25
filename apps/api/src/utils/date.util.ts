/**
 * Calculate days between a reference date and now (floored to whole days).
 * Returns 0 if the reference date is in the future.
 */
export function calculateDaysOverdue(dueDate: Date | string, now: Date = new Date()): number {
  const due = typeof dueDate === 'string' ? new Date(dueDate) : dueDate;
  return Math.max(0, Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)));
}

/**
 * Calculate days elapsed from a reference date (no clamping to 0).
 * Use for stock aging, duration calculations, etc.
 */
export function calculateDaysElapsed(refDate: Date | string, now: Date = new Date()): number {
  const ref = typeof refDate === 'string' ? new Date(refDate) : refDate;
  return Math.floor((now.getTime() - ref.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Calculate age in years from birth date (approximate using 365.25 days/year).
 */
export function calculateAgeInYears(birthDate: Date | string, now: Date = new Date()): number {
  const birth = typeof birthDate === 'string' ? new Date(birthDate) : birthDate;
  return Math.floor((now.getTime() - birth.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
}

/**
 * Returns the UTC Date that corresponds to 00:00:00 in Asia/Bangkok (UTC+7,
 * no DST) for the same wall-clock day as `now`. Used by KPI / "today" queries
 * so day boundaries match the human operator's calendar regardless of where
 * the server runs.
 *
 * Example: at 2026-04-25 03:00 UTC (which is 2026-04-25 10:00 Bangkok), this
 * returns the UTC Date for 2026-04-24 17:00 UTC (= 2026-04-25 00:00 Bangkok).
 */
export function bangkokStartOfDay(now: Date = new Date()): Date {
  const bangkokNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const y = bangkokNow.getUTCFullYear();
  const m = bangkokNow.getUTCMonth();
  const d = bangkokNow.getUTCDate();
  // 00:00 Bangkok of that wall-clock day = 17:00 UTC of the previous day
  return new Date(Date.UTC(y, m, d, 0, 0, 0, 0) - 7 * 60 * 60 * 1000);
}
