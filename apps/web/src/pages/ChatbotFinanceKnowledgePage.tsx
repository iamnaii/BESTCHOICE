import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import { toast } from 'sonner';
import QueryBoundary from '@/components/QueryBoundary';

interface KbEntry {
  id: string;
  intent: string;
  category: string;
  triggerKeywords: string[];
  exampleQuestions: string[];
  responseTemplate: string;
  responseType: string;
  requiresAuth: boolean;
  active: boolean;
  priority: number;
}

type FormState = Omit<KbEntry, 'id'>;

const EMPTY_FORM: FormState = {
  intent: '',
  category: '',
  triggerKeywords: [],
  exampleQuestions: [],
  responseTemplate: '',
  responseType: 'auto',
  requiresAuth: true,
  active: true,
  priority: 0,
};

export default function ChatbotFinanceKnowledgePage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<KbEntry | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [isCreating, setIsCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);

  const list = useQuery<KbEntry[]>({
    queryKey: ['chatbot-finance-kb'],
    queryFn: async () => {
      const { data } = await api.get<KbEntry[]>('/chatbot/finance/admin/knowledge');
      return data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editing) {
        await api.patch(`/chatbot/finance/admin/knowledge/${editing.id}`, form);
      } else {
        await api.post('/chatbot/finance/admin/knowledge', form);
      }
    },
    onSuccess: () => {
      toast.success('บันทึกแล้ว');
      queryClient.invalidateQueries({ queryKey: ['chatbot-finance-kb'] });
      reset();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/chatbot/finance/admin/knowledge/${id}`);
    },
    onSuccess: () => {
      toast.success('ลบแล้ว');
      queryClient.invalidateQueries({ queryKey: ['chatbot-finance-kb'] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  function startEdit(entry: KbEntry) {
    setEditing(entry);
    setIsCreating(false);
    setForm({
      intent: entry.intent,
      category: entry.category,
      triggerKeywords: entry.triggerKeywords,
      exampleQuestions: entry.exampleQuestions,
      responseTemplate: entry.responseTemplate,
      responseType: entry.responseType,
      requiresAuth: entry.requiresAuth,
      active: entry.active,
      priority: entry.priority,
    });
  }

  function startCreate() {
    setEditing(null);
    setIsCreating(true);
    setForm(EMPTY_FORM);
  }

  function reset() {
    setEditing(null);
    setIsCreating(false);
    setForm(EMPTY_FORM);
    setPendingDelete(false);
  }

  function startEditWithReset(entry: KbEntry) {
    setPendingDelete(false);
    startEdit(entry);
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-xl font-bold">Finance Bot — Knowledge Base</h1>
        <button
          onClick={startCreate}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
        >
          + เพิ่ม FAQ
        </button>
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* List */}
        <div className="col-span-5 space-y-2">
          <QueryBoundary
            isLoading={list.isLoading && !list.data}
            isError={list.isError}
            error={list.error}
            onRetry={list.refetch}
            errorTitle="ไม่สามารถโหลด Knowledge Base ได้"
          >
          {list.data?.length === 0 ? (
            <p className="text-sm text-gray-400">ยังไม่มี FAQ</p>
          ) : (
            list.data?.map((kb) => (
              <div
                key={kb.id}
                className={`p-3 border rounded-lg cursor-pointer hover:bg-gray-50 ${editing?.id === kb.id ? 'border-blue-400 bg-blue-50' : 'bg-white'}`}
                onClick={() => startEditWithReset(kb)}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-semibold text-sm">{kb.intent}</p>
                    <p className="text-xs text-gray-500">{kb.category}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${kb.responseType === 'handoff' ? 'bg-orange-100 text-orange-700' : kb.responseType === 'info' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                      {kb.responseType}
                    </span>
                    {!kb.active && (
                      <span className="text-[10px] px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">inactive</span>
                    )}
                  </div>
                </div>
                <p className="text-xs text-gray-400 mt-1 line-clamp-2">{kb.responseTemplate}</p>
              </div>
            ))
          )}
          </QueryBoundary>
        </div>

        {/* Form */}
        <div className="col-span-7 bg-white border rounded-xl p-4">
          {!isCreating && !editing ? (
            <p className="text-gray-400 text-sm">เลือก FAQ จากด้านซ้ายเพื่อแก้ไข หรือกด "+ เพิ่ม FAQ"</p>
          ) : (
            <form
              onSubmit={(e) => { e.preventDefault(); saveMutation.mutate(); }}
              className="space-y-3"
            >
              <h2 className="font-bold">{editing ? 'แก้ไข FAQ' : 'เพิ่ม FAQ ใหม่'}</h2>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-600">Intent (ID ภาษาอังกฤษ)</label>
                  <input
                    type="text"
                    value={form.intent}
                    onChange={(e) => setForm({ ...form, intent: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm mt-1"
                    placeholder="e.g. request_deferral"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-600">Category</label>
                  <input
                    type="text"
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm mt-1"
                    placeholder="e.g. payment"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-600">Trigger Keywords (คั่นด้วย comma)</label>
                <input
                  type="text"
                  value={form.triggerKeywords.join(', ')}
                  onChange={(e) => setForm({ ...form, triggerKeywords: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                  className="w-full px-3 py-2 border rounded-lg text-sm mt-1"
                  placeholder="ขอเลื่อน, ไม่ทัน, ไม่มีจ่าย"
                />
              </div>

              <div>
                <label className="text-xs text-gray-600">Example Questions (1 บรรทัด/คำถาม)</label>
                <textarea
                  value={form.exampleQuestions.join('\n')}
                  onChange={(e) => setForm({ ...form, exampleQuestions: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })}
                  className="w-full px-3 py-2 border rounded-lg text-sm mt-1 font-mono"
                  rows={3}
                  placeholder={'ขอเลื่อนงวดนี้ได้ไหม\nจ่ายไม่ทัน รอเงินเดือน'}
                />
              </div>

              <div>
                <label className="text-xs text-gray-600">Response Template</label>
                <textarea
                  value={form.responseTemplate}
                  onChange={(e) => setForm({ ...form, responseTemplate: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm mt-1 font-mono"
                  rows={6}
                  required
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-gray-600">Response Type</label>
                  <select
                    value={form.responseType}
                    onChange={(e) => setForm({ ...form, responseType: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm mt-1"
                  >
                    <option value="auto">auto (bot ตอบได้)</option>
                    <option value="info">info (อธิบาย)</option>
                    <option value="handoff">handoff (ส่งต่อคน)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-600">Priority</label>
                  <input
                    type="number"
                    value={form.priority}
                    onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
                    className="w-full px-3 py-2 border rounded-lg text-sm mt-1"
                  />
                </div>
                <div className="flex flex-col text-xs text-gray-600 mt-1">
                  <label className="flex items-center gap-2 mt-2">
                    <input
                      type="checkbox"
                      checked={form.active}
                      onChange={(e) => setForm({ ...form, active: e.target.checked })}
                    />
                    Active
                  </label>
                  <label className="flex items-center gap-2 mt-1">
                    <input
                      type="checkbox"
                      checked={form.requiresAuth}
                      onChange={(e) => setForm({ ...form, requiresAuth: e.target.checked })}
                    />
                    Requires Auth
                  </label>
                </div>
              </div>

              <div className="flex gap-2 pt-3 border-t">
                <button
                  type="submit"
                  disabled={saveMutation.isPending}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
                >
                  {saveMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
                {editing && !pendingDelete && (
                  <button
                    type="button"
                    onClick={() => setPendingDelete(true)}
                    className="px-4 py-2 border border-red-300 text-red-600 rounded-lg text-sm hover:bg-red-50"
                  >
                    ลบ
                  </button>
                )}
                {editing && pendingDelete && (
                  <>
                    <button
                      type="button"
                      onClick={() => { deleteMutation.mutate(editing.id); setPendingDelete(false); }}
                      disabled={deleteMutation.isPending}
                      className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 disabled:opacity-50"
                    >
                      ยืนยันลบ
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDelete(false)}
                      className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50"
                    >
                      ไม่ลบ
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={reset}
                  className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50"
                >
                  ยกเลิก
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
