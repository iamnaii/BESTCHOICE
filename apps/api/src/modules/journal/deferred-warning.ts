import * as Sentry from '@sentry/nestjs';

/**
 * สัญญาณเตือน (Sentry, level warning) ที่เกิดระหว่างธุรกรรมของการรับชำระ/การยกเลิกใบเสร็จ.
 *
 * ต้องส่ง**หลังธุรกรรม commit เท่านั้น** (carry จากผลตรวจ PR2): ธุรกรรมที่ล้ม (P2002 / P2034 / ด่านใดก็ตาม)
 * ต้องไม่ทิ้งสัญญาณของงานที่ไม่ได้เกิดขึ้นจริง. template จึงคืนรายการนี้ให้ผู้เรียก — ผู้เรียกที่ส่งธุรกรรมของ
 * ตัวเองเข้าไปต้องเรียก `emitDeferredWarnings` หลัง `$transaction` คืนค่า; template ที่ห่อธุรกรรมเองส่งให้แล้ว
 * และคืนรายการว่าง.
 */
export interface DeferredWarning {
  message: string;
  tags: Record<string, string>;
  extra: Record<string, unknown>;
  /** มีค่า = ส่งเป็น exception (captureException) แทนข้อความ */
  error?: unknown;
}

/** ส่งสัญญาณเตือนที่เก็บไว้ — เรียกหลังธุรกรรม commit แล้วเท่านั้น. ไม่ throw ไม่ว่ากรณีใด. */
export function emitDeferredWarnings(warnings: readonly DeferredWarning[]): void {
  for (const w of warnings) {
    try {
      const context = { level: 'warning' as const, tags: w.tags, extra: w.extra };
      if (w.error !== undefined) Sentry.captureException(w.error, context);
      else Sentry.captureMessage(w.message, context);
    } catch {
      // สัญญาณเตือนห้ามทำให้งานที่ commit แล้วล้ม
    }
  }
}

/**
 * สัญญาณเตือนที่ยังไม่ได้ส่งของผลลัพธ์จาก template — ผลที่ไม่มีฟิลด์นี้ (เช่น mock ในเทสที่คืน undefined)
 * ถือว่าไม่มี.
 */
export function warningsOf(
  result: { warnings?: readonly DeferredWarning[] } | null | undefined,
): readonly DeferredWarning[] {
  return result?.warnings ?? [];
}
