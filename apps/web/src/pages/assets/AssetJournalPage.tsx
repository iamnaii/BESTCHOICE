import { useState, useMemo, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Search, FileText } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import DataTable from '@/components/ui/DataTable';
import QueryBoundary from '@/components/QueryBoundary';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { useDebounce } from '@/hooks/useDebounce';
import { formatDateShortThai, formatNumberDecimal } from '@/utils/formatters';
import { assetsApi } from './api';
import type { AssetJournalRow } from './types';

const FLOW_LABEL: Record<string, string> = {
  'asset-purchase': 'ซื้อ',
  'asset-purchase-reverse': 'ยกเลิกซื้อ',
  'asset-disposal': 'จำหน่าย',
  'asset-disposal-reverse': 'ยกเลิกจำหน่าย',
  'depreciation': 'ค่าเสื่อม',
  'depreciation-reverse': 'ยกเลิกค่าเสื่อม',
};

export default function AssetJournalPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const flowType = searchParams.get('flowType') ?? '';
  const fromDate = searchParams.get('fromDate') ?? '';
  const toDate = searchParams.get('toDate') ?? '';
  const [searchInput, setSearchInput] = useState(searchParams.get('search') ?? '');
  const search = useDebounce(searchInput, 300);
  const page = Number(searchParams.get('page') ?? 1);

  const setParam = (key: string, val: string | null, replace = false) => {
    const next = new URLSearchParams(searchParams);
    if (val) next.set(key, val); else next.delete(key);
    if (key !== 'page') next.delete('page');
    setSearchParams(next, replace ? { replace: true } : undefined);
  };

  // Sync URL after debounce, not on every keystroke (avoids history pollution)
  useEffect(() => {
    setParam('search', search || null, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const query = useQuery({
    queryKey: ['asset-journal', { flowType, fromDate, toDate, search, page }],
    queryFn: () => assetsApi.listJournal({
      flowType: flowType || undefined,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
      search: search || undefined,
      page, limit: 50,
    }),
  });

  const columns = useMemo(() => [
    { key: 'entryDate', label: 'วันที่', render: (row: AssetJournalRow) => formatDateShortThai(row.entryDate) },
    {
      key: 'entryNumber', label: 'เลขที่ JE',
      render: (row: AssetJournalRow) => <span className="font-mono text-primary">{row.entryNumber}</span>,
    },
    {
      key: 'flow', label: 'ประเภท',
      render: (row: AssetJournalRow) => (
        <Badge variant={row.flow.includes('reverse') ? 'outline' : 'success'}>
          {FLOW_LABEL[row.flow] ?? row.flow}
        </Badge>
      ),
    },
    {
      key: 'asset', label: 'สินทรัพย์',
      render: (row: AssetJournalRow) =>
        row.asset ? (
          <button onClick={() => navigate(`/assets/${row.asset!.id}`)} className="text-left hover:underline">
            <span className="font-mono">{row.asset.assetCode}</span>
            <div className="text-xs text-muted-foreground">{row.asset.name}</div>
          </button>
        ) : '-',
    },
    { key: 'description', label: 'รายละเอียด', render: (row: AssetJournalRow) => row.description },
    { key: 'totalDr', label: 'Dr', render: (row: AssetJournalRow) => <span className="tabular-nums">{formatNumberDecimal(parseFloat(row.totalDr))}</span> },
    {
      key: 'reversed', label: 'สถานะ',
      render: (row: AssetJournalRow) => row.reversed ? <Badge variant="destructive">กลับรายการแล้ว</Badge> : <Badge variant="success">ลงบัญชี</Badge>,
    },
  ], [navigate]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="JV สินทรัพย์"
        subtitle="รายการบัญชีที่เกี่ยวกับสินทรัพย์ทั้งหมด"
        icon={<FileText className="h-5 w-5" />}
      />

      <Card>
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
          <Select value={flowType || 'ALL'} onValueChange={(v) => setParam('flowType', v === 'ALL' ? null : v)}>
            <SelectTrigger><SelectValue placeholder="ประเภท" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">ทุกประเภท</SelectItem>
              <SelectItem value="asset-purchase">{FLOW_LABEL['asset-purchase']}</SelectItem>
              <SelectItem value="depreciation">{FLOW_LABEL.depreciation}</SelectItem>
              <SelectItem value="asset-disposal">{FLOW_LABEL['asset-disposal']}</SelectItem>
              <SelectItem value="all-reversals">รายการกลับทั้งหมด</SelectItem>
            </SelectContent>
          </Select>
          <ThaiDateInput value={fromDate} onChange={(e) => setParam('fromDate', e.target.value || null)} />
          <ThaiDateInput value={toDate} onChange={(e) => setParam('toDate', e.target.value || null)} />
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-10" placeholder="ค้นหาสินทรัพย์"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <QueryBoundary
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => query.refetch()}
        errorTitle="โหลด JV ไม่สำเร็จ"
      >
        <DataTable
          columns={columns}
          data={query.data?.data ?? []}
          pagination={{
            page,
            totalPages: query.data ? Math.max(1, Math.ceil(query.data.total / 50)) : 1,
            total: query.data?.total ?? 0,
            onPageChange: (p: number) => setParam('page', String(p)),
          }}
        />
      </QueryBoundary>
    </div>
  );
}
