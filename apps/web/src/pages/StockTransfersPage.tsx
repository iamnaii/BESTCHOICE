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
  trackingNote: string | null;
  confirmedBy: { id: string; name: string } | null;
  confirmedAt: string | null;
  dispatchedBy: { id: string; name: string } | null;
  dispatchedAt: string | null;
  expectedDeliveryDate: string | null;
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
      if (statusFilter === 'IN_TRANSIT') {
        return (await api.get('/products/transfers/in-transit')).data;
      }
      const params = statusFilter ? `?status=${statusFilter}` : '';
      const res = await api.get(`/products/transfers/history${params}`);
      return res.data?.data || res.data;
    },
  });

  const dispatchMutation = useMutation({
    mutationFn: async ({ transferId, trackingNote }: { transferId: string; trackingNote?: string }) =>
      api.post(`/products/transfers/${transferId}/dispatch`, { trackingNote }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock-transfers'] });
      toast.success('จัดส่งสินค้าเรียบร้อย');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
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
  const inTransitCount = transfers.filter((t) => t.status === 'IN_TRANSIT').length;

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
        <div className="text-xs">
          <div>{new Date(t.createdAt).toLocaleString('th-TH')}</div>
          {t.dispatchedAt && (
            <div className="text-blue-500">ส่ง: {new Date(t.dispatchedAt).toLocaleString('th-TH')}</div>
          )}
        </div>
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
          ) : t.dispatchedBy ? (
            <>
              <div className="text-blue-600">จัดส่งโดย: {t.dispatchedBy.name}</div>
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
        <span className="text-xs text-gray-500">{t.trackingNote || t.notes || '-'}</span>
      ),
    },
    {
      key: 'actions',
      label: '',
      render: (t: StockTransfer) => (
        <div className="flex gap-2">
          {t.status === 'PENDING' && (
            <button
              onClick={() => {
                const note = prompt('หมายเหตุการจัดส่ง (ถ้ามี):');
                if (note !== null) {
                  dispatchMutation.mutate({ transferId: t.id, trackingNote: note || undefined });
                }
              }}
              disabled={dispatchMutation.isPending}
              className="px-3 py-1 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              จัดส่ง
            </button>
          )}
          {t.status === 'IN_TRANSIT' && (
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
        subtitle={
          pendingCount > 0 || inTransitCount > 0
            ? `รอจัดส่ง ${pendingCount} | กำลังส่ง ${inTransitCount} รายการ`
            : 'จัดการการโอนสินค้า'
        }
      />

      {/* Filter */}
      <div className="mb-4">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
        >
          <option value="PENDING">รอจัดส่ง</option>
          <option value="IN_TRANSIT">กำลังจัดส่ง</option>
          <option value="CONFIRMED">รับแล้ว</option>
          <option value="REJECTED">ปฏิเสธ</option>
          <option value="">ทั้งหมด</option>
        </select>
      </div>

      <DataTable
        columns={columns}
        data={transfers}
        isLoading={isLoading}
        emptyMessage={
          statusFilter === 'PENDING' ? 'ไม่มีรายการรอจัดส่ง'
          : statusFilter === 'IN_TRANSIT' ? 'ไม่มีรายการกำลังจัดส่ง'
          : 'ไม่พบรายการโอน'
        }
      />
    </div>
  );
}
