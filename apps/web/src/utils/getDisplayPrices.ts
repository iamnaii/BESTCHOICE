export interface ProductPriceRow {
  label: string;
  amount: string | number;
  isDefault: boolean;
}

export interface ProductForDisplay {
  cashPrice?: string | number | null;
  installmentPrice?: string | number | null;
  prices: ProductPriceRow[];
}

export interface DisplayPrices {
  cash: number | null;
  installment: number | null;
}

function pickFromPrices(prices: ProductPriceRow[], exactLabel: string, prefix: string): number | null {
  const exact = prices.find((p) => p.label === exactLabel);
  if (exact) return Number(exact.amount);
  const prefixMatch = prices.find((p) => p.label.startsWith(prefix));
  if (prefixMatch) return Number(prefixMatch.amount);
  return null;
}

export function getDisplayPrices(product: ProductForDisplay): DisplayPrices {
  const cash =
    product.cashPrice != null
      ? Number(product.cashPrice)
      : pickFromPrices(product.prices, 'ราคาเงินสด', 'ราคาเงินสด');

  const installment =
    product.installmentPrice != null
      ? Number(product.installmentPrice)
      : pickFromPrices(product.prices, 'ราคาผ่อน BESTCHOICE', 'ราคาผ่อน');

  return { cash, installment };
}
