import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { bangkokMidnight } from '../../utils/date.util';

/**
 * ภาษีขายของแบบ ภ.พ.30 — การคำนวณเดียวของระบบ (2026-09-30)
 *
 * ผู้ใช้ตัวเลขนี้ทุกตัวเรียกฟังก์ชันในไฟล์นี้ ห้ามมี query ภาษีขายชุดที่สอง:
 *   - `TaxPreviewService.previewPP30` → `GET /tax/pp30-preview` · `GET /tax/export-xlsx?form=PP30` ·
 *     `POST /tax/generate` (TaxReport) · snapshot ปิดงวดรายเดือน (`MonthlyCloseService.generateReportSnapshots`)
 *   - `FinanceTaxService.getVatMonthly` → หน้า `/finance/vat` (เมนู "VAT (ภ.พ.30)")
 *
 * กติกา:
 *   - ภาษีขาย = Σ(เครดิต − เดบิต) ของ 21-2101 — ทศนิยมด้วย Prisma.Decimal เท่านั้น
 *   - ภาษีขาย 60 วัน (21-2103) = Σ(เครดิต − เดบิต) แสดงแยกเป็นข้อมูลประกอบ **ไม่รวมในยอด** จนกว่าฝ่ายบัญชีจะตอบ
 *     (`PP30_INCLUDES_MANDATORY_60DAY`)
 *   - รายการ: สถานะ POSTED · รายการและบรรทัดไม่ถูกลบ · `companyId` ที่ผู้เรียกส่ง
 *   - เดือน: `entryDate` (วันที่ของรายการ) ภายในเดือนตามปฏิทินไทย [วันที่ 1 00:00 น., วันที่ 1 ของเดือนถัดไป 00:00 น.)
 *     ไม่ขึ้นกับเขตเวลาของโปรเซส — รายการกลับรายการ/ใบลดหนี้ลดภาษีขายของเดือนที่ลงรายการ ไม่แก้เดือนเดิม
 *   - เดบิตของ 21-2101 แยกที่มา (ดู `classifyOutputVatReduction`) · เดบิตที่ระบุที่มาไม่ได้อยู่ในกลุ่ม "อื่น ๆ" ไม่ถูกทิ้ง
 *   - ยอดติดลบได้ (เดือนที่มีแต่รายการกลับรายการ) — แสดงตามจริง ไม่ปัดเป็นศูนย์
 *   - ภาษีซื้อไม่อยู่ในไฟล์นี้ (ผู้เรียกแต่ละตัวคงกติกาภาษีซื้อเดิม)
 */

export const PP30_SETTLED_VAT_ACCOUNT = '21-2101';
export const PP30_MANDATORY_60DAY_VAT_ACCOUNT = '21-2103';

/**
 * รวมภาษีขาย 60 วัน (21-2103) ในยอดภาษีขายของ ภ.พ.30 หรือไม่ — คำตัดสินผู้คุมงาน 2026-09-30: **ไม่รวม จนกว่าฝ่ายบัญชีจะตอบ**
 * (กลับคำตัดสิน "Critical #2" เดิมที่รวม 21-2103). เหตุ: 2A ตั้งภาษีขายของทุกงวดเข้า 21-2101 ณ วันครบกำหนดแล้ว แต่รอบ 60 วัน
 * (`vat-60day.cron.ts`) ตั้ง 21-2103 ซ้ำโดยไม่ดูว่างวดตั้งลูกหนี้งวดแล้วหรือสัญญาปิดไปแล้ว. false = 21-2103 เป็นข้อมูลประกอบแยก
 * (ตั้ง / กลับ / สุทธิ) ไม่อยู่ใน `totalOutputVat` · เปลี่ยนค่าต้องแก้ข้อความ "ยังไม่รวม" บนหน้า /finance/vat และในไฟล์ Excel
 * ภ.พ.30 (`tax-export.service.ts`) พร้อมกัน
 */
export const PP30_INCLUDES_MANDATORY_60DAY = false; // รอฝ่ายบัญชีตอบ

