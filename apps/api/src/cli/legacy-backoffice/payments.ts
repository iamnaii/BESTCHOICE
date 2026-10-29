import { Prisma } from '@prisma/client';
import type { ContractDocumentType, PaymentStatus } from '@prisma/client';
import { formatMoney } from './csv';
import type {
  LegacyContract,
  LegacyFileKind,
  LegacyInstallment,
  LegacyReceipt,
} from './legacy-book';

/**
 * แปลงการรับเงิน / หลักฐาน / เอกสารของสัญญาระบบเก่า (Task 5 · สเปก 5.5 · 5.7 · 5.8) — ฟังก์ชันบริสุทธิ์
 *
 * **ยอดจ่ายของงวด (`amountPaid`)** — ใบรับเงินค่างวด (`kind: 'INSTALLMENT'`) ผูกงวดด้วย `installmentLegacyId`
 * ยอด = Σ `receipt.installment` (ไม่รวมค่าปรับ / ส่วนลด) เทียบกับ `inst.paid` (`ins_paid` หรือยอดที่
 * `applyPeakBalance` ปรับตาม PEAK แล้ว):
 * - สัญญาที่**ไม่มี**รายการปิดบัญชี: ใช้ค่าที่มากกว่า — ไม่มีใบรับเงิน = `inst.paid` · `applyPeakBalance` เพิ่มได้แค่
 *   `paid` ⇒ ยอดค้างของงวด (`amountDue − amountPaid`) รวมกันเท่า PEAK (ร่าง 4) · ต่างกันเมื่อไร = `warnings`
 *   (dump 29/10 ก่อนปรับ หลังปัด 2 ตำแหน่ง: Σ ใบ = `ins_paid` ทุกงวดของสัญญาผ่อนอยู่ทั้ง 477 สัญญา)
 * - สัญญาที่**มี**รายการปิดบัญชี (`c.close`): ใช้ Σ ใบรับเงินค่างวดเท่านั้น — ระบบเก่ากระจายยอดปิดบัญชีลง `ins_paid`
 *   ของงวดที่ปิด (`ins_type = 1` · dump 29/10: 728 งวด ทั้งหมดในสัญญาสถานะ 3 ที่มีรายการปิด) ถ้าใช้ `ins_paid`
 *   ยอดปิดบัญชีจะถูกนับสองครั้ง (อยู่ใน `close.amount` แล้ว) · ส่วน `ins_paid − Σ ใบ` = ยอดปิดบัญชี ไม่เตือน ·
 *   Σ ใบ > `ins_paid` = เตือน
 *
 * **สถานะ** (ไม่ใช้ `statusCode` ของระบบเก่า — `applyPeakBalance` ไม่แก้ค่านี้): จ่าย ≥ ค่างวด = `PAID` ·
 * จ่ายบางส่วน = `PARTIALLY_PAID` · ไม่ได้จ่ายและครบกำหนดก่อน `cutoff` = `OVERDUE` · นอกนั้น `PENDING`
 * · `paidDate` = วันโอนของใบรับเงินล่าสุดเมื่อ `PAID` (ไม่มีใบรับเงิน = ว่าง) · `lateFee` = Σ `mulct` ของใบรับเงินค่างวด
 *
 * **`kind 'HISTORY'`** (สัญญาปิด/ยกเลิก — สเปก 5.7) คืนเฉพาะงวดที่ `amountPaid > 0` เลขงวดคงเดิม
 *
 * **หลักฐาน** = หนึ่งแถวต่อใบรับเงินที่มีสลิป (ยอด = `receipt.amount` ยอดในสลิป) · `installmentNo = null` =
 * หลักฐานระดับสัญญา: ใบปิดบัญชีก่อนกำหนด (`EARLY_PAYOFF` — ไม่กระจายเข้างวด ยอดอยู่ใน `close.amount`) ·
 * ใบที่ชี้งวดที่ไม่มีในสัญญา · ใบของงวดที่ไม่ถูกนำเข้า (เตือนทั้งสองอย่างหลัง)
 *
 * **ปัด 2 ตำแหน่ง (HALF_UP) ก่อนใช้ทุกยอด** — `ins_paid` / `ins_balance` เป็น `float` ใน MariaDB และ
 * `payment_installment.amount` เป็น `double` (dump 29/10: `ins_paid` มีเศษหลังทศนิยมตำแหน่งที่ 2 อยู่ 46 งวด
 * · `amount` 54 ใบ) ถ้าไม่ปัด งวดที่จ่ายครบจะเทียบกับใบรับเงินไม่เท่า และยอดที่เขียนลง Decimal(12,2) จะไม่ตรงกับ
 * ที่ใช้ตัดสินสถานะ
 *
 * `warnings` บอกได้แค่เลขสัญญา รหัสงวด และรหัสใบรับเงินของระบบเก่า — ไม่มียอดเงิน ไม่มีข้อมูลลูกค้า
 */

type Decimal = Prisma.Decimal;

