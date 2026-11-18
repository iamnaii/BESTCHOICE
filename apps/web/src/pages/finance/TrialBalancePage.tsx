import { useId, useState, type KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Scale } from 'lucide-react';
import api from '@/lib/api';
import { NAV_LABELS } from '@/config/work-navigation';
import { computeDefaultTimeRange } from '@/lib/date';
import { useUiFlags } from '@/hooks/useUiFlags';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import ScreenTable from '@/components/ui/ScreenTable';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { DateRangeChips } from '@/components/ui/DateRangeChips';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { formControlClass, formLabelClass } from '@/components/ui/form-styles';
import {
  TB_AMOUNT_KEYS,
  fmtAmount,
  ledgerHref,
  unbalancedLabels,
  visibleSections,
  type PeriodTbData,
} from './trial-balance';

/**
 * งบทดลอง FINANCE แบบช่วงเวลา (แบบ PEAK) — ยอดยกมา / ระหว่างงวด / ยอดคงเหลือ แยกเดบิต-เครดิต
 * กดรหัสหรือชื่อบัญชี = เปิดบัญชีแยกประเภทของบัญชีนั้น ช่วงวันที่เดียวกัน
 * Routed at `/finance/trial-balance` (รับ ?start=&end= เมื่อกลับมาจากบัญชีแยกประเภท)
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const numberCell = 'whitespace-nowrap px-4 py-3 text-right align-top font-mono tabular-nums';
const groupEdge = 'border-l border-border';

function handleTableKeyDown(event: KeyboardEvent<HTMLDivElement>) {
  const viewport = event.currentTarget;
  if (event.target !== viewport || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (viewport.scrollWidth <= viewport.clientWidth) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    viewport.scrollBy({ left: event.key === 'ArrowRight' ? 160 : -160 });
  }
}

export default function TrialBalancePage() {
  const fieldId = useId();
  const [searchParams] = useSearchParams();
  const fromUrl = (key: string) => {
    const value = searchParams.get(key);
    return value && DATE_ONLY.test(value) ? value : null;
  };
  const defaults = computeDefaultTimeRange('this_month');
  const [startDate, setStartDate] = useState(fromUrl('start') ?? defaults.startDate);
  const [endDate, setEndDate] = useState(fromUrl('end') ?? defaults.endDate);
  const [hideZero, setHideZero] = useState(true);
  const { cacheTtlReports } = useUiFlags();

  const query = useQuery({
    queryKey: ['period-trial-balance', startDate, endDate],
    queryFn: async (): Promise<PeriodTbData> => {
      const { data } = await api.get('/expenses/ledger/trial-balance', {
        params: { periodStart: startDate, periodEnd: endDate },
      });
      return data as PeriodTbData;
    },
    enabled: !!startDate && !!endDate && startDate <= endDate,
    staleTime: cacheTtlReports * 1000,
  });

  const data = query.data;
  const sections = data ? visibleSections(data.sections, hideZero) : [];
  const unbalanced = data ? unbalancedLabels(data.isBalanced) : [];
  const rangeInvalid = !!startDate && !!endDate && startDate > endDate;

  return (
    <div className="min-w-0">
      <PageHeader
        title={NAV_LABELS.trialBalance}
        subtitle="FINANCE — ยอดยกมา รายการระหว่างงวด และยอดคงเหลือของทุกบัญชี"
        icon={<Scale className="size-6" />}
      />

      <div className="mb-3">
        <DateRangeChips
          startDate={startDate}
          endDate={endDate}
          showAllChip={false}
          onChange={({ startDate: sd, endDate: ed }) => {
            setStartDate(sd);
            setEndDate(ed);
          }}
        />
      </div>

      <Card className="min-w-0">
        <CardHeader className="px-4 py-5 sm:px-6">
          <div className="flex w-full min-w-0 flex-wrap items-end gap-5">
            <div className="w-full min-w-0 sm:w-52">
              <label htmlFor={`${fieldId}-start`} className={formLabelClass}>ตั้งแต่วันที่</label>
              <ThaiDateInput
                id={`${fieldId}-start`}
                className={`${formControlClass} pr-10`}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value || defaults.startDate)}
              />
            </div>
            <div className="w-full min-w-0 sm:w-52">
              <label htmlFor={`${fieldId}-end`} className={formLabelClass}>ถึงวันที่</label>
              <ThaiDateInput
                id={`${fieldId}-end`}
                className={`${formControlClass} pr-10`}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value || defaults.endDate)}
              />
            </div>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm leading-snug sm:ml-auto">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={hideZero}
                onChange={(e) => setHideZero(e.target.checked)}
              />
              ซ่อนบัญชีที่ไม่มียอด
            </label>
          </div>
          {rangeInvalid && (
            <p role="alert" className="mt-3 text-sm leading-snug text-destructive">
              วันเริ่มต้นต้องไม่เกินวันสิ้นสุด
            </p>
          )}
          {data && (
            <p
              className={`mt-4 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium leading-snug ${
                unbalanced.length === 0 ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'
              }`}
            >
              {unbalanced.length === 0 ? (
                <CheckCircle2 aria-hidden="true" className="size-3.5" />
              ) : (
                <AlertTriangle aria-hidden="true" className="size-3.5" />
              )}
              {unbalanced.length === 0 ? 'สมดุลทั้ง 3 คู่' : `ไม่สมดุล: ${unbalanced.join(', ')}`}
            </p>
          )}
        </CardHeader>
        <CardContent className="min-w-0 px-4 py-5 sm:px-6">
          <QueryBoundary
            isLoading={query.isLoading}
            isError={query.isError}
            error={query.error}
            onRetry={() => query.refetch()}
            errorTitle={`ไม่สามารถโหลด${NAV_LABELS.trialBalance}ได้`}
          >
            {data &&
              (sections.length === 0 ? (
                <p className="py-10 text-center text-sm leading-snug text-muted-foreground">
                  ไม่มีบัญชีที่มียอดในช่วงนี้
                </p>
              ) : (
                <div
                  role="region"
                  aria-label="ตารางงบทดลอง เลื่อนดูคอลัมน์"
                  tabIndex={0}
                  onKeyDown={handleTableKeyDown}
                  className="max-w-full overflow-x-auto rounded-lg border border-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <ScreenTable aria-label={NAV_LABELS.trialBalance} className="w-full min-w-[72rem] text-sm leading-6">
                    <thead className="bg-muted text-muted-foreground">
                      <tr>
                        <th scope="col" rowSpan={2} className="w-28 px-4 py-3 text-left font-medium">รหัส</th>
                        <th scope="col" rowSpan={2} className="px-4 py-3 text-left font-medium">ชื่อบัญชี</th>
                        <th scope="colgroup" colSpan={2} className={`px-4 pt-3 text-center font-semibold ${groupEdge}`}>ยอดยกมา</th>
                        <th scope="colgroup" colSpan={2} className={`px-4 pt-3 text-center font-semibold ${groupEdge}`}>ระหว่างงวด</th>
                        <th scope="colgroup" colSpan={2} className={`px-4 pt-3 text-center font-semibold ${groupEdge}`}>ยอดคงเหลือ</th>
                      </tr>
                      <tr>
                        {['ยอดยกมา', 'ระหว่างงวด', 'ยอดคงเหลือ'].flatMap((group) => [
                          <th key={`${group}-dr`} scope="col" className={`whitespace-nowrap px-4 pb-3 text-right font-medium ${groupEdge}`}>
                            <span className="sr-only">{group} </span>เดบิต
                          </th>,
                          <th key={`${group}-cr`} scope="col" className="whitespace-nowrap px-4 pb-3 text-right font-medium">
                            <span className="sr-only">{group} </span>เครดิต
                          </th>,
                        ])}
                      </tr>
                    </thead>
                    {sections.map((section) => (
                      <tbody key={section.codePrefix}>
                        <tr className="border-t border-border">
                          <th scope="rowgroup" colSpan={8} className="px-4 pb-2 pt-4 text-left text-sm font-semibold leading-snug text-foreground">
                            {section.sectionName}
                          </th>
                        </tr>
                        {section.rows.map((row) => {
                          const href = ledgerHref(row.code, startDate, endDate);
                          return (
                            <tr key={row.code} className="border-t border-border">
                              <td className="whitespace-nowrap px-4 py-3 align-top font-mono">
                                <Link to={href} className="text-primary hover:underline" aria-label={`${row.code} ${row.name} — ดูบัญชีแยกประเภท`}>
                                  {row.code}
                                </Link>
                              </td>
                              <td className="break-words px-4 py-3 align-top">
                                <Link to={href} className="text-primary hover:underline">{row.name}</Link>
                              </td>
                              {TB_AMOUNT_KEYS.map((key, index) => (
                                <td key={key} className={`${numberCell} ${index % 2 === 0 ? groupEdge : ''}`}>
                                  {fmtAmount(row[key])}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                        <tr className="border-t border-border bg-muted/50 font-semibold">
                          <td className="px-4 py-3" colSpan={2}>รวม{section.sectionName}</td>
                          {TB_AMOUNT_KEYS.map((key, index) => (
                            <td key={key} className={`${numberCell} ${index % 2 === 0 ? groupEdge : ''}`}>
                              {fmtAmount(section.totals[key], false)}
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    ))}
                    <tfoot>
                      <tr className="border-t-2 border-border bg-muted font-bold">
                        <td className="px-4 py-3" colSpan={2}>รวมทั้งสิ้น</td>
                        {TB_AMOUNT_KEYS.map((key, index) => (
                          <td key={key} className={`${numberCell} ${index % 2 === 0 ? groupEdge : ''}`}>
                            {fmtAmount(data.totals[key], false)}
                          </td>
                        ))}
                      </tr>
                    </tfoot>
                  </ScreenTable>
                </div>
              ))}
          </QueryBoundary>
          <p className="mt-4 text-sm leading-snug text-muted-foreground">
            กดรหัสหรือชื่อบัญชีเพื่อดูรายการในบัญชีแยกประเภทช่วงวันที่เดียวกัน
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
