// Asset module — disposal live JE preview (memoized gain/loss + journal lines)
// Mirrors AssetDisposalReverseTemplate's 5 case structures.
//
// All money arithmetic uses decimal.js to avoid IEEE-754 floating-point drift.
// `isBalanced` gates form submission, so a 0.01 drift could silently block valid
// disposals or allow unbalanced JEs through.

import { useMemo } from 'react';
import Decimal from 'decimal.js';
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
      lines.push({
        accountCode: asset.coaDeprAccount ?? coa.accDepr,
        accountName: 'Dr ค่าเสื่อมราคาสะสม',
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
        accountName: 'Dr เงินสด/ธนาคาร',
        debit: proceeds,
        credit: ZERO,
      });
    }
    if (gainLoss.lt(0)) {
      lines.push({
        accountCode: '53-1605',
        accountName: 'Dr ขาดทุนจากการจำหน่าย',
        debit: round2(gainLoss.negated()),
        credit: ZERO,
      });
    }
    lines.push({
      accountCode: asset.coaCostAccount ?? coa.cost,
      accountName: 'Cr สินทรัพย์',
      debit: ZERO,
      credit: purchaseCost,
    });
    if (gainLoss.gt(0)) {
      lines.push({
        accountCode: '42-1105',
        accountName: 'Cr กำไรจากการจำหน่าย',
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
  }, [asset, values]);
}
