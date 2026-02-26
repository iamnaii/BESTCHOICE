import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import Modal from '@/components/ui/Modal';
import { useAuth } from '@/contexts/AuthContext';

interface Price {
  id: string;
  label: string;
  amount: string;
  isDefault: boolean;
}

interface Product {
  id: string;
  name: string;
  brand: string;
  model: string;
  color: string | null;
  storage: string | null;
  imeiSerial: string | null;
  serialNumber: string | null;
  category: string;
  costPrice: string;
  status: string;
  conditionGrade: string | null;
  photos: string[];
  createdAt: string;
  branch: { id: string; name: string };
  supplier: { id: string; name: string } | null;
  po: { id: string; poNumber: string } | null;
  inspection: { id: string; overallGrade: string | null; isCompleted: boolean } | null;
  prices: Price[];
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

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isManager = user?.role === 'OWNER' || user?.role === 'BRANCH_MANAGER';

  // Price modal state
  const [isPriceModalOpen, setIsPriceModalOpen] = useState(false);
  const [editingPrice, setEditingPrice] = useState<Price | null>(null);
  const [priceForm, setPriceForm] = useState({ label: '', amount: '', isDefault: false });

  // Transfer modal state
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferForm, setTransferForm] = useState({ toBranchId: '', notes: '' });

  const { data: product, isLoading } = useQuery<Product>({
    queryKey: ['product', id],
    queryFn: async () => {
      const { data } = await api.get(`/products/${id}`);
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

  // Price mutations
  const priceMutation = useMutation({
    mutationFn: async (data: { label: string; amount: number; isDefault: boolean }) => {
      if (editingPrice) {
        return api.patch(`/products/${id}/prices/${editingPrice.id}`, data);
      }
      return api.post(`/products/${id}/prices`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product', id] });
      toast.success(editingPrice ? 'แก้ไขราคาสำเร็จ' : 'เพิ่มราคาสำเร็จ');
      setIsPriceModalOpen(false);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const deletePriceMutation = useMutation({
    mutationFn: async (priceId: string) => {
      return api.delete(`/products/${id}/prices/${priceId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product', id] });
      toast.success('ลบราคาสำเร็จ');
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      toast.error(err.response?.data?.message || 'เกิดข้อผิดพลาด');
    },
  });

  // Transfer mutation
  const transferMutation = useMutation({
    mutationFn: async () => {
      return api.post(`/products/${id}/transfer`, {
        toBranchId: transferForm.toBranchId,
        notes: transferForm.notes || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product', id] });
      toast.success('โอนสินค้าสำเร็จ');
      setIsTransferModalOpen(false);
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      toast.error(err.response?.data?.message || 'เกิดข้อผิดพลาด');
    },
  });

  const openAddPrice = () => {
    setEditingPrice(null);
    setPriceForm({ label: '', amount: '', isDefault: false });
    setIsPriceModalOpen(true);
  };

  const openEditPrice = (price: Price) => {
    setEditingPrice(price);
    setPriceForm({ label: price.label, amount: price.amount, isDefault: price.isDefault });
    setIsPriceModalOpen(true);
  };

  const handlePriceSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    priceMutation.mutate({
      label: priceForm.label,
      amount: parseFloat(priceForm.amount),
      isDefault: priceForm.isDefault,
    });
  };

  const handleTransferSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    transferMutation.mutate();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!product) {
    return <div className="text-center py-12 text-gray-500">ไม่พบสินค้า</div>;
  }

  const s = statusLabels[product.status] || { label: product.status, className: 'bg-gray-100 text-gray-700' };
  const { defaultPrice, profit } = useMemo(() => {
    const dp = product.prices.find((p) => p.isDefault);
    return {
      defaultPrice: dp,
      profit: dp ? parseFloat(dp.amount) - parseFloat(product.costPrice) : null,
    };
  }, [product.prices, product.costPrice]);

  return (
    <div>
      <PageHeader
        title={`${product.brand} ${product.model}`}
        subtitle={product.name}
        action={
          <div className="flex gap-2">
            {isManager && product.status === 'IN_STOCK' && (
              <button
                onClick={() => {
                  setTransferForm({ toBranchId: '', notes: '' });
                  setIsTransferModalOpen(true);
                }}
                className="px-4 py-2 text-sm text-primary-600 border border-primary-300 rounded-lg hover:bg-primary-50"
              >
                โอนสาขา
              </button>
            )}
            <button
              onClick={() => navigate('/products')}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-300 rounded-lg"
            >
              กลับ
            </button>
          </div>
        }
      />

      {/* Product Photos */}
      {product.photos && product.photos.length > 0 && (
        <div className="bg-white rounded-lg border p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">รูปถ่ายสินค้า</h2>
          <div className="flex flex-wrap gap-3">
            {product.photos.map((photo, i) => (
              <div key={i} className="w-28 h-28 rounded-lg overflow-hidden border">
                <img src={photo} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Product Info */}
      <div className="bg-white rounded-lg border p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">ข้อมูลสินค้า</h2>
          <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${s.className}`}>{s.label}</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <InfoField label="ยี่ห้อ" value={product.brand} />
          <InfoField label="รุ่น" value={product.model} />
          <InfoField label="สี" value={product.color} />
          <InfoField label="ความจุ" value={product.storage} />
          <InfoField label="IMEI" value={product.imeiSerial} mono />
          <InfoField label="Serial Number" value={product.serialNumber} mono />
          <InfoField label="ประเภท" value={categoryLabels[product.category] || product.category} />
          <InfoField label="เกรดสภาพ" value={product.conditionGrade} />
          <InfoField label="สาขา" value={product.branch.name} />
          <InfoField label="Supplier" value={product.supplier?.name} />
          <InfoField label="PO" value={product.po?.poNumber} mono />
          <InfoField label="วันที่เพิ่ม" value={new Date(product.createdAt).toLocaleDateString('th-TH')} />
        </div>
      </div>

      {/* Price Summary */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-lg border p-4">
          <div className="text-xs text-gray-500 mb-1">ราคาทุน</div>
          <div className="text-lg font-semibold text-gray-900">{parseFloat(product.costPrice).toLocaleString()} ฿</div>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <div className="text-xs text-gray-500 mb-1">ราคาขาย (default)</div>
          <div className="text-lg font-semibold text-primary-700">
            {defaultPrice ? `${parseFloat(defaultPrice.amount).toLocaleString()} ฿` : '-'}
          </div>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <div className="text-xs text-gray-500 mb-1">กำไร</div>
          <div className={`text-lg font-semibold ${profit && profit > 0 ? 'text-green-600' : 'text-red-600'}`}>
            {profit !== null ? `${profit.toLocaleString()} ฿` : '-'}
          </div>
        </div>
      </div>

      {/* Prices Table */}
      <div className="bg-white rounded-lg border p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">ราคาขาย ({product.prices.length})</h2>
          {isManager && (
            <button onClick={openAddPrice} className="text-sm text-primary-600 hover:text-primary-700 font-medium">
              + เพิ่มราคา
            </button>
          )}
        </div>
        <div className="space-y-2">
          {product.prices.map((price) => (
            <div key={price.id} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-50">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-gray-900">{price.label}</span>
                {price.isDefault && (
                  <span className="px-1.5 py-0.5 bg-primary-100 text-primary-700 text-xs rounded font-medium">
                    ค่าเริ่มต้น
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4">
                <span className="text-sm font-semibold">{parseFloat(price.amount).toLocaleString()} ฿</span>
                {isManager && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => openEditPrice(price)}
                      className="text-xs text-primary-600 hover:text-primary-700"
                    >
                      แก้ไข
                    </button>
                    <button
                      onClick={() => {
                        if (confirm('ต้องการลบราคานี้?')) deletePriceMutation.mutate(price.id);
                      }}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      ลบ
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {product.prices.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4">ยังไม่มีราคาขาย</p>
          )}
        </div>
      </div>

      {/* Inspection Result (if applicable) */}
      {product.inspection && (
        <div className="bg-white rounded-lg border p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">ผลตรวจเช็ค</h2>
          <div className="flex items-center gap-4">
            <span className={`px-2.5 py-1 rounded-full text-sm font-medium ${
              product.inspection.isCompleted ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
            }`}>
              {product.inspection.isCompleted ? 'ตรวจเสร็จ' : 'กำลังตรวจ'}
            </span>
            {product.inspection.overallGrade && (
              <span className="text-sm">เกรด: <strong>{product.inspection.overallGrade}</strong></span>
            )}
          </div>
        </div>
      )}

      {/* Price Add/Edit Modal */}
      <Modal
        isOpen={isPriceModalOpen}
        onClose={() => setIsPriceModalOpen(false)}
        title={editingPrice ? 'แก้ไขราคาขาย' : 'เพิ่มราคาขาย'}
      >
        <form onSubmit={handlePriceSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ชื่อราคา *</label>
            <input
              type="text"
              value={priceForm.label}
              onChange={(e) => setPriceForm({ ...priceForm, label: e.target.value })}
              placeholder='เช่น "ราคาเงินสด", "ราคาผ่อน"'
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">จำนวนเงิน (บาท) *</label>
            <input
              type="number"
              step="0.01"
              value={priceForm.amount}
              onChange={(e) => setPriceForm({ ...priceForm, amount: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              required
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={priceForm.isDefault}
              onChange={(e) => setPriceForm({ ...priceForm, isDefault: e.target.checked })}
              className="rounded text-primary-600"
            />
            ตั้งเป็นราคาค่าเริ่มต้น
          </label>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setIsPriceModalOpen(false)} className="px-4 py-2 text-sm text-gray-600">
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

      {/* Transfer Modal */}
      <Modal
        isOpen={isTransferModalOpen}
        onClose={() => setIsTransferModalOpen(false)}
        title="โอนสินค้าระหว่างสาขา"
      >
        <form onSubmit={handleTransferSubmit} className="space-y-4">
          <div className="bg-gray-50 rounded-lg p-3 text-sm">
            <div className="text-gray-500">สาขาต้นทาง</div>
            <div className="font-medium">{product.branch.name}</div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">สาขาปลายทาง *</label>
            <select
              value={transferForm.toBranchId}
              onChange={(e) => setTransferForm({ ...transferForm, toBranchId: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              required
            >
              <option value="">เลือกสาขา</option>
              {branches
                .filter((b) => b.id !== product.branch.id)
                .map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">หมายเหตุ</label>
            <textarea
              value={transferForm.notes}
              onChange={(e) => setTransferForm({ ...transferForm, notes: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none resize-none"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setIsTransferModalOpen(false)} className="px-4 py-2 text-sm text-gray-600">
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={transferMutation.isPending}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
            >
              {transferMutation.isPending ? 'กำลังโอน...' : 'โอนสินค้า'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function InfoField({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs text-gray-500 mb-0.5">{label}</div>
      <div className={`text-sm text-gray-900 ${mono ? 'font-mono' : ''}`}>{value || '-'}</div>
    </div>
  );
}
