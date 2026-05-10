import { Check, AlertTriangle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { JePreviewResponse } from './types';
import { formatNumberDecimal } from '@/utils/formatters';

interface Props {
  preview: JePreviewResponse | null;
  loading: boolean;
  error: string | null;
}

export function JePreview({ preview, loading, error }: Props) {
  if (loading && !preview) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-6 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> กำลังคำนวณ JE...
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        ไม่สามารถคำนวณ JE: {error}
      </div>
    );
  }
  if (!preview) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/50 p-6 text-center text-sm text-muted-foreground">
        กรอกรายการบัญชีอย่างน้อย 1 บรรทัดเพื่อดู JE Preview
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-3 py-2 text-left font-medium">บัญชี</th>
            <th className="px-3 py-2 text-left font-medium">ชื่อบัญชี</th>
            <th className="px-3 py-2 text-right font-medium">DR</th>
            <th className="px-3 py-2 text-right font-medium">CR</th>
          </tr>
        </thead>
        <tbody>
          {preview.lines.map((l, idx) => (
            <tr key={idx} className="border-t border-border">
              <td className="px-3 py-2 font-mono text-xs">{l.accountCode}</td>
              <td className="px-3 py-2">
                <div>{l.accountName}</div>
                <div className="text-xs text-muted-foreground">{l.description}</div>
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {l.dr === '0.00' ? '' : formatNumberDecimal(l.dr)}
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {l.cr === '0.00' ? '' : formatNumberDecimal(l.cr)}
              </td>
            </tr>
          ))}
          <tr
            className={cn(
              'border-t-2',
              preview.totals.balanced
                ? 'border-success bg-success/5'
                : 'border-destructive bg-destructive/5',
            )}
          >
            <td colSpan={2} className="px-3 py-2 font-medium">
              <div className="flex items-center gap-2">
                {preview.totals.balanced ? (
                  <Check className="size-4 text-success" />
                ) : (
                  <AlertTriangle className="size-4 text-destructive" />
                )}
                {preview.totals.balanced ? 'BALANCED' : 'UNBALANCED'}
              </div>
            </td>
            <td className="px-3 py-2 text-right font-mono font-semibold">
              {formatNumberDecimal(preview.totals.drSum)}
            </td>
            <td className="px-3 py-2 text-right font-mono font-semibold">
              {formatNumberDecimal(preview.totals.crSum)}
            </td>
          </tr>
        </tbody>
      </table>
      <div className="grid grid-cols-4 gap-2 bg-muted/30 p-3 text-xs">
        <SummaryCard label="ค่าใช้จ่าย" value={preview.totals.subtotal} />
        <SummaryCard label="VAT ซื้อ" value={preview.totals.vatAmount} />
        <SummaryCard label="WHT" value={preview.totals.withholdingTax} />
        <SummaryCard label="สุทธิจ่าย" value={preview.totals.netPayment} highlight />
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className={cn('rounded-lg p-2', highlight ? 'bg-primary/10' : 'bg-card')}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn('font-mono text-sm font-semibold', highlight && 'text-primary')}>
        {formatNumberDecimal(value)}
      </div>
    </div>
  );
}
