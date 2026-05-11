// Fix Report v1.0 P1-1 — AP Aging Page
//
// Shows unpaid ACCRUAL expenses bucketed by days overdue (0-30 / 31-60 / 61-90
// / 90+ / Total). Owner/finance team uses this to plan settlements:
//
//   1. Filter by vendor (substring, case-insensitive)
//   2. Filter by single bucket (or "ทั้งหมด")
//   3. Multi-select rows → "Batch Settlement" CTA. The CTA enforces
//      same-vendor (one VENDOR_SETTLEMENT doc can only clear ACCRUAL EXs from
//      one vendor — matches backend constraint).
//
// Backend: `/expense-documents/ap-aging` (new endpoint; see service).
// Reports total amounts as cash-leg (totalAmount − wht).

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, Link } from 'react-router';
import {
  Search,
  Wallet,
  AlertCircle,
  TrendingDown,
  TrendingUp,
  Clock,
  CheckSquare,
  Square,
  ExternalLink,
} from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import api from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import { formatNumberDecimal } from '@/utils/formatters';
import { formatThaiDateShort } from '@/lib/date';
import { cn } from '@/lib/utils';

type Bucket = '0-30' | '31-60' | '61-90' | '90+';
type BucketKey = Bucket | 'TOTAL';

interface ApAgingResponse {
  buckets: Record<BucketKey, { count: number; amount: string }>;
  docs: Array<{
    id: string;
    number: string;
    vendorName: string | null;
    vendorTaxId: string | null;
    documentDate: string;
    ageDays: number;
    bucket: Bucket;
    netAmount: string;
    branchId: string;
  }>;
}

const BUCKETS: Array<{ key: Bucket; label: string; icon: typeof Clock; tone: string }> = [
  { key: '0-30', label: '0–30 วัน', icon: Clock, tone: 'text-muted-foreground' },
  { key: '31-60', label: '31–60 วัน', icon: TrendingDown, tone: 'text-info' },
  { key: '61-90', label: '61–90 วัน', icon: TrendingDown, tone: 'text-warning' },
  { key: '90+', label: '90+ วัน', icon: AlertCircle, tone: 'text-destructive' },
];

