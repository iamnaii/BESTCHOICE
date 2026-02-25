import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import Modal from '@/components/ui/Modal';

// ===== DATA =====

const brandModels: Record<string, string[]> = {
  Apple: [
    'iPhone 16 Pro Max', 'iPhone 16 Pro', 'iPhone 16 Plus', 'iPhone 16',
    'iPhone 15 Pro Max', 'iPhone 15 Pro', 'iPhone 15 Plus', 'iPhone 15',
    'iPhone 14 Pro Max', 'iPhone 14 Pro', 'iPhone 14 Plus', 'iPhone 14',
    'iPhone 13 Pro Max', 'iPhone 13 Pro', 'iPhone 13', 'iPhone 13 mini',
    'iPhone SE (3rd Gen)',
    'iPad Pro 12.9"', 'iPad Pro 11"', 'iPad Air', 'iPad mini', 'iPad (10th Gen)',
    'Apple Watch Ultra 2', 'Apple Watch Series 9', 'Apple Watch SE',
    'AirPods Pro 2', 'AirPods 4', 'AirPods Max',
  ],
  Samsung: [
    'Galaxy S25 Ultra', 'Galaxy S25+', 'Galaxy S25',
    'Galaxy S24 Ultra', 'Galaxy S24+', 'Galaxy S24', 'Galaxy S24 FE',
    'Galaxy S23 Ultra', 'Galaxy S23+', 'Galaxy S23', 'Galaxy S23 FE',
    'Galaxy Z Fold6', 'Galaxy Z Flip6', 'Galaxy Z Fold5', 'Galaxy Z Flip5',
    'Galaxy A55', 'Galaxy A35', 'Galaxy A25', 'Galaxy A15',
    'Galaxy Tab S9 Ultra', 'Galaxy Tab S9+', 'Galaxy Tab S9',
    'Galaxy Watch Ultra', 'Galaxy Watch 7', 'Galaxy Watch FE',
    'Galaxy Buds3 Pro', 'Galaxy Buds3', 'Galaxy Buds FE',
  ],
  OPPO: [
    'Find X7 Ultra', 'Find X7', 'Find N3 Flip',
    'Reno 12 Pro 5G', 'Reno 12 5G', 'Reno 11 Pro 5G', 'Reno 11 5G',
    'A98 5G', 'A79 5G', 'A60', 'A38', 'A18',
  ],
  Vivo: [
    'X200 Pro', 'X200', 'X100 Pro', 'X100',
    'V40 Pro', 'V40', 'V40 Lite',
    'Y200 Pro', 'Y200', 'Y100', 'Y36',
  ],
  Xiaomi: [
    'Xiaomi 14 Ultra', 'Xiaomi 14 Pro', 'Xiaomi 14',
    'Xiaomi 13T Pro', 'Xiaomi 13T',
    'Redmi Note 13 Pro+ 5G', 'Redmi Note 13 Pro 5G', 'Redmi Note 13 5G',
    'Redmi 13', 'Redmi A3',
    'POCO X6 Pro', 'POCO X6', 'POCO M6 Pro', 'POCO C65',
    'Xiaomi Pad 6S Pro', 'Xiaomi Pad 6',
  ],
  Huawei: [
    'Mate 60 Pro+', 'Mate 60 Pro', 'Mate 60',
    'P60 Pro', 'P60', 'Nova 12 Ultra', 'Nova 12 Pro', 'Nova 12',
    'MatePad Pro 13.2"', 'MatePad 11.5"',
    'Watch GT 4', 'Watch Fit 3',
    'FreeBuds Pro 3', 'FreeBuds 5i',
  ],
  Realme: [
    'GT 5 Pro', 'GT 5', 'GT Neo 5',
    '12 Pro+ 5G', '12 Pro 5G', '12 5G',
    'C67', 'C55', 'C53',
    'Narzo 70 Pro 5G', 'Narzo 70 5G',
  ],
  Nothing: [
    'Phone (2a) Plus', 'Phone (2a)', 'Phone (2)', 'Phone (1)',
    'CMF Phone 1',
    'Ear (2)', 'Ear (a)',
  ],
  'Google Pixel': [
    'Pixel 9 Pro XL', 'Pixel 9 Pro', 'Pixel 9', 'Pixel 9a',
    'Pixel 8 Pro', 'Pixel 8', 'Pixel 8a',
    'Pixel 7 Pro', 'Pixel 7', 'Pixel 7a',
    'Pixel Watch 3', 'Pixel Watch 2',
    'Pixel Buds Pro 2', 'Pixel Buds A-Series',
    'Pixel Tablet',
  ],
};

