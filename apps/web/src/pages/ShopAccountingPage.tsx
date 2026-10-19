import ScreenTable from '@/components/ui/ScreenTable';
import { toBangkokDateString, getReportDateRange } from '@/lib/date';
import { useId as useUiFieldId, useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { formControlClass, formLabelClass } from '@/components/ui/form-styles';
import { Store, BarChart3, Wallet, AlertTriangle, ChevronDown } from 'lucide-react';

/**
 * P3-SP5 — SHOP-side accounting reports.
 *
 * Renders Trial Balance + P&L scoped to the SHOP chart (S-prefixed accounts
 * only). Hits `/expenses/ledger/shop/trial-balance` and
 * `/expenses/ledger/shop/profit-loss`.
 *
 * Routed at `/shop/accounting`.
 */

type TabKey = 'trial-balance' | 'profit-loss';

interface TrialBalanceRow {
  code: string;
  name: string;
  type: string;
  normalBalance: string;
  drBalance: string | number;
  crBalance: string | number;
  netBalance: string | number;
}

interface TrialBalanceSection {
  sectionName: string;
  codePrefix: string;
  rows: TrialBalanceRow[];
  drTotal: string | number;
  crTotal: string | number;
}

interface TrialBalanceData {
  asOfDate: string;
  sections: TrialBalanceSection[];
  grandDrTotal: string | number;
  grandCrTotal: string | number;
  isBalanced: boolean;
}

interface PlRow {
  code: string;
  name: string;
  amount: string | number;
}

interface PlSection {
  sectionName: string;
  rows: PlRow[];
  total: string | number;
}

interface ProfitLossData {
  periodStart: string;
  periodEnd: string;
  revenue: PlSection;
  expenses: PlSection;
  netIncome: string | number;
}

function fmtMoney(value: string | number | null | undefined): string {
  if (value == null) return '0.00';
  const n = typeof value === 'string' ? parseFloat(value) : value;
  if (Number.isNaN(n)) return '0.00';
  return n.toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function todayStr(): string {
  return toBangkokDateString();
}

function monthStart(): string {
  return getReportDateRange('this_month').startDate;
}

function handleTableKeyDown(event: KeyboardEvent<HTMLDivElement>) {
  const viewport = event.currentTarget;
  if (event.target !== viewport || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (viewport.scrollWidth <= viewport.clientWidth) return;
  // WebKit does not consistently scroll a focused region with arrow keys.
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    viewport.scrollBy({ left: event.key === 'ArrowRight' ? 160 : -160 });
  }
}

export default function ShopAccountingPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('trial-balance');
  const [asOfDate, setAsOfDate] = useState<string>(todayStr());
  const [periodStart, setPeriodStart] = useState<string>(monthStart());
  const [periodEnd, setPeriodEnd] = useState<string>(todayStr());

  const tabs: { key: TabKey; label: string; icon: typeof BarChart3 }[] = [
    { key: 'trial-balance', label: 'งบทดลอง (SHOP)', icon: Wallet },
    { key: 'profit-loss', label: 'งบกำไรขาดทุน (SHOP)', icon: BarChart3 },
  ];

  return (
    <div className="min-w-0">
      <PageHeader
        title="บัญชีหน้าร้าน (SHOP)"
        subtitle="งบทดลอง + กำไรขาดทุนของฝั่ง SHOP — แยกจาก FINANCE ใช้รหัสบัญชีขึ้นต้น S"
      />

      <details className="group mb-5 rounded-lg border border-border bg-muted text-sm leading-relaxed text-muted-foreground">
        <summary className="flex min-h-11 cursor-pointer list-none items-start gap-3 rounded-lg p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block font-medium text-foreground">
              ยอดสินค้าคงเหลือและเจ้าหนี้ผู้จัดจำหน่ายในงบนี้ยังไม่ครบ
            </span>
            <span className="mt-1 block">อย่าใช้รายงานนี้ยื่นภาษีหรือปิดงบจนกว่าฝ่ายบัญชีจะตรวจรับ</span>
            <span className="mt-2 block text-xs font-medium text-foreground">รายละเอียดข้อจำกัด</span>
          </span>
          <ChevronDown aria-hidden="true" className="mt-0.5 size-5 shrink-0 transition-transform group-open:rotate-180" />
        </summary>
        <p className="border-t border-border p-4">
            การขาย สัญญาผ่อน การจอง การเทิร์น และการรับสินค้าเข้าจากใบสั่งซื้อบันทึกบัญชีอัตโนมัติแล้ว
            แต่การจ่ายเงินผู้จัดจำหน่ายและการปรับสต๊อกยังไม่ถูกบันทึกบัญชี
            ยอดเจ้าหนี้ผู้จัดจำหน่ายและยอดเงินในงบทดลองจึงสูงกว่าจริง
            ส่วนสินค้าที่รับเข้าก่อนวันที่ระบบเริ่มบันทึกการรับของยังไม่อยู่ในสมุด
            ยอดสินค้าคงเหลือจึงยังต่ำกว่าจริงหรือติดลบได้
        </p>
      </details>

      <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-muted p-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.key;
          return (
            <button data-ui-control="button"
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              aria-pressed={active}
              className={`inline-flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium leading-snug transition-colors ${
                active
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              }`}
            >
              <Icon className="size-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'trial-balance' && (
        <TrialBalanceTab asOfDate={asOfDate} setAsOfDate={setAsOfDate} />
      )}
      {activeTab === 'profit-loss' && (
        <ProfitLossTab
          periodStart={periodStart}
          periodEnd={periodEnd}
          setPeriodStart={setPeriodStart}
          setPeriodEnd={setPeriodEnd}
        />
      )}
    </div>
  );
}

