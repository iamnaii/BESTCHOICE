import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Send,
  MessageSquare,
  Image as ImageIcon,
  LayoutTemplate,
  Clock,
  History,
  Upload,
  X,
  Ban,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

// ─── Types ────────────────────────────────────────────────────────────────────

type MessageType = 'text' | 'image' | 'flex';
type AudienceKey = 'all' | 'active' | 'overdue' | 'new';
type ScheduleType = 'now' | 'scheduled';
type BroadcastStatus = 'sent' | 'scheduled' | 'failed';

interface AudienceCount {
  all: number;
  active: number;
  overdue: number;
  new: number;
}

interface BroadcastHistoryItem {
  id: string;
  messagePreview: string;
  messageType: MessageType;
  audienceKey: AudienceKey;
  audienceCount: number;
  scheduledAt: string | null;
  sentAt: string | null;
  status: BroadcastStatus;
}

interface BroadcastHistoryResponse {
  data: BroadcastHistoryItem[];
  total: number;
  page: number;
  limit: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const AUDIENCE_OPTIONS: { key: AudienceKey; label: string; description: string }[] = [
  { key: 'all', label: 'ทั้งหมด', description: 'ผู้ติดตาม LINE OA ทั้งหมด' },
  { key: 'active', label: 'ลูกค้าเก่า — มีสัญญา', description: 'ลูกค้าที่มีสัญญาผ่อนชำระ' },
  { key: 'overdue', label: 'ค้างชำระ', description: 'ลูกค้าที่ค้างชำระงวด' },
  { key: 'new', label: 'ลูกค้าใหม่', description: 'follow แต่ยังไม่ซื้อ' },
];

const FLEX_TEMPLATES = [
  { value: 'product', label: 'สินค้า — Product Card' },
  { value: 'promotion', label: 'โปรโมชัน — Promotion Banner' },
];

const STATUS_MAP: Record<BroadcastStatus, { label: string; variant: 'success' | 'secondary' | 'destructive' | 'outline' }> = {
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
  flex: 'Flex Card',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

  // Compose state
  const [messageType, setMessageType] = useState<MessageType>('text');
  const [text, setText] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageCaption, setImageCaption] = useState('');
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const [flexTemplate, setFlexTemplate] = useState('product');
  const [flexTitle, setFlexTitle] = useState('');
  const [flexBody, setFlexBody] = useState('');

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

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Queries ────────────────────────────────────────────────────────────────

  const audienceQuery = useQuery({
    queryKey: ['broadcast-audience'],
    queryFn: async () => {
      const res = await api.get<AudienceCount>('/line-oa/broadcast/audience-count');
      return res.data;
    },
  });

  const historyQuery = useQuery({
    queryKey: ['broadcast-history', historyPage],
    queryFn: async () => {
      const res = await api.get<BroadcastHistoryResponse>(
        `/line-oa/broadcast/history?page=${historyPage}&limit=20`,
      );
      return res.data;
    },
  });

