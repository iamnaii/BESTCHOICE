import { DeviceReturnStatus, Prisma } from '@prisma/client';

/**
 * ใบรับเครื่องคืนที่ "เปิดอยู่" = เครื่องอยู่ที่สาขาแล้ว — รอ FINANCE ยืนยัน (PENDING_CONFIRM)
 * หรือยืนยันแล้ว (CONFIRMED). spec 2026-09-20 §5.7: ระบบทวงถามต้องไม่ทำงานกับสัญญากลุ่มนี้
 * (คิวนัดชำระไม่แสดง · promise cron ไม่สั่งล็อค MDM) — ส่งกลับ/ยกเลิกแล้วสัญญาเดินต่อตามเดิม.
 *
 * ประกาศที่นี่ที่เดียว — ผู้ใช้ทั้งสองจุด (queue.service.ts, promise-resolution.cron.ts)
 * import ตัวนี้ ห้ามพิมพ์เงื่อนไขซ้ำ. ด่าน "หนึ่งใบรอยืนยันต่อสัญญา" (partial unique) ใช้
 * PENDING_CONFIRM ตรง ๆ ไม่ใช่รายการนี้.
 */
export const OPEN_DEVICE_RETURN_STATUSES: DeviceReturnStatus[] = ['PENDING_CONFIRM', 'CONFIRMED'];

/** where ของ Contract: ไม่มีใบรับเครื่องคืนที่เปิดอยู่ (spread เข้า where ของคิว/cron) */
export function noOpenDeviceReturnWhere(): Prisma.ContractWhereInput {
  return {
    deviceReturns: {
      none: { status: { in: OPEN_DEVICE_RETURN_STATUSES }, deletedAt: null },
    },
  };
}
