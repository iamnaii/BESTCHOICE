import type { SettlementFormFields } from './types';

/**
 * ยอดของใบจ่ายเจ้าหนี้ — สูตรเดิมของ SettlementLinesSection:
 * รวมยอดที่จ่ายของใบที่เลือก − ภาษีหัก ณ ที่จ่าย = เงินที่ตัดจริง
 */
export function settlementTotals(value: SettlementFormFields) {
  const sumSelected = [...value.selections.values()].reduce(
    (s, sel) => s + (parseFloat(sel.amount) || 0),
    0,
  );
  const wht = parseFloat(value.whtAmount) || 0;
  return { count: value.selections.size, sumSelected, wht, cashLeg: sumSelected - wht };
}