const brands = [...Object.keys(brandModels), 'อื่นๆ'];

const colorOptions = [
  'ดำ', 'ขาว', 'น้ำเงิน', 'ชมพู', 'ม่วง', 'เขียว', 'เหลือง', 'ทอง', 'เทา', 'แดง',
  'Natural Titanium', 'Blue Titanium', 'Black Titanium', 'White Titanium', 'Desert Titanium',
  'อื่นๆ',
];

const storageOptions = ['64GB', '128GB', '256GB', '512GB', '1TB'];

const productGroups = [
  { value: 'PHONE_NEW', label: 'สมาร์ทโฟน' },
  { value: 'TABLET', label: 'แท็บเล็ต' },
  { value: 'SMARTWATCH', label: 'สมาร์ทวอทช์' },
  { value: 'EARPHONE', label: 'หูฟัง' },
  { value: 'ACCESSORY', label: 'อุปกรณ์เสริม' },
];

// ===== HELPERS =====

function formatCurrency(value: string): string {
  const num = value.replace(/[^0-9]/g, '');
  if (!num) return '';
  return Number(num).toLocaleString('th-TH');
}

function parseCurrency(value: string): number {
  return Number(value.replace(/[^0-9]/g, '')) || 0;
}

function calcProfit(cost: number, sell: number): string {
  if (!cost || cost === 0) return '-';
  const pct = ((sell - cost) / cost) * 100;
  return pct.toFixed(1);
}

function getBatteryColor(pct: number): string {
  if (pct >= 80) return 'bg-green-500';
  if (pct >= 50) return 'bg-yellow-500';
  return 'bg-red-500';
}

function getBatteryBgColor(pct: number): string {
  if (pct >= 80) return 'bg-green-100';
  if (pct >= 50) return 'bg-yellow-100';
  return 'bg-red-100';
}

// ===== INTERFACES =====

interface FormData {
  brand: string;
  model: string;
  customModel: string;
  color: string;
  customColor: string;
  storage: string;
  imei: string;
  serialNumber: string;
  productGroup: string;
  condition: 'new' | 'used';
  costPrice: string;
  cashPrice: string;
  bestchoicePrice: string;
  otherPrice: string;
  purchasedFrom: string;
  batteryHealth: string;
  warrantyExpiry: string;
  branchId: string;
}

interface FormErrors {
  [key: string]: string;
}

const initialForm: FormData = {
  brand: '',
  model: '',
  customModel: '',
  color: '',
  customColor: '',
  storage: '',
  imei: '',
  serialNumber: '',
  productGroup: 'PHONE_NEW',
  condition: 'new',
  costPrice: '',
  cashPrice: '',
  bestchoicePrice: '',
  otherPrice: '',
  purchasedFrom: '',
  batteryHealth: '',
  warrantyExpiry: '',
  branchId: '',
};

// ===== COMPONENT =====

