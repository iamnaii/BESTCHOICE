import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { d, dAdd, dSub, dSum } from '../../../utils/decimal.util';

/**
 * Money math + payment terms shared by PoLifecycleService.create() and
 * PoReceivingService.directReceive() — one rule set, so an auto-PO from รับเข้าตรง
 * books the same VAT / discounts / due date / bank snapshot as a normal PO.
 */

export interface PoAmountLine {
  quantity: number;
  unitPrice: number | string | Prisma.Decimal;
}

export interface PoAmounts {
  totalAmount: Prisma.Decimal;
  discount: Prisma.Decimal;
  discountAfterVat: Prisma.Decimal;
  vatAmount: Prisma.Decimal;
  netAmount: Prisma.Decimal;
}

/**
 * subtotal → − discount (ก่อน VAT) → + VAT (VAT suppliers only, ROUND_HALF_UP at the
 * satang) → − discountAfterVat (VAT suppliers only). Prisma.Decimal end-to-end: VAT =
 * subtotal × rate can land on a half-satang that float math drops.
 */
export function computePoAmounts(
  items: PoAmountLine[],
  opts: { supplierHasVat: boolean; vatRate: number; discount?: number; discountAfterVat?: number },
): PoAmounts {
  const totalAmount = dSum(items.map((item) => d(item.quantity).mul(item.unitPrice)));
  const discount = d(opts.discount || 0);
  const discountAfterVat = opts.supplierHasVat ? d(opts.discountAfterVat || 0) : d(0);
  const subtotalAfterDiscount = dSub(totalAmount, discount);
  const vatAmount = opts.supplierHasVat
    ? subtotalAfterDiscount.mul(opts.vatRate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
    : d(0);
  const netAmount = dSub(dAdd(subtotalAfterDiscount, vatAmount), discountAfterVat);
  return { totalAmount, discount, discountAfterVat, vatAmount, netAmount };
}

/**
 * ยอดสุทธิติดลบ = ส่วนลดรวมมากกว่ามูลค่าสินค้า — ต้นทุนต่อเครื่องคิดจากยอดสุทธิ (po-unit-cost.util)
 * จึงคำนวณไม่ได้ และยอดของใบสั่งซื้อแก้ไม่ได้หลังสร้าง ⇒ ปฏิเสธตั้งแต่ตอนสร้าง ทั้ง create() และ
 * directReceive(). ยอดสุทธิ 0 (ส่วนลดเต็มมูลค่า / ของแถมทั้งใบ) ยังผ่าน
 */
export function assertPoNetNotNegative(amounts: PoAmounts): void {
  if (amounts.netAmount.lt(0)) {
    throw new BadRequestException(
      `ส่วนลดรวม ${dAdd(amounts.discount, amounts.discountAfterVat).toFixed(2)} บาท มากกว่ามูลค่าสินค้า ` +
        `(ยอดสุทธิติดลบ ${amounts.netAmount.toFixed(2)} บาท) กรุณาแก้ส่วนลดให้ไม่เกินมูลค่าสินค้า`,
    );
  }
}

/** Prisma `select` for the supplier fields the terms resolver needs (default method first). */
export const SUPPLIER_TERMS_SELECT = {
  deletedAt: true,
  hasVat: true,
  paymentMethods: {
    where: { deletedAt: null },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    select: {
      paymentMethod: true,
      creditTermDays: true,
      isDefault: true,
      bankName: true,
      bankAccountNumber: true,
    },
  },
} satisfies Prisma.SupplierSelect;

export interface SupplierTerms {
  hasVat?: boolean | null;
  paymentMethods?: {
    paymentMethod: string;
    creditTermDays?: number | null;
    isDefault: boolean;
    bankName?: string | null;
    bankAccountNumber?: string | null;
  }[] | null;
}

/**
 * Due date from the chosen (or default) payment method's credit term, plus a snapshot
 * of that method's bank account so later supplier edits cannot re-target this PO.
 */
export function resolvePaymentTerms(
  supplier: SupplierTerms,
  requestedMethod: string | undefined,
  orderDate: Date,
): { dueDate: Date | null; bankAccountSnapshot: string | null; bankNameSnapshot: string | null } {
  const methods = supplier.paymentMethods ?? [];
  const selectedPm = requestedMethod
    ? methods.find((pm) => pm.paymentMethod === requestedMethod)
    : methods.find((pm) => pm.isDefault) || methods[0];
  let dueDate: Date | null = null;
  if (selectedPm?.creditTermDays) {
    dueDate = new Date(orderDate);
    dueDate.setDate(dueDate.getDate() + selectedPm.creditTermDays);
  }
  return {
    dueDate,
    bankAccountSnapshot: selectedPm?.bankAccountNumber ?? null,
    bankNameSnapshot: selectedPm?.bankName ?? null,
  };
}
