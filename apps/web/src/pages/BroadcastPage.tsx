import { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Send,
  MessageSquare,
  Image as ImageIcon,
  Video,
  LayoutTemplate,
  Clock,
  History,
  Upload,
  X,
  Ban,
  Plus,
  Trash2,
  GripVertical,
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

// ─── Types ─────────────────────────────────────────────────────────────────────

type MessageType = 'text' | 'image' | 'video' | 'flex' | 'rich';
type AudienceKey = 'all' | 'active' | 'overdue' | 'new';
type ScheduleType = 'now' | 'scheduled';
type BroadcastStatus = 'sent' | 'scheduled' | 'failed';
type FlexMode = 'template' | 'json';
type FlexTemplateKey = 'product' | 'promotion' | 'custom';

interface TextContent {
  text: string;
}

interface ImageContent {
  imageUrl: string | null;
  imagePreview: string | null;
  imageFile: File | null;
  caption: string;
}

interface VideoContent {
  videoUrl: string | null;
  videoFile: File | null;
  thumbnailUrl: string | null;
  thumbnailFile: File | null;
  thumbnailPreview: string | null;
}

interface FlexContent {
  flexMode: FlexMode;
  templateKey: FlexTemplateKey;
  fields: Record<string, string>;
  jsonText: string;
  jsonValid: boolean;
}

interface RichContent {
  imageUrl: string | null;
  imagePreview: string | null;
  imageFile: File | null;
  linkUrl: string;
}

type MessageContent = TextContent | ImageContent | VideoContent | FlexContent | RichContent;

interface MessageItem {
  id: string;
  type: MessageType;
  content: MessageContent;
}

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
  messageCount?: number;
}

