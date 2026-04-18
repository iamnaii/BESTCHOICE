import { useState, useEffect } from 'react';
import type { Product, InterestConfig } from '../types';

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

  const principal = Math.max(sellingPrice - downPayment, 0);
  const storeCommission = principal * storeCommPct;
  const interestTotal = principal * interestRate * totalMonths;
  const vatAmount = (principal + storeCommission + interestTotal) * vatPct;
  const financedAmount = principal + storeCommission + interestTotal + vatAmount;
  const monthlyPayment = totalMonths > 0 ? Math.round((financedAmount / totalMonths) * 100) / 100 : 0;

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
