import { useMemo, useState } from 'react';
import { Trophy, ArrowUp, ArrowDown, Download } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import QueryBoundary from '@/components/QueryBoundary';
import { useLeaderboard, type LeaderboardRow } from '../hooks/useLeaderboard';

type SortKey =
  | 'name'
  | 'assignedCount'
  | 'promiseKeptPercent'
  | 'avgDaysToFirstContact'
  | 'recoveryThisMonth';

const COLUMNS: { key: SortKey; label: string; align: 'left' | 'right' }[] = [
  { key: 'name', label: 'พนักงาน', align: 'left' },
  { key: 'assignedCount', label: 'มอบหมาย', align: 'right' },
  { key: 'promiseKeptPercent', label: '% ตามนัด', align: 'right' },
  { key: 'avgDaysToFirstContact', label: 'เฉลี่ย (วัน) ติดต่อแรก', align: 'right' },
  { key: 'recoveryThisMonth', label: 'เก็บได้ (เดือนนี้)', align: 'right' },
];

const TROPHY_COLOR = ['text-amber-500', 'text-zinc-400', 'text-amber-700'];

function formatBaht(n: number): string {
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 }).format(n);
}

function downloadCsv(rows: LeaderboardRow[]): void {
  const header = [
    'อันดับ',
    'รหัสพนักงาน',
    'ชื่อ',
    'มอบหมาย (สัญญา)',
    '% ตามนัด',
    'เฉลี่ยวันติดต่อแรก',
    'เก็บได้เดือนนี้ (บาท)',
  ];
  const lines = [header.join(',')];
  rows.forEach((r, idx) => {
    const cells = [
      String(idx + 1),
      r.collectorId,
      `"${r.name.replace(/"/g, '""')}"`,
      String(r.assignedCount),
      String(r.promiseKeptPercent),
      String(r.avgDaysToFirstContact),
      String(r.recoveryThisMonth),
    ];
    lines.push(cells.join(','));
  });
  // BOM for Excel UTF-8 detection
  const bom = '﻿';
  const blob = new Blob([bom + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const ts = new Date().toISOString().slice(0, 10);
  a.download = `collector-leaderboard-${ts}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function LeaderboardTable() {
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'recoveryThisMonth',
    dir: 'desc',
  });
  const { data = [], isLoading, isError, error, refetch } = useLeaderboard();

  const sorted = useMemo(() => {
    const arr = [...data];
    arr.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (typeof av === 'number' && typeof bv === 'number') {
        return sort.dir === 'asc' ? av - bv : bv - av;
      }
      return sort.dir === 'asc'
        ? String(av).localeCompare(String(bv), 'th')
        : String(bv).localeCompare(String(av), 'th');
    });
    return arr;
  }, [data, sort]);

  const toggleSort = (key: SortKey) => {
    setSort((cur) =>
      cur.key === key
        ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'name' ? 'asc' : 'desc' },
    );
  };

  return (
    <Card className="lg:col-span-2">
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-sm font-semibold mb-0.5 leading-snug">
              อันดับผู้ติดตามหนี้
            </div>
            <div className="text-xs text-muted-foreground leading-snug">
              เรียงตามยอดเก็บได้เดือนนี้
            </div>
          </div>
          <button
            onClick={() => downloadCsv(sorted)}
            disabled={sorted.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-input hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Download className="size-3.5" />
            ดาวน์โหลด CSV
          </button>
        </div>

        <QueryBoundary
          isLoading={isLoading}
          isError={isError}
          error={error}
          onRetry={refetch}
          errorTitle="ไม่สามารถโหลดอันดับผู้ติดตามได้"
        >
          {sorted.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground italic leading-snug">
              ยังไม่มีข้อมูล
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="text-left py-2 px-2 w-10 font-medium">#</th>
                    {COLUMNS.map((c) => (
                      <th
                        key={c.key}
                        className={`py-2 px-2 font-medium cursor-pointer select-none hover:text-foreground ${
                          c.align === 'right' ? 'text-right' : 'text-left'
                        }`}
                        onClick={() => toggleSort(c.key)}
                      >
                        <span className="inline-flex items-center gap-1">
                          {c.label}
                          {sort.key === c.key &&
                            (sort.dir === 'asc' ? (
                              <ArrowUp className="size-3" />
                            ) : (
                              <ArrowDown className="size-3" />
                            ))}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((row, idx) => (
                    <tr key={row.collectorId} className="border-b border-border/60">
                      <td className="py-2 px-2 tabular-nums">
                        {idx < 3 ? (
                          <Trophy className={`size-4 ${TROPHY_COLOR[idx]}`} />
                        ) : (
                          <span className="text-muted-foreground">{idx + 1}</span>
                        )}
                      </td>
                      <td className="py-2 px-2 font-medium leading-snug">{row.name}</td>
                      <td className="py-2 px-2 text-right tabular-nums">
                        {row.assignedCount}
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums">
                        {row.promiseKeptPercent.toFixed(1)}%
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums">
                        {row.avgDaysToFirstContact.toFixed(1)}
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums font-medium">
                        {formatBaht(row.recoveryThisMonth)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </QueryBoundary>
      </CardContent>
    </Card>
  );
}