/** ที่มาของเดบิต 21-2101 — REVERSAL = กลับรายการ · CREDIT_NOTE = ใบลดหนี้ ม.82/5 · OTHER = ระบุที่มาไม่ได้ */
export type Pp30ReductionKind = 'REVERSAL' | 'CREDIT_NOTE' | 'OTHER';

/** บรรทัดสมุดบัญชีที่ตัวคำนวณอ่าน — รูปเดียวกับที่ `loadPp30OutputVatLines` select */
export interface Pp30OutputVatLine {
  accountCode: string;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  journalEntry: {
    id: string;
    entryNumber: string;
    entryDate: Date;
    referenceType: string | null;
    description: string;
    metadata: Prisma.JsonValue | null;
  };
}

/** เดบิต 21-2101 หนึ่งบรรทัดที่ลดภาษีขายของเดือน พร้อมที่มา */
export interface Pp30ReductionLine {
  entryId: string;
  entryNumber: string;
  entryDate: Date;
  description: string;
  kind: Pp30ReductionKind;
  amount: Prisma.Decimal;
}

export interface Pp30OutputVatSummary {
  /** Σ เครดิต 21-2101 ของเดือน (ทุกบรรทัด ทุกที่มา) */
  settledGross: Prisma.Decimal;
  /** Σ เดบิต 21-2101 แยกที่มา — total = reversal + creditNote + other */
  reductions: {
    reversal: Prisma.Decimal;
    creditNote: Prisma.Decimal;
    other: Prisma.Decimal;
    total: Prisma.Decimal;
  };
  /** settledGross − reductions.total */
  settledNet: Prisma.Decimal;
  /** 21-2103 ภาษีขาย 60 วัน — net = credit − debit (ข้อมูลประกอบ — ดู `mandatory60DayIncluded`) */
  mandatory60Day: { credit: Prisma.Decimal; debit: Prisma.Decimal; net: Prisma.Decimal };
  /** `PP30_INCLUDES_MANDATORY_60DAY` — false = 21-2103 ไม่รวมใน `totalOutputVat` */
  mandatory60DayIncluded: boolean;
  /** ภาษีขายของแบบ ภ.พ.30 = settledNet (+ mandatory60Day.net เฉพาะเมื่อ `mandatory60DayIncluded`) */
  totalOutputVat: Prisma.Decimal;
  reductionLines: Pp30ReductionLine[];
}

export interface Pp30MonthRange {
  gte: Date;
  lt: Date;
}

export interface Pp30OutputVatResult extends Pp30OutputVatSummary {
  companyId: string;
  year: number;
  month: number;
  range: Pp30MonthRange;
  lines: Pp30OutputVatLine[];
}

/** รูป JSON ของสรุป (ยอดเป็นสตริงทศนิยม 2 ตำแหน่ง) — ส่งให้หน้าจอ/เก็บใน snapshot และ TaxReport */
export interface Pp30OutputVatJson {
  settledGross: string;
  reductionReversal: string;
  reductionCreditNote: string;
  reductionOther: string;
  reductionTotal: string;
  settledNet: string;
  mandatory60DayCredit: string;
  mandatory60DayDebit: string;
  mandatory60DayNet: string;
  /** false = ภาษีขาย 60 วันเป็นข้อมูลประกอบ ไม่รวมใน `totalOutputVat` (รอฝ่ายบัญชี) */
  mandatory60DayIncluded: boolean;
  totalOutputVat: string;
}

/** client ที่ตัวคำนวณต้องใช้ — PrismaService, PrismaClient และ transaction client ใช้ได้ทั้งหมด */
export type Pp30Client = Pick<Prisma.TransactionClient, 'journalLine' | 'companyInfo'>;

const ZERO = new Prisma.Decimal(0);

function dec(value: Prisma.Decimal | null | undefined): Prisma.Decimal {
  return value == null ? ZERO : new Prisma.Decimal(value);
}

