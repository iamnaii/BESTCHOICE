import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import Modal from '@/components/ui/Modal';
import toast from 'react-hot-toast';

interface InterestConfig {
  id: string;
  name: string;
  productCategories: string[];
  interestRate: string;
  minDownPaymentPct: string;
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
  interestRate: 0.08,
  minDownPaymentPct: 0.15,
  minInstallmentMonths: 6,
  maxInstallmentMonths: 12,
};

export default function InterestConfigPage() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(defaultForm);

  const { data: configs = [], isLoading } = useQuery<InterestConfig[]>({
    queryKey: ['interest-configs'],
    queryFn: async () => { const { data } = await api.get('/interest-configs'); return data; },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editId) {
        const { data } = await api.put(`/interest-configs/${editId}`, form);
        return data;
      }
      const { data } = await api.post('/interest-configs', form);
      return data;
    },
    onSuccess: () => {
      toast.success(editId ? 'อัปเดตสำเร็จ' : 'สร้างสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['interest-configs'] });
      closeModal();
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'เกิดข้อผิดพลาด'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await api.delete(`/interest-configs/${id}`); },
    onSuccess: () => {
      toast.success('ลบสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['interest-configs'] });
    },
  });

  const openCreate = () => {
    setEditId(null);
    setForm(defaultForm);
    setShowModal(true);
  };

  const openEdit = (config: InterestConfig) => {
    setEditId(config.id);
    setForm({
      name: config.name,
      productCategories: config.productCategories,
      interestRate: parseFloat(config.interestRate),
      minDownPaymentPct: parseFloat(config.minDownPaymentPct),
      minInstallmentMonths: config.minInstallmentMonths,
      maxInstallmentMonths: config.maxInstallmentMonths,
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditId(null);
    setForm(defaultForm);
  };

  const toggleCategory = (cat: string) => {
    setForm((prev) => ({
      ...prev,
      productCategories: prev.productCategories.includes(cat)
        ? prev.productCategories.filter((c) => c !== cat)
        : [...prev.productCategories, cat],
    }));
  };

  const getCategoryLabel = (cat: string) => CATEGORIES.find((c) => c.value === cat)?.label || cat;

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
          {configs.map((config) => (
            <div key={config.id} className={`bg-white rounded-lg border p-5 ${!config.isActive ? 'opacity-50' : ''}`}>
              <div className="flex items-start justify-between">
                <div>
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
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <div className="text-xs text-gray-500">ดอกเบี้ย</div>
                      <div className="text-lg font-bold text-primary-700">{(parseFloat(config.interestRate) * 100).toFixed(1)}%</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">ดาวน์ขั้นต่ำ</div>
                      <div className="text-lg font-bold">{(parseFloat(config.minDownPaymentPct) * 100).toFixed(0)}%</div>
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
                </div>
                <div className="flex gap-2">
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
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <Modal isOpen title={editId ? 'แก้ไขตั้งค่าดอกเบี้ย' : 'สร้างตั้งค่าดอกเบี้ย'} onClose={closeModal}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ชื่อ</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="เช่น มือ 1, มือ 2..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ประเภทสินค้า</label>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.value}
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
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ดอกเบี้ย (%)</label>
                <input
                  type="number"
                  value={(form.interestRate * 100).toFixed(1)}
                  onChange={(e) => setForm((f) => ({ ...f, interestRate: Number(e.target.value) / 100 }))}
                  step="0.1"
                  min="0"
                  max="100"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ดาวน์ขั้นต่ำ (%)</label>
                <input
                  type="number"
                  value={(form.minDownPaymentPct * 100).toFixed(0)}
                  onChange={(e) => setForm((f) => ({ ...f, minDownPaymentPct: Number(e.target.value) / 100 }))}
                  step="1"
                  min="0"
                  max="100"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">งวดต่ำสุด (เดือน)</label>
                <input
                  type="number"
                  value={form.minInstallmentMonths}
                  onChange={(e) => setForm((f) => ({ ...f, minInstallmentMonths: Number(e.target.value) }))}
                  min="1"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">งวดสูงสุด (เดือน)</label>
                <input
                  type="number"
                  value={form.maxInstallmentMonths}
                  onChange={(e) => setForm((f) => ({ ...f, maxInstallmentMonths: Number(e.target.value) }))}
                  min="1"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button onClick={closeModal} className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded-lg">ยกเลิก</button>
              <button
                onClick={() => saveMutation.mutate()}
                disabled={!form.name || form.productCategories.length === 0 || saveMutation.isPending}
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
