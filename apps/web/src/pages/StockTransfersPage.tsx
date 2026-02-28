import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import { transferStatusLabels } from '@/lib/constants';

interface TransferProduct {
  id: string;
  name: string;
  brand: string;
  model: string;
  imeiSerial: string | null;
  serialNumber: string | null;
  photos: string[];
  status: string;
}

interface StockTransfer {
  id: string;
  productId: string;
  fromBranch: { id: string; name: string };
  toBranch: { id: string; name: string };
  status: string;
  notes: string | null;
  confirmedBy: { id: string; name: string } | null;
  confirmedAt: string | null;
  createdAt: string;
  product: TransferProduct;
}

export default function StockTransfersPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('PENDING');

  const { data: transfers = [], isLoading } = useQuery<StockTransfer[]>({
    queryKey: ['stock-transfers', statusFilter],
    queryFn: async () => {
      if (statusFilter === 'PENDING') {
        return (await api.get('/products/transfers/pending')).data;
      }
      const params = statusFilter ? `?status=${statusFilter}` : '';
      return (await api.get(`/products/transfers/history${params}`)).data;
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async (transferId: string) => api.post(`/products/transfers/${transferId}/confirm`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock-transfers'] });
      toast.success('ยืนยันรับสินค้าเข้าสาขาสำเร็จ');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const rejectMutation = useMutation({
    mutationFn: async (transferId: string) => api.post(`/products/transfers/${transferId}/reject`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock-transfers'] });
      toast.success('ปฏิเสธการโอนสำเร็จ');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const pendingCount = transfers.filter((t) => t.status === 'PENDING').length;

  const columns = [
    {
      key: 'product',
      label: 'สินค้า',
      render: (t: StockTransfer) => (
        <button
          onClick={() => navigate(`/products/${t.product.id}`)}
          className="text-left hover:underline"
        >
          <div className="text-primary-600 font-medium">{t.product.brand} {t.product.model}</div>
          {t.product.imeiSerial && (
            <div className="text-xs text-gray-400 font-mono">{t.product.imeiSerial}</div>
          )}
        </button>
      ),
    },
    {
      key: 'from',
      label: 'จากสาขา',
      render: (t: StockTransfer) => <span className="text-sm">{t.fromBranch.name}</span>,
    },
    {
      key: 'to',
      label: 'ไปสาขา',
      render: (t: StockTransfer) => <span className="text-sm font-medium">{t.toBranch.name}</span>,
    },
    {
      key: 'status',
      label: 'สถานะ',
      render: (t: StockTransfer) => {
        const s = transferStatusLabels[t.status] || { label: t.status, className: 'bg-gray-100 text-gray-700' };
        return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.className}`}>{s.label}</span>;
      },
    },
    {
      key: 'createdAt',
      label: 'วันที่โอน',
      render: (t: StockTransfer) => (
        <span className="text-xs">{new Date(t.createdAt).toLocaleString('th-TH')}</span>
      ),
    },
    {
      key: 'confirmedBy',
      label: 'ยืนยันโดย',
      render: (t: StockTransfer) => (
        <div className="text-xs">
          {t.confirmedBy ? (
            <>
              <div>{t.confirmedBy.name}</div>
              {t.confirmedAt && <div className="text-gray-400">{new Date(t.confirmedAt).toLocaleString('th-TH')}</div>}
            </>
          ) : (
            <span className="text-gray-400">-</span>
          )}
        </div>
      ),
    },
    {
      key: 'notes',
      label: 'หมายเหตุ',
      render: (t: StockTransfer) => (
        <span className="text-xs text-gray-500">{t.notes || '-'}</span>
      ),
    },
    {
      key: 'actions',
      label: '',
      render: (t: StockTransfer) => (
        <div className="flex gap-2">
          {t.status === 'PENDING' && (
            <>
              <button
                onClick={() => {
                  if (confirm(`ยืนยันรับสินค้า ${t.product.brand} ${t.product.model} เข้าสาขา ${t.toBranch.name}?`)) {
                    confirmMutation.mutate(t.id);
                  }
                }}
                disabled={confirmMutation.isPending}
                className="px-3 py-1 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700 disabled:opacity-50"
              >
                ยืนยันรับ
              </button>
              <button
                onClick={() => {
                  if (confirm(`ปฏิเสธการโอน ${t.product.brand} ${t.product.model}?`)) {
                    rejectMutation.mutate(t.id);
                  }
                }}
                disabled={rejectMutation.isPending}
                className="px-3 py-1 bg-red-600 text-white rounded text-xs font-medium hover:bg-red-700 disabled:opacity-50"
              >
                ปฏิเสธ
              </button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="โอนสินค้าระหว่างสาขา"
        subtitle={pendingCount > 0 ? `รอยืนยัน ${pendingCount} รายการ` : 'จัดการการโอนสินค้า'}
      />

      {/* Filter */}
      <div className="mb-4">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
        >
          <option value="PENDING">รอยืนยัน</option>
          <option value="CONFIRMED">ยืนยันแล้ว</option>
          <option value="REJECTED">ปฏิเสธ</option>
          <option value="">ทั้งหมด</option>
        </select>
      </div>

      <DataTable
        columns={columns}
        data={transfers}
        isLoading={isLoading}
        emptyMessage={statusFilter === 'PENDING' ? 'ไม่มีรายการโอนที่รอยืนยัน' : 'ไม่พบรายการโอน'}
      />
    </div>
  );
}
