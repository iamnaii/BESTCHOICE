import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useDebounce } from '@/hooks/useDebounce';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface StockAdjustment {
  id: string;
  productId: string;
  branchId: string;
  reason: string;
  previousStatus: string;
  notes: string | null;
  photos: string[];
  createdAt: string;
  product: {
    id: string;
    name: string;
    imeiSerial: string | null;
    brand: string;
    model: string;
    costPrice: string;
  };
  branch: { id: string; name: string };
  adjustedBy: { id: string; name: string };
}

interface AdjustmentSummary {
  byReason: Record<string, { count: number; totalValue: number }>;
  totalCount: number;
  totalValue: number;
}

interface Branch {
  id: string;
  name: string;
}

const reasonLabels: Record<string, { label: string; className: string }> = {
  DAMAGED: { label: 'เสียหาย', className: 'bg-red-100 text-red-700' },
  LOST: { label: 'สูญหาย', className: 'bg-orange-100 text-orange-700' },
  FOUND: { label: 'พบเพิ่ม', className: 'bg-green-100 text-green-700' },
  CORRECTION: { label: 'แก้ไขข้อมูล', className: 'bg-primary-100 text-primary-700' },
  WRITE_OFF: { label: 'ตัดจำหน่าย', className: 'bg-muted text-foreground' },
  OTHER: { label: 'อื่นๆ', className: 'bg-muted text-muted-foreground' },
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function StockAdjustmentsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isManager = user?.role === 'OWNER' || user?.role === 'BRANCH_MANAGER';

  const [activeTab, setActiveTab] = useState<'list' | 'summary'>('list');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search);
  const [filterBranch, setFilterBranch] = useState('');
  const [filterReason, setFilterReason] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [activeTab]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [form, setForm] = useState({ productId: '', reason: 'DAMAGED', notes: '' });
  const [productSearch, setProductSearch] = useState('');
  const debouncedProductSearch = useDebounce(productSearch);

  // ---- Queries ----

  const { data: branches } = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn: async () => {
      const { data } = await api.get('/branches');
      return data;
    },
  });

  const { data: adjustmentsData, isLoading } = useQuery<{
    data: StockAdjustment[];
    total: number;
    page: number;
    totalPages: number;
  }>({
    queryKey: ['stock-adjustments', debouncedSearch, filterBranch, filterReason, page],
    queryFn: async () => {
      const params: Record<string, string> = { page: page.toString(), limit: '50' };
      if (debouncedSearch) params.search = debouncedSearch;
      if (filterBranch) params.branchId = filterBranch;
      if (filterReason) params.reason = filterReason;
      const { data } = await api.get('/stock-adjustments', { params });
      return data;
    },
  });

  const { data: summary } = useQuery<AdjustmentSummary>({
    queryKey: ['stock-adjustments-summary', filterBranch],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (filterBranch) params.branchId = filterBranch;
      const { data } = await api.get('/stock-adjustments/summary', { params });
      return data;
    },
  });

  const { data: searchProducts } = useQuery<{
    products: { id: string; name: string; brand: string; model: string; imeiSerial: string | null; status: string }[];
  }>({
    queryKey: ['products-search', debouncedProductSearch],
    queryFn: async () => {
      const { data } = await api.get('/products/stock', { params: { search: debouncedProductSearch } });
      return data;
    },
    enabled: !!debouncedProductSearch && showCreateModal,
  });

  // ---- Mutations ----

  const createMutation = useMutation({
    mutationFn: async (data: { productId: string; reason: string; notes?: string }) => {
      return api.post('/stock-adjustments', {
        productId: data.productId,
        reason: data.reason,
        notes: data.notes || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock-adjustments'] });
      queryClient.invalidateQueries({ queryKey: ['stock-adjustments-summary'] });
      queryClient.invalidateQueries({ queryKey: ['stock'] });
      toast.success('บันทึกการปรับสต็อกสำเร็จ');
      setShowCreateModal(false);
      setForm({ productId: '', reason: 'DAMAGED', notes: '' });
      setProductSearch('');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  // ---- Export CSV ----

  const handleExport = () => {
    const items = adjustmentsData?.data || [];
    if (items.length === 0) {
      toast.error('ไม่มีข้อมูลให้ส่งออก');
      return;
    }
    const headers = ['วันที่', 'สินค้า', 'IMEI/Serial', 'สาเหตุ', 'สถานะเดิม', 'หมายเหตุ', 'สาขา', 'ผู้ปรับ', 'ราคาทุน'];
    const rows = items.map((a) => [
      new Date(a.createdAt).toLocaleDateString('th-TH'),
      `${a.product.brand} ${a.product.model}`,
      a.product.imeiSerial || '',
      reasonLabels[a.reason]?.label || a.reason,
      a.previousStatus,
      a.notes || '',
      a.branch.name,
      a.adjustedBy.name,
      Number(a.product.costPrice || 0).toLocaleString(),
    ]);
    const esc = (c: unknown) => `"${String(c ?? '').replace(/"/g, '""')}"`;
    const csv = [headers, ...rows].map((r) => r.map(esc).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stock-adjustments-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ---- Columns ----

  const columns = [
    {
      key: 'createdAt',
      label: 'วันที่',
      render: (a: StockAdjustment) => (
        <span className="text-xs text-muted-foreground">
          {new Date(a.createdAt).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' })}
          <br />
          {new Date(a.createdAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
        </span>
      ),
    },
    {
      key: 'product',
      label: 'สินค้า',
      render: (a: StockAdjustment) => (
        <div>
          <div className="font-medium text-foreground text-sm">{a.product.brand} {a.product.model}</div>
          {a.product.imeiSerial && (
            <div className="text-xs text-muted-foreground font-mono">{a.product.imeiSerial}</div>
          )}
        </div>
      ),
    },
    {
      key: 'reason',
      label: 'สาเหตุ',
      render: (a: StockAdjustment) => {
        const r = reasonLabels[a.reason] || { label: a.reason, className: 'bg-muted text-foreground' };
        return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.className}`}>{r.label}</span>;
      },
    },
    {
      key: 'previousStatus',
      label: 'สถานะเดิม',
      render: (a: StockAdjustment) => <span className="text-xs text-muted-foreground">{a.previousStatus}</span>,
    },
    {
      key: 'notes',
      label: 'หมายเหตุ',
      render: (a: StockAdjustment) => (
        <span className="text-xs text-muted-foreground max-w-[200px] truncate block">{a.notes || '-'}</span>
      ),
    },
    {
      key: 'costPrice',
      label: 'ราคาทุน',
      render: (a: StockAdjustment) => (
        <span className="text-sm">{parseFloat(a.product.costPrice).toLocaleString()} ฿</span>
      ),
    },
    {
      key: 'branch',
      label: 'สาขา',
      render: (a: StockAdjustment) => <span className="text-xs">{a.branch.name}</span>,
    },
    {
      key: 'adjustedBy',
      label: 'ผู้ปรับ',
      render: (a: StockAdjustment) => <span className="text-xs text-muted-foreground">{a.adjustedBy.name}</span>,
    },
  ];

  const adjustments = adjustmentsData?.data || [];

  return (
    <div>
      <PageHeader
        title="ปรับสต็อก"
        subtitle={`ทั้งหมด ${summary?.totalCount || 0} รายการ | มูลค่ารวม ${(summary?.totalValue || 0).toLocaleString()} ฿`}
        action={
          isManager ? (
            <div className="flex gap-2">
              <button
                onClick={handleExport}
                className="px-4 py-2 border border-input rounded-lg text-sm font-medium hover:bg-muted/50"
              >
                Export CSV
              </button>
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90"
              >
                + ปรับสต็อก
              </button>
            </div>
          ) : undefined
        }
      />

      {/* Sub-tabs */}
      <div className="flex gap-1 mb-6 bg-muted rounded-lg p-1 w-fit">
        <button
          onClick={() => setActiveTab('list')}
          className={`px-4 py-2 text-sm rounded-md font-medium transition-colors ${
            activeTab === 'list' ? 'bg-white text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          รายการ
        </button>
        <button
          onClick={() => setActiveTab('summary')}
          className={`px-4 py-2 text-sm rounded-md font-medium transition-colors ${
            activeTab === 'summary' ? 'bg-white text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          สรุป
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        {activeTab === 'list' && (
          <input
            type="text"
            placeholder="ค้นหาชื่อ, ยี่ห้อ, รุ่น, IMEI..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="flex-1 min-w-[200px] px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
          />
        )}
        <select
          value={filterBranch}
          onChange={(e) => { setFilterBranch(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
        >
          <option value="">ทุกสาขา</option>
          {branches?.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        {activeTab === 'list' && (
          <select
            value={filterReason}
            onChange={(e) => { setFilterReason(e.target.value); setPage(1); }}
            className="px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
          >
            <option value="">ทุกสาเหตุ</option>
            {Object.entries(reasonLabels).map(([key, val]) => (
              <option key={key} value={key}>{val.label}</option>
            ))}
          </select>
        )}
      </div>

      {/* List Tab */}
      {activeTab === 'list' && (
        <>
          <DataTable columns={columns} data={adjustments} isLoading={isLoading} emptyMessage="ไม่มีรายการปรับสต็อก" />
          {adjustmentsData && adjustmentsData.totalPages > 1 && (
            <div className="flex justify-center gap-2 mt-4">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 border rounded-lg text-sm disabled:opacity-50"
              >
                ก่อนหน้า
              </button>
              <span className="px-3 py-1.5 text-sm text-muted-foreground">
                {page} / {adjustmentsData.totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(adjustmentsData.totalPages, p + 1))}
                disabled={page === adjustmentsData.totalPages}
                className="px-3 py-1.5 border rounded-lg text-sm disabled:opacity-50"
              >
                ถัดไป
              </button>
            </div>
          )}
        </>
      )}

      {/* Summary Tab */}
      {activeTab === 'summary' && summary && (
        <div className="flex flex-col gap-5 lg:gap-7.5">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="rounded-lg border p-4 border-l-4 border-l-gray-400">
              <div className="text-xs text-muted-foreground mb-1">รายการทั้งหมด</div>
              <div className="text-2xl font-bold text-foreground">{summary.totalCount}</div>
            </div>
            <div className="rounded-lg border p-4 border-l-4 border-l-red-500">
              <div className="text-xs text-muted-foreground mb-1">มูลค่ารวมที่ปรับ</div>
              <div className="text-2xl font-bold text-red-600">{summary.totalValue.toLocaleString()} ฿</div>
            </div>
          </div>

          <div className="rounded-lg border p-5">
            <h2 className="text-sm font-semibold text-foreground mb-4">สรุปตามสาเหตุ</h2>
            <div className="space-y-3">
              {Object.entries(summary.byReason).map(([reason, data]) => {
                const r = reasonLabels[reason] || { label: reason, className: 'bg-muted text-foreground' };
                const pct = summary.totalCount > 0 ? (data.count / summary.totalCount) * 100 : 0;
                return (
                  <div key={reason} className="flex items-center gap-4">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium w-24 text-center ${r.className}`}>
                      {r.label}
                    </span>
                    <div className="flex-1">
                      <div className="bg-muted rounded-full h-4 overflow-hidden">
                        <div className="h-full bg-primary-400 rounded-full" style={{ width: `${Math.max(pct, 2)}%` }} />
                      </div>
                    </div>
                    <span className="text-sm font-medium text-foreground w-12 text-right">{data.count}</span>
                    <span className="text-sm text-muted-foreground w-28 text-right">{data.totalValue.toLocaleString()} ฿</span>
                  </div>
                );
              })}
              {Object.keys(summary.byReason).length === 0 && (
                <div className="text-sm text-muted-foreground text-center py-4">ยังไม่มีข้อมูล</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create Adjustment Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => { setShowCreateModal(false); setForm({ productId: '', reason: 'DAMAGED', notes: '' }); setProductSearch(''); }}
        title="ปรับสต็อกสินค้า"
        size="md"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.productId) {
              toast.error('กรุณาเลือกสินค้า');
              return;
            }
            createMutation.mutate(form);
          }}
          className="space-y-4"
        >
          {/* Product Search */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">ค้นหาสินค้า</label>
            <input
              type="text"
              value={productSearch}
              onChange={(e) => { setProductSearch(e.target.value); setForm({ ...form, productId: '' }); }}
              className="w-full px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
              placeholder="พิมพ์ชื่อ, ยี่ห้อ, รุ่น, IMEI..."
            />
            {debouncedProductSearch && searchProducts?.products && searchProducts.products.length > 0 && !form.productId && (
              <div className="mt-1 border rounded-lg max-h-40 overflow-y-auto">
                {searchProducts.products.slice(0, 10).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => { setForm({ ...form, productId: p.id }); setProductSearch(`${p.brand} ${p.model}${p.imeiSerial ? ` (${p.imeiSerial})` : ''}`); }}
                    className="w-full text-left px-3 py-2 hover:bg-muted/50 text-sm border-b last:border-0"
                  >
                    <span className="font-medium">{p.brand} {p.model}</span>
                    {p.imeiSerial && <span className="text-xs text-muted-foreground ml-2 font-mono">{p.imeiSerial}</span>}
                    <span className="text-xs text-muted-foreground ml-2">({p.status})</span>
                  </button>
                ))}
              </div>
            )}
            {form.productId && (
              <div className="mt-1 text-xs text-green-600">เลือกสินค้าแล้ว</div>
            )}
          </div>

          {/* Reason */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">สาเหตุ</label>
            <select
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              className="w-full px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
            >
              {Object.entries(reasonLabels).map(([key, val]) => (
                <option key={key} value={key}>{val.label}</option>
              ))}
            </select>
            <div className="mt-1 text-xs text-muted-foreground">
              {form.reason === 'DAMAGED' && 'สินค้าเสียหาย — จะถูกลบออกจากสต็อก'}
              {form.reason === 'LOST' && 'สินค้าสูญหาย — จะถูกลบออกจากสต็อก'}
              {form.reason === 'FOUND' && 'พบสินค้าเพิ่ม — จะถูกคืนเข้าสต็อก'}
              {form.reason === 'CORRECTION' && 'แก้ไขข้อมูล — บันทึกเท่านั้น ไม่เปลี่ยนสถานะ'}
              {form.reason === 'WRITE_OFF' && 'ตัดจำหน่าย — จะถูกลบออกจากสต็อก'}
              {form.reason === 'OTHER' && 'อื่นๆ — บันทึกเท่านั้น ไม่เปลี่ยนสถานะ'}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">หมายเหตุ</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 border border-input rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
              placeholder="รายละเอียดเพิ่มเติม..."
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => { setShowCreateModal(false); setForm({ productId: '', reason: 'DAMAGED', notes: '' }); setProductSearch(''); }}
              className="px-4 py-2 text-sm text-muted-foreground"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending || !form.productId}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {createMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
