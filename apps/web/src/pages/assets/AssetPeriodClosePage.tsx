// ปิดงวดสินทรัพย์ — read-only checklist per month combining:
//   1. depreciation run status (GET /depreciation — POSTED/REVERSED per period)
//   2. FINANCE accounting-period status (GET /expenses/periods/overview)
// The actual close action lives in /monthly-close (accounting-wide); this tab
// answers "ค่าเสื่อมเดือนนี้ลงครบหรือยัง ก่อนไปปิดงวดบัญชี" without inventing a
// separate asset-side close flow.

import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Lock, ArrowRight, CheckCircle2, AlertTriangle, Minus } from 'lucide-react';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatNumberDecimal } from '@/utils/formatters';
import { THAI_MONTHS_FULL } from '@/lib/date';
import { depreciationApi } from '@/pages/depreciation/api';
import AssetHubTabs from './components/AssetHubTabs';

type PeriodStatus = 'OPEN' | 'REVIEW' | 'CLOSED' | 'SYNCED';

interface Company {
  id: string;
  companyCode: string;
  companyName: string;
}

interface PeriodRow {
  month: number;
  status: PeriodStatus;
}

const PERIOD_STATUS_LABEL: Record<PeriodStatus, string> = {
  OPEN: 'เปิดอยู่',
  REVIEW: 'กำลังตรวจ',
  CLOSED: 'ปิดแล้ว',
  SYNCED: 'ปิด + ส่ง PEAK แล้ว',
};

const PERIOD_STATUS_CLASS: Record<PeriodStatus, string> = {
  OPEN: 'bg-muted text-muted-foreground',
  REVIEW: 'bg-warning/15 text-warning',
  CLOSED: 'bg-success/15 text-success',
  SYNCED: 'bg-primary/15 text-primary',
};

function bkkNow(): Date {
  return new Date(Date.now() + 7 * 60 * 60 * 1000);
}

