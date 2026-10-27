import type { QueryClient } from '@tanstack/react-query';

/**
 * หลังเปลี่ยนสถานะเอกสารรายจ่าย (ส่งขออนุมัติ · อนุมัติ · ลงบัญชี · กลับรายการ) — ทุกหน้าที่เก็บใบนั้นไว้ต้องโหลดใหม่:
 * รายการ + ตัวเลขบนแท็บ · หน้ารายละเอียด (`['expense-document', id]` รวม key ย่อย audit) · ฟอร์มแก้ไขใบเงินเดือน
 * (`['expense-doc-edit', id]`) · หน้าสลิป/ใบสำคัญจ่าย (`['expense-doc-voucher', id]`)
 * Payroll D4: ส่งขออนุมัติใบเงินเดือน = server บันทึกใบซ้ำ (คิดแถวระบบใหม่) ⇒ ใบที่เปิดค้างไว้เป็นของเก่าทันที
 */
export function invalidateExpenseDoc(queryClient: QueryClient, id: string | undefined): void {
  queryClient.invalidateQueries({ queryKey: ['expenses'] });
  queryClient.invalidateQueries({ queryKey: ['expenses-summary'] });
  if (!id) return;
  queryClient.invalidateQueries({ queryKey: ['expense-document', id] });
  queryClient.invalidateQueries({ queryKey: ['expense-doc-edit', id] });
  queryClient.invalidateQueries({ queryKey: ['expense-doc-voucher', id] });
}
