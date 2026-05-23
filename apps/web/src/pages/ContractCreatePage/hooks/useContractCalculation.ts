import { useState, useEffect } from 'react';
import Decimal from 'decimal.js';
import { calcBcInstallment } from '@installment/shared';
import type { Product, InterestConfig } from '../types';

// (Audit finding P0) The backend stores all money values as Prisma.Decimal(12,2).
// Doing the contract preview in JS float caused 0.01 baht drift per multiplication
// step, accumulated across `principal × interestRate × months × vat` and divided
// out to `monthlyPayment`. The user saw `1499.999...` while the server stored
// `1500.00`, and the final installment occasionally diverged by a few satang.
// All arithmetic now goes through decimal.js with explicit toDecimalPlaces(2)
// at each step; only the final hand-off to React state uses .toNumber().
// Refactored (Task 17): math delegated to calcBcInstallment from @installment/shared.
// Per-month rate map is built from legacy rate × months to preserve identical output.

interface UseContractCalculationParams {
  selectedProduct: Product | null;
  interestConfig: InterestConfig | null | undefined;
  posConfig: { interestRate: number; minDownPaymentPct: number; storeCommissionPct: number; vatPct: number; minInstallmentMonths: number; maxInstallmentMonths: number } | undefined;
  downPayment: number;
  setDownPayment: (v: number) => void;
  totalMonths: number;
  setTotalMonths: (value: number | ((prev: number) => number)) => void;
}

export function useContractCalculation({
  selectedProduct,
  interestConfig,
  posConfig,
  downPayment,
  setDownPayment,
  totalMonths,
  setTotalMonths,
}: UseContractCalculationParams) {
  const getSellingPrice = () => {
    if (!selectedProduct) return 0;
    const price =
      selectedProduct.prices.find((p) => p.label === 'ราคาผ่อน BESTCHOICE') ||
      selectedProduct.prices.find((p) => p.label.startsWith('ราคาผ่อน')) ||
      selectedProduct.prices.find((p) => p.isDefault) ||
      selectedProduct.prices[0];
    return price ? parseFloat(price.amount) : 0;
  };

  const sellingPrice = getSellingPrice();

  const interestRate = interestConfig ? parseFloat(interestConfig.interestRate) : (posConfig?.interestRate ?? 0.08);
  const minDownPct = interestConfig ? parseFloat(interestConfig.minDownPaymentPct) : (posConfig?.minDownPaymentPct ?? 0.15);
  const storeCommPct = interestConfig ? parseFloat(interestConfig.storeCommissionPct) : (posConfig?.storeCommissionPct ?? 0.10);
  const vatPct = interestConfig ? parseFloat(interestConfig.vatPct) : (posConfig?.vatPct ?? 0.07);
  const minMonths = interestConfig?.minInstallmentMonths ?? posConfig?.minInstallmentMonths ?? 6;
  const maxMonths = interestConfig?.maxInstallmentMonths ?? posConfig?.maxInstallmentMonths ?? 12;

  // Auto-set down payment to minimum when price/config becomes available
  const [downPaymentTouched, setDownPaymentTouched] = useState(false);
  useEffect(() => {
    if (!downPaymentTouched && sellingPrice > 0 && minDownPct > 0) {
      setDownPayment(Math.ceil(sellingPrice * minDownPct));
    }
  }, [sellingPrice, minDownPct, downPaymentTouched]);

  // Clamp totalMonths when config range changes
  useEffect(() => {
    if (minMonths > maxMonths) return;
    setTotalMonths(prev => {
      if (prev < minMonths) return minMonths;
      if (prev > maxMonths) return maxMonths;
      return prev;
    });
  }, [minMonths, maxMonths]);

  // Build per-month rate map from legacy single rate × months.
  // When InterestConfigRate is wired (future PR), this can read config.rates directly.
  const allowedMonths = Array.from(
    { length: maxMonths - minMonths + 1 },
    (_, i) => minMonths + i,
  );
  const ratePctByMonths = new Map<number, Decimal>(
    allowedMonths.map((m) => [m, new Decimal(interestRate).mul(m)]),
  );

  // Clamp downPayment to sellingPrice to preserve the old hook's Decimal.max(…, 0)
  // behaviour: if downPayment >= sellingPrice the util produces 0 for all fields.
  const clampedDownAmount = new Decimal(Math.min(downPayment, sellingPrice));

  const out = calcBcInstallment({
    installmentPrice: new Decimal(sellingPrice),
    months: totalMonths,
    customDownAmount: clampedDownAmount,
    config: {
      minDownPct: new Decimal(minDownPct),
      commissionPct: new Decimal(storeCommPct),
      vatPct: new Decimal(vatPct),
      ratePctByMonths,
      allowedMonths,
    },
  });

  // Map shared utility output to existing return shape.
  // Note: hook's "financedAmount" = util's "totalWithVat" (total customers owes).
  //       hook's "principal"       = util's "financedAmount" (price − down).
  const dPrincipal = out.financedAmount;
  const dStoreCommission = out.commissionAmount;
  const dInterestTotal = out.interestAmount;
  const dVatAmount = out.vatAmount;
  const dFinancedAmount = out.totalWithVat;
  const dMonthlyPayment = out.monthlyPayment;

  const principal = dPrincipal.toNumber();
  const storeCommission = dStoreCommission.toNumber();
  const interestTotal = dInterestTotal.toNumber();
  const vatAmount = dVatAmount.toNumber();
  const financedAmount = dFinancedAmount.toNumber();
  const monthlyPayment = dMonthlyPayment.toNumber();

  const monthOptions: number[] = [];
  for (let m = minMonths; m <= maxMonths; m++) {
    monthOptions.push(m);
  }

  return {
    getSellingPrice,
    sellingPrice,
    interestRate,
    minDownPct,
    storeCommPct,
    vatPct,
    minMonths,
    maxMonths,
    downPaymentTouched,
    setDownPaymentTouched,
    principal,
    storeCommission,
    interestTotal,
    vatAmount,
    financedAmount,
    monthlyPayment,
    monthOptions,
  };
}
