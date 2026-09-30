import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { computeInstallmentBreakdown } from '../../journal/compute-installment-breakdown';
import { INSTALLMENT_MONEY_RECEIPT_TYPES } from '../receipt-types.constants';

type Money = Prisma.Decimal;
type DecimalLike = { toString(): string } | number | string | null | undefined;

/**
 * ข้อมูลของใบที่ใช้คำนวณตัวเลขบนเอกสาร — รูปเดียวกับผลของ ReceiptQueryService.getReceipt (แถว Receipt +
 * ค่าปรับของใบจากรายการบัญชี + ประวัติการจัดสรร + แถว Payment + เงื่อนไขสัญญา)
 */
export interface ReceiptMoneyView {
  receiptType?: string | null;
  amount: DecimalLike;
  amountBeforeVat?: DecimalLike;
  vatAmount?: DecimalLike;
  installmentNo?: number | null;
  lateFeeCollected?: string | null;
  lateFeeWaivedThisReceipt?: string | null;
  hasReceiptFeeHistory?: boolean;
  priorReceiptCount?: number | null;
  payment?: {
    lateFee: DecimalLike;
    waivedAmount?: DecimalLike;
    lateFeeWaived?: boolean | null;
  } | null;
  installmentAllocations?: Array<{
    installmentNo: number;
    amount: string;
    kind: 'INSTALLMENT' | 'RESCHEDULE_ADVANCE';
  }> | null;
  receiptAdvanceAmount?: string | null;
  contract?: {
    financedAmount?: DecimalLike;
    storeCommission?: DecimalLike;
    interestTotal?: DecimalLike;
    vatAmount?: DecimalLike;
    totalMonths?: number | null;
  } | null;
}

/** แถวเงินรับล่วงหน้าบนเอกสาร — DEDUCTION = หักเงินรับล่วงหน้าเข้างวด (ยอดติดลบ) */
export interface DocumentAdvanceRow {
  kind: 'RESCHEDULE' | 'GENERIC' | 'DEDUCTION';
  /** งวดเป้าหมายของเงินพักค่าปรับดิว (kind RESCHEDULE) */
  installmentNo?: number;
  amount: Money;
  vat: Money;
  beforeVat: Money;
}

/** ตัวเลขทุกแถวและทุกบรรทัดสรุปของเอกสารใบเสร็จ / ใบกำกับภาษี / ใบลดหนี้ */
export interface ReceiptDocumentMoney {
  vatBearing: boolean;
  installmentPortion: Money;
  installmentExclVat: Money;
  installmentVat: Money;
  advanceRows: DocumentAdvanceRow[];
  /** Σ แถวเงินรับล่วงหน้า (ติดลบได้เมื่อหักเงินรับล่วงหน้า) */
  advancePortion: Money;
  /** แถวค่าปรับ (ก่อนอนุโลม) */
  feeCharged: Money;
  /** แถวส่วนลด/อนุโลมค่าปรับ */
  feeWaived: Money;
  /** ค่าปรับสุทธิในสรุปยอด */
  feePortion: Money;
  /** ปัดเศษนอกฐานภาษี (0 = ไม่มีแถว) */
  rounding: Money;
  /** สรุป: มูลค่าก่อนภาษี / ภาษีมูลค่าเพิ่ม */
  exclVat: Money;
  vatPart: Money;
  /** ใบที่มีแต่เงินรับล่วงหน้า (ใบปรับดิว) — ส่วนหัวแสดง "งวดที่รับล่วงหน้า" */
  advanceOnly: boolean;
  displayedInstallmentNo: number | null | undefined;
}

const toDec = (v: unknown): Money => new Prisma.Decimal((v ?? 0).toString());
const ZERO = new Prisma.Decimal(0);

/**
 * ตรรกะเดิมของ PDF (ก่อน PR3) — ใช้กับใบที่ไม่มีค่าที่เก็บ ณ ตอนออกใบ (ใบที่ออกก่อน PR3 · ใบปรับดิว · ใบลดหนี้
 * อัตโนมัติ): ค่าปรับจากรายการบัญชีของใบ · VAT = ตัวเลขของบัญชีเมื่อยอดเท่าค่างวดพอดี ไม่เช่นนั้น ×100/107 ·
 * ใบลดหนี้อัตโนมัติที่เก็บ amountBeforeVat/vatAmount ใช้ค่าที่เก็บ. ย้ายมาจาก receipt-pdf.service.ts ทุกตัวอักษร
 * (ยกเว้นชื่อตัวแปร receipt → view) — ห้ามแก้สูตรในฟังก์ชันนี้ (ใบเก่าต้องพิมพ์ซ้ำได้เหมือนเดิม)
 */
