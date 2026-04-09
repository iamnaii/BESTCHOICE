import { useState } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { formatThaiDate } from '@/lib/date';
import PageHeader from '@/components/ui/PageHeader';
import DataTable, { type Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useDebounce } from '@/hooks/useDebounce';
import { Zap, Plus, Pencil, Trash2 } from 'lucide-react';
import QueryBoundary from '@/components/QueryBoundary';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

/* ─── Types ─── */

interface Promotion {
  id: string;
  name: string;
  type: string;
  discountValue: number;
  startDate: string;
  endDate: string;
  maxUsage: number | null;
  usageCount: number;
  isActive: boolean;
  conditions: string | null;
  createdAt: string;
}

interface PromotionsResponse {
  data: Promotion[];
  total: number;
  page: number;
  limit: number;
}

const typeLabels: Record<string, string> = {
  PERCENTAGE_DISCOUNT: 'ส่วนลด %',
  FIXED_DISCOUNT: 'ส่วนลดคงที่',
  FREE_GIFT: 'ของแถม',
  SPECIAL_RATE: 'อัตราพิเศษ',
  CASHBACK: 'เงินคืน',
};

const typeBadgeVariant: Record<string, 'primary' | 'secondary' | 'success' | 'warning' | 'outline'> = {
  PERCENTAGE_DISCOUNT: 'primary',
  FIXED_DISCOUNT: 'secondary',
  FREE_GIFT: 'outline',
  SPECIAL_RATE: 'warning',
  CASHBACK: 'success',
};

const emptyForm = {
  name: '',
  type: 'PERCENTAGE_DISCOUNT',
  discountValue: '',
  startDate: '',
  endDate: '',
  maxUsage: '',
  conditions: '',
  isActive: true,
};

/* ─── Component ─── */

