import { Prisma } from '@prisma/client';
import { bangkokStartOfDay } from '../../../utils/date.util';
import { d } from '../../../utils/decimal.util';
import { nextDueOf, outstandingOf } from '../../contracts/contract-outstanding';

type DecimalLike = Prisma.Decimal | string | number;

/** สัญญาที่ยังผ่อนอยู่ (ACTIVE/OVERDUE/DEFAULT) — findDetail อ่านมาด้วย select ชุดนี้ */
export interface ProgressContractRow {
  id: string;
  contractNumber: string;
  status: string;
  monthlyPayment: DecimalLike;
  totalMonths: number;
  createdAt: Date;
  mdmLockedAt: Date | null;
  shopWarrantyEndDate: Date | null;
  branch: { name: string } | null;
  product: {
    brand: string | null;
    model: string | null;
    storage: string | null;
    imeiSerial: string | null;
    warrantyExpireDate: Date | null;
  } | null;
}

export interface ProgressPaymentRow {
  contractId: string;
  installmentNo: number;
  status: string;
  dueDate: Date;
  amountDue: DecimalLike;
  amountPaid: DecimalLike;
}

export interface ProgressCallRow {
  contractId: string;
  calledAt: Date;
  result: string;
  notes: string | null;
  caller: { name: string } | null;
}

/** การ์ด "สัญญาที่กำลังผ่อน" บนแท็บภาพรวม — ทุกยอดเงินเป็น number บาท ทศนิยม 2 ตำแหน่ง */
export interface ContractProgress {
  id: string;
  contractNumber: string;
  status: string;
  productLabel: string;
  imeiSerial: string | null;
  branchName: string | null;
  startedAt: string;
  monthlyPayment: number;
  totalInstallments: number;
  paidInstallments: number;
  remainingInstallments: number;
  overdueInstallments: number;
  overdueAmount: number;
  /** คงค้าง = กฎกลาง D2 ของ contract-outstanding.ts (งวดที่ยังไม่ PAID, ไม่รวมค่าปรับ) */
  outstanding: number;
  /** งวดที่ยังไม่ปิดและครบกำหนดตั้งแต่วันนี้ (เวลาไทย) ใกล้สุด — งวดที่ครบกำหนดก่อนวันนี้อยู่ใน firstOverdue* */
  nextDueDate: string | null;
  nextAmountDue: number | null;
  firstOverdueInstallmentNo: number | null;
  firstOverdueDueDate: string | null;
  mdmLocked: boolean;
  shopWarrantyEndDate: string | null;
  centerWarrantyEndDate: string | null;
  lastCall: { calledAt: string; result: string; notes: string | null; callerName: string | null } | null;
}

function productLabelOf(product: ProgressContractRow['product']): string {
  if (!product) return '';
  return [product.brand, product.model, product.storage].filter(Boolean).join(' ');
}

export function buildContractProgress(input: {
  contracts: ProgressContractRow[];
  payments: ProgressPaymentRow[];
  lastCalls: ProgressCallRow[];
  now: Date;
}): ContractProgress[] {
  const paymentsByContract = new Map<string, ProgressPaymentRow[]>();
  for (const row of input.payments) {
    const group = paymentsByContract.get(row.contractId) ?? [];
    group.push(row);
    paymentsByContract.set(row.contractId, group);
  }
  const callByContract = new Map(input.lastCalls.map((call) => [call.contractId, call]));
  // due_date เก็บเป็น 00:00 เวลาไทย ⇒ เทียบกับต้นวันเวลาไทย: งวดที่ครบกำหนดวันนี้ยังเป็นงวดถัดไป ไม่ใช่ "ค้าง 0 วัน"
  // (ค่าปรับเริ่มนับเมื่อค้าง 1 วัน) — helper กลางตัวเดียวกับคิวติดตามหนี้/แดชบอร์ด ห้ามเขียนสูตรที่สอง
  const todayStartMs = bangkokStartOfDay(input.now).getTime();

  return input.contracts.map((contract) => {
    const rows = paymentsByContract.get(contract.id) ?? [];
    const unpaid = rows.filter((row) => row.status !== 'PAID');
    const overdue = unpaid
      .filter((row) => row.dueDate.getTime() < todayStartMs)
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime() || a.installmentNo - b.installmentNo);
    const next = nextDueOf(unpaid.filter((row) => row.dueDate.getTime() >= todayStartMs));
    const call = callByContract.get(contract.id) ?? null;

    return {
      id: contract.id,
      contractNumber: contract.contractNumber,
      status: contract.status,
      productLabel: productLabelOf(contract.product),
      imeiSerial: contract.product?.imeiSerial ?? null,
      branchName: contract.branch?.name ?? null,
      startedAt: contract.createdAt.toISOString(),
      monthlyPayment: d(contract.monthlyPayment).toDecimalPlaces(2).toNumber(),
      // หลังปรับโครงสร้างหนี้ตารางงวดอาจไม่เท่า totalMonths — นับจากแถวจริงเพื่อให้ "ผ่อนแล้ว x/y" กับ "เหลือ z" บวกกันลงตัว
      totalInstallments: rows.length > 0 ? rows.length : contract.totalMonths,
      paidInstallments: rows.length - unpaid.length,
      remainingInstallments: unpaid.length,
      overdueInstallments: overdue.length,
      overdueAmount: outstandingOf(overdue),
      outstanding: outstandingOf(unpaid),
      nextDueDate: next ? next.dueDate.toISOString() : null,
      nextAmountDue: next ? next.amountDue : null,
      firstOverdueInstallmentNo: overdue[0]?.installmentNo ?? null,
      firstOverdueDueDate: overdue[0] ? overdue[0].dueDate.toISOString() : null,
      mdmLocked: contract.mdmLockedAt !== null,
      shopWarrantyEndDate: contract.shopWarrantyEndDate ? contract.shopWarrantyEndDate.toISOString() : null,
      centerWarrantyEndDate: contract.product?.warrantyExpireDate ? contract.product.warrantyExpireDate.toISOString() : null,
      lastCall: call
        ? { calledAt: call.calledAt.toISOString(), result: call.result, notes: call.notes, callerName: call.caller?.name ?? null }
        : null,
    };
  });
}
