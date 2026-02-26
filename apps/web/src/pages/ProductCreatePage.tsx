import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import { brands, getModels, getModelInfo } from '@/data/productCatalog';

interface PriceRow {
  label: string;
  amount: string;
  isDefault: boolean;
}

const categoryOptions = [
  { value: 'PHONE_NEW', label: 'มือถือใหม่' },
  { value: 'PHONE_USED', label: 'มือถือมือสอง' },
  { value: 'TABLET', label: 'แท็บเล็ต' },
  { value: 'ACCESSORY', label: 'อุปกรณ์เสริม' },
];

const statusOptions = [
  { value: 'IN_STOCK', label: 'พร้อมขาย' },
  { value: 'PO_RECEIVED', label: 'รับจาก PO' },
  { value: 'INSPECTION', label: 'กำลังตรวจ' },
];

const gradeOptions = [
  { value: '', label: 'ไม่ระบุ' },
  { value: 'A', label: 'A' },
  { value: 'B', label: 'B' },
  { value: 'C', label: 'C' },
  { value: 'D', label: 'D' },
];

export default function ProductCreatePage() {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: '',
    brand: '',
    model: '',
    color: '',
    storage: '',
    imeiSerial: '',
    serialNumber: '',
    category: 'PHONE_NEW',
    costPrice: '',
    supplierId: '',
    branchId: '',
    status: 'IN_STOCK',
    conditionGrade: '',
  });

  const [prices, setPrices] = useState<PriceRow[]>([
    { label: 'ราคาผ่อน', amount: '', isDefault: true },
  ]);

  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);

  const { data: branchList = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => {
      const { data } = await api.get('/branches');
      return data;
    },
  });

  const { data: supplierResult } = useQuery<{ data: { id: string; name: string }[] }>({
    queryKey: ['suppliers-active'],
    queryFn: async () => {
      const { data } = await api.get('/suppliers', { params: { isActive: 'true' } });
      return data;
    },
  });
  const suppliers = supplierResult?.data ?? [];

  // Derived dropdown options
  const availableModels = useMemo(
    () => getModels(form.brand, form.category),
    [form.brand, form.category],
  );

  const modelInfo = useMemo(
    () => (form.brand && form.model ? getModelInfo(form.brand, form.model) : undefined),
    [form.brand, form.model],
  );

  const availableColors = modelInfo?.colors ?? [];
  const availableStorage = modelInfo?.storage ?? [];

  const createMutation = useMutation({
    mutationFn: async () => {
      const autoName = [form.brand, form.model, form.color, form.storage].filter(Boolean).join(' ');
      const payload = {
        name: form.name || autoName,
        brand: form.brand,
        model: form.model,
        color: form.color || undefined,
        storage: form.storage || undefined,
        imeiSerial: form.imeiSerial || undefined,
        serialNumber: form.serialNumber || undefined,
        category: form.category,
        costPrice: parseFloat(form.costPrice),
        supplierId: form.supplierId || undefined,
        branchId: form.branchId,
        status: form.status,
        conditionGrade: form.conditionGrade || undefined,
        photos: photoPreviews.length > 0 ? photoPreviews : undefined,
        prices: prices
          .filter((p) => p.label && p.amount)
          .map((p) => ({
            label: p.label,
            amount: parseFloat(p.amount),
            isDefault: p.isDefault,
          })),
      };
      return api.post('/products', payload);
    },
    onSuccess: (res) => {
      toast.success('เพิ่มสินค้าสำเร็จ');
      navigate(`/products/${res.data.id}`);
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err));
    },
  });

  const addPriceRow = () => {
    setPrices([...prices, { label: '', amount: '', isDefault: false }]);
  };

  const removePriceRow = (index: number) => {
    if (prices.length <= 1) return;
    const newPrices = prices.filter((_, i) => i !== index);
    if (prices[index].isDefault && newPrices.length > 0) {
      newPrices[0].isDefault = true;
    }
    setPrices(newPrices);
  };

  const updatePrice = (index: number, field: keyof PriceRow, value: string | boolean) => {
    const newPrices = [...prices];
    if (field === 'isDefault' && value === true) {
      newPrices.forEach((p) => (p.isDefault = false));
    }
    (newPrices[index] as unknown as Record<string, unknown>)[field] = value;
    setPrices(newPrices);
  };

  const handlePhotoAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const newFiles = [...photoFiles, ...files];
    setPhotoFiles(newFiles);
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        setPhotoPreviews((prev) => [...prev, reader.result as string]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const removePhoto = (index: number) => {
    setPhotoFiles((prev) => prev.filter((_, i) => i !== index));
    setPhotoPreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const handleBrandChange = (newBrand: string) => {
    setForm({ ...form, brand: newBrand, model: '', color: '', storage: '' });
  };

  const handleModelChange = (newModel: string) => {
    const info = form.brand ? getModelInfo(form.brand, newModel) : undefined;
    setForm({
      ...form,
      model: newModel,
      color: '',
      storage: '',
      category: info?.category === 'TABLET' ? 'TABLET' : form.category,
    });
  };

  const handleCategoryChange = (newCategory: string) => {
    setForm({ ...form, category: newCategory, model: '', color: '', storage: '' });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.brand) { toast.error('กรุณาเลือกยี่ห้อ'); return; }
    if (!form.model) { toast.error('กรุณาเลือกรุ่น'); return; }
    if (!form.branchId) { toast.error('กรุณาเลือกสาขา'); return; }
    if (!form.costPrice) { toast.error('กรุณาระบุราคาทุน'); return; }
    if (prices.filter((p) => p.label && p.amount).length === 0) {
      toast.error('กรุณาเพิ่มอย่างน้อย 1 ราคาขาย'); return;
    }
    createMutation.mutate();
  };

  const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none';

  return (
    <div>
      <PageHeader
        title="เพิ่มสินค้าใหม่"
        action={
          <button onClick={() => navigate('/products')} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-300 rounded-lg">
            กลับ
          </button>
        }
      />

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Product Info */}
        <div className="bg-white rounded-lg border p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">ข้อมูลสินค้า</h2>
          <div className="grid grid-cols-2 gap-4">
            {/* ยี่ห้อ */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ยี่ห้อ *</label>
              <select value={form.brand} onChange={(e) => handleBrandChange(e.target.value)} className={inputCls} required>
                <option value="">เลือกยี่ห้อ</option>
                {brands.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>

            {/* ประเภท */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ประเภท *</label>
              <select value={form.category} onChange={(e) => handleCategoryChange(e.target.value)} className={inputCls}>
                {categoryOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>

            {/* รุ่น */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">รุ่น *</label>
              <select value={form.model} onChange={(e) => handleModelChange(e.target.value)} className={inputCls} required disabled={!form.brand}>
                <option value="">เลือกรุ่น</option>
                {availableModels.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
              </select>
              {form.brand && availableModels.length === 0 && (
                <p className="text-xs text-gray-400 mt-1">ไม่พบรุ่นสำหรับประเภทนี้</p>
              )}
            </div>

            {/* สี */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">สี</label>
              <select value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className={inputCls} disabled={!form.model}>
                <option value="">เลือกสี</option>
                {availableColors.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            {/* ความจุ */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ความจุ</label>
              <select value={form.storage} onChange={(e) => setForm({ ...form, storage: e.target.value })} className={inputCls} disabled={!form.model}>
                <option value="">เลือกความจุ</option>
                {availableStorage.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {/* ชื่อสินค้า */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ชื่อสินค้า</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="อัตโนมัติจาก ยี่ห้อ + รุ่น + สี + ความจุ"
                className={inputCls}
              />
            </div>

            {/* IMEI */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">IMEI</label>
              <input
                type="text"
                value={form.imeiSerial}
                onChange={(e) => setForm({ ...form, imeiSerial: e.target.value })}
                placeholder="เลข IMEI 15 หลัก"
                className={`${inputCls} font-mono`}
                maxLength={15}
              />
            </div>

            {/* Serial Number */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Serial Number</label>
              <input
                type="text"
                value={form.serialNumber}
                onChange={(e) => setForm({ ...form, serialNumber: e.target.value })}
                placeholder="หมายเลข Serial"
                className={`${inputCls} font-mono`}
              />
            </div>

            {/* สถานะ */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">สถานะ *</label>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className={inputCls}>
                {statusOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>

            {/* เกรดสภาพ */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">เกรดสภาพ</label>
              <select value={form.conditionGrade} onChange={(e) => setForm({ ...form, conditionGrade: e.target.value })} className={inputCls}>
                {gradeOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Photos */}
        <div className="bg-white rounded-lg border p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">รูปถ่ายสินค้า</h2>
          <div className="flex flex-wrap gap-3 mb-3">
            {photoPreviews.map((preview, index) => (
              <div key={index} className="relative w-24 h-24 rounded-lg overflow-hidden border">
                <img src={preview} alt={`Photo ${index + 1}`} className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => removePhoto(index)}
                  className="absolute top-0.5 right-0.5 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600"
                >
                  &times;
                </button>
              </div>
            ))}
            <label className="w-24 h-24 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-primary-400 hover:bg-primary-50 transition-colors">
              <span className="text-2xl text-gray-400">+</span>
              <span className="text-xs text-gray-400">เพิ่มรูป</span>
              <input type="file" accept="image/*" multiple onChange={handlePhotoAdd} className="hidden" />
            </label>
          </div>
          <p className="text-xs text-gray-400">รองรับ JPG, PNG สูงสุด 10 รูป</p>
        </div>

        {/* Branch & Supplier */}
        <div className="bg-white rounded-lg border p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">สาขา & Supplier</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">สาขา *</label>
              <select value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })} className={inputCls} required>
                <option value="">เลือกสาขา</option>
                {branchList.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
              <select value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })} className={inputCls}>
                <option value="">ไม่ระบุ</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ราคาทุน (บาท) *</label>
              <input
                type="number"
                step="0.01"
                value={form.costPrice}
                onChange={(e) => setForm({ ...form, costPrice: e.target.value })}
                className={inputCls}
                required
              />
            </div>
          </div>
        </div>

        {/* Multi-Price */}
        <div className="bg-white rounded-lg border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">ราคาขาย</h2>
            <button type="button" onClick={addPriceRow} className="text-sm text-primary-600 hover:text-primary-700 font-medium">
              + เพิ่มราคา
            </button>
          </div>
          <div className="space-y-3">
            {prices.map((price, index) => (
              <div key={index} className="flex items-center gap-3">
                <input
                  type="text"
                  placeholder="ชื่อราคา เช่น ราคาผ่อน"
                  value={price.label}
                  onChange={(e) => updatePrice(index, 'label', e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm"
                />
                <input
                  type="number"
                  step="0.01"
                  placeholder="จำนวนเงิน"
                  value={price.amount}
                  onChange={(e) => updatePrice(index, 'amount', e.target.value)}
                  className="w-40 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none text-sm"
                />
                <label className="flex items-center gap-1.5 text-sm text-gray-600 whitespace-nowrap cursor-pointer">
                  <input type="radio" name="defaultPrice" checked={price.isDefault} onChange={() => updatePrice(index, 'isDefault', true)} className="text-primary-600" />
                  ค่าเริ่มต้น
                </label>
                {prices.length > 1 && (
                  <button type="button" onClick={() => removePriceRow(index)} className="text-red-400 hover:text-red-600 text-lg">
                    &times;
                  </button>
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-3">
            ราคา "ค่าเริ่มต้น" จะถูกใช้ตอนสร้างสัญญาผ่อน (พนักงานสามารถเปลี่ยนได้)
          </p>
        </div>

        {/* Submit */}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={() => navigate('/products')} className="px-6 py-2.5 text-sm text-gray-600 hover:text-gray-800 border border-gray-300 rounded-lg">
            ยกเลิก
          </button>
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="px-6 py-2.5 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
          >
            {createMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกสินค้า'}
          </button>
        </div>
      </form>
    </div>
  );
}
