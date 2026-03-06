import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import Modal from '@/components/ui/Modal';
import toast from 'react-hot-toast';

interface PricingTemplate {
  id: string;
  brand: string;
  model: string;
  storage: string | null;
  category: string;
  hasWarranty: boolean | null;
  cashPrice: string;
  installmentBestchoicePrice: string;
  installmentFinancePrice: string;
  isActive: boolean;
}

const CATEGORIES = [
  { value: 'PHONE_NEW', label: 'มือ 1' },
  { value: 'PHONE_USED', label: 'มือ 2' },
];

const defaultForm = {
  brand: '',
  model: '',
  storage: '',
  category: 'PHONE_NEW' as string,
  hasWarranty: null as boolean | null,
  cashPrice: '',
  installmentBestchoicePrice: '',
  installmentFinancePrice: '',
};

export default function PricingTemplatesPage() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(defaultForm);
  const [filterCategory, setFilterCategory] = useState<string>('');
  const [filterBrand, setFilterBrand] = useState('');

  const { data: templates = [], isLoading } = useQuery<PricingTemplate[]>({
    queryKey: ['pricing-templates', filterCategory, filterBrand],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterCategory) params.set('category', filterCategory);
      if (filterBrand) params.set('brand', filterBrand);
      const { data } = await api.get(`/pricing-templates?${params}`);
      return data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        storage: form.storage || undefined,
        hasWarranty: form.category === 'PHONE_USED' ? form.hasWarranty : null,
        cashPrice: parseFloat(form.cashPrice),
        installmentBestchoicePrice: parseFloat(form.installmentBestchoicePrice),
        installmentFinancePrice: parseFloat(form.installmentFinancePrice),
      };
      if (editId) {
        const { data } = await api.put(`/pricing-templates/${editId}`, {
          cashPrice: payload.cashPrice,
          installmentBestchoicePrice: payload.installmentBestchoicePrice,
          installmentFinancePrice: payload.installmentFinancePrice,
        });
        return data;
      }
      const { data } = await api.post('/pricing-templates', payload);
      return data;
    },
    onSuccess: () => {
      toast.success(editId ? 'อัปเดตราคาสำเร็จ' : 'เพิ่มราคาตั้งต้นสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['pricing-templates'] });
      closeModal();
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'เกิดข้อผิดพลาด'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await api.delete(`/pricing-templates/${id}`); },
    onSuccess: () => {
      toast.success('ลบสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['pricing-templates'] });
    },
    onError: () => toast.error('ลบไม่สำเร็จ'),
  });

  const openCreate = () => {
    setEditId(null);
    setForm(defaultForm);
    setShowModal(true);
  };

  const openEdit = (t: PricingTemplate) => {
    setEditId(t.id);
    setForm({
      brand: t.brand,
      model: t.model,
      storage: t.storage || '',
      category: t.category,
      hasWarranty: t.hasWarranty,
      cashPrice: t.cashPrice,
      installmentBestchoicePrice: t.installmentBestchoicePrice,
      installmentFinancePrice: t.installmentFinancePrice,
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditId(null);
    setForm(defaultForm);
  };

  const fmt = (v: string) => parseFloat(v).toLocaleString();

  const warrantyLabel = (hw: boolean | null) => {
    if (hw === true) return 'มีประกัน';
    if (hw === false) return 'ไม่มีประกัน';
    return null;
  };

  const canSave = form.brand && form.model && form.cashPrice && form.installmentBestchoicePrice && form.installmentFinancePrice;

  return (
    <div>
      <PageHeader
        title="ราคาตั้งต้น"
        subtitle="กำหนดราคาเงินสด / ผ่อน BESTCHOICE / ผ่อนไฟแนนซ์ ตามรุ่นสินค้า"
        action={
          <button onClick={openCreate} className="px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700">
            + เพิ่มราคาตั้งต้น
          </button>
        }
      />

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
        >
          <option value="">ทุกประเภท</option>
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="ค้นหายี่ห้อ..."
          value={filterBrand}
          onChange={(e) => setFilterBrand(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm flex-1 max-w-xs"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      ) : templates.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border">
          <div className="text-gray-400 text-sm mb-3">ยังไม่มีราคาตั้งต้น</div>
          <button onClick={openCreate} className="text-sm text-primary-600 hover:underline">เพิ่มราคาตั้งต้นรายการแรก</button>
        </div>
      ) : (
        <div className="bg-white rounded-lg border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="text-left px-4 py-3 font-medium text-gray-600">ยี่ห้อ / รุ่น</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">ความจุ</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">ประเภท</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">เงินสด</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">ผ่อน BESTCHOICE</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">ผ่อนไฟแนนซ์</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600"></th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id} className="border-b last:border-b-0 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{t.brand} {t.model}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{t.storage || '-'}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        t.category === 'PHONE_NEW' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'
                      }`}>
                        {t.category === 'PHONE_NEW' ? 'มือ 1' : 'มือ 2'}
                      </span>
                      {warrantyLabel(t.hasWarranty) && (
                        <span className={`ml-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                          t.hasWarranty ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                        }`}>
                          {warrantyLabel(t.hasWarranty)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-medium">{fmt(t.cashPrice)} ฿</td>
                    <td className="px-4 py-3 text-right font-medium">{fmt(t.installmentBestchoicePrice)} ฿</td>
                    <td className="px-4 py-3 text-right font-medium">{fmt(t.installmentFinancePrice)} ฿</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => openEdit(t)} className="text-xs text-primary-600 hover:underline mr-2">แก้ไข</button>
                      <button
                        onClick={() => { if (confirm('ต้องการลบ?')) deleteMutation.mutate(t.id); }}
                        className="text-xs text-red-600 hover:underline"
                      >
                        ลบ
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <Modal isOpen title={editId ? 'แก้ไขราคาตั้งต้น' : 'เพิ่มราคาตั้งต้น'} onClose={closeModal}>
          <div className="space-y-4">
            {!editId && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">ยี่ห้อ *</label>
                    <input
                      type="text"
                      value={form.brand}
                      onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
                      placeholder="เช่น Apple, Samsung"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">รุ่น *</label>
                    <input
                      type="text"
                      value={form.model}
                      onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                      placeholder="เช่น iPhone 15, Galaxy S24"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">ความจุ</label>
                    <input
                      type="text"
                      value={form.storage}
                      onChange={(e) => setForm((f) => ({ ...f, storage: e.target.value }))}
                      placeholder="เช่น 128GB, 256GB (เว้นว่าง = ทุกความจุ)"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">ประเภท *</label>
                    <select
                      value={form.category}
                      onChange={(e) => setForm((f) => ({ ...f, category: e.target.value, hasWarranty: e.target.value === 'PHONE_USED' ? f.hasWarranty : null }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {form.category === 'PHONE_USED' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">ประกันศูนย์</label>
                    <div className="flex gap-2">
                      {[
                        { value: true, label: 'มีประกัน' },
                        { value: false, label: 'ไม่มีประกัน' },
                      ].map((opt) => (
                        <button
                          key={String(opt.value)}
                          onClick={() => setForm((f) => ({ ...f, hasWarranty: opt.value }))}
                          className={`px-4 py-2 rounded-lg text-sm border transition-colors ${
                            form.hasWarranty === opt.value
                              ? 'bg-primary-600 text-white border-primary-600'
                              : 'bg-white text-gray-700 border-gray-300 hover:border-primary-300'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {editId && (
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-sm font-medium text-gray-900">
                  {form.brand} {form.model} {form.storage && `(${form.storage})`}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {form.category === 'PHONE_NEW' ? 'มือ 1' : 'มือ 2'}
                  {form.hasWarranty === true && ' - มีประกัน'}
                  {form.hasWarranty === false && ' - ไม่มีประกัน'}
                </div>
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ราคาเงินสด (บาท) *</label>
                <input
                  type="number"
                  value={form.cashPrice}
                  onChange={(e) => setForm((f) => ({ ...f, cashPrice: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  min="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ราคาผ่อน BESTCHOICE (บาท) *</label>
                <input
                  type="number"
                  value={form.installmentBestchoicePrice}
                  onChange={(e) => setForm((f) => ({ ...f, installmentBestchoicePrice: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  min="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ราคาผ่อนไฟแนนซ์ (บาท) *</label>
                <input
                  type="number"
                  value={form.installmentFinancePrice}
                  onChange={(e) => setForm((f) => ({ ...f, installmentFinancePrice: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  min="0"
                />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button onClick={closeModal} className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded-lg">ยกเลิก</button>
              <button
                onClick={() => saveMutation.mutate()}
                disabled={!canSave || saveMutation.isPending}
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
