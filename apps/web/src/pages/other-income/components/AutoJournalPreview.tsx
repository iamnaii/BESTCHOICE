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

  return (
    <div className="rounded-lg border p-3 bg-card">
      <p className="text-sm font-bold mb-2">JOURNAL PREVIEW (Auto)</p>
      {lines.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">— ยังไม่มี —</p>
      ) : (
        <div className="font-mono text-xs space-y-1">
          {lines.map((l, idx) => {
            const isDr = l.debit > 0;
            return (
              <div
                key={idx}
                className="flex items-baseline gap-2 px-2 py-1 hover:bg-accent rounded"
              >
                <span className={`font-bold w-6 ${isDr ? 'text-cyan-600' : 'text-purple-600'}`}>
                  {isDr ? 'Dr' : 'Cr'}
                </span>
                <span className={`font-bold w-20 ${isDr ? 'text-cyan-600' : 'text-purple-600'}`}>
                  {l.accountCode}
                </span>
                <span className="font-bold w-28 text-right">
                  {(isDr ? l.debit : l.credit).toFixed(2)}
                </span>
                {l.description && (
                  <span className="flex-1 text-muted-foreground truncate">({l.description})</span>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-2 pt-2 border-t flex items-center justify-between text-sm">
        <span className="text-muted-foreground text-xs">Dr รวม = Cr รวม</span>
        {balanced ? (
          <span className="text-green-600 font-bold font-mono">
            ✓ {totalDr.toFixed(2)} = {totalCr.toFixed(2)} BALANCED
          </span>
        ) : (
          <span className="text-destructive font-bold font-mono">
            ✗ Dr {totalDr.toFixed(2)} ≠ Cr {totalCr.toFixed(2)}
          </span>
        )}
      </div>
    </div>
  );
}
