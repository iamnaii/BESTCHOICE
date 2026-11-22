import { Prisma } from '@prisma/client';
import { collectSections } from '../../modules/imported-sales/tooltify-report-layout';
import { sourceTimestamp } from '../../modules/imported-sales/tooltify-date';
import type { BillCountBridge, SalesReportResult, SourceDecision } from './types';

const payments: Record<string, string> = {
  ขายแบบเงินสด: 'CASH',
  ขายแบบโอน: 'BANK_TRANSFER',
  'ขายแบบสแกน QR': 'QR_EWALLET',
  ขายแบบเครดิต: 'CREDIT_BALANCE',
  'ขายแบบเครดิต / ยอดหนี้': 'CREDIT_BALANCE',
};
const amounts = {
  costTotal: 'ต้นทุนรวม',
  listPrice: 'ราคาตั้งขาย',
  salePrice: 'ราคาขาย',
  profit: 'กำไร',
} as const;
const equalRows = (a: number[], b: number[]) =>
  a.length === new Set(a).size && a.length === b.length && a.every((r) => b.includes(r));

/** Verify the whole bill-header table against detail events, not just the exceptional rows. */
export function reconcileBillCount(
  rows: string[][],
  fileSha256: string,
  decisions: SourceDecision[],
  result: SalesReportResult,
): BillCountBridge | null {
  const proofs = decisions.filter(
    (d): d is Extract<SourceDecision, { action: 'RECONCILE_BILL_COUNT' }> =>
      d.action === 'RECONCILE_BILL_COUNT' && d.fileSha256 === fileSha256,
  );
  const { reported, detail, delta } = result.gross;
  if (
    proofs.length !== 1 ||
    !reported ||
    !detail ||
    !delta ||
    result.issues.some((i) => i.code !== 'SALES_SUMMARY_MISMATCH') ||
    delta.bills === null ||
    delta.bills <= 0 ||
    Object.entries(delta).some(
      ([k, v]) => k !== 'bills' && (v === null || !new Prisma.Decimal(v).isZero()),
    )
  )
    return null;
  const proof = proofs[0];
  if (
    !proof.reason.trim() ||
    !proof.evidenceRef.trim() ||
    proof.reportedBills !== reported.bills ||
    proof.distinctDetailBills !== detail.bills ||
    result.rows.length !== detail.lines
  )
    return null;
  const sections = collectSections(rows);
  const zeroRows: number[] = [],
    repeatedRows: number[] = [];
  const events = new Map<string, { row: number; order: string }>();
  const counts = new Map<string, number>();
  let headerCount = 0,
    matchedLines = 0;
  for (const [index, section] of sections.entries()) {
    const payment = payments[section.label];
    if (!payment) continue;
    const headings = rows[section.headerIndex].map((c) => c.trim());
    const required = ['คำสั่งซื้อ', 'รายการขาย', 'วันที่ขายสินค้า', ...Object.values(amounts)];
    if (required.some((c) => headings.filter((h) => h === c).length !== 1)) return null;
    let sectionCount = 0;
    for (
      let i = section.headerIndex + 1;
      i < (sections[index + 1]?.startIndex ?? rows.length);
      i++
    ) {
      if (rows[i].every((c) => !c.trim())) continue;
      const get = (name: string) => (rows[i][headings.indexOf(name)] ?? '').trim();
      const order = get('คำสั่งซื้อ'),
        timestamp = sourceTimestamp(get('วันที่ขายสินค้า'));
      const rawQuantity = get('รายการขาย').replace(/,/g, '');
      if (!order || !timestamp || !/^\d+$/.test(rawQuantity)) return null;
      const quantity = Number(rawQuantity);
      if (!Number.isSafeInteger(quantity)) return null;
      const key = JSON.stringify([payment, order, timestamp]);
      if (events.has(key)) return null;
      events.set(key, { row: i + 1, order });
      const lines = result.rows.filter(
        (l) =>
          l.orderNumber === order &&
          l.paymentType === payment &&
          l.soldAt.toISOString() === new Date(timestamp).toISOString(),
      );
      if (lines.length !== quantity) return null;
      for (const [field, column] of Object.entries(amounts)) {
        const raw = get(column).replace(/,/g, '');
        if (!/^-?\d+(?:\.\d{1,2})?$/.test(raw)) return null;
        const total = lines.reduce(
          (sum, l) => sum.plus(l[field as keyof typeof amounts]),
          new Prisma.Decimal(0),
        );
        if (!total.equals(raw)) return null;
      }
      if (quantity === 0) zeroRows.push(i + 1);
      else counts.set(order, (counts.get(order) ?? 0) + 1);
      matchedLines += quantity;
      sectionCount++;
    }
    if (sectionCount !== section.declaredRowCount) return null;
    headerCount += sectionCount;
  }
  for (const event of events.values())
    if (!zeroRows.includes(event.row) && (counts.get(event.order) ?? 0) > 1)
      repeatedRows.push(event.row);
  const extra = zeroRows.length + [...counts.values()].reduce((sum, n) => sum + n - 1, 0);
  if (
    headerCount !== reported.bills ||
    matchedLines !== detail.lines ||
    extra !== delta.bills ||
    counts.size !== detail.bills ||
    !equalRows(proof.zeroLineHeaderRows, zeroRows) ||
    !equalRows(proof.repeatedEventHeaderRows, repeatedRows) ||
    !equalRows(proof.sourceRows, [...zeroRows, ...repeatedRows])
  )
    return null;
  return {
    fileSha256,
    reportedBills: proof.reportedBills,
    distinctDetailBills: proof.distinctDetailBills,
    zeroLineHeaderRows: zeroRows,
    repeatedEventHeaderRows: repeatedRows,
  };
}
