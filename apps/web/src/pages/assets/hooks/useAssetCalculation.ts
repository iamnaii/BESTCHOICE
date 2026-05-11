// Asset module — derived-value hook (memoized VAT/WHT/totals + JE preview)

import { useMemo } from 'react';
import type { AssetEntryFormValues } from '../schema';
import { CATEGORY_COA } from '../types';

interface JournalLine {
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
}

export interface CalculationResult {
  basePrice: number; // adjusted (ex-VAT if inclusive)
  vatAmount: number;
  whtBase: number;
  whtAmount: number;
  purchaseCost: number; // basePrice + ship + install + other
  totalPayable: number; // purchaseCost + (excl ? vat : 0) - wht
  monthlyDepr: number;
  netBookValue: number;
  journalLines: JournalLine[];
  isBalanced: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

export function useAssetCalculation(values: Partial<AssetEntryFormValues>): CalculationResult {
  return useMemo(() => {
    const basePriceRaw = Number(values.basePrice) || 0;
    const shipping = Number(values.shippingCost) || 0;
    const installation = Number(values.installationCost) || 0;
    const other = Number(values.otherCapitalized) || 0;
    const residual = Number(values.residualValue) || 0;
    const usefulLife = Number(values.usefulLifeMonths) || 1;

    // VAT
    let basePrice = basePriceRaw;
    let vatAmount = 0;
    if (values.hasVat) {
      if (values.vatInclusive) {
        vatAmount = round2((basePriceRaw * 7) / 107);
        basePrice = round2(basePriceRaw - vatAmount);
      } else {
        vatAmount = round2(basePriceRaw * 0.07);
      }
    }

    // WHT
    const whtBase = Number(values.whtBaseAmount) || installation || 0;
    const whtRate = Number(values.whtRate) || 0;
    const whtAmount = values.hasWht && whtBase > 0 ? round2(whtBase * whtRate) : 0;

    const purchaseCost = round2(basePrice + shipping + installation + other);
    // VAT goes to Dr 11-4101 regardless of inclusive/exclusive flag — the flag only
    // changes how basePrice is parsed. Cash out always = (ex-VAT cost) + VAT − WHT.
    // (Matches server-side asset-purchase.template.ts logic.)
    const totalPayable = round2(purchaseCost + vatAmount - whtAmount);
    const monthlyDepr = round4((purchaseCost - residual) / usefulLife);

    // JE preview lines
    const cat = values.category;
    const coa = cat ? CATEGORY_COA[cat] : null;
    const lines: JournalLine[] = [];
    if (coa && purchaseCost > 0) {
      lines.push({
        accountCode: coa.cost,
        accountName: `Dr ${cat} cost`,
        debit: purchaseCost,
        credit: 0,
      });
    }
    if (values.hasVat && vatAmount > 0 && values.vatAccount) {
      lines.push({
        accountCode: values.vatAccount,
        accountName: 'Dr ภาษีซื้อ',
        debit: vatAmount,
        credit: 0,
      });
    }
    if (values.hasWht && whtAmount > 0 && values.whtAccount) {
      lines.push({
        accountCode: values.whtAccount,
        accountName: `Cr WHT ${values.whtFormType ?? ''}`,
        debit: 0,
        credit: whtAmount,
      });
    }
    if (values.paymentAccount && totalPayable > 0) {
      lines.push({
        accountCode: values.paymentAccount,
        accountName: 'Cr ชำระเงิน',
        debit: 0,
        credit: totalPayable,
      });
    }

    const totalDr = lines.reduce((s, l) => s + l.debit, 0);
    const totalCr = lines.reduce((s, l) => s + l.credit, 0);
    const isBalanced = round2(totalDr) === round2(totalCr);

    return {
      basePrice,
      vatAmount,
      whtBase,
      whtAmount,
      purchaseCost,
      totalPayable,
      monthlyDepr,
      netBookValue: purchaseCost,
      journalLines: lines,
      isBalanced,
    };
  }, [values]);
}
