import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { brands, getModels, getModelInfo } from '@/data/productCatalog';

interface POItem {
  id: string;
  brand: string;
  model: string;
  color: string | null;
  storage: string | null;
  category: string | null;
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
  subtotal: string;
  vatAmount: string;
  totalAmount: string;
  discount: string;
  netAmount: string;
  paymentStatus: string;
  paymentMethod: string | null;
  paidAmount: string;
  paymentNotes: string | null;
  attachments: string[];
  notes: string | null;
  supplier: { id: string; name: string; contactName: string; phone: string; hasVat: boolean };
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

const paymentStatusLabels: Record<string, string> = {
  UNPAID: 'ยังไม่จ่าย',
  DEPOSIT_PAID: 'จ่ายมัดจำ',
  PARTIALLY_PAID: 'จ่ายบางส่วน',
  FULLY_PAID: 'จ่ายครบแล้ว',
};

const paymentStatusColors: Record<string, string> = {
  UNPAID: 'bg-red-100 text-red-700',
  DEPOSIT_PAID: 'bg-yellow-100 text-yellow-700',
  PARTIALLY_PAID: 'bg-blue-100 text-blue-700',
  FULLY_PAID: 'bg-green-100 text-green-700',
};

const categoryLabels: Record<string, string> = {
  PHONE_NEW: 'โทรศัพท์ (ใหม่)',
  PHONE_USED: 'โทรศัพท์ (มือสอง)',
  TABLET: 'แท็บเล็ต',
  ACCESSORY: 'อุปกรณ์เสริม',
};

interface ItemForm {
  brand: string;
  category: string;
  model: string;
  color: string;
  storage: string;
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

const emptyItem: ItemForm = { brand: '', category: '', model: '', color: '', storage: '', quantity: '1', unitPrice: '' };

export default function PurchaseOrdersPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);
  const [poDetail, setPODetail] = useState<PODetail | null>(null);
  const [receivingUnits, setReceivingUnits] = useState<ReceivingUnitForm[]>([]);
  const [receivingNotes, setReceivingNotes] = useState('');
  const [paymentForm, setPaymentForm] = useState({ paymentStatus: '', paymentMethod: '', paidAmount: '', paymentNotes: '' });
  const [paymentAttachments, setPaymentAttachments] = useState<string[]>([]);
  const [paymentAttachmentUrl, setPaymentAttachmentUrl] = useState('');
  const [form, setForm] = useState({
    supplierId: '',
    orderDate: new Date().toISOString().split('T')[0],
    expectedDate: '',
    notes: '',
    discount: '',
    paymentStatus: 'UNPAID',
    paymentMethod: '',
    paidAmount: '',
    paymentNotes: '',
  });
  const [items, setItems] = useState<ItemForm[]>([{ ...emptyItem }]);

