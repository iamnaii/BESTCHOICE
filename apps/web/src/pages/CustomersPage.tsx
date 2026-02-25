import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { useAuth } from '@/contexts/AuthContext';

interface Customer {
  id: string;
  nationalId: string;
  name: string;
  phone: string;
  phoneSecondary: string | null;
  lineId: string | null;
  addressCurrent: string | null;
  occupation: string | null;
  workplace: string | null;
  contracts: { id: string; contractNumber: string; status: string; sellingPrice: number }[];
  createdAt: string;
}

const contractStatusLabels: Record<string, string> = {
  DRAFT: 'ร่าง', ACTIVE: 'ใช้งาน', OVERDUE: 'เกินกำหนด', DEFAULT: 'ผิดนัด',
  EARLY_PAYOFF: 'ปิดก่อน', COMPLETED: 'เสร็จสิ้น', EXCHANGED: 'เปลี่ยนเครื่อง', CLOSED_BAD_DEBT: 'หนี้สูญ',
};

export default function CustomersPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [detailCustomer, setDetailCustomer] = useState<Customer | null>(null);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({
    nationalId: '', name: '', phone: '', phoneSecondary: '', lineId: '',
    addressIdCard: '', addressCurrent: '', occupation: '', workplace: '',
  });

  const { data: customers = [], isLoading } = useQuery<Customer[]>({
    queryKey: ['customers', search],
    queryFn: async () => {
      const params = search ? `?search=${encodeURIComponent(search)}` : '';
      const { data } = await api.get(`/customers${params}`);
      return data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const payload = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== ''));
      if (editingCustomer) return api.patch(`/customers/${editingCustomer.id}`, payload);
      return api.post('/customers', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success(editingCustomer ? 'แก้ไขลูกค้าสำเร็จ' : 'เพิ่มลูกค้าสำเร็จ');
      closeModal();
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'เกิดข้อผิดพลาด'),
  });

  const openCreate = () => {
    setEditingCustomer(null);
    setForm({ nationalId: '', name: '', phone: '', phoneSecondary: '', lineId: '', addressIdCard: '', addressCurrent: '', occupation: '', workplace: '' });
    setIsModalOpen(true);
  };

  const openEdit = (c: Customer) => {
    setEditingCustomer(c);
    setForm({
      nationalId: c.nationalId, name: c.name, phone: c.phone,
      phoneSecondary: c.phoneSecondary || '', lineId: c.lineId || '',
      addressIdCard: '', addressCurrent: c.addressCurrent || '',
      occupation: c.occupation || '', workplace: c.workplace || '',
    });
    setIsModalOpen(true);
  };

  const closeModal = () => { setIsModalOpen(false); setEditingCustomer(null); };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate(form);
  };

  const columns = [
    {
      key: 'name', label: 'ชื่อ-นามสกุล',
      render: (c: Customer) => (
        <button onClick={() => setDetailCustomer(c)} className="text-left hover:text-primary-600">
          <div className="font-medium text-gray-900">{c.name}</div>
          <div className="text-xs text-gray-500">{c.nationalId.replace(/(\d{1})(\d{4})(\d{5})(\d{2})(\d{1})/, '$1-$2-$3-$4-$5')}</div>
        </button>
      ),
    },
    { key: 'phone', label: 'โทรศัพท์', render: (c: Customer) => (
      <div>
        <div>{c.phone}</div>
        {c.phoneSecondary && <div className="text-xs text-gray-500">{c.phoneSecondary}</div>}
      </div>
    )},
    { key: 'occupation', label: 'อาชีพ', render: (c: Customer) => c.occupation || '-' },
    {
      key: 'contracts', label: 'สัญญา',
      render: (c: Customer) => (
        <div className="text-xs">
          {c.contracts.length === 0 ? <span className="text-gray-400">ยังไม่มี</span> :
            <span className="font-medium">{c.contracts.length} สัญญา</span>}
        </div>
      ),
    },
    {
      key: 'actions', label: '',
      render: (c: Customer) => (
        <button onClick={() => openEdit(c)} className="text-primary-600 hover:text-primary-700 text-sm font-medium">แก้ไข</button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="จัดการลูกค้า"
        subtitle={`ทั้งหมด ${customers.length} ราย`}
        action={
          <button onClick={openCreate} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors">
            + เพิ่มลูกค้า
          </button>
        }
      />

      <div className="mb-4">
        <input
          type="text" placeholder="ค้นหาชื่อ, โทรศัพท์, เลขบัตร..."
          value={search} onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-80 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
        />
      </div>

      <DataTable columns={columns} data={customers} isLoading={isLoading} />

      {/* Detail Modal */}
      <Modal isOpen={!!detailCustomer} onClose={() => setDetailCustomer(null)} title={`ข้อมูลลูกค้า: ${detailCustomer?.name || ''}`}>
        {detailCustomer && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-gray-500">เลขบัตร:</span> <span className="font-medium">{detailCustomer.nationalId}</span></div>
              <div><span className="text-gray-500">โทรศัพท์:</span> <span className="font-medium">{detailCustomer.phone}</span></div>
              {detailCustomer.lineId && <div><span className="text-gray-500">LINE:</span> <span className="font-medium">{detailCustomer.lineId}</span></div>}
              {detailCustomer.occupation && <div><span className="text-gray-500">อาชีพ:</span> <span className="font-medium">{detailCustomer.occupation}</span></div>}
              {detailCustomer.workplace && <div><span className="text-gray-500">ที่ทำงาน:</span> <span className="font-medium">{detailCustomer.workplace}</span></div>}
              {detailCustomer.addressCurrent && <div className="col-span-2"><span className="text-gray-500">ที่อยู่:</span> <span className="font-medium">{detailCustomer.addressCurrent}</span></div>}
            </div>
            {detailCustomer.contracts.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-2">สัญญาผ่อน</h4>
                <div className="space-y-2">
                  {detailCustomer.contracts.map((c) => (
                    <div key={c.id} className="flex justify-between items-center bg-gray-50 px-3 py-2 rounded-lg text-sm">
                      <span className="font-medium">{c.contractNumber}</span>
                      <span>{Number(c.sellingPrice).toLocaleString()} ฿</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{contractStatusLabels[c.status] || c.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Create/Edit Modal */}
      <Modal isOpen={isModalOpen} onClose={closeModal} title={editingCustomer ? 'แก้ไขลูกค้า' : 'เพิ่มลูกค้าใหม่'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">เลขบัตรประชาชน *</label>
              <input type="text" value={form.nationalId} onChange={(e) => setForm({ ...form, nationalId: e.target.value })}
                required disabled={!!editingCustomer} maxLength={13}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none disabled:bg-gray-100" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ชื่อ-นามสกุล *</label>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">โทรศัพท์ *</label>
              <input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">โทรศัพท์สำรอง</label>
              <input type="text" value={form.phoneSecondary} onChange={(e) => setForm({ ...form, phoneSecondary: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">LINE ID</label>
              <input type="text" value={form.lineId} onChange={(e) => setForm({ ...form, lineId: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">อาชีพ</label>
              <input type="text" value={form.occupation} onChange={(e) => setForm({ ...form, occupation: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ที่ทำงาน</label>
              <input type="text" value={form.workplace} onChange={(e) => setForm({ ...form, workplace: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ที่อยู่ปัจจุบัน</label>
            <textarea value={form.addressCurrent} onChange={(e) => setForm({ ...form, addressCurrent: e.target.value })} rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none" />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={closeModal} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">ยกเลิก</button>
            <button type="submit" disabled={saveMutation.isPending}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50">
              {saveMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
