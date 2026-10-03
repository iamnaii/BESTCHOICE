import { API_AUDIENCE, historyItem, type AudienceKey, type BroadcastStatus, type BroadcastHistoryRecord } from './broadcast/api-contract';
import { BroadcastReviewActions } from './broadcast/BroadcastReviewActions';
import { MessageCard } from './broadcast/MessageCard';
import { MessagePreviewBubble } from './broadcast/MessagePreviewBubble';
import { FLEX_TEMPLATES, makeMessage, buildFlexJson, type MessageType, type TextContent, type ImageContent, type VideoContent, type FlexContent, type RichContent, type MessageItem } from './broadcast/message';
import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Send, Clock, History, Ban, Plus, Calendar, Users, UserCheck, AlertCircle, UserPlus, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
type ScheduleType = 'now' | 'scheduled';

interface AudienceCount {
  all: number;
  active: number;
  overdue: number;
  new: number;
}

interface BroadcastHistoryResponse {
  data: ReturnType<typeof historyItem>[];
  total: number;
  page: number;
  limit: number;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const AUDIENCE_OPTIONS: {
  key: AudienceKey;
  label: string;
  description: string;
  icon: React.ReactNode;
  color: string;
}[] = [
  {
    key: 'all',
    label: 'ทั้งหมด',
    description: 'ผู้ติดตาม LINE OA ทั้งหมด',
    icon: <Users className="size-4" />,
    color: 'text-primary',
  },
  {
    key: 'active',
    label: 'ลูกค้าเก่า — มีสัญญา',
    description: 'ลูกค้าที่มีสัญญาผ่อนชำระ',
    icon: <UserCheck className="size-4" />,
    color: 'text-success',
  },
  {
    key: 'overdue',
    label: 'ค้างชำระ',
    description: 'ลูกค้าที่ค้างชำระงวด',
    icon: <AlertCircle className="size-4" />,
    color: 'text-destructive',
  },
  {
    key: 'new',
    label: 'ลูกค้าใหม่',
    description: 'follow แต่ยังไม่ซื้อ',
    icon: <UserPlus className="size-4" />,
    color: 'text-muted-foreground',
  },
];

const STATUS_MAP: Record<
  BroadcastStatus,
  { label: string; variant: 'success' | 'secondary' | 'destructive' | 'outline' }
> = {
  pending_approval: { label: 'รออนุมัติ', variant: 'secondary' },
  rejected: { label: 'ปฏิเสธ', variant: 'destructive' },
  cancelled: { label: 'ยกเลิกแล้ว', variant: 'outline' },
  sending: { label: 'กำลังส่ง', variant: 'secondary' },
  sent: { label: 'ส่งแล้ว', variant: 'success' },
  scheduled: { label: 'ตั้งเวลา', variant: 'secondary' },
  failed: { label: 'ล้มเหลว', variant: 'destructive' },
};

const AUDIENCE_LABEL: Record<AudienceKey, string> = {
  all: 'ทั้งหมด',
  active: 'มีสัญญา',
  overdue: 'ค้างชำระ',
  new: 'ลูกค้าใหม่',
};

const TYPE_LABEL: Record<MessageType, string> = {
  text: 'ข้อความ',
  image: 'รูปภาพ',
  video: 'วิดีโอ',
  flex: 'Flex Card',
  rich: 'Rich Msg',
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('th-TH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function BroadcastPage() {
  const queryClient = useQueryClient();

  // Tab
  const [tab, setTab] = useState<'compose' | 'history'>('compose');

  // Messages
  const [messages, setMessages] = useState<MessageItem[]>([makeMessage('text')]);
  const [uploadingIds, setUploadingIds] = useState<Set<string>>(new Set());

  // Audience
  const [audience, setAudience] = useState<AudienceKey>('all');

  // Schedule
  const [scheduleType, setScheduleType] = useState<ScheduleType>('now');
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');

  // Confirm
  const [confirmOpen, setConfirmOpen] = useState(false);

  // History
  const [historyPage, setHistoryPage] = useState(1);
  const [cancelId, setCancelId] = useState<string | null>(null);

  // ─── Queries ──────────────────────────────────────────────────────────────────

  const audienceQuery = useQuery({
    queryKey: ['broadcast-audience'],
    queryFn: async () => {
      const res = await api.get<Omit<AudienceCount, 'active'> & { existing: number }>('/line-oa/broadcast/audience-count');
      return { ...res.data, active: res.data.existing };
    },
  });

  const historyQuery = useQuery({
    queryKey: ['broadcast-history', historyPage],
    queryFn: async () => {
      const res = await api.get<Omit<BroadcastHistoryResponse, 'data'> & { data: BroadcastHistoryRecord[] }>(
        `/line-oa/broadcast/history?page=${historyPage}&limit=20`,
      );
      return { ...res.data, data: res.data.data.map(historyItem) };
    },
    enabled: tab === 'history',
  });

  // ─── Mutations ────────────────────────────────────────────────────────────────

  const sendMutation = useMutation({
    mutationFn: async (payload: object) => {
      const res = await api.post<{ success: boolean; message: string }>(
        '/line-oa/broadcast',
        payload,
      );
      return res.data;
    },
    onSuccess: (data) => {
      if (data.success) {
        toast.success(data.message || 'ส่ง Broadcast เรียบร้อย');
        resetCompose();
        queryClient.invalidateQueries({ queryKey: ['broadcast-history'] });
      } else {
        toast.error(data.message || 'เกิดข้อผิดพลาด');
      }
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
    },
  });

  const scheduleMutation = useMutation({
    mutationFn: async (payload: object) => {
      const res = await api.post<{ success: boolean; message: string }>(
        '/line-oa/broadcast/schedule',
        payload,
      );
      return res.data;
    },
    onSuccess: (data) => {
      if (data.success) {
        toast.success(data.message || 'ตั้งเวลาส่ง Broadcast เรียบร้อย');
        resetCompose();
        queryClient.invalidateQueries({ queryKey: ['broadcast-history'] });
      } else {
        toast.error(data.message || 'เกิดข้อผิดพลาด');
      }
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.delete<{ success: boolean; message: string }>(`/line-oa/broadcast/${id}`);
      return data;
    },
    onSuccess: (data) => {
      if (data.success) toast.success(data.message || 'ยกเลิก Broadcast เรียบร้อย');
      else toast.error(data.message || 'ยกเลิก Broadcast ไม่สำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['broadcast-history'] });
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
    },
  });

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  function resetCompose() {
    setMessages([makeMessage('text')]);
    setScheduleType('now');
    setScheduleDate('');
    setScheduleTime('');
    setUploadingIds(new Set());
  }

  const updateMessage = useCallback((id: string, update: React.SetStateAction<MessageItem>) => {
    setMessages((prev) => prev.map((m) => m.id === id ? (typeof update === 'function' ? update(m) : update) : m));
  }, []);

  function addMessage() {
    if (messages.length >= 5) return;
    setMessages((prev) => [...prev, makeMessage('text')]);
  }

  function deleteMessage(id: string) {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }

  function buildApiMessages() {
    return messages.map((m) => {
      if (m.type === 'text') {
        const c = m.content as TextContent;
        return { type: m.type, content: { text: c.text } };
      }
      if (m.type === 'image') {
        const c = m.content as ImageContent;
        return { type: m.type, content: { imageUrl: c.imageUrl, caption: c.caption } };
      }
      if (m.type === 'video') {
        const c = m.content as VideoContent;
        return { type: m.type, content: { videoUrl: c.videoUrl, thumbnailUrl: c.thumbnailUrl } };
      }
      if (m.type === 'flex') {
        const c = m.content as FlexContent;
        let flexContents: object;
        if (c.flexMode === 'json') {
          try {
            flexContents = JSON.parse(c.jsonText);
          } catch {
            flexContents = {};
          }
        } else {
          flexContents = buildFlexJson(c);
        }
        return { type: m.type, content: { flexContents } };
      }
      if (m.type === 'rich') {
        const c = m.content as RichContent;
        return { type: m.type, content: { imageUrl: c.imageUrl, linkUrl: c.linkUrl } };
      }
      return { type: m.type, content: m.content };
    });
  }

  function validate(): string | null {
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      const num = i + 1;
      if (m.type === 'text') {
        const c = m.content as TextContent;
        if (!c.text.trim()) return `ข้อความที่ ${num}: กรุณาพิมพ์ข้อความ`;
      } else if (m.type === 'image') {
        const c = m.content as ImageContent;
        if (!c.imageUrl) {
          if (uploadingIds.has(m.id)) return `ข้อความที่ ${num}: กำลังอัปโหลดรูป กรุณารอ`;
          return `ข้อความที่ ${num}: กรุณาเลือกรูปภาพ`;
        }
      } else if (m.type === 'video') {
        const c = m.content as VideoContent;
        if (!c.videoUrl) return `ข้อความที่ ${num}: กรุณาเลือกไฟล์วิดีโอ`;
        if (!c.thumbnailUrl) return `ข้อความที่ ${num}: กรุณาเลือกรูปปกวิดีโอ`;
      } else if (m.type === 'flex') {
        const c = m.content as FlexContent;
        if (c.flexMode === 'template') {
          const tpl = FLEX_TEMPLATES[c.templateKey];
          if (!c.fields[tpl.fields[0]]?.trim())
            return `ข้อความที่ ${num}: กรุณากรอก ${tpl.fields[0]}`;
        } else {
          if (!c.jsonValid) return `ข้อความที่ ${num}: JSON ไม่ถูกต้อง`;
        }
      }
    }
    if (scheduleType === 'scheduled') {
      if (!scheduleDate) return 'กรุณาเลือกวันที่ส่ง';
      if (!scheduleTime) return 'กรุณาเลือกเวลาส่ง';
      const dt = new Date(`${scheduleDate}T${scheduleTime}`);
      if (dt <= new Date()) return 'วันเวลาที่ตั้งต้องอยู่ในอนาคต';
    }
    return null;
  }

  function handleSendClick() {
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    setConfirmOpen(true);
  }

  function handleConfirm() {
    const apiMessages = buildApiMessages();
    const payload = { messages: apiMessages, audience: API_AUDIENCE[audience] };
    if (scheduleType === 'scheduled') {
      scheduleMutation.mutate({
        ...payload,
        scheduledAt: new Date(`${scheduleDate}T${scheduleTime}`).toISOString(),
      });
    } else {
      sendMutation.mutate(payload);
    }
  }

  const isPending = sendMutation.isPending || scheduleMutation.isPending;
  const selectedCount = audienceQuery.data?.[audience] ?? null;
  const recipientLabel = audience === 'all' ? 'ผู้ติดตาม LINE OA ทั้งหมด' : `${selectedCount?.toLocaleString() ?? '...'} คน`;

  // ─── Compose Tab ──────────────────────────────────────────────────────────────

  const renderComposeTab = () => (
    <div className="space-y-8">
      {/* Messages section */}
      <div className="space-y-1">
        <h3 className="text-lg font-semibold text-foreground/90 pb-2 border-b border-border">
          ข้อความ
        </h3>
        <p className="text-xs text-muted-foreground mb-4">เพิ่มได้สูงสุด 5 ข้อความต่อ 1 broadcast</p>
        <div className="space-y-4 pt-2">
          {messages.map((msg, index) => (
            <MessageCard
              key={msg.id}
              message={msg}
              index={index}
              total={messages.length}
              onChange={(update) => updateMessage(msg.id, update)}
              onDelete={() => deleteMessage(msg.id)}
              uploadingIds={uploadingIds}
              setUploadingIds={setUploadingIds}
            />
          ))}
          {messages.length < 5 && (
            <Button
              variant="outline"
              className="w-full border-dashed border-2 gap-2 h-12 text-muted-foreground hover:text-primary hover:border-primary/60 hover:bg-primary/5 transition-all duration-200"
              onClick={addMessage}
            >
              <Plus className="size-4" />
              เพิ่มข้อความ
              <span className="text-xs text-muted-foreground">(เหลือ {5 - messages.length} ข้อความ)</span>
            </Button>
          )}
        </div>
      </div>

      {/* Audience section */}
      <div className="space-y-1">
        <h3 className="text-lg font-semibold text-foreground/90 pb-2 border-b border-border">
          กลุ่มเป้าหมาย
        </h3>
        <p className="text-xs text-muted-foreground mb-4">เลือกกลุ่มผู้รับข้อความ</p>
        <QueryBoundary
          isLoading={audienceQuery.isLoading}
          isError={audienceQuery.isError}
          error={audienceQuery.error}
          onRetry={audienceQuery.refetch}
          errorTitle="ไม่สามารถโหลดข้อมูลกลุ่มเป้าหมายได้"
        >
        <div className="grid grid-cols-2 gap-3 pt-2">
          {AUDIENCE_OPTIONS.map((a) => {
            const count = audienceQuery.data?.[a.key];
            const isSelected = audience === a.key;
            return (
              <label
                key={a.key}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-xl border-2 p-4 transition-all duration-200',
                  isSelected
                    ? 'border-primary bg-primary/5 shadow-md ring-2 ring-primary/20'
                    : 'border-border bg-card hover:border-primary/60 hover:shadow-md',
                )}
              >
                <input
                  type="radio"
                  name="audience"
                  value={a.key}
                  checked={isSelected}
                  onChange={() => setAudience(a.key)}
                  className="mt-0.5 accent-primary"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className={cn('shrink-0', a.color)}>{a.icon}</span>
                    <span className="text-sm font-semibold text-foreground/90 truncate">{a.label}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mb-1.5">{a.description}</div>
                  <div className={cn('text-2xl font-bold tabular-nums', isSelected ? 'text-primary' : 'text-foreground/80')}>
                    {a.key === 'all' ? 'ผู้ติดตามทุกคน' : count !== undefined ? count.toLocaleString() : (
                      <span className="text-base font-normal text-muted-foreground">กำลังโหลด...</span>
                    )}
                  </div>
                  {a.key !== 'all' && count !== undefined && (
                    <div className="text-xs text-muted-foreground">คน</div>
                  )}
                </div>
              </label>
            );
          })}
        </div>
        </QueryBoundary>
      </div>

      {/* Schedule section */}
      <div className="space-y-1">
        <h3 className="text-lg font-semibold text-foreground/90 pb-2 border-b border-border">
          เวลาส่ง
        </h3>
        <p className="text-xs text-muted-foreground mb-4">เลือกส่งทันทีหรือตั้งเวลา</p>
        <div className="space-y-4 pt-2">
          <div className="flex gap-3">
            {(
              [
                { value: 'now', icon: <Send className="size-4" />, label: 'ส่งทันที', desc: 'ส่งเมื่อผู้อนุมัติคนที่สองยืนยัน' },
                { value: 'scheduled', icon: <Clock className="size-4" />, label: 'ตั้งเวลา', desc: 'กำหนดวันและเวลาส่ง' },
              ] as const
            ).map((s) => (
              <label
                key={s.value}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-xl border-2 px-4 py-3 flex-1 transition-all duration-200',
                  scheduleType === s.value
                    ? 'border-primary bg-primary/10 text-primary shadow-sm'
                    : 'border-border text-foreground/70 hover:border-primary/60 bg-card',
                )}
              >
                <input
                  type="radio"
                  name="scheduleType"
                  value={s.value}
                  checked={scheduleType === s.value}
                  onChange={() => setScheduleType(s.value)}
                  className="hidden"
                />
                <div className={cn(
                  'mt-0.5 shrink-0',
                  scheduleType === s.value ? 'text-primary' : 'text-muted-foreground',
                )}>
                  {s.icon}
                </div>
                <div>
                  <div className="text-sm font-semibold">{s.label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{s.desc}</div>
                </div>
              </label>
            ))}
          </div>
          {scheduleType === 'scheduled' && (
            <div className="flex gap-3 p-4 rounded-xl bg-muted border border-border">
              <div className="flex-1">
                <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-foreground/80">
                  <Calendar className="size-3.5 text-muted-foreground" />
                  วันที่
                </label>
                <Input
                  type="date"
                  value={scheduleDate}
                  onChange={(e) => setScheduleDate(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                />
              </div>
              <div className="flex-1">
                <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-foreground/80">
                  <Clock className="size-3.5 text-muted-foreground" />
                  เวลา
                </label>
                <Input
                  type="time"
                  value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Preview + Summary + Send */}
      <div className="space-y-1">
        <h3 className="text-lg font-semibold text-foreground/90 pb-2 border-b border-border">
          Preview &amp; ส่ง
        </h3>
        <div className="pt-4 space-y-6">
          {/* Phone frame preview */}
          <div className="relative max-w-[320px] mx-auto">
            <div className="bg-foreground/90 rounded-[2.5rem] p-3 shadow-2xl">
              {/* Notch */}
              <div className="bg-foreground w-24 h-5 rounded-full mx-auto mb-2" />
              {/* Screen */}
              <div className="bg-[#7b9ebc] rounded-2xl overflow-hidden min-h-[400px]">
                {/* Chat header */}
                <div className="bg-[#06C755] px-4 py-3 mb-2 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-white/30 flex items-center justify-center">
                    <span className="text-white text-xs font-bold">B</span>
                  </div>
                  <div>
                    <div className="text-white font-bold text-sm">BESTCHOICE</div>
                    <div className="text-white/70 text-[10px]">Official Account</div>
                  </div>
                </div>
                {/* Messages */}
                <div className="px-3 pb-4 space-y-2">
                  {messages.map((msg) => (
                    <MessagePreviewBubble key={msg.id} message={msg} />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Summary box */}
          <div className="rounded-xl bg-success/10 border border-success/20 px-5 py-4 shadow-sm">
            <p className="text-sm font-semibold text-success mb-3">สรุปการส่ง</p>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-success">
                <CheckCircle2 className="size-4 text-success shrink-0" />
                <span>{messages.length} ข้อความ</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-success">
                <CheckCircle2 className="size-4 text-success shrink-0" />
                <span>
                  ส่งถึง{' '}
                  <span className="font-semibold text-success">
                    {recipientLabel}
                  </span>{' '}
                  ({AUDIENCE_LABEL[audience]})
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm text-success">
                <CheckCircle2 className="size-4 text-success shrink-0" />
                <span>
                  {scheduleType === 'now'
                    ? 'ส่งหลังอนุมัติ'
                    : scheduleDate && scheduleTime
                      ? `ตั้งเวลา ${new Date(`${scheduleDate}T${scheduleTime}`).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}`
                      : 'ยังไม่ได้ตั้งเวลา'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              onClick={handleSendClick}
              disabled={isPending || uploadingIds.size > 0}
              className="gap-2 h-11 px-8 text-sm font-semibold bg-gradient-to-r from-[#06C755] to-[#04B44C] hover:from-[#05b34a] hover:to-[#039940] text-white shadow-md hover:shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 border-0"
            >
              <Send className="size-4" />
              {isPending
                ? 'กำลังดำเนินการ...'
                : scheduleType === 'scheduled'
                  ? 'ตั้งเวลาส่ง'
                  : 'ส่ง Broadcast'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );

  // ─── History Tab ──────────────────────────────────────────────────────────────

  const renderHistoryTab = () => {
    const items = historyQuery.data?.data ?? [];
    const total = historyQuery.data?.total ?? 0;
    const totalPages = Math.ceil(total / 20);

    if (historyQuery.isLoading) {
      return (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      );
    }

    if (historyQuery.isError) {
      return (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-sm text-muted-foreground">ไม่สามารถโหลดประวัติได้</p>
          <Button variant="outline" size="sm" onClick={() => historyQuery.refetch()}>
            ลองใหม่
          </Button>
        </div>
      );
    }

    if (items.length === 0) {
      return (
        <div className="flex flex-col items-center gap-4 py-20 text-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-muted">
            <History className="size-8 text-muted-foreground/50" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground/70">ยังไม่มีประวัติการส่ง</p>
            <p className="text-xs text-muted-foreground mt-1">ประวัติ Broadcast จะแสดงที่นี่</p>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {items.map((item) => {
          const status = STATUS_MAP[item.status] ?? { label: item.status, variant: 'outline' as const };
          return (
            <Card
              key={item.id}
              className="hover:shadow-md transition-all duration-200 hover:border-primary/30"
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1 space-y-2">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {item.messagePreview || '—'}
                      {item.messageCount && item.messageCount > 1 && (
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                          +{item.messageCount - 1} เพิ่มเติม
                        </span>
                      )}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className="text-xs">
                        {TYPE_LABEL[item.messageType] ?? item.messageType}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {AUDIENCE_LABEL[item.audienceKey] ?? item.audienceKey}
                        {' · '}
                        {item.audienceKey === 'all' ? 'ผู้ติดตาม LINE OA ทั้งหมด' : `${item.audienceCount.toLocaleString()} คน`}
                      </Badge>
                      <Badge variant={status.variant} className="text-xs">
                        {status.label}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {item.status === 'scheduled'
                        ? `ตั้งเวลา: ${formatDateTime(item.scheduledAt)}`
                        : item.status === 'pending_approval' ? 'รอผู้อนุมัติคนที่สอง' : `ส่งเมื่อ: ${formatDateTime(item.sentAt)}`}
                    </p>
                  </div>
                  {item.status === 'pending_approval' && <BroadcastReviewActions id={item.id} createdById={item.createdById} messages={item.messages} scheduledAt={item.scheduledAt} />}
                  {item.status === 'scheduled' && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0 gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive transition-colors"
                      onClick={() => setCancelId(item.id)}
                    >
                      <Ban className="size-3.5" />
                      ยกเลิก
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 pt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
              disabled={historyPage <= 1}
            >
              ก่อนหน้า
            </Button>
            <span className="text-sm text-muted-foreground px-2">
              หน้า {historyPage} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setHistoryPage((p) => Math.min(totalPages, p + 1))}
              disabled={historyPage >= totalPages}
            >
              ถัดไป
            </Button>
          </div>
        )}
      </div>
    );
  };

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <PageHeader
        title="Broadcast"
        subtitle="ส่งข้อความหาลูกค้า"
        icon={<Send className="size-5" />}
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'compose' | 'history')}>
        <TabsList variant="line" size="md" className="w-full justify-start">
          <TabsTrigger value="compose">สร้างข้อความ</TabsTrigger>
          <TabsTrigger value="history">
            <History className="size-4" />
            ประวัติ
          </TabsTrigger>
        </TabsList>

        <TabsContent value="compose" className="mt-6">
          {renderComposeTab()}
        </TabsContent>

        <TabsContent value="history" className="mt-6">
          {renderHistoryTab()}
        </TabsContent>
      </Tabs>

      {/* Send confirm */}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="ส่ง Broadcast เพื่อรออนุมัติ"
        description={
          scheduleType === 'scheduled'
            ? `ต้องการตั้งเวลาส่ง ${messages.length} ข้อความ ไปยัง ${recipientLabel} โดยรอผู้อนุมัติคนที่สอง ใช่หรือไม่?`
            : `ต้องการส่ง ${messages.length} ข้อความ ไปยัง ${recipientLabel} โดยรอผู้อนุมัติคนที่สอง ใช่หรือไม่?`
        }
        confirmLabel="บันทึกรออนุมัติ"
        onConfirm={handleConfirm}
        loading={isPending}
      />

      {/* Cancel confirm */}
      <ConfirmDialog
        open={!!cancelId}
        onOpenChange={(open) => {
          if (!open) setCancelId(null);
        }}
        title="ยืนยันการยกเลิก"
        description="ต้องการยกเลิก Broadcast ที่ตั้งเวลาไว้ใช่หรือไม่?"
        confirmLabel="ยกเลิก Broadcast"
        variant="destructive"
        onConfirm={() => {
          if (cancelId) {
            cancelMutation.mutate(cancelId);
            setCancelId(null);
          }
        }}
        loading={cancelMutation.isPending}
      />
    </div>
  );
}
