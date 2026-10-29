import type { ScheduleModuleOptions } from '@nestjs/schedule';

/**
 * CRON_ENABLED — ตัวเปิด/ปิดงานตามเวลา (@Cron / @Interval / @Timeout) ทั้งโปรเซส
 *
 * - ไม่ตั้ง / ค่าว่าง        → true (พฤติกรรมเดิม: ทุก instance รัน cron)
 * - true / 1 / yes / on     → true
 * - false / 0 / no / off    → false (เช่น bestchoice-api หลังแยก bestchoice-worker)
 * - ค่าอื่น (พิมพ์ผิด)       → throw ตอนบูต — ตั้งใจให้ revision ใหม่ล้มแทนที่จะเดาผิด
 *   (เดาเป็น true = cron รันซ้ำกับ worker, เดาเป็น false = cron หายเงียบ ๆ)
 */
const TRUE_VALUES = new Set(['true', '1', 'yes', 'on']);
const FALSE_VALUES = new Set(['false', '0', 'no', 'off']);

export function parseCronEnabled(raw: string | undefined | null): boolean {
  if (raw === undefined || raw === null) return true;
  const value = raw.trim().toLowerCase();
  if (value === '') return true;
  if (TRUE_VALUES.has(value)) return true;
  if (FALSE_VALUES.has(value)) return false;
  throw new Error(
    `Invalid CRON_ENABLED="${raw}" — use true/false (also accepted: 1/0, yes/no, on/off)`,
  );
}

export function isCronEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseCronEnabled(env.CRON_ENABLED);
}

/** ตัวเลือกของ ScheduleModule — ปิดทั้ง cron, interval และ timeout พร้อมกัน */
export function scheduleModuleOptions(env: NodeJS.ProcessEnv = process.env): ScheduleModuleOptions {
  const enabled = isCronEnabled(env);
  return { cronJobs: enabled, intervals: enabled, timeouts: enabled };
}
