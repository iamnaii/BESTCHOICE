import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api, { getErrorMessage } from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { statusLabels, categoryLabels } from '@/lib/constants';

interface StockProduct {
  id: string;
  name: string;
  brand: string;
  model: string;
  imeiSerial: string | null;
  category: string;
  costPrice: string;
  status: string;
  color: string | null;
  storage: string | null;
  branch: { id: string; name: string };
  supplier: { id: string; name: string } | null;
  prices: { id: string; label: string; amount: string; isDefault: boolean }[];
}

interface BranchSummary {
  branch: { id: string; name: string };
  total: number;
  inStock: number;
  totalValue: number;
}

interface AgingBucket {
  label: string;
  count: number;
  value: number;
}

interface BreakdownItem {
  name: string;
  count: number;
  value: number;
}

interface StockDashboard {
  stockAging: AgingBucket[];
  actionRequired: {
    inspection: number;
    qcPending: number;
    photoPending: number;
    pendingTransfers: number;
    repossessed: number;
    agingOver90: number;
  };
  valueByStatus: { status: string; count: number; value: number }[];
  byCategory: BreakdownItem[];
  byBrand: BreakdownItem[];
  byColor: BreakdownItem[];
  byStorage: BreakdownItem[];
  stockMovement: { month: string; in: number; out: number }[];
  stockTurnover: {
    avgDaysInStock: number;
    soldThisMonth: number;
    soldLastMonth: number;
    currentStock: number;
  };
  topSellers: { name: string; count: number }[];
  slowMovers: { name: string; days: number; costPrice: number }[];
  marginOverview: {
    totalCost: number;
    totalSell: number;
    totalMargin: number;
    avgMarginPct: number;
    avgMarginPerUnit: number;
    itemsWithPrice: number;
  };
}

// --- Small Reusable Components ---

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-sm font-semibold text-gray-700 mb-3">{children}</h2>;
}

function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <div className={`bg-white rounded-lg border p-4 ${accent ? `border-l-4 ${accent}` : ''}`}>
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="text-xl font-bold text-gray-900">{typeof value === 'number' ? value.toLocaleString() : value}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  );
}

function BarInline({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-24 truncate text-gray-600" title={label}>{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(pct, 2)}%` }} />
      </div>
      <span className="w-8 text-right text-gray-700 font-medium">{count}</span>
    </div>
  );
}

