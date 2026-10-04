import { formatNumberDecimal } from '@/utils/formatters';

export interface JournalLine {
  accountCode: string;
  accountName: string;
  debit: string;
  credit: string;
}

/**
 * D1.2.5.2 — adjustment account codes that the OWNER may want to suppress
 * from the printed voucher (kept on-screen for the JE preview):
 *   - 52-1104 ส่วนลดเศษสตางค์ (≤1฿ rounding tolerance, underpay)
 *   - 53-1503 กำไร/ขาดทุนจากการปัดเศษ (overpay rounding)
 * Exported for unit testing.
 */
export const ADJUSTMENT_ACCOUNT_CODES = ['52-1104', '53-1503'] as const;
export function isAdjustmentLine(line: { accountCode: string }): boolean {
  return (ADJUSTMENT_ACCOUNT_CODES as readonly string[]).includes(line.accountCode);
}

export function VoucherJournalTable({
  lines,
  includeAdjustment,
}: {
  lines?: JournalLine[];
  includeAdjustment: boolean;
}) {
  return (
    <>
      {lines && lines.length > 0 && (
        <section className="mt-6">
          <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
            Auto Journal
          </p>
          <table className="w-full text-xs border border-border">
            <thead className="bg-muted/40">
              <tr>
                <th className="border border-border p-2 text-left">บัญชี</th>
                <th className="border border-border p-2 text-left">ชื่อบัญชี</th>
                <th className="border border-border p-2 text-right w-24">Dr (฿)</th>
                <th className="border border-border p-2 text-right w-24">Cr (฿)</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                // D1.2.5.2 — when includeAdjustment is false, keep the
                // adjustment rows on screen (for the JE preview) but hide
                // them on the printed paper.
                const hideOnPrint = !includeAdjustment && isAdjustmentLine(l);
                return (
                  <tr key={i} className={hideOnPrint ? 'print:hidden' : undefined}>
                    <td className="border border-border p-2 font-mono">{l.accountCode}</td>
                    <td className="border border-border p-2">{l.accountName}</td>
                    <td className="border border-border p-2 text-right tabular-nums">
                      {parseFloat(l.debit) > 0 ? formatNumberDecimal(l.debit) : '—'}
                    </td>
                    <td className="border border-border p-2 text-right tabular-nums">
                      {parseFloat(l.credit) > 0 ? formatNumberDecimal(l.credit) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