export default function AddProductPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState<FormData>(initialForm);
  const [errors, setErrors] = useState<FormErrors>({});
  const [showSummary, setShowSummary] = useState(false);
  const [savedData, setSavedData] = useState<FormData | null>(null);

  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => {
      const { data } = await api.get('/branches');
      return data;
    },
  });

  const models = useMemo(() => {
    if (form.brand && form.brand !== 'อื่นๆ' && brandModels[form.brand]) {
      return brandModels[form.brand];
    }
    return [];
  }, [form.brand]);

  const update = (field: keyof FormData, value: string) => {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      // Reset model when brand changes
      if (field === 'brand') {
        next.model = '';
        next.customModel = '';
      }
      return next;
    });
    // Clear error for field
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const updateCurrency = (field: keyof FormData, raw: string) => {
    const digits = raw.replace(/[^0-9]/g, '');
    update(field, digits);
  };

  const validate = (): boolean => {
    const errs: FormErrors = {};

    if (!form.brand) errs.brand = 'กรุณาเลือกยี่ห้อ';
    if (!form.model && form.brand !== 'อื่นๆ') errs.model = 'กรุณาเลือกรุ่น';
    if (form.brand === 'อื่นๆ' && !form.customModel.trim()) errs.customModel = 'กรุณาระบุรุ่น';
    if (!form.color) errs.color = 'กรุณาเลือกสี';
    if (form.color === 'อื่นๆ' && !form.customColor.trim()) errs.customColor = 'กรุณาระบุสี';
    if (!form.storage) errs.storage = 'กรุณาเลือกความจุ';
    if (!form.imei.trim()) {
      errs.imei = 'กรุณากรอก IMEI';
    } else if (!/^\d{15}$/.test(form.imei.trim())) {
      errs.imei = 'IMEI ต้องเป็นตัวเลข 15 หลัก';
    }
    if (!form.productGroup) errs.productGroup = 'กรุณาเลือกกลุ่มสินค้า';
    if (!form.costPrice) errs.costPrice = 'กรุณากรอกราคาทุน';
    if (!form.cashPrice) errs.cashPrice = 'กรุณากรอกราคาเงินสด';
    if (!form.bestchoicePrice) errs.bestchoicePrice = 'กรุณากรอกราคาขาย BESTCHOICE';
    if (!form.branchId) errs.branchId = 'กรุณาเลือกสาขา';

    if (form.condition === 'used') {
      if (!form.batteryHealth.trim()) {
        errs.batteryHealth = 'กรุณากรอก % แบตเตอรี่';
      } else {
        const bh = Number(form.batteryHealth);
        if (isNaN(bh) || bh < 0 || bh > 100) {
          errs.batteryHealth = '% แบตเตอรี่ต้องอยู่ระหว่าง 0-100';
        }
      }
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const saveMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const finalModel = data.brand === 'อื่นๆ' ? data.customModel : data.model;
      const finalColor = data.color === 'อื่นๆ' ? data.customColor : data.color;
      const name = `${data.brand === 'อื่นๆ' ? '' : data.brand} ${finalModel} ${data.storage} ${finalColor}`.trim();

      const category =
        data.condition === 'used' && data.productGroup === 'PHONE_NEW'
          ? 'PHONE_USED'
          : data.productGroup;

      const payload: Record<string, unknown> = {
        name,
        brand: data.brand === 'อื่นๆ' ? data.customModel.split(' ')[0] || 'อื่นๆ' : data.brand,
        model: finalModel,
        imeiSerial: data.imei.trim(),
        category,
        costPrice: parseCurrency(data.costPrice),
        branchId: data.branchId,
        conditionGrade: data.condition === 'used' ? 'B' : undefined,
      };

      return api.post('/products', payload);
    },
    onSuccess: () => {
      toast.success('บันทึกสินค้าสำเร็จ');
      setSavedData({ ...form });
      setShowSummary(true);
    },
    onError: (err: unknown) => {
      const error = err as { response?: { data?: { message?: string } } };
      toast.error(error?.response?.data?.message || 'เกิดข้อผิดพลาดในการบันทึก');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) {
      toast.error('กรุณากรอกข้อมูลให้ครบถ้วน');
      return;
    }
    saveMutation.mutate(form);
  };

  const handleReset = () => {
    setForm({ ...initialForm, branchId: branches[0]?.id || '' });
    setErrors({});
  };

  const closeSummary = () => {
    setShowSummary(false);
    setSavedData(null);
    handleReset();
  };

  const costNum = parseCurrency(form.costPrice);
  const cashNum = parseCurrency(form.cashPrice);
  const bcNum = parseCurrency(form.bestchoicePrice);
  const otherNum = parseCurrency(form.otherPrice);
  const batteryNum = Number(form.batteryHealth) || 0;

  const warrantyStatus = useMemo(() => {
    if (!form.warrantyExpiry) return null;
    const expiry = new Date(form.warrantyExpiry);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (expiry < today) {
      const diffDays = Math.ceil((today.getTime() - expiry.getTime()) / (1000 * 60 * 60 * 24));
      return { expired: true, text: `หมดประกันแล้ว ${diffDays} วัน`, color: 'text-red-600' };
    }
    const diffDays = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return { expired: false, text: `เหลืออีก ${diffDays} วัน`, color: 'text-green-600' };
  }, [form.warrantyExpiry]);

  // ===== Styles =====
  const inputCls = 'w-full px-3 py-2.5 border rounded-lg text-sm outline-none transition-all duration-200 focus:ring-2 focus:ring-primary-500 focus:border-primary-500';
  const inputErr = 'border-red-300 bg-red-50 focus:ring-red-500 focus:border-red-500';
  const inputOk = 'border-gray-300 bg-white hover:border-gray-400';
  const labelCls = 'block text-sm font-medium text-gray-700 mb-1.5';
  const errCls = 'text-xs text-red-500 mt-1';

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate('/products')}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                title="กลับ"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">เพิ่มสินค้าใหม่</h1>
                <p className="text-sm text-gray-500 mt-0.5">กรอกข้อมูลสินค้าเพื่อเพิ่มเข้าสู่ระบบ</p>
              </div>
            </div>
            <div className="hidden sm:flex items-center gap-2 text-xs text-gray-400">
              <span className="w-2 h-2 rounded-full bg-primary-500"></span>
              BESTCHOICE Inventory
            </div>
          </div>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* === Section 1: ข้อมูลสินค้า === */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="bg-gradient-to-r from-primary-600 to-primary-700 px-6 py-3.5">
            <h2 className="text-white font-semibold flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              ข้อมูลสินค้า
            </h2>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {/* Brand */}
              <div>
                <label className={labelCls}>ยี่ห้อ (Brand) <span className="text-red-500">*</span></label>
                <select
                  value={form.brand}
                  onChange={(e) => update('brand', e.target.value)}
                  className={`${inputCls} ${errors.brand ? inputErr : inputOk}`}
                >
                  <option value="">-- เลือกยี่ห้อ --</option>
                  {brands.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
                {errors.brand && <p className={errCls}>{errors.brand}</p>}
              </div>

              {/* Model */}
              <div>
                <label className={labelCls}>รุ่น (Model) <span className="text-red-500">*</span></label>
                {form.brand === 'อื่นๆ' ? (
                  <input
                    type="text"
                    value={form.customModel}
                    onChange={(e) => update('customModel', e.target.value)}
                    placeholder="ระบุยี่ห้อและรุ่น"
                    className={`${inputCls} ${errors.customModel ? inputErr : inputOk}`}
                  />
                ) : (
                  <select
                    value={form.model}
                    onChange={(e) => update('model', e.target.value)}
                    disabled={!form.brand}
                    className={`${inputCls} ${errors.model ? inputErr : inputOk} disabled:bg-gray-100 disabled:cursor-not-allowed`}
                  >
                    <option value="">{form.brand ? '-- เลือกรุ่น --' : '-- เลือกยี่ห้อก่อน --'}</option>
                    {models.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                )}
                {errors.model && <p className={errCls}>{errors.model}</p>}
                {errors.customModel && <p className={errCls}>{errors.customModel}</p>}
              </div>

              {/* Color */}
              <div>
                <label className={labelCls}>สี (Color) <span className="text-red-500">*</span></label>
                <select
                  value={form.color}
                  onChange={(e) => update('color', e.target.value)}
                  className={`${inputCls} ${errors.color ? inputErr : inputOk}`}
                >
                  <option value="">-- เลือกสี --</option>
                  {colorOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                {errors.color && <p className={errCls}>{errors.color}</p>}
                {form.color === 'อื่นๆ' && (
                  <div className="mt-2">
                    <input
                      type="text"
                      value={form.customColor}
                      onChange={(e) => update('customColor', e.target.value)}
                      placeholder="ระบุสี"
                      className={`${inputCls} ${errors.customColor ? inputErr : inputOk}`}
                    />
                    {errors.customColor && <p className={errCls}>{errors.customColor}</p>}
                  </div>
                )}
              </div>

              {/* Storage */}
              <div>
                <label className={labelCls}>ความจุ (Storage) <span className="text-red-500">*</span></label>
                <select
                  value={form.storage}
                  onChange={(e) => update('storage', e.target.value)}
                  className={`${inputCls} ${errors.storage ? inputErr : inputOk}`}
                >
                  <option value="">-- เลือกความจุ --</option>
                  {storageOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                {errors.storage && <p className={errCls}>{errors.storage}</p>}
              </div>

              {/* IMEI */}
              <div>
                <label className={labelCls}>IMEI <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={15}
                  value={form.imei}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, '').slice(0, 15);
                    update('imei', v);
                  }}
                  placeholder="ตัวเลข 15 หลัก"
                  className={`${inputCls} ${errors.imei ? inputErr : inputOk} font-mono tracking-wider`}
                />
                <div className="flex justify-between mt-1">
                  {errors.imei ? <p className={errCls}>{errors.imei}</p> : <span />}
                  <span className={`text-xs ${form.imei.length === 15 ? 'text-green-600' : 'text-gray-400'}`}>
                    {form.imei.length}/15
                  </span>
                </div>
              </div>

              {/* Serial Number */}
              <div>
                <label className={labelCls}>Serial Number</label>
                <input
                  type="text"
                  value={form.serialNumber}
                  onChange={(e) => update('serialNumber', e.target.value)}
                  placeholder="หมายเลข Serial"
                  className={`${inputCls} ${inputOk} font-mono tracking-wider`}
                />
              </div>

              {/* Product Group */}
              <div>
                <label className={labelCls}>กลุ่มสินค้า <span className="text-red-500">*</span></label>
                <select
                  value={form.productGroup}
                  onChange={(e) => update('productGroup', e.target.value)}
                  className={`${inputCls} ${errors.productGroup ? inputErr : inputOk}`}
                >
                  {productGroups.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                </select>
                {errors.productGroup && <p className={errCls}>{errors.productGroup}</p>}
              </div>

              {/* Branch */}
              <div>
                <label className={labelCls}>สาขา <span className="text-red-500">*</span></label>
                <select
                  value={form.branchId}
                  onChange={(e) => update('branchId', e.target.value)}
                  className={`${inputCls} ${errors.branchId ? inputErr : inputOk}`}
                >
                  <option value="">-- เลือกสาขา --</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                {errors.branchId && <p className={errCls}>{errors.branchId}</p>}
              </div>

              {/* Condition Toggle */}
              <div>
                <label className={labelCls}>ประเภทสินค้า <span className="text-red-500">*</span></label>
                <div className="flex rounded-lg border border-gray-300 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => update('condition', 'new')}
                    className={`flex-1 py-2.5 text-sm font-medium transition-all duration-200 ${
                      form.condition === 'new'
                        ? 'bg-primary-600 text-white shadow-inner'
                        : 'bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    มือ 1
                  </button>
                  <button
                    type="button"
                    onClick={() => update('condition', 'used')}
                    className={`flex-1 py-2.5 text-sm font-medium transition-all duration-200 border-l ${
                      form.condition === 'used'
                        ? 'bg-orange-500 text-white shadow-inner'
                        : 'bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    มือ 2
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* === Section 2: ราคา === */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="bg-gradient-to-r from-emerald-600 to-emerald-700 px-6 py-3.5">
            <h2 className="text-white font-semibold flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
              </svg>
              ราคา
            </h2>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {/* Cost Price */}
              <div>
                <label className={labelCls}>ราคาทุน <span className="text-red-500">*</span></label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={form.costPrice ? formatCurrency(form.costPrice) : ''}
                    onChange={(e) => updateCurrency('costPrice', e.target.value)}
                    placeholder="0"
                    className={`${inputCls} pr-8 ${errors.costPrice ? inputErr : inputOk}`}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">฿</span>
                </div>
                {errors.costPrice && <p className={errCls}>{errors.costPrice}</p>}
              </div>

              {/* Cash Price */}
              <div>
                <label className={labelCls}>ราคาเงินสด <span className="text-red-500">*</span></label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={form.cashPrice ? formatCurrency(form.cashPrice) : ''}
                    onChange={(e) => updateCurrency('cashPrice', e.target.value)}
                    placeholder="0"
                    className={`${inputCls} pr-8 ${errors.cashPrice ? inputErr : inputOk}`}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">฿</span>
                </div>
                {errors.cashPrice && <p className={errCls}>{errors.cashPrice}</p>}
                {costNum > 0 && cashNum > 0 && (
                  <p className={`text-xs mt-1 ${cashNum >= costNum ? 'text-green-600' : 'text-red-500'}`}>
                    กำไร {calcProfit(costNum, cashNum)}%
                  </p>
                )}
              </div>

              {/* BESTCHOICE Price */}
              <div>
                <label className={labelCls}>ราคาขาย BESTCHOICE <span className="text-red-500">*</span></label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={form.bestchoicePrice ? formatCurrency(form.bestchoicePrice) : ''}
                    onChange={(e) => updateCurrency('bestchoicePrice', e.target.value)}
                    placeholder="0"
                    className={`${inputCls} pr-8 ${errors.bestchoicePrice ? inputErr : inputOk}`}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">฿</span>
                </div>
                {errors.bestchoicePrice && <p className={errCls}>{errors.bestchoicePrice}</p>}
                {costNum > 0 && bcNum > 0 && (
                  <p className={`text-xs mt-1 ${bcNum >= costNum ? 'text-green-600' : 'text-red-500'}`}>
                    กำไร {calcProfit(costNum, bcNum)}%
                  </p>
                )}
              </div>

              {/* Other Price */}
              <div>
                <label className={labelCls}>ราคาขาย ที่อื่น</label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={form.otherPrice ? formatCurrency(form.otherPrice) : ''}
                    onChange={(e) => updateCurrency('otherPrice', e.target.value)}
                    placeholder="0"
                    className={`${inputCls} pr-8 ${inputOk}`}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">฿</span>
                </div>
                {costNum > 0 && otherNum > 0 && (
                  <p className={`text-xs mt-1 ${otherNum >= costNum ? 'text-green-600' : 'text-red-500'}`}>
                    กำไร {calcProfit(costNum, otherNum)}%
                  </p>
                )}
              </div>
            </div>

            {/* Purchased From */}
            <div className="mt-5 max-w-md">
              <label className={labelCls}>ซื้อมาจาก</label>
              <input
                type="text"
                value={form.purchasedFrom}
                onChange={(e) => update('purchasedFrom', e.target.value)}
                placeholder="ชื่อร้านหรือแหล่งที่ซื้อ"
                className={`${inputCls} ${inputOk}`}
              />
            </div>

            {/* Profit Summary */}
            {costNum > 0 && (cashNum > 0 || bcNum > 0) && (
              <div className="mt-5 p-4 bg-blue-50 rounded-lg border border-blue-100">
                <h3 className="text-sm font-semibold text-blue-800 mb-2">สรุปกำไร</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                  {cashNum > 0 && (
                    <div className="flex justify-between sm:block">
                      <span className="text-gray-600">เงินสด:</span>
                      <span className={`font-semibold ml-1 ${cashNum >= costNum ? 'text-green-700' : 'text-red-600'}`}>
                        {(cashNum - costNum).toLocaleString('th-TH')} ฿ ({calcProfit(costNum, cashNum)}%)
                      </span>
                    </div>
                  )}
                  {bcNum > 0 && (
                    <div className="flex justify-between sm:block">
                      <span className="text-gray-600">BESTCHOICE:</span>
                      <span className={`font-semibold ml-1 ${bcNum >= costNum ? 'text-green-700' : 'text-red-600'}`}>
                        {(bcNum - costNum).toLocaleString('th-TH')} ฿ ({calcProfit(costNum, bcNum)}%)
                      </span>
                    </div>
                  )}
                  {otherNum > 0 && (
                    <div className="flex justify-between sm:block">
                      <span className="text-gray-600">ที่อื่น:</span>
                      <span className={`font-semibold ml-1 ${otherNum >= costNum ? 'text-green-700' : 'text-red-600'}`}>
                        {(otherNum - costNum).toLocaleString('th-TH')} ฿ ({calcProfit(costNum, otherNum)}%)
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* === Section 3: ข้อมูลมือ 2 (conditional) === */}
        {form.condition === 'used' && (
          <div className="bg-white rounded-xl shadow-sm border border-orange-200 overflow-hidden animate-fadeIn">
            <div className="bg-gradient-to-r from-orange-500 to-orange-600 px-6 py-3.5">
              <h2 className="text-white font-semibold flex items-center gap-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                ข้อมูลเพิ่มเติม (มือ 2)
              </h2>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {/* Battery Health */}
                <div>
                  <label className={labelCls}>% แบตเตอรี่ (Battery Health) <span className="text-red-500">*</span></label>
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={form.batteryHealth}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === '' || (Number(v) >= 0 && Number(v) <= 100)) {
                          update('batteryHealth', v);
                        }
                      }}
                      placeholder="0-100"
                      className={`w-24 ${inputCls} ${errors.batteryHealth ? inputErr : inputOk} text-center`}
                    />
                    <span className="text-gray-500 text-sm">%</span>
                  </div>
                  {errors.batteryHealth && <p className={errCls}>{errors.batteryHealth}</p>}

                  {/* Battery Progress Bar */}
                  {form.batteryHealth && (
                    <div className="mt-3">
                      <div className={`w-full h-4 rounded-full overflow-hidden ${getBatteryBgColor(batteryNum)}`}>
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${getBatteryColor(batteryNum)}`}
                          style={{ width: `${Math.min(batteryNum, 100)}%` }}
                        />
                      </div>
                      <div className="flex justify-between mt-1">
                        <span className={`text-xs font-medium ${
                          batteryNum >= 80 ? 'text-green-600' : batteryNum >= 50 ? 'text-yellow-600' : 'text-red-600'
                        }`}>
                          {batteryNum >= 80 ? 'ดีมาก' : batteryNum >= 50 ? 'ปานกลาง' : 'ต่ำ'}
                        </span>
                        <span className="text-xs text-gray-500">{batteryNum}%</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Warranty Expiry */}
                <div>
                  <label className={labelCls}>วันที่ประกันศูนย์หมด</label>
                  <input
                    type="date"
                    value={form.warrantyExpiry}
                    onChange={(e) => update('warrantyExpiry', e.target.value)}
                    className={`${inputCls} ${inputOk}`}
                  />
                  {warrantyStatus && (
                    <div className={`mt-2 flex items-center gap-2 text-sm ${warrantyStatus.color}`}>
                      {warrantyStatus.expired ? (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                        </svg>
                      )}
                      <span className="font-medium">{warrantyStatus.text}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* === Action Buttons === */}
        <div className="flex flex-col sm:flex-row justify-end gap-3 pb-8">
          <button
            type="button"
            onClick={handleReset}
            className="px-6 py-2.5 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 hover:border-gray-400 transition-all duration-200"
          >
            ล้างข้อมูล
          </button>
          <button
            type="submit"
            disabled={saveMutation.isPending}
            className="px-8 py-2.5 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 active:bg-primary-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-sm hover:shadow-md"
          >
            {saveMutation.isPending ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                กำลังบันทึก...
              </span>
            ) : (
              'บันทึกสินค้า'
            )}
          </button>
        </div>
      </form>

      {/* === Success Summary Modal === */}
      <Modal isOpen={showSummary} onClose={closeSummary} title="บันทึกสำเร็จ" size="lg">
        {savedData && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 bg-green-50 rounded-lg border border-green-200">
              <svg className="w-6 h-6 text-green-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-green-800 font-medium">เพิ่มสินค้าเข้าสู่ระบบเรียบร้อยแล้ว</span>
            </div>

            <div className="divide-y divide-gray-100">
              <SummaryRow label="ยี่ห้อ / รุ่น" value={`${savedData.brand === 'อื่นๆ' ? savedData.customModel : `${savedData.brand} ${savedData.model}`}`} />
              <SummaryRow label="สี" value={savedData.color === 'อื่นๆ' ? savedData.customColor : savedData.color} />
              <SummaryRow label="ความจุ" value={savedData.storage} />
              <SummaryRow label="IMEI" value={savedData.imei} mono />
              {savedData.serialNumber && <SummaryRow label="Serial Number" value={savedData.serialNumber} mono />}
              <SummaryRow label="กลุ่มสินค้า" value={productGroups.find((g) => g.value === savedData.productGroup)?.label || savedData.productGroup} />
              <SummaryRow label="ประเภท" value={savedData.condition === 'new' ? 'มือ 1' : 'มือ 2'} />
              <SummaryRow label="ราคาทุน" value={`${formatCurrency(savedData.costPrice)} ฿`} />
              <SummaryRow label="ราคาเงินสด" value={`${formatCurrency(savedData.cashPrice)} ฿`} />
              <SummaryRow label="ราคาขาย BESTCHOICE" value={`${formatCurrency(savedData.bestchoicePrice)} ฿`} />
              {savedData.otherPrice && <SummaryRow label="ราคาขาย ที่อื่น" value={`${formatCurrency(savedData.otherPrice)} ฿`} />}
              {savedData.purchasedFrom && <SummaryRow label="ซื้อมาจาก" value={savedData.purchasedFrom} />}
              {savedData.condition === 'used' && savedData.batteryHealth && (
                <SummaryRow label="% แบตเตอรี่" value={`${savedData.batteryHealth}%`} />
              )}
              {savedData.condition === 'used' && savedData.warrantyExpiry && (
                <SummaryRow label="ประกันหมด" value={new Date(savedData.warrantyExpiry).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })} />
              )}
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t">
              <button
                onClick={closeSummary}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
              >
                เพิ่มสินค้าอีก
              </button>
              <button
                onClick={() => navigate('/products')}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors"
              >
                ไปหน้าสินค้า
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ===== Summary Row =====

function SummaryRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between py-2.5">
      <span className="text-sm text-gray-500">{label}</span>
      <span className={`text-sm font-medium text-gray-900 ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}
