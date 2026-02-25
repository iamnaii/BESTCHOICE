import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import { useAuth } from '@/contexts/AuthContext';

interface Product {
  id: string;
  name: string;
  brand: string;
  model: string;
  imeiSerial: string | null;
  category: string;
  costPrice: string;
  status: string;
  conditionGrade: string | null;
  createdAt: string;
  branch: { id: string; name: string };
  supplier: { id: string; name: string } | null;
  prices: { id: string; label: string; amount: string; isDefault: boolean }[];
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

export default function ProductsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterBranch, setFilterBranch] = useState('');

  const isManager = user?.role === 'OWNER' || user?.role === 'BRANCH_MANAGER';

  const { data: products = [], isLoading } = useQuery<Product[]>({
    queryKey: ['products', search, filterStatus, filterCategory, filterBranch],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (search) params.search = search;
      if (filterStatus) params.status = filterStatus;
      if (filterCategory) params.category = filterCategory;
      if (filterBranch) params.branchId = filterBranch;
      const { data } = await api.get('/products', { params });
      return data;
    },
  });

  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => {
      const { data } = await api.get('/branches');
      return data;
    },
  });

  const columns = [
    {
      key: 'name',
      label: 'สินค้า',
      render: (p: Product) => (
        <button
          onClick={() => navigate(`/products/${p.id}`)}
          className="text-left hover:underline"
        >
          <div className="text-primary-600 font-medium">{p.brand} {p.model}</div>
          <div className="text-xs text-gray-400">{p.name}</div>
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
          <div>
            {defaultPrice ? (
              <div className="font-medium">{parseFloat(defaultPrice.amount).toLocaleString()} ฿</div>
            ) : (
              <span className="text-gray-400">-</span>
            )}
            <div className="text-xs text-gray-400">ทุน: {parseFloat(p.costPrice).toLocaleString()} ฿</div>
          </div>
        );
      },
    },
    {
      key: 'status',
      label: 'สถานะ',
      render: (p: Product) => {
        const s = statusLabels[p.status] || { label: p.status, className: 'bg-gray-100 text-gray-700' };
        return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.className}`}>{s.label}</span>;
      },
    },
    {
      key: 'conditionGrade',
      label: 'เกรด',
      render: (p: Product) => (
        <span className={`text-sm font-medium ${p.conditionGrade ? '' : 'text-gray-400'}`}>
          {p.conditionGrade || '-'}
        </span>
      ),
    },
    {
      key: 'branch',
      label: 'สาขา',
      render: (p: Product) => <span className="text-xs">{p.branch.name}</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="สินค้า"
        subtitle={`ทั้งหมด ${products.length} รายการ`}
        action={
          isManager ? (
            <button
              onClick={() => navigate('/products/create')}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors"
            >
              + เพิ่มสินค้า
            </button>
          ) : undefined
        }
      />

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
        <select
          value={filterBranch}
          onChange={(e) => setFilterBranch(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
        >
          <option value="">ทุกสาขา</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </div>

      <DataTable columns={columns} data={products} isLoading={isLoading} emptyMessage="ไม่พบสินค้า" />
    </div>
  );
}
