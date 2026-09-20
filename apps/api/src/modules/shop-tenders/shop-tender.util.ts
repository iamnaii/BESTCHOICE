import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * กติกากลางของ "ช่องรับเงิน" หน้าร้าน (สเปค 2026-09-20-shop-tenders-daily-cash) — ที่เดียวสำหรับทุกจุดที่รับเงิน:
 * ขายเงินสด · เงินดาวน์ไฟแนนซ์นอก · เงินดาวน์สัญญาผ่อน · มัดจำใบจอง · ส่วนที่เหลือของใบจอง.
 * เจ้าของเคาะ 2026-09-20: โอน/QR บังคับเลขอ้างอิง · บิลเดียวจ่ายผสมได้ (สูงสุด 4 บรรทัด).
 */
export const TENDER_METHODS = ['CASH', 'BANK_TRANSFER', 'QR_EWALLET'] as const;
export type TenderMethod = (typeof TENDER_METHODS)[number];

export const MAX_TENDERS = 4;
export const MIN_REFERENCE_LENGTH = 6;
export const MAX_REFERENCE_LENGTH = 128;

export interface TenderInput {
  method: string;
  amount: number | string;
  reference?: string | null;
}

export interface NormalizedTender {
  method: TenderMethod;
  amount: Prisma.Decimal;
  /** null เสมอเมื่อเป็นเงินสด */
  reference: string | null;
  seq: number;
  seqTotal: number;
}

/** ฟิลด์วิธีรับเงินแบบเดิม (วิธีเดียวต่อเอกสาร) — ใช้เมื่อ caller ไม่ได้ส่ง `tenders` */
export interface LegacyTenderFields {
  method?: string | null;
  reference?: string | null;
}

const money = (d: Prisma.Decimal) => d.toNumber().toLocaleString('th-TH', { maximumFractionDigits: 2 });

function isTenderMethod(method: string): method is TenderMethod {
  return (TENDER_METHODS as readonly string[]).includes(method);
}

/**
 * ตรวจและจัดรูปรายการรับเงินของบิลเดียว. `due` = ยอดเงินจริงที่ต้องรับ (ไม่นับเครดิตเครื่องเทิร์น / มัดจำที่รับไปแล้ว).
 * ไม่ส่ง `input` = caller แบบเดิม → สร้างบรรทัดเดียวจาก `legacy` แล้วผ่านกติกาเดียวกัน (โอน/QR ไม่มีเลขอ้างอิงถูกปฏิเสธ).
 */
export function normalizeTenders(
  input: TenderInput[] | null | undefined,
  due: Prisma.Decimal.Value,
  legacy: LegacyTenderFields = {},
): NormalizedTender[] {
  const dueAmount = new Prisma.Decimal(due);
  const rows = input?.length ? input : null;

  if (dueAmount.lte(0)) {
    if (rows) throw new BadRequestException('รายการนี้ไม่มียอดที่ต้องรับ จึงไม่ต้องระบุวิธีรับเงิน');
    return [];
  }

  // Omitted method is a compatibility default only for a NEW receipt (เดิมอยู่ใน contractDownTender).
  const source: TenderInput[] = rows ?? [{ method: legacy.method ?? 'CASH', amount: dueAmount.toString(), reference: legacy.reference }];
  if (source.length > MAX_TENDERS) {
    throw new BadRequestException(`หนึ่งบิลรับเงินได้สูงสุด ${MAX_TENDERS} วิธี`);
  }

  let total = new Prisma.Decimal(0);
  const normalized = source.map((row, index): NormalizedTender => {
    const label = source.length > 1 ? `วิธีที่ ${index + 1}: ` : '';
    if (!isTenderMethod(row.method)) {
      throw new BadRequestException(`${label}วิธีรับเงินไม่ถูกต้อง เลือกได้เฉพาะเงินสด โอนธนาคาร หรือ QR / e-Wallet`);
    }
    let amount: Prisma.Decimal;
    try {
      amount = new Prisma.Decimal(row.amount);
    } catch {
      throw new BadRequestException(`${label}จำนวนเงินไม่ถูกต้อง`);
    }
    if (!amount.isFinite() || amount.lte(0)) throw new BadRequestException(`${label}จำนวนเงินต้องมากกว่า 0`);
    if (amount.decimalPlaces() > 2) throw new BadRequestException(`${label}จำนวนเงินมีทศนิยมได้ไม่เกิน 2 ตำแหน่ง`);

    let reference: string | null = null;
    if (row.method !== 'CASH') {
      reference = row.reference?.trim() ?? '';
      if (reference.length < MIN_REFERENCE_LENGTH) {
        throw new BadRequestException(`${label}กรอกเลขอ้างอิงจากสลิปก่อนบันทึก (อย่างน้อย ${MIN_REFERENCE_LENGTH} ตัว)`);
      }
      if (reference.length > MAX_REFERENCE_LENGTH) {
        throw new BadRequestException(`${label}เลขอ้างอิงยาวได้ไม่เกิน ${MAX_REFERENCE_LENGTH} ตัว`);
      }
    }
    total = total.plus(amount);
    return { method: row.method, amount, reference, seq: index + 1, seqTotal: source.length };
  });

  if (!total.eq(dueAmount)) {
    const diff = dueAmount.minus(total);
    throw new BadRequestException(
      diff.gt(0)
        ? `ยอดรับเงินยังขาด ${money(diff)} บาท (รับ ${money(total)} จากที่ต้องรับ ${money(dueAmount)})`
        : `ยอดรับเงินเกิน ${money(diff.abs())} บาท (รับ ${money(total)} จากที่ต้องรับ ${money(dueAmount)})`,
    );
  }
  return normalized;
}

/** เลขอ้างอิงของบรรทัดแรกที่ไม่ใช่เงินสด — เก็บลงคอลัมน์เดิม `Contract.downPaymentReference` */
export function firstTransferReference(tenders: NormalizedTender[]): string | null {
  return tenders.find((t) => t.method !== 'CASH')?.reference ?? null;
}
