import { useState, useRef, useCallback } from 'react';
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

const PLACEHOLDER_GROUPS = [
  {
    label: 'สัญญา',
    items: ['{contract_number}', '{contract_date}', '{date}'],
  },
  {
    label: 'ลูกค้า',
    items: ['{customer_name}', '{national_id}', '{customer_phone}', '{customer_address}'],
  },
  {
    label: 'สินค้า',
    items: ['{product_name}', '{brand}', '{model}', '{imei}', '{serial_number}'],
  },
  {
    label: 'การเงิน',
    items: ['{selling_price}', '{down_payment}', '{monthly_payment}', '{total_months}', '{interest_rate}', '{interest_total}', '{financed_amount}'],
  },
  {
    label: 'งวดชำระ',
    items: ['{payment_schedule_table}', '{first_payment_due}', '{last_payment_due}'],
  },
  {
    label: 'สาขา/พนักงาน',
    items: ['{branch_name}', '{salesperson_name}'],
  },
  {
    label: 'ลายเซ็น',
    items: ['{customer_signature}', '{staff_signature}'],
  },
];

export default function ContractTemplatesPage() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [detectedPlaceholders, setDetectedPlaceholders] = useState<string[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
    setShowPreview(false);
    setShowModal(true);
  };

  const openEdit = (t: Template) => {
    setEditing(t);
    setForm({ name: t.name, type: 'STORE_DIRECT' as const, contentHtml: t.contentHtml });
    setDetectedPlaceholders(t.placeholders || []);
    setShowPreview(false);
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

  const insertPlaceholder = useCallback((placeholder: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setForm(prev => ({ ...prev, contentHtml: prev.contentHtml + placeholder }));
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    setForm(prev => ({
      ...prev,
      contentHtml: prev.contentHtml.slice(0, start) + placeholder + prev.contentHtml.slice(end),
    }));
    // Restore cursor position after React re-render
    requestAnimationFrame(() => {
      textarea.selectionStart = textarea.selectionEnd = start + placeholder.length;
      textarea.focus();
    });
  }, []);

  const processFile = useCallback(async (file: File) => {
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

      const { data } = await api.post('/contract-templates/generate-from-file', { fileBase64: base64 }, { timeout: 180000 });
      setForm(prev => ({ ...prev, contentHtml: data.contentHtml }));
      setDetectedPlaceholders(data.placeholders || []);
      setShowPreview(true);
      toast.success(`AI สร้างเทมเพลตสำเร็จ (ใส่ ${data.placeholders?.length || 0} ตัวแปร)`);
    } catch (err: any) {
      const code = (err as { code?: string }).code;
      if (code === 'ECONNABORTED') {
        toast.error('AI ใช้เวลานานเกินไป — ลองใช้ไฟล์ขนาดเล็กลง หรือใช้รูปภาพแทน PDF');
      } else {
        toast.error(getErrorMessage(err));
      }
    } finally {
      setIsGenerating(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

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
    { key: 'placeholders', label: 'ตัวแปร', render: (t: Template) => <span className="text-xs text-gray-500">{t.placeholders.length} รายการ</span> },
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
        <Modal isOpen title={editing ? 'แก้ไขเทมเพลต' : 'สร้างเทมเพลตใหม่'} onClose={closeModal} size="xl">
          <div className="space-y-4">
            {/* Row 1: ชื่อ + AI Upload */}
            <div className="flex gap-4 items-start">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">ชื่อเทมเพลต</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="เช่น สัญญาผ่อนชำระ มาตรฐาน"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
              <div className="flex-shrink-0">
                <label className="block text-sm font-medium text-gray-700 mb-1">สร้างด้วย AI</label>
                {isGenerating ? (
                  <div className="flex items-center gap-2 px-3 py-2 bg-purple-50 rounded-lg">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-purple-600"></div>
                    <span className="text-sm text-purple-700">กำลังสร้าง...</span>
                  </div>
                ) : (
                  <label className="inline-flex items-center gap-1.5 px-3 py-2 bg-purple-50 text-purple-700 text-sm font-medium rounded-lg cursor-pointer hover:bg-purple-100 transition-colors">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                    อัปโหลดเอกสาร
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f); e.target.value = ''; }}
                    />
                  </label>
                )}
              </div>
            </div>

            {/* Row 2: Editor + Preview (2 columns) */}
            <div className="grid grid-cols-2 gap-4" style={{ minHeight: '400px' }}>
              {/* Left: HTML Editor */}
              <div className="flex flex-col">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-medium text-gray-700">HTML</label>
                  <button
                    type="button"
                    onClick={() => setShowPreview(p => !p)}
                    className="text-xs text-primary-600 hover:text-primary-700"
                  >
                    {showPreview ? 'ซ่อนตัวอย่าง' : 'ดูตัวอย่าง'}
                  </button>
                </div>
                <div
                  className={`relative flex-1 ${isDragging ? 'ring-2 ring-purple-400 ring-offset-2 rounded-lg' : ''}`}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                >
                  <textarea
                    ref={textareaRef}
                    value={form.contentHtml}
                    onChange={(e) => setForm(prev => ({ ...prev, contentHtml: e.target.value }))}
                    className="w-full h-full min-h-[380px] px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono resize-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    placeholder="วาง HTML ที่นี่ หรือลากไฟล์มาวางเพื่อให้ AI สร้างให้"
                    spellCheck={false}
                  />
                  {isDragging && (
                    <div className="absolute inset-0 bg-purple-50/90 border-2 border-dashed border-purple-400 rounded-lg flex items-center justify-center">
                      <div className="text-center">
                        <svg className="w-8 h-8 text-purple-500 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                        <p className="text-sm font-medium text-purple-700">วางไฟล์ที่นี่เพื่อสร้างเทมเพลตด้วย AI</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Right: Preview */}
              {showPreview ? (
                <div className="flex flex-col">
                  <label className="text-sm font-medium text-gray-700 mb-1">ตัวอย่าง</label>
                  <div
                    className="flex-1 border border-gray-200 rounded-lg p-4 overflow-auto bg-white min-h-[380px]"
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(form.contentHtml) }}
                  />
                </div>
              ) : (
                <div className="flex flex-col">
                  <label className="text-sm font-medium text-gray-700 mb-1">ตัวแปรที่ใช้ได้</label>
                  <div className="flex-1 border border-gray-200 rounded-lg p-3 overflow-auto bg-gray-50 min-h-[380px]">
                    {/* Detected placeholders */}
                    {detectedPlaceholders.length > 0 && (
                      <div className="mb-3 pb-3 border-b border-gray-200">
                        <div className="text-xs font-medium text-green-700 mb-1.5">
                          ใช้ในเทมเพลตแล้ว ({detectedPlaceholders.length})
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {detectedPlaceholders.map((p) => (
                            <span key={p} className="text-xs px-1.5 py-0.5 bg-green-100 text-green-800 rounded">{p}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Grouped placeholders */}
                    <div className="space-y-2.5">
                      {PLACEHOLDER_GROUPS.map((group) => (
                        <div key={group.label}>
                          <div className="text-xs font-medium text-gray-500 mb-1">{group.label}</div>
                          <div className="flex flex-wrap gap-1">
                            {group.items.map((p) => {
                              const isUsed = detectedPlaceholders.includes(p);
                              return (
                                <button
                                  key={p}
                                  type="button"
                                  onClick={() => insertPlaceholder(p)}
                                  title={isUsed ? 'ใช้แล้ว (กดเพื่อเพิ่มอีก)' : 'กดเพื่อแทรกที่ตำแหน่ง cursor'}
                                  className={`text-xs px-1.5 py-0.5 rounded transition-colors ${isUsed ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-white text-gray-700 border border-gray-200 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200'}`}
                                >
                                  {p}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Row 3: Actions */}
            <div className="flex items-center gap-3 pt-1 border-t border-gray-100">
              <span className="text-xs text-gray-400">
                {form.contentHtml.length > 0 ? `${form.contentHtml.length.toLocaleString()} ตัวอักษร` : 'ยังไม่มีเนื้อหา'}
              </span>
              <div className="flex-1" />
              <button onClick={closeModal} className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
                ยกเลิก
              </button>
              <button
                onClick={handleSave}
                disabled={saveMutation.isPending || !form.name || !form.contentHtml}
                className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
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
