import { Prisma } from '@prisma/client';
import type { ContractDocumentType, PaymentStatus } from '@prisma/client';
import { dRound } from '../../utils/decimal.util';
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
 * จ่ายบางส่วน = `PARTIALLY_PAID` · ไม่ได้จ่ายและครบกำหนดก่อน `cutoff` = `OVERDUE` (เหมือน `classify.ts` — งวดครบกำหนด
 * วันตัดเองค้างได้) · นอกนั้น `PENDING` · `paidDate` = วันโอนของใบรับเงินล่าสุดที่จ่ายค่างวด (`installment > 0` —
 * ใบที่จ่ายแต่ค่าปรับไม่นับ) เมื่อ `PAID` · ไม่มีใบรับเงินแบบนั้น = ว่าง
 * - `kind 'HISTORY'` + สัญญามีรายการปิดบัญชี: งวดที่จ่ายบางส่วน → `PAID` · `paidDate = close.createdAt` · `amountPaid`
 *   คงเป็นยอดใบรับเงิน (ส่วนที่เหลืออยู่ใน `close.amount`) — แบบเดียวกับที่ระบบปิดบัญชีก่อนกำหนดเองตั้งงวดที่เหลือเป็น
 *   `PAID` (ไม่งั้นงวดเปิดค้างบนสัญญาที่ปิดแล้วไปโผล่ในรายงานอายุหนี้)
 *
 * **ค่าปรับ** — `lateFee` = 0 เสมอ: ใน BESTCHOICE `lateFee` คือค่าปรับที่ยังต้องเก็บ และยอดค้างของงวด =
 * `amountDue + lateFee − amountPaid` ⇒ ใส่ค่าปรับที่ระบบเก่าเก็บไปแล้วจะเรียกเก็บซ้ำ (และลงรายได้ค่าปรับซ้ำ — PEAK
 * ลงไปแล้ว) · `lateFeePaid` = Σ `mulct` ของใบรับเงินค่างวด เก็บไว้เป็นประวัติ (และเขียนใน `notes`) · `amountPaid`
 * ไม่รวมค่าปรับ ⇒ Σ(`amountDue − amountPaid`) ของสัญญาผ่อนอยู่ = PEAK ยังเป็นจริง
 *
 * **`kind 'HISTORY'`** (สัญญาปิด/ยกเลิก — สเปก 5.7) คืนเฉพาะงวดที่ `amountPaid > 0` เลขงวดคงเดิม · งวดที่ไม่นำเข้าไม่มี
 * ข้อเตือนเรื่องยอดของงวด (เช่นค่างวดติดลบของสัญญายกเลิก) — มีแค่ข้อเตือนว่าสลิปของงวดนั้นแนบระดับสัญญา
 *
 * **`kind 'ACTIVE'` + สัญญามีรายการปิดบัญชี** = ข้อมูลขัดกัน (ยอดจ่ายใช้ใบรับเงินอย่างเดียว ไม่สนยอดที่ปรับตาม PEAK)
 * → ข้อเตือนขึ้นต้น `BLOCK:` ให้ Task 10 ทำเป็นตัวบล็อก
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
  /** 0 เสมอ — ค่าปรับที่ยังต้องเก็บ (ของเก่าเก็บแล้ว) */
  lateFee: Decimal;
  /** ค่าปรับที่ระบบเก่าเก็บไปแล้ว (Σ `mulct`) — ประวัติเท่านั้น ไม่เข้ายอดค้าง */
  lateFeePaid: Decimal;
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
const UNBACKED_NOTE = 'ยอดจ่ายตามบันทึกงวดของระบบเก่าหรือยอดที่ปรับตาม PEAK ไม่ใช่ผลรวมใบรับเงิน';
const PAYOFF_NOTE = 'ส่วนที่เหลือปิดด้วยการปิดบัญชีก่อนกำหนด';
const ZERO = new Prisma.Decimal(0);

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

