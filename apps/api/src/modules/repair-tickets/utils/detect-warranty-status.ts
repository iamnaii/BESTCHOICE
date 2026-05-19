import { WarrantyStatus } from '@prisma/client';

export interface DetectWarrantyInput {
  contract?: { deviceReceivedAt?: Date | null; shopWarrantyEndDate?: Date | null } | null;
  product?: { warrantyExpireDate?: Date | null } | null;
}

/**
 * Determines the warranty status for a repair ticket based on contract and product dates.
 *
 * Priority:
 *   1. IN_7DAY_DEFECT  — device received ≤7 days ago (7-day return policy)
 *   2. IN_SHOP_WARRANTY — shop warranty end date still in the future
 *   3. IN_MANUFACTURER  — manufacturer warranty still active on product
 *   4. OUT_OF_WARRANTY  — all warranties expired or no dates provided
 *   5. WALK_IN          — no contract and no product linked (drop-in customer)
 */
export function detectWarrantyStatus(input: DetectWarrantyInput): WarrantyStatus {
  const now = new Date();
  const c = input.contract;
  const p = input.product;

  // No context at all → walk-in customer
  if (!c && !p) return 'WALK_IN';

  // 7-day defect window (counted from device receipt, inclusive)
  if (c?.deviceReceivedAt) {
    const daysSinceReceipt = (now.getTime() - c.deviceReceivedAt.getTime()) / 86400_000;
    if (daysSinceReceipt <= 7) return 'IN_7DAY_DEFECT';
  }

  // Shop warranty still active
  if (c?.shopWarrantyEndDate && c.shopWarrantyEndDate > now) {
    return 'IN_SHOP_WARRANTY';
  }

  // Manufacturer warranty still active
  if (p?.warrantyExpireDate && p.warrantyExpireDate > now) {
    return 'IN_MANUFACTURER';
  }

  return 'OUT_OF_WARRANTY';
}

/**
 * Returns the default payer for a repair based on warranty status.
 *
 * - In-warranty (any kind) → SHOP bears the cost
 * - Out-of-warranty or walk-in → CUSTOMER pays
 */
export function defaultPayer(ws: WarrantyStatus): 'SHOP' | 'CUSTOMER' {
  if (ws === 'OUT_OF_WARRANTY' || ws === 'WALK_IN') return 'CUSTOMER';
  return 'SHOP';
}
