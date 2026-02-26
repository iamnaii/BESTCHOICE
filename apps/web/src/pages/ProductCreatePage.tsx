import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';

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
    imeiSerial: '',
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

  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches'],
    queryFn: async () => {
      const { data } = await api.get('/branches');
      return data;
    },
  });

  const { data: suppliers = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['suppliers'],
    queryFn: async () => {
      const { data } = await api.get('/suppliers', { params: { isActive: 'true' } });
      return data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name || `${form.brand} ${form.model}`,
        brand: form.brand,
        model: form.model,
        imeiSerial: form.imeiSerial || undefined,
        category: form.category,
        costPrice: parseFloat(form.costPrice),
        supplierId: form.supplierId || undefined,
        branchId: form.branchId,
        status: form.status,
        conditionGrade: form.conditionGrade || undefined,
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
    onError: () => {
      toast.error('เกิดข้อผิดพลาด');
    },
  });

  const addPriceRow = () => {
    setPrices([...prices, { label: '', amount: '', isDefault: false }]);
  };

  const removePriceRow = (index: number) => {
    if (prices.length <= 1) return;
    const newPrices = prices.filter((_, i) => i !== index);
    // If removed default, set first as default
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
    (newPrices[index] as Record<string, unknown>)[field] = value;
    setPrices(newPrices);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.branchId) {
      toast.error('กรุณาเลือกสาขา');
      return;
    }
    if (!form.costPrice) {
      toast.error('กรุณาระบุราคาทุน');
      return;
    }
    if (prices.filter((p) => p.label && p.amount).length === 0) {
      toast.error('กรุณาเพิ่มอย่างน้อย 1 ราคาขาย');
      return;
    }
    createMutation.mutate();
  };

  // Auto-fill name from brand + model
  const updateField = (field: string, value: string) => {
    const newForm = { ...form, [field]: value };
    if ((field === 'brand' || field === 'model') && !form.name) {
      newForm.name = `${field === 'brand' ? value : form.brand} ${field === 'model' ? value : form.model}`.trim();
    }
    setForm(newForm);
  };

  return (
    <div>
      <PageHeader
        title="เพิ่มสินค้าใหม่"
        action={
          <button
            onClick={() => navigate('/products')}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-300 rounded-lg"
          >
            กลับ
          </button>
        }
      />

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Product Info */}
        <div className="bg-white rounded-lg border p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">ข้อมูลสินค้า</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ยี่ห้อ *</label>
              <input
                type="text"
                value={form.brand}
                onChange={(e) => updateField('brand', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">รุ่น *</label>
              <input
                type="text"
                value={form.model}
                onChange={(e) => updateField('model', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                required
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">ชื่อสินค้า</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="อัตโนมัติจาก ยี่ห้อ + รุ่น"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">IMEI / Serial Number</label>
              <input
                type="text"
                value={form.imeiSerial}
                onChange={(e) => setForm({ ...form, imeiSerial: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none font-mono"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ประเภท *</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              >
                {categoryOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">สถานะ *</label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              >
                {statusOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">เกรดสภาพ</label>
              <select
                value={form.conditionGrade}
                onChange={(e) => setForm({ ...form, conditionGrade: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              >
                {gradeOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Branch & Supplier */}
        <div className="bg-white rounded-lg border p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">สาขา & Supplier</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">สาขา *</label>
              <select
                value={form.branchId}
                onChange={(e) => setForm({ ...form, branchId: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                required
              >
                <option value="">เลือกสาขา</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
              <select
                value={form.supplierId}
                onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              >
                <option value="">ไม่ระบุ</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ราคาทุน (บาท) *</label>
              <input
                type="number"
                step="0.01"
                value={form.costPrice}
                onChange={(e) => setForm({ ...form, costPrice: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
                required
              />
            </div>
          </div>
        </div>

        {/* Multi-Price */}
        <div className="bg-white rounded-lg border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">ราคาขาย</h2>
            <button
              type="button"
              onClick={addPriceRow}
              className="text-sm text-primary-600 hover:text-primary-700 font-medium"
            >
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
                  <input
                    type="radio"
                    name="defaultPrice"
                    checked={price.isDefault}
                    onChange={() => updatePrice(index, 'isDefault', true)}
                    className="text-primary-600"
                  />
                  ค่าเริ่มต้น
                </label>
                {prices.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removePriceRow(index)}
                    className="text-red-400 hover:text-red-600 text-lg"
                  >
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
          <button
            type="button"
            onClick={() => navigate('/products')}
            className="px-6 py-2.5 text-sm text-gray-600 hover:text-gray-800 border border-gray-300 rounded-lg"
          >
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
