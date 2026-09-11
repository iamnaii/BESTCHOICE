import { useState, useEffect } from 'react';
import Decimal from 'decimal.js';
import type { Product, InterestConfig } from '../types';
import { getPositiveDisplayPrices } from '@/utils/getDisplayPrices';

// Propose editable price/down/month defaults only. Contract amounts, rates and
// payment schedules are resolved by useContractQuote from the server.

interface UseContractCalculationParams {
  tradeInBaseAmount?: number;
  tradeInBonusAmount?: number;
  selectedProduct: Product | null;
  preserveDownPayment?: boolean;
  configPending?: boolean;
  interestConfig: InterestConfig | null | undefined;
  posConfig: { interestRate: number; minDownPaymentPct: number; storeCommissionPct: number; vatPct: number; minInstallmentMonths: number; maxInstallmentMonths: number } | undefined;
  downPayment: number;
  setDownPayment: (v: number) => void;
  totalMonths: number;
  setTotalMonths: (value: number | ((prev: number) => number)) => void;
}

export function useContractCalculation({
  tradeInBaseAmount = 0,
  tradeInBonusAmount = 0,
  selectedProduct,
  preserveDownPayment = false,
  configPending = false,
  interestConfig,
  posConfig,
  downPayment,
  setDownPayment,
  totalMonths,
  setTotalMonths,
}: UseContractCalculationParams) {
  const getSellingPrice = () => {
    if (!selectedProduct) return 0;
    // B0 §2.1: columns-first ผ่าน getPositiveDisplayPrices (มัน fallback ไป prices[] label ให้อยู่แล้ว)
    // fix-round-1 (reviewer Important): ใช้ getPositiveDisplayPrices แทน getDisplayPrices ตรงๆ —
    // มัน normalize คอลัมน์ที่ 0/''/ติดลบ ให้เป็น null ก่อนเรียก getDisplayPrices ภายใน ทำให้
    // label-chain lookup ('ราคาผ่อน BESTCHOICE' / 'ราคาเงินสด') ยังทำงานได้แทนที่จะโดน
    // short-circuit ข้ามไปเงียบๆ (getDisplayPrices เช็คแค่ `!= null` ซึ่ง 0 ไม่ null)
    const { cash, installment } = getPositiveDisplayPrices({
      cashPrice: selectedProduct.cashPrice ?? null,
      installmentPrice: selectedProduct.installmentPrice ?? null,
      prices: selectedProduct.prices,
    });
    // ⚠️ positivity guard ซ้ำอีกชั้นบนผลลัพธ์รวม (defence in depth): แม้คอลัมน์จะ normalize
    // แล้ว แต่ label-chain fallback (pickFromPrices) เองไม่ได้กรอง positivity ของแถว prices[]
    // ถ้าใช้ `!= null` เฉยๆ เครื่องราคา 20,000 ที่ดันมีแถวราคาเป็น 0 จะทำสัญญาที่ 0 บาท (เคส I)
    if (installment != null && installment > 0) return installment;
    if (cash != null && cash > 0) return cash;
    // legacy tail ที่ getDisplayPrices ไม่ครอบ: row isDefault ที่ label ไม่ตรงชุดไหนเลย
    // ('ราคาขาย' จาก PO receive / 'ราคาขายต่อ (Refurbished)' จากยึดเครื่อง)
    const row =
      selectedProduct.prices.find((p) => p.isDefault) || selectedProduct.prices[0];
    const amount = row ? Number(row.amount) : 0;
    return Number.isFinite(amount) && amount > 0 ? amount : 0;
  };

  const grossSellingPrice = getSellingPrice();
  const sellingPrice = new Decimal(grossSellingPrice).minus(tradeInBonusAmount).toNumber();
  const totalDownPayment = new Decimal(downPayment).plus(tradeInBaseAmount).toNumber();

  const interestRate = interestConfig ? parseFloat(interestConfig.interestRate) : (posConfig?.interestRate ?? 0.08);
  const minDownPct = interestConfig ? parseFloat(interestConfig.minDownPaymentPct) : (posConfig?.minDownPaymentPct ?? 0.15);
  const storeCommPct = interestConfig ? parseFloat(interestConfig.storeCommissionPct) : (posConfig?.storeCommissionPct ?? 0.10);
  const vatPct = interestConfig ? parseFloat(interestConfig.vatPct) : (posConfig?.vatPct ?? 0.07);
  const minMonths = interestConfig?.minInstallmentMonths ?? posConfig?.minInstallmentMonths ?? 6;
  const maxMonths = interestConfig?.maxInstallmentMonths ?? posConfig?.maxInstallmentMonths ?? 12;

  // Auto-set down payment to minimum when price/config becomes available
  const [downPaymentTouched, setDownPaymentTouched] = useState(preserveDownPayment);
  useEffect(() => {
    if (!downPaymentTouched && sellingPrice > 0 && minDownPct > 0) {
      setDownPayment(Decimal.max(0, new Decimal(sellingPrice).mul(minDownPct).ceil().minus(tradeInBaseAmount)).toNumber());
    }
  }, [sellingPrice, minDownPct, downPaymentTouched, tradeInBaseAmount]);

  // Clamp totalMonths when config range changes
  useEffect(() => {
    if (configPending || minMonths > maxMonths) return;
    setTotalMonths(prev => {
      if (prev < minMonths) return minMonths;
      if (prev > maxMonths) return maxMonths;
      return prev;
    });
  }, [minMonths, maxMonths, configPending]);

  const monthOptions: number[] = [];
  for (let m = minMonths; m <= maxMonths; m++) {
    monthOptions.push(m);
  }

  return {
    grossSellingPrice, totalDownPayment,
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
    monthOptions,
  };
}
