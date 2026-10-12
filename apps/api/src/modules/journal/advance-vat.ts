import { Prisma, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

/**
 * ภาษีขายของเงินรับล่วงหน้า ณ วันรับเงิน (PR4 — คำตอบฝ่ายบัญชี เล่ม 1 ข้อ 1–3, 29/09/2569 · แผน
 * docs/superpowers/plans/2026-10-11-acct-review-pr4-advance-vat.md).
 *
 * กติกาเดียว (แบบ X — ยอด 21-1103 / 21-5101 คงเต็มจำนวน):
 *   เงินเข้าถัง (`Cr 21-1103` / `Cr 21-5101`)  = พักภาษี  `Dr 21-2102 / Cr 21-2101` = HALF_UP(ยอด × 7/107)
 *   เงินออกจากถัง (`Dr 21-1103` / `Dr 21-5101`) = ขากลับ   `Dr 21-2101 / Cr 21-2102` = ภาษีของยอดที่ออก
 *       เพดานด้วย "ภาษีที่รับรู้แล้วและยังค้าง" ของสัญญา · รายการที่ทำให้ถังของสัญญาเป็น 0 ใช้ภาษีที่ยังค้างทั้งก้อน
 *       (ใบสุดท้ายรับเศษ — ไม่งั้น 21-2102 ค้าง ±0.01 ถาวร: 500 → 32.71 แต่ 250 + 250 → 16.36 + 16.36)
 *
 * "ภาษีที่ยังค้าง" อ่านจากสมุดบัญชี: ทุกรายการที่มีขาภาษีของ PR4 ประทับ `metadata.advanceVatPark` /
 * `metadata.advanceVatConsume` (สตริง 2 ตำแหน่ง). กระจกทุกชนิดไม่ copy stamp และประทับ `reversed` บนต้นฉบับ ⇒
 * ผลรวมถูกต้องหลังกลับรายการ. ไม่เพิ่มคอลัมน์บนสัญญา.
 *
 * ขาภาษีเพิ่มใน **รายการเดิม** ของผู้เรียก (ใบรับชำระ · 6a · ลิงก์ชำระส่วนเกิน · overpayment-credit · รอบกลางคืน 2A ·
 * JP4 / JP5 / ตัดหนี้สูญ · รอบกวาดเงินพักส่วนเกิน) — ไฟล์นี้ไม่ลงรายการเอง. ห้ามมีสูตร 7/107 ที่สอง.
 */

export const ADVANCE_VAT_META = { park: 'advanceVatPark', consume: 'advanceVatConsume' } as const;

export const ADVANCE_VAT_PARK_DESCRIPTION = 'ภาษีขายของเงินรับล่วงหน้า (รับรู้ ณ วันรับ)';
export const ADVANCE_VAT_CONSUME_DESCRIPTION =
  'ภาษีขายของเงินรับล่วงหน้าที่หักเข้างวด (รับรู้แล้วตอนรับ)';

const ZERO = new Decimal(0);

/** ภาษีของเงินที่รับไว้ล่วงหน้า / ที่หักเข้างวด = HALF_UP(|ยอด| × 7/107) เครื่องหมายเดียวกับยอด */
export function advanceVatOf(amount: Decimal): Decimal {
  const share = amount.abs().times(7).div(107).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return amount.isNegative() ? share.negated() : share;
}

/** รูปเดียวกับ `ReceiptLine` ของ build-receipt-lines.ts — ผู้เรียก push ต่อท้ายบรรทัดของตัวเองได้ตรง ๆ */
export interface AdvanceVatLine {
  accountCode: string;
  dr: Decimal;
  cr: Decimal;
  description: string;
}

/** ขาพัก `Dr 21-2102 / Cr 21-2101` — ยอด ≤ 0 = ไม่มีบรรทัด */
export function buildAdvanceVatParkLines(vat: Decimal): AdvanceVatLine[] {
  if (!vat.gt(0)) return [];
  return [
    { accountCode: '21-2102', dr: vat, cr: ZERO, description: ADVANCE_VAT_PARK_DESCRIPTION },
    { accountCode: '21-2101', dr: ZERO, cr: vat, description: ADVANCE_VAT_PARK_DESCRIPTION },
  ];
}

/** ขากลับ `Dr 21-2101 / Cr 21-2102` — ยอด ≤ 0 = ไม่มีบรรทัด */
export function buildAdvanceVatConsumeLines(vat: Decimal): AdvanceVatLine[] {
  if (!vat.gt(0)) return [];
  return [
    { accountCode: '21-2101', dr: vat, cr: ZERO, description: ADVANCE_VAT_CONSUME_DESCRIPTION },
    { accountCode: '21-2102', dr: ZERO, cr: vat, description: ADVANCE_VAT_CONSUME_DESCRIPTION },
  ];
}

type Client = Prisma.TransactionClient | PrismaClient;

const stampOf = (meta: Record<string, unknown>, key: string): Decimal => {
  const raw = meta[key];
  if (typeof raw !== 'string' && typeof raw !== 'number') return ZERO;
  const d = new Decimal(raw);
  return d.isFinite() ? d : ZERO;
};

/**
 * ภาษีที่รับรู้ตอนพักแล้วและยังไม่ถูกกลับ ของสัญญา = max(0, Σ park − Σ consume) จากรายการ `POSTED` ที่ไม่ถูกลบ
 * ที่ `metadata.contractId` = สัญญา และ `metadata.reversed !== true`. อ่านบน client เดียวกับรายการที่กำลังลง
 * (ใน tx) เพื่อเห็นขาที่ลงไปก่อนหน้าในธุรกรรมเดียวกัน.
 */
export async function advanceVatOutstanding(client: Client, contractId: string): Promise<Decimal> {
  const rows = await client.journalEntry.findMany({
    where: {
      status: 'POSTED',
      deletedAt: null,
      metadata: { path: ['contractId'], equals: contractId },
    },
    select: { metadata: true },
  });
  let park = ZERO;
  let consume = ZERO;
  for (const row of rows) {
    const meta = row.metadata;
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) continue;
    const m = meta as Record<string, unknown>;
    if (m.reversed === true) continue;
    park = park.plus(stampOf(m, ADVANCE_VAT_META.park));
    consume = consume.plus(stampOf(m, ADVANCE_VAT_META.consume));
  }
  return Decimal.max(ZERO, park.minus(consume));
}

