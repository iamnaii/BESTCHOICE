import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';

interface POItem {
  id: string;
  brand: string;
  model: string;
  quantity: number;
  unitPrice: string;
  receivedQty: number;
}

interface PurchaseOrder {
  id: string;
  poNumber: string;
  orderDate: string;
  expectedDate: string | null;
  status: string;
  totalAmount: string;
  notes: string | null;
  supplier: { id: string; name: string; contactName: string; phone: string };
  createdBy: { id: string; name: string };
  approvedBy: { id: string; name: string } | null;
  items: POItem[];
  _count: { products: number };
}

const statusLabels: Record<string, string> = {
  DRAFT: 'ร่าง',
  APPROVED: 'อนุมัติแล้ว',
  PARTIALLY_RECEIVED: 'รับบางส่วน',
  FULLY_RECEIVED: 'รับครบแล้ว',
  CANCELLED: 'ยกเลิก',
};

const statusColors: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  APPROVED: 'bg-blue-100 text-blue-700',
  PARTIALLY_RECEIVED: 'bg-yellow-100 text-yellow-700',
  FULLY_RECEIVED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-700',
};

interface ItemForm {
  brand: string;
  model: string;
  quantity: string;
  unitPrice: string;
}

export default function PurchaseOrdersPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);
  const [form, setForm] = useState({
    supplierId: '',
    orderDate: new Date().toISOString().split('T')[0],
    expectedDate: '',
    notes: '',
  });
  const [items, setItems] = useState<ItemForm[]>([{ brand: '', model: '', quantity: '1', unitPrice: '' }]);

  const { data: suppliers = [] } = useQuery<{ id: string; name: string; contactName: string }[]>({
    queryKey: ['suppliers'],
    queryFn: async () => (await api.get('/suppliers')).data,
  });

  const { data: pos = [], isLoading } = useQuery<PurchaseOrder[]>({
    queryKey: ['purchase-orders', statusFilter],
    queryFn: async () => {
      const params = statusFilter ? `?status=${statusFilter}` : '';
      return (await api.get(`/purchase-orders${params}`)).data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => api.post('/purchase-orders', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      toast.success('สร้างใบสั่งซื้อสำเร็จ');
      setIsCreateModalOpen(false);
      resetForm();
    },
    onError: (err: { response?: { data?: { message?: string } } }) =>
      toast.error(err.response?.data?.message || 'เกิดข้อผิดพลาด'),
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => api.post(`/purchase-orders/${id}/approve`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      toast.success('อนุมัติ PO สำเร็จ');
    },
    onError: () => toast.error('เกิดข้อผิดพลาด'),
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => api.post(`/purchase-orders/${id}/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      toast.success('ยกเลิก PO สำเร็จ');
    },
    onError: () => toast.error('เกิดข้อผิดพลาด'),
  });

  const resetForm = () => {
    setForm({ supplierId: '', orderDate: new Date().toISOString().split('T')[0], expectedDate: '', notes: '' });
    setItems([{ brand: '', model: '', quantity: '1', unitPrice: '' }]);
  };

  const addItem = () => setItems([...items, { brand: '', model: '', quantity: '1', unitPrice: '' }]);
  const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx));
  const updateItem = (idx: number, field: string, value: string) => {
    const newItems = [...items];
    newItems[idx] = { ...newItems[idx], [field]: value };
    setItems(newItems);
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      ...form,
      expectedDate: form.expectedDate || undefined,
      items: items.map((i) => ({
        brand: i.brand,
        model: i.model,
        quantity: Number(i.quantity),
        unitPrice: Number(i.unitPrice),
      })),
    });
  };

  const totalAmount = items.reduce((sum, i) => sum + Number(i.quantity || 0) * Number(i.unitPrice || 0), 0);

  const columns = [
    {
      key: 'poNumber',
      label: 'เลข PO',
      render: (po: PurchaseOrder) => (
        <button
          onClick={() => { setSelectedPO(po); setIsDetailModalOpen(true); }}
          className="font-medium text-primary-600 hover:underline"
        >
          {po.poNumber}
        </button>
      ),
    },
    {
      key: 'supplier',
      label: 'Supplier',
      render: (po: PurchaseOrder) => (
        <div>
          <div className="font-medium">{po.supplier.name}</div>
          <div className="text-xs text-gray-500">{po.supplier.contactName}</div>
        </div>
      ),
    },
    {
      key: 'orderDate',
      label: 'วันที่สั่ง',
      render: (po: PurchaseOrder) => (
        <span className="text-sm">{new Date(po.orderDate).toLocaleDateString('th-TH')}</span>
      ),
    },
    {
      key: 'items',
      label: 'รายการ',
      render: (po: PurchaseOrder) => (
        <span className="text-sm">{po.items.length} รายการ</span>
      ),
    },
    {
      key: 'totalAmount',
      label: 'ยอดรวม',
      render: (po: PurchaseOrder) => (
        <span className="text-sm font-medium">{Number(po.totalAmount).toLocaleString()} บาท</span>
      ),
    },
    {
      key: 'status',
      label: 'สถานะ',
      render: (po: PurchaseOrder) => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[po.status]}`}>
          {statusLabels[po.status]}
        </span>
      ),
    },
    {
      key: 'received',
      label: 'รับสินค้า',
      render: (po: PurchaseOrder) => {
        const totalOrdered = po.items.reduce((s, i) => s + i.quantity, 0);
        const totalReceived = po.items.reduce((s, i) => s + i.receivedQty, 0);
        return (
          <span className="text-sm">
            {totalReceived}/{totalOrdered}
          </span>
        );
      },
    },
    {
      key: 'actions',
      label: '',
      render: (po: PurchaseOrder) => (
        <div className="flex gap-2">
          {po.status === 'DRAFT' && (
            <>
              <button
                onClick={() => approveMutation.mutate(po.id)}
                className="text-green-600 hover:text-green-700 text-sm font-medium"
              >
                อนุมัติ
              </button>
              <button
                onClick={() => cancelMutation.mutate(po.id)}
                className="text-red-600 hover:text-red-700 text-sm font-medium"
              >
                ยกเลิก
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
        title="ใบสั่งซื้อ (PO)"
        subtitle="จัดการการสั่งซื้อสินค้า"
        action={
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors"
          >
            + สร้าง PO
          </button>
        }
      />

      {/* Filter */}
      <div className="mb-4">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
        >
          <option value="">ทุกสถานะ</option>
          <option value="DRAFT">ร่าง</option>
          <option value="APPROVED">อนุมัติแล้ว</option>
          <option value="PARTIALLY_RECEIVED">รับบางส่วน</option>
          <option value="FULLY_RECEIVED">รับครบแล้ว</option>
          <option value="CANCELLED">ยกเลิก</option>
        </select>
      </div>

      <DataTable columns={columns} data={pos} isLoading={isLoading} emptyMessage="ยังไม่มีใบสั่งซื้อ" />

      {/* Create PO Modal */}
      <Modal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} title="สร้างใบสั่งซื้อ" size="lg">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Supplier *</label>
            <select
              value={form.supplierId}
              onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
              required
            >
              <option value="">-- เลือก Supplier --</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({s.contactName})</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">วันที่สั่ง *</label>
              <input
                type="date"
                value={form.orderDate}
                onChange={(e) => setForm({ ...form, orderDate: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">วันที่คาดรับสินค้า</label>
              <input
                type="date"
                value={form.expectedDate}
                onChange={(e) => setForm({ ...form, expectedDate: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
              />
            </div>
          </div>

          {/* Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">รายการสินค้า</label>
              <button type="button" onClick={addItem} className="text-sm text-primary-600 hover:text-primary-700">
                + เพิ่มรายการ
              </button>
            </div>
            <div className="space-y-3">
              {items.map((item, idx) => (
                <div key={idx} className="flex gap-2 items-start">
                  <input
                    type="text"
                    placeholder="ยี่ห้อ"
                    value={item.brand}
                    onChange={(e) => updateItem(idx, 'brand', e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                    required
                  />
                  <input
                    type="text"
                    placeholder="รุ่น"
                    value={item.model}
                    onChange={(e) => updateItem(idx, 'model', e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                    required
                  />
                  <input
                    type="number"
                    placeholder="จำนวน"
                    value={item.quantity}
                    onChange={(e) => updateItem(idx, 'quantity', e.target.value)}
                    className="w-20 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                    min="1"
                    required
                  />
                  <input
                    type="number"
                    placeholder="ราคา/ชิ้น"
                    value={item.unitPrice}
                    onChange={(e) => updateItem(idx, 'unitPrice', e.target.value)}
                    className="w-28 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
                    required
                  />
                  {items.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeItem(idx)}
                      className="text-red-500 hover:text-red-700 px-2 py-2"
                    >
                      &times;
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="text-right mt-2 text-sm font-medium">
              ยอดรวม: {totalAmount.toLocaleString()} บาท
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">หมายเหตุ</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setIsCreateModalOpen(false)} className="px-4 py-2 text-sm text-gray-600">
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
            >
              {createMutation.isPending ? 'กำลังสร้าง...' : 'สร้าง PO'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Detail Modal */}
      <Modal
        isOpen={isDetailModalOpen}
        onClose={() => setIsDetailModalOpen(false)}
        title={`รายละเอียด PO - ${selectedPO?.poNumber || ''}`}
        size="lg"
      >
        {selectedPO && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-500">Supplier:</span>{' '}
                <span className="font-medium">{selectedPO.supplier.name}</span>
              </div>
              <div>
                <span className="text-gray-500">สถานะ:</span>{' '}
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[selectedPO.status]}`}>
                  {statusLabels[selectedPO.status]}
                </span>
              </div>
              <div>
                <span className="text-gray-500">วันที่สั่ง:</span>{' '}
                {new Date(selectedPO.orderDate).toLocaleDateString('th-TH')}
              </div>
              <div>
                <span className="text-gray-500">ผู้สร้าง:</span> {selectedPO.createdBy.name}
              </div>
              {selectedPO.approvedBy && (
                <div>
                  <span className="text-gray-500">ผู้อนุมัติ:</span> {selectedPO.approvedBy.name}
                </div>
              )}
              <div>
                <span className="text-gray-500">ยอดรวม:</span>{' '}
                <span className="font-medium">{Number(selectedPO.totalAmount).toLocaleString()} บาท</span>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-2">รายการสินค้า</h4>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-3 py-2 text-left">ยี่ห้อ</th>
                    <th className="px-3 py-2 text-left">รุ่น</th>
                    <th className="px-3 py-2 text-right">จำนวน</th>
                    <th className="px-3 py-2 text-right">ราคา/ชิ้น</th>
                    <th className="px-3 py-2 text-right">รับแล้ว</th>
                    <th className="px-3 py-2 text-right">รวม</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedPO.items.map((item) => (
                    <tr key={item.id} className="border-b">
                      <td className="px-3 py-2">{item.brand}</td>
                      <td className="px-3 py-2">{item.model}</td>
                      <td className="px-3 py-2 text-right">{item.quantity}</td>
                      <td className="px-3 py-2 text-right">{Number(item.unitPrice).toLocaleString()}</td>
                      <td className="px-3 py-2 text-right">
                        <span className={item.receivedQty >= item.quantity ? 'text-green-600' : 'text-yellow-600'}>
                          {item.receivedQty}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {(item.quantity * Number(item.unitPrice)).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selectedPO.notes && (
              <div className="text-sm">
                <span className="text-gray-500">หมายเหตุ:</span> {selectedPO.notes}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
