// Single source of truth for the PO money breakdown shown in the create wizard.
// Mirrors apps/api/src/modules/purchase-orders/services/po-lifecycle.service.ts
// create() EXACTLY: subtotal -> minus discount -> VAT = subtotalAfterDiscount *
// vatRate ROUND_HALF_UP (only when supplier.hasVat) -> minus discountAfterVat = net.
// Backend uses Prisma.Decimal + ROUND_HALF_UP; on the client Math.round(x*100)/100
// is HALF_UP at the satang place, matching usePOForm's prior inline math.

export const VAT_RATE = 0.07;

export interface PoTotalsInput {
  items: { quantity: string; unitPrice: string }[];
  discount: string;
  discountAfterVat: string;
  supplierHasVat: boolean;
}

export interface PoTotals {
  subtotal: number;
  discountNum: number;
  subtotalAfterDiscount: number;
  vatAmount: number;
  totalWithVat: number;
  discountAfterVatNum: number;
  netAmount: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computePoTotals({
  items,
  discount,
  discountAfterVat,
  supplierHasVat,
}: PoTotalsInput): PoTotals {
  const subtotal = items.reduce(
    (sum, i) => sum + Number(i.quantity || 0) * Number(i.unitPrice || 0),
    0,
  );
  const discountNum = Math.min(Number(discount) || 0, subtotal);
  const subtotalAfterDiscount = subtotal - discountNum;
  const vatAmount = supplierHasVat ? round2(subtotalAfterDiscount * VAT_RATE) : 0;
  const totalWithVat = subtotalAfterDiscount + vatAmount;
  const discountAfterVatNum = supplierHasVat
    ? Math.min(Number(discountAfterVat) || 0, totalWithVat)
    : 0;
  const netAmount = totalWithVat - discountAfterVatNum;
  return {
    subtotal,
    discountNum,
    subtotalAfterDiscount,
    vatAmount,
    totalWithVat,
    discountAfterVatNum,
    netAmount,
  };
}
