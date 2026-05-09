// Asset module — disposal live JE preview (memoized gain/loss + journal lines)
// Mirrors AssetDisposalReverseTemplate's 5 case structures.

import { useMemo } from 'react';
import type { Asset, DisposalCalculation } from '../types';
import { CATEGORY_COA } from '../types';
import type { DisposalFormValues } from '../disposal-schema';

const round2 = (n: number) => Math.round(n * 100) / 100;

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
    const nbv = round2(Number(asset.netBookValue));
    const accumulatedDepr = round2(Number(asset.accumulatedDepr));
    const purchaseCost = round2(Number(asset.purchaseCost));
    const proceeds =
      values.disposalType === 'SALE' ? round2(Number(values.proceeds) || 0) : 0;
    const gainLoss = round2(proceeds - nbv);

    const coa = CATEGORY_COA[asset.category];
    const lines: DisposalCalculation['journalLines'] = [];

    if (accumulatedDepr > 0) {
      lines.push({
        accountCode: asset.coaDeprAccount ?? coa.accDepr,
        accountName: 'Dr ค่าเสื่อมราคาสะสม',
        debit: accumulatedDepr,
        credit: 0,
      });
    }
    if (values.disposalType === 'SALE' && proceeds > 0 && values.depositAccountCode) {
      lines.push({
        accountCode: values.depositAccountCode,
        accountName: 'Dr เงินสด/ธนาคาร',
        debit: proceeds,
        credit: 0,
      });
    }
    if (gainLoss < 0) {
      lines.push({
        accountCode: '53-1605',
        accountName: 'Dr ขาดทุนจากการจำหน่าย',
        debit: round2(-gainLoss),
        credit: 0,
      });
    }
    lines.push({
      accountCode: asset.coaCostAccount ?? coa.cost,
      accountName: 'Cr สินทรัพย์',
      debit: 0,
      credit: purchaseCost,
    });
    if (gainLoss > 0) {
      lines.push({
        accountCode: '42-1105',
        accountName: 'Cr กำไรจากการจำหน่าย',
        debit: 0,
        credit: round2(gainLoss),
      });
    }

    const totalDr = lines.reduce((s, l) => s + l.debit, 0);
    const totalCr = lines.reduce((s, l) => s + l.credit, 0);
    const isBalanced = round2(totalDr) === round2(totalCr);

    return { nbv, proceeds, gainLoss, journalLines: lines, isBalanced };
  }, [asset, values]);
}
