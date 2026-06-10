import { BadRequestException } from '@nestjs/common';

/**
 * T5-C1 — POS discount cost-floor + role cap.
 * Phone-shop margin is ~10%, so an unbounded discount hidden in a sale
 * turns into direct loss. Every role has a max discount %; anything over
 * the soft threshold must carry a second approver.
 *
 * Stateless policy helper (no Prisma) — extracted from SalesService so the
 * sale-creation orchestrator and any future caller share one source of truth.
 */
export class DiscountPolicy {
  static readonly MAX_DISCOUNT_PCT: Record<string, number> = {
    SALES: 0.05,
    BRANCH_MANAGER: 0.15,
    FINANCE_MANAGER: 0.25,
    ACCOUNTANT: 0.05, // same as SALES — accountant isn't expected to discount
    OWNER: 1.0, // effectively unlimited
  };
  static readonly DISCOUNT_SECOND_APPROVER_THRESHOLD = 0.1;

  static assertDiscountAllowed(
    sellingPrice: number,
    discount: number,
    userRole: string,
    costPrice: number | null | undefined,
    secondApproverId: string | null | undefined,
  ): void {
    if (!discount || discount <= 0) return;
    if (sellingPrice <= 0) {
      throw new BadRequestException('ราคาขายไม่ถูกต้อง');
    }
    const pct = discount / sellingPrice;
    const maxForRole =
      DiscountPolicy.MAX_DISCOUNT_PCT[userRole] ?? DiscountPolicy.MAX_DISCOUNT_PCT.SALES;

    if (pct > maxForRole) {
      throw new BadRequestException(
        `ส่วนลด ${(pct * 100).toFixed(1)}% เกินขีดจำกัด ${(maxForRole * 100).toFixed(0)}% ของ role ${userRole}`,
      );
    }

    // Second-approver requirement kicks in before the hard role cap —
    // anything over 10% must be co-signed, regardless of role (OWNER is the
    // only exception because they are the approver authority).
    if (
      userRole !== 'OWNER' &&
      pct > DiscountPolicy.DISCOUNT_SECOND_APPROVER_THRESHOLD &&
      !secondApproverId
    ) {
      throw new BadRequestException(
        'ส่วนลดเกิน 10% ต้องมีผู้อนุมัติเพิ่มเติม (secondApproverId)',
      );
    }

    // Cost floor: net selling price must not drop below costPrice × (1 - maxForRole).
    // OWNER is allowed to override this (they can sell below cost deliberately
    // for strategic reasons such as clearing dead stock).
    if (costPrice != null && costPrice > 0 && userRole !== 'OWNER') {
      const netAfterDiscount = sellingPrice - discount;
      const floor = costPrice * (1 - maxForRole);
      if (netAfterDiscount < floor) {
        throw new BadRequestException(
          `ราคาขายสุทธิ ${netAfterDiscount.toLocaleString()} ต่ำกว่าขั้นต่ำ ${floor.toLocaleString()} (ต้นทุน ${costPrice.toLocaleString()})`,
        );
      }
    }
  }
}
