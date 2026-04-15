import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Button } from '@/components/ui/button';
import AnimatedCounter from '@/components/ui/animated-counter';
import { Building2, Plus, Play, Package, TrendingDown, Banknote, Calculator } from 'lucide-react';

import AssetTable from './components/AssetTable';
import AssetForm from './components/AssetForm';
import DepreciationPanel from './components/DepreciationPanel';
import { Asset, AssetSummary, Branch, emptyForm } from './types';

export default function AssetManagementPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isOwner = user?.role === 'OWNER';
  const isOwnerOrManager = ['OWNER', 'BRANCH_MANAGER'].includes(user?.role ?? '');
  const canRunDepreciation = ['OWNER', 'FINANCE_MANAGER'].includes(user?.role ?? '');

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const debouncedSearch = useDebounce(search);

  const [showModal, setShowModal] = useState(false);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [form, setForm] = useState(emptyForm);

  const [viewAsset, setViewAsset] = useState<Asset | null>(null);
  const [disposeTarget, setDisposeTarget] = useState<Asset | null>(null);

  // ─── Queries ───
  const { data: assetsData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['assets', page, debouncedSearch, statusFilter, categoryFilter],
    queryFn: () =>
      api
        .get('/assets', {
          params: {
            page,
            limit: 20,
            search: debouncedSearch || undefined,
            status: statusFilter || undefined,
            category: categoryFilter || undefined,
          },
        })
        .then((r) => r.data),
  });

  const { data: summary } = useQuery<AssetSummary>({
    queryKey: ['assets', 'summary'],
    queryFn: () => api.get('/assets/summary').then((r) => r.data),
  });

  const { data: branches } = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn: () => api.get('/branches').then((r) => r.data?.data ?? r.data),
  });

  const assets: Asset[] = assetsData?.data ?? [];
  const totalPages = assetsData?.totalPages ?? 1;
  const total = assetsData?.total ?? 0;

  // ─── Mutations ───
  const createMutation = useMutation({
    mutationFn: (data: typeof form) =>
      api.post('/assets', {
        ...data,
        costValue: Number(data.costValue),
        salvageValue: Number(data.salvageValue),
        usefulLife: Number(data.usefulLife),
      }),
    onSuccess: () => {
      toast.success('เพิ่มสินทรัพย์เรียบร้อย');
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      closeModal();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: typeof form }) =>
      api.patch(`/assets/${id}`, {
        ...data,
        costValue: Number(data.costValue),
        salvageValue: Number(data.salvageValue),
        usefulLife: Number(data.usefulLife),
      }),
    onSuccess: () => {
      toast.success('แก้ไขสินทรัพย์เรียบร้อย');
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      closeModal();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const disposeMutation = useMutation({
    mutationFn: (id: string) => api.post(`/assets/${id}/dispose`),
    onSuccess: () => {
      toast.success('จำหน่ายสินทรัพย์เรียบร้อย');
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      setDisposeTarget(null);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const runDepreciationMutation = useMutation({
    mutationFn: () => api.post('/assets/run-depreciation'),
    onSuccess: (res) => {
      const count = res.data?.processedCount ?? 0;
      toast.success(`คำนวณค่าเสื่อมราคาเรียบร้อย (${count} รายการ)`);
      queryClient.invalidateQueries({ queryKey: ['assets'] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  // ─── Handlers ───
  function closeModal() {
    setShowModal(false);
    setEditingAsset(null);
    setForm(emptyForm);
  }

  function openCreate() {
    setEditingAsset(null);
    setForm(emptyForm);
    setShowModal(true);
  }

  function openEdit(asset: Asset) {
    setEditingAsset(asset);
    setForm({
      assetCode: asset.assetCode,
      name: asset.name,
      description: asset.description ?? '',
      category: asset.category,
      branchId: asset.branch?.id ?? '',
      costValue: String(asset.costValue),
      salvageValue: String(asset.salvageValue),
      usefulLife: String(asset.usefulLife),
      purchaseDate: asset.purchaseDate?.split('T')[0] ?? '',
      depreciationAccountCode: '',
      accumulatedDepreAccountCode: '',
      assetAccountCode: '',
    });
    setShowModal(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.assetCode || !form.name || !form.costValue) {
      toast.error('กรุณากรอกข้อมูลที่จำเป็น');
      return;
    }
    if (editingAsset) {
      updateMutation.mutate({ id: editingAsset.id, data: form });
    } else {
      createMutation.mutate(form);
    }
  }

  function setField(field: string, value: string | number | boolean) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleSearchChange(value: string) {
    setSearch(value);
    setPage(1);
  }

  function handleStatusFilterChange(value: string) {
    setStatusFilter(value);
    setPage(1);
  }

  function handleCategoryFilterChange(value: string) {
    setCategoryFilter(value);
    setPage(1);
  }

  // ─── Summary Cards ───
  const summaryCards = useMemo(
    () => [
      {
        label: 'สินทรัพย์ทั้งหมด',
        value: summary?.totalCount ?? 0,
        icon: Package,
        color: 'border-l-primary',
        isCurrency: false,
      },
      {
        label: 'มูลค่ารวม',
        value: summary?.totalCostValue ?? 0,
        icon: Banknote,
        color: 'border-l-blue-500',
        isCurrency: true,
      },
      {
        label: 'ค่าเสื่อมราคาสะสม',
        value: summary?.totalAccumulatedDepreciation ?? 0,
        icon: TrendingDown,
        color: 'border-l-warning',
        isCurrency: true,
      },
      {
        label: 'มูลค่าสุทธิ',
        value: summary?.totalNetBookValue ?? 0,
        icon: Calculator,
        color: 'border-l-success',
        isCurrency: true,
      },
    ],
    [summary],
  );

  // ─── Render ───
  return (
    <div className="p-4 lg:p-6 space-y-6">
      <PageHeader
        title="สินทรัพย์ถาวร"
        subtitle="จัดการสินทรัพย์ถาวรและค่าเสื่อมราคา"
        icon={<Building2 className="size-6" />}
        action={
          <div className="flex items-center gap-2">
            {canRunDepreciation && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => runDepreciationMutation.mutate()}
                disabled={runDepreciationMutation.isPending}
              >
                <Play className="size-4 mr-1.5" />
                {runDepreciationMutation.isPending ? 'กำลังคำนวณ...' : 'คำนวณค่าเสื่อมราคา'}
              </Button>
            )}
            {isOwnerOrManager && (
              <Button size="sm" onClick={openCreate}>
                <Plus className="size-4 mr-1.5" />
                เพิ่มสินทรัพย์
              </Button>
            )}
          </div>
        }
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {summaryCards.map((card) => (
          <Card key={card.label} className={`border-l-4 ${card.color}`}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">{card.label}</p>
                  <div className="text-xl font-bold">
                    <AnimatedCounter
                      value={card.value}
                      prefix={card.isCurrency ? '฿' : ''}
                      decimals={card.isCurrency ? 2 : 0}
                    />
                  </div>
                </div>
                <card.icon className="size-8 text-muted-foreground/30" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Table + Filters */}
      <AssetTable
        assets={assets}
        isLoading={isLoading}
        isError={isError}
        error={error as Error | null}
        onRetry={refetch}
        page={page}
        totalPages={totalPages}
        total={total}
        onPageChange={setPage}
        search={search}
        onSearchChange={handleSearchChange}
        statusFilter={statusFilter}
        onStatusFilterChange={handleStatusFilterChange}
        categoryFilter={categoryFilter}
        onCategoryFilterChange={handleCategoryFilterChange}
        isOwner={isOwner}
        isOwnerOrManager={isOwnerOrManager}
        onView={setViewAsset}
        onEdit={openEdit}
        onDispose={setDisposeTarget}
      />

      {/* Create / Edit Form */}
      {showModal && (
        <AssetForm
          editingAsset={editingAsset}
          form={form}
          branches={branches}
          isPending={createMutation.isPending || updateMutation.isPending}
          onClose={closeModal}
          onSubmit={handleSubmit}
          setField={setField}
        />
      )}

      {/* View Detail Panel */}
      <DepreciationPanel asset={viewAsset} onClose={() => setViewAsset(null)} />

      {/* Dispose Confirm */}
      <ConfirmDialog
        open={!!disposeTarget}
        onOpenChange={(open) => !open && setDisposeTarget(null)}
        title="จำหน่ายสินทรัพย์"
        description={`ยืนยันจำหน่ายสินทรัพย์ "${disposeTarget?.name}" (${disposeTarget?.assetCode})? การดำเนินการนี้ไม่สามารถย้อนกลับได้`}
        confirmLabel="จำหน่าย"
        variant="destructive"
        loading={disposeMutation.isPending}
        onConfirm={() => disposeTarget && disposeMutation.mutate(disposeTarget.id)}
      />
    </div>
  );
}