export default function PromotionsPage() {
  useDocumentTitle('โปรโมชัน');
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounce(search);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; id: string }>({ open: false, id: '' });

  /* ─── Queries ─── */

  const { data, isLoading, isError, error, refetch } = useQuery<PromotionsResponse>({
    queryKey: ['promotions', page, debouncedSearch],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (debouncedSearch) params.set('search', debouncedSearch);
      return (await api.get(`/promotions?${params}`)).data;
    },
  });

  /* ─── Mutations ─── */

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name,
        type: form.type,
        discountValue: parseFloat(form.discountValue) || 0,
        startDate: form.startDate || undefined,
        endDate: form.endDate || undefined,
        maxUsage: form.maxUsage ? parseInt(form.maxUsage) : undefined,
        conditions: form.conditions || undefined,
        isActive: form.isActive,
      };
      if (editingId) {
        return api.patch(`/promotions/${editingId}`, payload);
      }
      return api.post('/promotions', payload);
    },
    onSuccess: () => {
      toast.success(editingId ? 'แก้ไขโปรโมชันเรียบร้อย' : 'สร้างโปรโมชันเรียบร้อย');
      queryClient.invalidateQueries({ queryKey: ['promotions'] });
      closeModal();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => api.delete(`/promotions/${id}`),
    onSuccess: () => {
      toast.success('ลบโปรโมชันเรียบร้อย');
      queryClient.invalidateQueries({ queryKey: ['promotions'] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  /* ─── Helpers ─── */

  function closeModal() {
    setShowModal(false);
    setEditingId(null);
    setForm(emptyForm);
  }

  function openEdit(promo: Promotion) {
    setEditingId(promo.id);
    setForm({
      name: promo.name,
      type: promo.type,
      discountValue: String(promo.discountValue),
      startDate: promo.startDate ? promo.startDate.slice(0, 10) : '',
      endDate: promo.endDate ? promo.endDate.slice(0, 10) : '',
      maxUsage: promo.maxUsage != null ? String(promo.maxUsage) : '',
      conditions: promo.conditions || '',
      isActive: promo.isActive,
    });
    setShowModal(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('กรุณาระบุชื่อโปรโมชัน');
      return;
    }
    saveMutation.mutate();
  }

  function isPromotionActive(promo: Promotion): boolean {
    if (!promo.isActive) return false;
    const now = new Date();
    if (promo.startDate && new Date(promo.startDate) > now) return false;
    if (promo.endDate && new Date(promo.endDate) < now) return false;
    return true;
  }

  /* ─── Columns ─── */

  const columns: Column<Promotion>[] = [
    {
      key: 'name',
      label: 'ชื่อโปรโมชัน',
      sortable: true,
      render: (item) => (
        <div className="flex items-center gap-2">
          {isPromotionActive(item) && (
            <span className="size-2 rounded-full bg-green-500 shrink-0" title="กำลังใช้งาน" />
          )}
          <span className="font-medium text-foreground">{item.name}</span>
        </div>
      ),
    },
    {
      key: 'type',
      label: 'ประเภท',
      render: (item) => (
        <Badge variant={typeBadgeVariant[item.type] || 'outline'}>
          {typeLabels[item.type] || item.type}
        </Badge>
      ),
    },
    {
      key: 'discountValue',
      label: 'ส่วนลด/อัตรา',
      sortable: true,
      render: (item) => {
        if (item.type === 'PERCENTAGE_DISCOUNT' || item.type === 'SPECIAL_RATE') {
          return <span className="font-medium">{item.discountValue}%</span>;
        }
        return <span className="font-medium">฿{Number(item.discountValue).toLocaleString()}</span>;
      },
    },
    {
      key: 'dateRange',
      label: 'วันที่เริ่ม-สิ้นสุด',
      render: (item) => (
        <span className="text-sm">
          {item.startDate ? formatThaiDate(item.startDate) : '-'}
          {' — '}
          {item.endDate ? formatThaiDate(item.endDate) : 'ไม่จำกัด'}
        </span>
      ),
    },
    {
      key: 'usage',
      label: 'ใช้แล้ว/สูงสุด',
      render: (item) => (
        <span className="text-sm">
          {item.usageCount}
          {item.maxUsage != null ? ` / ${item.maxUsage}` : ' / ∞'}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'สถานะ',
      render: (item) => {
        const active = isPromotionActive(item);
        return (
          <Badge variant={active ? 'secondary' : 'outline'}>
            {active ? 'ใช้งาน' : 'ปิดใช้งาน'}
          </Badge>
        );
      },
    },
    {
      key: 'actions',
      label: '',
      render: (item) => (
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => { e.stopPropagation(); openEdit(item); }}
          >
            <Pencil className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              setDeleteConfirm({ open: true, id: item.id });
            }}
            disabled={deleteMutation.isPending}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  /* ─── Render ─── */

  return (
    <div>
      <PageHeader
        title="โปรโมชัน"
        subtitle="จัดการโปรโมชันและส่วนลด"
        icon={<Zap className="size-5" />}
        action={
          <Button onClick={() => setShowModal(true)}>
            <Plus className="size-4 mr-1.5" />
            สร้างโปรโมชัน
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          <QueryBoundary
            isLoading={isLoading && !data}
            isError={isError}
            error={error}
            onRetry={refetch}
            errorTitle="ไม่สามารถโหลดโปรโมชันได้"
          >
            <DataTable
              columns={columns}
              data={data?.data || []}
              isLoading={isLoading}
              emptyMessage="ไม่พบโปรโมชัน"
              emptyIcon={Zap}
              searchable
              searchPlaceholder="ค้นหาโปรโมชัน..."
              pagination={data ? {
                page: data.page,
                totalPages: Math.ceil(data.total / 50),
                total: data.total,
                onPageChange: setPage,
              } : undefined}
            />
          </QueryBoundary>
        </CardContent>
      </Card>

      {/* Create / Edit Modal */}
      <Modal isOpen={showModal} onClose={closeModal} title={editingId ? 'แก้ไขโปรโมชัน' : 'สร้างโปรโมชัน'} size="lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>ชื่อโปรโมชัน *</Label>
            <Input
              className="mt-1"
              placeholder="เช่น ลดราคา iPhone 15 ต้อนรับปีใหม่"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>ประเภท</Label>
              <select
                className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
              >
                {Object.entries(typeLabels).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>
                {form.type === 'PERCENTAGE_DISCOUNT' || form.type === 'SPECIAL_RATE'
                  ? 'อัตรา (%)'
                  : 'จำนวนเงิน (บาท)'}
              </Label>
              <Input
                className="mt-1"
                type="number"
                step="0.01"
                placeholder="0"
                value={form.discountValue}
                onChange={(e) => setForm((f) => ({ ...f, discountValue: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>วันที่เริ่ม</Label>
              <Input
                className="mt-1"
                type="date"
                value={form.startDate}
                onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
              />
            </div>
            <div>
              <Label>วันที่สิ้นสุด</Label>
              <Input
                className="mt-1"
                type="date"
                value={form.endDate}
                onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>จำนวนใช้สูงสุด</Label>
              <Input
                className="mt-1"
                type="number"
                placeholder="ไม่จำกัด"
                value={form.maxUsage}
                onChange={(e) => setForm((f) => ({ ...f, maxUsage: e.target.value }))}
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer h-10">
                <input
                  type="checkbox"
                  className="rounded border-input"
                  checked={form.isActive}
                  onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                />
                <span className="text-sm">เปิดใช้งาน</span>
              </label>
            </div>
          </div>

          <div>
            <Label>เงื่อนไข / หมายเหตุ</Label>
            <textarea
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px] resize-y"
              placeholder="เงื่อนไขการใช้โปรโมชัน..."
              value={form.conditions}
              onChange={(e) => setForm((f) => ({ ...f, conditions: e.target.value }))}
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={closeModal}>
              ยกเลิก
            </Button>
            <Button type="submit" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'กำลังบันทึก...' : editingId ? 'บันทึกการแก้ไข' : 'สร้างโปรโมชัน'}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={deleteConfirm.open}
        onOpenChange={(open) => setDeleteConfirm((prev) => ({ ...prev, open }))}
        description="ต้องการลบโปรโมชันนี้?"
        variant="destructive"
        onConfirm={() => deleteMutation.mutate(deleteConfirm.id)}
      />
    </div>
  );
}
