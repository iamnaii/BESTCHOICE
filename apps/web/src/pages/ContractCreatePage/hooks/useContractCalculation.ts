import { useState, useEffect } from 'react';
import Decimal from 'decimal.js';
import type { Product, InterestConfig } from '../types';

// (Audit finding P0) The backend stores all money values as Prisma.Decimal(12,2).
// Doing the contract preview in JS float caused 0.01 baht drift per multiplication
// step, accumulated across `principal × interestRate × months × vat` and divided
// out to `monthlyPayment`. The user saw `1499.999...` while the server stored
// `1500.00`, and the final installment occasionally diverged by a few satang.
// All arithmetic now goes through decimal.js with explicit toDecimalPlaces(2)
// at each step; only the final hand-off to React state uses .toNumber().

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

  const dPrincipal = Decimal.max(new Decimal(sellingPrice).sub(downPayment), 0);
  const dStoreCommission = dPrincipal.mul(storeCommPct).toDecimalPlaces(2);
  const dInterestTotal = dPrincipal.mul(interestRate).mul(totalMonths).toDecimalPlaces(2);
  const dVatAmount = dPrincipal.add(dStoreCommission).add(dInterestTotal).mul(vatPct).toDecimalPlaces(2);
  const dFinancedAmount = dPrincipal.add(dStoreCommission).add(dInterestTotal).add(dVatAmount).toDecimalPlaces(2);
  const dMonthlyPayment = totalMonths > 0 ? dFinancedAmount.div(totalMonths).toDecimalPlaces(2) : new Decimal(0);

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
