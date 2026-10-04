import type { DailySheet } from '@/lib/otherIncome.types';

interface DailySheetSummaryTableProps {
  title: string;
  rows: DailySheet['byAccount'];
}

export function DailySheetSummaryTable({ title, rows }: DailySheetSummaryTableProps) {
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <h3 className="p-3 font-bold border-b text-sm">{title}</h3>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-muted-foreground text-xs">ไม่มีข้อมูล</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                รหัสบัญชี
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                ชื่อบัญชี
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                รายการ
              </th>
              <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                ยอดรวม
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.code} className="border-t">
                <td className="px-3 py-2 font-mono text-xs font-semibold">{r.code}</td>
                <td className="px-3 py-2 text-xs leading-snug">{r.name}</td>
                <td className="px-3 py-2 text-right text-xs text-muted-foreground">{r.count}</td>
                <td className="px-3 py-2 text-right font-mono font-bold">
                  {Number(r.total).toFixed(2)} ฿
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
