import { useMemo } from 'react';
import { Trash2, Plus, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export type EditableJournalLine = {
  accountCode: string;
  debit: number;
  credit: number;
  description?: string;
};

type Props = {
  lines: EditableJournalLine[];
  onChange: (next: EditableJournalLine[]) => void;
};

type ValidationIssue = { rule: 'V1' | 'V2' | 'V5'; msg: string };

function validateClientSide(lines: EditableJournalLine[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (lines.length < 2) {
    issues.push({ rule: 'V2', msg: 'ต้องมีอย่างน้อย 2 บรรทัด' });
  }

  for (const line of lines) {
    const hasDr = line.debit > 0;
    const hasCr = line.credit > 0;
    if (hasDr && hasCr) {
      issues.push({ rule: 'V5', msg: `บรรทัด ${line.accountCode || '(ไม่ระบุ)'} มีทั้ง Dr และ Cr` });
    } else if (!hasDr && !hasCr) {
      issues.push({ rule: 'V5', msg: `บรรทัด ${line.accountCode || '(ไม่ระบุ)'} ไม่มีทั้ง Dr และ Cr` });
    }
  }

  const drTotal = lines.reduce((s, l) => s + (l.debit || 0), 0);
  const crTotal = lines.reduce((s, l) => s + (l.credit || 0), 0);
  if (Math.abs(drTotal - crTotal) > 0.01) {
    issues.push({
      rule: 'V1',
      msg: `Dr (${drTotal.toFixed(2)}) ≠ Cr (${crTotal.toFixed(2)}) — ผลต่าง ${(drTotal - crTotal).toFixed(2)} บาท`,
    });
  }

  return issues;
}

export function EditableJournalTable({ lines, onChange }: Props) {
  const issues = useMemo(() => validateClientSide(lines), [lines]);
  const drTotal = lines.reduce((s, l) => s + (l.debit || 0), 0);
  const crTotal = lines.reduce((s, l) => s + (l.credit || 0), 0);

  const updateLine = (idx: number, patch: Partial<EditableJournalLine>) => {
    onChange(lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };
  const deleteLine = (idx: number) => onChange(lines.filter((_, i) => i !== idx));
  const addLine = () => onChange([...lines, { accountCode: '', debit: 0, credit: 0 }]);

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="px-2 py-2 text-left">รหัสบัญชี</th>
              <th className="px-2 py-2 text-right">Dr</th>
              <th className="px-2 py-2 text-right">Cr</th>
              <th className="px-2 py-2 text-left">หมายเหตุ</th>
              <th className="px-2 py-2 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, idx) => (
              <tr key={idx} className="border-t border-border">
                <td className="px-2 py-1">
                  <Input
                    value={line.accountCode}
                    onChange={(e) => updateLine(idx, { accountCode: e.target.value })}
                    placeholder="42-1102"
                    className="font-mono"
                  />
                </td>
                <td className="px-2 py-1">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={line.debit || ''}
                    onChange={(e) => updateLine(idx, { debit: Number(e.target.value) || 0, credit: 0 })}
                    className="text-right font-mono"
                  />
                </td>
                <td className="px-2 py-1">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={line.credit || ''}
                    onChange={(e) => updateLine(idx, { credit: Number(e.target.value) || 0, debit: 0 })}
                    className="text-right font-mono"
                  />
                </td>
                <td className="px-2 py-1">
                  <Input
                    value={line.description ?? ''}
                    onChange={(e) => updateLine(idx, { description: e.target.value })}
                  />
                </td>
                <td className="px-2 py-1">
                  <Button variant="ghost" size="icon" onClick={() => deleteLine(idx)}>
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </td>
              </tr>
            ))}
            <tr className="border-t border-border bg-muted font-mono text-sm">
              <td className="px-2 py-2 font-semibold">รวม</td>
              <td className="px-2 py-2 text-right">{drTotal.toFixed(2)}</td>
              <td className="px-2 py-2 text-right">{crTotal.toFixed(2)}</td>
              <td colSpan={2}></td>
            </tr>
          </tbody>
        </table>
      </div>

      <Button variant="outline" size="sm" onClick={addLine}>
        <Plus className="w-4 h-4 mr-1" /> เพิ่มบรรทัด
      </Button>

      {issues.length > 0 && (
        <div className="rounded border border-destructive bg-destructive/10 p-3 space-y-1">
          {issues.map((iss, i) => (
            <div key={i} className="text-sm text-destructive flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>
                <strong>{iss.rule}:</strong> {iss.msg}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function getJournalIssues(lines: EditableJournalLine[]) {
  return validateClientSide(lines);
}
