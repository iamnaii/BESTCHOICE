import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import { toast } from 'sonner';
import QueryBoundary from '@/components/QueryBoundary';
import { Badge } from '@/components/ui/badge';
import { getStatusBadgeProps, sessionStatusMap } from '@/lib/status-badges';

interface SessionItem {
  id: string;
  lineUserId: string;
  customer: { id: string; name: string; phone: string } | null;
  handoffMode: boolean;
  handoffReason: string | null;
  totalMessages: number;
  lastMessageAt: string;
  verifiedAt: string | null;
}

interface SessionList {
  items: SessionItem[];
  total: number;
  page: number;
  limit: number;
}

interface MessageItem {
  id: string;
  role: 'CUSTOMER' | 'BOT' | 'STAFF' | 'AUTO_TRIGGER' | 'SYSTEM';
  type: string;
  text: string | null;
  intent: string | null;
  modelUsed: string | null;
  createdAt: string;
}

interface SessionDetail extends SessionItem {
  messages: MessageItem[];
}

const ROLE_BADGE: Record<string, { label: string; cls: string }> = {
  CUSTOMER: { label: '👤 ลูกค้า', cls: 'bg-blue-50 border-blue-200' },
  BOT: { label: '🤖 น้องเบส', cls: 'bg-green-50 border-green-200' },
  STAFF: { label: '👨‍💼 พนักงาน', cls: 'bg-purple-50 border-purple-200' },
  AUTO_TRIGGER: { label: '⏰ Auto', cls: 'bg-yellow-50 border-yellow-200' },
  SYSTEM: { label: '⚙️ System', cls: 'bg-gray-50 border-gray-200' },
};

export default function ChatbotFinanceSessionsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [handoffOnly, setHandoffOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const list = useQuery<SessionList>({
    queryKey: ['chatbot-finance-sessions', page, search, handoffOnly],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (search) params.set('search', search);
      if (handoffOnly) params.set('handoffOnly', 'true');
      const { data } = await api.get<SessionList>(
        `/chatbot/finance/admin/sessions?${params.toString()}`,
      );
      return data;
    },
  });

  const detail = useQuery<SessionDetail | null>({
    queryKey: ['chatbot-finance-session', selectedId],
    queryFn: async () => {
      if (!selectedId) return null;
      const { data } = await api.get<SessionDetail>(
        `/chatbot/finance/admin/sessions/${selectedId}`,
      );
      return data;
    },
    enabled: !!selectedId,
  });

  const returnToBot = useMutation({
    mutationFn: async (id: string) => {
      await api.post(`/chatbot/finance/admin/sessions/${id}/return-to-bot`);
    },
    onSuccess: () => {
      toast.success('คืน session ให้บอทแล้ว');
      queryClient.invalidateQueries({ queryKey: ['chatbot-finance-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['chatbot-finance-session', selectedId] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold mb-4">Finance Bot — Sessions</h1>

      <div className="flex gap-3 mb-4">
        <input
          type="text"
          placeholder="ค้นหาชื่อ/เบอร์/lineUserId"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="flex-1 px-3 py-2 border rounded-lg text-sm"
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={handoffOnly}
            onChange={(e) => { setHandoffOnly(e.target.checked); setPage(1); }}
          />
          เฉพาะ Handoff
        </label>
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* List */}
        <div className="col-span-5 border rounded-xl bg-white">
          <QueryBoundary
            isLoading={list.isLoading && !list.data}
            isError={list.isError}
            error={list.error}
            onRetry={list.refetch}
            errorTitle="ไม่สามารถโหลด Sessions ได้"
          >
          {list.data?.items.length === 0 ? (
            <div className="p-4 text-gray-400 text-sm">ไม่พบ session</div>
          ) : (
            <ul className="divide-y">
              {list.data?.items.map((s) => (
                <li
                  key={s.id}
                  onClick={() => setSelectedId(s.id)}
                  className={`p-3 cursor-pointer hover:bg-gray-50 ${selectedId === s.id ? 'bg-blue-50' : ''}`}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-medium text-sm">
                        {s.customer?.name || '(ยังไม่ verify)'}
                      </p>
                      <p className="text-xs text-gray-500">{s.customer?.phone || s.lineUserId.slice(0, 12)}</p>
                    </div>
                    {s.handoffMode && (() => {
                      const cfg = getStatusBadgeProps('HANDOFF', sessionStatusMap);
                      return (
                        <Badge variant={cfg.variant} appearance={cfg.appearance} size="sm">
                          {cfg.label}
                        </Badge>
                      );
                    })()}
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    {s.totalMessages} ข้อความ · {new Date(s.lastMessageAt).toLocaleString('th-TH')}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {list.data && list.data.total > list.data.limit && (
            <div className="p-3 flex justify-between text-sm border-t">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="text-blue-600 disabled:text-gray-300"
              >
                ← ก่อนหน้า
              </button>
              <span className="text-gray-500">
                {page} / {Math.ceil(list.data.total / list.data.limit)}
              </span>
              <button
                onClick={() => setPage(page + 1)}
                disabled={page * list.data.limit >= list.data.total}
                className="text-blue-600 disabled:text-gray-300"
              >
                ถัดไป →
              </button>
            </div>
          )}
          </QueryBoundary>
        </div>

        {/* Detail */}
        <div className="col-span-7 border rounded-xl bg-white p-4">
          {!selectedId ? (
            <p className="text-gray-400 text-sm">เลือก session เพื่อดูรายละเอียด</p>
          ) : detail.isLoading ? (
            <p className="text-gray-500 text-sm">กำลังโหลด...</p>
          ) : !detail.data ? (
            <p className="text-gray-400 text-sm">ไม่พบข้อมูล</p>
          ) : (
            <>
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h2 className="font-bold">{detail.data.customer?.name || '(ยังไม่ verify)'}</h2>
                  <p className="text-xs text-gray-500">{detail.data.customer?.phone || detail.data.lineUserId}</p>
                </div>
                {detail.data.handoffMode && (
                  <button
                    onClick={() => returnToBot.mutate(detail.data!.id)}
                    disabled={returnToBot.isPending}
                    className="px-3 py-1.5 text-xs bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50"
                  >
                    คืนให้บอท
                  </button>
                )}
              </div>

              {detail.data.handoffReason && (
                <div className="mb-3 p-2 bg-orange-50 border border-orange-200 rounded-lg text-xs">
                  📌 Handoff: {detail.data.handoffReason}
                </div>
              )}

              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {detail.data.messages.map((m) => {
                  const badge = ROLE_BADGE[m.role] ?? ROLE_BADGE.SYSTEM;
                  return (
                    <div key={m.id} className={`border rounded-lg p-2 text-sm ${badge.cls}`}>
                      <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                        <span>{badge.label}</span>
                        <span>{new Date(m.createdAt).toLocaleTimeString('th-TH')}</span>
                      </div>
                      <p className="whitespace-pre-wrap">{m.text}</p>
                      {m.intent && (
                        <p className="text-[10px] text-gray-400 mt-1">intent: {m.intent}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
