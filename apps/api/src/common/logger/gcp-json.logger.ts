import { ConsoleLogger, LogLevel } from '@nestjs/common';

/**
 * GcpJsonLogger — Nest logger ที่พิมพ์ JSON หนึ่งบรรทัดต่อ log พร้อมฟิลด์ `severity`
 * ที่ Cloud Logging รู้จัก (จับคู่ level ของ Nest → severity ของ GCP)
 *
 * ทำไมต้องมี: ConsoleLogger ปกติพิมพ์ข้อความธรรมดา + ANSI color ⇒ Cloud Run เก็บทุกบรรทัด
 * เป็น severity=DEFAULT ⇒ ค้น `severity>=ERROR` ได้ 0 แถวทั้งที่มี error จริง 188 แถว/วัน
 * (audit 2026-08-23) และ alert/monitor ที่อิง severity ตาบอดทั้งหมด
 *
 * เปิดด้วย LOG_FORMAT=json (ตั้งใน Cloud Run เท่านั้น) — dev ยังได้ log สีอ่านง่ายตามเดิม
 */
export class GcpJsonLogger extends ConsoleLogger {
  private static readonly SEVERITY: Record<LogLevel, string> = {
    verbose: 'DEBUG',
    debug: 'DEBUG',
    log: 'INFO',
    warn: 'WARNING',
    error: 'ERROR',
    fatal: 'CRITICAL',
  };

  static enabled(): boolean {
    return process.env.LOG_FORMAT === 'json';
  }

  protected printMessages(
    messages: unknown[],
    context = '',
    logLevel: LogLevel = 'log',
    writeStreamType: 'stdout' | 'stderr' = 'stdout',
    errorStack?: unknown,
  ): void {
    const severity = GcpJsonLogger.SEVERITY[logLevel] ?? 'DEFAULT';
    for (const message of messages) {
      const entry: Record<string, unknown> = {
        severity,
        timestamp: new Date().toISOString(),
        context: context || undefined,
        stack: typeof errorStack === 'string' ? errorStack : undefined,
      };
      if (message instanceof Error) {
        entry.message = message.message;
        entry.stack = message.stack;
      } else if (typeof message === 'object' && message !== null) {
        entry.message = JSON.stringify(message);
      } else {
        entry.message = String(message);
      }
      // Cloud Logging ใช้ stderr/stdout แยกไม่ได้ — severity ในตัว payload คือตัวตัดสิน
      const out = JSON.stringify(entry) + '\n';
      if (writeStreamType === 'stderr') process.stderr.write(out);
      else process.stdout.write(out);
    }
  }

  /** stack ถูกใส่ในบรรทัดเดียวกับ message แล้ว (errorStack) — ไม่พิมพ์ซ้ำอีกบรรทัด */
  protected printStackTrace(): void {
    /* no-op */
  }
}
