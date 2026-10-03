import { formatNumberDecimal } from '@/utils/formatters';

interface JournalPreview {
  lines: {
    accountCode: string;
    accountName: string;
    description: string;
    debit: string;
    credit: string;
  }[];
  totalDebit: string;
  totalCredit: string;
  isBalanced: boolean;
}

export function JournalPreviewTable({ preview }: { preview: JournalPreview }) {
  return (
    <>
      <div className="space-y-1">
        <div className="grid grid-cols-[80px_1fr_90px_90px] gap-1 text-xs text-muted-foreground font-medium pb-1 border-b border-border">
          <span>รหัส</span>
          <span>บัญชี</span>
          <span className="text-right">Dr</span>
          <span className="text-right">Cr</span>
        </div>
        {preview.lines.map((line, idx) => (
          <div key={idx} className="grid grid-cols-[80px_1fr_90px_90px] gap-1 text-xs leading-snug">
            <span className="font-mono text-muted-foreground">{line.accountCode}</span>
            <div className="min-w-0">
              <span className="text-foreground truncate block">{line.accountName}</span>
              <span className="text-muted-foreground/70 text-[10px]">{line.description}</span>
            </div>
            <span className="text-right font-mono text-foreground">
              {parseFloat(line.debit) > 0 ? formatNumberDecimal(line.debit) : ''}
            </span>
            <span className="text-right font-mono text-foreground">
              {parseFloat(line.credit) > 0 ? formatNumberDecimal(line.credit) : ''}
            </span>
          </div>
        ))}
      </div>
      <div
        className={`flex items-center justify-between mt-3 pt-2 border-t text-xs font-medium ${
          preview.isBalanced
            ? 'border-success/30 text-success'
            : 'border-destructive/30 text-destructive'
        }`}
      >
        <span>Dr รวม = Cr รวม</span>
        <span className="font-mono">
          {formatNumberDecimal(preview.totalDebit)} = {formatNumberDecimal(preview.totalCredit)}{' '}
          {preview.isBalanced ? 'BALANCED' : 'UNBALANCED'}
        </span>
      </div>
    </>
  );
}
