import { formatNumericText } from '@/utils/numericText';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useMemo } from 'react';
import { useCoaByCodes } from '@/hooks/useCoa';

interface JeLine {
  accountCode: string;
  debit: number;
  credit: number;
  description?: string;
}

interface Props {
  lines: JeLine[];
}

/**
 * Read-only Dr/Cr preview. Shows BALANCED badge at the bottom.
 * v1: no override mode (locked). Override moved to post-MVP.
 */
export function AutoJournalPreview({ lines }: Props) {
  const totalDr = lines.reduce((s, l) => s + l.debit, 0);
  const totalCr = lines.reduce((s, l) => s + l.credit, 0);
  const balanced = Math.abs(totalDr - totalCr) < 0.01;

  // Resolve account codes → names via CoA lookup. Hook is cached (staleTime: Infinity),
  // so subsequent renders with the same code set hit cache instantly.
  const uniqueCodes = useMemo(
    () => Array.from(new Set(lines.map((l) => l.accountCode).filter(Boolean))),
    [lines],
  );
  const { data: coaRows } = useCoaByCodes(uniqueCodes);
  const nameByCode = useMemo(() => {
    const map: Record<string, string> = {};
    for (const r of coaRows ?? []) map[r.code] = r.name;
    return map;
  }, [coaRows]);

  return (
    <div className="rounded-lg border p-3 bg-card">
      <p className="text-sm font-bold mb-2">รายการบัญชีอัตโนมัติ</p>
      {lines.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">— ยังไม่มี —</p>
      ) : (
        <div className="font-mono text-xs space-y-1">
          {lines.map((l, idx) => {
            const isDr = l.debit > 0;
            const accountName = nameByCode[l.accountCode];
            return (
              <div
                key={idx}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] sm:flex items-baseline gap-2 px-2 py-1 hover:bg-accent rounded"
              >
                <span className={`font-bold w-6 shrink-0 ${isDr ? 'text-info' : 'text-primary'}`}>
                  {isDr ? 'Dr' : 'Cr'}
                </span>
                <span className={`font-bold sm:w-20 shrink-0 ${isDr ? 'text-info' : 'text-primary'}`}>
                  {l.accountCode}
                </span>
                <span className="col-start-2 row-start-2 min-w-0 sm:flex-1 break-words text-foreground">
                  {accountName || <span className="text-muted-foreground">—</span>}
                </span>
                <span className="col-start-3 row-start-1 font-bold sm:w-28 text-right shrink-0">
                  {formatNumericText((isDr ? l.debit : l.credit).toFixed(2))}
                </span>
                {l.description && (
                  <span className="col-span-3 min-w-0 text-muted-foreground break-words sm:w-40 sm:text-right sm:shrink-0">
                    ({l.description})
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-2 pt-2 border-t flex flex-wrap gap-2 items-center justify-between text-sm">
        <span className="text-muted-foreground text-xs">Dr รวม = Cr รวม</span>
        {balanced ? (
          <span className="inline-flex flex-wrap items-center gap-1.5 text-success font-bold font-mono">
            <CheckCircle2 size={14} />
            {formatNumericText(totalDr.toFixed(2))} = {formatNumericText(totalCr.toFixed(2))} ยอดสมดุล
          </span>
        ) : (
          <span className="inline-flex flex-wrap items-center gap-1.5 text-destructive font-bold font-mono">
            <XCircle size={14} />
            Dr {formatNumericText(totalDr.toFixed(2))} ≠ Cr {formatNumericText(totalCr.toFixed(2))}
          </span>
        )}
      </div>
    </div>
  );
}