interface BroadcastHistoryResponse {
  data: BroadcastHistoryItem[];
  total: number;
  page: number;
  limit: number;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const AUDIENCE_OPTIONS: { key: AudienceKey; label: string; description: string }[] = [
  { key: 'all', label: 'ทั้งหมด', description: 'ผู้ติดตาม LINE OA ทั้งหมด' },
  { key: 'active', label: 'ลูกค้าเก่า — มีสัญญา', description: 'ลูกค้าที่มีสัญญาผ่อนชำระ' },
  { key: 'overdue', label: 'ค้างชำระ', description: 'ลูกค้าที่ค้างชำระงวด' },
  { key: 'new', label: 'ลูกค้าใหม่', description: 'follow แต่ยังไม่ซื้อ' },
];

const FLEX_TEMPLATES: Record<
  FlexTemplateKey,
  { name: string; fields: string[] }
> = {
  product: {
    name: '📱 สินค้า',
    fields: ['ชื่อสินค้า', 'ราคา', 'รายละเอียด', 'รูปภาพ URL', 'ลิงก์'],
  },
  promotion: {
    name: '🎁 โปรโมชัน',
    fields: ['ชื่อโปร', 'รายละเอียด', 'ส่วนลด', 'วันหมดอายุ', 'ลิงก์'],
  },
  custom: {
    name: '✏️ กำหนดเอง',
    fields: ['หัวข้อ', 'เนื้อหา', 'ปุ่มกด', 'ลิงก์'],
  },
};

const STATUS_MAP: Record<
  BroadcastStatus,
  { label: string; variant: 'success' | 'secondary' | 'destructive' | 'outline' }
> = {
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

const MSG_TYPE_BUTTONS: { type: MessageType; emoji: string; label: string }[] = [
  { type: 'text', emoji: '💬', label: 'ข้อความ' },
  { type: 'image', emoji: '🖼️', label: 'รูปภาพ' },
  { type: 'video', emoji: '🎬', label: 'วิดีโอ' },
  { type: 'flex', emoji: '📦', label: 'Flex Card' },
  { type: 'rich', emoji: '🖼️', label: 'Rich Msg' },
];

// ─── Factories ─────────────────────────────────────────────────────────────────

function makeDefaultContent(type: MessageType): MessageContent {
  switch (type) {
    case 'text':
      return { text: '' } as TextContent;
    case 'image':
      return { imageUrl: null, imagePreview: null, imageFile: null, caption: '' } as ImageContent;
    case 'video':
      return {
        videoUrl: null,
        videoFile: null,
        thumbnailUrl: null,
        thumbnailFile: null,
        thumbnailPreview: null,
      } as VideoContent;
    case 'flex':
      return {
        flexMode: 'template',
        templateKey: 'product',
        fields: {},
        jsonText: '{\n  "type": "bubble",\n  "body": {\n    "type": "box",\n    "layout": "vertical",\n    "contents": []\n  }\n}',
        jsonValid: true,
      } as FlexContent;
    case 'rich':
      return {
        imageUrl: null,
        imagePreview: null,
        imageFile: null,
        linkUrl: '',
      } as RichContent;
  }
}

function makeMessage(type: MessageType = 'text'): MessageItem {
  return { id: crypto.randomUUID(), type, content: makeDefaultContent(type) };
}

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

function buildFlexJson(content: FlexContent): object {
  const { templateKey, fields } = content;
  const tpl = FLEX_TEMPLATES[templateKey];
  const title = fields[tpl.fields[0]] || tpl.name;
  const body = fields[tpl.fields[1]] || '';
  return {
    type: 'bubble',
    hero:
      templateKey === 'product' && fields['รูปภาพ URL']
        ? {
            type: 'image',
            url: fields['รูปภาพ URL'],
            size: 'full',
            aspectRatio: '20:13',
            aspectMode: 'cover',
          }
        : undefined,
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        { type: 'text', text: title, weight: 'bold', size: 'lg', wrap: true },
        ...(body ? [{ type: 'text', text: body, size: 'sm', color: '#555555', wrap: true }] : []),
        ...(templateKey === 'promotion' && fields['ส่วนลด']
          ? [
              {
                type: 'text',
                text: `ลด ${fields['ส่วนลด']}`,
                size: 'xl',
                weight: 'bold',
                color: '#e74c3c',
              },
            ]
          : []),
      ].filter(Boolean),
    },
    footer: fields[tpl.fields[tpl.fields.length - 1]]
      ? {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'button',
              style: 'primary',
              action: {
                type: 'uri',
                label: templateKey === 'custom' ? fields['ปุ่มกด'] || 'ดูเพิ่มเติม' : 'ดูเพิ่มเติม',
                uri: fields[tpl.fields[tpl.fields.length - 1]],
              },
            },
          ],
        }
      : undefined,
  };
}

// ─── Sub-components ─────────────────────────────────────────────────────────────

interface FileUploadZoneProps {
  preview: string | null;
  onFile: (file: File) => void;
  onRemove: () => void;
  accept?: string;
  label?: string;
  isUploading?: boolean;
}

