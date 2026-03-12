import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { categoryLabels } from '@/lib/constants';
import { brands, getModels, getModelInfo } from '@/data/productCatalog';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ReorderPoint {
  id: string;
  brand: string;
  model: string;
  storage: string | null;
  category: string;
  branchId: string;
  minQuantity: number;
  reorderQuantity: number;
  isActive: boolean;
  branch: { id: string; name: string };
  currentStock: number;
  isLow: boolean;
}

interface StockAlert {
  id: string;
  brand: string;
  model: string;
  storage: string | null;
  category: string;
  branchId: string;
  currentStock: number;
  minQuantity: number;
  reorderQuantity: number;
  status: string;
  poId: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

interface LowStockDashboard {
  totalLowStock: number;
  items: {
    reorderPointId: string;
    brand: string;
    model: string;
    storage: string | null;
    category: string;
    branch: { id: string; name: string };
    currentStock: number;
    minQuantity: number;
    reorderQuantity: number;
    hasActiveAlert: boolean;
  }[];
}

interface Branch {
  id: string;
  name: string;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function StockAlertsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isManager = user?.role === 'OWNER' || user?.role === 'BRANCH_MANAGER';

  const [activeTab, setActiveTab] = useState<'dashboard' | 'reorder-points' | 'alerts'>('dashboard');
  const [filterBranch, setFilterBranch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingPoint, setEditingPoint] = useState<ReorderPoint | null>(null);
  const [form, setForm] = useState({
    brand: '',
    model: '',
    storage: '',
    category: 'PHONE_NEW',
    branchId: '',
    minQuantity: '1',
    reorderQuantity: '5',
  });

  // ---- Queries ----

