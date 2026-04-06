import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import DataTable, { type Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useDebounce } from '@/hooks/useDebounce';
import { useAuth } from '@/contexts/AuthContext';
import { RefreshCw, Plus, Search, CheckCircle, XCircle } from 'lucide-react';

/* ─── Types ─── */

interface TradeIn {
  id: string;
  status: string;
  deviceBrand: string;
  deviceModel: string;
  deviceStorage: string | null;
  deviceCondition: string | null;
  imei: string | null;
  estimatedValue: number | null;
  appraisedValue: number | null;
  createdAt: string;
  customer: { id: string; name: string };
}

interface TradeInsResponse {
  data: TradeIn[];
  total: number;
  page: number;
  limit: number;
}

const statusConfig: Record<string, { label: string; variant: 'primary' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline' }> = {
  PENDING_APPRAISAL: { label: 'รอประเมิน', variant: 'warning' },
  APPRAISED: { label: 'ประเมินแล้ว', variant: 'primary' },
  ACCEPTED: { label: 'ยอมรับ', variant: 'success' },
  REJECTED: { label: 'ปฏิเสธ', variant: 'destructive' },
  COMPLETED: { label: 'เสร็จสิ้น', variant: 'secondary' },
};

const conditionOptions = [
  { value: 'EXCELLENT', label: 'ดีเยี่ยม' },
  { value: 'GOOD', label: 'ดี' },
  { value: 'FAIR', label: 'พอใช้' },
  { value: 'POOR', label: 'ไม่ดี' },
];

/* ─── Component ─── */

