import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import { toast } from 'sonner';
import QueryBoundary from '@/components/QueryBoundary';
import { Badge } from '@/components/ui/badge';
import { getStatusBadgeProps, sessionStatusMap } from '@/lib/status-badges';
import { Card, CardContent } from '@/components/ui/card';
import { formatDateTime } from '@/utils/formatters';
import { User, Bot, Briefcase, Clock, Settings, Pin } from 'lucide-react';

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

const ROLE_BADGE: Record<string, { label: string; icon: typeof User; cls: string }> = {
  CUSTOMER:     { label: 'ลูกค้า',   icon: User,     cls: 'bg-info/10 border-info/20' },
  BOT:          { label: 'น้องเบส', icon: Bot,      cls: 'bg-success/10 border-success/20' },
  STAFF:        { label: 'พนักงาน', icon: Briefcase, cls: 'bg-secondary/20 border-secondary/30' },
  AUTO_TRIGGER: { label: 'Auto',    icon: Clock,    cls: 'bg-warning/10 border-warning/20' },
  SYSTEM:       { label: 'System',  icon: Settings, cls: 'bg-muted border-border' },
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
    <div>
      <PageHeader
        title="Finance Bot — Sessions"
        subtitle="ดูและจัดการบทสนทนาของ AI Finance Bot"
      />

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
        <Card className="col-span-5 overflow-hidden">
          <QueryBoundary
            isLoading={list.isLoading && !list.data}
            isError={list.isError}
            error={list.error}
            onRetry={list.refetch}
            errorTitle="ไม่สามารถโหลด Sessions ได้"
          >
          {list.data?.items.length === 0 ? (
            <div className="p-4 text-muted-foreground text-sm">ไม่พบ session</div>
          ) : (
            <ul className="divide-y">
              {list.data?.items.map((s) => (
                <li
                  key={s.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedId(s.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedId(s.id);
                    }
                  }}
                  className={`p-3 cursor-pointer hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedId === s.id ? 'bg-primary/5' : ''}`}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-medium text-sm">
                        {s.customer?.name || '(ยังไม่ verify)'}
                      </p>
                      <p className="text-xs text-muted-foreground">{s.customer?.phone || s.lineUserId.slice(0, 12)}</p>
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
                  <p className="text-xs text-muted-foreground mt-1">
                    {s.totalMessages} ข้อความ · {formatDateTime(new Date(s.lastMessageAt))}
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
                className="text-primary disabled:text-muted-foreground/50"
              >
                ← ก่อนหน้า
              </button>
              <span className="text-muted-foreground">
                {page} / {Math.ceil(list.data.total / list.data.limit)}
              </span>
              <button
                onClick={() => setPage(page + 1)}
                disabled={page * list.data.limit >= list.data.total}
                className="text-primary disabled:text-muted-foreground/50"
              >
                ถัดไป →
              </button>
            </div>
          )}
          </QueryBoundary>
        </Card>

        {/* Detail */}
        <Card className="col-span-7">
          <CardContent className="p-4">
          {!selectedId ? (
            <p className="text-muted-foreground text-sm">เลือก session เพื่อดูรายละเอียด</p>
          ) : detail.isLoading ? (
            <p className="text-muted-foreground text-sm">กำลังโหลด...</p>
          ) : !detail.data ? (
            <p className="text-muted-foreground text-sm">ไม่พบข้อมูล</p>
          ) : (
            <>
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h2 className="font-bold">{detail.data.customer?.name || '(ยังไม่ verify)'}</h2>
                  <p className="text-xs text-muted-foreground">{detail.data.customer?.phone || detail.data.lineUserId}</p>
                </div>
                {detail.data.handoffMode && (
                  <button
                    onClick={() => returnToBot.mutate(detail.data!.id)}
                    disabled={returnToBot.isPending}
                    className="px-3 py-1.5 text-xs bg-warning text-warning-foreground rounded-lg hover:bg-warning/90 disabled:opacity-50"
                  >
                    คืนให้บอท
                  </button>
                )}
              </div>

              {detail.data.handoffReason && (
                <div className="mb-3 p-2 bg-warning/10 border border-warning/20 rounded-lg text-xs">
                  <Pin className="size-3.5 inline mr-1" />Handoff: {detail.data.handoffReason}
                </div>
              )}

              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {detail.data.messages.map((m) => {
                  const badge = ROLE_BADGE[m.role] ?? ROLE_BADGE.SYSTEM;
                  return (
                    <div key={m.id} className={`border rounded-lg p-2 text-sm ${badge.cls}`}>
                      <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                        <span className="flex items-center gap-1"><badge.icon className="size-3" />{badge.label}</span>
                        <span>{new Date(m.createdAt).toLocaleTimeString('th-TH')}</span>
                      </div>
                      <p className="whitespace-pre-wrap">{m.text}</p>
                      {m.intent && (
                        <p className="text-[10px] text-muted-foreground mt-1">intent: {m.intent}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
