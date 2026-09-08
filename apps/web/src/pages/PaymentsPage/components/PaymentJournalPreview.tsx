import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatNumberDecimal } from '@/utils/formatters';
import { AccrualModeChip } from './AccrualModeChip';

interface JePreviewLine {
  accountCode: string;
  accountName: string;
  debit: string;
  credit: string;
  description: string;
  block?: '2A' | '2B';
  posted?: boolean;
}

interface BlockSubtotal {
  debit: string;
  credit: string;
  balanced: boolean;
}

export interface JePreview {
  lines: JePreviewLine[];
  /** Already-posted 2A accrual context (present only in 2B_ONLY mode). */
  accrual2A?: { lines: JePreviewLine[]; subtotal: BlockSubtotal };
  /** Per-block Dr/Cr subtotals + balance flag. */
  subtotals?: { '2A'?: BlockSubtotal; '2B': BlockSubtotal };
  totalDebit: string;
  totalCredit: string;
  isBalanced: boolean;
  rescheduleFeeDisplay?: string;
  accrualMode?: '2B_ONLY' | 'CONSOLIDATED_PAYING_AHEAD' | 'CONSOLIDATED_BACKFILL';
  dueDate?: string;
}

// ─── JE Preview panel (always visible) ────────────────────────────────────────

/** One JE block (2A or 2B) — line rows + a per-block "Dr = Cr =" footer. */
function JeBlock({
  title,
  posted,
  lines,
  subtotal,
}: {
  title: string;
  posted?: boolean;
  lines: JePreviewLine[];
  subtotal?: BlockSubtotal;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border p-2',
        posted ? 'border-border/60 bg-muted/40' : 'border-border bg-background',
      )}
    >
      <div className="flex items-center justify-between mb-1.5">
        <h4 className="text-xs font-semibold text-foreground leading-snug">{title}</h4>
        {posted && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground text-[10px] font-medium leading-snug">
            โพสต์แล้ว
          </span>
        )}
      </div>
      <div className="space-y-1">
        <div className="grid grid-cols-[52px_1fr_64px_64px] gap-1 text-[11px] text-muted-foreground font-medium pb-1 border-b border-border/60">
          <span className="leading-snug">รหัส</span>
          <span className="leading-snug">บัญชี</span>
          <span className="text-right leading-snug">Dr</span>
          <span className="text-right leading-snug">Cr</span>
        </div>
        {lines.map((line, idx) => (
          <div key={idx} className="grid grid-cols-[52px_1fr_64px_64px] gap-1 text-xs">
            <span className="font-mono text-muted-foreground leading-snug">{line.accountCode}</span>
            <div className="min-w-0">
              <span className="leading-snug text-foreground truncate block">
                {line.accountName}
              </span>
              {line.description && (
                <span className="leading-snug text-muted-foreground/70 text-[10px]">
                  {line.description}
                </span>
              )}
            </div>
            <span className="text-right font-mono leading-snug text-foreground">
              {parseFloat(line.debit) > 0 ? formatNumberDecimal(line.debit) : ''}
            </span>
            <span className="text-right font-mono leading-snug text-foreground">
              {parseFloat(line.credit) > 0 ? formatNumberDecimal(line.credit) : ''}
            </span>
          </div>
        ))}
      </div>
      {subtotal && (
        <div
          className={cn(
            'flex items-center justify-between mt-2 pt-1.5 border-t text-[11px] font-medium',
            subtotal.balanced
              ? 'border-success/30 text-success'
              : 'border-destructive/30 text-destructive',
          )}
        >
          <div className="flex items-center gap-1 leading-snug">
            {subtotal.balanced ? (
              <CheckCircle2 className="size-3" />
            ) : (
              <AlertCircle className="size-3" />
            )}
            <span>Dr = Cr</span>
          </div>
          <span className="font-mono leading-snug">
            {formatNumberDecimal(subtotal.debit)} = {formatNumberDecimal(subtotal.credit)}
          </span>
        </div>
      )}
    </div>
  );
}

export function JePreviewPanel({
  preview,
  isLoading,
  errorMessage,
}: {
  preview: JePreview | undefined;
  isLoading: boolean;
  errorMessage?: string;
}) {
  const has2A = !!preview?.accrual2A && preview.accrual2A.lines.length > 0;
  const consolidated =
    !!preview &&
    !has2A &&
    (preview.accrualMode === 'CONSOLIDATED_PAYING_AHEAD' ||
      preview.accrualMode === 'CONSOLIDATED_BACKFILL');
  // 2B subtotal: prefer the server's per-block value; fall back to overall totals.
  const sub2B: BlockSubtotal | undefined = preview
    ? (preview.subtotals?.['2B'] ?? {
        debit: preview.totalDebit,
        credit: preview.totalCredit,
        balanced: preview.isBalanced,
      })
    : undefined;
  const label2B = has2A
    ? '2B — รับเงิน + อนุโลม'
    : consolidated
      ? '2A + 2B — โพสต์รวมตอนนี้'
      : '2B — รับเงิน';

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-foreground leading-snug">รายการบัญชี</h3>
        <span
          className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium leading-snug',
            preview && !preview.isBalanced
              ? 'bg-destructive/10 text-destructive'
              : 'bg-primary/10 text-primary',
          )}
        >
          <CheckCircle2 className="size-3" />
          {preview && !preview.isBalanced ? 'UNBALANCED' : 'BALANCED'}
        </span>
      </div>

      {preview?.accrualMode && (
        <AccrualModeChip mode={preview.accrualMode} dueDate={preview.dueDate} />
      )}

      {errorMessage && !isLoading && (
        <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-xs leading-snug flex gap-2 text-destructive">
          <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <div className="font-medium">ไม่สามารถสร้าง JE preview ได้</div>
            <div className="text-[11px] opacity-90">{errorMessage}</div>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="flex items-center gap-2 py-4 text-muted-foreground text-sm">
          <Loader2 className="size-4 animate-spin" />
          <span className="leading-snug">กำลังคำนวณ...</span>
        </div>
      )}

      {!isLoading && !preview && !errorMessage && (
        <p className="text-xs text-muted-foreground leading-snug py-2">
          กรอกยอดรับเพื่อดู JE preview
        </p>
      )}

      {!isLoading && preview && (
        <div className="space-y-2">
          {has2A && (
            <JeBlock
              title="2A — ถึงกำหนดงวด (ACCRUAL)"
              posted
              lines={preview.accrual2A!.lines}
              subtotal={preview.subtotals?.['2A'] ?? preview.accrual2A!.subtotal}
            />
          )}
          <JeBlock title={label2B} lines={preview.lines} subtotal={sub2B} />
          {consolidated && (
            <p className="text-[11px] text-muted-foreground leading-snug">
              * งวดนี้ยังไม่ได้ตั้งค้าง (accrual) — ระบบจะโพสต์ 2A + 2B รวมกันตอนบันทึก
            </p>
          )}
        </div>
      )}
    </div>
  );
}
