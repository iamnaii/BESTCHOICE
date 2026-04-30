/**
 * Thai debt-collection law (พ.ร.บ.ทวงถามหนี้ พ.ศ. 2558 มาตรา 9) sending windows.
 *
 * Weekday: 08:00 - 20:00 Asia/Bangkok
 * Weekend or public holiday: 08:00 - 18:00 Asia/Bangkok
 *
 * Both inclusive of 08:00, exclusive of close time (e.g., 20:00:00 = closed).
 */

/**
 * Returns true if `date` is within the allowed Thai compliance window.
 * Caller decides if `date` is a weekend or holiday and passes the flag.
 */
export function isWithinBusinessHours(date: Date, isWeekendOrHoliday: boolean): boolean {
  const hour = parseInt(
    date.toLocaleString('en-US', {
      timeZone: 'Asia/Bangkok',
      hour: '2-digit',
      hour12: false,
    }),
    10,
  );
  const minute = parseInt(
    date.toLocaleString('en-US', {
      timeZone: 'Asia/Bangkok',
      minute: '2-digit',
    }),
    10,
  );
  const totalMinutes = hour * 60 + minute;

  const startMinutes = 8 * 60;
  const endMinutes = isWeekendOrHoliday ? 18 * 60 : 20 * 60;

  return totalMinutes >= startMinutes && totalMinutes < endMinutes;
}

/**
 * Returns the next 08:00 ICT after `date`.
 * If `date` is before 08:00 ICT today, returns today 08:00 ICT (= 01:00:00.000Z).
 * Otherwise returns next day 08:00 ICT.
 *
 * Note: this returns the simple "next 08:00" — does NOT skip ahead past
 * weekends/holidays. The caller (ComplianceService) re-checks at retry time
 * since the window flips between 18:00 and 20:00 close based on day type.
 */
export function nextBusinessHourOpen(date: Date, _isWeekendOrHoliday: boolean): Date {
  const localStr = date.toLocaleString('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const [datePart, timePart] = localStr.split(', ');
  const hour = parseInt(timePart.split(':')[0], 10);

  let targetDateStr: string;
  if (hour < 8) {
    targetDateStr = datePart;
  } else {
    const [y, m, d] = datePart.split('-').map((s) => parseInt(s, 10));
    const next = new Date(Date.UTC(y, m - 1, d) + 24 * 60 * 60 * 1000);
    targetDateStr = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
  }

  return new Date(`${targetDateStr}T01:00:00.000Z`);
}