  const { data: suppliersRes } = useQuery<{ data: { id: string; name: string; contactName: string; hasVat: boolean; paymentMethods: { paymentMethod: string; bankName?: string; bankAccountName?: string; bankAccountNumber?: string; creditTermDays?: number; isDefault: boolean }[] }[] }>({
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

  const paymentMutation = useMutation({
    mutationFn: async ({ poId, data }: { poId: string; data: Record<string, unknown> }) =>
      api.patch(`/purchase-orders/${poId}/payment`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      toast.success('อัปเดตสถานะการจ่ายเงินสำเร็จ');
      setIsPaymentModalOpen(false);
      // Refresh detail if open
      if (selectedPO) {
        api.get(`/purchase-orders/${selectedPO.id}`).then(({ data }) => {
          setPODetail(data);
          setSelectedPO(data);
        });
      }
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const [attachmentUrl, setAttachmentUrl] = useState('');
  const [formAttachments, setFormAttachments] = useState<string[]>([]);

  const resetForm = () => {
    setForm({ supplierId: '', orderDate: new Date().toISOString().split('T')[0], expectedDate: '', notes: '', discount: '', paymentStatus: 'UNPAID', paymentMethod: '', paidAmount: '', paymentNotes: '' });
    setItems([{ ...emptyItem }]);
    setFormAttachments([]);
    setAttachmentUrl('');
  };

  const addItem = () => setItems([...items, { ...emptyItem }]);
  const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx));

  const updateItem = (idx: number, field: string, value: string) => {
    const newItems = [...items];
    const item = { ...newItems[idx], [field]: value };

    // Cascade reset when parent changes
    if (field === 'brand') {
      item.category = '';
      item.model = '';
      item.color = '';
      item.storage = '';
    } else if (field === 'category') {
      item.model = '';
      item.color = '';
      item.storage = '';
    } else if (field === 'model') {
      item.color = '';
      item.storage = '';
    }

    newItems[idx] = item;
    setItems(newItems);
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      supplierId: form.supplierId,
      orderDate: form.orderDate,
      expectedDate: form.expectedDate || undefined,
      notes: form.notes || undefined,
      discount: form.discount ? Number(form.discount) : undefined,
      paymentStatus: form.paymentStatus !== 'UNPAID' ? form.paymentStatus : undefined,
      paymentMethod: form.paymentMethod || undefined,
      paidAmount: form.paidAmount ? Number(form.paidAmount) : undefined,
      paymentNotes: form.paymentNotes || undefined,
      attachments: formAttachments.length > 0 ? formAttachments : undefined,
      items: items.map((i) => ({
        brand: i.brand,
        model: i.model,
        color: i.color || undefined,
        storage: i.storage || undefined,
        category: i.category || undefined,
        quantity: Number(i.quantity),
        unitPrice: Number(i.unitPrice),
      })),
    });
  };

  const openDetailModal = async (po: PurchaseOrder) => {
    setSelectedPO(po);
    setIsDetailModalOpen(true);
    try {
      const { data } = await api.get(`/purchase-orders/${po.id}`);
      setPODetail(data);
      setSelectedPO(data);
    } catch {
      setPODetail(null);
    }
  };

  const openReceiveModal = (po: PurchaseOrder) => {
    setSelectedPO(po);
    setReceivingNotes('');
    const units: ReceivingUnitForm[] = [];
    for (const item of po.items) {
      const remaining = item.quantity - item.receivedQty;
      const nameParts = [item.brand, item.model, item.color, item.storage].filter(Boolean);
      for (let i = 0; i < remaining; i++) {
        units.push({
          poItemId: item.id,
          label: `${nameParts.join(' ')} #${item.receivedQty + i + 1}`,
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

  const openPaymentModal = (po: PurchaseOrder) => {
    setSelectedPO(po);
    setPaymentForm({
      paymentStatus: po.paymentStatus || 'UNPAID',
      paymentMethod: po.paymentMethod || '',
      paidAmount: po.paidAmount ? String(Number(po.paidAmount)) : '0',
      paymentNotes: po.paymentNotes || '',
    });
    setPaymentAttachments(po.attachments || []);
    setPaymentAttachmentUrl('');
    setIsPaymentModalOpen(true);
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

  const handlePaymentUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPO) return;
    paymentMutation.mutate({
      poId: selectedPO.id,
      data: {
        paymentStatus: paymentForm.paymentStatus,
        paymentMethod: paymentForm.paymentMethod || undefined,
        paidAmount: Number(paymentForm.paidAmount),
        paymentNotes: paymentForm.paymentNotes || undefined,
        attachments: paymentAttachments,
      },
    });
  };

  const subtotal = items.reduce((sum, i) => sum + Number(i.quantity || 0) * Number(i.unitPrice || 0), 0);
  const selectedSupplier = suppliers.find((s) => s.id === form.supplierId);
  const supplierHasVat = selectedSupplier?.hasVat ?? false;
  const discountNum = Number(form.discount) || 0;
  const subtotalAfterDiscount = subtotal - discountNum;
  const vatAmount = supplierHasVat ? Math.round(subtotalAfterDiscount * 0.07 * 100) / 100 : 0;
  const netAmount = subtotalAfterDiscount + vatAmount;

  const selectClass = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 outline-none';
  const inputClass = selectClass;

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
        <div>
          <span className="text-sm font-medium">{Number(po.totalAmount).toLocaleString()} บาท</span>
          {Number(po.vatAmount) > 0 && (
            <div className="text-xs text-blue-600">รวม VAT {Number(po.vatAmount).toLocaleString()}</div>
          )}
        </div>
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
      key: 'paymentStatus',
      label: 'การจ่ายเงิน',
      render: (po: PurchaseOrder) => (
        <button
          onClick={() => openPaymentModal(po)}
          className={`px-2 py-0.5 rounded-full text-xs font-medium cursor-pointer hover:opacity-80 ${paymentStatusColors[po.paymentStatus] || 'bg-gray-100 text-gray-700'}`}
        >
          {paymentStatusLabels[po.paymentStatus] || po.paymentStatus || 'ยังไม่จ่าย'}
        </button>
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

  // Helper to get item description for detail view
  const getItemDesc = (item: POItem) => {
    const parts = [item.color, item.storage].filter(Boolean);
    return parts.length > 0 ? parts.join(' / ') : '-';
  };

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
      <Modal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} title="สร้างใบสั่งซื้อ" size="xl">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Supplier *</label>
            <select
              value={form.supplierId}
              onChange={(e) => {
                const sid = e.target.value;
                const sup = suppliers.find((s) => s.id === sid);
                const defaultPm = sup?.paymentMethods?.find((pm) => pm.isDefault) || sup?.paymentMethods?.[0];
                setForm({
                  ...form,
                  supplierId: sid,
                  paymentMethod: defaultPm?.paymentMethod || form.paymentMethod,
                });
              }}
              className={selectClass}
              required
            >
              <option value="">-- เลือก Supplier --</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({s.contactName}){s.hasVat ? ' [VAT]' : ''}</option>
              ))}
            </select>
            {selectedSupplier && (
              <div className="mt-1 flex gap-2 flex-wrap">
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    supplierHasVat ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {supplierHasVat ? 'Supplier มี VAT - จะคำนวณ VAT 7% อัตโนมัติ' : 'Supplier ไม่มี VAT'}
                </span>
                {selectedSupplier.paymentMethods?.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">
                    ชำระ: {selectedSupplier.paymentMethods.map((pm) => {
                      const labels: Record<string, string> = { CASH: 'เงินสด', BANK_TRANSFER: 'โอนธนาคาร', CHECK: 'เช็ค', CREDIT: 'เครดิต' };
                      return labels[pm.paymentMethod] || pm.paymentMethod;
                    }).join(', ')}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">วันที่สั่ง *</label>
              <input
                type="date"
                value={form.orderDate}
                onChange={(e) => setForm({ ...form, orderDate: e.target.value })}
                className={inputClass}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">วันที่คาดรับสินค้า</label>
              <input
                type="date"
                value={form.expectedDate}
                onChange={(e) => setForm({ ...form, expectedDate: e.target.value })}
                className={inputClass}
              />
            </div>
          </div>

          {/* Items with cascade dropdowns */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">รายการสินค้า</label>
              <button type="button" onClick={addItem} className="text-sm text-primary-600 hover:text-primary-700">
                + เพิ่มรายการ
              </button>
            </div>
            <div className="space-y-4">
              {items.map((item, idx) => {
                const availableModels = item.brand ? getModels(item.brand, item.category || undefined) : [];
                const modelInfo = item.brand && item.model ? getModelInfo(item.brand, item.model) : undefined;
                const availableColors = modelInfo?.colors || [];
                const availableStorage = modelInfo?.storage || [];

                return (
                  <div key={idx} className="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50 relative">
                    {items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeItem(idx)}
                        className="absolute top-2 right-2 text-red-400 hover:text-red-600 text-lg leading-none"
                      >
                        &times;
                      </button>
                    )}
                    <div className="text-xs font-medium text-gray-500 mb-1">รายการ #{idx + 1}</div>

                    {/* Row 1: Brand, Category, Model */}
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-xs text-gray-500 mb-0.5">ยี่ห้อ *</label>
                        <select
                          value={item.brand}
                          onChange={(e) => updateItem(idx, 'brand', e.target.value)}
                          className={selectClass}
                          required
                        >
                          <option value="">-- เลือกยี่ห้อ --</option>
                          {brands.map((b) => (
                            <option key={b} value={b}>{b}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-0.5">ประเภท</label>
                        <select
                          value={item.category}
                          onChange={(e) => updateItem(idx, 'category', e.target.value)}
                          className={selectClass}
                          disabled={!item.brand}
                        >
                          <option value="">-- ทั้งหมด --</option>
                          <option value="PHONE_NEW">โทรศัพท์ (ใหม่)</option>
                          <option value="PHONE_USED">โทรศัพท์ (มือสอง)</option>
                          <option value="TABLET">แท็บเล็ต</option>
                          <option value="ACCESSORY">อุปกรณ์เสริม</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-0.5">รุ่น *</label>
                        <select
                          value={item.model}
                          onChange={(e) => updateItem(idx, 'model', e.target.value)}
                          className={selectClass}
                          required
                          disabled={!item.brand}
                        >
                          <option value="">-- เลือกรุ่น --</option>
                          {availableModels.map((m) => (
                            <option key={m.name} value={m.name}>{m.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Row 2: Color, Storage, Quantity, Price */}
                    <div className="grid grid-cols-4 gap-2">
                      <div>
                        <label className="block text-xs text-gray-500 mb-0.5">สี</label>
                        <select
                          value={item.color}
                          onChange={(e) => updateItem(idx, 'color', e.target.value)}
                          className={selectClass}
                          disabled={availableColors.length === 0}
                        >
                          <option value="">-- เลือกสี --</option>
                          {availableColors.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-0.5">ความจุ</label>
                        <select
                          value={item.storage}
                          onChange={(e) => updateItem(idx, 'storage', e.target.value)}
                          className={selectClass}
                          disabled={availableStorage.length === 0}
                        >
                          <option value="">-- เลือกความจุ --</option>
                          {availableStorage.map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-0.5">จำนวน *</label>
                        <input
                          type="number"
                          value={item.quantity}
                          onChange={(e) => updateItem(idx, 'quantity', e.target.value)}
                          className={inputClass}
                          min="1"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-0.5">ราคา/ชิ้น *</label>
                        <input
                          type="number"
                          value={item.unitPrice}
                          onChange={(e) => updateItem(idx, 'unitPrice', e.target.value)}
                          className={inputClass}
                          required
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Summary Section */}
          <div className="border-t pt-4">
            <h4 className="text-sm font-medium text-gray-700 mb-2">สรุปยอด</h4>
            <div className="bg-gray-50 rounded-lg p-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">ยอดรวมสินค้า (Subtotal)</span>
                <span className="font-medium">{subtotal.toLocaleString()} บาท</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-500">ส่วนลด</span>
                <input
                  type="number"
                  value={form.discount}
                  onChange={(e) => setForm({ ...form, discount: e.target.value })}
                  className="w-32 px-2 py-1 border border-gray-300 rounded text-sm text-right focus:ring-2 focus:ring-primary-500 outline-none"
                  min="0"
                  placeholder="0"
                />
              </div>
              {discountNum > 0 && (
                <div className="flex justify-between text-gray-500">
                  <span>หลังหักส่วนลด</span>
                  <span>{subtotalAfterDiscount.toLocaleString()} บาท</span>
                </div>
              )}
              {supplierHasVat && (
                <div className="flex justify-between text-gray-500">
                  <span>VAT 7%</span>
                  <span>{vatAmount.toLocaleString()} บาท</span>
                </div>
              )}
              <div className="flex justify-between border-t pt-1 mt-1 font-semibold text-base">
                <span>ยอดสุทธิ</span>
                <span className="text-primary-700">{netAmount.toLocaleString()} บาท</span>
              </div>
            </div>
          </div>

          {/* Payment Section */}
          <div className="border-t pt-4">
            <h4 className="text-sm font-medium text-gray-700 mb-2">การจ่ายเงิน</h4>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">สถานะ</label>
                <select
                  value={form.paymentStatus}
                  onChange={(e) => {
                    const newStatus = e.target.value;
                    setForm({
                      ...form,
                      paymentStatus: newStatus,
                      paidAmount: newStatus === 'FULLY_PAID' ? String(Math.round(netAmount * 100) / 100) : newStatus === 'UNPAID' ? '' : form.paidAmount,
                    });
                  }}
                  className={selectClass}
                >
                  <option value="UNPAID">ยังไม่จ่าย</option>
                  <option value="DEPOSIT_PAID">จ่ายมัดจำ</option>
                  <option value="PARTIALLY_PAID">จ่ายบางส่วน</option>
                  <option value="FULLY_PAID">จ่ายครบแล้ว</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">วิธีจ่ายเงิน</label>
                <select
                  value={form.paymentMethod}
                  onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}
                  className={selectClass}
                  disabled={form.paymentStatus === 'UNPAID'}
                >
                  <option value="">-- เลือก --</option>
                  {selectedSupplier?.paymentMethods?.length ? (
                    selectedSupplier.paymentMethods.map((pm, idx) => {
                      const labels: Record<string, string> = { CASH: 'เงินสด', BANK_TRANSFER: 'โอนธนาคาร', CHECK: 'เช็ค', CREDIT: 'เครดิต' };
                      const label = labels[pm.paymentMethod] || pm.paymentMethod;
                      const detail = pm.bankName ? ` - ${pm.bankName}${pm.bankAccountNumber ? ` (${pm.bankAccountNumber})` : ''}` : '';
                      const credit = pm.creditTermDays ? ` ${pm.creditTermDays} วัน` : '';
                      return <option key={idx} value={pm.paymentMethod}>{label}{detail}{credit}{pm.isDefault ? ' (ค่าเริ่มต้น)' : ''}</option>;
                    })
                  ) : (
                    <>
                      <option value="CASH">เงินสด</option>
                      <option value="BANK_TRANSFER">โอนธนาคาร</option>
                      <option value="CHECK">เช็ค</option>
                      <option value="CREDIT">เครดิต</option>
                    </>
                  )}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">จำนวนที่จ่าย (บาท)</label>
                <input
                  type="number"
                  value={form.paidAmount}
                  onChange={(e) => setForm({ ...form, paidAmount: e.target.value })}
                  className={inputClass}
                  min="0"
                  step="0.01"
                  disabled={form.paymentStatus === 'UNPAID'}
                  placeholder={form.paymentStatus === 'UNPAID' ? '-' : '0'}
                />
                {form.paymentStatus !== 'UNPAID' && form.paymentStatus !== 'FULLY_PAID' && netAmount > 0 && (
                  <div className="flex gap-2 mt-1">
                    <button type="button" onClick={() => setForm({ ...form, paidAmount: String(Math.round(netAmount * 0.3)) })} className="text-xs text-blue-600 hover:underline">30%</button>
                    <button type="button" onClick={() => setForm({ ...form, paidAmount: String(Math.round(netAmount * 0.5)) })} className="text-xs text-blue-600 hover:underline">50%</button>
                  </div>
                )}
              </div>
            </div>
            {form.paymentStatus !== 'UNPAID' && (
              <div className="mt-2">
                <label className="block text-xs text-gray-500 mb-0.5">หมายเหตุการจ่ายเงิน</label>
                <input
                  type="text"
                  value={form.paymentNotes}
                  onChange={(e) => setForm({ ...form, paymentNotes: e.target.value })}
                  className={inputClass}
                  placeholder="เช่น เลขอ้างอิง, ชื่อบัญชี"
                />
              </div>
            )}
            {/* Attachments */}
            {form.paymentStatus !== 'UNPAID' && (
              <div className="mt-3">
                <label className="block text-xs text-gray-500 mb-0.5">แนบสลิป/เอกสาร</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={attachmentUrl}
                    onChange={(e) => setAttachmentUrl(e.target.value)}
                    className={inputClass}
                    placeholder="วาง URL รูปสลิป หรือ link เอกสาร"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (attachmentUrl.trim()) {
                        setFormAttachments([...formAttachments, attachmentUrl.trim()]);
                        setAttachmentUrl('');
                      }
                    }}
                    className="px-3 py-2 bg-gray-200 rounded-lg text-sm hover:bg-gray-300 whitespace-nowrap"
                  >
                    + เพิ่ม
                  </button>
                </div>
                {formAttachments.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {formAttachments.map((url, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-xs bg-blue-50 rounded px-2 py-1">
                        <a href={url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate flex-1">{url}</a>
                        <button type="button" onClick={() => setFormAttachments(formAttachments.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-600">&times;</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">หมายเหตุ</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
              className={inputClass}
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
                <span className="text-gray-500">ยอดสุทธิ:</span>{' '}
                <span className="font-medium">{Number(selectedPO.netAmount || selectedPO.totalAmount).toLocaleString()} บาท</span>
              </div>
              <div>
                <span className="text-gray-500">การจ่ายเงิน:</span>{' '}
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${paymentStatusColors[selectedPO.paymentStatus] || 'bg-gray-100 text-gray-700'}`}>
                  {paymentStatusLabels[selectedPO.paymentStatus] || 'ยังไม่จ่าย'}
                </span>
                {selectedPO.paymentMethod && (
                  <span className="ml-1 text-xs text-gray-500">
                    ({selectedPO.paymentMethod === 'CASH' ? 'เงินสด' : selectedPO.paymentMethod === 'BANK_TRANSFER' ? 'โอน' : selectedPO.paymentMethod === 'CHECK' ? 'เช็ค' : selectedPO.paymentMethod === 'CREDIT' ? 'เครดิต' : selectedPO.paymentMethod})
                  </span>
                )}
                {Number(selectedPO.paidAmount) > 0 && (
                  <span className="ml-1 text-gray-600">({Number(selectedPO.paidAmount).toLocaleString()} บาท)</span>
                )}
              </div>
            </div>

            {/* Summary */}
            {(Number(selectedPO.discount) > 0 || Number(selectedPO.vatAmount) > 0) && (
              <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-gray-500">ยอดรวมสินค้า</span><span>{Number(selectedPO.totalAmount).toLocaleString()} บาท</span></div>
                {Number(selectedPO.discount) > 0 && <div className="flex justify-between"><span className="text-gray-500">ส่วนลด</span><span className="text-red-600">-{Number(selectedPO.discount).toLocaleString()} บาท</span></div>}
                {Number(selectedPO.vatAmount) > 0 && <div className="flex justify-between"><span className="text-gray-500">VAT 7%</span><span>{Number(selectedPO.vatAmount).toLocaleString()} บาท</span></div>}
                <div className="flex justify-between font-semibold border-t pt-1"><span>ยอดสุทธิ</span><span>{Number(selectedPO.netAmount).toLocaleString()} บาท</span></div>
              </div>
            )}

            {/* Payment info bar */}
            {selectedPO.status !== 'CANCELLED' && (
              <div className="bg-gray-50 border rounded-lg p-3 flex items-center justify-between">
                <div className="text-sm">
                  <span className="text-gray-500">จ่ายแล้ว:</span>{' '}
                  <span className="font-medium text-lg">{Number(selectedPO.paidAmount || 0).toLocaleString()}</span>
                  <span className="text-gray-400"> / {Number(selectedPO.netAmount || selectedPO.totalAmount).toLocaleString()} บาท</span>
                  {Number(selectedPO.netAmount || selectedPO.totalAmount) > 0 && (
                    <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1">
                      <div
                        className="bg-green-500 h-1.5 rounded-full"
                        style={{ width: `${Math.min((Number(selectedPO.paidAmount || 0) / Number(selectedPO.netAmount || selectedPO.totalAmount)) * 100, 100)}%` }}
                      />
                    </div>
                  )}
                </div>
                <button
                  onClick={() => openPaymentModal(selectedPO)}
                  className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 transition-colors"
                >
                  อัปเดตการจ่ายเงิน
                </button>
              </div>
            )}

            {selectedPO.paymentNotes && (
              <div className="text-sm">
                <span className="text-gray-500">หมายเหตุการจ่ายเงิน:</span> {selectedPO.paymentNotes}
              </div>
            )}

            {/* Attachments in detail */}
            {selectedPO.attachments && selectedPO.attachments.length > 0 && (
              <div className="text-sm">
                <span className="text-gray-500">เอกสารแนบ:</span>
                <div className="mt-1 space-y-1">
                  {selectedPO.attachments.map((url, idx) => (
                    <a key={idx} href={url} target="_blank" rel="noopener noreferrer" className="block text-xs text-blue-600 hover:underline truncate">{url}</a>
                  ))}
                </div>
              </div>
            )}

            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-2">รายการสินค้า</h4>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-3 py-2 text-left">ยี่ห้อ</th>
                    <th className="px-3 py-2 text-left">รุ่น</th>
                    <th className="px-3 py-2 text-left">สี / ความจุ</th>
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
                      <td className="px-3 py-2 text-gray-600">{getItemDesc(item)}</td>
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

      {/* Payment Status Modal */}
      <Modal
        isOpen={isPaymentModalOpen}
        onClose={() => setIsPaymentModalOpen(false)}
        title={`อัปเดตการจ่ายเงิน - ${selectedPO?.poNumber || ''}`}
        size="md"
      >
        {selectedPO && (
          <form onSubmit={handlePaymentUpdate} className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-500">ยอดรวมสินค้า:</span>
                <span>{Number(selectedPO.totalAmount).toLocaleString()} บาท</span>
              </div>
              {Number(selectedPO.discount) > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-500">ส่วนลด:</span>
                  <span className="text-red-600">-{Number(selectedPO.discount).toLocaleString()} บาท</span>
                </div>
              )}
              {Number(selectedPO.vatAmount) > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-500">VAT 7%:</span>
                  <span>{Number(selectedPO.vatAmount).toLocaleString()} บาท</span>
                </div>
              )}
              <div className="flex justify-between font-medium border-t pt-1">
                <span>ยอดสุทธิ:</span>
                <span>{Number(selectedPO.netAmount || selectedPO.totalAmount).toLocaleString()} บาท</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">สถานะ *</label>
                <select
                  value={paymentForm.paymentStatus}
                  onChange={(e) => {
                    const newStatus = e.target.value;
                    const netAmt = Number(selectedPO.netAmount || selectedPO.totalAmount);
                    setPaymentForm({
                      ...paymentForm,
                      paymentStatus: newStatus,
                      paidAmount: newStatus === 'FULLY_PAID' ? String(netAmt) : newStatus === 'UNPAID' ? '0' : paymentForm.paidAmount,
                    });
                  }}
                  className={selectClass}
                  required
                >
                  <option value="UNPAID">ยังไม่จ่าย</option>
                  <option value="DEPOSIT_PAID">จ่ายมัดจำ</option>
                  <option value="PARTIALLY_PAID">จ่ายบางส่วน</option>
                  <option value="FULLY_PAID">จ่ายครบแล้ว</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">วิธีจ่ายเงิน</label>
                {(() => {
                  const poSupplier = suppliers.find((s) => s.id === selectedPO?.supplier.id);
                  const pmList = poSupplier?.paymentMethods;
                  return (
                    <select
                      value={paymentForm.paymentMethod}
                      onChange={(e) => setPaymentForm({ ...paymentForm, paymentMethod: e.target.value })}
                      className={selectClass}
                    >
                      <option value="">-- เลือก --</option>
                      {pmList?.length ? (
                        pmList.map((pm, idx) => {
                          const labels: Record<string, string> = { CASH: 'เงินสด', BANK_TRANSFER: 'โอนธนาคาร', CHECK: 'เช็ค', CREDIT: 'เครดิต' };
                          const label = labels[pm.paymentMethod] || pm.paymentMethod;
                          const detail = pm.bankName ? ` - ${pm.bankName}${pm.bankAccountNumber ? ` (${pm.bankAccountNumber})` : ''}` : '';
                          const credit = pm.creditTermDays ? ` ${pm.creditTermDays} วัน` : '';
                          return <option key={idx} value={pm.paymentMethod}>{label}{detail}{credit}{pm.isDefault ? ' (ค่าเริ่มต้น)' : ''}</option>;
                        })
                      ) : (
                        <>
                          <option value="CASH">เงินสด</option>
                          <option value="BANK_TRANSFER">โอนธนาคาร</option>
                          <option value="CHECK">เช็ค</option>
                          <option value="CREDIT">เครดิต</option>
                        </>
                      )}
                    </select>
                  );
                })()}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">จำนวนเงินที่จ่ายแล้ว (บาท) *</label>
              <input
                type="number"
                value={paymentForm.paidAmount}
                onChange={(e) => setPaymentForm({ ...paymentForm, paidAmount: e.target.value })}
                className={inputClass}
                min="0"
                step="0.01"
                required
              />
              {Number(selectedPO.netAmount || selectedPO.totalAmount) > 0 && paymentForm.paymentStatus !== 'UNPAID' && paymentForm.paymentStatus !== 'FULLY_PAID' && (
                <div className="flex gap-2 mt-1">
                  <button type="button" onClick={() => setPaymentForm({ ...paymentForm, paidAmount: String(Math.round(Number(selectedPO.netAmount || selectedPO.totalAmount) * 0.3)) })} className="text-xs text-blue-600 hover:underline">30%</button>
                  <button type="button" onClick={() => setPaymentForm({ ...paymentForm, paidAmount: String(Math.round(Number(selectedPO.netAmount || selectedPO.totalAmount) * 0.5)) })} className="text-xs text-blue-600 hover:underline">50%</button>
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">หมายเหตุ</label>
              <textarea
                value={paymentForm.paymentNotes}
                onChange={(e) => setPaymentForm({ ...paymentForm, paymentNotes: e.target.value })}
                rows={2}
                className={inputClass}
                placeholder="เช่น เลขอ้างอิง, ชื่อบัญชี"
              />
            </div>

            {/* Attachments */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">แนบสลิป/เอกสาร</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={paymentAttachmentUrl}
                  onChange={(e) => setPaymentAttachmentUrl(e.target.value)}
                  className={inputClass}
                  placeholder="วาง URL รูปสลิป หรือ link เอกสาร"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (paymentAttachmentUrl.trim()) {
                      setPaymentAttachments([...paymentAttachments, paymentAttachmentUrl.trim()]);
                      setPaymentAttachmentUrl('');
                    }
                  }}
                  className="px-3 py-2 bg-gray-200 rounded-lg text-sm hover:bg-gray-300 whitespace-nowrap"
                >
                  + เพิ่ม
                </button>
              </div>
              {paymentAttachments.length > 0 && (
                <div className="mt-2 space-y-1">
                  {paymentAttachments.map((url, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-xs bg-blue-50 rounded px-2 py-1">
                      <a href={url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate flex-1">{url}</a>
                      <button type="button" onClick={() => setPaymentAttachments(paymentAttachments.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-600">&times;</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t">
              <button type="button" onClick={() => setIsPaymentModalOpen(false)} className="px-4 py-2 text-sm text-gray-600">
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={paymentMutation.isPending}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50 transition-colors"
              >
                {paymentMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </div>
          </form>
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