/**
 * ยอดภาษีของขากลับ (ต4) — ฟังก์ชันบริสุทธิ์:
 *   emptiesBucket (รายการนี้ทำให้ 21-1103 + 21-5101 ของสัญญาเป็น 0) ⇒ ภาษีที่ยังค้างทั้งก้อน
 *   ไม่งั้น ⇒ max(0, min(HALF_UP(ยอดที่ออก × 7/107), ยังค้าง))
 * ยอดที่ออก ≤ 0 = 0 เสมอ (ไม่ใช่รายการที่หัก).
 */
export function consumeVatFor(
  outstanding: Decimal,
  releaseAmount: Decimal,
  emptiesBucket: boolean,
): Decimal {
  if (!releaseAmount.gt(0)) return ZERO;
  const cap = Decimal.max(ZERO, outstanding);
  if (emptiesBucket) return cap;
  return Decimal.max(ZERO, Decimal.min(advanceVatOf(releaseAmount), cap));
}

/** `consumeVatFor` ที่อ่าน "ยังค้าง" จากสมุดบัญชีให้ */
export async function resolveConsumeVat(
  client: Client,
  contractId: string,
  releaseAmount: Decimal,
  emptiesBucket: boolean,
): Promise<Decimal> {
  const outstanding = await advanceVatOutstanding(client, contractId);
  return consumeVatFor(outstanding, releaseAmount, emptiesBucket);
}
