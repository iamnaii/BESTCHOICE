/**
 * เบอร์ของลูกค้าทดสอบที่ seeder โดเมน contracts สร้างเพื่อไปถึงก้าวเปิดสัญญา (`contracts.seed.ts` ข้อ 9 / S4) — **รูปเดียว** `TEST-00000NN`:
 * `formatThaiPhone` ตัดอักขระที่ไม่ใช่ตัวเลขเหลือ 7 หลัก → ไม่ผ่าน ⇒ SMS "สัญญาอนุมัติแล้ว" ของ activate ส่งไม่ออก.
 * แยกไฟล์ (ไม่ประกาศใน contracts.seed.ts) เพราะ `_drive-helpers.ts` ต้อง import ได้โดยไม่ลาก CLI seeder ทั้งชุดเข้า spec ·
 * ด่านก้าวเปิดสัญญา (`ACTIVATION_SILENT_CUSTOMER_WHERE`) เทียบกับรายการค่าทั้งหมดของรูปนี้ ไม่ใช่แค่ prefix
 * (`TEST-0812345678` ก็ขึ้นต้น `TEST-` แต่ตัดแล้วเป็นเบอร์โทรได้ — Task 24 fix round 2 m-4)
 */
export function testDraftCustomerPhone(seq: number): string {
  return `TEST-00000${String(seq % 100).padStart(2, '0')}`;
}

/** ทุกค่าที่ `testDraftCustomerPhone` คืนได้ (`seq % 100`) */
export const TEST_DRAFT_CUSTOMER_PHONES: readonly string[] = Array.from({ length: 100 }, (_, i) =>
  testDraftCustomerPhone(i),
);
