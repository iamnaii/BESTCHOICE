/**
 * Returns a Date representing 12:00 noon Asia/Bangkok on the same calendar day
 * as `now`. Used as a stable `postedAt` for journal entries that should land
 * on the BKK business day regardless of the server's UTC clock — without this,
 * a void after 17:00 BKK (= next UTC day) would post in the wrong accounting period.
 */
export function bkkBusinessDate(now: Date): Date {
  const ymd = now.toLocaleString('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // ymd is "YYYY-MM-DD" in BKK; build noon BKK = 05:00 UTC of the same date
  return new Date(`${ymd}T05:00:00.000Z`);
}