export default function APAgingPage() {
  const navigate = useNavigate();
  const [vendor, setVendor] = useState('');
  const [bucket, setBucket] = useState<Bucket | ''>('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const debouncedVendor = useDebounce(vendor, 300);

  const query = useQuery<ApAgingResponse>({
    queryKey: ['ap-aging', { vendor: debouncedVendor, bucket }],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (debouncedVendor) params.vendor = debouncedVendor;
      if (bucket) params.bucket = bucket;
      const { data } = await api.get('/expense-documents/ap-aging', { params });
      return data;
    },
  });

  const docs = query.data?.docs ?? [];
  const buckets = query.data?.buckets;

  // Multi-select must be same-vendor — derive from current selection.
  const selectedDocs = useMemo(
    () => docs.filter((d) => selected.has(d.id)),
    [docs, selected],
  );
  const vendorsInSelection = useMemo(
    () => new Set(selectedDocs.map((d) => d.vendorName ?? '__null__')),
    [selectedDocs],
  );
  const sameVendor = vendorsInSelection.size <= 1;
  const selectionTotal = useMemo(
    () =>
      selectedDocs.reduce(
        (s, d) => s + parseFloat(d.netAmount),
        0,
      ),
    [selectedDocs],
  );

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === docs.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(docs.map((d) => d.id)));
    }
  };

  const handleBatchSettle = () => {
    if (!sameVendor) return;
    // Pass selected ids through query string; ExpenseFormV4 / settlement page
    // picks them up to pre-fill VENDOR_SETTLEMENT lines.
    const ids = [...selected].join(',');
    navigate(`/expenses/new?type=VENDOR_SETTLEMENT&clear=${ids}`);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <PageHeader
        title="AP Aging"
        subtitle="เจ้าหนี้ค้างจ่าย จัดอายุตามวันที่ใบกำกับ — ใช้วางแผน Settlement"
        icon={<Wallet size={20} />}
      />

      {/* Bucket cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {BUCKETS.map((b) => {
          const Icon = b.icon;
          const data = buckets?.[b.key];
          const active = bucket === b.key;
          return (
            <button
              key={b.key}
              type="button"
              onClick={() => setBucket(active ? '' : b.key)}
              className={cn(
                'rounded-xl border bg-card p-4 text-left transition-colors',
                active
                  ? 'border-primary ring-2 ring-primary/30'
                  : 'border-border/60 hover:border-primary/40 hover:bg-accent/30',
              )}
              aria-pressed={active}
            >
              <div className="flex items-center gap-2 mb-2">
                <div className={cn('rounded-md p-1.5 bg-muted', b.tone)}>
                  <Icon size={14} />
                </div>
                <span className="text-xs font-medium text-muted-foreground">{b.label}</span>
              </div>
              <div className="text-2xl font-bold tabular-nums">
                {data?.count ?? 0}
              </div>
              <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                {formatNumberDecimal(data?.amount ?? '0.00')} ฿
              </div>
            </button>
          );
        })}
        {/* Total tile (also clickable to clear bucket filter) */}
        <button
          type="button"
          onClick={() => setBucket('')}
          className={cn(
            'rounded-xl border bg-card p-4 text-left transition-colors',
            bucket === ''
              ? 'border-primary ring-2 ring-primary/30'
              : 'border-border/60 hover:border-primary/40 hover:bg-accent/30',
          )}
        >
          <div className="flex items-center gap-2 mb-2">
            <div className="rounded-md p-1.5 bg-primary/10 text-primary">
              <TrendingUp size={14} />
            </div>
            <span className="text-xs font-medium text-muted-foreground">รวม</span>
          </div>
          <div className="text-2xl font-bold tabular-nums">{buckets?.TOTAL.count ?? 0}</div>
          <div className="mt-1 text-xs text-muted-foreground tabular-nums">
            {formatNumberDecimal(buckets?.TOTAL.amount ?? '0.00')} ฿
          </div>
        </button>
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-card p-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            placeholder="ค้นหาชื่อผู้ขาย…"
            className="w-full pl-9 pr-3 py-2 border border-input rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        {bucket && (
          <button
            type="button"
            onClick={() => setBucket('')}
            className="px-3 py-2 text-sm border border-border rounded-md hover:bg-accent"
          >
            ล้างช่วงอายุ
          </button>
        )}
        {(selected.size > 0 || !sameVendor) && (
          <div className="ml-auto flex items-center gap-2">
            {!sameVendor && (
              <span className="inline-flex items-center gap-1.5 text-xs text-destructive">
                <AlertCircle size={14} />
                เลือกได้เฉพาะใบจากผู้ขายเดียวกัน
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              เลือก {selected.size} · รวม {formatNumberDecimal(selectionTotal.toFixed(2))} ฿
            </span>
            <button
              type="button"
              onClick={handleBatchSettle}
              disabled={selected.size === 0 || !sameVendor}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-md',
                selected.size > 0 && sameVendor
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'bg-muted text-muted-foreground cursor-not-allowed',
              )}
            >
              <ExternalLink size={14} />
              สร้างใบ Settlement
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      <QueryBoundary
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={query.refetch}
      >
        <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left text-xs text-muted-foreground">
                <th className="p-3 w-10">
                  <button
                    type="button"
                    onClick={toggleAll}
                    aria-label="เลือกทั้งหมด"
                    className="flex items-center"
                  >
                    {selected.size === docs.length && docs.length > 0 ? (
                      <CheckSquare size={16} className="text-primary" />
                    ) : (
                      <Square size={16} className="text-muted-foreground" />
                    )}
                  </button>
                </th>
                <th className="p-3 font-medium">เลขเอกสาร</th>
                <th className="p-3 font-medium">ผู้ขาย</th>
                <th className="p-3 font-medium">วันที่ใบกำกับ</th>
                <th className="p-3 font-medium text-right">อายุ (วัน)</th>
                <th className="p-3 font-medium">ช่วง</th>
                <th className="p-3 font-medium text-right">ยอดสุทธิ (฿)</th>
                <th className="p-3 font-medium w-10"></th>
              </tr>
            </thead>
            <tbody>
              {docs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-muted-foreground">
                    ไม่มีเอกสารค้างจ่าย
                  </td>
                </tr>
              ) : (
                docs.map((d) => {
                  const isSelected = selected.has(d.id);
                  return (
                    <tr
                      key={d.id}
                      className={cn(
                        'border-t border-border transition-colors',
                        isSelected ? 'bg-primary/5' : 'hover:bg-accent/30',
                      )}
                    >
                      <td className="p-3">
                        <button
                          type="button"
                          onClick={() => toggleRow(d.id)}
                          aria-label={`เลือก ${d.number}`}
                          className="flex items-center"
                        >
                          {isSelected ? (
                            <CheckSquare size={16} className="text-primary" />
                          ) : (
                            <Square size={16} className="text-muted-foreground" />
                          )}
                        </button>
                      </td>
                      <td className="p-3 font-mono text-xs">{d.number}</td>
                      <td className="p-3">{d.vendorName ?? '—'}</td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {formatThaiDateShort(d.documentDate)}
                      </td>
                      <td className="p-3 text-right font-mono tabular-nums">{d.ageDays}</td>
                      <td className="p-3">
                        <span
                          className={cn(
                            'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
                            d.bucket === '0-30' && 'bg-muted text-muted-foreground',
                            d.bucket === '31-60' && 'bg-info/10 text-info',
                            d.bucket === '61-90' && 'bg-warning/10 text-warning',
                            d.bucket === '90+' && 'bg-destructive/10 text-destructive',
                          )}
                        >
                          {d.bucket}
                        </span>
                      </td>
                      <td className="p-3 text-right font-mono tabular-nums">
                        {formatNumberDecimal(d.netAmount)}
                      </td>
                      <td className="p-3">
                        <Link
                          to={`/expenses/${d.id}`}
                          aria-label={`เปิด ${d.number}`}
                          className="text-muted-foreground hover:text-primary"
                        >
                          <ExternalLink size={14} />
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </QueryBoundary>
    </div>
  );
}
