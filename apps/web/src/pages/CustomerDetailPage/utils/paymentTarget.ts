import type { ContractProgress, CustomerDetail } from '../types';

const firstOverdueMs = (k: ContractProgress) =>
  k.firstOverdueDueDate ? new Date(k.firstOverdueDueDate).getTime() : Number.POSITIVE_INFINITY;

/** สัญญาที่กำลังผ่อนและมีงวดค้าง เรียงจากค้างนานสุด (งวดค้างงวดแรกครบกำหนดเก่าสุด) ขึ้นก่อน */
export function overdueContracts(openContracts: ContractProgress[]): ContractProgress[] {
  return openContracts
    .filter((k) => k.overdueInstallments > 0)
    .sort((a, b) => firstOverdueMs(a) - firstOverdueMs(b));
}

/**
 * ค่า ?search= ของหน้ารับชำระ (/payments อ่านแค่ search — R6)
 * - ค้าง 1 สัญญา → เลขสัญญานั้น
 * - ค้างหลายสัญญา → เบอร์ลูกค้า (ช่องค้นของหน้ารับชำระจับ customer.phone ด้วย —
 *   apps/api/src/modules/payments/services/payment-query.service.ts) ให้เห็นงวดค้างทุกใบในครั้งเดียว
 *   ถ้าไม่มีเบอร์ → เลขสัญญาที่ค้างนานสุด
 * - ไม่มีงวดค้าง → เลขสัญญาที่กำลังผ่อนใบแรก หรือ null ถ้าไม่มีสัญญาเปิด
 */
export function paymentSearchFor(customer: Pick<CustomerDetail, 'phone' | 'openContracts'>): string | null {
  const late = overdueContracts(customer.openContracts);
  if (late.length === 1) return late[0].contractNumber;
  if (late.length > 1) return customer.phone || late[0].contractNumber;
  return customer.openContracts[0]?.contractNumber ?? null;
}
