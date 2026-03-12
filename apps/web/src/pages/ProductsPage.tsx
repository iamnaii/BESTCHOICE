import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { useAuth } from '@/contexts/AuthContext';
import { statusLabels, categoryLabels } from '@/lib/constants';

interface Product {
  id: string;
  name: string;
  brand: string;
  model: string;
  imeiSerial: string | null;
  category: string;
  costPrice: string;
  status: string;
  createdAt: string;
  branch: { id: string; name: string };
  supplier: { id: string; name: string } | null;
  prices: { id: string; label: string; amount: string; isDefault: boolean }[];
}

export default function ProductsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterBranch, setFilterBranch] = useState('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounce(search);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const queryClient = useQueryClient();
  const isManager = user?.role === 'OWNER' || user?.role === 'BRANCH_MANAGER';

  // Quick price edit modal state
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [priceForm, setPriceForm] = useState({ label: '', amount: '', isDefault: false });

  const priceMutation = useMutation({
    mutationFn: async ({ productId, priceId, data }: { productId: string; priceId?: string; data: { label: string; amount: number; isDefault: boolean } }) => {
      if (priceId) {
        return api.patch(`/products/${productId}/prices/${priceId}`, data);
      }
      return api.post(`/products/${productId}/prices`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['products-available'] });
      toast.success('บันทึกราคาสำเร็จ');
      setEditingPriceId(null);
      setPriceForm({ label: '', amount: '', isDefault: false });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const deletePriceMutation = useMutation({
    mutationFn: async ({ productId, priceId }: { productId: string; priceId: string }) => {
      return api.delete(`/products/${productId}/prices/${priceId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['products-available'] });
      toast.success('ลบราคาสำเร็จ');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const openPriceEdit = useCallback((product: Product) => {
    setEditingProduct(product);
    setEditingPriceId(null);
    setPriceForm({ label: '', amount: '', isDefault: false });
  }, []);

  const startEditPrice = (price: { id: string; label: string; amount: string; isDefault: boolean }) => {
    setEditingPriceId(price.id);
    setPriceForm({ label: price.label, amount: price.amount, isDefault: price.isDefault });
  };

  const startAddPrice = () => {
    setEditingPriceId('new');
    setPriceForm({ label: '', amount: '', isDefault: false });
  };

  const cancelEditPrice = () => {
    setEditingPriceId(null);
    setPriceForm({ label: '', amount: '', isDefault: false });
  };

  const handlePriceSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;
    priceMutation.mutate({
      productId: editingProduct.id,
      priceId: editingPriceId === 'new' ? undefined : editingPriceId || undefined,
      data: {
        label: priceForm.label,
        amount: parseFloat(priceForm.amount) || 0,
        isDefault: priceForm.isDefault,
      },
    });
  };

  useEffect(() => { setPage(1); setSelectedIds(new Set()); }, [debouncedSearch, filterStatus, filterCategory, filterBranch]);
  useEffect(() => { setSelectedIds(new Set()); }, [page]);

  const { data: result, isLoading } = useQuery<{ data: Product[]; total: number; page: number; totalPages: number }>({
    queryKey: ['products', debouncedSearch, filterStatus, filterCategory, filterBranch, page],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (debouncedSearch) params.search = debouncedSearch;
      if (filterStatus) params.status = filterStatus;
      if (filterCategory) params.category = filterCategory;
      if (filterBranch) params.branchId = filterBranch;
      params.page = String(page);
      const { data } = await api.get('/products', { params });
      return data;
    },
  });

  const products = result?.data ?? [];

  // Keep editingProduct in sync when product data refreshes after mutations
  const editingProductId = editingProduct?.id;
  useEffect(() => {
    if (editingProductId && products.length > 0) {
      const updated = products.find(p => p.id === editingProductId);
      if (updated) setEditingProduct(updated);
    }
  }, [products, editingProductId]);

  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => {
      const { data } = await api.get('/branches');
      return data;
    },
  });

  const navigateToProduct = useCallback((id: string) => navigate(`/products/${id}`), [navigate]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === products.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(products.map((p) => p.id)));
    }
  };

  const handleExport = () => {
    const items = selectedIds.size > 0 ? products.filter((p) => selectedIds.has(p.id)) : products;
    if (items.length === 0) { toast.error('ไม่มีข้อมูลให้ส่งออก'); return; }
    const headers = ['ชื่อ', 'แบรนด์', 'รุ่น', 'IMEI/Serial', 'ประเภท', 'สถานะ', 'ราคาทุน', 'ราคาขาย', 'สาขา'];
    const rows = items.map((p) => {
      const dp = p.prices.find((pr) => pr.isDefault);
      return [p.name, p.brand, p.model, p.imeiSerial || '', categoryLabels[p.category] || p.category, statusLabels[p.status]?.label || p.status, Number(p.costPrice || 0).toLocaleString(), dp ? Number(dp.amount).toLocaleString() : '', p.branch.name];
    });
    const esc = (c: unknown) => `"${String(c ?? '').replace(/"/g, '""')}"`;
    const csv = [headers, ...rows].map((r) => r.map(esc).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `products-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const columns = useMemo(() => [
    ...(isManager ? [{
      key: 'select',
      label: (
        <input
          type="checkbox"
          checked={products.length > 0 && selectedIds.size === products.length}
          onChange={toggleSelectAll}
          className="rounded text-primary"
        />
      ) as unknown as string,
      render: (p: Product) => (
        <input
          type="checkbox"
          checked={selectedIds.has(p.id)}
          onChange={(e) => { e.stopPropagation(); toggleSelect(p.id); }}
          className="rounded text-primary"
        />
      ),
    }] : []),
    {
      key: 'name',
      label: 'สินค้า',
      render: (p: Product) => (
        <button
          onClick={() => navigateToProduct(p.id)}
          className="text-left hover:underline"
        >
          <div className="text-primary font-medium">{p.brand} {p.model}</div>
          <div className="text-xs text-muted-foreground">{p.name}</div>
        </button>
      ),
    },
    {
      key: 'imeiSerial',
      label: 'IMEI/Serial',
      render: (p: Product) => (
        <span className="font-mono text-xs">{p.imeiSerial || '-'}</span>
      ),
    },
    {
      key: 'category',
      label: 'ประเภท',
      render: (p: Product) => (
        <span className="text-sm">{categoryLabels[p.category] || p.category}</span>
      ),
    },
    {
      key: 'prices',
      label: 'ราคา',
      render: (p: Product) => {
        const defaultPrice = p.prices.find((pr) => pr.isDefault);
        return (
          <div className="flex items-center gap-1.5">
            <div>
              {defaultPrice ? (
                <div className="font-medium">{parseFloat(defaultPrice.amount).toLocaleString()} ฿</div>
              ) : (
                <span className="text-muted-foreground">-</span>
              )}
              <div className="text-xs text-muted-foreground">ทุน: {parseFloat(p.costPrice).toLocaleString()} ฿</div>
            </div>
            {isManager && (
              <button
                onClick={(e) => { e.stopPropagation(); openPriceEdit(p); }}
                className="text-muted-foreground hover:text-primary transition-colors"
                title="แก้ไขราคา"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </button>
            )}
          </div>
        );
      },
    },
    {
      key: 'status',
      label: 'สถานะ',
      render: (p: Product) => {
        const s = statusLabels[p.status] || { label: p.status, className: 'bg-muted text-foreground' };
        return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.className}`}>{s.label}</span>;
      },
    },
    {
      key: 'branch',
      label: 'สาขา',
      render: (p: Product) => <span className="text-xs">{p.branch.name}</span>,
    },
  ], [navigateToProduct, openPriceEdit, isManager, selectedIds, products]);

  return (
    <div>
      <PageHeader
        title="สินค้า"
        subtitle={`ทั้งหมด ${result?.total ?? 0} รายการ`}
        action={
          isManager ? (
            <div className="flex gap-2">
              <button
                onClick={handleExport}
                className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted/50 transition-colors"
              >
                {selectedIds.size > 0 ? `Export (${selectedIds.size})` : 'Export CSV'}
              </button>
              <button
                onClick={() => navigate('/products/create')}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                + เพิ่มสินค้า
              </button>
            </div>
          ) : undefined
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5 lg:mb-7.5">
        <input
          type="text"
          placeholder="ค้นหาชื่อ, ยี่ห้อ, รุ่น, IMEI..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
        />
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
        >
          <option value="">ทุกสถานะ</option>
          {Object.entries(statusLabels).map(([key, val]) => (
            <option key={key} value={key}>{val.label}</option>
          ))}
        </select>
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
        >
          <option value="">ทุกประเภท</option>
          {Object.entries(categoryLabels).map(([key, val]) => (
            <option key={key} value={key}>{val}</option>
          ))}
        </select>
        <select
          value={filterBranch}
          onChange={(e) => setFilterBranch(e.target.value)}
          className="px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
        >
          <option value="">ทุกสาขา</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </div>

      <DataTable
        columns={columns}
        data={products}
        isLoading={isLoading}
        emptyMessage="ไม่พบสินค้า"
        pagination={result ? {
          page: result.page,
          totalPages: result.totalPages,
          total: result.total,
          onPageChange: setPage,
        } : undefined}
      />

      {/* Quick Price Edit Modal */}
      <Modal
        isOpen={!!editingProduct}
        onClose={() => setEditingProduct(null)}
        title={editingProduct ? `จัดการราคา — ${editingProduct.brand} ${editingProduct.model}` : 'จัดการราคา'}
        size="sm"
      >
        {editingProduct && (
          <div className="flex flex-col gap-5 lg:gap-7.5">
            {/* Cost price reference */}
            <div className="text-xs text-muted-foreground bg-muted rounded-lg p-3">
              ราคาทุน: <span className="font-medium text-foreground">{parseFloat(editingProduct.costPrice).toLocaleString()} ฿</span>
            </div>

            {/* Existing prices list */}
            <div className="space-y-2">
              {editingProduct.prices.map((price) => (
                <div key={price.id}>
                  {editingPriceId === price.id ? (
                    /* Inline edit form */
                    <form onSubmit={handlePriceSubmit} className="border-2 border-primary/20 rounded-lg p-3 bg-primary/5 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={priceForm.label}
                          onChange={(e) => setPriceForm({ ...priceForm, label: e.target.value })}
                          placeholder="ชื่อราคา"
                          className="px-2 py-1.5 border border-input rounded text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
                          required
                        />
                        <input
                          type="number"
                          step="0.01"
                          value={priceForm.amount}
                          onChange={(e) => setPriceForm({ ...priceForm, amount: e.target.value })}
                          placeholder="ราคา (บาท)"
                          className="px-2 py-1.5 border border-input rounded text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
                          required
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                          <input
                            type="checkbox"
                            checked={priceForm.isDefault}
                            onChange={(e) => setPriceForm({ ...priceForm, isDefault: e.target.checked })}
                            className="rounded text-primary"
                          />
                          ค่าเริ่มต้น
                        </label>
                        <div className="flex gap-2">
                          <button type="button" onClick={cancelEditPrice} className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
                            ยกเลิก
                          </button>
                          <button
                            type="submit"
                            disabled={priceMutation.isPending}
                            className="px-3 py-1 bg-primary text-primary-foreground rounded text-xs font-medium hover:bg-primary/90 disabled:opacity-50"
                          >
                            {priceMutation.isPending ? 'บันทึก...' : 'บันทึก'}
                          </button>
                        </div>
                      </div>
                      {priceForm.amount && (
                        <div className={`text-xs ${parseFloat(priceForm.amount) - parseFloat(editingProduct.costPrice) > 0 ? 'text-green-600' : 'text-red-600'}`}>
                          กำไร: {(parseFloat(priceForm.amount) - parseFloat(editingProduct.costPrice)).toLocaleString()} ฿
                        </div>
                      )}
                    </form>
                  ) : (
                    /* Display row */
                    <div className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-muted/50 border border-transparent hover:border-border">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{price.label}</span>
                        {price.isDefault && (
                          <span className="px-1.5 py-0.5 bg-primary/10 text-primary text-xs rounded font-medium">
                            ค่าเริ่มต้น
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-semibold">{parseFloat(price.amount).toLocaleString()} ฿</span>
                        <div className="flex gap-1">
                          <button
                            onClick={() => startEditPrice(price)}
                            className="p-1 text-muted-foreground hover:text-primary transition-colors"
                            title="แก้ไข"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => {
                              if (confirm('ต้องการลบราคานี้?')) {
                                deletePriceMutation.mutate({ productId: editingProduct.id, priceId: price.id });
                              }
                            }}
                            className="p-1 text-muted-foreground hover:text-red-500 transition-colors"
                            title="ลบ"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {editingProduct.prices.length === 0 && !editingPriceId && (
                <p className="text-sm text-muted-foreground text-center py-3">ยังไม่มีราคาขาย</p>
              )}
            </div>

            {/* Add new price form */}
            {editingPriceId === 'new' ? (
              <form onSubmit={handlePriceSubmit} className="border-2 border-green-200 rounded-lg p-3 bg-green-50 space-y-2">
                <div className="text-xs font-medium text-green-700 mb-1">เพิ่มราคาใหม่</div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={priceForm.label}
                    onChange={(e) => setPriceForm({ ...priceForm, label: e.target.value })}
                    placeholder='เช่น "ราคาเงินสด"'
                    className="px-2 py-1.5 border border-input rounded text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
                    required
                  />
                  <input
                    type="number"
                    step="0.01"
                    value={priceForm.amount}
                    onChange={(e) => setPriceForm({ ...priceForm, amount: e.target.value })}
                    placeholder="ราคา (บาท)"
                    className="px-2 py-1.5 border border-input rounded text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
                    required
                  />
                </div>
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={priceForm.isDefault}
                      onChange={(e) => setPriceForm({ ...priceForm, isDefault: e.target.checked })}
                      className="rounded text-primary"
                    />
                    ค่าเริ่มต้น
                  </label>
                  <div className="flex gap-2">
                    <button type="button" onClick={cancelEditPrice} className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
                      ยกเลิก
                    </button>
                    <button
                      type="submit"
                      disabled={priceMutation.isPending}
                      className="px-3 py-1 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700 disabled:opacity-50"
                    >
                      {priceMutation.isPending ? 'เพิ่ม...' : 'เพิ่ม'}
                    </button>
                  </div>
                </div>
              </form>
            ) : (
              <button
                type="button"
                onClick={startAddPrice}
                className="w-full py-2 border-2 border-dashed border-border rounded-lg text-sm text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
              >
                + เพิ่มราคาใหม่
              </button>
            )}

            {/* Close button */}
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setEditingProduct(null)}
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
              >
                ปิด
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
