import type { PettyCashFormFields } from './types';

/**
 * ยอดของใบเงินสดย่อย — สูตรเดิมของ PettyCashLinesSection:
 * VAT ต่อบรรทัด = round(ฐาน × อัตรา) / 100 · รวมต่อบรรทัด = ฐาน + VAT
 */
export function pettyCashTotals(value: PettyCashFormFields) {
  const lines = value.lines.map((l) => {
    const base = parseFloat(l.amount) || 0;
    const vatPct = parseFloat(l.vatPercent) || 0;
    const vat = Math.round(base * vatPct) / 100;
    return { uid: l.uid, base, vat, total: base + vat };
  });
  const sumBase = lines.reduce((s, l) => s + l.base, 0);
  const sumVat = lines.reduce((s, l) => s + l.vat, 0);
  return { lines, sumBase, sumVat, sumTotal: sumBase + sumVat };
}
