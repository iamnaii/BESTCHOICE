import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Check, AlertTriangle } from 'lucide-react';
import { formatNumberDecimal } from '@/utils/formatters';
import type { CalculationResult } from '../hooks/useAssetCalculation';
import { AssetSectionHeader } from './AssetSectionHeader';

const fmt = (n: number | string | null | undefined) =>
  n == null ? '-' : formatNumberDecimal(Number(n));

export function AssetEntrySection4Journal({ calc }: { calc: CalculationResult }) {
  const totalDr = calc.journalLines.reduce((s, l) => s + l.debit, 0);
  const totalCr = calc.journalLines.reduce((s, l) => s + l.credit, 0);
  const hasLines = calc.journalLines.length > 0;

  return (
    <Card>
      <AssetSectionHeader
        number={4}
        title="AUTO JOURNAL PREVIEW"
        action={
          hasLines ? (
            <Badge variant={calc.isBalanced ? 'success' : 'destructive'}>
              {calc.isBalanced ? (
                <>
                  <Check className="size-3" />
                  สมดุล
                </>
              ) : (
                <>
                  <AlertTriangle className="size-3" />
                  ไม่สมดุล
                </>
              )}
            </Badge>
          ) : null
        }
      />
      <CardContent>
        {!hasLines ? (
          <div className="rounded-lg border border-dashed border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
            กรอกข้อมูลให้ครบเพื่อดู Auto Journal Preview
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="text-left py-2 px-2 font-medium">บัญชี</th>
                <th className="text-left py-2 px-2 font-medium">ชื่อบัญชี</th>
                <th className="text-right py-2 px-2 font-medium text-primary">DR (฿)</th>
                <th className="text-right py-2 px-2 font-medium text-primary">CR (฿)</th>
              </tr>
            </thead>
            <tbody>
              {calc.journalLines.map((line, idx) => (
                <tr key={idx} className="border-b">
                  <td className="py-2 px-2 font-mono">{line.accountCode}</td>
                  <td className="py-2 px-2">{line.accountName}</td>
                  <td className="py-2 px-2 text-right tabular-nums">
                    {line.debit > 0 ? fmt(line.debit) : '-'}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">
                    {line.credit > 0 ? fmt(line.credit) : '-'}
                  </td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="py-2 px-2" colSpan={2}>
                  รวม
                </td>
                <td className="py-2 px-2 text-right tabular-nums">{fmt(totalDr)}</td>
                <td className="py-2 px-2 text-right tabular-nums">{fmt(totalCr)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
