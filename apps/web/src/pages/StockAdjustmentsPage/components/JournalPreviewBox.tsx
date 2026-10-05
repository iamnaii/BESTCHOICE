import type { AdjustmentPreview } from '../types';
import { BOOKED_SOURCE_LABEL, formatBaht, productStatusLabel } from '../stock-adjustment.util';

/** กล่อง "เมื่อเจ้าของอนุมัติ" — สถานะเครื่อง + รายการบัญชีที่จะลง (ใช้ทั้งฟอร์มคำขอและกล่องพิจารณา) */
export default function JournalPreviewBox({ preview, isLoading }: { preview: AdjustmentPreview | undefined; isLoading: boolean }) {
  if (isLoading) return <div className="text-xs text-muted-foreground leading-snug">กำลังคำนวณผลเมื่ออนุมัติ...</div>;
  if (!preview) return null;
  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2">
      <div className="text-xs font-semibold text-foreground leading-snug">เมื่อเจ้าของอนุมัติ</div>
      <div className="text-sm leading-snug">
        สถานะเครื่อง:{' '}
        <span className="font-medium">
          {preview.productStatusAfter ? productStatusLabel(preview.productStatusAfter) : 'ไม่เปลี่ยน'}
        </span>
      </div>
      {preview.booked && (
        <div className="text-xs text-muted-foreground leading-snug">
          {preview.booked.booked
            ? `ลงบัญชีรับเข้าแล้ว · ${BOOKED_SOURCE_LABEL[preview.booked.source ?? ''] ?? preview.booked.source}${
                preview.booked.journalEntryNo ? ` ${preview.booked.journalEntryNo}` : ''
              }${preview.booked.bookedAmount ? ` · ${formatBaht(preview.booked.bookedAmount)}` : ''}`
            : 'ยังไม่มีรายการบัญชีรับเข้าของเครื่องนี้'}
        </div>
      )}
      {preview.journalLines.length > 0 ? (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="text-left font-medium py-1">บัญชี</th>
              <th className="text-right font-medium py-1">เดบิต</th>
              <th className="text-right font-medium py-1">เครดิต</th>
            </tr>
          </thead>
          <tbody>
            {preview.journalLines.map((l) => (
              <tr key={`${l.accountCode}-${l.debit}-${l.credit}`} className="border-t border-border/60">
                <td className="py-1 leading-snug">
                  <span className="font-mono">{l.accountCode}</span> <span className="text-muted-foreground">{l.name}</span>
                </td>
                <td className="py-1 text-right font-mono tabular-nums">{Number(l.debit) > 0 ? formatBaht(l.debit) : ''}</td>
                <td className="py-1 text-right font-mono tabular-nums">{Number(l.credit) > 0 ? formatBaht(l.credit) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <div className="text-xs text-muted-foreground leading-snug">{preview.journalNote}</div>
    </div>
  );
}