export default function TradeInPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canManage = ['OWNER', 'BRANCH_MANAGER'].includes(user?.role ?? '');

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounce(search);
  const [showCreate, setShowCreate] = useState(false);
  const [appraiseModal, setAppraiseModal] = useState<TradeIn | null>(null);
  const [appraiseValue, setAppraiseValue] = useState('');

  // Form state
  const [form, setForm] = useState({
    customerId: '',
    deviceBrand: '',
    deviceModel: '',
    deviceStorage: '',
    deviceCondition: '',
    imei: '',
    estimatedValue: '',
  });

  // Customer search for create form
  const [customerSearch, setCustomerSearch] = useState('');
  const debouncedCustomerSearch = useDebounce(customerSearch);
  const { data: customers = [] } = useQuery<{ id: string; name: string; phone: string }[]>({
    queryKey: ['trade-in-customers', debouncedCustomerSearch],
    queryFn: async () => {
      if (!debouncedCustomerSearch || debouncedCustomerSearch.length < 2) return [];
      const res = await api.get(`/customers?search=${encodeURIComponent(debouncedCustomerSearch)}&limit=10`);
      return res.data.data || [];
    },
    enabled: debouncedCustomerSearch.length >= 2,
  });

  /* ─── Queries ─── */

  const { data, isLoading } = useQuery<TradeInsResponse>({
    queryKey: ['trade-ins', page, debouncedSearch],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (debouncedSearch) params.set('search', debouncedSearch);
      return (await api.get(`/trade-ins?${params}`)).data;
    },
  });

  /* ─── Mutations ─── */

  const createMutation = useMutation({
    mutationFn: async () => {
      return api.post('/trade-ins', {
        customerId: form.customerId,
        deviceBrand: form.deviceBrand,
        deviceModel: form.deviceModel,
        deviceStorage: form.deviceStorage || undefined,
        deviceCondition: form.deviceCondition || undefined,
        imei: form.imei || undefined,
        estimatedValue: form.estimatedValue ? parseFloat(form.estimatedValue) : undefined,
      });
    },
    onSuccess: () => {
      toast.success('สร้างรายการรับซื้อเรียบร้อย');
      queryClient.invalidateQueries({ queryKey: ['trade-ins'] });
      setShowCreate(false);
      resetForm();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const appraiseMutation = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: number }) => {
      return api.post(`/trade-ins/${id}/appraise`, { appraisedValue: value });
    },
    onSuccess: () => {
      toast.success('ประเมินราคาเรียบร้อย');
      queryClient.invalidateQueries({ queryKey: ['trade-ins'] });
      setAppraiseModal(null);
      setAppraiseValue('');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const acceptMutation = useMutation({
    mutationFn: async (id: string) => api.post(`/trade-ins/${id}/accept`),
    onSuccess: () => {
      toast.success('ยอมรับการรับซื้อเรียบร้อย');
      queryClient.invalidateQueries({ queryKey: ['trade-ins'] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const rejectMutation = useMutation({
    mutationFn: async (id: string) => api.post(`/trade-ins/${id}/reject`),
    onSuccess: () => {
      toast.success('ปฏิเสธการรับซื้อ');
      queryClient.invalidateQueries({ queryKey: ['trade-ins'] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  /* ─── Helpers ─── */

  function resetForm() {
    setForm({ customerId: '', deviceBrand: '', deviceModel: '', deviceStorage: '', deviceCondition: '', imei: '', estimatedValue: '' });
    setCustomerSearch('');
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.customerId) {
      toast.error('กรุณาเลือกลูกค้า');
      return;
    }
    if (!form.deviceBrand || !form.deviceModel) {
      toast.error('กรุณาระบุยี่ห้อและรุ่น');
      return;
    }
    createMutation.mutate();
  }

  /* ─── Columns ─── */

  const columns: Column<TradeIn>[] = [
    {
      key: 'customer',
      label: 'ลูกค้า',
      sortable: true,
      render: (item) => <span className="font-medium text-foreground">{item.customer.name}</span>,
    },
    {
      key: 'device',
      label: 'อุปกรณ์',
      render: (item) => (
        <span>
          {item.deviceBrand} {item.deviceModel}
          {item.deviceStorage && <span className="text-muted-foreground ml-1">({item.deviceStorage})</span>}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'สถานะ',
      render: (item) => {
        const cfg = statusConfig[item.status] || { label: item.status, variant: 'outline' as const };
        return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
      },
    },
    {
      key: 'estimatedValue',
      label: 'ราคาประเมิน',
      sortable: true,
      render: (item) => {
        const value = item.appraisedValue ?? item.estimatedValue;
        return value != null ? (
          <span className="font-medium">฿{Number(value).toLocaleString()}</span>
        ) : (
          <span className="text-muted-foreground">-</span>
        );
      },
    },
    {
      key: 'createdAt',
      label: 'วันที่',
      sortable: true,
      render: (item) => new Date(item.createdAt).toLocaleDateString('th-TH'),
    },
    {
      key: 'actions',
      label: '',
      render: (item) => (
        <div className="flex items-center gap-1">
          {item.status === 'PENDING_APPRAISAL' && canManage && (
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => { e.stopPropagation(); setAppraiseModal(item); }}
            >
              ประเมิน
            </Button>
          )}
          {item.status === 'APPRAISED' && canManage && (
            <>
              <Button
                size="sm"
                variant="primary"
                onClick={(e) => { e.stopPropagation(); acceptMutation.mutate(item.id); }}
                disabled={acceptMutation.isPending}
              >
                <CheckCircle className="size-3.5 mr-1" />
                ยอมรับ
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={(e) => { e.stopPropagation(); rejectMutation.mutate(item.id); }}
                disabled={rejectMutation.isPending}
              >
                <XCircle className="size-3.5 mr-1" />
                ปฏิเสธ
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  /* ─── Render ─── */

  return (
    <div>
      <PageHeader
        title="รับซื้อเครื่อง"
        subtitle="จัดการรายการรับซื้อเครื่องมือถือ / อุปกรณ์"
        icon={<RefreshCw className="size-5" />}
        action={
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="size-4 mr-1.5" />
            สร้างรายการรับซื้อ
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          <DataTable
            columns={columns}
            data={data?.data || []}
            isLoading={isLoading}
            emptyMessage="ไม่พบรายการรับซื้อ"
            emptyIcon={RefreshCw}
            searchable
            searchPlaceholder="ค้นหาลูกค้า, ยี่ห้อ, รุ่น..."
            pagination={data ? {
              page: data.page,
              totalPages: Math.ceil(data.total / 50),
              total: data.total,
              onPageChange: setPage,
            } : undefined}
          />
        </CardContent>
      </Card>

      {/* Create Modal */}
      <Modal isOpen={showCreate} onClose={() => { setShowCreate(false); resetForm(); }} title="สร้างรายการรับซื้อ" size="lg">
        <form onSubmit={handleCreate} className="space-y-4">
          {/* Customer Search */}
          <div>
            <Label>ลูกค้า *</Label>
            {form.customerId ? (
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="secondary">
                  {customers.find((c) => c.id === form.customerId)?.name || 'เลือกแล้ว'}
                </Badge>
                <Button type="button" variant="ghost" size="sm" onClick={() => setForm((f) => ({ ...f, customerId: '' }))}>
                  เปลี่ยน
                </Button>
              </div>
            ) : (
              <div className="relative mt-1">
                <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="ค้นหาชื่อ / เบอร์โทร..."
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                />
                {customers.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full bg-popover border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {customers.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors"
                        onClick={() => { setForm((f) => ({ ...f, customerId: c.id })); setCustomerSearch(''); }}
                      >
                        <span className="font-medium">{c.name}</span>
                        <span className="text-muted-foreground ml-2">{c.phone}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>ยี่ห้อ *</Label>
              <Input
                className="mt-1"
                placeholder="เช่น Apple, Samsung"
                value={form.deviceBrand}
                onChange={(e) => setForm((f) => ({ ...f, deviceBrand: e.target.value }))}
              />
            </div>
            <div>
              <Label>รุ่น *</Label>
              <Input
                className="mt-1"
                placeholder="เช่น iPhone 15 Pro"
                value={form.deviceModel}
                onChange={(e) => setForm((f) => ({ ...f, deviceModel: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>ความจุ</Label>
              <Input
                className="mt-1"
                placeholder="เช่น 256GB"
                value={form.deviceStorage}
                onChange={(e) => setForm((f) => ({ ...f, deviceStorage: e.target.value }))}
              />
            </div>
            <div>
              <Label>สภาพเครื่อง</Label>
              <select
                className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={form.deviceCondition}
                onChange={(e) => setForm((f) => ({ ...f, deviceCondition: e.target.value }))}
              >
                <option value="">-- เลือก --</option>
                {conditionOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>IMEI</Label>
              <Input
                className="mt-1"
                placeholder="หมายเลข IMEI"
                value={form.imei}
                onChange={(e) => setForm((f) => ({ ...f, imei: e.target.value }))}
              />
            </div>
            <div>
              <Label>ราคาประเมินเบื้องต้น (บาท)</Label>
              <Input
                className="mt-1"
                type="number"
                placeholder="0"
                value={form.estimatedValue}
                onChange={(e) => setForm((f) => ({ ...f, estimatedValue: e.target.value }))}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => { setShowCreate(false); resetForm(); }}>
              ยกเลิก
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Appraise Modal */}
      <Modal isOpen={!!appraiseModal} onClose={() => { setAppraiseModal(null); setAppraiseValue(''); }} title="ประเมินราคาเครื่อง" size="sm">
        {appraiseModal && (
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              <p><strong>อุปกรณ์:</strong> {appraiseModal.deviceBrand} {appraiseModal.deviceModel}</p>
              <p><strong>ลูกค้า:</strong> {appraiseModal.customer.name}</p>
              {appraiseModal.estimatedValue != null && (
                <p><strong>ราคาประเมินเบื้องต้น:</strong> ฿{Number(appraiseModal.estimatedValue).toLocaleString()}</p>
              )}
            </div>
            <div>
              <Label>ราคาประเมิน (บาท) *</Label>
              <Input
                className="mt-1"
                type="number"
                placeholder="0"
                value={appraiseValue}
                onChange={(e) => setAppraiseValue(e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setAppraiseModal(null); setAppraiseValue(''); }}>
                ยกเลิก
              </Button>
              <Button
                onClick={() => {
                  if (!appraiseValue || parseFloat(appraiseValue) <= 0) {
                    toast.error('กรุณาระบุราคาประเมิน');
                    return;
                  }
                  appraiseMutation.mutate({ id: appraiseModal.id, value: parseFloat(appraiseValue) });
                }}
                disabled={appraiseMutation.isPending}
              >
                {appraiseMutation.isPending ? 'กำลังบันทึก...' : 'ยืนยันประเมิน'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