function FileUploadZone({
  preview,
  onFile,
  onRemove,
  accept = 'image/*',
  label = 'คลิกหรือลากไฟล์มาวาง',
  isUploading = false,
}: FileUploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onFile(file);
  }

  if (preview) {
    return (
      <div className="relative inline-block">
        <img src={preview} alt="preview" className="max-h-40 rounded-lg object-cover" />
        <button
          type="button"
          onClick={onRemove}
          className="absolute -right-2 -top-2 flex size-5 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600"
        >
          <X className="size-3" />
        </button>
        {isUploading && (
          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40">
            <span className="text-xs text-white">กำลังอัปโหลด...</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-gray-300 p-6 text-center hover:border-blue-400 hover:bg-blue-50 transition-colors"
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
    >
      <Upload className="size-7 text-gray-400" />
      <div>
        <p className="text-sm font-medium text-gray-700">{label}</p>
        <p className="text-xs text-gray-400">PNG, JPG — ไม่เกิน 5MB</p>
      </div>
      <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={handleChange} />
    </div>
  );
}

interface FlexPreviewCardProps {
  content: FlexContent;
}

function FlexPreviewCard({ content }: FlexPreviewCardProps) {
  let jsonObj: Record<string, unknown> | null = null;
  try {
    if (content.flexMode === 'json') {
      jsonObj = JSON.parse(content.jsonText);
    } else {
      jsonObj = buildFlexJson(content) as Record<string, unknown>;
    }
  } catch {
    // invalid JSON
  }

  if (!jsonObj) {
    return (
      <div className="flex h-24 items-center justify-center rounded-lg bg-gray-100 text-xs text-gray-400">
        JSON ไม่ถูกต้อง
      </div>
    );
  }

  const body = jsonObj.body as Record<string, unknown> | undefined;
  const contents = body?.contents as Array<Record<string, unknown>> | undefined;
  const titleItem = contents?.find((c) => c.weight === 'bold');
  const bodyItems = contents?.filter((c) => c.weight !== 'bold') ?? [];
  const hero = jsonObj.hero as Record<string, unknown> | undefined;
  const footer = jsonObj.footer as Record<string, unknown> | undefined;
  const footerContents = footer?.contents as Array<Record<string, unknown>> | undefined;
  const footerBtn = footerContents?.[0];
  const action = footerBtn?.action as Record<string, unknown> | undefined;

  const heroUrl = typeof hero?.url === 'string' ? hero.url : null;

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow text-xs max-w-[200px]">
      {heroUrl && (
        <img
          src={heroUrl}
          alt="flex hero"
          className="h-24 w-full object-cover"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      )}
      <div className="p-3 space-y-1">
        {titleItem && (
          <p className="font-bold text-sm text-gray-900 line-clamp-2">
            {titleItem.text as string}
          </p>
        )}
        {bodyItems.map((item, i) => (
          <p key={i} className="text-gray-500 line-clamp-2">
            {item.text as string}
          </p>
        ))}
      </div>
      {action && (
        <div className="px-3 pb-3">
          <div className="rounded bg-blue-500 py-1 text-center text-white text-xs font-medium">
            {action.label as string || 'ดูเพิ่มเติม'}
          </div>
        </div>
      )}
    </div>
  );
}

interface MessagePreviewBubbleProps {
  message: MessageItem;
}

function MessagePreviewBubble({ message }: MessagePreviewBubbleProps) {
  if (message.type === 'text') {
    const c = message.content as TextContent;
    return (
      <div className="bg-white rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm max-w-[85%] shadow">
        <p className="whitespace-pre-wrap text-gray-800 text-xs">
          {c.text || <span className="text-gray-400">ข้อความจะแสดงที่นี่...</span>}
        </p>
      </div>
    );
  }

  if (message.type === 'image') {
    const c = message.content as ImageContent;
    return (
      <div className="bg-white rounded-2xl rounded-tl-sm overflow-hidden max-w-[85%] shadow">
        {c.imagePreview ? (
          <img src={c.imagePreview} alt="preview" className="max-w-full rounded-t-2xl" />
        ) : (
          <div className="flex h-20 items-center justify-center bg-gray-100 text-xs text-gray-400">
            รูปภาพจะแสดงที่นี่
          </div>
        )}
        {c.caption && <p className="px-3 py-1.5 text-xs text-gray-600">{c.caption}</p>}
      </div>
    );
  }

  if (message.type === 'video') {
    const c = message.content as VideoContent;
    return (
      <div className="bg-white rounded-2xl rounded-tl-sm overflow-hidden max-w-[85%] shadow">
        {c.thumbnailPreview ? (
          <div className="relative">
            <img src={c.thumbnailPreview} alt="thumbnail" className="max-w-full" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex size-10 items-center justify-center rounded-full bg-black/50">
                <Video className="size-5 text-white" />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-20 items-center justify-center bg-gray-100 text-xs text-gray-400 gap-2">
            <Video className="size-4" />
            วิดีโอจะแสดงที่นี่
          </div>
        )}
      </div>
    );
  }

  if (message.type === 'flex') {
    const c = message.content as FlexContent;
    return <FlexPreviewCard content={c} />;
  }

  if (message.type === 'rich') {
    const c = message.content as RichContent;
    return (
      <div className="bg-white rounded-2xl rounded-tl-sm overflow-hidden max-w-[85%] shadow">
        {c.imagePreview ? (
          <img src={c.imagePreview} alt="rich" className="max-w-full" />
        ) : (
          <div className="flex h-20 items-center justify-center bg-gray-100 text-xs text-gray-400">
            Rich Message
          </div>
        )}
      </div>
    );
  }

  return null;
}

// ─── Per-Message Content Editors ─────────────────────────────────────────────

interface MessageEditorProps {
  message: MessageItem;
  onChange: (updated: MessageItem) => void;
  uploadingIds: Set<string>;
  setUploadingIds: React.Dispatch<React.SetStateAction<Set<string>>>;
}

function TextEditor({ message, onChange }: MessageEditorProps) {
  const c = message.content as TextContent;
  return (
    <div>
      <Textarea
        className="min-h-[120px]"
        placeholder="พิมพ์ข้อความที่ต้องการ broadcast..."
        value={c.text}
        onChange={(e) =>
          onChange({ ...message, content: { ...c, text: e.target.value } })
        }
        maxLength={5000}
      />
      <p className="mt-1 text-right text-xs text-muted-foreground">
        {c.text.length} / 5,000 ตัวอักษร
      </p>
    </div>
  );
}

function ImageEditor({ message, onChange, uploadingIds, setUploadingIds }: MessageEditorProps) {
  const c = message.content as ImageContent;

  function handleFile(file: File) {
    if (!file.type.startsWith('image/')) {
      toast.error('กรุณาเลือกไฟล์รูปภาพเท่านั้น');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const preview = ev.target?.result as string;
      onChange({ ...message, content: { ...c, imageFile: file, imagePreview: preview } });
    };
    reader.readAsDataURL(file);

    // Upload
    setUploadingIds((prev) => new Set(prev).add(message.id));
    const fd = new FormData();
    fd.append('file', file);
    api
      .post<{ url: string }>('/line-oa/broadcast/upload-image', fd)
      .then((res) => {
        onChange({ ...message, content: { ...c, imageFile: file, imageUrl: res.data.url } });
      })
      .catch((err) => toast.error(getErrorMessage(err)))
      .finally(() =>
        setUploadingIds((prev) => {
          const next = new Set(prev);
          next.delete(message.id);
          return next;
        }),
      );
  }

  function handleRemove() {
    onChange({ ...message, content: makeDefaultContent('image') });
  }

  return (
    <div className="space-y-3">
      <FileUploadZone
        preview={c.imagePreview}
        onFile={handleFile}
        onRemove={handleRemove}
        isUploading={uploadingIds.has(message.id)}
      />
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          Caption (ไม่บังคับ)
        </label>
        <Input
          placeholder="คำบรรยายใต้รูป..."
          value={c.caption}
          onChange={(e) =>
            onChange({ ...message, content: { ...c, caption: e.target.value } })
          }
          maxLength={300}
        />
      </div>
    </div>
  );
}

function VideoEditor({ message, onChange, uploadingIds, setUploadingIds }: MessageEditorProps) {
  const c = message.content as VideoContent;

  function handleVideoFile(file: File) {
    if (!file.type.startsWith('video/')) {
      toast.error('กรุณาเลือกไฟล์วิดีโอเท่านั้น');
      return;
    }
    setUploadingIds((prev) => new Set(prev).add(message.id + '-video'));
    const fd = new FormData();
    fd.append('file', file);
    api
      .post<{ url: string }>('/line-oa/broadcast/upload-image', fd)
      .then((res) => {
        onChange({ ...message, content: { ...c, videoFile: file, videoUrl: res.data.url } });
      })
      .catch((err) => toast.error(getErrorMessage(err)))
      .finally(() =>
        setUploadingIds((prev) => {
          const next = new Set(prev);
          next.delete(message.id + '-video');
          return next;
        }),
      );
  }

  function handleThumbFile(file: File) {
    if (!file.type.startsWith('image/')) {
      toast.error('กรุณาเลือกไฟล์รูปภาพสำหรับ thumbnail');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const preview = ev.target?.result as string;
      onChange({
        ...message,
        content: { ...c, thumbnailFile: file, thumbnailPreview: preview },
      });
    };
    reader.readAsDataURL(file);
    setUploadingIds((prev) => new Set(prev).add(message.id + '-thumb'));
    const fd = new FormData();
    fd.append('file', file);
    api
      .post<{ url: string }>('/line-oa/broadcast/upload-image', fd)
      .then((res) => {
        onChange({ ...message, content: { ...c, thumbnailFile: file, thumbnailUrl: res.data.url } });
      })
      .catch((err) => toast.error(getErrorMessage(err)))
      .finally(() =>
        setUploadingIds((prev) => {
          const next = new Set(prev);
          next.delete(message.id + '-thumb');
          return next;
        }),
      );
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">ไฟล์วิดีโอ</label>
        <FileUploadZone
          preview={null}
          onFile={handleVideoFile}
          onRemove={() => onChange({ ...message, content: { ...c, videoFile: null, videoUrl: null } })}
          accept="video/*"
          label={c.videoUrl ? `✅ อัปโหลดแล้ว` : 'คลิกหรือลากไฟล์วิดีโอมาวาง'}
          isUploading={uploadingIds.has(message.id + '-video')}
        />
        {c.videoUrl && (
          <p className="mt-1 text-xs text-green-600 truncate">✅ {c.videoUrl}</p>
        )}
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">Thumbnail (รูปปก)</label>
        <FileUploadZone
          preview={c.thumbnailPreview}
          onFile={handleThumbFile}
          onRemove={() =>
            onChange({
              ...message,
              content: { ...c, thumbnailFile: null, thumbnailUrl: null, thumbnailPreview: null },
            })
          }
          isUploading={uploadingIds.has(message.id + '-thumb')}
        />
      </div>
    </div>
  );
}

function FlexEditor({ message, onChange }: MessageEditorProps) {
  const c = message.content as FlexContent;
  const tpl = FLEX_TEMPLATES[c.templateKey];

  return (
    <div className="space-y-4">
      {/* Mode toggle */}
      <div className="flex gap-1 rounded-lg bg-gray-100 p-1 w-fit">
        {(['template', 'json'] as FlexMode[]).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => onChange({ ...message, content: { ...c, flexMode: mode } })}
            className={cn(
              'rounded-md px-4 py-1.5 text-sm font-medium transition-all',
              c.flexMode === mode
                ? 'bg-white text-blue-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700',
            )}
          >
            {mode === 'template' ? 'Template' : 'JSON'}
          </button>
        ))}
      </div>

      {c.flexMode === 'template' ? (
        <div className="space-y-3">
          {/* Template selector */}
          <div className="flex flex-wrap gap-2">
            {(Object.entries(FLEX_TEMPLATES) as [FlexTemplateKey, { name: string; fields: string[] }][]).map(
              ([key, t]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() =>
                    onChange({
                      ...message,
                      content: { ...c, templateKey: key, fields: {} },
                    })
                  }
                  className={cn(
                    'rounded-lg border-2 px-3 py-1.5 text-sm transition-all',
                    c.templateKey === key
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300',
                  )}
                >
                  {t.name}
                </button>
              ),
            )}
          </div>
          {/* Dynamic fields */}
          <div className="space-y-2">
            {tpl.fields.map((fieldName) => (
              <div key={fieldName}>
                <label className="mb-0.5 block text-xs font-medium text-muted-foreground">
                  {fieldName}
                  {fieldName === tpl.fields[0] && <span className="text-red-500 ml-0.5">*</span>}
                </label>
                <Input
                  placeholder={fieldName}
                  value={c.fields[fieldName] || ''}
                  onChange={(e) =>
                    onChange({
                      ...message,
                      content: { ...c, fields: { ...c.fields, [fieldName]: e.target.value } },
                    })
                  }
                />
              </div>
            ))}
          </div>
          {/* Mini preview */}
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Preview</p>
            <FlexPreviewCard content={c} />
          </div>
        </div>
      ) : (
        /* JSON mode */
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="space-y-1">
            <Textarea
              className="font-mono text-xs bg-gray-900 text-green-400 min-h-[200px] resize-y"
              value={c.jsonText}
              onChange={(e) => {
                const text = e.target.value;
                let valid = false;
                try {
                  JSON.parse(text);
                  valid = true;
                } catch {
                  valid = false;
                }
                onChange({ ...message, content: { ...c, jsonText: text, jsonValid: valid } });
              }}
            />
            {c.jsonValid ? (
              <span className="text-xs text-green-600">✅ JSON ถูกต้อง</span>
            ) : (
              <span className="text-xs text-red-600">❌ JSON ไม่ถูกต้อง</span>
            )}
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Live Preview</p>
            <FlexPreviewCard content={c} />
          </div>
        </div>
      )}
    </div>
  );
}

