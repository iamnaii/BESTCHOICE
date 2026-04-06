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
