import { Decimal } from '@prisma/client/runtime/library';

export interface CashSaleProduct {
  id: string;
  costPrice: Decimal;
}

export interface CashSaleAllocation {
  productId: string;
  revenue: Decimal;
  cost: Decimal;
}

/**
 * Split a cash sale's net revenue across its products. `Sale` has no per-product
 * line price, so revenue is allocated proportionally by each product's `costPrice`
 * (confirmed default — spec §6B). The LAST product absorbs the rounding residual so
 * the allocated revenue sums EXACTLY to `netAmount`. If total cost is 0 (all
 * give-aways) all revenue lands on the first (main) product. Each product's `cost`
 * is its own `costPrice`.
 */
export function allocateCashSaleByCost(
  netAmount: Decimal,
  products: CashSaleProduct[],
): CashSaleAllocation[] {
  if (products.length === 0) return [];
  const net = new Decimal(netAmount.toString());
  const totalCost = products.reduce(
    (s, p) => s.plus(new Decimal(p.costPrice.toString())),
    new Decimal(0),
  );

  if (!totalCost.gt(0)) {
    return products.map((p, i) => ({
      productId: p.id,
      revenue: i === 0 ? net : new Decimal(0),
      cost: new Decimal(0),
    }));
  }

  const allocations: CashSaleAllocation[] = [];
  let allocated = new Decimal(0);
  products.forEach((p, i) => {
    const cost = new Decimal(p.costPrice.toString());
    let revenue: Decimal;
    if (i === products.length - 1) {
      revenue = net.sub(allocated); // last absorbs residual → exact sum
    } else {
      revenue = net.mul(cost).div(totalCost).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      allocated = allocated.plus(revenue);
    }
    allocations.push({ productId: p.id, revenue, cost });
  });
  return allocations;
}