function RichEditor({ message, onChange, uploadingIds, setUploadingIds }: MessageEditorProps) {
  const c = message.content as RichContent;

  function handleFile(file: File) {
    if (!file.type.startsWith('image/')) {
      toast.error('กรุณาเลือกไฟล์รูปภาพเท่านั้น');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const preview = ev.target?.result as string;
      onChange({ ...message, content: { ...c, imageFile: file, imagePreview: preview } });
    };
    reader.readAsDataURL(file);

    setUploadingIds((prev) => new Set(prev).add(message.id));
    const fd = new FormData();
    fd.append('file', file);
    api
      .post<{ url: string }>('/line-oa/broadcast/upload-image', fd)
      .then((res) => {
        onChange({ ...message, content: { ...c, imageFile: file, imageUrl: res.data.url } });
      })
      .catch((err) => toast.error(getErrorMessage(err)))
      .finally(() =>
        setUploadingIds((prev) => {
          const next = new Set(prev);
          next.delete(message.id);
          return next;
        }),
      );
  }

  return (
    <div className="space-y-3">
      <FileUploadZone
        preview={c.imagePreview}
        onFile={handleFile}
        onRemove={() => onChange({ ...message, content: makeDefaultContent('rich') })}
        isUploading={uploadingIds.has(message.id)}
      />
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          ลิงก์เมื่อกด (ไม่บังคับ)
        </label>
        <Input
          placeholder="https://..."
          value={c.linkUrl}
          onChange={(e) =>
            onChange({ ...message, content: { ...c, linkUrl: e.target.value } })
          }
        />
      </div>
    </div>
  );
}