function statusOf(
  amountDue: Decimal,
  amountPaid: Decimal,
  dueDate: Date,
  cutoff: Date,
): PaymentStatus {
  if (amountPaid.gte(amountDue)) return 'PAID';
  if (amountPaid.gt(0)) return 'PARTIALLY_PAID';
  if (dueDate.getTime() < cutoff.getTime()) return 'OVERDUE';
  return 'PENDING';
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
  const close = c.close;
  const installmentNoById = new Map(c.installments.map((inst, i) => [inst.legacyId, i + 1]));
  if (kind === 'ACTIVE' && close !== null) {
    warnings.push(
      `BLOCK: สัญญา ${c.code}: สัญญาผ่อนอยู่แต่มีรายการปิดบัญชีก่อนกำหนดในระบบเก่า — ยอดจ่ายของงวดใช้ใบรับเงินอย่างเดียว ยอดค้างอาจไม่เท่า PEAK`,
    );
  }

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

  /** แถวงวด + ข้อเตือนของงวดนั้น (ใช้เฉพาะเมื่องวดถูกนำเข้า) */
  const toPayment = (
    inst: LegacyInstallment,
    index: number,
  ): { payment: PaymentDraft; issues: string[] } => {
    const where = `สัญญา ${c.code} งวด ${inst.legacyCode}`;
    const issues: string[] = [];
    const receipts = receiptsByInstallment.get(inst.legacyId) ?? [];
    const amountDue = dRound(inst.amount);
    const legacyPaid = dRound(inst.paid);
    const fromReceipts = sum(receipts.map((r) => dRound(r.installment)));

    let amountPaid: Decimal;
    let unbacked = false; // ยอดจ่ายส่วนที่ไม่มีใบรับเงินหนุน
    if (close !== null) {
      amountPaid = fromReceipts;
      if (fromReceipts.gt(legacyPaid)) {
        issues.push(`${where}: ยอดใบรับเงินค่างวดมากกว่ายอดจ่ายของงวดในระบบเก่า — ใช้ยอดใบรับเงิน`);
      }
    } else {
      amountPaid = Prisma.Decimal.max(fromReceipts, legacyPaid);
      unbacked = legacyPaid.gt(fromReceipts);
      if (receipts.length === 0 && unbacked) {
        issues.push(`${where}: มียอดจ่ายในระบบเก่าแต่ไม่มีใบรับเงิน — ใช้ยอดจ่ายของงวด`);
      } else if (unbacked) {
        issues.push(
          `${where}: ยอดจ่ายของงวด (ins_paid หรือที่ปรับตาม PEAK) มากกว่าใบรับเงิน — ใช้ยอดจ่ายของงวด`,
        );
      } else if (fromReceipts.gt(legacyPaid)) {
        issues.push(`${where}: ยอดใบรับเงินมากกว่ายอดจ่ายของงวด (ins_paid) — ใช้ยอดใบรับเงิน`);
      }
    }
    if (!amountDue.gt(0)) {
      issues.push(`${where}: ค่างวดในระบบเก่าไม่เป็นบวก`);
    } else if (amountPaid.gt(amountDue)) {
      issues.push(`${where}: ยอดจ่ายเกินค่างวด`);
    }

    let status = statusOf(amountDue, amountPaid, inst.dueDate, cutoff);
    let paidDate =
      status === 'PAID' ? latestDate(receipts.filter((r) => dRound(r.installment).gt(0))) : null;
    const closedByPayoff =
      kind === 'HISTORY' && close !== null && amountPaid.gt(0) && amountPaid.lt(amountDue);
    if (closedByPayoff) {
      status = 'PAID';
      paidDate = close.createdAt;
    }

    const lateFeePaid = sum(receipts.map((r) => dRound(r.mulct)));
    const discount = sum(receipts.map((r) => dRound(r.discount)));
    const notes = [`${NOTE_PREFIX} · งวด ${inst.legacyCode}`];
    if (receipts.length > 0)
      notes.push(`ใบรับเงินเดิม ${receipts.map((r) => r.legacyId).join(', ')}`);
    if (unbacked) notes.push(UNBACKED_NOTE);
    if (lateFeePaid.gt(0)) notes.push(`ค่าปรับที่เก็บแล้วในระบบเก่า ${formatMoney(lateFeePaid)}`);
    if (discount.gt(0)) notes.push(`ส่วนลด ${formatMoney(discount)}`);
    if (closedByPayoff) notes.push(PAYOFF_NOTE);

    return {
      payment: {
        installmentNo: index + 1,
        dueDate: inst.dueDate,
        amountDue,
        amountPaid,
        status,
        paidDate,
        lateFee: ZERO,
        lateFeePaid,
        notes: notes.join(' · '),
        legacyInstallmentCode: inst.legacyCode,
      },
      issues,
    };
  };

  const payments: PaymentDraft[] = [];
  c.installments.forEach((inst, i) => {
    const { payment, issues } = toPayment(inst, i);
    if (kind === 'HISTORY' && !payment.amountPaid.gt(0)) {
      // ไม่นำเข้า (สเปก 5.7) — ไม่เตือนเรื่องยอดของงวด · สลิปของงวดนี้ (ถ้ามี) แนบระดับสัญญา
      const receipts = receiptsByInstallment.get(inst.legacyId);
      if (receipts) {
        warnings.push(
          `สัญญา ${c.code}: ใบรับเงิน ${receipts.map((r) => r.legacyId).join(', ')} ของงวด ${inst.legacyCode} ไม่มียอดค่างวด — งวดนี้ไม่นำเข้า (สเปก 5.7) สลิปแนบระดับสัญญา ค่าปรับของใบเหล่านี้ไม่ถูกนำเข้า`,
        );
      }
      return;
    }
    payments.push(payment);
    warnings.push(...issues);
  });
  const imported = new Set(payments.map((p) => p.installmentNo));

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
      amount: dRound(r.amount),
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
