// Asset module — derived-value hook (memoized VAT/WHT/totals + JE preview)
//
// P13 (PDF page 11+13): account names MUST come from chart_of_accounts via
// `/chart-of-accounts/by-codes` — no hardcoded strings, no Dr/Cr prefixes.
// The render layer shows DR/CR amounts in dedicated columns, so the name
// column should carry only the real bookkeeping name.

import { useMemo } from 'react';
import { useCoaByCodes } from '@/hooks/useCoa';
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
  totalDr: number;
  totalCr: number;
  isBalanced: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

export function useAssetCalculation(values: Partial<AssetEntryFormValues>): CalculationResult {
  // Collect candidate account codes BEFORE the JE memo so we can resolve
  // names via the CoA endpoint. The set is small (≤4 distinct codes) and the
  // hook is cached with staleTime: Infinity.
  const candidateCodes = useMemo(() => {
    const cat = values.category;
    const coa = cat ? CATEGORY_COA[cat] : null;
    const codes: string[] = [];
    if (coa) codes.push(coa.cost);
    if (values.vatAccount) codes.push(values.vatAccount);
    if (values.whtAccount) codes.push(values.whtAccount);
    if (values.paymentAccount) codes.push(values.paymentAccount);
    return Array.from(new Set(codes.filter(Boolean)));
  }, [values.category, values.vatAccount, values.whtAccount, values.paymentAccount]);

  const { data: coaRows } = useCoaByCodes(candidateCodes);
  const nameByCode = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of coaRows ?? []) map.set(r.code, r.name);
    return map;
  }, [coaRows]);
  // Fallback to the code itself while CoA data is loading or unknown — avoids
  // rendering "undefined" / empty cell. The real name backfills once the query
  // resolves (React Query re-renders the consumer).
  const accountName = (code: string) => nameByCode.get(code) ?? code;

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

    // JE preview lines — names resolved from chart_of_accounts (P13).
    const cat = values.category;
    const coa = cat ? CATEGORY_COA[cat] : null;
    const lines: JournalLine[] = [];
    if (coa && purchaseCost > 0) {
      lines.push({
        accountCode: coa.cost,
        accountName: accountName(coa.cost),
        debit: purchaseCost,
        credit: 0,
      });
    }
    if (values.hasVat && vatAmount > 0 && values.vatAccount) {
      lines.push({
        accountCode: values.vatAccount,
        accountName: accountName(values.vatAccount),
        debit: vatAmount,
        credit: 0,
      });
    }
    if (values.hasWht && whtAmount > 0 && values.whtAccount) {
      lines.push({
        accountCode: values.whtAccount,
        accountName: accountName(values.whtAccount),
        debit: 0,
        credit: whtAmount,
      });
    }
    if (values.paymentAccount && totalPayable > 0) {
      lines.push({
        accountCode: values.paymentAccount,
        accountName: accountName(values.paymentAccount),
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
      totalDr: round2(totalDr),
      totalCr: round2(totalCr),
      isBalanced,
    };
    // accountName() depends on nameByCode; including the map ensures the lines
    // re-resolve once CoA data lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, nameByCode]);
}