  const { data: branches } = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn: async () => {
      const { data } = await api.get('/branches');
      return data;
    },
  });

  const { data: dashboard } = useQuery<LowStockDashboard>({
    queryKey: ['low-stock-dashboard'],
    queryFn: async () => {
      const { data } = await api.get('/reorder-points/low-stock');
      return data;
    },
  });

  const { data: reorderPoints, isLoading: loadingRP } = useQuery<ReorderPoint[]>({
    queryKey: ['reorder-points', filterBranch],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (filterBranch) params.branchId = filterBranch;
      const { data } = await api.get('/reorder-points', { params });
      return data;
    },
  });

  const { data: alertsData, isLoading: loadingAlerts } = useQuery<{
    data: StockAlert[];
    total: number;
  }>({
    queryKey: ['stock-alerts', filterBranch, filterStatus],
    queryFn: async () => {
      const params: Record<string, string> = { limit: '100' };
      if (filterBranch) params.branchId = filterBranch;
      if (filterStatus) params.status = filterStatus;
      const { data } = await api.get('/reorder-points/alerts', { params });
      return data;
    },
  });

  // ---- Mutations ----

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      return api.post('/reorder-points', {
        brand: data.brand,
        model: data.model,
        storage: data.storage || undefined,
        category: data.category,
        branchId: data.branchId,
        minQuantity: parseInt(data.minQuantity),
        reorderQuantity: parseInt(data.reorderQuantity),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reorder-points'] });
      queryClient.invalidateQueries({ queryKey: ['low-stock-dashboard'] });
      toast.success('สร้าง Reorder Point สำเร็จ');
      setShowCreateModal(false);
      resetForm();
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: { minQuantity?: number; reorderQuantity?: number; isActive?: boolean } }) => {
      return api.patch(`/reorder-points/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reorder-points'] });
      queryClient.invalidateQueries({ queryKey: ['low-stock-dashboard'] });
      toast.success('อัปเดตสำเร็จ');
      setEditingPoint(null);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => api.delete(`/reorder-points/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reorder-points'] });
      queryClient.invalidateQueries({ queryKey: ['low-stock-dashboard'] });
      toast.success('ลบ Reorder Point สำเร็จ');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const checkStockMutation = useMutation({
    mutationFn: async () => api.post('/reorder-points/check-stock'),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['stock-alerts'] });
      queryClient.invalidateQueries({ queryKey: ['low-stock-dashboard'] });
      const d = res.data;
      toast.success(`ตรวจสอบแล้ว: พบ ${d.alertsCreated} รายการต่ำกว่าเกณฑ์`);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const resolveMutation = useMutation({
    mutationFn: async (alertId: string) => api.post(`/reorder-points/alerts/${alertId}/resolve`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock-alerts'] });
      queryClient.invalidateQueries({ queryKey: ['low-stock-dashboard'] });
      toast.success('แก้ไขแจ้งเตือนสำเร็จ');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const resetForm = () => {
    setForm({ brand: '', model: '', storage: '', category: 'PHONE_NEW', branchId: '', minQuantity: '1', reorderQuantity: '5' });
  };

  // ---- Table Columns ----

  const rpColumns = [
    {
      key: 'product',
      label: 'สินค้า',
      render: (r: ReorderPoint) => (
        <div>
          <div className="font-medium text-foreground">{r.brand} {r.model}</div>
          <div className="text-xs text-muted-foreground">
            {r.storage && <span>{r.storage} | </span>}
            {categoryLabels[r.category] || r.category}
          </div>
        </div>
      ),
    },
    {
      key: 'branch',
      label: 'สาขา',
      render: (r: ReorderPoint) => <span className="text-sm">{r.branch.name}</span>,
    },
    {
      key: 'stock',
      label: 'สต็อกปัจจุบัน',
      render: (r: ReorderPoint) => (
        <span className={`text-sm font-bold ${r.isLow ? 'text-red-600' : 'text-green-600'}`}>
          {r.currentStock}
        </span>
      ),
    },
    {
      key: 'minQuantity',
      label: 'ขั้นต่ำ',
      render: (r: ReorderPoint) => <span className="text-sm">{r.minQuantity}</span>,
    },
    {
      key: 'reorderQuantity',
      label: 'สั่งซื้อ',
      render: (r: ReorderPoint) => <span className="text-sm">{r.reorderQuantity}</span>,
    },
    {
      key: 'status',
      label: 'สถานะ',
      render: (r: ReorderPoint) => (
        <div className="flex items-center gap-2">
          {r.isLow ? (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">ต่ำกว่าเกณฑ์</span>
          ) : (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">ปกติ</span>
          )}
          {!r.isActive && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">ปิดใช้งาน</span>
          )}
        </div>
      ),
    },
    ...(isManager
      ? [{
          key: 'actions',
          label: '',
          render: (r: ReorderPoint) => (
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setEditingPoint(r);
                  setForm({
                    brand: r.brand,
                    model: r.model,
                    storage: r.storage || '',
                    category: r.category,
                    branchId: r.branchId,
                    minQuantity: r.minQuantity.toString(),
                    reorderQuantity: r.reorderQuantity.toString(),
                  });
                }}
                className="text-muted-foreground hover:text-primary"
                title="แก้ไข"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </button>
              <button
                onClick={() => updateMutation.mutate({ id: r.id, data: { isActive: !r.isActive } })}
                className={`text-xs ${r.isActive ? 'text-muted-foreground hover:text-red-600' : 'text-muted-foreground hover:text-green-600'}`}
                title={r.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
              >
                {r.isActive ? 'ปิด' : 'เปิด'}
              </button>
              {user?.role === 'OWNER' && (
                <button
                  onClick={() => { if (confirm('ลบ Reorder Point นี้?')) deleteMutation.mutate(r.id); }}
                  className="text-muted-foreground hover:text-red-600"
                  title="ลบ"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              )}
            </div>
          ),
        }]
      : []),
  ];

  const alertColumns = [
    {
      key: 'product',
      label: 'สินค้า',
      render: (a: StockAlert) => (
        <div>
          <div className="font-medium text-foreground">{a.brand} {a.model}</div>
          <div className="text-xs text-muted-foreground">
            {a.storage && <span>{a.storage} | </span>}
            {categoryLabels[a.category] || a.category}
          </div>
        </div>
      ),
    },
    {
      key: 'stock',
      label: 'สต็อก / ขั้นต่ำ',
      render: (a: StockAlert) => (
        <span className="text-sm">
          <span className="font-bold text-red-600">{a.currentStock}</span>
          <span className="text-muted-foreground"> / {a.minQuantity}</span>
        </span>
      ),
    },
    {
      key: 'reorderQuantity',
      label: 'ควรสั่ง',
      render: (a: StockAlert) => <span className="text-sm font-medium">{a.reorderQuantity}</span>,
    },
    {
      key: 'status',
      label: 'สถานะ',
      render: (a: StockAlert) => {
        const styles: Record<string, string> = {
          ACTIVE: 'bg-red-100 text-red-700',
          PO_CREATED: 'bg-primary-100 text-primary-700',
          RESOLVED: 'bg-green-100 text-green-700',
        };
        const labels: Record<string, string> = {
          ACTIVE: 'ต้องดำเนินการ',
          PO_CREATED: 'สร้าง PO แล้ว',
          RESOLVED: 'แก้ไขแล้ว',
        };
        return (
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${styles[a.status] || 'bg-muted text-foreground'}`}>
            {labels[a.status] || a.status}
          </span>
        );
      },
    },
    {
      key: 'createdAt',
      label: 'วันที่แจ้ง',
      render: (a: StockAlert) => (
        <span className="text-xs text-muted-foreground">
          {new Date(a.createdAt).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' })}
        </span>
      ),
    },
    ...(isManager
      ? [{
          key: 'action',
          label: '',
          render: (a: StockAlert) =>
            a.status === 'ACTIVE' ? (
              <button
                onClick={() => resolveMutation.mutate(a.id)}
                className="text-xs text-primary hover:text-primary/90 font-medium"
              >
                แก้ไขแล้ว
              </button>
            ) : null,
        }]
      : []),
  ];

  const alerts = alertsData?.data || [];
  const activeAlerts = alerts.filter((a) => a.status === 'ACTIVE').length;

  return (
    <div>
      <PageHeader
        title="แจ้งเตือนสต็อก"
        subtitle={`${dashboard?.totalLowStock || 0} รายการต่ำกว่าเกณฑ์ | ${activeAlerts} แจ้งเตือนรอดำเนินการ`}
        action={
          isManager ? (
            <div className="flex gap-2">
              {user?.role === 'OWNER' && (
                <button
                  onClick={() => checkStockMutation.mutate()}
                  disabled={checkStockMutation.isPending}
                  className="px-4 py-2 border border-input rounded-lg text-sm font-medium hover:bg-muted/50 disabled:opacity-50"
                >
                  {checkStockMutation.isPending ? 'กำลังตรวจ...' : 'ตรวจสอบสต็อก'}
                </button>
              )}
              <button
                onClick={() => { resetForm(); setShowCreateModal(true); }}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90"
              >
                + Reorder Point
              </button>
            </div>
          ) : undefined
        }
      />

      {/* Sub-tabs */}
      <div className="flex gap-1 mb-6 bg-muted rounded-lg p-1 w-fit">
        {(['dashboard', 'reorder-points', 'alerts'] as const).map((tab) => {
          const labels = { dashboard: 'ภาพรวม', 'reorder-points': 'Reorder Points', alerts: 'แจ้งเตือน' };
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm rounded-md font-medium transition-colors ${
                activeTab === tab ? 'bg-white text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {labels[tab]}
              {tab === 'alerts' && activeAlerts > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-xs bg-red-500 text-white">{activeAlerts}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Branch filter */}
      <div className="flex gap-3 mb-4">
        <select
          value={filterBranch}
          onChange={(e) => setFilterBranch(e.target.value)}
          className="px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
        >
          <option value="">ทุกสาขา</option>
          {branches?.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        {activeTab === 'alerts' && (
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
          >
            <option value="">ทุกสถานะ</option>
            <option value="ACTIVE">ต้องดำเนินการ</option>
            <option value="PO_CREATED">สร้าง PO แล้ว</option>
            <option value="RESOLVED">แก้ไขแล้ว</option>
          </select>
        )}
      </div>

      {/* Dashboard Tab */}
      {activeTab === 'dashboard' && (
        <div className="flex flex-col gap-5 lg:gap-7.5">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="rounded-lg border p-4 border-l-4 border-l-red-500">
              <div className="text-xs text-muted-foreground mb-1">สินค้าต่ำกว่าเกณฑ์</div>
              <div className="text-2xl font-bold text-red-600">{dashboard?.totalLowStock || 0}</div>
            </div>
            <div className="rounded-lg border p-4 border-l-4 border-l-orange-500">
              <div className="text-xs text-muted-foreground mb-1">แจ้งเตือนรอดำเนินการ</div>
              <div className="text-2xl font-bold text-orange-600">{activeAlerts}</div>
            </div>
            <div className="rounded-lg border p-4 border-l-4 border-l-primary-500">
              <div className="text-xs text-muted-foreground mb-1">Reorder Points ทั้งหมด</div>
              <div className="text-2xl font-bold text-primary">{reorderPoints?.length || 0}</div>
            </div>
            <div className="rounded-lg border p-4 border-l-4 border-l-green-500">
              <div className="text-xs text-muted-foreground mb-1">สินค้าปกติ</div>
              <div className="text-2xl font-bold text-green-600">
                {(reorderPoints?.filter((r) => !r.isLow).length) || 0}
              </div>
            </div>
          </div>

          {/* Low Stock Items */}
          {dashboard && dashboard.items.length > 0 && (
            <div className="rounded-lg border p-5">
              <h2 className="text-sm font-semibold text-foreground mb-3">สินค้าที่ต้องสั่งซื้อเพิ่ม</h2>
              <div className="space-y-2">
                {dashboard.items.map((item) => {
                  const ratio = item.minQuantity > 0 ? (item.currentStock / item.minQuantity) * 100 : 0;
                  return (
                    <div key={item.reorderPointId} className="flex items-center gap-4 py-2 border-b border-border last:border-0">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-foreground text-sm">{item.brand} {item.model} {item.storage || ''}</div>
                        <div className="text-xs text-muted-foreground">{item.branch.name} | {categoryLabels[item.category] || item.category}</div>
                      </div>
                      <div className="w-32">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-red-600 font-medium">{item.currentStock}</span>
                          <span className="text-muted-foreground">/ {item.minQuantity}</span>
                        </div>
                        <div className="bg-muted rounded-full h-2 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${ratio > 50 ? 'bg-yellow-400' : 'bg-red-400'}`}
                            style={{ width: `${Math.min(ratio, 100)}%` }}
                          />
                        </div>
                      </div>
                      <div className="text-sm text-foreground">
                        ควรสั่ง <span className="font-bold text-primary">{item.reorderQuantity}</span>
                      </div>
                      {item.hasActiveAlert && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">แจ้งเตือนแล้ว</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {dashboard && dashboard.items.length === 0 && (
            <div className="rounded-lg border p-8 text-center text-muted-foreground">
              สต็อกทุกรายการอยู่ในเกณฑ์ปกติ
            </div>
          )}
        </div>
      )}

      {/* Reorder Points Tab */}
      {activeTab === 'reorder-points' && (
        <DataTable columns={rpColumns} data={reorderPoints || []} isLoading={loadingRP} emptyMessage="ยังไม่มี Reorder Point" />
      )}

      {/* Alerts Tab */}
      {activeTab === 'alerts' && (
        <DataTable columns={alertColumns} data={alerts} isLoading={loadingAlerts} emptyMessage="ไม่มีแจ้งเตือน" />
      )}

      {/* Create / Edit Reorder Point Modal */}
      <Modal
        isOpen={showCreateModal || !!editingPoint}
        onClose={() => { setShowCreateModal(false); setEditingPoint(null); resetForm(); }}
        title={editingPoint ? 'แก้ไข Reorder Point' : 'สร้าง Reorder Point ใหม่'}
        size="md"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (editingPoint) {
              updateMutation.mutate({
                id: editingPoint.id,
                data: {
                  minQuantity: parseInt(form.minQuantity),
                  reorderQuantity: parseInt(form.reorderQuantity),
                },
              });
            } else {
              createMutation.mutate(form);
            }
          }}
          className="space-y-4"
        >
          {!editingPoint && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">ประเภท</label>
                  <select
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value, brand: '', model: '', storage: '' })}
                    className="w-full px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
                  >
                    {Object.entries(categoryLabels).filter(([key]) => key !== 'ACCESSORY').map(([key, val]) => (
                      <option key={key} value={key}>{val}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">แบรนด์</label>
                  <select
                    value={form.brand}
                    onChange={(e) => setForm({ ...form, brand: e.target.value, model: '', storage: '' })}
                    className="w-full px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
                    required
                  >
                    <option value="">-- เลือกแบรนด์ --</option>
                    {brands.map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">รุ่น</label>
                  <select
                    value={form.model}
                    onChange={(e) => {
                      const modelName = e.target.value;
                      const info = form.brand ? getModelInfo(form.brand, modelName) : undefined;
                      setForm({ ...form, model: modelName, storage: '', category: info?.category || form.category });
                    }}
                    className="w-full px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
                    required
                    disabled={!form.brand}
                  >
                    <option value="">-- เลือกรุ่น --</option>
                    {form.brand && getModels(form.brand, form.category).map((m) => (
                      <option key={m.name} value={m.name}>{m.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">ความจุ (ไม่บังคับ)</label>
                  <select
                    value={form.storage}
                    onChange={(e) => setForm({ ...form, storage: e.target.value })}
                    className="w-full px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
                    disabled={!form.model}
                  >
                    <option value="">ทุกความจุ</option>
                    {form.brand && form.model && (getModelInfo(form.brand, form.model)?.storage || []).map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">สาขา</label>
                <select
                  value={form.branchId}
                  onChange={(e) => setForm({ ...form, branchId: e.target.value })}
                  className="w-full px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
                  required
                >
                  <option value="">เลือกสาขา</option>
                  {branches?.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
            </>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">จำนวนขั้นต่ำ (แจ้งเตือนเมื่อเหลือเท่านี้)</label>
              <input
                type="number"
                min="1"
                value={form.minQuantity}
                onChange={(e) => setForm({ ...form, minQuantity: e.target.value })}
                className="w-full px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">จำนวนที่ควรสั่งซื้อ</label>
              <input
                type="number"
                min="1"
                value={form.reorderQuantity}
                onChange={(e) => setForm({ ...form, reorderQuantity: e.target.value })}
                className="w-full px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
                required
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => { setShowCreateModal(false); setEditingPoint(null); resetForm(); }}
              className="px-4 py-2 text-sm text-muted-foreground"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending || updateMutation.isPending}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {(createMutation.isPending || updateMutation.isPending) ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
