import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import { toast } from 'sonner';
import QueryBoundary from '@/components/QueryBoundary';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { getStatusBadgeProps, kbResponseTypeMap, kbSuggestionStatusMap } from '@/lib/status-badges';
import { formatDateMedium } from '@/utils/formatters';

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

// ─── KB Suggestion types ──────────────────────────────────

interface KbSuggestion {
  id: string;
  roomId: string;
  customerQuestion: string;
  staffAnswer: string | null;
  suggestedIntent: string;
  suggestedKeywords: string[];
  suggestedTemplate: string | null;
  source: 'handoff' | 'low_rating' | 'auto_analysis';
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewedById: string | null;
  reviewedAt: string | null;
  kbEntryId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SuggestionsResponse {
  items: KbSuggestion[];
  total: number;
  page: number;
  limit: number;
}

// ─── Knowledge Base Tab ───────────────────────────────────

function KnowledgeBaseTab() {
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
    <>
      <div className="flex justify-end mb-4">
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
            <p className="text-sm text-muted-foreground">ยังไม่มี FAQ</p>
          ) : (
            list.data?.map((kb) => (
              <div
                key={kb.id}
                className={`p-3 border rounded-lg cursor-pointer hover:bg-muted/50 ${editing?.id === kb.id ? 'border-blue-400 bg-blue-50' : 'bg-card'}`}
                onClick={() => startEditWithReset(kb)}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-semibold text-sm">{kb.intent}</p>
                    <p className="text-xs text-muted-foreground">{kb.category}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {(() => {
                      const cfg = getStatusBadgeProps(kb.responseType, kbResponseTypeMap);
                      return (
                        <Badge variant={cfg.variant} appearance={cfg.appearance} className="text-[10px] px-2 py-0.5">
                          {kb.responseType}
                        </Badge>
                      );
                    })()}
                    {!kb.active && (
                      <Badge variant="secondary" className="text-[10px] px-2 py-0.5">inactive</Badge>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{kb.responseTemplate}</p>
              </div>
            ))
          )}
          </QueryBoundary>
        </div>

        {/* Form */}
        <div className="col-span-7 bg-card border rounded-xl p-4">
          {!isCreating && !editing ? (
            <p className="text-muted-foreground text-sm">เลือก FAQ จากด้านซ้ายเพื่อแก้ไข หรือกด "+ เพิ่ม FAQ"</p>
          ) : (
            <form
              onSubmit={(e) => { e.preventDefault(); saveMutation.mutate(); }}
              className="space-y-3"
            >
              <h2 className="font-bold">{editing ? 'แก้ไข FAQ' : 'เพิ่ม FAQ ใหม่'}</h2>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Intent (ID ภาษาอังกฤษ)</label>
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
                  <label className="text-xs text-muted-foreground">Category</label>
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
                <label className="text-xs text-muted-foreground">Trigger Keywords (คั่นด้วย comma)</label>
                <input
                  type="text"
                  value={form.triggerKeywords.join(', ')}
                  onChange={(e) => setForm({ ...form, triggerKeywords: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                  className="w-full px-3 py-2 border rounded-lg text-sm mt-1"
                  placeholder="ขอเลื่อน, ไม่ทัน, ไม่มีจ่าย"
                />
              </div>

              <div>
                <label className="text-xs text-muted-foreground">Example Questions (1 บรรทัด/คำถาม)</label>
                <textarea
                  value={form.exampleQuestions.join('\n')}
                  onChange={(e) => setForm({ ...form, exampleQuestions: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })}
                  className="w-full px-3 py-2 border rounded-lg text-sm mt-1 font-mono"
                  rows={3}
                  placeholder={'ขอเลื่อนงวดนี้ได้ไหม\nจ่ายไม่ทัน รอเงินเดือน'}
                />
              </div>

              <div>
                <label className="text-xs text-muted-foreground">Response Template</label>
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
                  <label className="text-xs text-muted-foreground">Response Type</label>
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
                  <label className="text-xs text-muted-foreground">Priority</label>
                  <input
                    type="number"
                    value={form.priority}
                    onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
                    className="w-full px-3 py-2 border rounded-lg text-sm mt-1"
                  />
                </div>
                <div className="flex flex-col text-xs text-muted-foreground mt-1">
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
                      className="px-4 py-2 border border-border text-foreground/70 rounded-lg text-sm hover:bg-muted"
                    >
                      ไม่ลบ
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={reset}
                  className="px-4 py-2 border border-border text-foreground/70 rounded-lg text-sm hover:bg-muted"
                >
                  ยกเลิก
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Suggestions Tab ──────────────────────────────────────

const SOURCE_LABELS: Record<string, string> = {
  handoff: 'ส่งต่อพนักงาน',
  low_rating: 'คะแนนต่ำ',
  auto_analysis: 'วิเคราะห์อัตโนมัติ',
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'รอตรวจสอบ',
  APPROVED: 'อนุมัติแล้ว',
  REJECTED: 'ปฏิเสธแล้ว',
};

function SuggestionsTab() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('PENDING');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const suggestions = useQuery<SuggestionsResponse>({
    queryKey: ['chatbot-finance-kb-suggestions', statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      params.set('limit', '50');
      const { data } = await api.get<SuggestionsResponse>(
        `/chatbot/finance/admin/kb-suggestions?${params.toString()}`
      );
      return data;
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.patch(`/chatbot/finance/admin/kb-suggestions/${id}/approve`);
    },
    onSuccess: () => {
      toast.success('อนุมัติแล้ว — สร้าง KB entry เรียบร้อย');
      queryClient.invalidateQueries({ queryKey: ['chatbot-finance-kb-suggestions'] });
      queryClient.invalidateQueries({ queryKey: ['chatbot-finance-kb'] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const rejectMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.patch(`/chatbot/finance/admin/kb-suggestions/${id}/reject`);
    },
    onSuccess: () => {
      toast.success('ปฏิเสธแล้ว');
      queryClient.invalidateQueries({ queryKey: ['chatbot-finance-kb-suggestions'] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const items = suggestions.data?.items ?? [];

  return (
    <>
      {/* Status filter */}
      <div className="flex gap-2 mb-4">
        {['', 'PENDING', 'APPROVED', 'REJECTED'].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
              statusFilter === s
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-card text-foreground/70 border-border hover:bg-muted'
            }`}
          >
            {s === '' ? 'ทั้งหมด' : STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      <QueryBoundary
        isLoading={suggestions.isLoading && !suggestions.data}
        isError={suggestions.isError}
        error={suggestions.error}
        onRetry={suggestions.refetch}
        errorTitle="ไม่สามารถโหลดข้อเสนอแนะได้"
      >
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            ไม่มีข้อเสนอแนะ{statusFilter ? ` (${STATUS_LABELS[statusFilter]})` : ''}
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground mb-2">
              แสดง {items.length} จาก {suggestions.data?.total ?? 0} รายการ
            </p>

            <div className="border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted text-left text-xs text-muted-foreground uppercase">
                    <th className="px-4 py-3">คำถามลูกค้า</th>
                    <th className="px-4 py-3">Intent</th>
                    <th className="px-4 py-3">แหล่งที่มา</th>
                    <th className="px-4 py-3">สถานะ</th>
                    <th className="px-4 py-3">วันที่</th>
                    <th className="px-4 py-3 text-right">จัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map((s) => (
                    <tr
                      key={s.id}
                      className="hover:bg-muted/50 cursor-pointer"
                      onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
                    >
                      <td className="px-4 py-3">
                        <p className="line-clamp-2 max-w-xs">{s.customerQuestion}</p>
                      </td>
                      <td className="px-4 py-3">
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                          {s.suggestedIntent}
                        </code>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs">{SOURCE_LABELS[s.source] ?? s.source}</span>
                      </td>
                      <td className="px-4 py-3">
                        {(() => {
                          const cfg = getStatusBadgeProps(s.status, kbSuggestionStatusMap);
                          return (
                            <Badge variant={cfg.variant} appearance={cfg.appearance} className="text-[10px] px-2 py-0.5">
                              {STATUS_LABELS[s.status] ?? s.status}
                            </Badge>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {formatDateMedium(new Date(s.createdAt))}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {s.status === 'PENDING' && (
                          <div className="flex gap-1 justify-end">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                approveMutation.mutate(s.id);
                              }}
                              disabled={approveMutation.isPending}
                              className="px-3 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700 disabled:opacity-50"
                            >
                              อนุมัติ
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                rejectMutation.mutate(s.id);
                              }}
                              disabled={rejectMutation.isPending}
                              className="px-3 py-1 border border-red-300 text-red-600 rounded text-xs hover:bg-red-50 disabled:opacity-50"
                            >
                              ปฏิเสธ
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Expanded detail */}
            {expandedId && (() => {
              const item = items.find((s) => s.id === expandedId);
              if (!item) return null;
              return (
                <div className="border rounded-xl p-4 bg-card space-y-3">
                  <h3 className="font-semibold text-sm">รายละเอียดข้อเสนอแนะ</h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">คำถามลูกค้า</p>
                      <p className="bg-muted p-2 rounded text-sm">{item.customerQuestion}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">คำตอบพนักงาน</p>
                      <p className="bg-muted p-2 rounded text-sm">
                        {item.staffAnswer ?? <span className="text-muted-foreground">ไม่มี</span>}
                      </p>
                    </div>
                    {item.suggestedTemplate && (
                      <div className="col-span-2">
                        <p className="text-xs text-muted-foreground mb-1">Template ที่แนะนำ</p>
                        <pre className="bg-muted p-2 rounded text-xs font-mono whitespace-pre-wrap">
                          {item.suggestedTemplate}
                        </pre>
                      </div>
                    )}
                    {item.suggestedKeywords.length > 0 && (
                      <div className="col-span-2">
                        <p className="text-xs text-muted-foreground mb-1">Keywords ที่แนะนำ</p>
                        <div className="flex gap-1 flex-wrap">
                          {item.suggestedKeywords.map((kw, i) => (
                            <span
                              key={i}
                              className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full"
                            >
                              {kw}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </QueryBoundary>
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────

export default function ChatbotFinanceKnowledgePage() {
  return (
    <div>
      <PageHeader
        title="Finance Bot — Knowledge Base"
        subtitle="จัดการ FAQ และ KB สำหรับ AI Finance Bot"
      />

      <Tabs defaultValue="knowledge">
        <TabsList variant="line" size="md">
          <TabsTrigger value="knowledge">Knowledge Base</TabsTrigger>
          <TabsTrigger value="suggestions">ข้อเสนอแนะ</TabsTrigger>
        </TabsList>

        <TabsContent value="knowledge">
          <KnowledgeBaseTab />
        </TabsContent>

        <TabsContent value="suggestions">
          <SuggestionsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
