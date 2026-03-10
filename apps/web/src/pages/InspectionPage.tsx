import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';

interface Inspection {
  id: string;
  overallGrade: string | null;
  gradeOverride: string | null;
  isCompleted: boolean;
  inspectedAt: string | null;
  createdAt: string;
  notes: string | null;
  template: { id: string; name: string };
  inspector: { id: string; name: string };
  products: { id: string; name: string; brand: string; model: string; imeiSerial: string | null }[];
}

interface Template {
  id: string;
  name: string;
  deviceType: string;
  isActive: boolean;
}

export default function InspectionPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('');
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [newForm, setNewForm] = useState({ productId: '', templateId: '' });

  const { data: inspections = [], isLoading } = useQuery<Inspection[]>({
    queryKey: ['inspections', filter],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (filter) params.isCompleted = filter;
      const { data } = await api.get('/inspections', { params });
      return data;
    },
  });

  const { data: templates = [] } = useQuery<Template[]>({
    queryKey: ['inspection-templates'],
    queryFn: async () => {
      const { data } = await api.get('/inspection-templates');
      return data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => api.post('/inspections', newForm),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['inspections'] });
      toast.success('เริ่มตรวจเช็คสำเร็จ');
      setIsNewModalOpen(false);
      navigate(`/inspections/${res.data.id}`);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const columns = [
    {
      key: 'product',
      label: 'สินค้า',
      render: (i: Inspection) => (
        <button onClick={() => navigate(`/inspections/${i.id}`)} className="text-left hover:underline">
          <div className="text-primary-600 font-medium">
            {i.products[0]?.brand} {i.products[0]?.model}
          </div>
          {i.products[0]?.imeiSerial && (
            <div className="text-xs text-gray-400 font-mono">{i.products[0].imeiSerial}</div>
          )}
        </button>
      ),
    },
    { key: 'template', label: 'Template', render: (i: Inspection) => <span className="text-sm">{i.template.name}</span> },
    {
      key: 'grade',
      label: 'เกรด',
      render: (i: Inspection) => {
        const grade = i.gradeOverride || i.overallGrade;
        if (!grade) return <span className="text-gray-400">-</span>;
        const colors: Record<string, string> = { A: 'bg-green-100 text-green-700', B: 'bg-primary-100 text-primary-700', C: 'bg-yellow-100 text-yellow-700', D: 'bg-red-100 text-red-700' };
        return (
          <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${colors[grade] || 'bg-gray-100'}`}>
            {grade} {i.gradeOverride ? '(override)' : ''}
          </span>
        );
      },
    },
    {
      key: 'isCompleted',
      label: 'สถานะ',
      render: (i: Inspection) => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${i.isCompleted ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
          {i.isCompleted ? 'ตรวจเสร็จ' : 'กำลังตรวจ'}
        </span>
      ),
    },
    { key: 'inspector', label: 'ผู้ตรวจ', render: (i: Inspection) => <span className="text-xs">{i.inspector.name}</span> },
    {
      key: 'date',
      label: 'วันที่',
      render: (i: Inspection) => (
        <span className="text-xs">{new Date(i.inspectedAt || i.createdAt).toLocaleDateString('th-TH')}</span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="ตรวจเช็คมือถือ"
        subtitle={`ทั้งหมด ${inspections.length} รายการ`}
        action={
          <button onClick={() => setIsNewModalOpen(true)} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700">
            + เริ่มตรวจเช็ค
          </button>
        }
      />

      <div className="flex gap-3 mb-4">
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none">
          <option value="">ทั้งหมด</option>
          <option value="false">กำลังตรวจ</option>
          <option value="true">ตรวจเสร็จ</option>
        </select>
      </div>

      <DataTable columns={columns} data={inspections} isLoading={isLoading} emptyMessage="ไม่มีรายการตรวจ" />

      <Modal isOpen={isNewModalOpen} onClose={() => setIsNewModalOpen(false)} title="เริ่มตรวจเช็คสินค้า">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Product ID *</label>
            <input
              type="text"
              value={newForm.productId}
              onChange={(e) => setNewForm({ ...newForm, productId: e.target.value })}
              placeholder="ระบุ ID สินค้า"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Template *</label>
            <select
              value={newForm.templateId}
              onChange={(e) => setNewForm({ ...newForm, templateId: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none text-sm"
              required
            >
              <option value="">เลือก Template</option>
              {templates.filter((t) => t.isActive).map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({t.deviceType})</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setIsNewModalOpen(false)} className="px-4 py-2 text-sm text-gray-600">ยกเลิก</button>
            <button
              onClick={() => createMutation.mutate()}
              disabled={!newForm.productId || !newForm.templateId || createMutation.isPending}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
            >
              เริ่มตรวจ
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
