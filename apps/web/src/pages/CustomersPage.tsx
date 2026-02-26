import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';

interface Customer {
  id: string;
  nationalId: string;
  name: string;
  phone: string;
  phoneSecondary: string | null;
  lineId: string | null;
  createdAt: string;
  _count: { contracts: number };
}

const emptyForm = { nationalId: '', name: '', phone: '', phoneSecondary: '', lineId: '', addressIdCard: '', addressCurrent: '', occupation: '', workplace: '' };

export default function CustomersPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const { data: customers = [], isLoading } = useQuery<Customer[]>({
    queryKey: ['customers', search],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (search) params.search = search;
      const { data } = await api.get('/customers', { params });
      return data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload = { ...form };
      Object.keys(payload).forEach((k) => { if (!(payload as Record<string, string>)[k]) delete (payload as Record<string, string>)[k]; });
      return api.post('/customers', payload);
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success('เพิ่มลูกค้าสำเร็จ');
      setIsModalOpen(false);
      navigate(`/customers/${res.data.id}`);
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      toast.error(err.response?.data?.message || 'เกิดข้อผิดพลาด');
    },
  });

  const columns = [
    {
      key: 'name',
      label: 'ชื่อ',
      render: (c: Customer) => (
        <button onClick={() => navigate(`/customers/${c.id}`)} className="text-primary-600 font-medium hover:underline text-left">{c.name}</button>
      ),
    },
    { key: 'phone', label: 'เบอร์โทร' },
    {
      key: 'nationalId',
      label: 'เลขบัตร ปชช.',
      render: (c: Customer) => <span className="font-mono text-xs">{c.nationalId.replace(/(\d{1})(\d{4})(\d{5})(\d{2})(\d{1})/, '$1-$2-$3-$4-$5')}</span>,
    },
    {
      key: 'contracts',
      label: 'สัญญา',
      render: (c: Customer) => <span className="text-sm">{c._count.contracts} สัญญา</span>,
    },
    {
      key: 'createdAt',
      label: 'วันที่เพิ่ม',
      render: (c: Customer) => <span className="text-xs">{new Date(c.createdAt).toLocaleDateString('th-TH')}</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="ลูกค้า"
        subtitle={`ทั้งหมด ${customers.length} ราย`}
        action={
          <button onClick={() => { setForm(emptyForm); setIsModalOpen(true); }} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700">
            + เพิ่มลูกค้า
          </button>
        }
      />

      <div className="mb-4">
        <input type="text" placeholder="ค้นหาชื่อ, เบอร์โทร, เลขบัตร ปชช..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full max-w-md px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none" />
      </div>

      <DataTable columns={columns} data={customers} isLoading={isLoading} emptyMessage="ไม่พบลูกค้า" />

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="เพิ่มลูกค้าใหม่" size="lg">
        <form onSubmit={(e) => { e.preventDefault(); createMutation.mutate(); }} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">เลขบัตร ปชช. (13 หลัก) *</label>
              <input type="text" maxLength={13} value={form.nationalId} onChange={(e) => setForm({ ...form, nationalId: e.target.value })} className="w-full px-3 py-2 border rounded-lg outline-none font-mono" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ชื่อ-นามสกุล *</label>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 border rounded-lg outline-none" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">เบอร์โทร *</label>
              <input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full px-3 py-2 border rounded-lg outline-none" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">เบอร์สำรอง</label>
              <input type="text" value={form.phoneSecondary} onChange={(e) => setForm({ ...form, phoneSecondary: e.target.value })} className="w-full px-3 py-2 border rounded-lg outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">LINE ID</label>
              <input type="text" value={form.lineId} onChange={(e) => setForm({ ...form, lineId: e.target.value })} className="w-full px-3 py-2 border rounded-lg outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">อาชีพ</label>
              <input type="text" value={form.occupation} onChange={(e) => setForm({ ...form, occupation: e.target.value })} className="w-full px-3 py-2 border rounded-lg outline-none" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">ที่อยู่ตามบัตร</label>
              <textarea value={form.addressIdCard} onChange={(e) => setForm({ ...form, addressIdCard: e.target.value })} rows={2} className="w-full px-3 py-2 border rounded-lg outline-none resize-none" />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-sm text-gray-600">ยกเลิก</button>
            <button type="submit" disabled={createMutation.isPending} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
              {createMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
