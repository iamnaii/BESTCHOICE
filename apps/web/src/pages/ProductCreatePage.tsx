import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import { brands, getModels, getModelInfo } from '@/data/productCatalog';
import { categoryOptions, createProductStatusOptions, gradeOptions } from '@/lib/constants';

interface PriceRow {
  label: string;
  amount: string;
  isDefault: boolean;
}

const accessoryTypes = [
  { value: 'ฟิล์ม', label: 'ฟิล์ม' },
  { value: 'ชุดชาร์จ', label: 'ชุดชาร์จ' },
  { value: 'หูฟัง', label: 'หูฟัง' },
  { value: 'เคส', label: 'เคส' },
  { value: 'อื่นๆ', label: 'อื่นๆ' },
];

const chargerConnectorTypes = [
  { value: 'Lightning', label: 'Lightning' },
  { value: 'Type-C', label: 'Type-C' },
];

const statusOptions = createProductStatusOptions;

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
    batteryHealth: '',
    warrantyExpired: false,
    warrantyExpireDate: '',
    hasBox: true,
    accessoryType: '',
    accessoryBrand: '',
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

  const { data: supplierResult, isLoading: suppliersLoading, isError: suppliersError } = useQuery<{ data: { id: string; name: string }[] }>({
    queryKey: ['suppliers-active'],
    queryFn: async () => {
      const { data } = await api.get('/suppliers', { params: { isActive: 'true' } });
      return data;
    },
    retry: 2,
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
      const isAccessory = form.category === 'ACCESSORY';
      const isCharger = isAccessory && form.accessoryType === 'ชุดชาร์จ';
      const autoName = isAccessory
        ? (isCharger
            ? [form.accessoryType, form.accessoryBrand, form.model].filter(Boolean).join(' ')
            : (() => {
                const accParts = [form.accessoryType, form.accessoryBrand].filter(Boolean);
                return form.model
                  ? `${accParts.join(' ')} สำหรับ ${form.model}`
                  : accParts.join(' ');
              })())
        : [form.brand, form.model, form.color, form.storage].filter(Boolean).join(' ');
      const payload = {
        name: form.name || autoName,
        brand: form.brand,
        model: form.model,
        color: isAccessory ? undefined : (form.color || undefined),
        storage: isAccessory ? undefined : (form.storage || undefined),
        imeiSerial: form.imeiSerial || undefined,
        serialNumber: form.serialNumber || undefined,
        category: form.category,
        costPrice: parseFloat(form.costPrice),
        supplierId: form.supplierId || undefined,
        branchId: form.branchId,
        status: form.status,
        conditionGrade: form.conditionGrade || undefined,
        ...(form.category === 'PHONE_USED' ? {
          batteryHealth: form.batteryHealth ? Number(form.batteryHealth) : undefined,
          warrantyExpired: form.warrantyExpired,
          warrantyExpireDate: !form.warrantyExpired && form.warrantyExpireDate ? form.warrantyExpireDate : undefined,
          hasBox: form.hasBox,
        } : {}),
        ...(isAccessory ? {
          accessoryType: form.accessoryType || undefined,
          accessoryBrand: form.accessoryBrand || undefined,
        } : {}),
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

  const MAX_PHOTOS = 10;
  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB per file

  const handlePhotoAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    // Enforce max photo count
    const remaining = MAX_PHOTOS - photoFiles.length;
    if (remaining <= 0) {
      toast.error(`เพิ่มรูปได้สูงสุด ${MAX_PHOTOS} รูป`);
      e.target.value = '';
      return;
    }
    const allowedFiles = files.slice(0, remaining);
    if (files.length > remaining) {
      toast.error(`เลือกได้อีก ${remaining} รูป (สูงสุด ${MAX_PHOTOS} รูป)`);
    }

    // Enforce file size limit
    const validFiles = allowedFiles.filter((file) => {
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`ไฟล์ ${file.name} ใหญ่เกิน 5MB`);
        return false;
      }
      return true;
    });

    if (validFiles.length === 0) {
      e.target.value = '';
      return;
    }

    setPhotoFiles((prev) => [...prev, ...validFiles]);
    validFiles.forEach((file) => {
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
    setForm({ ...form, category: newCategory, brand: '', model: '', color: '', storage: '', accessoryType: '', accessoryBrand: '' });
  };

  const handleAccessoryTypeChange = (newType: string) => {
    setForm({ ...form, accessoryType: newType, brand: '', model: '', accessoryBrand: '' });
  };

  // Toggle model for multi-select (accessories)
  const toggleModel = (modelName: string) => {
    const current = form.model ? form.model.split(', ').filter(Boolean) : [];
    const newModels = current.includes(modelName)
      ? current.filter((m) => m !== modelName)
      : [...current, modelName];
    setForm({ ...form, model: newModels.join(', ') });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const isAccessory = form.category === 'ACCESSORY';
    const isCharger = isAccessory && form.accessoryType === 'ชุดชาร์จ';
    if (!isAccessory && !form.brand) { toast.error('กรุณาเลือกยี่ห้อ'); return; }
    if (!isCharger && !isAccessory && !form.model) { toast.error('กรุณาเลือกรุ่น'); return; }
    if (isAccessory && !form.accessoryType) { toast.error('กรุณาเลือกประเภทอุปกรณ์'); return; }
    if (isCharger && !form.model) { toast.error('กรุณาเลือกชนิดชุดชาร์จ'); return; }
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
            {/* ประเภท - FIRST */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ประเภท *</label>
              <select value={form.category} onChange={(e) => handleCategoryChange(e.target.value)} className={inputCls}>
                {categoryOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>

            {form.category === 'ACCESSORY' ? (
              <>
                {/* ประเภทอุปกรณ์ */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">ประเภทอุปกรณ์ *</label>
                  <select value={form.accessoryType} onChange={(e) => handleAccessoryTypeChange(e.target.value)} className={inputCls} required>
                    <option value="">เลือกประเภทอุปกรณ์</option>
                    {accessoryTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>

                {form.accessoryType === 'ชุดชาร์จ' ? (
                  /* Charger: connector type */
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">ชนิด *</label>
                    <select value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} className={inputCls} required>
                      <option value="">เลือกชนิด</option>
                      {chargerConnectorTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                ) : form.accessoryType ? (
                  /* Non-charger: compatible phone brand */
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">สำหรับยี่ห้อ</label>
                    <select value={form.brand} onChange={(e) => handleBrandChange(e.target.value)} className={inputCls}>
                      <option value="">เลือกยี่ห้อโทรศัพท์</option>
                      {brands.map((b) => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </div>
                ) : null}

                {/* Multi-model selection for non-charger accessories */}
                {form.accessoryType && form.accessoryType !== 'ชุดชาร์จ' && form.brand && availableModels.length > 0 && (
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">สำหรับรุ่น (เลือกได้หลายรุ่น)</label>
                    <div className="flex flex-wrap gap-1.5 p-2 border border-gray-300 rounded-lg bg-gray-50 max-h-40 overflow-y-auto">
                      {availableModels.map((m) => {
                        const selectedModels = form.model ? form.model.split(', ').filter(Boolean) : [];
                        const isSelected = selectedModels.includes(m.name);
                        return (
                          <button
                            key={m.name}
                            type="button"
                            onClick={() => toggleModel(m.name)}
                            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                              isSelected
                                ? 'bg-purple-600 text-white border-purple-600'
                                : 'bg-white text-gray-600 border-gray-300 hover:border-purple-400 hover:text-purple-600'
                            }`}
                          >
                            {m.name}
                          </button>
                        );
                      })}
                    </div>
                    {form.model && (
                      <div className="text-xs text-purple-500 mt-1">เลือกแล้ว {form.model.split(', ').filter(Boolean).length} รุ่น</div>
                    )}
                  </div>
                )}

                {/* ยี่ห้ออุปกรณ์ */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">ยี่ห้ออุปกรณ์</label>
                  <input
                    type="text"
                    value={form.accessoryBrand}
                    onChange={(e) => setForm({ ...form, accessoryBrand: e.target.value })}
                    placeholder="เช่น Spigen, Anker, Samsung"
                    className={inputCls}
                  />
                </div>
              </>
            ) : (
              <>
                {/* ยี่ห้อ */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">ยี่ห้อ *</label>
                  <select value={form.brand} onChange={(e) => handleBrandChange(e.target.value)} className={inputCls} required>
                    <option value="">เลือกยี่ห้อ</option>
                    {brands.map((b) => <option key={b} value={b}>{b}</option>)}
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
              </>
            )}

            {/* ชื่อสินค้า */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ชื่อสินค้า</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={form.category === 'ACCESSORY' ? 'อัตโนมัติจาก ประเภท + ยี่ห้ออุปกรณ์ + รุ่น' : 'อัตโนมัติจาก ยี่ห้อ + รุ่น + สี + ความจุ'}
                className={inputCls}
              />
            </div>

            {form.category !== 'ACCESSORY' && (
              <>
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
              </>
            )}

            {/* สถานะ */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">สถานะ *</label>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className={inputCls}>
                {statusOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>

            {form.category !== 'ACCESSORY' && (
              /* เกรดสภาพ */
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">เกรดสภาพ</label>
                <select value={form.conditionGrade} onChange={(e) => setForm({ ...form, conditionGrade: e.target.value })} className={inputCls}>
                  {gradeOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
              </div>
            )}
          </div>

          {/* Accessory auto name preview */}
          {form.category === 'ACCESSORY' && (form.accessoryType || form.accessoryBrand) && (
            <div className="mt-3 text-sm text-purple-600 bg-purple-50 border border-purple-200 rounded-lg px-3 py-2">
              ชื่อสินค้าอัตโนมัติ: {(() => {
                const isCharger = form.accessoryType === 'ชุดชาร์จ';
                if (isCharger) return [form.accessoryType, form.accessoryBrand, form.model].filter(Boolean).join(' ');
                const accParts = [form.accessoryType, form.accessoryBrand].filter(Boolean);
                return form.model ? `${accParts.join(' ')} สำหรับ ${form.model}` : accParts.join(' ');
              })()}
            </div>
          )}

          {/* Used phone fields */}
          {form.category === 'PHONE_USED' && (
            <div className="col-span-2 mt-2 border border-orange-200 bg-orange-50 rounded-lg p-4 space-y-4">
              <h3 className="text-sm font-semibold text-orange-700">ข้อมูลมือสอง</h3>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">% แบตเตอรี่</label>
                  <input
                    type="number"
                    value={form.batteryHealth}
                    onChange={(e) => setForm({ ...form, batteryHealth: e.target.value })}
                    placeholder="เช่น 87"
                    className={inputCls}
                    min="0"
                    max="100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">ประกันศูนย์</label>
                  <div className="flex items-center gap-3 mt-1">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.warrantyExpired}
                        onChange={(e) => setForm({ ...form, warrantyExpired: e.target.checked, warrantyExpireDate: e.target.checked ? '' : form.warrantyExpireDate })}
                        className="rounded"
                      />
                      <span className="text-sm text-gray-600">หมดประกันแล้ว</span>
                    </label>
                  </div>
                  {!form.warrantyExpired && (
                    <input
                      type="date"
                      value={form.warrantyExpireDate}
                      onChange={(e) => setForm({ ...form, warrantyExpireDate: e.target.value })}
                      className={`${inputCls} mt-2`}
                    />
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">กล่อง</label>
                  <div className="flex gap-2 mt-1">
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, hasBox: true })}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${form.hasBox ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-green-100'}`}
                    >
                      มีกล่อง
                    </button>
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, hasBox: false })}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${!form.hasBox ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-red-100'}`}
                    >
                      ไม่มีกล่อง
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
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
          <p className="text-xs text-gray-400">รองรับ JPG, PNG สูงสุด {MAX_PHOTOS} รูป (ไม่เกิน 5MB/รูป) - ใช้ไป {photoPreviews.length}/{MAX_PHOTOS}</p>
        </div>

        {/* Branch & Supplier */}
        <div className="bg-white rounded-lg border p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">สาขา & ผู้ขาย</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">สาขา *</label>
              <select value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })} className={inputCls} required>
                <option value="">เลือกสาขา</option>
                {branchList.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ผู้ขาย</label>
              <select value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })} className={inputCls}>
                <option value="">{suppliersLoading ? 'กำลังโหลด...' : suppliersError ? '⚠ โหลดข้อมูลไม่ได้' : 'ไม่ระบุ'}</option>
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
