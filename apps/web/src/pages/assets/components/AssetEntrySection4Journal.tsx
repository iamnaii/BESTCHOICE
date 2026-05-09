import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatNumberDecimal } from '@/utils/formatters';
import type { CalculationResult } from '../hooks/useAssetCalculation';

const fmt = (n: number | string | null | undefined) =>
  n == null ? '-' : formatNumberDecimal(Number(n));

export function AssetEntrySection4Journal({ calc }: { calc: CalculationResult }) {
  const totalDr = calc.journalLines.reduce((s, l) => s + l.debit, 0);
  const totalCr = calc.journalLines.reduce((s, l) => s + l.credit, 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>4. รายการบัญชี (Auto JE Preview)</CardTitle>
        <Badge variant={calc.isBalanced ? 'success' : 'destructive'}>
          {calc.isBalanced ? '✓ สมดุล' : '✗ ไม่สมดุล'}
        </Badge>
      </CardHeader>
      <CardContent>
        {calc.journalLines.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            กรอกข้อมูลใน Section 2 เพื่อดู preview
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 px-2">รหัสบัญชี</th>
                <th className="text-left py-2 px-2">ชื่อบัญชี</th>
                <th className="text-right py-2 px-2">Debit</th>
                <th className="text-right py-2 px-2">Credit</th>
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
