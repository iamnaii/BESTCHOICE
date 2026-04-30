import { Injectable } from '@nestjs/common';
import holidaysJson from '../../data/thai-holidays.json';

/**
 * Thai public holidays lookup. Used by ComplianceService to determine
 * which business-hour window applies (weekday vs weekend/holiday) per
 * พ.ร.บ.ทวงถามหนี้ มาตรา 9.
 *
 * Holidays are seeded yearly in src/data/thai-holidays.json. Manual update
 * required each year — no external API dependency.
 */
@Injectable()
export class HolidayService {
  private readonly holidaysByYear: Record<string, Set<string>>;

  constructor() {
    const raw = holidaysJson as Record<string, string[]>;
    this.holidaysByYear = Object.fromEntries(
      Object.entries(raw).map(([year, dates]) => [year, new Set(dates)]),
    );
  }

  isHoliday(date: Date): boolean {
    const dateStr = this.toBangkokDateString(date);
    const year = dateStr.slice(0, 4);
    return this.holidaysByYear[year]?.has(dateStr) ?? false;
  }

  private toBangkokDateString(date: Date): string {
    // en-CA locale yields YYYY-MM-DD format
    return date.toLocaleDateString('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }
}
