import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import RichTextEditor from '@/components/ui/RichTextEditor';
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
    items: ['{contract_number}', '{contract_date}', '{contract_date_day}', '{contract_date_month}', '{contract_date_year}', '{date}'],
  },
  {
    label: 'ลูกค้า',
    items: ['{customer_prefix}', '{customer_name}', '{national_id}', '{customer_phone}', '{customer_phone_secondary}', '{customer_address}', '{customer_address_id_card}', '{customer_address_current}', '{customer_zipcode}', '{customer_line_id}', '{customer_facebook}', '{customer_occupation}', '{customer_salary}', '{customer_workplace}', '{customer_address_work}', '{customer_references}'],
  },
  {
    label: 'สินค้า',
    items: ['{product_name}', '{brand}', '{model}', '{imei}', '{serial_number}', '{product_color}', '{product_storage}', '{product_category}'],
  },
  {
    label: 'การเงิน',
    items: ['{selling_price}', '{down_payment}', '{monthly_payment}', '{total_months}', '{total_months_text}', '{interest_rate}', '{interest_total}', '{financed_amount}', '{financed_amount_text}'],
  },
  {
    label: 'งวดชำระ',
    items: ['{payment_schedule_table}', '{first_payment_due}', '{first_payment_day}', '{first_payment_month}', '{first_payment_year}', '{last_payment_due}'],
  },
  {
    label: 'สาขา/พนักงาน',
    items: ['{branch_name}', '{branch_address}', '{branch_phone}', '{salesperson_name}'],
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

  const insertPlaceholder = useCallback((placeholder: string) => {
    // Insert placeholder at cursor in the contentEditable editor
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      // Check if selection is inside the editor
      const editorEl = document.querySelector('[contenteditable="true"]');
      if (editorEl && editorEl.contains(range.commonAncestorContainer)) {
        range.deleteContents();
        const textNode = document.createTextNode(placeholder);
        range.insertNode(textNode);
        // Move cursor after inserted text
        range.setStartAfter(textNode);
        range.setEndAfter(textNode);
        sel.removeAllRanges();
        sel.addRange(range);
        // Trigger change
        editorEl.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
    }
    // Fallback: append to end
    setForm(prev => ({ ...prev, contentHtml: prev.contentHtml + placeholder }));
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
                    <span className="text-sm text-purple-700">AI กำลังสร้าง...</span>
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

            {/* Row 2: Rich Text Editor + Placeholder sidebar */}
            <div className="grid grid-cols-[1fr_220px] gap-3" style={{ minHeight: '450px' }}>
              {/* Left: WYSIWYG Editor */}
              <div className="flex flex-col min-w-0">
                <RichTextEditor
                  value={form.contentHtml}
                  onChange={(html) => setForm(prev => ({ ...prev, contentHtml: html }))}
                  placeholder="พิมพ์เนื้อหาสัญญาที่นี่ หรือลากไฟล์มาวางเพื่อให้ AI สร้างให้..."
                  minHeight="420px"
                  onFileDrop={processFile}
                />
              </div>

              {/* Right: Placeholder panel */}
              <div className="flex flex-col">
                <label className="text-sm font-medium text-gray-700 mb-1">ตัวแปร</label>
                <div className="flex-1 border border-gray-200 rounded-lg p-2.5 overflow-auto bg-gray-50">
                  {/* Detected placeholders */}
                  {detectedPlaceholders.length > 0 && (
                    <div className="mb-2.5 pb-2 border-b border-gray-200">
                      <div className="text-xs font-medium text-green-700 mb-1">
                        ใช้แล้ว ({detectedPlaceholders.length})
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {detectedPlaceholders.map((p) => (
                          <span key={p} className="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-800 rounded cursor-pointer hover:bg-green-200" onClick={() => insertPlaceholder(p)}>{p}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Grouped placeholders */}
                  <div className="space-y-2">
                    {PLACEHOLDER_GROUPS.map((group) => (
                      <div key={group.label}>
                        <div className="text-[10px] font-semibold text-gray-500 mb-0.5 uppercase">{group.label}</div>
                        <div className="flex flex-wrap gap-0.5">
                          {group.items.map((p) => {
                            const isUsed = detectedPlaceholders.includes(p);
                            return (
                              <button
                                key={p}
                                type="button"
                                onClick={() => insertPlaceholder(p)}
                                title={isUsed ? 'ใช้แล้ว (กดเพื่อเพิ่มอีก)' : 'กดเพื่อแทรกที่ตำแหน่ง cursor'}
                                className={`text-[10px] px-1 py-0.5 rounded transition-colors ${isUsed ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-white text-gray-600 border border-gray-200 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200'}`}
                              >
                                {p.replace(/[{}]/g, '')}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
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
