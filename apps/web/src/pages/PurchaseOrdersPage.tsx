import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api, { getErrorMessage } from '@/lib/api';
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

interface GoodsReceivingItem {
  id: string;
  imeiSerial: string | null;
  serialNumber: string | null;
  photos: string[];
  status: 'PASS' | 'REJECT';
  rejectReason: string | null;
  product: { id: string; name: string; imeiSerial: string | null; status: string } | null;
}

interface GoodsReceivingRecord {
  id: string;
  createdAt: string;
  notes: string | null;
  receivedBy: { id: string; name: string };
  items: GoodsReceivingItem[];
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

interface PODetail extends PurchaseOrder {
  goodsReceivings: GoodsReceivingRecord[];
}

const statusLabels: Record<string, string> = {
  DRAFT: 'ร่าง',
  PENDING: 'รอรับสินค้า',
  APPROVED: 'อนุมัติแล้ว',
  PARTIALLY_RECEIVED: 'รับบางส่วน',
  FULLY_RECEIVED: 'รับครบแล้ว',
  CANCELLED: 'ยกเลิก',
};

const statusColors: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  PENDING: 'bg-orange-100 text-orange-700',
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

interface ReceivingUnitForm {
  poItemId: string;
  label: string;
  imeiSerial: string;
  serialNumber: string;
  status: 'PASS' | 'REJECT';
  rejectReason: string;
}

export default function PurchaseOrdersPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false);
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);
  const [poDetail, setPODetail] = useState<PODetail | null>(null);
  const [receivingUnits, setReceivingUnits] = useState<ReceivingUnitForm[]>([]);
  const [receivingNotes, setReceivingNotes] = useState('');
  const [form, setForm] = useState({
    supplierId: '',
    orderDate: new Date().toISOString().split('T')[0],
    expectedDate: '',
    notes: '',
  });
  const [items, setItems] = useState<ItemForm[]>([{ brand: '', model: '', quantity: '1', unitPrice: '' }]);

  const { data: suppliersRes } = useQuery<{ data: { id: string; name: string; contactName: string }[] }>({
    queryKey: ['suppliers-for-po'],
    queryFn: async () => (await api.get('/suppliers?limit=999&isActive=true')).data,
  });
  const suppliers = suppliersRes?.data || [];

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
      toast.success('สร้างใบสั่งซื้อสำเร็จ (สถานะ: รอรับสินค้า)');
      setIsCreateModalOpen(false);
      resetForm();
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => api.post(`/purchase-orders/${id}/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      toast.success('ยกเลิก PO สำเร็จ');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const goodsReceivingMutation = useMutation({
    mutationFn: async ({ poId, items, notes }: { poId: string; items: ReceivingUnitForm[]; notes: string }) =>
      api.post(`/purchase-orders/${poId}/goods-receiving`, {
        items: items.map((i) => ({
          poItemId: i.poItemId,
          imeiSerial: i.imeiSerial || undefined,
          serialNumber: i.serialNumber || undefined,
          status: i.status,
          rejectReason: i.status === 'REJECT' ? i.rejectReason || undefined : undefined,
        })),
        notes: notes || undefined,
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      const data = res.data;
      toast.success(`รับสินค้าสำเร็จ: ผ่าน ${data.passed} ชิ้น, ไม่ผ่าน ${data.rejected} ชิ้น → เข้าคลัง ${data.mainWarehouse}`);
      setIsReceiveModalOpen(false);
      setIsDetailModalOpen(false);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
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

  const openDetailModal = async (po: PurchaseOrder) => {
    setSelectedPO(po);
    setIsDetailModalOpen(true);
    // Fetch full detail with goods receivings
    try {
      const { data } = await api.get(`/purchase-orders/${po.id}`);
      setPODetail(data);
    } catch {
      setPODetail(null);
    }
  };

  const openReceiveModal = (po: PurchaseOrder) => {
    setSelectedPO(po);
    setReceivingNotes('');
    // Build per-unit receiving forms for remaining items
    const units: ReceivingUnitForm[] = [];
    for (const item of po.items) {
      const remaining = item.quantity - item.receivedQty;
      for (let i = 0; i < remaining; i++) {
        units.push({
          poItemId: item.id,
          label: `${item.brand} ${item.model} #${item.receivedQty + i + 1}`,
          imeiSerial: '',
          serialNumber: '',
          status: 'PASS',
          rejectReason: '',
        });
      }
    }
    setReceivingUnits(units);
    setIsReceiveModalOpen(true);
  };

  const updateReceivingUnit = (idx: number, field: string, value: string) => {
    const newUnits = [...receivingUnits];
    newUnits[idx] = { ...newUnits[idx], [field]: value };
    setReceivingUnits(newUnits);
  };

  const handleGoodsReceiving = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPO) return;

    if (receivingUnits.length === 0) {
      toast.error('ไม่มีรายการที่รอรับสินค้า');
      return;
    }

    // Check that rejected items have reasons
    const missingReasons = receivingUnits.filter((u) => u.status === 'REJECT' && !u.rejectReason.trim());
    if (missingReasons.length > 0) {
      toast.error('กรุณาระบุเหตุผลสำหรับรายการที่ไม่ผ่าน');
      return;
    }

    goodsReceivingMutation.mutate({
      poId: selectedPO.id,
      items: receivingUnits,
      notes: receivingNotes,
    });
  };

  const totalAmount = items.reduce((sum, i) => sum + Number(i.quantity || 0) * Number(i.unitPrice || 0), 0);

  const columns = [
    {
      key: 'poNumber',
      label: 'เลข PO',
      render: (po: PurchaseOrder) => (
        <button
          onClick={() => openDetailModal(po)}
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
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[po.status] || 'bg-gray-100 text-gray-700'}`}>
          {statusLabels[po.status] || po.status}
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
          <div className="flex items-center gap-2">
            <span className="text-sm">
              {totalReceived}/{totalOrdered}
            </span>
            {totalOrdered > 0 && (
              <div className="w-16 bg-gray-200 rounded-full h-1.5">
                <div
                  className="bg-green-500 h-1.5 rounded-full"
                  style={{ width: `${Math.min((totalReceived / totalOrdered) * 100, 100)}%` }}
                />
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: 'actions',
      label: '',
      render: (po: PurchaseOrder) => (
        <div className="flex gap-2">
          {['PENDING', 'APPROVED', 'PARTIALLY_RECEIVED'].includes(po.status) && (
            <button
              onClick={() => openReceiveModal(po)}
              className="text-blue-600 hover:text-blue-700 text-sm font-medium"
            >
              รับสินค้า
            </button>
          )}
          {['DRAFT', 'PENDING'].includes(po.status) && (
            <button
              onClick={() => {
                if (confirm('ต้องการยกเลิก PO นี้?')) cancelMutation.mutate(po.id);
              }}
              className="text-red-600 hover:text-red-700 text-sm font-medium"
            >
              ยกเลิก
            </button>
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
          <option value="PENDING">รอรับสินค้า</option>
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
        onClose={() => { setIsDetailModalOpen(false); setPODetail(null); }}
        title={`รายละเอียด PO - ${selectedPO?.poNumber || ''}`}
        size="xl"
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
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[selectedPO.status] || ''}`}>
                  {statusLabels[selectedPO.status] || selectedPO.status}
                </span>
              </div>
              <div>
                <span className="text-gray-500">วันที่สั่ง:</span>{' '}
                {new Date(selectedPO.orderDate).toLocaleDateString('th-TH')}
              </div>
              <div>
                <span className="text-gray-500">ผู้สร้าง:</span> {selectedPO.createdBy.name}
              </div>
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
                    <th className="px-3 py-2 text-right">คงเหลือ</th>
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
                        <span className={item.receivedQty >= item.quantity ? 'text-green-600 font-medium' : 'text-yellow-600'}>
                          {item.receivedQty}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className={item.quantity - item.receivedQty > 0 ? 'text-red-600' : 'text-green-600'}>
                          {item.quantity - item.receivedQty}
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

            {/* Goods Receiving History */}
            {poDetail?.goodsReceivings && poDetail.goodsReceivings.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-2">ประวัติการรับสินค้า</h4>
                <div className="space-y-3">
                  {poDetail.goodsReceivings.map((gr) => {
                    const passCount = gr.items.filter((i) => i.status === 'PASS').length;
                    const rejectCount = gr.items.filter((i) => i.status === 'REJECT').length;
                    return (
                      <div key={gr.id} className="border rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-sm">
                            <span className="font-medium">{gr.receivedBy.name}</span>
                            <span className="text-gray-500 ml-2">
                              {new Date(gr.createdAt).toLocaleString('th-TH')}
                            </span>
                          </div>
                          <div className="flex gap-2">
                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                              ผ่าน {passCount}
                            </span>
                            {rejectCount > 0 && (
                              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                                ไม่ผ่าน {rejectCount}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="space-y-1">
                          {gr.items.map((item) => (
                            <div key={item.id} className="flex items-center gap-2 text-xs">
                              <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                                item.status === 'PASS' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                              }`}>
                                {item.status === 'PASS' ? 'PASS' : 'REJECT'}
                              </span>
                              {item.imeiSerial && (
                                <span className="font-mono text-gray-600">IMEI: {item.imeiSerial}</span>
                              )}
                              {item.serialNumber && (
                                <span className="font-mono text-gray-600">SN: {item.serialNumber}</span>
                              )}
                              {item.rejectReason && (
                                <span className="text-red-500">({item.rejectReason})</span>
                              )}
                            </div>
                          ))}
                        </div>
                        {gr.notes && <div className="text-xs text-gray-500 mt-1">หมายเหตุ: {gr.notes}</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Receive button in detail modal */}
            {['PENDING', 'APPROVED', 'PARTIALLY_RECEIVED'].includes(selectedPO.status) && (
              <div className="flex justify-end pt-2 border-t">
                <button
                  onClick={() => openReceiveModal(selectedPO)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                >
                  รับสินค้า
                </button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Goods Receiving Modal */}
      <Modal
        isOpen={isReceiveModalOpen}
        onClose={() => setIsReceiveModalOpen(false)}
        title={`รับสินค้า - ${selectedPO?.poNumber || ''}`}
        size="xl"
      >
        {selectedPO && (
          <form onSubmit={handleGoodsReceiving} className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-700">
              ตรวจรับสินค้าทีละชิ้น ระบุ IMEI/Serial แล้วเลือกผลตรวจ (ผ่าน/ไม่ผ่าน)
              <br />
              สินค้าที่ผ่านจะเข้าคลังกลางอัตโนมัติ
            </div>

            <div className="space-y-3 max-h-[50vh] overflow-y-auto">
              {receivingUnits.map((unit, idx) => (
                <div key={idx} className={`border rounded-lg p-3 ${unit.status === 'REJECT' ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">{unit.label}</span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => updateReceivingUnit(idx, 'status', 'PASS')}
                        className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                          unit.status === 'PASS'
                            ? 'bg-green-600 text-white'
                            : 'bg-gray-100 text-gray-600 hover:bg-green-100'
                        }`}
                      >
                        PASS
                      </button>
                      <button
                        type="button"
                        onClick={() => updateReceivingUnit(idx, 'status', 'REJECT')}
                        className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                          unit.status === 'REJECT'
                            ? 'bg-red-600 text-white'
                            : 'bg-gray-100 text-gray-600 hover:bg-red-100'
                        }`}
                      >
                        REJECT
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      placeholder="IMEI"
                      value={unit.imeiSerial}
                      onChange={(e) => updateReceivingUnit(idx, 'imeiSerial', e.target.value)}
                      className="px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono"
                    />
                    <input
                      type="text"
                      placeholder="Serial Number"
                      value={unit.serialNumber}
                      onChange={(e) => updateReceivingUnit(idx, 'serialNumber', e.target.value)}
                      className="px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono"
                    />
                  </div>
                  {unit.status === 'REJECT' && (
                    <input
                      type="text"
                      placeholder="เหตุผลที่ไม่ผ่าน *"
                      value={unit.rejectReason}
                      onChange={(e) => updateReceivingUnit(idx, 'rejectReason', e.target.value)}
                      className="mt-2 w-full px-2 py-1.5 border border-red-300 rounded text-sm focus:ring-2 focus:ring-red-500 outline-none"
                    />
                  )}
                </div>
              ))}

              {receivingUnits.length === 0 && (
                <div className="text-center py-4 text-gray-500 text-sm">
                  ไม่มีรายการที่รอรับสินค้า
                </div>
              )}
            </div>

            {receivingUnits.length > 0 && (
              <div className="bg-gray-50 rounded-lg p-3 text-sm">
                <div className="flex gap-4">
                  <span>ทั้งหมด: <strong>{receivingUnits.length}</strong></span>
                  <span className="text-green-700">ผ่าน: <strong>{receivingUnits.filter((u) => u.status === 'PASS').length}</strong></span>
                  <span className="text-red-700">ไม่ผ่าน: <strong>{receivingUnits.filter((u) => u.status === 'REJECT').length}</strong></span>
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">หมายเหตุ</label>
              <textarea
                value={receivingNotes}
                onChange={(e) => setReceivingNotes(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="บันทึกเพิ่มเติม..."
              />
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t">
              <button
                type="button"
                onClick={() => setIsReceiveModalOpen(false)}
                className="px-4 py-2 text-sm text-gray-600"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={goodsReceivingMutation.isPending || receivingUnits.length === 0}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {goodsReceivingMutation.isPending ? 'กำลังรับสินค้า...' : 'ยืนยันรับสินค้า'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