function asObject(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * ที่มาของเดบิต 21-2101 หนึ่งบรรทัด (ตัดสินจากรายการที่บรรทัดนั้นอยู่):
 *   - `metadata.tag === 'REVERSAL'` — รายการกลับรายการแบบกระจกทุกชนิด (ยกเลิกใบเสร็จ/ตั้งลูกหนี้งวด · ยกเลิกสัญญา ·
 *     ยกเลิกเปลี่ยนเครื่อง · เปลี่ยนเครื่องตำหนิ · ยกเลิกจำหน่ายสินทรัพย์ · ยกเลิกรายการบัญชีด้วยมือที่รายการกลับมี metadata (งานแยกถัดไป))
 *   - `referenceType === 'REVERSAL'` — ยกเลิกรายการบัญชีด้วยมือที่รายการกลับไม่มี metadata (แบบเดิมของ `JournalService.void`)
 *   - เอกสารรายได้อื่นแบบกลับรายการ (`-R`): `metadata.source === 'OTHER_INCOME'` และ `otherIncomeId` ลงท้าย `:reversal`
 *   - ใบลดหนี้ ม.82/5: ยึดคืน (`tag 'JP5'` + `flow 'repossession'`) · ตัดหนี้สูญ (`tag 'BAD-DEBT'` + `flow 'write-off'`)
 *   - นอกนั้น = OTHER
 */
export function classifyOutputVatReduction(entry: {
  referenceType: string | null;
  metadata: Prisma.JsonValue | null;
}): Pp30ReductionKind {
  const meta = asObject(entry.metadata);
  if (meta.tag === 'REVERSAL') return 'REVERSAL';
  if (entry.referenceType === 'REVERSAL') return 'REVERSAL';
  if (
    meta.source === 'OTHER_INCOME' &&
    typeof meta.otherIncomeId === 'string' &&
    meta.otherIncomeId.endsWith(':reversal')
  ) {
    return 'REVERSAL';
  }
  if (
    (meta.tag === 'JP5' && meta.flow === 'repossession') ||
    (meta.tag === 'BAD-DEBT' && meta.flow === 'write-off')
  ) {
    return 'CREDIT_NOTE';
  }
  return 'OTHER';
}

/** สรุปภาษีขายจากบรรทัดของเดือน — รับเฉพาะ 21-2101 และ 21-2103 บรรทัดบัญชีอื่นถูกข้าม */
export function summarizePp30OutputVat(lines: Pp30OutputVatLine[]): Pp30OutputVatSummary {
  let settledGross = ZERO;
  let reversal = ZERO;
  let creditNote = ZERO;
  let other = ZERO;
  let m60Credit = ZERO;
  let m60Debit = ZERO;
  const reductionLines: Pp30ReductionLine[] = [];

  for (const line of lines) {
    const credit = dec(line.credit);
    const debit = dec(line.debit);
    if (line.accountCode === PP30_MANDATORY_60DAY_VAT_ACCOUNT) {
      m60Credit = m60Credit.plus(credit);
      m60Debit = m60Debit.plus(debit);
      continue;
    }
    if (line.accountCode !== PP30_SETTLED_VAT_ACCOUNT) continue;
    settledGross = settledGross.plus(credit);
    if (debit.isZero()) continue;
    const kind = classifyOutputVatReduction(line.journalEntry);
    if (kind === 'REVERSAL') reversal = reversal.plus(debit);
    else if (kind === 'CREDIT_NOTE') creditNote = creditNote.plus(debit);
    else other = other.plus(debit);
    reductionLines.push({
      entryId: line.journalEntry.id,
      entryNumber: line.journalEntry.entryNumber,
      entryDate: line.journalEntry.entryDate,
      description: line.journalEntry.description,
      kind,
      amount: debit,
    });
  }

  const total = reversal.plus(creditNote).plus(other);
  const settledNet = settledGross.minus(total);
  const m60Net = m60Credit.minus(m60Debit);
  return {
    settledGross,
    reductions: { reversal, creditNote, other, total },
    settledNet,
    mandatory60Day: { credit: m60Credit, debit: m60Debit, net: m60Net },
    mandatory60DayIncluded: PP30_INCLUDES_MANDATORY_60DAY,
    totalOutputVat: PP30_INCLUDES_MANDATORY_60DAY ? settledNet.plus(m60Net) : settledNet,
    reductionLines,
  };
}

export function toPp30OutputVatJson(summary: Pp30OutputVatSummary): Pp30OutputVatJson {
  return {
    settledGross: summary.settledGross.toFixed(2),
    reductionReversal: summary.reductions.reversal.toFixed(2),
    reductionCreditNote: summary.reductions.creditNote.toFixed(2),
    reductionOther: summary.reductions.other.toFixed(2),
    reductionTotal: summary.reductions.total.toFixed(2),
    settledNet: summary.settledNet.toFixed(2),
    mandatory60DayCredit: summary.mandatory60Day.credit.toFixed(2),
    mandatory60DayDebit: summary.mandatory60Day.debit.toFixed(2),
    mandatory60DayNet: summary.mandatory60Day.net.toFixed(2),
    mandatory60DayIncluded: summary.mandatory60DayIncluded,
    totalOutputVat: summary.totalOutputVat.toFixed(2),
  };
}

/** เดือนของ ภ.พ.30 ตามปฏิทินไทย — ตรวจปี/เดือนก่อนเสมอ (ค่าผิดรูป = 400 ภาษาไทย ไม่ใช่ 500) */
export function pp30MonthRange(year: number, month: number): Pp30MonthRange {
  if (
    !Number.isInteger(year) ||
    year < 2000 ||
    year > 2100 ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    throw new BadRequestException('ปี/เดือนไม่ถูกต้อง');
  }
  return { gte: bangkokMidnight(year, month - 1, 1), lt: bangkokMidnight(year, month, 1) };
}

/** บริษัทของภาษีขาย — ผู้เรียกไม่ส่ง (หน้า /finance/vat) = บริษัท FINANCE ซึ่งเป็นบริษัทเดียวที่จดภาษีมูลค่าเพิ่ม */
export async function resolvePp30CompanyId(
  client: Pp30Client,
  companyId?: string,
): Promise<string> {
  if (companyId) return companyId;
  const finance = await client.companyInfo.findFirst({
    where: { companyCode: 'FINANCE', deletedAt: null },
    select: { id: true },
  });
  if (!finance) {
    throw new BadRequestException(
      'ไม่พบข้อมูลบริษัทฝั่ง FINANCE (บริษัทที่จดภาษีมูลค่าเพิ่ม) — กรุณาติดต่อผู้ดูแลระบบ',
    );
  }
  return finance.id;
}

/** บรรทัด 21-2101 และ 21-2103 ของเดือน (สอง query แยกบัญชี — ไม่กรองเฉพาะเครดิต) */
export async function loadPp30OutputVatLines(
  client: Pp30Client,
  companyId: string,
  range: Pp30MonthRange,
): Promise<Pp30OutputVatLine[]> {
  const byAccount = (accountCode: string) =>
    client.journalLine.findMany({
      where: {
        accountCode,
        deletedAt: null,
        journalEntry: {
          deletedAt: null,
          status: 'POSTED',
          companyId,
          entryDate: { gte: range.gte, lt: range.lt },
        },
      },
      select: {
        accountCode: true,
        debit: true,
        credit: true,
        journalEntry: {
          select: {
            id: true,
            entryNumber: true,
            entryDate: true,
            referenceType: true,
            description: true,
            metadata: true,
          },
        },
      },
      orderBy: { journalEntry: { entryDate: 'asc' } },
    });
  const [settled, mandatory60Day] = await Promise.all([
    byAccount(PP30_SETTLED_VAT_ACCOUNT),
    byAccount(PP30_MANDATORY_60DAY_VAT_ACCOUNT),
  ]);
  return [...settled, ...mandatory60Day];
}

export async function computePp30OutputVat(
  client: Pp30Client,
  input: { companyId: string; year: number; month: number },
): Promise<Pp30OutputVatResult> {
  // companyId ว่าง = Prisma ไม่กรองบริษัท (รวมทุกบริษัท) — GET /tax/pp30-preview ส่งค่าจาก query string ตรง ๆ
  if (!input.companyId) throw new BadRequestException('กรุณาระบุบริษัท');
  const range = pp30MonthRange(input.year, input.month);
  const lines = await loadPp30OutputVatLines(client, input.companyId, range);
  return {
    companyId: input.companyId,
    year: input.year,
    month: input.month,
    range,
    lines,
    ...summarizePp30OutputVat(lines),
  };
}