function MessageEditor(props: MessageEditorProps) {
  switch (props.message.type) {
    case 'text':
      return <TextEditor {...props} />;
    case 'image':
      return <ImageEditor {...props} />;
    case 'video':
      return <VideoEditor {...props} />;
    case 'flex':
      return <FlexEditor {...props} />;
    case 'rich':
      return <RichEditor {...props} />;
  }
}

// ─── Message Card ─────────────────────────────────────────────────────────────

interface MessageCardProps {
  message: MessageItem;
  index: number;
  total: number;
  onChange: (updated: MessageItem) => void;
  onDelete: () => void;
  uploadingIds: Set<string>;
  setUploadingIds: React.Dispatch<React.SetStateAction<Set<string>>>;
}

function MessageCard({
  message,
  index,
  total,
  onChange,
  onDelete,
  uploadingIds,
  setUploadingIds,
}: MessageCardProps) {
  function changeType(type: MessageType) {
    if (type === message.type) return;
    onChange({ ...message, type, content: makeDefaultContent(type) });
  }

  return (
    <Card className="relative">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GripVertical className="size-4 text-gray-400" />
            <CardTitle className="text-sm font-medium">ข้อความที่ {index + 1}</CardTitle>
          </div>
          {total > 1 && (
            <button
              type="button"
              onClick={onDelete}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-red-500 hover:bg-red-50 transition-colors"
            >
              <Trash2 className="size-3.5" />
              ลบ
            </button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Type selector */}
        <div className="flex flex-wrap gap-1.5">
          {MSG_TYPE_BUTTONS.map((btn) => (
            <button
              key={btn.type}
              type="button"
              onClick={() => changeType(btn.type)}
              className={cn(
                'flex items-center gap-1 rounded-lg border-2 px-3 py-1.5 text-xs font-medium transition-all',
                message.type === btn.type
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 text-gray-500 hover:border-gray-300',
              )}
            >
              <span>{btn.emoji}</span>
              {btn.label}
            </button>
          ))}
        </div>
        {/* Content editor */}
        <MessageEditor
          message={message}
          onChange={onChange}
          uploadingIds={uploadingIds}
          setUploadingIds={setUploadingIds}
        />
      </CardContent>
    </Card>
  );
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

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  function resetCompose() {
    setMessages([makeMessage('text')]);
    setScheduleType('now');
    setScheduleDate('');
    setScheduleTime('');
    setUploadingIds(new Set());
  }

  const updateMessage = useCallback((updated: MessageItem) => {
    setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
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
    const payload = { messages: apiMessages, audience };
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

  // ─── Compose Tab ──────────────────────────────────────────────────────────────

  const ComposeTab = () => (
    <div className="space-y-4">
      {/* Messages */}
      <div className="space-y-3">
        {messages.map((msg, index) => (
          <MessageCard
            key={msg.id}
            message={msg}
            index={index}
            total={messages.length}
            onChange={updateMessage}
            onDelete={() => deleteMessage(msg.id)}
            uploadingIds={uploadingIds}
            setUploadingIds={setUploadingIds}
          />
        ))}
        {messages.length < 5 && (
          <Button
            variant="outline"
            className="w-full border-dashed gap-2"
            onClick={addMessage}
          >
            <Plus className="size-4" />
            เพิ่มข้อความ (เหลือ {5 - messages.length} ข้อความ)
          </Button>
        )}
      </div>

      {/* Audience */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">กลุ่มเป้าหมาย</CardTitle>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>

      {/* Schedule */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">เวลาส่ง</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex gap-3">
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
        </CardContent>
      </Card>

      {/* Preview + Summary + Send */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Preview & ส่ง</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* LINE chat preview */}
          <div className="bg-[#7b9ebc] rounded-2xl p-5 max-w-xs mx-auto space-y-2">
            {messages.map((msg) => (
              <MessagePreviewBubble key={msg.id} message={msg} />
            ))}
          </div>

          {/* Summary box */}
          <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800 space-y-0.5">
            <p className="font-medium">สรุป</p>
            <p>• {messages.length} ข้อความ</p>
            <p>
              • ส่งถึง{' '}
              <span className="font-semibold">
                {selectedCount !== null ? selectedCount.toLocaleString() : '...'} คน
              </span>{' '}
              ({AUDIENCE_LABEL[audience]})
            </p>
            <p>
              •{' '}
              {scheduleType === 'now'
                ? 'ส่งทันที'
                : scheduleDate && scheduleTime
                  ? `ตั้งเวลา ${new Date(`${scheduleDate}T${scheduleTime}`).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}`
                  : 'ยังไม่ได้ตั้งเวลา'}
            </p>
          </div>

          <div className="flex justify-end">
            <Button
              onClick={handleSendClick}
              disabled={isPending || uploadingIds.size > 0}
              className="gap-2"
            >
              🚀
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

  // ─── History Tab ──────────────────────────────────────────────────────────────

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
                  {item.messageCount && item.messageCount > 1 && (
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      +{item.messageCount - 1} more
                    </span>
                  )}
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

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
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
            ? `ต้องการตั้งเวลาส่ง ${messages.length} ข้อความ ไปยัง ${selectedCount?.toLocaleString() ?? '...'} คน ใช่หรือไม่?`
            : `ต้องการส่ง ${messages.length} ข้อความ ไปยัง ${selectedCount?.toLocaleString() ?? '...'} คน ทันทีใช่หรือไม่?`
        }
        confirmLabel={scheduleType === 'scheduled' ? 'ตั้งเวลา' : 'ส่งเลย'}
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
