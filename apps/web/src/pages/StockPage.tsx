import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';

interface StockProduct {
  id: string;
  name: string;
  brand: string;
  model: string;
  imeiSerial: string | null;
  category: string;
  costPrice: string;
  status: string;
  conditionGrade: string | null;
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

const statusLabels: Record<string, { label: string; className: string }> = {
  PO_RECEIVED: { label: 'รับจาก PO', className: 'bg-blue-100 text-blue-700' },
  INSPECTION: { label: 'กำลังตรวจ', className: 'bg-yellow-100 text-yellow-700' },
  IN_STOCK: { label: 'พร้อมขาย', className: 'bg-green-100 text-green-700' },
  RESERVED: { label: 'จอง', className: 'bg-purple-100 text-purple-700' },
  SOLD_INSTALLMENT: { label: 'ขายผ่อน', className: 'bg-indigo-100 text-indigo-700' },
  SOLD_CASH: { label: 'ขายสด', className: 'bg-teal-100 text-teal-700' },
  REPOSSESSED: { label: 'ยึดคืน', className: 'bg-red-100 text-red-700' },
  REFURBISHED: { label: 'ซ่อมแล้ว', className: 'bg-orange-100 text-orange-700' },
  SOLD_RESELL: { label: 'ขายต่อ', className: 'bg-cyan-100 text-cyan-700' },
};

const categoryLabels: Record<string, string> = {
  PHONE_NEW: 'มือถือใหม่',
  PHONE_USED: 'มือถือมือสอง',
  TABLET: 'แท็บเล็ต',
  ACCESSORY: 'อุปกรณ์เสริม',
};

export default function StockPage() {
  const navigate = useNavigate();
  const [filterBranch, setFilterBranch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCategory, setFilterCategory] = useState('');

  const { data, isLoading } = useQuery<{ products: StockProduct[]; summary: BranchSummary[] }>({
    queryKey: ['stock', filterBranch, filterStatus, filterCategory],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (filterBranch) params.branchId = filterBranch;
      if (filterStatus) params.status = filterStatus;
      if (filterCategory) params.category = filterCategory;
      const { data } = await api.get('/products/stock', { params });
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
        const defaultPrice = p.prices?.[0];
        return defaultPrice ? (
          <span className="text-sm font-medium">{parseFloat(defaultPrice.amount).toLocaleString()} ฿</span>
        ) : (
          <span className="text-gray-400">-</span>
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
      key: 'conditionGrade',
      label: 'เกรด',
      render: (p: StockProduct) => <span className="text-sm">{p.conditionGrade || '-'}</span>,
    },
    {
      key: 'branch',
      label: 'สาขา',
      render: (p: StockProduct) => <span className="text-xs font-medium">{p.branch.name}</span>,
    },
  ];

  return (
    <div>
      <PageHeader title="สต็อกสินค้า" subtitle={`พร้อมขาย ${totalInStock} ชิ้น | มูลค่ารวม ${totalValue.toLocaleString()} ฿`} />

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

      {/* Filters */}
      <div className="flex gap-3 mb-4">
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
    </div>
  );
}
