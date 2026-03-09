import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import Modal from '@/components/ui/Modal';
import toast from 'react-hot-toast';

interface InterestConfig {
  id: string;
  name: string;
  productCategories: string[];
  interestRate: string;
  minDownPaymentPct: string;
  storeCommissionPct: string;
  vatPct: string;
  minInstallmentMonths: number;
  maxInstallmentMonths: number;
  isActive: boolean;
  createdAt: string;
}

const CATEGORIES = [
  { value: 'PHONE_NEW', label: 'มือถือมือ 1' },
  { value: 'PHONE_USED', label: 'มือถือมือ 2' },
  { value: 'TABLET', label: 'แท็บเล็ต' },
  { value: 'ACCESSORY', label: 'อุปกรณ์เสริม' },
];

const defaultForm = {
  name: '',
  productCategories: [] as string[],
  interestRate: 8.0,
  minDownPaymentPct: 15,
  storeCommissionPct: 10,
  vatPct: 7,
  minInstallmentMonths: 6,
  maxInstallmentMonths: 12,
};

type FormErrors = Partial<Record<keyof typeof defaultForm, string>>;

function validateForm(form: typeof defaultForm): FormErrors {
  const errors: FormErrors = {};
  if (!form.name.trim()) errors.name = 'กรุณากรอกชื่อ';
  if (form.productCategories.length === 0) errors.productCategories = 'กรุณาเลือกประเภทสินค้าอย่างน้อย 1 รายการ';
  if (form.interestRate <= 0) errors.interestRate = 'ดอกเบี้ยต้องมากกว่า 0';
  if (form.minDownPaymentPct <= 0 || form.minDownPaymentPct > 100) errors.minDownPaymentPct = 'ดาวน์ขั้นต่ำต้องอยู่ระหว่าง 0-100%';
  if (form.storeCommissionPct < 0 || form.storeCommissionPct > 100) errors.storeCommissionPct = 'ค่าคอมต้องอยู่ระหว่าง 0-100%';
  if (form.vatPct < 0 || form.vatPct > 100) errors.vatPct = 'VAT ต้องอยู่ระหว่าง 0-100%';
  if (form.minInstallmentMonths < 1) errors.minInstallmentMonths = 'งวดต่ำสุดต้อง >= 1';
  if (form.maxInstallmentMonths < 1) errors.maxInstallmentMonths = 'งวดสูงสุดต้อง >= 1';
  if (form.minInstallmentMonths >= form.maxInstallmentMonths) {
    errors.minInstallmentMonths = 'งวดต่ำสุดต้องน้อยกว่างวดสูงสุด';
    errors.maxInstallmentMonths = 'งวดสูงสุดต้องมากกว่างวดต่ำสุด';
  }
  return errors;
}

