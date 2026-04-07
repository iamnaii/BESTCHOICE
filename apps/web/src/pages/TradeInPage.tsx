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
import { brands, getModels } from '@/data/productCatalog';

/** Map color name (English/Thai) to a hex value for preview swatches */
function colorNameToHex(name: string): string {
  const n = name.toLowerCase().trim();
  const map: Record<string, string> = {
    black: '#1a1a1a', 'space black': '#1c1c1e', 'black titanium': '#3a3a3c',
    'jet black': '#0a0a0a', 'midnight': '#171821', graphite: '#54524f',
    white: '#f5f5f7', 'cloud white': '#f8f8f8', 'white titanium': '#e8e8e8',
    silver: '#c0c0c0', 'starlight': '#faf6ef',
    gold: '#f7e7ce', 'light gold': '#fce8c8', rose: '#f7d4d4', 'rose gold': '#e8b4a8',
    blue: '#5b8def', 'sky blue': '#87ceeb', 'pacific blue': '#2e4a6b',
    'deep blue': '#1e3a8a', 'mist blue': '#a8c5d6', 'sierra blue': '#a7c1d9',
    'desert titanium': '#cdb692', 'natural titanium': '#a39a8e',
    purple: '#a78bfa', 'deep purple': '#5d4e7b', lavender: '#c8b2dd',
    pink: '#ffb6c1', 'cosmic orange': '#ff6b35', orange: '#ff9500',
    red: '#ff3b30', 'product red': '#cc0000',
    green: '#34c759', sage: '#bcd5ba', mint: '#a8e6cf', 'alpine green': '#576856',
    yellow: '#ffd60a', teal: '#5ac8fa', ultramarine: '#5e60ce',
  };
  for (const [key, val] of Object.entries(map)) {
    if (n.includes(key)) return val;
  }
  return '#9ca3af'; // gray fallback
}

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
    deviceColor: '',
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
        deviceModel: form.deviceColor ? `${form.deviceModel} - ${form.deviceColor}` : form.deviceModel,
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
    setForm({ customerId: '', deviceBrand: '', deviceModel: '', deviceStorage: '', deviceColor: '', deviceCondition: '', imei: '', estimatedValue: '' });
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

      {/* Create Modal — full-screen overlay */}
      {showCreate && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-start justify-center pt-8 pb-8" role="dialog" aria-modal="true" aria-label="สร้างรายการรับซื้อ">
          <div className="w-full max-w-2xl bg-background rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[calc(100vh-4rem)]">
            {/* Sticky Header */}
            <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b px-6 py-4 flex items-center justify-between shrink-0">
              <button type="button" onClick={() => { setShowCreate(false); resetForm(); }} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                กลับ
              </button>
              <h2 className="text-lg font-semibold text-foreground">สร้างรายการรับซื้อ</h2>
              <div className="w-16" />
            </div>

            <form onSubmit={handleCreate} className="flex-1 overflow-y-auto flex flex-col">
              <div className="p-6 space-y-5 flex-1">

                {/* Section: ลูกค้า */}
                <div className="rounded-xl border border-border bg-card p-5">
                  <div className="flex items-center gap-2.5 mb-4">
                    <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary">
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">ลูกค้า</h3>
                      <p className="text-xs text-muted-foreground">เลือกลูกค้าที่จะรับซื้อเครื่อง</p>
                    </div>
                  </div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">ลูกค้า <span className="text-destructive">*</span></label>
                  {form.customerId ? (
                    <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/5">
                      <CheckCircle className="size-4 text-emerald-500 shrink-0" />
                      <span className="flex-1 text-sm font-medium text-foreground">
                        {customers.find((c) => c.id === form.customerId)?.name || 'เลือกแล้ว'}
                      </span>
                      <button type="button" onClick={() => setForm((f) => ({ ...f, customerId: '' }))} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                        เปลี่ยน
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                      <input
                        type="text"
                        className="w-full h-10 pl-9 pr-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                        placeholder="ค้นหาชื่อ / เบอร์โทร..."
                        value={customerSearch}
                        onChange={(e) => setCustomerSearch(e.target.value)}
                      />
                      {customers.length > 0 && (
                        <div className="absolute z-10 mt-1 w-full bg-popover border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
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

                {/* Section: ข้อมูลเครื่อง */}
                <div className="rounded-xl border border-border bg-card p-5">
                  <div className="flex items-center gap-2.5 mb-4">
                    <div className="flex items-center justify-center size-8 rounded-lg bg-violet-500/10 text-violet-500">
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/></svg>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">ข้อมูลเครื่อง</h3>
                      <p className="text-xs text-muted-foreground">เลือกตามลำดับ: ยี่ห้อ → รุ่น → ความจุ → สี</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1.5">ยี่ห้อ <span className="text-destructive">*</span></label>
                      <select
                        className="w-full h-10 rounded-lg border border-input bg-background px-3 text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                        value={form.deviceBrand}
                        onChange={(e) => setForm((f) => ({ ...f, deviceBrand: e.target.value, deviceModel: '', deviceStorage: '', deviceColor: '' }))}
                      >
                        <option value="">-- เลือกยี่ห้อ --</option>
                        {brands.map((b) => (
                          <option key={b} value={b}>{b}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1.5">รุ่น <span className="text-destructive">*</span></label>
                      <select
                        className="w-full h-10 rounded-lg border border-input bg-background px-3 text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50 disabled:cursor-not-allowed"
                        value={form.deviceModel}
                        onChange={(e) => setForm((f) => ({ ...f, deviceModel: e.target.value, deviceStorage: '', deviceColor: '' }))}
                        disabled={!form.deviceBrand}
                      >
                        <option value="">-- เลือกรุ่น --</option>
                        {form.deviceBrand && getModels(form.deviceBrand).map((m) => (
                          <option key={m.name} value={m.name}>{m.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1.5">ความจุ</label>
                      <select
                        className="w-full h-10 rounded-lg border border-input bg-background px-3 text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50 disabled:cursor-not-allowed"
                        value={form.deviceStorage}
                        onChange={(e) => setForm((f) => ({ ...f, deviceStorage: e.target.value }))}
                        disabled={!form.deviceModel}
                      >
                        <option value="">-- เลือกความจุ --</option>
                        {form.deviceBrand && form.deviceModel &&
                          (getModels(form.deviceBrand).find((m) => m.name === form.deviceModel)?.storage || []).map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))
                        }
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1.5">สี</label>
                      <div className="relative">
                        <select
                          className="w-full h-10 rounded-lg border border-input bg-background pl-10 pr-3 text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50 disabled:cursor-not-allowed"
                          value={form.deviceColor}
                          onChange={(e) => setForm((f) => ({ ...f, deviceColor: e.target.value }))}
                          disabled={!form.deviceModel}
                        >
                          <option value="">-- เลือกสี --</option>
                          {form.deviceBrand && form.deviceModel &&
                            (getModels(form.deviceBrand).find((m) => m.name === form.deviceModel)?.colors || []).map((c) => (
                              <option key={c} value={c}>{c}</option>
                            ))
                          }
                        </select>
                        {form.deviceColor && (
                          <span
                            className="absolute left-3 top-1/2 -translate-y-1/2 size-5 rounded-full border border-border shadow-sm pointer-events-none"
                            style={{ backgroundColor: colorNameToHex(form.deviceColor) }}
                            title={form.deviceColor}
                          />
                        )}
                        {!form.deviceColor && (
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 size-5 rounded-full border border-dashed border-border pointer-events-none" />
                        )}
                      </div>
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-foreground mb-1.5">สภาพเครื่อง</label>
                      <select
                        className="w-full h-10 rounded-lg border border-input bg-background px-3 text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                        value={form.deviceCondition}
                        onChange={(e) => setForm((f) => ({ ...f, deviceCondition: e.target.value }))}
                      >
                        <option value="">-- เลือกสภาพ --</option>
                        {conditionOptions.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Section: IMEI + ราคา */}
                <div className="rounded-xl border border-border bg-card p-5">
                  <div className="flex items-center gap-2.5 mb-4">
                    <div className="flex items-center justify-center size-8 rounded-lg bg-emerald-500/10 text-emerald-500">
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">IMEI และราคาประเมิน</h3>
                      <p className="text-xs text-muted-foreground">หมายเลขเครื่อง + ราคารับซื้อเบื้องต้น</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1.5">IMEI</label>
                      <input
                        type="text"
                        className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm font-mono transition-colors hover:border-primary/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                        placeholder="หมายเลข IMEI 15 หลัก"
                        value={form.imei}
                        onChange={(e) => setForm((f) => ({ ...f, imei: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1.5">ราคาประเมินเบื้องต้น (บาท)</label>
                      <input
                        type="number"
                        className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                        placeholder="0"
                        value={form.estimatedValue}
                        onChange={(e) => setForm((f) => ({ ...f, estimatedValue: e.target.value }))}
                      />
                    </div>
                  </div>
                </div>

              </div>

              {/* Sticky Footer */}
              <div className="sticky bottom-0 bg-background/95 backdrop-blur-sm border-t px-6 py-4 flex justify-end gap-3 shrink-0">
                <button type="button" onClick={() => { setShowCreate(false); resetForm(); }} className="px-6 py-2.5 text-sm border border-input rounded-lg hover:bg-muted transition-colors">
                  ยกเลิก
                </button>
                <button type="submit" disabled={createMutation.isPending} className="px-6 py-2.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 font-semibold transition-colors shadow-sm">
                  {createMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
