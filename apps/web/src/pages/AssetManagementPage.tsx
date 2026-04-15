import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import QueryBoundary from '@/components/QueryBoundary';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getStatusBadgeProps, assetStatusMap } from '@/lib/status-badges';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Button } from '@/components/ui/button';
import AnimatedCounter from '@/components/ui/animated-counter';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import {
  Building2,
  Plus,
  Pencil,
  Trash2,
  Eye,
  Play,
  Package,
  TrendingDown,
  Banknote,
  Calculator,
  ChevronDown,
  ChevronUp,
  ArrowLeft,
  Tag,
  Settings,
} from 'lucide-react';

// ─── Types ───
interface Asset {
  id: string;
  assetCode: string;
  name: string;
  description: string | null;
  category: string;
  costValue: string;
  salvageValue: string;
  usefulLife: number;
  accumulatedDepreciation: string;
  purchaseDate: string;
  status: string;
  branch: { id: string; name: string } | null;
  createdAt: string;
}

interface AssetSummary {
  totalCount: number;
  totalCostValue: number;
  totalAccumulatedDepreciation: number;
  totalNetBookValue: number;
}

interface Branch {
  id: string;
  name: string;
}

// ─── Constants ───
const categoryLabels: Record<string, string> = {
  BUILDING: 'อาคาร',
  VEHICLE: 'ยานพาหนะ',
  EQUIPMENT: 'อุปกรณ์',
  FURNITURE: 'เฟอร์นิเจอร์',
  COMPUTER: 'คอมพิวเตอร์',
  LEASEHOLD: 'สิทธิการเช่า',
  OTHER: 'อื่นๆ',
};

const categoryOptions = Object.entries(categoryLabels).map(([value, label]) => ({ value, label }));

// Status options for filter dropdown — keys match Prisma enum values
const statusFilterOptions: { value: string; label: string }[] = [
  { value: 'ACTIVE', label: 'ใช้งาน' },
  { value: 'FULLY_DEPRECIATED', label: 'หมดค่าเสื่อม' },
  { value: 'DISPOSED', label: 'จำหน่ายแล้ว' },
];

const inputClass =
  'w-full px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden';