export default function StockPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isManager = user?.role === 'OWNER' || user?.role === 'BRANCH_MANAGER';
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search);
  const [filterBranch, setFilterBranch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [activeTab, setActiveTab] = useState<'dashboard' | 'list'>('dashboard');

  // Quick price edit modal state
  const [editingProduct, setEditingProduct] = useState<StockProduct | null>(null);
  const [priceForm, setPriceForm] = useState({ label: '', amount: '', isDefault: false });

  const priceMutation = useMutation({
    mutationFn: async ({ productId, priceId, data }: { productId: string; priceId?: string; data: { label: string; amount: number; isDefault: boolean } }) => {
      if (priceId) {
        return api.patch(`/products/${productId}/prices/${priceId}`, data);
      }
      return api.post(`/products/${productId}/prices`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock'] });
      toast.success('บันทึกราคาสำเร็จ');
      setEditingProduct(null);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const openPriceEdit = (product: StockProduct) => {
    setEditingProduct(product);
    const defaultPrice = product.prices?.find((p) => p.isDefault) || product.prices?.[0];
    if (defaultPrice) {
      setPriceForm({ label: defaultPrice.label, amount: defaultPrice.amount, isDefault: defaultPrice.isDefault });
    } else {
      setPriceForm({ label: 'ราคาขาย', amount: '', isDefault: true });
    }
  };

  const handlePriceSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;
    const defaultPrice = editingProduct.prices?.find((p) => p.isDefault) || editingProduct.prices?.[0];
    priceMutation.mutate({
      productId: editingProduct.id,
      priceId: defaultPrice?.id,
      data: {
        label: priceForm.label,
        amount: parseFloat(priceForm.amount) || 0,
        isDefault: priceForm.isDefault,
      },
    });
  };

  const { data, isLoading } = useQuery<{ products: StockProduct[]; summary: BranchSummary[] }>({
    queryKey: ['stock', debouncedSearch, filterBranch, filterStatus, filterCategory],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (debouncedSearch) params.search = debouncedSearch;
      if (filterBranch) params.branchId = filterBranch;
      if (filterStatus) params.status = filterStatus;
      if (filterCategory) params.category = filterCategory;
      const { data } = await api.get('/products/stock', { params });
      return data;
    },
  });

  const { data: dashboard } = useQuery<StockDashboard>({
    queryKey: ['stock-dashboard', filterBranch],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (filterBranch) params.branchId = filterBranch;
      const { data } = await api.get('/products/stock/dashboard', { params });
      return data;
    },
  });

  const products = data?.products || [];
  const summary = data?.summary || [];
  const totalInStock = summary.reduce((sum, s) => sum + s.inStock, 0);
  const totalValue = summary.reduce((sum, s) => sum + s.totalValue, 0);

  const columns = [
    {
      key: 'name',
      label: 'สินค้า',
      render: (p: StockProduct) => (
        <button
          onClick={() => navigate(`/products/${p.id}`)}
          className="text-left hover:underline"
        >
          <div className="text-primary-600 font-medium">{p.brand} {p.model}</div>
          {p.imeiSerial && <div className="text-xs text-gray-400 font-mono">{p.imeiSerial}</div>}
        </button>
      ),
    },
    {
      key: 'category',
      label: 'ประเภท',
      render: (p: StockProduct) => <span className="text-xs">{categoryLabels[p.category] || p.category}</span>,
    },
    {
      key: 'color',
      label: 'สี',
      render: (p: StockProduct) => <span className="text-sm">{p.color || '-'}</span>,
    },
    {
      key: 'storage',
      label: 'ความจุ',
      render: (p: StockProduct) => <span className="text-sm">{p.storage || '-'}</span>,
    },
    {
      key: 'costPrice',
      label: 'ราคาทุน',
      render: (p: StockProduct) => (
        <span className="text-sm">{parseFloat(p.costPrice).toLocaleString()} ฿</span>
      ),
    },
    {
      key: 'sellingPrice',
      label: 'ราคาขาย',
      render: (p: StockProduct) => {
        const defaultPrice = p.prices?.find((pr) => pr.isDefault) || p.prices?.[0];
        return (
          <div className="flex items-center gap-1.5">
            {defaultPrice ? (
              <span className="text-sm font-medium">{parseFloat(defaultPrice.amount).toLocaleString()} ฿</span>
            ) : (
              <span className="text-gray-400">-</span>
            )}
            {isManager && (
              <button
                onClick={(e) => { e.stopPropagation(); openPriceEdit(p); }}
                className="text-gray-400 hover:text-primary-600 transition-colors"
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
      render: (p: StockProduct) => {
        const s = statusLabels[p.status] || { label: p.status, className: 'bg-gray-100 text-gray-700' };
        return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.className}`}>{s.label}</span>;
      },
    },
    {
      key: 'branch',
      label: 'สาขา',
      render: (p: StockProduct) => <span className="text-xs font-medium">{p.branch.name}</span>,
    },
  ];

  const actionTotal = dashboard
    ? dashboard.actionRequired.inspection + (dashboard.actionRequired.photoPending || 0) + dashboard.actionRequired.pendingTransfers + dashboard.actionRequired.repossessed + dashboard.actionRequired.agingOver90
    : 0;

  return (
    <div>
      <PageHeader
        title="สต็อกสินค้า"
        subtitle={`พร้อมขาย ${totalInStock} ชิ้น | มูลค่ารวม ${totalValue.toLocaleString()} ฿`}
        action={
          isManager && activeTab === 'list' ? (
            <button
              onClick={() => {
                if (products.length === 0) { toast.error('ไม่มีข้อมูลให้ส่งออก'); return; }
                const headers = ['สินค้า', 'IMEI', 'ประเภท', 'สี', 'ความจุ', 'ราคาทุน', 'ราคาขาย', 'สถานะ', 'สาขา'];
                const rows = products.map((p) => {
                  const dp = p.prices?.find((pr) => pr.isDefault) || p.prices?.[0];
                  return [`${p.brand} ${p.model}`, p.imeiSerial || '', categoryLabels[p.category] || p.category, p.color || '', p.storage || '', Number(p.costPrice || 0).toLocaleString(), dp ? Number(dp.amount).toLocaleString() : '', statusLabels[p.status]?.label || p.status, p.branch.name];
                });
                const esc = (c: unknown) => `"${String(c ?? '').replace(/"/g, '""')}"`;
                const csv = [headers, ...rows].map((r) => r.map(esc).join(',')).join('\n');
                const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `stock-${new Date().toISOString().split('T')[0]}.csv`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50"
            >
              Export CSV
            </button>
          ) : undefined
        }
      />

      {/* Branch Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {summary.map((s) => (
          <button
            key={s.branch.id}
            onClick={() => setFilterBranch(filterBranch === s.branch.id ? '' : s.branch.id)}
            className={`bg-white rounded-lg border p-4 text-left transition-colors ${
              filterBranch === s.branch.id ? 'border-primary-500 ring-2 ring-primary-100' : 'hover:border-gray-300'
            }`}
          >
            <div className="text-sm font-medium text-gray-900 mb-2">{s.branch.name}</div>
            <div className="flex justify-between text-xs text-gray-500">
              <span>พร้อมขาย: {s.inStock}</span>
              <span>ทั้งหมด: {s.total}</span>
            </div>
            <div className="text-xs text-gray-400 mt-1">มูลค่า: {s.totalValue.toLocaleString()} ฿</div>
          </button>
        ))}
      </div>

      {/* Tabs: Dashboard / List */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`px-4 py-2 text-sm rounded-md font-medium transition-colors ${
            activeTab === 'dashboard' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Dashboard
        </button>
        <button
          onClick={() => setActiveTab('list')}
          className={`px-4 py-2 text-sm rounded-md font-medium transition-colors ${
            activeTab === 'list' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          รายการสินค้า
        </button>
      </div>

      {activeTab === 'dashboard' && dashboard && (
        <div className="space-y-6">

          {/* Row 1: Action Required + Stock Turnover */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Action Required */}
            <div className="bg-white rounded-lg border p-5">
              <SectionTitle>รอดำเนินการ ({actionTotal})</SectionTitle>
              <div className="grid grid-cols-2 gap-3">
                {dashboard.actionRequired.inspection > 0 && (
                  <div className="flex items-center gap-3 p-3 bg-yellow-50 rounded-lg">
                    <div className="w-10 h-10 bg-yellow-100 rounded-full flex items-center justify-center text-yellow-600 text-lg font-bold">
                      {dashboard.actionRequired.inspection}
                    </div>
                    <div className="text-sm text-yellow-700">รอตรวจสอบ</div>
                  </div>
                )}
                {(dashboard.actionRequired.photoPending || 0) > 0 && (
                  <div className="flex items-center gap-3 p-3 bg-violet-50 rounded-lg">
                    <div className="w-10 h-10 bg-violet-100 rounded-full flex items-center justify-center text-violet-600 text-lg font-bold">
                      {dashboard.actionRequired.photoPending}
                    </div>
                    <div className="text-sm text-violet-700">รอถ่ายรูป</div>
                  </div>
                )}
                {dashboard.actionRequired.pendingTransfers > 0 && (
                  <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg">
                    <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 text-lg font-bold">
                      {dashboard.actionRequired.pendingTransfers}
                    </div>
                    <div className="text-sm text-blue-700">รอยืนยันโอน</div>
                  </div>
                )}
                {dashboard.actionRequired.repossessed > 0 && (
                  <div className="flex items-center gap-3 p-3 bg-red-50 rounded-lg">
                    <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center text-red-600 text-lg font-bold">
                      {dashboard.actionRequired.repossessed}
                    </div>
                    <div className="text-sm text-red-700">ยึดคืน รอปรับสภาพ</div>
                  </div>
                )}
                {dashboard.actionRequired.agingOver90 > 0 && (
                  <div className="flex items-center gap-3 p-3 bg-orange-50 rounded-lg">
                    <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center text-orange-600 text-lg font-bold">
                      {dashboard.actionRequired.agingOver90}
                    </div>
                    <div className="text-sm text-orange-700">ค้างสต๊อค 90+ วัน</div>
                  </div>
                )}
                {actionTotal === 0 && (
                  <div className="col-span-2 text-center text-sm text-gray-400 py-4">ไม่มีรายการรอดำเนินการ</div>
                )}
              </div>
            </div>

            {/* Stock Turnover */}
            <div className="bg-white rounded-lg border p-5">
              <SectionTitle>อัตราหมุนเวียนสต๊อค</SectionTitle>
              <div className="grid grid-cols-2 gap-4">
                <StatCard label="อายุเฉลี่ยในสต๊อค" value={`${dashboard.stockTurnover.avgDaysInStock} วัน`} accent="border-l-blue-500" />
                <StatCard label="สต๊อคปัจจุบัน" value={dashboard.stockTurnover.currentStock} sub="ชิ้น (IN_STOCK)" accent="border-l-green-500" />
                <StatCard label="ขายเดือนนี้" value={dashboard.stockTurnover.soldThisMonth} sub="ชิ้น" accent="border-l-indigo-500" />
                <StatCard label="ขายเดือนที่แล้ว" value={dashboard.stockTurnover.soldLastMonth} sub="ชิ้น" accent="border-l-gray-400" />
              </div>
            </div>
          </div>

          {/* Row 2: Stock Aging */}
          <div className="bg-white rounded-lg border p-5">
            <SectionTitle>อายุสต๊อค (Stock Aging)</SectionTitle>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {dashboard.stockAging.map((bucket, i) => {
                const colors = ['border-l-green-500', 'border-l-yellow-500', 'border-l-orange-500', 'border-l-red-500'];
                return (
                  <div key={bucket.label} className={`bg-gray-50 rounded-lg p-4 border-l-4 ${colors[i]}`}>
                    <div className="text-sm font-medium text-gray-700">{bucket.label}</div>
                    <div className="text-2xl font-bold text-gray-900 mt-1">{bucket.count} <span className="text-sm font-normal text-gray-500">ชิ้น</span></div>
                    <div className="text-xs text-gray-400 mt-1">{bucket.value.toLocaleString()} ฿</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Row 3: Value by Status + Stock Movement */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Value by Status */}
            <div className="bg-white rounded-lg border p-5">
              <SectionTitle>มูลค่าสต๊อคตามสถานะ</SectionTitle>
              <div className="space-y-2">
                {dashboard.valueByStatus.map((item) => {
                  const s = statusLabels[item.status] || { label: item.status, className: 'bg-gray-100 text-gray-700' };
                  return (
                    <div key={item.status} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.className}`}>{s.label}</span>
                        <span className="text-sm text-gray-500">{item.count} ชิ้น</span>
                      </div>
                      <span className="text-sm font-medium text-gray-900">{item.value.toLocaleString()} ฿</span>
                    </div>
                  );
                })}
                {dashboard.valueByStatus.length > 0 && (
                  <div className="flex items-center justify-between pt-2 border-t border-gray-200 font-medium">
                    <span className="text-sm text-gray-700">รวมทั้งหมด</span>
                    <span className="text-sm text-gray-900">
                      {dashboard.valueByStatus.reduce((s, i) => s + i.value, 0).toLocaleString()} ฿
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Stock Movement */}
            <div className="bg-white rounded-lg border p-5">
              <SectionTitle>การเคลื่อนไหวสต๊อค (6 เดือน)</SectionTitle>
              <div className="space-y-3">
                <div className="flex items-center gap-4 text-xs text-gray-500 mb-2">
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-400 inline-block" /> รับเข้า</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-indigo-400 inline-block" /> ขายออก</span>
                </div>
                {(() => {
                  const maxVal = Math.max(...dashboard.stockMovement.map((x) => Math.max(x.in, x.out)), 1);
                  return dashboard.stockMovement.map((m) => (
                    <div key={m.month} className="space-y-1">
                      <div className="text-xs text-gray-500 font-medium">{m.month}</div>
                      <div className="flex items-center gap-2">
                        <div className="w-12 text-xs text-right text-green-600">{m.in}</div>
                        <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
                          <div className="h-full bg-green-400 rounded-full" style={{ width: `${(m.in / maxVal) * 100}%` }} />
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-12 text-xs text-right text-indigo-600">{m.out}</div>
                        <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
                          <div className="h-full bg-indigo-400 rounded-full" style={{ width: `${(m.out / maxVal) * 100}%` }} />
                        </div>
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </div>
          </div>

          {/* Row 4: Category + Brand + Color + Storage Breakdown */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* By Category */}
            <div className="bg-white rounded-lg border p-5">
              <SectionTitle>ตามประเภท</SectionTitle>
              <div className="space-y-2">
                {dashboard.byCategory.map((item) => (
                  <BarInline
                    key={item.name}
                    label={categoryLabels[item.name] || item.name}
                    count={item.count}
                    total={dashboard.stockTurnover.currentStock}
                    color="bg-blue-400"
                  />
                ))}
                {dashboard.byCategory.length === 0 && <div className="text-sm text-gray-400 text-center py-2">-</div>}
              </div>
            </div>

            {/* By Brand */}
            <div className="bg-white rounded-lg border p-5">
              <SectionTitle>ตามแบรนด์</SectionTitle>
              <div className="space-y-2">
                {dashboard.byBrand.slice(0, 8).map((item) => (
                  <BarInline
                    key={item.name}
                    label={item.name}
                    count={item.count}
                    total={dashboard.stockTurnover.currentStock}
                    color="bg-purple-400"
                  />
                ))}
                {dashboard.byBrand.length === 0 && <div className="text-sm text-gray-400 text-center py-2">-</div>}
              </div>
            </div>

            {/* By Color */}
            <div className="bg-white rounded-lg border p-5">
              <SectionTitle>ตามสี</SectionTitle>
              <div className="space-y-2">
                {dashboard.byColor.slice(0, 8).map((item) => (
                  <BarInline
                    key={item.name}
                    label={item.name}
                    count={item.count}
                    total={dashboard.stockTurnover.currentStock}
                    color="bg-pink-400"
                  />
                ))}
                {dashboard.byColor.length === 0 && <div className="text-sm text-gray-400 text-center py-2">-</div>}
              </div>
            </div>

            {/* By Storage */}
            <div className="bg-white rounded-lg border p-5">
              <SectionTitle>ตามความจุ</SectionTitle>
              <div className="space-y-2">
                {dashboard.byStorage.slice(0, 8).map((item) => (
                  <BarInline
                    key={item.name}
                    label={item.name}
                    count={item.count}
                    total={dashboard.stockTurnover.currentStock}
                    color="bg-teal-400"
                  />
                ))}
                {dashboard.byStorage.length === 0 && <div className="text-sm text-gray-400 text-center py-2">-</div>}
              </div>
            </div>
          </div>

          {/* Row 5: Margin Overview */}
          <div className="bg-white rounded-lg border p-5">
            <SectionTitle>กำไรเฉลี่ย (Margin Overview) - สินค้าพร้อมขาย</SectionTitle>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard
                label="มูลค่าทุนรวม"
                value={`${dashboard.marginOverview.totalCost.toLocaleString()} ฿`}
                accent="border-l-gray-400"
              />
              <StatCard
                label="มูลค่าขายรวม"
                value={`${dashboard.marginOverview.totalSell.toLocaleString()} ฿`}
                accent="border-l-blue-500"
              />
              <StatCard
                label="กำไรรวม (ถ้าขายหมด)"
                value={`${dashboard.marginOverview.totalMargin.toLocaleString()} ฿`}
                sub={`Margin ${dashboard.marginOverview.avgMarginPct}%`}
                accent="border-l-green-500"
              />
              <StatCard
                label="กำไรเฉลี่ย/ชิ้น"
                value={`${dashboard.marginOverview.avgMarginPerUnit.toLocaleString()} ฿`}
                sub={`จาก ${dashboard.marginOverview.itemsWithPrice} ชิ้นที่มีราคาขาย`}
                accent="border-l-indigo-500"
              />
            </div>
          </div>

          {/* Row 7: Top Sellers + Slow Movers */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Top Sellers */}
            <div className="bg-white rounded-lg border p-5">
              <SectionTitle>สินค้าขายดี (6 เดือนล่าสุด)</SectionTitle>
              {dashboard.topSellers.length > 0 ? (
                <div className="space-y-2">
                  {dashboard.topSellers.map((item, i) => (
                    <div key={item.name} className="flex items-center gap-3">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        i === 0 ? 'bg-yellow-100 text-yellow-700' :
                        i === 1 ? 'bg-gray-100 text-gray-600' :
                        i === 2 ? 'bg-orange-100 text-orange-700' :
                        'bg-gray-50 text-gray-500'
                      }`}>{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">{item.name}</div>
                      </div>
                      <span className="text-sm font-bold text-indigo-600">{item.count} ชิ้น</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-gray-400 text-center py-4">ยังไม่มีข้อมูลการขาย</div>
              )}
            </div>

            {/* Slow Movers */}
            <div className="bg-white rounded-lg border p-5">
              <SectionTitle>สินค้าค้างสต๊อคนานสุด</SectionTitle>
              {dashboard.slowMovers.length > 0 ? (
                <div className="space-y-2">
                  {dashboard.slowMovers.map((item, i) => (
                    <div key={`${item.name}-${i}`} className="flex items-center gap-3">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        item.days > 90 ? 'bg-red-100 text-red-700' :
                        item.days > 60 ? 'bg-orange-100 text-orange-700' :
                        'bg-yellow-100 text-yellow-700'
                      }`}>{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">{item.name}</div>
                        <div className="text-xs text-gray-400">{(Number(item.costPrice) || 0).toLocaleString()} ฿</div>
                      </div>
                      <span className={`text-sm font-bold ${item.days > 90 ? 'text-red-600' : item.days > 60 ? 'text-orange-600' : 'text-yellow-600'}`}>
                        {item.days} วัน
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-gray-400 text-center py-4">ไม่มีสินค้าในสต๊อค</div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'dashboard' && !dashboard && (
        <div className="bg-white rounded-lg border p-8 text-center text-gray-500">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-3"></div>
          กำลังโหลด Dashboard...
        </div>
      )}

      {activeTab === 'list' && (
        <>
          {/* Filters */}
          <div className="flex flex-wrap gap-3 mb-4">
            <input
              type="text"
              placeholder="ค้นหาชื่อ, ยี่ห้อ, รุ่น, IMEI..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 min-w-[200px] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
            />
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
            >
              <option value="">ทุกสถานะ</option>
              {Object.entries(statusLabels).map(([key, val]) => (
                <option key={key} value={key}>{val.label}</option>
              ))}
            </select>
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
            >
              <option value="">ทุกประเภท</option>
              {Object.entries(categoryLabels).map(([key, val]) => (
                <option key={key} value={key}>{val}</option>
              ))}
            </select>
            {filterBranch && (
              <button
                onClick={() => setFilterBranch('')}
                className="px-3 py-2 text-sm text-primary-600 hover:text-primary-700"
              >
                ดูทุกสาขา
              </button>
            )}
          </div>

          <DataTable columns={columns} data={products} isLoading={isLoading} emptyMessage="ไม่พบสินค้าในสต็อก" />
        </>
      )}

      {/* Quick Price Edit Modal */}
      <Modal
        isOpen={!!editingProduct}
        onClose={() => setEditingProduct(null)}
        title={editingProduct ? `แก้ไขราคา — ${editingProduct.brand} ${editingProduct.model}` : 'แก้ไขราคา'}
        size="sm"
      >
        <form onSubmit={handlePriceSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ชื่อราคา</label>
            <input
              type="text"
              value={priceForm.label}
              onChange={(e) => setPriceForm({ ...priceForm, label: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ราคาขาย (บาท)</label>
            <input
              type="number"
              step="0.01"
              value={priceForm.amount}
              onChange={(e) => setPriceForm({ ...priceForm, amount: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              required
            />
          </div>
          {editingProduct && (
            <div className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3">
              ราคาทุน: {parseFloat(editingProduct.costPrice).toLocaleString()} ฿
              {priceForm.amount && (
                <span className={`ml-2 font-medium ${parseFloat(priceForm.amount) - parseFloat(editingProduct.costPrice) > 0 ? 'text-green-600' : 'text-red-600'}`}>
                  (กำไร: {(parseFloat(priceForm.amount) - parseFloat(editingProduct.costPrice)).toLocaleString()} ฿)
                </span>
              )}
            </div>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setEditingProduct(null)} className="px-4 py-2 text-sm text-gray-600">
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={priceMutation.isPending}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
            >
              {priceMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