export type PaymentDraft = {
  installmentNo: number;
  dueDate: Date;
  amountDue: Decimal;
  amountPaid: Decimal;
  status: PaymentStatus;
  paidDate: Date | null;
  lateFee: Decimal;
  notes: string;
  legacyInstallmentCode: string;
};

/** `installmentNo = null` = หลักฐานระดับสัญญา (ใบปิดบัญชีก่อนกำหนด หรือใบที่ผูกงวดที่นำเข้าไม่ได้) */
export type EvidenceDraft = {
  installmentNo: number | null;
  slipPath: string;
  /** ยอดในสลิป (`receipt.amount`) */
  amount: Decimal;
  legacyReceiptId: string;
  /** วันโอน */
  date: Date;
};

export type DocumentDraft = {
  documentType: ContractDocumentType;
  path: string;
  notes: string | null;
};

export type PaymentMapping = {
  payments: PaymentDraft[];
  evidences: EvidenceDraft[];
  warnings: string[];
};

const NOTE_PREFIX = 'ยกมาจากระบบเก่า';
const ZERO = new Prisma.Decimal(0);

/** ยอดจาก dump (float/double) → 2 ตำแหน่ง */
function money(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** ไฟล์แนบระบบเก่า → ประเภทเอกสารสัญญา — `Record` ครบทุกชนิด: ชนิดใหม่ใน `LegacyFileKind` = compile ไม่ผ่าน */
const DOCUMENT_TYPE: Record<
  LegacyFileKind,
  { documentType: ContractDocumentType; notes: string | null }
> = {
  img_contract: { documentType: 'SIGNED_CONTRACT', notes: null },
  img_selfie: { documentType: 'KYC_SELFIE', notes: null },
  img_receive: { documentType: 'DEVICE_RECEIPT_PHOTO', notes: null },
  img_line: { documentType: 'LINE_PROFILE', notes: null },
  img_facebook: { documentType: 'FACEBOOK_PROFILE', notes: null },
  img_income: { documentType: 'BANK_STATEMENT', notes: null },
  img_lock: { documentType: 'OTHER', notes: 'ภาพล็อกเครื่อง' },
  order_product_file: {
    documentType: 'OTHER',
    notes: 'ไฟล์แนบคำสั่งซื้อจากระบบเก่า (order_product_file)',
  },
  contract_file: { documentType: 'OTHER', notes: 'ไฟล์แนบสัญญาจากระบบเก่า (contract_file)' },
};

function sum(values: readonly Decimal[]): Decimal {
  return values.reduce((total, value) => total.plus(value), ZERO);
}

function latestDate(receipts: readonly LegacyReceipt[]): Date | null {
  let latest: Date | null = null;
  for (const r of receipts) if (latest === null || r.date > latest) latest = r.date;
  return latest;
}

function statusOf(amountDue: Decimal, amountPaid: Decimal, dueDate: Date, cutoff: Date) {
  if (amountPaid.gte(amountDue)) return 'PAID' satisfies PaymentStatus;
  if (amountPaid.gt(0)) return 'PARTIALLY_PAID' satisfies PaymentStatus;
  if (dueDate.getTime() < cutoff.getTime()) return 'OVERDUE' satisfies PaymentStatus;
  return 'PENDING' satisfies PaymentStatus;
}

/**
 * งวด + ใบรับเงินค่างวดของสัญญา (`c.installments` เรียงตามวันครบกำหนด — งวดที่ = ลำดับ + 1)
 * → แถว `payments` · หลักฐานการโอน · ข้อเตือน
 */
export function mapPayments(
  c: LegacyContract,
  kind: 'ACTIVE' | 'HISTORY',
  cutoff: Date,
): PaymentMapping {
  const warnings: string[] = [];
  const hasPayoff = c.close !== null;
  const installmentNoById = new Map(c.installments.map((inst, i) => [inst.legacyId, i + 1]));

  const receiptsByInstallment = new Map<string, LegacyReceipt[]>();
  for (const r of c.receipts) {
    if (r.kind !== 'INSTALLMENT') continue;
    if (r.installmentLegacyId === null || !installmentNoById.has(r.installmentLegacyId)) {
      warnings.push(
        `สัญญา ${c.code}: ใบรับเงิน ${r.legacyId} ชี้งวดที่ไม่มีในสัญญา — ไม่นับเป็นยอดจ่ายของงวดใด (สลิปแนบระดับสัญญา)`,
      );
      continue;
    }
    const list = receiptsByInstallment.get(r.installmentLegacyId);
    if (list) list.push(r);
    else receiptsByInstallment.set(r.installmentLegacyId, [r]);
  }

  const toPayment = (inst: LegacyInstallment, index: number): PaymentDraft => {
    const where = `สัญญา ${c.code} งวด ${inst.legacyCode}`;
    const receipts = receiptsByInstallment.get(inst.legacyId) ?? [];
    const amountDue = money(inst.amount);
    const legacyPaid = money(inst.paid);
    const fromReceipts = sum(receipts.map((r) => money(r.installment)));

    let amountPaid: Decimal;
    let unbacked = false; // ยอดจ่ายส่วนที่ไม่มีใบรับเงินหนุน
    if (hasPayoff) {
      amountPaid = fromReceipts;
      if (fromReceipts.gt(legacyPaid)) {
        warnings.push(
          `${where}: ยอดใบรับเงินค่างวดมากกว่ายอดจ่ายของงวดในระบบเก่า — ใช้ยอดใบรับเงิน`,
        );
      }
    } else {
      amountPaid = Prisma.Decimal.max(fromReceipts, legacyPaid);
      unbacked = legacyPaid.gt(fromReceipts);
      if (receipts.length === 0 && unbacked) {
        warnings.push(`${where}: มียอดจ่ายในระบบเก่าแต่ไม่มีใบรับเงิน — ใช้ยอดจ่ายของงวด`);
      } else if (unbacked) {
        warnings.push(
          `${where}: ยอดจ่ายของงวด (ins_paid หรือที่ปรับตาม PEAK) มากกว่าใบรับเงิน — ใช้ยอดจ่ายของงวด`,
        );
      } else if (fromReceipts.gt(legacyPaid)) {
        warnings.push(`${where}: ยอดใบรับเงินมากกว่ายอดจ่ายของงวด (ins_paid) — ใช้ยอดใบรับเงิน`);
      }
    }
    if (!amountDue.gt(0)) {
      warnings.push(`${where}: ค่างวดในระบบเก่าไม่เป็นบวก`);
    } else if (amountPaid.gt(amountDue)) {
      warnings.push(`${where}: ยอดจ่ายเกินค่างวด`);
    }

    const status = statusOf(amountDue, amountPaid, inst.dueDate, cutoff);
    const discount = sum(receipts.map((r) => money(r.discount)));
    const receiptIds = receipts.map((r) => r.legacyId).join(', ');
    const notes = [`${NOTE_PREFIX} · งวด ${inst.legacyCode}`];
    if (receipts.length > 0) notes.push(`ใบรับเงินเดิม ${receiptIds}`);
    if (unbacked) {
      notes.push(
        receipts.length === 0
          ? 'ไม่มีใบรับเงินในระบบเก่า ใช้ยอดจ่ายของงวด'
          : 'ยอดจ่ายรวมส่วนที่ไม่มีใบรับเงิน',
      );
    }
    if (discount.gt(0)) notes.push(`ส่วนลด ${formatMoney(discount)}`);
    if (hasPayoff && amountPaid.lt(amountDue)) {
      notes.push('ส่วนที่เหลือปิดด้วยการปิดบัญชีก่อนกำหนด');
    }

    return {
      installmentNo: index + 1,
      dueDate: inst.dueDate,
      amountDue,
      amountPaid,
      status,
      paidDate: status === 'PAID' ? latestDate(receipts) : null,
      lateFee: sum(receipts.map((r) => money(r.mulct))),
      notes: notes.join(' · '),
      legacyInstallmentCode: inst.legacyCode,
    };
  };

  const all = c.installments.map(toPayment);
  const payments = kind === 'HISTORY' ? all.filter((p) => p.amountPaid.gt(0)) : all;
  const imported = new Set(payments.map((p) => p.installmentNo));

  // งวดที่มีใบรับเงินแต่ไม่ถูกนำเข้า (ยอดจ่ายค่างวด 0 เช่นจ่ายแต่ค่าปรับ) — ค่าปรับของงวดนั้นไม่ถูกนำเข้าด้วย
  c.installments.forEach((inst, i) => {
    const receipts = receiptsByInstallment.get(inst.legacyId);
    if (!receipts || imported.has(i + 1)) return;
    const receiptIds = receipts.map((r) => r.legacyId).join(', ');
    warnings.push(
      `สัญญา ${c.code} งวด ${inst.legacyCode}: มีใบรับเงิน ${receiptIds} แต่ยอดจ่ายค่างวดเป็น 0 — งวดนี้ไม่นำเข้า (สเปก 5.7) สลิปแนบระดับสัญญา`,
    );
  });

  const evidences: EvidenceDraft[] = [];
  for (const r of c.receipts) {
    if (r.slipPath === null) continue;
    let installmentNo: number | null = null;
    if (r.kind === 'INSTALLMENT' && r.installmentLegacyId !== null) {
      const no = installmentNoById.get(r.installmentLegacyId);
      if (no !== undefined && imported.has(no)) installmentNo = no;
    }
    evidences.push({
      installmentNo,
      slipPath: r.slipPath,
      amount: money(r.amount),
      legacyReceiptId: r.legacyId,
      date: r.date,
    });
  }

  return { payments, evidences, warnings };
}

/** ไฟล์แนบของคำสั่งซื้อ/สัญญา → เอกสารสัญญา (ลำดับตาม `c.files`) */
export function mapContractDocuments(c: LegacyContract): DocumentDraft[] {
  return c.files.map((file) => ({ ...DOCUMENT_TYPE[file.kind], path: file.path }));
}