function TrialBalanceTab({
  asOfDate,
  setAsOfDate,
}: {
  asOfDate: string;
  setAsOfDate: (v: string) => void;
}) {
  const uiFieldId = useUiFieldId();
  const query = useQuery({
    queryKey: ['shop-trial-balance', asOfDate],
    queryFn: async (): Promise<TrialBalanceData> => {
      const { data } = await api.get('/expenses/ledger/shop/trial-balance', {
        params: { asOfDate },
      });
      return data as TrialBalanceData;
    },
  });

  return (
    <Card className="min-w-0">
      <CardHeader className="px-4 py-5 sm:px-6">
        <div className="flex w-full min-w-0 flex-wrap items-end gap-5">
          <div className="w-full min-w-0 sm:w-56">
            <label htmlFor={`${uiFieldId}-1`} className={formLabelClass}>
              ณ วันที่
            </label>
            <ThaiDateInput id={`${uiFieldId}-1`} className={`${formControlClass} pr-10`} value={asOfDate} onChange={(e) => setAsOfDate(e.target.value || todayStr())} />
          </div>
          {query.data && (
            <div className="flex w-full min-w-0 flex-wrap items-center gap-3 text-sm leading-relaxed sm:ml-auto sm:w-auto sm:gap-5">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium leading-snug ${
                  query.data.isBalanced
                    ? 'bg-success/10 text-success'
                    : 'bg-destructive/10 text-destructive'
                }`}
              >
                {query.data.isBalanced ? 'สมดุล' : 'ไม่สมดุล'}
              </span>
              <dl className="flex flex-wrap gap-x-6 gap-y-3">
                <div>
                  <dt className="text-xs text-muted-foreground">เดบิตรวม</dt>
                  <dd className="whitespace-nowrap font-medium tabular-nums">{fmtMoney(query.data.grandDrTotal)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">เครดิตรวม</dt>
                  <dd className="whitespace-nowrap font-medium tabular-nums">{fmtMoney(query.data.grandCrTotal)}</dd>
                </div>
              </dl>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="min-w-0 px-4 py-5 sm:px-6">
        <QueryBoundary
          isLoading={query.isLoading}
          isError={query.isError}
          error={query.error}
          onRetry={() => query.refetch()}
        >
          {query.data &&
            (query.data.sections.length === 0 ? (
              <EmptyState
                icon={Store}
                title="ยังไม่มีรายการ"
                message="ฝั่ง SHOP ยังไม่มีบัญชีที่บันทึกในช่วงนี้"
              />
            ) : (
              <div className="space-y-6">
                {query.data.sections.map((section) => (
                  <div key={section.codePrefix}>
                    <h3 className="mb-3 text-sm font-semibold leading-relaxed text-foreground">
                      {section.sectionName}
                    </h3>
                    <div role="region" aria-label={`ตาราง${section.sectionName} เลื่อนดูคอลัมน์`} tabIndex={0} onKeyDown={handleTableKeyDown} className="max-w-full overflow-x-auto rounded-lg border border-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                      <ScreenTable aria-label={section.sectionName} className="w-full min-w-[60rem] table-fixed text-sm leading-6">
                        <colgroup>
                          <col className="w-32" />
                          <col />
                          <col className="w-48" />
                          <col className="w-48" />
                          <col className="w-48" />
                        </colgroup>
                        <thead className="bg-muted text-muted-foreground">
                          <tr>
                            <th scope="col" className="px-4 py-3 text-left font-medium">
                              รหัส
                            </th>
                            <th scope="col" className="px-4 py-3 text-left font-medium">
                              ชื่อบัญชี
                            </th>
                            <th scope="col" className="whitespace-nowrap px-4 py-3 text-right font-medium">
                              เดบิต
                            </th>
                            <th scope="col" className="whitespace-nowrap px-4 py-3 text-right font-medium">
                              เครดิต
                            </th>
                            <th scope="col" className="whitespace-nowrap px-4 py-3 text-right font-medium">
                              คงเหลือสุทธิ
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {section.rows.map((row) => (
                            <tr key={row.code} className="border-t border-border">
                              <td className="whitespace-nowrap px-4 py-3 align-top font-mono">
                                {row.code}
                              </td>
                              <td className="break-words px-4 py-3 align-top">{row.name}</td>
                              <td className="whitespace-nowrap px-4 py-3 align-top text-right font-mono tabular-nums">
                                {fmtMoney(row.drBalance)}
                              </td>
                              <td className="whitespace-nowrap px-4 py-3 align-top text-right font-mono tabular-nums">
                                {fmtMoney(row.crBalance)}
                              </td>
                              <td className="whitespace-nowrap px-4 py-3 align-top text-right font-mono tabular-nums">
                                {fmtMoney(row.netBalance)}
                              </td>
                            </tr>
                          ))}
                          <tr className="border-t border-border bg-muted/50 font-semibold">
                            <td className="px-4 py-3" colSpan={2}>
                              รวมหมวด
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 align-top text-right font-mono tabular-nums">
                              {fmtMoney(section.drTotal)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 align-top text-right font-mono tabular-nums">
                              {fmtMoney(section.crTotal)}
                            </td>
                            <td className="px-4 py-3" />
                          </tr>
                        </tbody>
                      </ScreenTable>
                    </div>
                  </div>
                ))}
              </div>
            ))}
        </QueryBoundary>
      </CardContent>
    </Card>
  );
}

function ProfitLossTab({
  periodStart,
  periodEnd,
  setPeriodStart,
  setPeriodEnd,
}: {
  periodStart: string;
  periodEnd: string;
  setPeriodStart: (v: string) => void;
  setPeriodEnd: (v: string) => void;
}) {
  const uiFieldId = useUiFieldId();
  const query = useQuery({
    queryKey: ['shop-profit-loss', periodStart, periodEnd],
    queryFn: async (): Promise<ProfitLossData> => {
      const { data } = await api.get('/expenses/ledger/shop/profit-loss', {
        params: { periodStart, periodEnd },
      });
      return data as ProfitLossData;
    },
  });

  return (
    <Card className="min-w-0">
      <CardHeader className="px-4 py-5 sm:px-6">
        <div className="grid w-full min-w-0 gap-5 sm:max-w-[29.25rem] sm:grid-cols-2">
          <div className="min-w-0">
            <label htmlFor={`${uiFieldId}-1`} className={formLabelClass}>
              ตั้งแต่
            </label>
            <ThaiDateInput id={`${uiFieldId}-1`}
              className={`${formControlClass} pr-10`}
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value || monthStart())}
            />
          </div>
          <div className="min-w-0">
            <label htmlFor={`${uiFieldId}-2`} className={formLabelClass}>
              ถึง
            </label>
            <ThaiDateInput id={`${uiFieldId}-2`}
              className={`${formControlClass} pr-10`}
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value || todayStr())}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="min-w-0 px-4 py-5 sm:px-6">
        <QueryBoundary
          isLoading={query.isLoading}
          isError={query.isError}
          error={query.error}
          onRetry={() => query.refetch()}
        >
          {query.data && (
            <div className="space-y-6">
              <PlSectionTable title="รายได้ (SHOP)" section={query.data.revenue} />
              <PlSectionTable title="ค่าใช้จ่าย + ต้นทุนขาย (SHOP)" section={query.data.expenses} />
              <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-lg border-2 border-primary/50 bg-primary/5 px-4 py-4">
                <span className="text-sm font-semibold leading-snug">
                  กำไร(ขาดทุน)สุทธิประจำงวด — SHOP
                </span>
                <span
                  className={`whitespace-nowrap font-mono text-base font-semibold tabular-nums ${
                    Number(query.data.netIncome) >= 0 ? 'text-success' : 'text-destructive'
                  }`}
                >
                  {fmtMoney(query.data.netIncome)}
                </span>
              </div>
            </div>
          )}
        </QueryBoundary>
      </CardContent>
    </Card>
  );
}

function PlSectionTable({ title, section }: { title: string; section: PlSection }) {
  if (!section.rows || section.rows.length === 0) {
    return (
      <div>
        <h3 className="mb-3 text-sm font-semibold leading-relaxed">{title}</h3>
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-6 text-center text-sm leading-snug text-muted-foreground">
          ไม่มีรายการในช่วงนี้
        </div>
      </div>
    );
  }
  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold leading-relaxed">{title}</h3>
      <div role="region" aria-label={`ตาราง${title} เลื่อนดูคอลัมน์`} tabIndex={0} onKeyDown={handleTableKeyDown} className="max-w-full overflow-x-auto rounded-lg border border-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        <ScreenTable aria-label={title} className="w-full min-w-[40rem] table-fixed text-sm leading-6">
          <colgroup>
            <col className="w-32" />
            <col />
            <col className="w-48" />
          </colgroup>
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-3 text-left font-medium">รหัส</th>
              <th scope="col" className="px-4 py-3 text-left font-medium">ชื่อบัญชี</th>
              <th scope="col" className="whitespace-nowrap px-4 py-3 text-right font-medium">จำนวน</th>
            </tr>
          </thead>
          <tbody>
            {section.rows.map((row) => (
              <tr key={row.code} className="border-t border-border">
                <td className="whitespace-nowrap px-4 py-3 align-top font-mono">{row.code}</td>
                <td className="break-words px-4 py-3 align-top">{row.name}</td>
                <td className="whitespace-nowrap px-4 py-3 align-top text-right font-mono tabular-nums">{fmtMoney(row.amount)}</td>
              </tr>
            ))}
            <tr className="border-t border-border bg-muted/50 font-semibold">
              <td className="px-4 py-3" colSpan={2}>
                รวม
              </td>
              <td className="whitespace-nowrap px-4 py-3 align-top text-right font-mono tabular-nums">{fmtMoney(section.total)}</td>
            </tr>
          </tbody>
        </ScreenTable>
      </div>
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  message,
}: {
  icon: typeof Store;
  title: string;
  message: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <Icon className="size-10 text-muted-foreground/50" />
      <h3 className="text-sm font-medium leading-snug">{title}</h3>
      <p className="text-xs leading-snug text-muted-foreground">{message}</p>
    </div>
  );
}
