/**
 * Shared sequence number generation utilities
 * Eliminates duplication of number generation logic across services
 */

type PrismaTx = {
  contract: { findFirst: (...args: any[]) => Promise<any> };
  sale: { findFirst: (...args: any[]) => Promise<any> };
  purchaseOrder: { count: (...args: any[]) => Promise<number> };
};

/**
 * Generate next contract number (BCP2603-00001, BCP2603-00002, ...)
 * Format: BCP + YY + MM + '-' + 5-digit sequence (global)
 */
export async function generateContractNumber(tx: PrismaTx): Promise<string> {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const prefix = `BCP${yy}${mm}`;

  const lastContract = await tx.contract.findFirst({
    where: { contractNumber: { startsWith: prefix } },
    orderBy: { contractNumber: 'desc' as const },
    select: { contractNumber: true },
  });

  let nextSeq = 1;
  if (lastContract) {
    const parts = lastContract.contractNumber.split('-');
    const lastSeq = parts.length > 1 ? parseInt(parts[1]) || 0 : 0;
    nextSeq = lastSeq + 1;
  }

  return `${prefix}-${String(nextSeq).padStart(5, '0')}`;
}

/**
 * Generate next sale number (SL000001, SL000002, ...)
 */
export async function generateSaleNumber(tx: PrismaTx): Promise<string> {
  const lastSale = await tx.sale.findFirst({
    orderBy: { saleNumber: 'desc' as const },
    select: { saleNumber: true },
  });
  const lastNum = lastSale
    ? parseInt(lastSale.saleNumber.replace(/\D/g, '')) || 0
    : 0;
  return `SL${String(lastNum + 1).padStart(6, '0')}`;
}

/**
 * Generate next PO number (PO-2026-03-001, PO-2026-03-002, ...)
 */
export async function generatePONumber(tx: PrismaTx): Promise<string> {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const monthStart = new Date(year, today.getMonth(), 1);
  const monthEnd = new Date(year, today.getMonth() + 1, 1);
  const monthCount = await tx.purchaseOrder.count({
    where: { createdAt: { gte: monthStart, lt: monthEnd } },
  });
  return `PO-${year}-${month}-${String(monthCount + 1).padStart(3, '0')}`;
}
