import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { Store, BarChart3, Wallet } from 'lucide-react';

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
  return new Date().toISOString().slice(0, 10);
}

function monthStart(): string {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
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
    <div>
      <PageHeader
        title="บัญชีหน้าร้าน (SHOP)"
        subtitle="งบทดลอง + กำไรขาดทุนของฝั่ง SHOP — แยกจาก FINANCE ตามผัง S-prefix"
      />

      <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-muted p-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium leading-snug transition-colors ${
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
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium leading-snug text-muted-foreground">
              ณ วันที่
            </label>
            <ThaiDateInput value={asOfDate} onChange={(e) => setAsOfDate(e.target.value || todayStr())} />
          </div>
          {query.data && (
            <div className="ml-auto text-sm leading-snug">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium leading-snug ${
                  query.data.isBalanced
                    ? 'bg-success/10 text-success'
                    : 'bg-destructive/10 text-destructive'
                }`}
              >
                {query.data.isBalanced ? 'สมดุล' : 'ไม่สมดุล'}
              </span>
              <span className="ml-3 text-muted-foreground">
                รวม Dr {fmtMoney(query.data.grandDrTotal)} · Cr{' '}
                {fmtMoney(query.data.grandCrTotal)}
              </span>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
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
                    <h3 className="mb-2 text-sm font-semibold leading-snug text-foreground">
                      {section.sectionName}
                    </h3>
                    <div className="overflow-hidden rounded-lg border border-border">
                      <table className="w-full text-sm">
                        <thead className="bg-muted text-muted-foreground">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-medium leading-snug">
                              รหัส
                            </th>
                            <th className="px-3 py-2 text-left text-xs font-medium leading-snug">
                              ชื่อบัญชี
                            </th>
                            <th className="px-3 py-2 text-right text-xs font-medium leading-snug">
                              เดบิต
                            </th>
                            <th className="px-3 py-2 text-right text-xs font-medium leading-snug">
                              เครดิต
                            </th>
                            <th className="px-3 py-2 text-right text-xs font-medium leading-snug">
                              คงเหลือสุทธิ
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {section.rows.map((row) => (
                            <tr key={row.code} className="border-t border-border">
                              <td className="px-3 py-2 font-mono text-xs leading-snug">
                                {row.code}
                              </td>
                              <td className="px-3 py-2 leading-snug">{row.name}</td>
                              <td className="px-3 py-2 text-right font-mono">
                                {fmtMoney(row.drBalance)}
                              </td>
                              <td className="px-3 py-2 text-right font-mono">
                                {fmtMoney(row.crBalance)}
                              </td>
                              <td className="px-3 py-2 text-right font-mono">
                                {fmtMoney(row.netBalance)}
                              </td>
                            </tr>
                          ))}
                          <tr className="border-t border-border bg-muted/50 font-semibold">
                            <td className="px-3 py-2" colSpan={2}>
                              รวมหมวด
                            </td>
                            <td className="px-3 py-2 text-right font-mono">
                              {fmtMoney(section.drTotal)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono">
                              {fmtMoney(section.crTotal)}
                            </td>
                            <td className="px-3 py-2" />
                          </tr>
                        </tbody>
                      </table>
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
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium leading-snug text-muted-foreground">
              ตั้งแต่
            </label>
            <ThaiDateInput
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value || monthStart())}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium leading-snug text-muted-foreground">
              ถึง
            </label>
            <ThaiDateInput
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value || todayStr())}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
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
              <div className="flex items-center justify-between rounded-lg border-2 border-primary/50 bg-primary/5 px-4 py-3">
                <span className="text-sm font-semibold leading-snug">
                  กำไร(ขาดทุน)สุทธิประจำงวด — SHOP
                </span>
                <span
                  className={`font-mono text-base font-semibold ${
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
        <h3 className="mb-2 text-sm font-semibold leading-snug">{title}</h3>
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-6 text-center text-sm leading-snug text-muted-foreground">
          ไม่มีรายการในช่วงนี้
        </div>
      </div>
    );
  }
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold leading-snug">{title}</h3>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium leading-snug">รหัส</th>
              <th className="px-3 py-2 text-left text-xs font-medium leading-snug">ชื่อบัญชี</th>
              <th className="px-3 py-2 text-right text-xs font-medium leading-snug">จำนวน</th>
            </tr>
          </thead>
          <tbody>
            {section.rows.map((row) => (
              <tr key={row.code} className="border-t border-border">
                <td className="px-3 py-2 font-mono text-xs leading-snug">{row.code}</td>
                <td className="px-3 py-2 leading-snug">{row.name}</td>
                <td className="px-3 py-2 text-right font-mono">{fmtMoney(row.amount)}</td>
              </tr>
            ))}
            <tr className="border-t border-border bg-muted/50 font-semibold">
              <td className="px-3 py-2" colSpan={2}>
                รวม
              </td>
              <td className="px-3 py-2 text-right font-mono">{fmtMoney(section.total)}</td>
            </tr>
          </tbody>
        </table>
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