export default function AssetPeriodClosePage() {
  const currentYear = bkkNow().getUTCFullYear();
  const currentMonth = bkkNow().getUTCMonth() + 1;
  const [year, setYear] = useState(currentYear);
  // Accounting starts 2026 (Phase A.4 wipe) — no periods exist before that
  const firstYear = Math.min(2026, currentYear);
  const yearOptions = Array.from({ length: currentYear - firstYear + 1 }, (_, i) => firstYear + i);

  const companiesQuery = useQuery<Company[]>({
    queryKey: ['companies'],
    queryFn: async () => (await api.get('/companies')).data,
  });
  const financeId =
    companiesQuery.data?.find((c) => c.companyCode === 'FINANCE')?.id ??
    companiesQuery.data?.[0]?.id;

  // Same queryKey as PeriodClosePage — closing/reopening a period there
  // invalidates this checklist too (one cache entry per company+year)
  const periodsQuery = useQuery<PeriodRow[]>({
    queryKey: ['accounting-periods', financeId, year],
    queryFn: async () =>
      (await api.get('/expenses/periods/overview', { params: { companyId: financeId, year } }))
        .data,
    enabled: Boolean(financeId),
  });

  // Same queryKey as DepreciationPage — run/reverse there busts this list
  const runsQuery = useQuery({
    queryKey: ['depreciation-runs'],
    queryFn: depreciationApi.list,
  });

  const runByPeriod = new Map((runsQuery.data ?? []).map((r) => [r.period, r]));

  // periodsQuery is disabled until financeId resolves — treat that gap as
  // loading so the boundary never flashes blank between the two fetches
  const isLoading =
    companiesQuery.isLoading ||
    runsQuery.isLoading ||
    (Boolean(financeId) && !periodsQuery.data && !periodsQuery.isError);
  const isError = companiesQuery.isError || periodsQuery.isError || runsQuery.isError;

  return (
    <div className="space-y-5">
      <AssetHubTabs />

      <PageHeader
        title="ปิดงวดสินทรัพย์"
        subtitle="เช็คว่าค่าเสื่อมแต่ละเดือนลงบัญชีครบก่อนปิดงวด — การปิดงวดจริงทำที่หน้าปิดงวดบัญชี"
        icon={<Lock className="size-5" />}
        action={
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {yearOptions.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y + 543}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      <QueryBoundary
        isLoading={isLoading}
        isError={isError}
        onRetry={() => {
          companiesQuery.refetch();
          periodsQuery.refetch();
          runsQuery.refetch();
        }}
        errorTitle="โหลดสถานะงวดไม่สำเร็จ"
      >
        {periodsQuery.data && (
          <Card>
            <CardContent className="pt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b border-border">
                    <th className="py-2 pr-3 font-medium">งวด</th>
                    <th className="py-2 pr-3 font-medium">ค่าเสื่อมราคา</th>
                    <th className="py-2 pr-3 font-medium text-right">ยอด (บาท)</th>
                    <th className="py-2 pr-3 font-medium">สถานะงวดบัญชี (FINANCE)</th>
                    <th className="py-2 font-medium" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {periodsQuery.data.map((p) => {
                    const periodKey = `${year}-${String(p.month).padStart(2, '0')}`;
                    const run = runByPeriod.get(periodKey);
                    const isFuture =
                      year > currentYear || (year === currentYear && p.month > currentMonth);
                    const isCurrent = year === currentYear && p.month === currentMonth;

                    return (
                      <tr key={p.month} className="align-middle">
                        <td className="py-2.5 pr-3 whitespace-nowrap leading-snug">
                          {THAI_MONTHS_FULL[p.month - 1]} {year + 543}
                          {isCurrent && (
                            <Badge variant="outline" className="ml-2 text-[10px]">
                              เดือนนี้
                            </Badge>
                          )}
                        </td>
                        <td className="py-2.5 pr-3 whitespace-nowrap">
                          {isFuture ? (
                            <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
                              <Minus className="size-3.5" /> ยังไม่ถึงงวด
                            </span>
                          ) : run?.status === 'POSTED' ? (
                            <span className="inline-flex items-center gap-1 text-success text-xs font-medium">
                              <CheckCircle2 className="size-3.5" /> รันแล้ว ({run.assetCount}{' '}
                              สินทรัพย์)
                            </span>
                          ) : run?.status === 'REVERSED' ? (
                            <span className="inline-flex items-center gap-1 text-warning text-xs font-medium">
                              <AlertTriangle className="size-3.5" /> กลับรายการแล้ว
                            </span>
                          ) : isCurrent ? (
                            <span className="text-xs text-muted-foreground">
                              รออัตโนมัติสิ้นเดือน
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-destructive text-xs font-medium">
                              <AlertTriangle className="size-3.5" /> ยังไม่รัน
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 pr-3 text-right whitespace-nowrap">
                          {run?.status === 'POSTED'
                            ? formatNumberDecimal(Number(run.totalAmount), 2)
                            : '—'}
                        </td>
                        <td className="py-2.5 pr-3">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium leading-snug ${PERIOD_STATUS_CLASS[p.status] ?? PERIOD_STATUS_CLASS.OPEN}`}
                          >
                            {PERIOD_STATUS_LABEL[p.status] ?? p.status}
                          </span>
                        </td>
                        <td className="py-2.5 text-right whitespace-nowrap">
                          {!isFuture && !run && !isCurrent && (
                            <Button asChild size="sm" variant="outline">
                              <Link to="/assets/depreciation">ไปรันค่าเสื่อม</Link>
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="flex justify-end mt-4">
                <Link
                  to="/monthly-close"
                  className="flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  ไปหน้าปิดงวดบัญชี (ทุกระบบ) <ArrowRight className="size-3" />
                </Link>
              </div>
            </CardContent>
          </Card>
        )}
      </QueryBoundary>
    </div>
  );
}