export default function InterestConfigPage() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(defaultForm);
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState(false);

  const { data: configs = [], isLoading } = useQuery<InterestConfig[]>({
    queryKey: ['interest-configs'],
    queryFn: async () => { const { data } = await api.get('/interest-configs'); return data; },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name,
        productCategories: form.productCategories,
        interestRate: form.interestRate / 100,
        minDownPaymentPct: form.minDownPaymentPct / 100,
        storeCommissionPct: form.storeCommissionPct / 100,
        vatPct: form.vatPct / 100,
        minInstallmentMonths: form.minInstallmentMonths,
        maxInstallmentMonths: form.maxInstallmentMonths,
      };
      if (editId) {
        const { data } = await api.put(`/interest-configs/${editId}`, payload);
        return data;
      }
      const { data } = await api.post('/interest-configs', payload);
      return data;
    },
    onSuccess: () => {
      toast.success(editId ? 'อัปเดตสำเร็จ' : 'สร้างสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['interest-configs'] });
      closeModal();
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await api.delete(`/interest-configs/${id}`); },
    onSuccess: () => {
      toast.success('ลบสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['interest-configs'] });
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : 'ลบไม่สำเร็จ'),
  });

  const openCreate = () => {
    setEditId(null);
    setForm(defaultForm);
    setErrors({});
    setTouched(false);
    setShowModal(true);
  };

  const openEdit = (config: InterestConfig) => {
    setEditId(config.id);
    setForm({
      name: config.name,
      productCategories: config.productCategories,
      interestRate: parseFloat(config.interestRate) * 100,
      minDownPaymentPct: parseFloat(config.minDownPaymentPct) * 100,
      storeCommissionPct: parseFloat(config.storeCommissionPct) * 100,
      vatPct: parseFloat(config.vatPct) * 100,
      minInstallmentMonths: config.minInstallmentMonths,
      maxInstallmentMonths: config.maxInstallmentMonths,
    });
    setErrors({});
    setTouched(false);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditId(null);
    setForm(defaultForm);
    setErrors({});
    setTouched(false);
  };

  const toggleCategory = (cat: string) => {
    setForm((prev) => ({
      ...prev,
      productCategories: prev.productCategories.includes(cat)
        ? prev.productCategories.filter((c) => c !== cat)
        : [...prev.productCategories, cat],
    }));
  };

  const handleSave = () => {
    setTouched(true);
    const validationErrors = validateForm(form);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;
    saveMutation.mutate();
  };

  const getCategoryLabel = (cat: string) => CATEGORIES.find((c) => c.value === cat)?.label || cat;

  // Simulation calculation for preview
  const simulateCalc = (config: InterestConfig) => {
    const price = 12900;
    const downPct = parseFloat(config.minDownPaymentPct);
    const rate = parseFloat(config.interestRate);
    const commPct = parseFloat(config.storeCommissionPct);
    const vat = parseFloat(config.vatPct);
    const months = config.maxInstallmentMonths;

    const down = price * downPct;
    const loan = price - down;
    const commission = loan * commPct;
    const interest = loan * rate * months;
    const vatAmount = (loan + commission + interest) * vat;
    const total = loan + commission + interest + vatAmount;
    const monthly = Math.ceil(total / months);
    return { down, loan, interest, commission, vatAmount, total, monthly, months };
  };

  const inputClass = 'w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';
  const errorInputClass = 'w-full px-3 py-2 border border-red-400 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-400 focus:border-red-400';

  return (
    <div>
      <PageHeader
        title="ตั้งค่าดอกเบี้ย"
        subtitle="กำหนดอัตราดอกเบี้ยและเงื่อนไขตามประเภทสินค้า"
        action={
          <button onClick={openCreate} className="px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700">
            + สร้าง Config
          </button>
        }
      />

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      ) : configs.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border">
          <div className="text-gray-400 text-sm mb-3">ยังไม่มีการตั้งค่าดอกเบี้ย</div>
          <button onClick={openCreate} className="text-sm text-primary-600 hover:underline">สร้างตั้งค่าแรก</button>
        </div>
      ) : (
        <div className="grid gap-4">
          {configs.map((config) => {
            const sim = simulateCalc(config);
            return (
              <div key={config.id} className={`bg-white rounded-lg border p-5 ${!config.isActive ? 'opacity-50' : ''}`}>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="text-lg font-semibold text-gray-900">{config.name}</h3>
                      {!config.isActive && <span className="text-xs px-2 py-0.5 bg-gray-200 rounded-full">ปิดใช้งาน</span>}
                    </div>
                    <div className="flex flex-wrap gap-1 mb-3">
                      {config.productCategories.map((cat) => (
                        <span key={cat} className="px-2 py-0.5 bg-primary-100 text-primary-700 rounded-full text-xs font-medium">
                          {getCategoryLabel(cat)}
                        </span>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                      <div>
                        <div className="text-xs text-gray-500">ดอกเบี้ย</div>
                        <div className="text-lg font-bold text-primary-700">{(parseFloat(config.interestRate) * 100).toFixed(1)}%</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500">ดาวน์ขั้นต่ำ</div>
                        <div className="text-lg font-bold">{(parseFloat(config.minDownPaymentPct) * 100).toFixed(0)}%</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500">ค่าคอมหน้าร้าน</div>
                        <div className="text-lg font-bold">{(parseFloat(config.storeCommissionPct) * 100).toFixed(0)}%</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500">VAT</div>
                        <div className="text-lg font-bold">{(parseFloat(config.vatPct) * 100).toFixed(0)}%</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500">งวดต่ำสุด</div>
                        <div className="text-lg font-bold">{config.minInstallmentMonths} เดือน</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500">งวดสูงสุด</div>
                        <div className="text-lg font-bold">{config.maxInstallmentMonths} เดือน</div>
                      </div>
                    </div>

                    {/* Simulation */}
                    <div className="mt-3 bg-gray-50 rounded-lg p-3">
                      <div className="text-xs text-gray-500 mb-1">ตัวอย่างคำนวณ (ราคา 12,900 บาท / {sim.months} งวด)</div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                        <div><span className="text-gray-500">ดาวน์:</span> <span className="font-medium">{sim.down.toLocaleString()} ฿</span></div>
                        <div><span className="text-gray-500">ยอดปล่อย:</span> <span className="font-medium">{sim.loan.toLocaleString()} ฿</span></div>
                        <div><span className="text-gray-500">ดอกเบี้ย:</span> <span className="font-medium">{sim.interest.toLocaleString(undefined, { maximumFractionDigits: 0 })} ฿</span></div>
                        <div><span className="text-gray-500">ค่าคอม:</span> <span className="font-medium">{sim.commission.toLocaleString(undefined, { maximumFractionDigits: 0 })} ฿</span></div>
                        <div><span className="text-gray-500">VAT:</span> <span className="font-medium">{sim.vatAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })} ฿</span></div>
                        <div><span className="text-gray-500">รวมจัดไฟแนนซ์:</span> <span className="font-medium">{sim.total.toLocaleString(undefined, { maximumFractionDigits: 0 })} ฿</span></div>
                        <div className="col-span-2"><span className="text-gray-500">ค่างวด/เดือน:</span> <span className="font-bold text-primary-700">{sim.monthly.toLocaleString()} ฿</span></div>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 ml-4">
                    <button onClick={() => openEdit(config)} className="text-xs text-primary-600 hover:underline px-2 py-1">แก้ไข</button>
                    <button
                      onClick={() => { if (confirm('ต้องการลบ?')) deleteMutation.mutate(config.id); }}
                      className="text-xs text-red-600 hover:underline px-2 py-1"
                    >
                      ลบ
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <Modal isOpen title={editId ? 'แก้ไขตั้งค่าดอกเบี้ย' : 'สร้างตั้งค่าดอกเบี้ย'} onClose={closeModal}>
          <div className="space-y-4">
            {/* ชื่อ */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ชื่อ</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="เช่น มือ 1, มือ 2..."
                className={touched && errors.name ? errorInputClass : `${inputClass} border-gray-300`}
              />
              {touched && errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
            </div>

            {/* ประเภทสินค้า */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ประเภทสินค้า</label>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.value}
                    type="button"
                    onClick={() => toggleCategory(cat.value)}
                    className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                      form.productCategories.includes(cat.value)
                        ? 'bg-primary-600 text-white border-primary-600'
                        : 'bg-white text-gray-700 border-gray-300 hover:border-primary-300'
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
              {touched && errors.productCategories && <p className="text-xs text-red-500 mt-1">{errors.productCategories}</p>}
            </div>

            {/* ดอกเบี้ย + ดาวน์ขั้นต่ำ */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ดอกเบี้ย (%)</label>
                <input
                  type="number"
                  value={form.interestRate}
                  onChange={(e) => setForm((f) => ({ ...f, interestRate: Number(e.target.value) }))}
                  step="0.1"
                  min="0"
                  max="100"
                  className={touched && errors.interestRate ? errorInputClass : `${inputClass} border-gray-300`}
                />
                {touched && errors.interestRate && <p className="text-xs text-red-500 mt-1">{errors.interestRate}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ดาวน์ขั้นต่ำ (%)</label>
                <input
                  type="number"
                  value={form.minDownPaymentPct}
                  onChange={(e) => setForm((f) => ({ ...f, minDownPaymentPct: Number(e.target.value) }))}
                  step="1"
                  min="0"
                  max="100"
                  className={touched && errors.minDownPaymentPct ? errorInputClass : `${inputClass} border-gray-300`}
                />
                {touched && errors.minDownPaymentPct && <p className="text-xs text-red-500 mt-1">{errors.minDownPaymentPct}</p>}
              </div>
            </div>

            {/* ค่าคอม + VAT */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ค่าคอมหน้าร้าน (%)</label>
                <input
                  type="number"
                  value={form.storeCommissionPct}
                  onChange={(e) => setForm((f) => ({ ...f, storeCommissionPct: Number(e.target.value) }))}
                  step="1"
                  min="0"
                  max="100"
                  className={touched && errors.storeCommissionPct ? errorInputClass : `${inputClass} border-gray-300`}
                />
                {touched && errors.storeCommissionPct && <p className="text-xs text-red-500 mt-1">{errors.storeCommissionPct}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">VAT (%)</label>
                <input
                  type="number"
                  value={form.vatPct}
                  onChange={(e) => setForm((f) => ({ ...f, vatPct: Number(e.target.value) }))}
                  step="0.1"
                  min="0"
                  max="100"
                  className={touched && errors.vatPct ? errorInputClass : `${inputClass} border-gray-300`}
                />
                {touched && errors.vatPct && <p className="text-xs text-red-500 mt-1">{errors.vatPct}</p>}
              </div>
            </div>

            {/* งวดต่ำสุด + สูงสุด */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">งวดต่ำสุด (เดือน)</label>
                <input
                  type="number"
                  value={form.minInstallmentMonths}
                  onChange={(e) => setForm((f) => ({ ...f, minInstallmentMonths: Number(e.target.value) }))}
                  min="1"
                  className={touched && errors.minInstallmentMonths ? errorInputClass : `${inputClass} border-gray-300`}
                />
                {touched && errors.minInstallmentMonths && <p className="text-xs text-red-500 mt-1">{errors.minInstallmentMonths}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">งวดสูงสุด (เดือน)</label>
                <input
                  type="number"
                  value={form.maxInstallmentMonths}
                  onChange={(e) => setForm((f) => ({ ...f, maxInstallmentMonths: Number(e.target.value) }))}
                  min="1"
                  className={touched && errors.maxInstallmentMonths ? errorInputClass : `${inputClass} border-gray-300`}
                />
                {touched && errors.maxInstallmentMonths && <p className="text-xs text-red-500 mt-1">{errors.maxInstallmentMonths}</p>}
              </div>
            </div>

            {/* Preview Calculation */}
            {form.name && form.interestRate > 0 && form.minDownPaymentPct > 0 && (
              <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                <div className="text-xs font-medium text-gray-600 mb-2">ตัวอย่างคำนวณ (ราคาสินค้า 12,900 บาท / {form.maxInstallmentMonths} งวด)</div>
                {(() => {
                  const price = 12900;
                  const down = price * (form.minDownPaymentPct / 100);
                  const loan = price - down;
                  const commission = loan * (form.storeCommissionPct / 100);
                  const interest = loan * (form.interestRate / 100) * form.maxInstallmentMonths;
                  const vatAmount = (loan + commission + interest) * (form.vatPct / 100);
                  const total = loan + commission + interest + vatAmount;
                  const monthly = Math.ceil(total / form.maxInstallmentMonths);
                  return (
                    <div className="grid grid-cols-2 gap-1 text-xs">
                      <div>เงินดาวน์: <span className="font-medium">{down.toLocaleString()} ฿</span></div>
                      <div>ยอดปล่อย: <span className="font-medium">{loan.toLocaleString()} ฿</span></div>
                      <div>ดอกเบี้ย: <span className="font-medium">{interest.toLocaleString(undefined, { maximumFractionDigits: 0 })} ฿</span></div>
                      <div>ค่าคอม 10%: <span className="font-medium">{commission.toLocaleString(undefined, { maximumFractionDigits: 0 })} ฿</span></div>
                      <div>VAT: <span className="font-medium">{vatAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })} ฿</span></div>
                      <div>รวมจัดไฟแนนซ์: <span className="font-medium">{total.toLocaleString(undefined, { maximumFractionDigits: 0 })} ฿</span></div>
                      <div className="col-span-2 pt-1 border-t border-gray-200">
                        <span className="text-gray-600">ค่างวด/เดือน:</span> <span className="font-bold text-primary-700">{monthly.toLocaleString()} ฿</span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Buttons */}
            <div className="flex gap-3 pt-2">
              <button onClick={closeModal} className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">ยกเลิก</button>
              <button
                onClick={handleSave}
                disabled={saveMutation.isPending}
                className="flex-1 px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
              >
                {saveMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