export function legacyReceiptDocumentMoney(view: ReceiptMoneyView): ReceiptDocumentMoney {
  const total = toDec(view.amount);
  const isInstallmentReceipt = (INSTALLMENT_MONEY_RECEIPT_TYPES as readonly string[]).includes(
    view.receiptType ?? 'PAYMENT',
  );
  const documentBalanceApplies = isInstallmentReceipt || view.receiptType === 'RESCHEDULE_FEE';

  // ── CPA money breakdown (คู่มือบันทึกรับชำระ Policy A) ─────────────────
  // ค่างวดมี VAT 7% ฝังใน (Gross/งวด + VAT/งวด เช่น 1,416.66 + 99.17 =
  // 1,515.83) ส่วนค่าปรับล่าช้าไม่มี VAT (นโยบาย owner + ฐานภาษีตามกฎหมาย)
  // — ใบเสร็จจึงต้องแยกสองส่วนนี้คนละบรรทัด ห้ามรวมฐาน.
  const receiptType = view.receiptType ?? 'PAYMENT';
  // VAT-bearing documents: installment receipts + early payoff (JP4 settles
  // VAT) + credit notes (mirror of an installment receipt). Down payments
  // (SHOP — ไม่จด VAT) and reschedule fees (เงินรับล่วงหน้า + ค่าปรับ) carry no VAT.
  const vatBearing = !['DOWN_PAYMENT', 'RESCHEDULE_FEE'].includes(receiptType);

  // The exact receipt JE freezes its fee/waiver when later manual charges
  // change Payment.lateFee. Keep the old convention only for an entirely
  // unresolved legacy history; never assign its cumulative fee to a sibling
  // when another receipt already has an authoritative breakdown.
  const exactFee =
    (isInstallmentReceipt || receiptType === 'RESCHEDULE_FEE') &&
    view.lateFeeCollected != null &&
    view.lateFeeWaivedThisReceipt != null;
  const legacyFirst =
    isInstallmentReceipt && !view.hasReceiptFeeHistory && (view.priorReceiptCount ?? 0) === 0;
  const rawFee = exactFee
    ? toDec(view.lateFeeCollected).plus(toDec(view.lateFeeWaivedThisReceipt))
    : view.payment && legacyFirst
      ? toDec(view.payment.lateFee)
      : ZERO;
  const feeWaived = exactFee
    ? toDec(view.lateFeeWaivedThisReceipt)
    : view.payment && legacyFirst
      ? view.payment.waivedAmount != null
        ? toDec(view.payment.waivedAmount)
        : view.payment.lateFeeWaived
          ? rawFee
          : ZERO
      : ZERO;
  const feeCharged = Prisma.Decimal.max(rawFee, ZERO);
  const feeNet = Prisma.Decimal.max(feeCharged.minus(feeWaived), ZERO);
  if (isInstallmentReceipt && !exactFee && view.hasReceiptFeeHistory) {
    throw new BadRequestException(
      'ไม่สามารถระบุค่าปรับของใบเสร็จนี้จากรายการบัญชีได้ กรุณาตรวจสอบประวัติรับชำระก่อนพิมพ์',
    );
  }
  // Cash attributed to the fee cannot exceed what was actually received.
  const feePortion = Prisma.Decimal.min(feeNet, total);

  const allocations = view.installmentAllocations;
  const knownAdvance = view.receiptAdvanceAmount != null ? toDec(view.receiptAdvanceAmount) : null;
  if (documentBalanceApplies && allocations === null && knownAdvance == null) {
    throw new BadRequestException(
      'ไม่สามารถแยกค่างวดและเงินรับล่วงหน้าของใบเสร็จนี้จากประวัติได้ กรุณาตรวจสอบก่อนพิมพ์',
    );
  }
  const advanceAllocations =
    allocations?.filter((allocation) => allocation.kind === 'RESCHEDULE_ADVANCE') ?? [];
  const advancePortion = allocations
    ? advanceAllocations.reduce((sum, allocation) => sum.plus(allocation.amount), ZERO)
    : (knownAdvance ?? ZERO);
  const genericAdvance = !allocations && advancePortion.gt(0);
  if (advancePortion.lt(0) || advancePortion.plus(feePortion).gt(total)) {
    throw new BadRequestException('ยอดจัดสรรในใบเสร็จไม่ตรงกับเงินรับชำระ กรุณาตรวจสอบก่อนพิมพ์');
  }
  if (
    allocations &&
    !allocations
      .reduce((sum, allocation) => sum.plus(allocation.amount), ZERO)
      .plus(feePortion)
      .eq(total)
  ) {
    throw new BadRequestException('ยอดจัดสรรในใบเสร็จไม่ตรงกับเงินรับชำระ กรุณาตรวจสอบก่อนพิมพ์');
  }
  // Split the description without changing this document type's existing VAT
  // treatment. Changing advance tax timing requires its own end-to-end policy.
  const installmentPortion = total.minus(feePortion).minus(advancePortion);
  const documentVatPortion = total.minus(feePortion);
  const breakdown =
    view.contract?.financedAmount != null && view.contract?.totalMonths
      ? computeInstallmentBreakdown({
          financedAmount: view.contract.financedAmount.toString(),
          storeCommission:
            view.contract.storeCommission != null ? view.contract.storeCommission.toString() : null,
          interestTotal: (view.contract.interestTotal ?? 0).toString(),
          vatAmount: view.contract.vatAmount != null ? view.contract.vatAmount.toString() : null,
          totalMonths: view.contract.totalMonths,
          installmentNo: view.installmentNo ?? undefined,
        })
      : null;
  // Phase 3 standalone CN (CreditNoteDocumentService): amountBeforeVat/vatAmount
  // are stamped directly on the Receipt row from computeCnBreakdown's
  // pro-rated, per-installment-rounded totals (CPA ruling 2026-07-26,
  // docs/superpowers/plans/2026-07-26-cn-prorate-cpa.md) — i.e. the EXACT
  // figures the source JE booked (cross-checked against the JE's
  // metadata.creditNoteVatAmount at issuance time). This is NOT a simple
  // count × per-installment figure — a partially-paid accrued installment
  // prices at less than the full vatPerInst/installmentExclVat, per
  // installment, rounded before summing. Re-deriving via the pro-rata 100/107
  // split below would drift by a satang vs the ledger even in the
  // all-full-installment case (e.g. the golden fixture 4,249.98/297.51 → a
  // pro-rata split of the 4,547.49 total yields 4,249.99/297.50 — off by 0.01
  // either side); a mixed pro-rated case would drift further since the split
  // ignores per-installment rounding entirely.
  const hasExplicitVatSplit = view.amountBeforeVat != null && view.vatAmount != null;

  let exclVat = ZERO;
  let vatPart = ZERO;
  if (vatBearing && documentVatPortion.gt(0)) {
    if (hasExplicitVatSplit) {
      exclVat = toDec(view.amountBeforeVat);
      vatPart = toDec(view.vatAmount);
    } else if (breakdown && documentVatPortion.equals(breakdown.installmentTotal)) {
      // Full standard installment → exact ledger figures (per CPA manual).
      exclVat = breakdown.installmentExclVat;
      vatPart = breakdown.vatPerInst;
    } else {
      // Partial / payoff / residual final installment → pro-rata 7% split.
      exclVat = documentVatPortion.times(100).div(107).toDecimalPlaces(2);
      vatPart = documentVatPortion.minus(exclVat);
    }
  } else if (documentVatPortion.gt(0)) {
    exclVat = documentVatPortion; // non-VAT document — full value, no VAT column
  }

  // Allocate the existing document VAT between the displayed rows. Assign
  // rounding residue to the final advance row so the table matches the totals.
  const installmentVat = advancePortion.isZero()
    ? vatPart
    : vatBearing
      ? installmentPortion.minus(installmentPortion.times(100).div(107).toDecimalPlaces(2))
      : ZERO;
  const installmentExclVat = advancePortion.isZero()
    ? exclVat
    : installmentPortion.minus(installmentVat);
  const advanceVat = vatPart.minus(installmentVat);
  let allocatedAdvanceVat = ZERO;
  const advanceRows: DocumentAdvanceRow[] = advanceAllocations.map((allocation, index) => {
    const amount = toDec(allocation.amount);
    const rowVat =
      index === advanceAllocations.length - 1
        ? advanceVat.minus(allocatedAdvanceVat)
        : advanceVat.times(amount).div(advancePortion).toDecimalPlaces(2);
    allocatedAdvanceVat = allocatedAdvanceVat.plus(rowVat);
    return {
      kind: 'RESCHEDULE' as const,
      installmentNo: allocation.installmentNo,
      amount,
      vat: rowVat,
      beforeVat: amount.minus(rowVat),
    };
  });
  if (genericAdvance) {
    advanceRows.push({
      kind: 'GENERIC',
      amount: advancePortion,
      vat: advanceVat,
      beforeVat: advancePortion.minus(advanceVat),
    });
  }

  const advanceOnly = advancePortion.gt(0) && installmentPortion.isZero();
  return {
    vatBearing,
    installmentPortion,
    installmentExclVat,
    installmentVat,
    advanceRows,
    advancePortion,
    feeCharged,
    feeWaived,
    feePortion,
    rounding: ZERO,
    exclVat,
    vatPart,
    advanceOnly,
    displayedInstallmentNo: advanceOnly ? advanceAllocations[0]?.installmentNo : view.installmentNo,
  };
}
