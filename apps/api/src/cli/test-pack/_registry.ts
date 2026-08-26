import type { DomainSeeder } from './_types';
import { applicationsSeeder } from './applications.seed';
import { assetsSeeder } from './assets.seed';
import { bookingsSeeder } from './bookings.seed';
import { contractsSeeder } from './contracts.seed';
import { deviceSwapSeeder } from './device-swap.seed';
import { equitySeeder } from './equity.seed';
import { expensesSeeder } from './expenses.seed';
import { inspectionsSeeder } from './inspections.seed';
import { onlineOrdersSeeder } from './online-orders.seed';
import { otherIncomeSeeder } from './other-income.seed';
import { payrollSeeder } from './payroll.seed';
import { repairSeeder } from './repair.seed';
import { stockOpsSeeder } from './stock-ops.seed';
import { suppliersPoSeeder } from './suppliers-po.seed';
import { todosSeeder } from './todos.seed';

/**
 * ลำดับใน array นี้ = ลำดับการสร้าง (โดเมนหลังพึ่ง FK ของโดเมนหน้าได้)
 * cleanup เดินย้อนลำดับนี้เสมอ
 * contracts ต้องเป็นตัวแรก — โดเมนถัดไปพึ่งลูกค้าทดสอบ/เครื่องทดสอบที่มันสร้าง
 */
export const ALL_DOMAINS: DomainSeeder[] = [
  contractsSeeder,
  expensesSeeder,
  payrollSeeder,
  otherIncomeSeeder,
  assetsSeeder,
  equitySeeder,
  suppliersPoSeeder,
  stockOpsSeeder,
  bookingsSeeder,
  onlineOrdersSeeder,
  applicationsSeeder,
  inspectionsSeeder,
  repairSeeder,
  deviceSwapSeeder,
  todosSeeder,
];

export function selectDomains(all: DomainSeeder[], csv: string | undefined): DomainSeeder[] {
  if (!csv || !csv.trim()) return [...all];
  const want = new Set(
    csv
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  const known = new Set(all.map((d) => d.key));
  const unknown = [...want].filter((k) => !known.has(k));
  if (unknown.length) {
    throw new Error(
      `ไม่รู้จักโดเมน: ${unknown.join(', ')} — ที่มีให้เลือก: ${all.map((d) => d.key).join(', ')}`,
    );
  }
  return all.filter((d) => want.has(d.key));
}

export function orderForCleanup(domains: DomainSeeder[]): DomainSeeder[] {
  return [...domains].reverse();
}