  // ─── Mutations ──────────────────────────────────────────────────────────────

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post<{ url: string }>('/line-oa/broadcast/upload-image', fd);
      return res.data;
    },
    onSuccess: (data) => {
      setUploadedImageUrl(data.url);
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
    },
  });

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
      await api.delete(`/line-oa/broadcast/${id}`);
    },
    onSuccess: () => {
      toast.success('ยกเลิก Broadcast เรียบร้อย');
      queryClient.invalidateQueries({ queryKey: ['broadcast-history'] });
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
    },
  });

  // ─── Helpers ────────────────────────────────────────────────────────────────

  function resetCompose() {
    setText('');
    setImageFile(null);
    setImagePreview(null);
    setImageCaption('');
    setUploadedImageUrl(null);
    setFlexTitle('');
    setFlexBody('');
    setScheduleType('now');
    setScheduleDate('');
    setScheduleTime('');
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('กรุณาเลือกไฟล์รูปภาพเท่านั้น');
      return;
    }
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target?.result as string);
    reader.readAsDataURL(file);
    uploadMutation.mutate(file);
  }

  function handleRemoveImage() {
    setImageFile(null);
    setImagePreview(null);
    setUploadedImageUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function buildPayload() {
    const base = { audience, messageType };

    if (messageType === 'text') {
      return { ...base, text };
    }
    if (messageType === 'image') {
      return { ...base, imageUrl: uploadedImageUrl, caption: imageCaption };
    }
    // flex
    return { ...base, flexTemplate, flexTitle, flexBody };
  }

  function validate(): string | null {
    if (messageType === 'text' && !text.trim()) return 'กรุณาพิมพ์ข้อความก่อนส่ง';
    if (messageType === 'image' && !uploadedImageUrl) {
      return uploadMutation.isPending ? 'กำลังอัปโหลดรูปภาพ กรุณารอสักครู่' : 'กรุณาเลือกรูปภาพก่อนส่ง';
    }
    if (messageType === 'flex' && !flexTitle.trim()) return 'กรุณาระบุชื่อสินค้า/โปรโมชัน';
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
    const payload = buildPayload();
    if (scheduleType === 'scheduled') {
      scheduleMutation.mutate({ ...payload, scheduledAt: `${scheduleDate}T${scheduleTime}:00` });
    } else {
      sendMutation.mutate(payload);
    }
  }

  const isPending = sendMutation.isPending || scheduleMutation.isPending;
  const selectedCount = audienceQuery.data?.[audience] ?? null;

  // ─── Sub-components ─────────────────────────────────────────────────────────

  const MessageTypeToggle = () => (
    <div className="flex gap-2">
      {(
        [
          { type: 'text', icon: <MessageSquare className="size-4" />, label: 'ข้อความ' },
          { type: 'image', icon: <ImageIcon className="size-4" />, label: 'รูปภาพ' },
          { type: 'flex', icon: <LayoutTemplate className="size-4" />, label: 'Flex Card' },
        ] as const
      ).map((item) => (
        <button
          key={item.type}
          type="button"
          onClick={() => setMessageType(item.type)}
          className={cn(
            'flex items-center gap-1.5 rounded-lg border-2 px-4 py-2 text-sm font-medium transition-all',
            messageType === item.type
              ? 'border-blue-500 bg-blue-50 text-blue-700'
              : 'border-gray-200 text-gray-600 hover:border-gray-300',
          )}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  );

  const TextInput = () => (
    <div>
      <Textarea
        className="min-h-[140px]"
        placeholder="พิมพ์ข้อความที่ต้องการ broadcast..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={5000}
      />
      <p className="mt-1 text-right text-xs text-muted-foreground">{text.length} / 5,000 ตัวอักษร</p>
    </div>
  );

  const ImageInput = () => (
    <div className="space-y-3">
      {!imagePreview ? (
        <div
          className="flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed border-gray-300 p-8 text-center hover:border-blue-400 hover:bg-blue-50 transition-colors"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file) {
              const input = fileInputRef.current;
              if (input) {
                const dt = new DataTransfer();
                dt.items.add(file);
                input.files = dt.files;
                handleFileChange({ target: input } as React.ChangeEvent<HTMLInputElement>);
              }
            }
          }}
        >
          <Upload className="size-8 text-gray-400" />
          <div>
            <p className="text-sm font-medium text-gray-700">คลิกหรือลากไฟล์รูปมาวาง</p>
            <p className="text-xs text-gray-400">PNG, JPG, GIF — ไม่เกิน 5MB</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
      ) : (
        <div className="relative inline-block">
          <img src={imagePreview} alt="preview" className="max-h-48 rounded-lg object-cover" />
          <button
            type="button"
            onClick={handleRemoveImage}
            className="absolute -right-2 -top-2 flex size-6 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600"
          >
            <X className="size-3" />
          </button>
          {uploadMutation.isPending && (
            <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40">
              <span className="text-xs text-white">กำลังอัปโหลด...</span>
            </div>
          )}
        </div>
      )}
      <div>
        <label className="mb-1 block text-sm font-medium text-foreground">
          Caption (ไม่บังคับ)
        </label>
        <Input
          placeholder="คำบรรยายใต้รูป..."
          value={imageCaption}
          onChange={(e) => setImageCaption(e.target.value)}
          maxLength={300}
        />
      </div>
    </div>
  );

  const FlexInput = () => (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-sm font-medium text-foreground">Template</label>
        <div className="flex gap-2">
          {FLEX_TEMPLATES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setFlexTemplate(t.value)}
              className={cn(
                'rounded-lg border-2 px-3 py-2 text-sm transition-all',
                flexTemplate === t.value
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-foreground">
          ชื่อสินค้า / โปรโมชัน <span className="text-red-500">*</span>
        </label>
        <Input
          placeholder="เช่น iPhone 16 Pro 128GB"
          value={flexTitle}
          onChange={(e) => setFlexTitle(e.target.value)}
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-foreground">
          รายละเอียด
        </label>
        <Textarea
          placeholder="เช่น ราคาพิเศษ 29,900 บาท ผ่อน 0% 12 เดือน"
          value={flexBody}
          onChange={(e) => setFlexBody(e.target.value)}
          className="min-h-[80px]"
        />
      </div>
    </div>
  );

  const AudienceSelector = () => (
    <div className="grid grid-cols-2 gap-3">
      {AUDIENCE_OPTIONS.map((a) => {
        const count = audienceQuery.data?.[a.key];
        return (
          <label
            key={a.key}
            className={cn(
              'flex cursor-pointer items-center gap-3 rounded-xl border-2 p-4 transition-all',
              audience === a.key
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-200 hover:border-gray-300',
            )}
          >
            <input
              type="radio"
              name="audience"
              value={a.key}
              checked={audience === a.key}
              onChange={() => setAudience(a.key)}
              className="accent-blue-600"
            />
            <div>
              <div className="text-sm font-medium text-foreground">{a.label}</div>
              <div className="text-xs text-muted-foreground">
                {count !== undefined ? `${count.toLocaleString()} คน` : '...'}
              </div>
            </div>
          </label>
        );
      })}
    </div>
  );

  const ScheduleSelector = () => (
    <div className="space-y-3">
      <div className="flex gap-4">
        {(
          [
            { value: 'now', icon: <Send className="size-4" />, label: 'ส่งทันที' },
            { value: 'scheduled', icon: <Clock className="size-4" />, label: 'ตั้งเวลา' },
          ] as const
        ).map((s) => (
          <label
            key={s.value}
            className={cn(
              'flex cursor-pointer items-center gap-2 rounded-xl border-2 px-4 py-3 text-sm font-medium transition-all',
              scheduleType === s.value
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : 'border-gray-200 text-gray-600 hover:border-gray-300',
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
            {s.icon}
            {s.label}
          </label>
        ))}
      </div>
      {scheduleType === 'scheduled' && (
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-muted-foreground">วันที่</label>
            <Input
              type="date"
              value={scheduleDate}
              onChange={(e) => setScheduleDate(e.target.value)}
              min={new Date().toISOString().split('T')[0]}
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs text-muted-foreground">เวลา</label>
            <Input
              type="time"
              value={scheduleTime}
              onChange={(e) => setScheduleTime(e.target.value)}
            />
          </div>
        </div>
      )}
    </div>
  );

  const PreviewPanel = () => (
    <div className="space-y-3">
      <div className="bg-[#7B9EBC] rounded-2xl p-6 max-w-sm mx-auto">
        <div className="bg-white rounded-2xl rounded-tl-sm px-4 py-3 text-sm max-w-[80%] shadow">
          {messageType === 'text' && (
            <p className="whitespace-pre-wrap text-gray-800">
              {text || 'ข้อความจะแสดงที่นี่...'}
            </p>
          )}
          {messageType === 'image' && (
            <div>
              {imagePreview ? (
                <img src={imagePreview} alt="preview" className="rounded-lg max-w-full" />
              ) : (
                <div className="flex h-24 items-center justify-center rounded-lg bg-gray-100 text-xs text-gray-400">
                  รูปภาพจะแสดงที่นี่
                </div>
              )}
              {imageCaption && <p className="mt-1 text-xs text-gray-600">{imageCaption}</p>}
            </div>
          )}
          {messageType === 'flex' && (
            <div className="space-y-1">
              <p className="font-semibold text-gray-900">{flexTitle || 'ชื่อสินค้า/โปรโมชัน'}</p>
              {flexBody && <p className="text-xs text-gray-600">{flexBody}</p>}
              <div className="mt-2 rounded bg-blue-500 px-2 py-1 text-center text-xs text-white">
                ดูรายละเอียด
              </div>
            </div>
          )}
        </div>
      </div>
      <p className="text-center text-sm text-muted-foreground">
        จะส่งถึง{' '}
        <span className="font-semibold text-foreground">
          {selectedCount !== null ? selectedCount.toLocaleString() : '...'} คน
        </span>
        {scheduleType === 'scheduled' && scheduleDate && scheduleTime && (
          <> · วันที่ {new Date(`${scheduleDate}T${scheduleTime}`).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}</>
        )}
      </p>
    </div>
  );

  // ─── Compose Tab ────────────────────────────────────────────────────────────

  const ComposeTab = () => (
    <div className="space-y-4">
      {/* Section 1: Message Type */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">ประเภทข้อความ</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <MessageTypeToggle />
          {messageType === 'text' && <TextInput />}
          {messageType === 'image' && <ImageInput />}
          {messageType === 'flex' && <FlexInput />}
        </CardContent>
      </Card>

      {/* Section 2: Audience */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">กลุ่มเป้าหมาย</CardTitle>
        </CardHeader>
        <CardContent>
          <AudienceSelector />
        </CardContent>
      </Card>

      {/* Section 3: Schedule */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">เวลาส่ง</CardTitle>
        </CardHeader>
        <CardContent>
          <ScheduleSelector />
        </CardContent>
      </Card>

      {/* Section 4: Preview + Send */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Preview & ส่ง</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <PreviewPanel />
          <div className="flex justify-end">
            <Button
              onClick={handleSendClick}
              disabled={isPending || uploadMutation.isPending}
              className="gap-2"
            >
              <Send className="size-4" />
              {isPending
                ? 'กำลังดำเนินการ...'
                : scheduleType === 'scheduled'
                  ? 'ตั้งเวลาส่ง'
                  : 'ส่ง Broadcast'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  // ─── History Tab ────────────────────────────────────────────────────────────

  const HistoryTab = () => {
    const items = historyQuery.data?.data ?? [];
    const total = historyQuery.data?.total ?? 0;
    const totalPages = Math.ceil(total / 20);

    if (historyQuery.isLoading) {
      return (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-gray-100" />
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
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <History className="size-10 text-gray-300" />
          <p className="text-sm text-muted-foreground">ยังไม่มีประวัติการส่ง Broadcast</p>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {items.map((item) => {
          const status = STATUS_MAP[item.status] ?? { label: item.status, variant: 'outline' as const };
          return (
            <div
              key={item.id}
              className="flex items-start justify-between gap-4 rounded-xl border border-border bg-card p-4"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {item.messagePreview || '—'}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    {TYPE_LABEL[item.messageType] ?? item.messageType}
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    {AUDIENCE_LABEL[item.audienceKey] ?? item.audienceKey}
                    {' · '}
                    {item.audienceCount.toLocaleString()} คน
                  </Badge>
                  <Badge variant={status.variant} className="text-xs">
                    {status.label}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {item.status === 'scheduled'
                    ? `ตั้งเวลา: ${formatDateTime(item.scheduledAt)}`
                    : `ส่งเมื่อ: ${formatDateTime(item.sentAt)}`}
                </p>
              </div>
              {item.status === 'scheduled' && (
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 gap-1.5 text-red-600 hover:bg-red-50 hover:text-red-700"
                  onClick={() => setCancelId(item.id)}
                >
                  <Ban className="size-3.5" />
                  ยกเลิก
                </Button>
              )}
            </div>
          );
        })}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
              disabled={historyPage <= 1}
            >
              ก่อนหน้า
            </Button>
            <span className="text-sm text-muted-foreground">
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

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <PageHeader
        title="Broadcast"
        subtitle="ส่งข้อความหาลูกค้า"
        icon={<Send className="size-5" />}
      />

      <Tabs defaultValue="compose">
        <TabsList variant="line" size="md" className="w-full justify-start">
          <TabsTrigger value="compose">สร้างข้อความ</TabsTrigger>
          <TabsTrigger value="history">
            <History className="size-4" />
            ประวัติ
          </TabsTrigger>
        </TabsList>

        <TabsContent value="compose" className="mt-4">
          <ComposeTab />
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <HistoryTab />
        </TabsContent>
      </Tabs>

      {/* Send confirm */}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={scheduleType === 'scheduled' ? 'ยืนยันการตั้งเวลาส่ง' : 'ยืนยันการส่ง Broadcast'}
        description={
          scheduleType === 'scheduled'
            ? `ต้องการตั้งเวลาส่งข้อความไปยัง ${selectedCount?.toLocaleString() ?? '...'} คน ใช่หรือไม่?`
            : `ต้องการส่งข้อความนี้ไปยัง ${selectedCount?.toLocaleString() ?? '...'} คน ทันทีใช่หรือไม่?`
        }
        confirmLabel={scheduleType === 'scheduled' ? 'ตั้งเวลา' : 'ส่งเลย'}
        onConfirm={handleConfirm}
        loading={isPending}
      />

      {/* Cancel confirm */}
      <ConfirmDialog
        open={!!cancelId}
        onOpenChange={(open) => { if (!open) setCancelId(null); }}
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
