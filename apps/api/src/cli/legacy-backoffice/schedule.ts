import type { Prisma } from '@prisma/client';
import { buildInstallmentScheduleRows } from '../../utils/installment-schedule.util';
import type { LegacyInstallment } from './legacy-book';
import type { ContractMoney } from './money';

/**
 * แถว `installment_schedules` ของสัญญาที่นำเข้า — ยอดต่องวด (principal / interest / amountDue) มาจาก
 * `buildInstallmentScheduleRows` ตัวเดียวกับสัญญาที่เปิดในระบบใหม่ (ห้ามคิดสูตรซ้ำ) ต่างกันแค่วันครบกำหนด
 * ที่ใช้ของระบบเก่า (เที่ยงคืนกรุงเทพ ตามที่ `legacy-book` อ่าน) · `inst` เรียงตามวันครบกำหนด
 * · จำนวนงวดในระบบเก่าต้องเท่า `totalMonths` (ตรวจด้วย `checkInstallmentAmounts` ก่อน) ไม่งั้น throw
 */
export function buildImportSchedule(
  contractId: string,
  m: ContractMoney,
  inst: readonly LegacyInstallment[],
  createdAt: Date,
): Prisma.InstallmentScheduleCreateManyInput[] {
  if (inst.length !== m.totalMonths) {
    throw new Error(
      `สร้างตารางงวดไม่ได้: สัญญา ${contractId} มีงวดในระบบเก่า ${inst.length} งวด แต่สัญญามี ${m.totalMonths} งวด`,
    );
  }
  const rows = buildInstallmentScheduleRows({
    id: contractId,
    totalMonths: m.totalMonths,
    financedAmount: m.financedAmount,
    interestTotal: m.interestTotal,
    monthlyPayment: m.monthlyPayment,
    paymentDueDay: null,
    createdAt,
  });
  return rows.map((row, i) => ({ ...row, dueDate: inst[i].dueDate }));
}