function fmt(n: string | number | null | undefined): string {
  if (n == null) return '-';
  return Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const emptyForm = {
  assetCode: '',
  name: '',
  description: '',
  category: 'EQUIPMENT',
  branchId: '',
  costValue: '',
  salvageValue: '0',
  usefulLife: '5',
  purchaseDate: new Date().toISOString().split('T')[0],
  depreciationAccountCode: '',
  accumulatedDepreAccountCode: '',
  assetAccountCode: '',
};

// ─── Component ───
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
  const [showAdvanced, setShowAdvanced] = useState(false);

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
    setShowAdvanced(false);
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

  // ─── Table Columns ───
  const columns = useMemo(
    () => [
      {
        key: 'assetCode',
        label: 'รหัส',
        sortable: true,
        render: (item: Asset) => (
          <span className="font-mono text-xs">{item.assetCode}</span>
        ),
      },
      {
        key: 'name',
        label: 'ชื่อสินทรัพย์',
        sortable: true,
        render: (item: Asset) => (
          <div>
            <div className="font-medium">{item.name}</div>
            {item.description && (
              <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                {item.description}
              </div>
            )}
          </div>
        ),
      },
      {
        key: 'category',
        label: 'หมวดหมู่',
        render: (item: Asset) => (
          <span className="text-sm">{categoryLabels[item.category] ?? item.category}</span>
        ),
      },
      {
        key: 'costValue',
        label: 'ราคาทุน',
        sortable: true,
        render: (item: Asset) => (
          <span className="font-mono text-sm tabular-nums">{fmt(item.costValue)}</span>
        ),
      },
      {
        key: 'accumulatedDepreciation',
        label: 'ค่าเสื่อมสะสม',
        sortable: true,
        render: (item: Asset) => (
          <span className="font-mono text-sm tabular-nums text-warning">
            {fmt(item.accumulatedDepreciation)}
          </span>
        ),
      },
      {
        key: 'netBookValue',
        label: 'มูลค่าสุทธิ',
        sortable: true,
        render: (item: Asset) => {
          const net = Number(item.costValue) - Number(item.accumulatedDepreciation);
          return (
            <span className="font-mono text-sm tabular-nums font-medium">
              {fmt(net)}
            </span>
          );
        },
      },
      {
        key: 'status',
        label: 'สถานะ',
        render: (item: Asset) => {
          const cfg = getStatusBadgeProps(item.status, assetStatusMap);
          return <Badge variant={cfg.variant} appearance={cfg.appearance} size="sm">{cfg.label}</Badge>;
        },
      },
      {
        key: 'actions',
        label: '',
        render: (item: Asset) => (
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setViewAsset(item);
              }}
              className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground"
              title="ดูรายละเอียด"
            >
              <Eye className="size-4" />
            </button>
            {isOwnerOrManager && item.status !== 'DISPOSED' && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  openEdit(item);
                }}
                className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground"
                title="แก้ไข"
              >
                <Pencil className="size-4" />
              </button>
            )}
            {isOwner && item.status === 'ACTIVE' && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setDisposeTarget(item);
                }}
                className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                title="จำหน่าย"
              >
                <Trash2 className="size-4" />
              </button>
            )}
          </div>
        ),
      },
    ],
    [isOwner, isOwnerOrManager],
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

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="ค้นหาชื่อ/รหัสสินทรัพย์..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className={`${inputClass} max-w-xs`}
        />
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className={`${inputClass} max-w-[180px]`}
        >
          <option value="">สถานะทั้งหมด</option>
          {statusFilterOptions.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => {
            setCategoryFilter(e.target.value);
            setPage(1);
          }}
          className={`${inputClass} max-w-[180px]`}
        >
          <option value="">หมวดหมู่ทั้งหมด</option>
          {categoryOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Data Table */}
      <QueryBoundary
        isLoading={isLoading && !assetsData}
        isError={isError}
        error={error}
        onRetry={refetch}
        errorTitle="ไม่สามารถโหลดข้อมูลสินทรัพย์ได้"
      >
        <DataTable
          columns={columns}
          data={assets}
          isLoading={isLoading}
          emptyMessage="ไม่พบสินทรัพย์"
          emptyIcon={Building2}
          emptyDescription="ยังไม่มีข้อมูลสินทรัพย์ถาวร"
          pagination={{
            page,
            totalPages,
            total,
            onPageChange: setPage,
          }}
        />
      </QueryBoundary>

      {/* Create / Edit Full-Screen Form */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-start justify-center pt-8 pb-8">
          <div className="w-full max-w-4xl bg-background rounded-xl shadow-2xl overflow-y-auto max-h-[calc(100vh-4rem)]">
            {/* Sticky Header */}
            <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-xs border-b px-6 py-4 flex items-center justify-between">
              <button onClick={closeModal} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
                <ArrowLeft className="size-4" /> กลับ
              </button>
              <h2 className="text-lg font-semibold text-foreground">{editingAsset ? 'แก้ไขสินทรัพย์' : 'เพิ่มสินทรัพย์ใหม่'}</h2>
              <div className="w-16" />
            </div>

            <form id="asset-form" onSubmit={handleSubmit} className="p-6 space-y-5">
              {/* Section 1: ข้อมูลสินทรัพย์ */}
              <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center gap-2.5 mb-4">
                  <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary">
                    <Package className="size-4" strokeWidth={1.5} />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">ข้อมูลสินทรัพย์</h3>
                    <p className="text-xs text-muted-foreground">รหัส, ชื่อ, รายละเอียด</p>
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1.5">
                        รหัสสินทรัพย์ <span className="text-destructive">*</span>
                      </label>
                      <div className="flex gap-2">
                        <input
                          className={`${inputClass} flex-1`}
                          value={form.assetCode}
                          onChange={(e) => setField('assetCode', e.target.value)}
                          placeholder="เช่น FA-001"
                          required
                        />
                        <button
                          type="button"
                          onClick={() => setField('assetCode', `FA-${String(Date.now()).slice(-6)}`)}
                          className="px-3 py-2 text-xs font-medium bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors whitespace-nowrap"
                        >
                          สร้างอัตโนมัติ
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1.5">
                        ชื่อสินทรัพย์ <span className="text-destructive">*</span>
                      </label>
                      <input
                        className={inputClass}
                        value={form.name}
                        onChange={(e) => setField('name', e.target.value)}
                        placeholder="ชื่อสินทรัพย์"
                        required
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1.5">รายละเอียด</label>
                    <textarea
                      className={`${inputClass} resize-none`}
                      value={form.description}
                      onChange={(e) => setField('description', e.target.value)}
                      placeholder="รายละเอียดเพิ่มเติม (ถ้ามี)"
                      rows={2}
                    />
                  </div>
                </div>
              </div>

              {/* Section 2: การจัดหมวดหมู่ */}
              <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center gap-2.5 mb-4">
                  <div className="flex items-center justify-center size-8 rounded-lg bg-orange-500/10 text-orange-500">
                    <Tag className="size-4" strokeWidth={1.5} />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">การจัดหมวดหมู่</h3>
                    <p className="text-xs text-muted-foreground">หมวดหมู่, สาขา</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1.5">หมวดหมู่</label>
                    <select
                      className={inputClass}
                      value={form.category}
                      onChange={(e) => setField('category', e.target.value)}
                    >
                      {categoryOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1.5">สาขา</label>
                    <select
                      className={inputClass}
                      value={form.branchId}
                      onChange={(e) => setField('branchId', e.target.value)}
                    >
                      <option value="">-- เลือกสาขา --</option>
                      {(branches ?? []).map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Section 3: ข้อมูลทางการเงิน */}
              <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center gap-2.5 mb-4">
                  <div className="flex items-center justify-center size-8 rounded-lg bg-emerald-500/10 text-emerald-500">
                    <Calculator className="size-4" strokeWidth={1.5} />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">ข้อมูลทางการเงิน</h3>
                    <p className="text-xs text-muted-foreground">ราคาทุน, มูลค่าซาก, อายุใช้งาน</p>
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1.5">
                        ราคาทุน (บาท) <span className="text-destructive">*</span>
                      </label>
                      <input
                        type="number"
                        className={inputClass}
                        value={form.costValue}
                        onChange={(e) => setField('costValue', e.target.value)}
                        placeholder="0.00"
                        min="0"
                        step="0.01"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1.5">มูลค่าซาก (บาท)</label>
                      <input
                        type="number"
                        className={inputClass}
                        value={form.salvageValue}
                        onChange={(e) => setField('salvageValue', e.target.value)}
                        placeholder="0.00"
                        min="0"
                        step="0.01"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1.5">อายุใช้งาน (ปี)</label>
                      <input
                        type="number"
                        className={inputClass}
                        value={form.usefulLife}
                        onChange={(e) => setField('usefulLife', e.target.value)}
                        placeholder="5"
                        min="1"
                      />
                    </div>
                  </div>
                  <div className="max-w-xs">
                    <label className="block text-xs font-medium text-foreground mb-1.5">วันที่ซื้อ</label>
                    <ThaiDateInput
                      value={form.purchaseDate}
                      onChange={(e) => setField('purchaseDate', e.target.value)}
                      className={inputClass}
                    />
                  </div>

                  {/* Live depreciation summary */}
                  {Number(form.costValue) > 0 && Number(form.usefulLife) > 0 && (
                    <div className="bg-linear-to-br from-emerald-500/5 to-emerald-500/10 dark:from-emerald-500/10 dark:to-emerald-500/15 rounded-xl p-4 space-y-2 text-sm border border-emerald-500/15">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">ราคาทุน</span>
                        <span className="font-medium">{fmt(form.costValue)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">มูลค่าซาก</span>
                        <span className="font-medium">{fmt(form.salvageValue || '0')}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">มูลค่าเสื่อมราคาได้</span>
                        <span className="font-medium">
                          {fmt(Number(form.costValue) - Number(form.salvageValue || 0))}
                        </span>
                      </div>
                      <div className="border-t border-emerald-500/20 pt-2.5 mt-1 space-y-1.5">
                        <div className="flex justify-between font-bold">
                          <span className="text-emerald-600 dark:text-emerald-400">ค่าเสื่อมราคาต่อปี</span>
                          <span className="text-emerald-600 dark:text-emerald-400">
                            {fmt((Number(form.costValue) - Number(form.salvageValue || 0)) / Number(form.usefulLife))}
                          </span>
                        </div>
                        <div className="flex justify-between font-bold text-lg">
                          <span className="text-emerald-600 dark:text-emerald-400">ค่าเสื่อมราคาต่อเดือน</span>
                          <span className="text-emerald-600 dark:text-emerald-400">
                            {fmt((Number(form.costValue) - Number(form.salvageValue || 0)) / Number(form.usefulLife) / 12)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Section 4: รหัสบัญชี (ขั้นสูง) — collapsible */}
              <div className="rounded-xl border border-border bg-card p-5">
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center gap-2.5 w-full text-left"
                >
                  <div className="flex items-center justify-center size-8 rounded-lg bg-slate-500/10 text-slate-500">
                    <Settings className="size-4" strokeWidth={1.5} />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold text-foreground">รหัสบัญชี (ขั้นสูง)</h3>
                    <p className="text-xs text-muted-foreground">รหัสบัญชีสินทรัพย์, ค่าเสื่อม, ค่าเสื่อมสะสม</p>
                  </div>
                  {showAdvanced ? (
                    <ChevronUp className="size-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="size-4 text-muted-foreground" />
                  )}
                </button>
                {showAdvanced && (
                  <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-border">
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1.5">รหัสบัญชีสินทรัพย์</label>
                      <select className={inputClass} value={form.assetAccountCode} onChange={(e) => setField('assetAccountCode', e.target.value)}>
                        <option value="">-- เลือก --</option>
                        <optgroup label="อุปกรณ์สำนักงาน">
                          <option value="12-2101">12-2101 อุปกรณ์สำนักงาน</option>
                        </optgroup>
                        <optgroup label="ส่วนปรับปรุงอาคาร">
                          <option value="12-2103">12-2103 ส่วนปรับปรุงอาคาร</option>
                        </optgroup>
                        <optgroup label="เครื่องตกแต่ง">
                          <option value="12-2105">12-2105 เครื่องตกแต่งสำนักงาน</option>
                        </optgroup>
                        <optgroup label="ยานพาหนะ">
                          <option value="12-2107">12-2107 ยานพาหนะ</option>
                        </optgroup>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1.5">รหัสบัญชีค่าเสื่อม</label>
                      <select className={inputClass} value={form.depreciationAccountCode} onChange={(e) => setField('depreciationAccountCode', e.target.value)}>
                        <option value="">-- เลือก --</option>
                        <option value="53-1601">53-1601 ค่าเสื่อมราคา - อุปกรณ์สำนักงาน</option>
                        <option value="53-1602">53-1602 ค่าเสื่อมราคา - ส่วนปรับปรุงอาคาร</option>
                        <option value="53-1603">53-1603 ค่าเสื่อมราคา - เครื่องตกแต่ง</option>
                        <option value="53-1604">53-1604 ค่าเสื่อมราคา - ยานพาหนะ</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1.5">รหัสบัญชีค่าเสื่อมสะสม</label>
                      <select className={inputClass} value={form.accumulatedDepreAccountCode} onChange={(e) => setField('accumulatedDepreAccountCode', e.target.value)}>
                        <option value="">-- เลือก --</option>
                        <option value="12-2102">12-2102 ค่าเสื่อมสะสม - อุปกรณ์สำนักงาน</option>
                        <option value="12-2104">12-2104 ค่าเสื่อมสะสม - ส่วนปรับปรุงอาคาร</option>
                        <option value="12-2106">12-2106 ค่าเสื่อมสะสม - เครื่องตกแต่ง</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
            </form>

            {/* Sticky Footer Buttons */}
            <div className="sticky bottom-0 bg-background border-t border-border px-6 py-4 flex items-center justify-end gap-3">
              <Button variant="ghost" onClick={closeModal}>
                ยกเลิก
              </Button>
              <Button
                type="submit"
                form="asset-form"
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {createMutation.isPending || updateMutation.isPending
                  ? 'กำลังบันทึก...'
                  : editingAsset
                    ? 'บันทึกการแก้ไข'
                    : 'เพิ่มสินทรัพย์'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* View Detail Modal */}
      <Modal
        isOpen={!!viewAsset}
        onClose={() => setViewAsset(null)}
        title="รายละเอียดสินทรัพย์"
        size="lg"
      >
        {viewAsset && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <DetailRow label="รหัส" value={viewAsset.assetCode} />
              <DetailRow label="ชื่อ" value={viewAsset.name} />
              <DetailRow label="หมวดหมู่" value={categoryLabels[viewAsset.category] ?? viewAsset.category} />
              <DetailRow label="สาขา" value={viewAsset.branch?.name ?? '-'} />
              <DetailRow label="ราคาทุน" value={`฿${fmt(viewAsset.costValue)}`} />
              <DetailRow label="มูลค่าซาก" value={`฿${fmt(viewAsset.salvageValue)}`} />
              <DetailRow label="อายุใช้งาน" value={`${viewAsset.usefulLife} ปี`} />
              <DetailRow
                label="ค่าเสื่อมสะสม"
                value={`฿${fmt(viewAsset.accumulatedDepreciation)}`}
              />
              <DetailRow
                label="มูลค่าสุทธิ"
                value={`฿${fmt(Number(viewAsset.costValue) - Number(viewAsset.accumulatedDepreciation))}`}
              />
              <DetailRow label="วันที่ซื้อ" value={viewAsset.purchaseDate?.split('T')[0] ?? '-'} />
              <DetailRow
                label="สถานะ"
                value={(() => {
                  const cfg = getStatusBadgeProps(viewAsset.status, assetStatusMap);
                  return <Badge variant={cfg.variant} appearance={cfg.appearance} size="sm">{cfg.label}</Badge>;
                })()}
              />
            </div>
            {viewAsset.description && (
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">รายละเอียด</p>
                <p className="text-sm">{viewAsset.description}</p>
              </div>
            )}
          </div>
        )}
      </Modal>

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

// ─── Helper ───
function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}
