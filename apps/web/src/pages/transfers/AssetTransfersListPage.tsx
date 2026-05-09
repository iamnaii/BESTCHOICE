import { useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Search, ArrowRightLeft } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import DataTable, { type Column } from '@/components/ui/DataTable';
import QueryBoundary from '@/components/QueryBoundary';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { useDebounce } from '@/hooks/useDebounce';
import { formatDateShortThai } from '@/utils/formatters';
import api from '@/lib/api';
import { assetsApi } from '../assets/api';
import type { AssetTransferRow } from '../assets/types';

interface Branch {
  id: string;
  name: string;
}

export default function AssetTransfersListPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [searchInput, setSearchInput] = useState(searchParams.get('search') ?? '');
  const search = useDebounce(searchInput, 300);
  const custodianInput = searchParams.get('custodian') ?? '';
  const branchId = searchParams.get('branchId') ?? '';
  const fromDate = searchParams.get('fromDate') ?? '';
  const toDate = searchParams.get('toDate') ?? '';
  const page = Number(searchParams.get('page') ?? 1);

  const branchesQuery = useQuery({
    queryKey: ['branches'],
    queryFn: async () => (await api.get<Branch[]>('/branches')).data,
  });

  const listQuery = useQuery({
    queryKey: ['asset-transfers', { search, custodianInput, branchId, fromDate, toDate, page }],
    queryFn: () =>
      assetsApi.listAllTransfers({
        search: search || undefined,
        custodianContains: custodianInput || undefined,
        branchId: branchId || undefined,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
        page,
        limit: 50,
      }),
  });

  const setParam = (key: string, val: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (val) next.set(key, val);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setSearchParams(next);
  };

  const columns = useMemo<Column<AssetTransferRow>[]>(
    () => [
      {
        key: 'transferDate',
        label: 'วันที่โอน',
        render: (row) => formatDateShortThai(row.transferDate),
      },
      {
        key: 'asset',
        label: 'รหัส/ชื่อสินทรัพย์',
        render: (row) => (
          <button
            type="button"
            onClick={() => navigate(`/assets/${row.asset.id}`)}
            className="text-left hover:underline"
          >
            <span className="font-mono text-primary">{row.asset.assetCode}</span>
            <div className="text-xs text-muted-foreground">{row.asset.name}</div>
          </button>
        ),
      },
      {
        key: 'custodian',
        label: 'ผู้ดูแล',
        render: (row) =>
          row.fromCustodian !== row.toCustodian ? (
            <span className="text-sm">
              {row.fromCustodian ?? '-'} → <strong>{row.toCustodian ?? '-'}</strong>
            </span>
          ) : (
            <span className="text-muted-foreground text-sm">{row.toCustodian ?? '-'}</span>
          ),
      },
      {
        key: 'location',
        label: 'ที่ตั้ง',
        render: (row) =>
          row.fromLocation !== row.toLocation ? (
            <span className="text-sm">
              {row.fromLocation ?? '-'} → <strong>{row.toLocation ?? '-'}</strong>
            </span>
          ) : (
            <span className="text-muted-foreground text-sm">{row.toLocation ?? '-'}</span>
          ),
      },
      {
        key: 'reason',
        label: 'เหตุผล',
        render: (row) => <span className="text-sm">{row.reason}</span>,
      },
      {
        key: 'transferredBy',
        label: 'ผู้บันทึก',
        render: (row) => row.transferredBy.name,
      },
    ],
    [navigate],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="ประวัติการโอนสินทรัพย์"
        subtitle="Cross-asset audit view"
        icon={<ArrowRightLeft className="h-5 w-5" />}
        onBack={() => navigate('/assets')}
      />

      <Card>
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-5 gap-3">
          <div className="md:col-span-2 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-10"
              placeholder="ค้นหาสินทรัพย์ (รหัส/ชื่อ/serial)"
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                setParam('search', e.target.value || null);
              }}
            />
          </div>
          <Input
            placeholder="ผู้ดูแล (contains)"
            value={custodianInput}
            onChange={(e) => setParam('custodian', e.target.value || null)}
          />
          <ThaiDateInput
            value={fromDate}
            onChange={(e) => setParam('fromDate', e.target.value || null)}
          />
          <ThaiDateInput
            value={toDate}
            onChange={(e) => setParam('toDate', e.target.value || null)}
          />
          {branchesQuery.data && (
            <Select
              value={branchId || 'ALL'}
              onValueChange={(v) => setParam('branchId', v === 'ALL' ? null : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="สาขา" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">ทุกสาขา</SelectItem>
                {branchesQuery.data.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </CardContent>
      </Card>

      <QueryBoundary
        isLoading={listQuery.isLoading}
        isError={listQuery.isError}
        error={listQuery.error}
        onRetry={() => listQuery.refetch()}
        errorTitle="โหลดประวัติการโอนไม่สำเร็จ"
      >
        <DataTable<AssetTransferRow>
          columns={columns}
          data={listQuery.data?.data ?? []}
          pagination={{
            page,
            totalPages: listQuery.data ? Math.max(1, Math.ceil(listQuery.data.total / 50)) : 1,
            total: listQuery.data?.total ?? 0,
            onPageChange: (p: number) => setParam('page', String(p)),
          }}
        />
      </QueryBoundary>
    </div>
  );
}
