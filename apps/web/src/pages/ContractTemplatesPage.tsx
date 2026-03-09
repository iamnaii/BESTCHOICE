import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import DOMPurify from 'dompurify';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import toast from 'react-hot-toast';

interface Template {
  id: string;
  name: string;
  type: string;
  contentHtml: string;
  placeholders: string[];
  isActive: boolean;
  createdAt: string;
}

const AVAILABLE_PLACEHOLDERS = [
  '{contract_number}', '{customer_name}', '{national_id}', '{customer_phone}', '{customer_address}',
  '{product_name}', '{brand}', '{model}', '{imei}', '{serial_number}',
  '{selling_price}', '{down_payment}', '{monthly_payment}', '{total_months}',
  '{interest_rate}', '{interest_total}', '{financed_amount}',
  '{branch_name}', '{salesperson_name}', '{date}',
  '{payment_schedule_table}', '{customer_signature}', '{staff_signature}',
];

export default function ContractTemplatesPage() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [detectedPlaceholders, setDetectedPlaceholders] = useState<string[]>([]);

  const [form, setForm] = useState({
    name: '',
    type: 'STORE_DIRECT' as const,
    contentHtml: '',
  });

  const { data: templates = [], isLoading, isError, error, refetch } = useQuery<Template[]>({
    queryKey: ['contract-templates'],
    queryFn: async () => { const { data } = await api.get('/contract-templates'); return data; },
  });

  const saveMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      if (editing) {
        const { data } = await api.patch(`/contract-templates/${editing.id}`, body);
        return data;
      }
      const { data } = await api.post('/contract-templates', body);
      return data;
    },
    onSuccess: () => {
      toast.success(editing ? 'อัปเดตเทมเพลตสำเร็จ' : 'สร้างเทมเพลตสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['contract-templates'] });
      closeModal();
    },
    onError: (err: any) => toast.error(getErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await api.delete(`/contract-templates/${id}`); },
    onSuccess: () => {
      toast.success('ปิดใช้งานเทมเพลตแล้ว');
      queryClient.invalidateQueries({ queryKey: ['contract-templates'] });
    },
    onError: (err: any) => toast.error(getErrorMessage(err)),
  });

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', type: 'STORE_DIRECT' as const, contentHtml: '' });
    setDetectedPlaceholders([]);
    setShowModal(true);
  };

  const openEdit = (t: Template) => {
    setEditing(t);
    setForm({ name: t.name, type: 'STORE_DIRECT' as const, contentHtml: t.contentHtml });
    setDetectedPlaceholders(t.placeholders || []);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditing(null);
  };

  const handleSave = () => {
    if (!form.name || !form.contentHtml) { toast.error('กรุณากรอกข้อมูลให้ครบ'); return; }
    saveMutation.mutate(form);
  };

  const handlePreview = () => {
    setPreviewHtml(form.contentHtml);
    setShowPreview(true);
  };

  const handleGenerateFromFile = async (file: File) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowedTypes.includes(file.type)) {
      toast.error('รองรับเฉพาะไฟล์ JPG, PNG, WebP หรือ PDF');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('ไฟล์ต้องมีขนาดไม่เกิน 10MB');
      return;
    }

    setIsGenerating(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const { data } = await api.post('/contract-templates/generate-from-file', { fileBase64: base64 }, { timeout: 120000 });
      setForm(prev => ({ ...prev, contentHtml: data.contentHtml }));
      setDetectedPlaceholders(data.placeholders || []);
      toast.success(`AI สร้างเทมเพลตสำเร็จ (ใส่ ${data.placeholders?.length || 0} ตัวแปร) กรุณาตรวจสอบก่อนบันทึก`);
    } catch (err: any) {
      toast.error(getErrorMessage(err));
    } finally {
      setIsGenerating(false);
    }
  };

  const columns = [
    { key: 'name', label: 'ชื่อเทมเพลต', render: (t: Template) => <span className="font-medium text-sm">{t.name}</span> },
    { key: 'type', label: 'ประเภท', render: () => <span className="text-xs px-2 py-0.5 bg-gray-100 rounded">ผ่อนกับ BESTCHOICE</span> },
    {
      key: 'isActive',
      label: 'สถานะ',
      render: (t: Template) => (
        <span className={`text-xs px-2 py-0.5 rounded-full ${t.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
          {t.isActive ? 'ใช้งาน' : 'ปิดใช้งาน'}
        </span>
      ),
    },
    { key: 'placeholders', label: 'Placeholders', render: (t: Template) => <span className="text-xs text-gray-500">{t.placeholders.length} รายการ</span> },
    { key: 'createdAt', label: 'สร้างเมื่อ', render: (t: Template) => <span className="text-xs">{new Date(t.createdAt).toLocaleDateString('th-TH')}</span> },
    {
      key: 'actions',
      label: '',
      render: (t: Template) => (
        <div className="flex gap-2">
          <button onClick={() => openEdit(t)} className="text-xs text-primary-600 hover:underline">แก้ไข</button>
          {t.isActive && <button onClick={() => { if (confirm('ต้องการปิดใช้งานเทมเพลตนี้?')) deleteMutation.mutate(t.id); }} className="text-xs text-red-600 hover:underline">ปิดใช้งาน</button>}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="เทมเพลตสัญญา"
        subtitle="จัดการเทมเพลต HTML สำหรับสร้างเอกสารสัญญา"
        action={
          <button onClick={openCreate} className="px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700">
            + สร้างเทมเพลต
          </button>
        }
      />

      {isLoading ? (
        <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>
      ) : isError ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
          <p className="text-red-700 font-medium mb-2">ไม่สามารถโหลดเทมเพลตได้</p>
          <p className="text-red-600 text-sm mb-4">{getErrorMessage(error)}</p>
          <button onClick={() => refetch()} className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700">
            ลองใหม่
          </button>
        </div>
      ) : (
        <DataTable columns={columns} data={templates} emptyMessage="ยังไม่มีเทมเพลต กรุณาสร้างเทมเพลตใหม่" />
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <Modal isOpen title={editing ? 'แก้ไขเทมเพลต' : 'สร้างเทมเพลตใหม่'} onClose={closeModal}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ชื่อเทมเพลต</label>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>


            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">สร้างจากไฟล์ด้วย AI</label>
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center hover:border-primary-400 transition-colors">
                {isGenerating ? (
                  <div className="flex items-center justify-center gap-2 py-2">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary-600"></div>
                    <span className="text-sm text-gray-600">AI กำลังอ่านเอกสารและสร้างเทมเพลต...</span>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-gray-500 mb-2">แนบไฟล์เอกสาร (รูปภาพ หรือ PDF) แล้ว AI จะสร้างเทมเพลตให้</p>
                    <label className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-purple-50 text-purple-700 text-sm font-medium rounded-lg cursor-pointer hover:bg-purple-100">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                      เลือกไฟล์เอกสาร
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,application/pdf"
                        className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleGenerateFromFile(f); e.target.value = ''; }}
                      />
                    </label>
                    <p className="text-xs text-gray-400 mt-1">รองรับ JPG, PNG, WebP, PDF (ไม่เกิน 10MB)</p>
                  </>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">เนื้อหา HTML</label>
              <textarea
                value={form.contentHtml}
                onChange={(e) => setForm({ ...form, contentHtml: e.target.value })}
                rows={12}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono"
                placeholder="<div>...</div>"
              />
            </div>

            {detectedPlaceholders.length > 0 && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                <div className="text-xs font-medium text-green-700 mb-1.5">Placeholders ที่ใช้ในเทมเพลต ({detectedPlaceholders.length} รายการ):</div>
                <div className="flex flex-wrap gap-1">
                  {detectedPlaceholders.map((p) => (
                    <span key={p} className="text-xs px-1.5 py-0.5 bg-green-100 text-green-800 rounded">{p}</span>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="text-xs font-medium text-gray-500 mb-1">Placeholders ที่ใช้ได้ทั้งหมด:</div>
              <div className="flex flex-wrap gap-1">
                {AVAILABLE_PLACEHOLDERS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setForm(prev => ({ ...prev, contentHtml: prev.contentHtml + p }))}
                    className={`text-xs px-1.5 py-0.5 rounded hover:bg-blue-100 ${detectedPlaceholders.includes(p) ? 'bg-green-100 text-green-700' : 'bg-blue-50 text-blue-700'}`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button onClick={handlePreview} className="px-4 py-2 text-sm border border-gray-300 rounded-lg">ดูตัวอย่าง</button>
              <div className="flex-1" />
              <button onClick={closeModal} className="px-4 py-2 text-sm border border-gray-300 rounded-lg">ยกเลิก</button>
              <button onClick={handleSave} disabled={saveMutation.isPending} className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">
                {saveMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Preview Modal */}
      {showPreview && (
        <Modal isOpen title="ตัวอย่างเทมเพลต" onClose={() => setShowPreview(false)}>
          <div className="border rounded-lg p-4 max-h-[60vh] overflow-auto" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(previewHtml) }} />
        </Modal>
      )}
    </div>
  );
}
