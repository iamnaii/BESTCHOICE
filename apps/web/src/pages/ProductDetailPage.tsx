import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import Modal from '@/components/ui/Modal';
import ProductPhotosPanel from '@/components/product/ProductPhotosPanel';
import { useAuth } from '@/contexts/AuthContext';
import { statusLabels, categoryLabels, categoryOptions, transferableStatuses } from '@/lib/constants';

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
  batteryHealth: number | null;
  warrantyExpired: boolean | null;
  warrantyExpireDate: string | null;
  hasBox: boolean | null;
  accessoryType: string | null;
  accessoryBrand: string | null;
  photos: string[];
  createdAt: string;
  branch: { id: string; name: string };
  supplier: { id: string; name: string } | null;
  po: { id: string; poNumber: string } | null;
  inspection: { id: string; overallGrade: string | null; isCompleted: boolean } | null;
  prices: Price[];
}

type Tab = 'info' | 'photos';

interface EditForm {
  name: string;
  brand: string;
  model: string;
  color: string;
  storage: string;
  imeiSerial: string;
  serialNumber: string;
  category: string;
  costPrice: string;
  status: string;
  batteryHealth: string;
  warrantyExpired: boolean;
  warrantyExpireDate: string;
  hasBox: boolean;
  accessoryType: string;
  accessoryBrand: string;
}

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isManager = user?.role === 'OWNER' || user?.role === 'BRANCH_MANAGER';

  const [activeTab, setActiveTab] = useState<Tab>('info');

  // Price modal state
  const [isPriceModalOpen, setIsPriceModalOpen] = useState(false);
  const [editingPrice, setEditingPrice] = useState<Price | null>(null);
  const [priceForm, setPriceForm] = useState({ label: '', amount: '', isDefault: false });

  // Edit product modal state
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editForm, setEditForm] = useState<EditForm>({
    name: '', brand: '', model: '', color: '', storage: '',
    imeiSerial: '', serialNumber: '', category: '', costPrice: '',
    status: '', batteryHealth: '', warrantyExpired: false,
    warrantyExpireDate: '', hasBox: false, accessoryType: '', accessoryBrand: '',
  });

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

  // Compute default price and profit (must be before early returns to satisfy Rules of Hooks)
  const { defaultPrice, profit } = useMemo(() => {
    if (!product) return { defaultPrice: undefined, profit: null };
    const dp = product.prices.find((p) => p.isDefault);
    return {
      defaultPrice: dp,
      profit: dp ? parseFloat(dp.amount) - parseFloat(product.costPrice) : null,
    };
  }, [product]);

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
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['products-available'] });
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
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['products-available'] });
      toast.success('ลบราคาสำเร็จ');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
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
      toast.success('สร้างรายการโอนสำเร็จ (รอสาขาปลายทางยืนยัน)');
      setIsTransferModalOpen(false);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  // Edit product mutation
  const editMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      return api.patch(`/products/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product', id] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['products-available'] });
      toast.success('แก้ไขข้อมูลสินค้าสำเร็จ');
      setIsEditModalOpen(false);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const openEditProduct = () => {
    if (!product) return;
    setEditForm({
      name: product.name,
      brand: product.brand,
      model: product.model,
      color: product.color || '',
      storage: product.storage || '',
      imeiSerial: product.imeiSerial || '',
      serialNumber: product.serialNumber || '',
      category: product.category,
      costPrice: product.costPrice,
      status: product.status,
      batteryHealth: product.batteryHealth != null ? String(product.batteryHealth) : '',
      warrantyExpired: product.warrantyExpired ?? false,
      warrantyExpireDate: product.warrantyExpireDate ? product.warrantyExpireDate.split('T')[0] : '',
      hasBox: product.hasBox ?? false,
      accessoryType: product.accessoryType || '',
      accessoryBrand: product.accessoryBrand || '',
    });
    setIsEditModalOpen(true);
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: Record<string, unknown> = {
      name: editForm.name,
      brand: editForm.brand,
      model: editForm.model,
      color: editForm.color || undefined,
      storage: editForm.storage || undefined,
      imeiSerial: editForm.imeiSerial || undefined,
      serialNumber: editForm.serialNumber || undefined,
      category: editForm.category,
      costPrice: parseFloat(editForm.costPrice) || 0,
      status: editForm.status,
    };
    if (editForm.category === 'PHONE_USED') {
      payload.batteryHealth = editForm.batteryHealth ? Number(editForm.batteryHealth) : undefined;
      payload.warrantyExpired = editForm.warrantyExpired;
      payload.warrantyExpireDate = !editForm.warrantyExpired && editForm.warrantyExpireDate ? editForm.warrantyExpireDate : undefined;
      payload.hasBox = editForm.hasBox;
    }
    if (editForm.category === 'ACCESSORY') {
      payload.accessoryType = editForm.accessoryType || undefined;
      payload.accessoryBrand = editForm.accessoryBrand || undefined;
    }
    editMutation.mutate(payload);
  };

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

  return (
    <div>
      <PageHeader
        title={`${product.brand} ${product.model}`}
        subtitle={product.name}
        action={
          <div className="flex gap-2">
            {isManager && (
              <button
                onClick={openEditProduct}
                className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700"
              >
                แก้ไขข้อมูล
              </button>
            )}
            {isManager && transferableStatuses.includes(product.status) && (
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

      {/* Tabs */}
      {product.category === 'PHONE_USED' && (
        <div className="flex gap-1 mb-4 border-b">
          {([
            { key: 'info' as Tab, label: 'ข้อมูลสินค้า' },
            { key: 'photos' as Tab, label: 'รูปถ่าย' },
          ]).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-primary-600 text-primary-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* Tab: Photos */}
      {activeTab === 'photos' && product.category === 'PHONE_USED' && (
        <div>
          <ProductPhotosPanel
            productId={product.id}
            canEdit={isManager || user?.role === 'SALES'}
          />

          {/* Legacy Photos (from goods receiving) */}
          {product.photos && product.photos.length > 0 && (
            <div className="bg-white rounded-lg border p-4 mb-4">
              <h2 className="text-sm font-semibold text-gray-900 mb-2">รูปถ่ายจากการตรวจรับ</h2>
              <div className="flex flex-wrap gap-2">
                {product.photos.map((photo, i) => (
                  <div key={i} className="w-20 h-20 rounded overflow-hidden border">
                    <img src={photo} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab: Info (or always show for non-PHONE_USED) */}
      {(activeTab === 'info' || product.category !== 'PHONE_USED') && (
      <>
      {/* Product Info */}
      <div className="bg-white rounded-lg border p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">ข้อมูลสินค้า</h2>
          <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${s.className}`}>{s.label}</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {product.category === 'ACCESSORY' ? (
            <>
              <InfoField label="ประเภทอุปกรณ์" value={product.accessoryType} />
              {product.accessoryType === 'ชุดชาร์จ' ? (
                <InfoField label="ชนิด" value={product.model} />
              ) : (
                <>
                  <InfoField label="สำหรับยี่ห้อ" value={product.brand} />
                  <InfoField label="สำหรับรุ่น" value={product.model} />
                </>
              )}
              <InfoField label="ยี่ห้ออุปกรณ์" value={product.accessoryBrand} />
            </>
          ) : (
            <>
              <InfoField label="ยี่ห้อ" value={product.brand} />
              <InfoField label="รุ่น" value={product.model} />
              <InfoField label="สี" value={product.color} />
              <InfoField label="ความจุ" value={product.storage} />
              <InfoField label="IMEI" value={product.imeiSerial} mono />
              <InfoField label="Serial Number" value={product.serialNumber} mono />
            </>
          )}
          <InfoField label="ประเภท" value={categoryLabels[product.category] || product.category} />
          {product.category === 'PHONE_USED' && (
            <>
              <InfoField label="แบตเตอรี่" value={product.batteryHealth != null ? `${product.batteryHealth}%` : null} />
              <InfoField label="ประกันศูนย์" value={product.warrantyExpired ? 'หมดประกันแล้ว' : product.warrantyExpireDate ? `ถึง ${new Date(product.warrantyExpireDate).toLocaleDateString('th-TH')}` : null} />
              <InfoField label="กล่อง" value={product.hasBox != null ? (product.hasBox ? 'มีกล่อง' : 'ไม่มีกล่อง') : null} />
            </>
          )}
          <InfoField label="สาขา" value={product.branch.name} />
          <InfoField label="ผู้ขาย" value={product.supplier?.name} />
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
          <div className={`text-lg font-semibold ${profit === null ? 'text-gray-400' : profit > 0 ? 'text-green-600' : profit === 0 ? 'text-gray-600' : 'text-red-600'}`}>
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
      </>
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

      {/* Edit Product Modal */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        title="แก้ไขข้อมูลสินค้า"
      >
        <form onSubmit={handleEditSubmit} className="space-y-4 max-h-[70vh] overflow-y-auto">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">ชื่อสินค้า</label>
            <input type="text" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" required />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">ประเภท</label>
              <select value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                {categoryOptions.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">สถานะ</label>
              <select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                {Object.entries(statusLabels).map(([val, s]) => <option key={val} value={val}>{s.label}</option>)}
              </select>
            </div>
          </div>

          {editForm.category !== 'ACCESSORY' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">ยี่ห้อ</label>
                <input type="text" value={editForm.brand} onChange={(e) => setEditForm({ ...editForm, brand: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" required />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">รุ่น</label>
                <input type="text" value={editForm.model} onChange={(e) => setEditForm({ ...editForm, model: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" required />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">สี</label>
                <input type="text" value={editForm.color} onChange={(e) => setEditForm({ ...editForm, color: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">ความจุ</label>
                <input type="text" value={editForm.storage} onChange={(e) => setEditForm({ ...editForm, storage: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
            </div>
          )}

          {editForm.category === 'ACCESSORY' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">ประเภทอุปกรณ์</label>
                <input type="text" value={editForm.accessoryType} onChange={(e) => setEditForm({ ...editForm, accessoryType: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">ยี่ห้ออุปกรณ์</label>
                <input type="text" value={editForm.accessoryBrand} onChange={(e) => setEditForm({ ...editForm, accessoryBrand: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">IMEI / Serial</label>
              <input type="text" value={editForm.imeiSerial} onChange={(e) => setEditForm({ ...editForm, imeiSerial: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Serial Number</label>
              <input type="text" value={editForm.serialNumber} onChange={(e) => setEditForm({ ...editForm, serialNumber: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">ราคาทุน (บาท)</label>
            <input type="number" step="0.01" value={editForm.costPrice} onChange={(e) => setEditForm({ ...editForm, costPrice: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" required />
          </div>

          {editForm.category === 'PHONE_USED' && (
            <div className="border-t pt-3 space-y-3">
              <div className="text-xs font-semibold text-gray-500">ข้อมูลมือสอง</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">แบตเตอรี่ (%)</label>
                  <input type="number" min="0" max="100" value={editForm.batteryHealth} onChange={(e) => setEditForm({ ...editForm, batteryHealth: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">วันหมดประกัน</label>
                  <input type="date" value={editForm.warrantyExpireDate} onChange={(e) => setEditForm({ ...editForm, warrantyExpireDate: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" disabled={editForm.warrantyExpired} />
                </div>
              </div>
              <div className="flex gap-6">
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={editForm.warrantyExpired} onChange={(e) => setEditForm({ ...editForm, warrantyExpired: e.target.checked })} className="rounded text-primary-600" />
                  หมดประกันแล้ว
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={editForm.hasBox} onChange={(e) => setEditForm({ ...editForm, hasBox: e.target.checked })} className="rounded text-primary-600" />
                  มีกล่อง
                </label>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2 border-t">
            <button type="button" onClick={() => setIsEditModalOpen(false)} className="px-4 py-2 text-sm text-gray-600">
              ยกเลิก
            </button>
            <button type="submit" disabled={editMutation.isPending} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
              {editMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
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
