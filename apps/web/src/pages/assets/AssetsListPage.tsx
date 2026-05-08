// Asset module — Phase 1 list page
// Search debounced 300ms, filter by category/status, paginated 50/page,
// copy + edit + delete row actions, AnimatedCounter for stat values.

import { useState, useMemo, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Search, Copy, Edit, Trash2, Boxes } from 'lucide-react';
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
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import AnimatedCounter from '@/components/ui/animated-counter';
import { useDebounce } from '@/hooks/useDebounce';
import { formatDateShortThai, formatNumberDecimal } from '@/utils/formatters';
import { getErrorMessage } from '@/lib/api';
import { assetsApi } from './api';
import { AssetStatusBadge } from './components/AssetStatusBadge';
import {
  CATEGORY_LABEL,
  type Asset,
  type AssetCategory,
  type AssetStatus,
} from './types';

const PAGE_SIZE = 50;

export default function AssetsListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [searchInput, setSearchInput] = useState(searchParams.get('search') ?? '');
  const debouncedSearch = useDebounce(searchInput, 300);
  const status = (searchParams.get('status') ?? '') as AssetStatus | '';
  const category = (searchParams.get('category') ?? '') as AssetCategory | '';
  const page = Number(searchParams.get('page') ?? 1);

  const summaryQuery = useQuery({
    queryKey: ['assets-summary'],
    queryFn: () => assetsApi.getSummary(),
  });

  const listQuery = useQuery({
    queryKey: ['assets', { search: debouncedSearch, status, category, page }],
    queryFn: () =>
      assetsApi.list({
        search: debouncedSearch || undefined,
        status: status || undefined,
        category: category || undefined,
        page,
        limit: PAGE_SIZE,
      }),
  });

  const [deleteId, setDeleteId] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => assetsApi.delete(id),
    onSuccess: () => {
      toast.success('ลบสินทรัพย์สำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      queryClient.invalidateQueries({ queryKey: ['assets-summary'] });
      setDeleteId(null);
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const copyMutation = useMutation({
    mutationFn: (id: string) => assetsApi.copy(id),
    onSuccess: (newAsset) => {
      toast.success(`คัดลอกเป็น ${newAsset.assetCode}`);
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      navigate(`/assets/${newAsset.id}/edit`);
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const setParam = (key: string, val: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (val) next.set(key, val);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setSearchParams(next);
  };

  const onSearchChange = (val: string) => {
    setSearchInput(val);
    setParam('search', val || null);
  };

  type StatCard = {
    label: string;
    value: number;
    decimals: number;
    accent?: string;
  };

  const summary = summaryQuery.data;

  const statCards: StatCard[] = useMemo(
    () => [
      { label: 'ร่าง', value: Number(summary?.draft ?? 0), decimals: 0 },
      {
        label: 'ลงบัญชี',
        value: Number(summary?.posted ?? 0),
        decimals: 0,
        accent: 'text-primary',
      },
      { label: 'กลับรายการ', value: Number(summary?.reversed ?? 0), decimals: 0 },
      { label: 'จำหน่าย', value: Number(summary?.disposed ?? 0), decimals: 0 },
      { label: 'ตัดบัญชี', value: Number(summary?.writtenOff ?? 0), decimals: 0 },
      {
        label: 'ยอดทุนรวม (POSTED)',
        value: Number(summary?.totalPurchaseCost ?? 0),
        decimals: 2,
        accent: 'text-foreground',
      },
      {
        label: 'NBV รวม',
        value: Number(summary?.totalNetBookValue ?? 0),
        decimals: 2,
        accent: 'text-primary',
      },
    ],
    [summary],
  );

  const columns = useMemo(
    () => [
      {
        key: 'assetCode',
        label: 'รหัส',
        render: (row: Asset): ReactNode => (
          <button
            onClick={() => navigate(`/assets/${row.id}`)}
            className="font-mono text-primary hover:underline"
          >
            {row.assetCode}
          </button>
        ),
      },
      {
        key: 'name',
        label: 'ชื่อ',
        render: (row: Asset): ReactNode => (
          <div className="min-w-0">
            <div className="font-medium truncate">{row.name}</div>
            {row.serialNo && (
              <div className="text-xs text-muted-foreground truncate">
                S/N: {row.serialNo}
              </div>
            )}
          </div>
        ),
      },
      {
        key: 'category',
        label: 'หมวด',
        render: (row: Asset): ReactNode => (
          <span className="text-sm text-muted-foreground">
            {CATEGORY_LABEL[row.category]}
          </span>
        ),
      },
      {
        key: 'purchaseCost',
        label: 'ราคาทุน',
        render: (row: Asset): ReactNode => (
          <div className="text-right tabular-nums">
            {formatNumberDecimal(row.purchaseCost)}
          </div>
        ),
      },
      {
        key: 'custodian',
        label: 'ผู้ดูแล',
        render: (row: Asset): ReactNode => row.custodian ?? '-',
      },
      {
        key: 'purchaseDate',
        label: 'วันที่ซื้อ',
        render: (row: Asset): ReactNode => formatDateShortThai(row.purchaseDate),
      },
      {
        key: 'status',
        label: 'สถานะ',
        render: (row: Asset): ReactNode => <AssetStatusBadge status={row.status} />,
      },
      {
        key: 'actions',
        label: '',
        sortable: false,
        render: (row: Asset): ReactNode => (
          <div className="flex items-center gap-1">
            {row.status === 'DRAFT' && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  mode="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/assets/${row.id}/edit`);
                  }}
                  aria-label="แก้ไข"
                >
                  <Edit className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  mode="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteId(row.id);
                  }}
                  aria-label="ลบ"
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              size="icon"
              mode="icon"
              onClick={(e) => {
                e.stopPropagation();
                copyMutation.mutate(row.id);
              }}
              disabled={copyMutation.isPending}
              aria-label="คัดลอก"
            >
              <Copy className="size-4" />
            </Button>
          </div>
        ),
      },
    ],
    [navigate, copyMutation],
  );

  const totalPages = listQuery.data
    ? Math.max(1, Math.ceil(listQuery.data.total / PAGE_SIZE))
    : 1;

  return (
    <div className="space-y-4">
      <PageHeader
        title="สินทรัพย์"
        subtitle={`ทั้งหมด ${listQuery.data?.total ?? 0} รายการ`}
        icon={<Boxes className="size-5" />}
        action={
          <Button variant="primary" size="md" onClick={() => navigate('/assets/new')}>
            <Plus className="size-4" /> สินทรัพย์ใหม่
          </Button>
        }
      />

      {/* Stat cards: 5 status counts + totalPurchaseCost + totalNetBookValue */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {statCards.map((card) => (
          <Card key={card.label} className="rounded-xl border border-border/50 bg-card shadow-sm">
            <CardContent className="p-4">
              <div className="text-xs font-medium text-muted-foreground mb-2">
                {card.label}
              </div>
              <AnimatedCounter
                value={card.value}
                decimals={card.decimals}
                className={`text-xl font-bold tabular-nums ${card.accent ?? 'text-foreground'}`}
              />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card className="rounded-xl border border-border/50 bg-card shadow-sm">
        <CardContent className="p-4 flex flex-col md:flex-row gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              className="pl-10"
              placeholder="ค้นหาชื่อ / รหัส / serial"
              value={searchInput}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>
          <Select
            value={category || 'ALL'}
            onValueChange={(v) => setParam('category', v === 'ALL' ? null : v)}
          >
            <SelectTrigger className="w-full md:w-48">
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
          <Select
            value={status || 'ALL'}
            onValueChange={(v) => setParam('status', v === 'ALL' ? null : v)}
          >
            <SelectTrigger className="w-full md:w-48">
              <SelectValue placeholder="สถานะ" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">ทุกสถานะ</SelectItem>
              <SelectItem value="DRAFT">ร่าง</SelectItem>
              <SelectItem value="POSTED">ลงบัญชีแล้ว</SelectItem>
              <SelectItem value="REVERSED">กลับรายการ</SelectItem>
              <SelectItem value="DISPOSED">จำหน่าย</SelectItem>
              <SelectItem value="WRITTEN_OFF">ตัดบัญชี</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <QueryBoundary
        isLoading={listQuery.isLoading && !listQuery.data}
        isError={listQuery.isError}
        error={listQuery.error}
        onRetry={listQuery.refetch}
        errorTitle="ไม่สามารถโหลดรายการสินทรัพย์ได้"
      >
        <DataTable
          columns={columns}
          data={listQuery.data?.data ?? []}
          isLoading={listQuery.isFetching && !listQuery.data}
          emptyMessage="ยังไม่มีสินทรัพย์"
          emptyDescription="เริ่มต้นด้วยการสร้างสินทรัพย์ใหม่"
          pagination={
            listQuery.data && listQuery.data.total > PAGE_SIZE
              ? {
                  page,
                  totalPages,
                  total: listQuery.data.total,
                  onPageChange: (p) => setParam('page', String(p)),
                }
              : undefined
          }
        />
      </QueryBoundary>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="ลบสินทรัพย์?"
        description="การลบสินทรัพย์จะไม่สามารถกู้คืนได้ (DRAFT เท่านั้น)"
        variant="destructive"
        confirmLabel="ลบ"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
      />
    </div>
  );
}
