// Asset module — Phase 3 register page
// As-of-date register with 4 stat cards, filters (category/status/search),
// 9-column DataTable, CSV/Excel export. URL-synced filters.

import { useState, useMemo, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileSpreadsheet, FileText, Search, BookOpen } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import DataTable from '@/components/ui/DataTable';
import QueryBoundary from '@/components/QueryBoundary';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import AnimatedCounter from '@/components/ui/animated-counter';
import { useDebounce } from '@/hooks/useDebounce';
import { formatDateShortThai, formatNumberDecimal } from '@/utils/formatters';
import { getErrorMessage } from '@/lib/api';
import { assetsApi } from './api';
import { exportRegisterCsv, exportRegisterXlsx } from './utils/exportRegister';
import {
  CATEGORY_LABEL,
  type AssetRegisterRow,
  type AssetCategory,
  type AssetStatus,
} from './types';

const PAGE_SIZE = 50;

const today = () => new Date().toISOString().slice(0, 10);

export default function AssetRegisterPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const asOfDate = searchParams.get('asOfDate') ?? today();
  const category = (searchParams.get('category') ?? '') as AssetCategory | '';
  const status = (searchParams.get('status') ?? '') as AssetStatus | '';
  const [searchInput, setSearchInput] = useState(searchParams.get('search') ?? '');
  const search = useDebounce(searchInput, 300);
  const page = Number(searchParams.get('page') ?? 1);

  const setParam = (key: string, val: string | null, replace = false) => {
    const next = new URLSearchParams(searchParams);
    if (val) next.set(key, val);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setSearchParams(next, replace ? { replace: true } : undefined);
  };

  // Sync URL after debounce, not on every keystroke (avoids history pollution)
  useEffect(() => {
    setParam('search', search || null, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const query = useQuery({
    queryKey: ['asset-register', { asOfDate, category, status, search, page }],
    queryFn: () =>
      assetsApi.getRegister({
        asOfDate,
        category: category || undefined,
        status: status || undefined,
        search: search || undefined,
        page,
        limit: PAGE_SIZE,
      }),
  });

  const handleExportCsv = () => {
    if (!query.data) return;
    try {
      exportRegisterCsv(query.data);
      toast.success('ดาวน์โหลด CSV สำเร็จ');
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  };

  const handleExportXlsx = async () => {
    if (!query.data) return;
    try {
      await exportRegisterXlsx(query.data);
      toast.success('ดาวน์โหลด Excel สำเร็จ');
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  };

  const columns = useMemo(
    () => [
      {
        key: 'assetCode',
        label: 'รหัส',
        render: (row: AssetRegisterRow) => (
          <button
            onClick={() => navigate(`/assets/${row.id}`)}
            className="font-mono text-primary hover:underline"
          >
            {row.assetCode}
          </button>
        ),
      },
      { key: 'name', label: 'ชื่อ', render: (row: AssetRegisterRow) => row.name },
      {
        key: 'category',
        label: 'หมวด',
        render: (row: AssetRegisterRow) => CATEGORY_LABEL[row.category] ?? row.category,
      },
      {
        key: 'purchaseDate',
        label: 'วันที่ซื้อ',
        render: (row: AssetRegisterRow) => formatDateShortThai(row.purchaseDate),
      },
      {
        key: 'purchaseCost',
        label: 'ราคาทุน',
        render: (row: AssetRegisterRow) => (
          <span className="tabular-nums">{formatNumberDecimal(parseFloat(row.purchaseCost))}</span>
        ),
      },
      {
        key: 'accumulatedDeprAt',
        label: 'ค่าเสื่อมสะสม',
        render: (row: AssetRegisterRow) => (
          <span className="tabular-nums">
            {formatNumberDecimal(parseFloat(row.accumulatedDeprAt))}
          </span>
        ),
      },
      {
        key: 'netBookValueAt',
        label: 'มูลค่าตามบัญชีสุทธิ (NBV)',
        render: (row: AssetRegisterRow) => (
          <span className="tabular-nums font-semibold">
            {formatNumberDecimal(parseFloat(row.netBookValueAt))}
          </span>
        ),
      },
      {
        key: 'remainingMonths',
        label: 'เดือนคงเหลือ',
        render: (row: AssetRegisterRow) => row.remainingMonths,
      },
      {
        key: 'custodian',
        label: 'ผู้ดูแล',
        render: (row: AssetRegisterRow) => row.custodian ?? '-',
      },
    ],
    [navigate],
  );

  const summary = query.data?.summary;

  return (
    <div className="space-y-4">
      <PageHeader
        title="ทะเบียนสินทรัพย์"
        subtitle={`ณ วันที่ ${formatDateShortThai(asOfDate)}`}
        icon={<BookOpen className="h-5 w-5" />}
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleExportCsv} disabled={!query.data}>
              <FileText className="mr-2 h-4 w-4" /> CSV
            </Button>
            <Button variant="outline" onClick={handleExportXlsx} disabled={!query.data}>
              <FileSpreadsheet className="mr-2 h-4 w-4" /> Excel
            </Button>
          </div>
        }
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground">จำนวน</div>
            <div className="text-2xl font-semibold tabular-nums">
              <AnimatedCounter value={summary?.count ?? 0} />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground">ราคาทุนรวม</div>
            <div className="text-2xl font-semibold tabular-nums">
              <AnimatedCounter
                value={parseFloat(summary?.totalPurchaseCost ?? '0')}
                decimals={2}
              />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground">ค่าเสื่อมสะสมรวม</div>
            <div className="text-2xl font-semibold tabular-nums">
              <AnimatedCounter
                value={parseFloat(summary?.totalAccumulatedDepr ?? '0')}
                decimals={2}
              />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground">มูลค่าตามบัญชีสุทธิ (NBV) รวม</div>
            <div className="text-2xl font-semibold tabular-nums">
              <AnimatedCounter value={parseFloat(summary?.totalNbv ?? '0')} decimals={2} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div>
            <label className="text-sm font-medium mb-1 block">ณ วันที่</label>
            <ThaiDateInput
              value={asOfDate}
              onChange={(e) => setParam('asOfDate', e.target.value || null)}
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">หมวด</label>
            <Select
              value={category || 'ALL'}
              onValueChange={(v) => setParam('category', v === 'ALL' ? null : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="หมวด" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">ทุกหมวด</SelectItem>
                <SelectItem value="EQUIPMENT">{CATEGORY_LABEL.EQUIPMENT}</SelectItem>
                <SelectItem value="IMPROVEMENT">{CATEGORY_LABEL.IMPROVEMENT}</SelectItem>
                <SelectItem value="FURNITURE">{CATEGORY_LABEL.FURNITURE}</SelectItem>
                <SelectItem value="VEHICLE">{CATEGORY_LABEL.VEHICLE}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">สถานะ</label>
            <Select
              value={status || 'ALL'}
              onValueChange={(v) => setParam('status', v === 'ALL' ? null : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="สถานะ" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">ทุกสถานะ</SelectItem>
                <SelectItem value="POSTED">ลงบัญชีแล้ว</SelectItem>
                <SelectItem value="DISPOSED">จำหน่าย</SelectItem>
                <SelectItem value="WRITTEN_OFF">ตัดบัญชี</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">ค้นหา</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-10"
                placeholder="ค้นหา รหัส/ชื่อ/serial"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <QueryBoundary
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => query.refetch()}
        errorTitle="โหลดทะเบียนสินทรัพย์ไม่สำเร็จ"
      >
        {/* P12: enhanced header contrast (bg-muted/60 + border-b-2) */}
        <div className="[&_thead_tr]:bg-muted/60 [&_thead_tr]:border-b-2 [&_thead_tr]:border-border [&_thead_th]:text-foreground">
          <DataTable
            columns={columns}
            data={query.data?.data ?? []}
            pagination={{
              page,
              totalPages: query.data ? Math.max(1, Math.ceil(query.data.total / PAGE_SIZE)) : 1,
              total: query.data?.total ?? 0,
              onPageChange: (p: number) => setParam('page', String(p)),
            }}
          />
        </div>
      </QueryBoundary>
    </div>
  );
}
