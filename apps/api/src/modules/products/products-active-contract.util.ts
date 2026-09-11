/**
 * สรุปสัญญาที่ผูกกับเครื่อง — แนบไปกับ GET /products/:id เมื่อเครื่องขายผ่อนแล้ว
 * (หน้ารายละเอียดสินค้าใช้แสดงการ์ดสัญญาแทนเครื่องคำนวณค่างวด — spec 2026-09-11 §4)
 *
 * ส่งเฉพาะที่หน้าจอต้องใช้: ไม่มีเบอร์/บัตรประชาชนของลูกค้า (ดูได้ในหน้าสัญญาเอง)
 */
export interface ActiveContractSummary {
  id: string;
  contractNumber: string;
  status: string;
  createdAt: Date;
  customerName: string;
  salespersonName: string;
  sellingPrice: string;
  downPayment: string;
  totalMonths: number;
  monthlyPayment: string;
  paidInstallments: number;
  nextDueDate: Date | null;
}

export interface ContractPaymentLike {
  status: string;
  dueDate: Date;
}

/** `Payment` คือ "งวด" — นับที่ PAID แล้ว; งวดถัดไป = dueDate ต่ำสุดของงวดที่ยังไม่ PAID */
export function summarizeContractPayments(payments: ContractPaymentLike[]): {
  paidInstallments: number;
  nextDueDate: Date | null;
} {
  let paidInstallments = 0;
  let nextDueDate: Date | null = null;
  for (const p of payments) {
    if (p.status === 'PAID') {
      paidInstallments += 1;
      continue;
    }
    if (nextDueDate === null || p.dueDate.getTime() < nextDueDate.getTime()) {
      nextDueDate = p.dueDate;
    }
  }
  return { paidInstallments, nextDueDate };
}

export interface ActiveContractRow {
  id: string;
  contractNumber: string;
  status: string;
  createdAt: Date;
  sellingPrice: { toString(): string };
  downPayment: { toString(): string };
  totalMonths: number;
  monthlyPayment: { toString(): string };
  customer: { name: string } | null;
  salesperson: { name: string } | null;
  payments: ContractPaymentLike[];
}

export function toActiveContractSummary(row: ActiveContractRow): ActiveContractSummary {
  const { paidInstallments, nextDueDate } = summarizeContractPayments(row.payments);
  return {
    id: row.id,
    contractNumber: row.contractNumber,
    status: row.status,
    createdAt: row.createdAt,
    customerName: row.customer?.name ?? '',
    salespersonName: row.salesperson?.name ?? '',
    sellingPrice: row.sellingPrice.toString(),
    downPayment: row.downPayment.toString(),
    totalMonths: row.totalMonths,
    monthlyPayment: row.monthlyPayment.toString(),
    paidInstallments,
    nextDueDate,
  };
}
