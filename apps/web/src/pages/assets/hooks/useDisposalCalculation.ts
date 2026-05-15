// Asset module — disposal live JE preview (memoized gain/loss + journal lines)
// Mirrors AssetDisposalReverseTemplate's 5 case structures.
//
// All money arithmetic uses decimal.js to avoid IEEE-754 floating-point drift.
// `isBalanced` gates form submission, so a 0.01 drift could silently block valid
// disposals or allow unbalanced JEs through.
//
// P13 (PDF page 11+13): account names come from chart_of_accounts via
// `/chart-of-accounts/by-codes` — no hardcoded strings, no Dr/Cr prefixes.

import { useMemo } from 'react';
import Decimal from 'decimal.js';
import { useCoaByCodes } from '@/hooks/useCoa';
import type { Asset, DisposalCalculation } from '../types';
import { CATEGORY_COA } from '../types';
import type { DisposalFormValues } from '../disposal-schema';

const ZERO = new Decimal(0);

const round2 = (n: Decimal | string | number): Decimal =>
  new Decimal(n).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

export function useDisposalCalculation(
  asset: Asset | undefined,
  values: Partial<DisposalFormValues>,
): DisposalCalculation {
  // Collect candidate codes BEFORE the JE memo so we can resolve names via CoA.
  // Disposal touches at most 5 distinct codes; `useCoaByCodes` is cached.
  const candidateCodes = useMemo(() => {
    const codes: string[] = [];
    if (asset) {
      const coa = CATEGORY_COA[asset.category];
      codes.push(asset.coaDeprAccount ?? coa.accDepr);
      codes.push(asset.coaCostAccount ?? coa.cost);
    }
    if (values.depositAccountCode) codes.push(values.depositAccountCode);
    codes.push('53-1605'); // loss on disposal
    codes.push('42-1105'); // gain on disposal
    return Array.from(new Set(codes.filter(Boolean)));
  }, [asset, values.depositAccountCode]);

  const { data: coaRows } = useCoaByCodes(candidateCodes);
  const nameByCode = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of coaRows ?? []) map.set(r.code, r.name);
    return map;
  }, [coaRows]);
  // Fallback to the code itself while CoA data loads — backfills once the
  // React Query resolves.
  const accountName = (code: string) => nameByCode.get(code) ?? code;

  return useMemo(() => {
    if (!asset) {
      return {
        nbv: 0,
        proceeds: 0,
        gainLoss: 0,
        journalLines: [],
        isBalanced: true,
      };
    }
    const nbv = round2(asset.netBookValue);
    const accumulatedDepr = round2(asset.accumulatedDepr);
    const purchaseCost = round2(asset.purchaseCost);
    const proceeds =
      values.disposalType === 'SALE'
        ? round2(values.proceeds ?? 0)
        : ZERO;
    const gainLoss = round2(proceeds.minus(nbv));

    const coa = CATEGORY_COA[asset.category];
    const lines: Array<{
      accountCode: string;
      accountName: string;
      debit: Decimal;
      credit: Decimal;
    }> = [];

    if (accumulatedDepr.gt(0)) {
      const code = asset.coaDeprAccount ?? coa.accDepr;
      lines.push({
        accountCode: code,
        accountName: accountName(code),
        debit: accumulatedDepr,
        credit: ZERO,
      });
    }
    if (
      values.disposalType === 'SALE' &&
      proceeds.gt(0) &&
      values.depositAccountCode
    ) {
      lines.push({
        accountCode: values.depositAccountCode,
        accountName: accountName(values.depositAccountCode),
        debit: proceeds,
        credit: ZERO,
      });
    }
    if (gainLoss.lt(0)) {
      lines.push({
        accountCode: '53-1605',
        accountName: accountName('53-1605'),
        debit: round2(gainLoss.negated()),
        credit: ZERO,
      });
    }
    {
      const code = asset.coaCostAccount ?? coa.cost;
      lines.push({
        accountCode: code,
        accountName: accountName(code),
        debit: ZERO,
        credit: purchaseCost,
      });
    }
    if (gainLoss.gt(0)) {
      lines.push({
        accountCode: '42-1105',
        accountName: accountName('42-1105'),
        debit: ZERO,
        credit: round2(gainLoss),
      });
    }

    const totalDr = lines.reduce<Decimal>((s, l) => s.plus(l.debit), ZERO);
    const totalCr = lines.reduce<Decimal>((s, l) => s.plus(l.credit), ZERO);
    const isBalanced = totalDr.equals(totalCr);

    return {
      nbv: nbv.toNumber(),
      proceeds: proceeds.toNumber(),
      gainLoss: gainLoss.toNumber(),
      journalLines: lines.map((l) => ({
        accountCode: l.accountCode,
        accountName: l.accountName,
        debit: l.debit.toNumber(),
        credit: l.credit.toNumber(),
      })),
      isBalanced,
    };
    // accountName() depends on nameByCode; including the map ensures lines
    // re-resolve once CoA data lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset, values, nameByCode]);
}
