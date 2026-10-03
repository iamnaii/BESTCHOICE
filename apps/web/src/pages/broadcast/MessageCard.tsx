import { FlexContentEditor } from '@/components/line-message/FlexContentEditor';
import { useRef } from 'react';

import { toast } from 'sonner';
import {
  MessageSquare,
  Image as ImageIcon,
  Video,
  LayoutTemplate,
  Upload,
  X,
  Trash2,
  GripVertical,
  CheckCircle2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import api, { getErrorMessage } from '@/lib/api';

import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import {
  makeDefaultContent,
  type MessageType,
  type TextContent,
  type ImageContent,
  type VideoContent,
  type FlexContent,
  type RichContent,
  type MessageItem,
} from './message';

function uploadBroadcastFile(file: File, kind: 'image' | 'video' | 'video-thumbnail' = 'image') {
  const data = new FormData();
  data.append('file', file);
  return api.post<{ url: string }>(`/line-oa/broadcast/upload-${kind}`, data);
}

function uploadMessageImage(
  { message, onChange, setUploadingIds }: MessageEditorProps,
  file: File,
) {
  if (!file.type.startsWith('image/')) {
    toast.error('กรุณาเลือกไฟล์รูปภาพเท่านั้น');
    return;
  }
  let uploaded = false;
  const reader = new FileReader();
  reader.onload = (ev) => {
    if (uploaded) return; // A late local preview must not erase the server URL.
    const preview = ev.target?.result as string;
    onChange((current) => current.type !== message.type ? current : ({ ...current, content: { ...current.content, imageFile: file, imagePreview: preview } }));
  };
  reader.readAsDataURL(file);

  // Upload
  setUploadingIds((prev) => new Set(prev).add(message.id));
  uploadBroadcastFile(file)
    .then((res) => {
      uploaded = true;
      onChange((current) => current.type !== message.type ? current : ({ ...current, content: { ...current.content, imageFile: file, imageUrl: res.data.url, imagePreview: res.data.url } }));
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

const MSG_TYPE_BUTTONS: { type: MessageType; icon: React.ReactNode; label: string }[] = [
  { type: 'text', icon: <MessageSquare className="size-3.5" />, label: 'ข้อความ' },
  { type: 'image', icon: <ImageIcon className="size-3.5" />, label: 'รูปภาพ' },
  { type: 'video', icon: <Video className="size-3.5" />, label: 'วิดีโอ' },
  { type: 'flex', icon: <LayoutTemplate className="size-3.5" />, label: 'Flex Card' },
  { type: 'rich', icon: <ImageIcon className="size-3.5" />, label: 'Rich Msg' },
];

interface FileUploadZoneProps {
  preview: string | null;
  onFile: (file: File) => void;
  onRemove: () => void;
  accept?: string;
  label?: string;
  isUploading?: boolean;
  hint?: string;
}

function FileUploadZone({
  preview,
  onFile,
  onRemove,
  accept = 'image/*',
  label = 'คลิกหรือลากไฟล์มาวาง',
  isUploading = false,
  hint = 'PNG, JPG — ไม่เกิน 10MB',
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
        <img src={preview} alt="preview" className="max-h-40 rounded-xl object-cover shadow-sm" />
        <button
          type="button"
          onClick={onRemove}
          className="absolute -right-2 -top-2 flex size-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm transition-colors"
        >
          <X className="size-3" />
        </button>
        {isUploading && (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/40">
            <span className="text-xs text-white">กำลังอัปโหลด...</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border p-6 text-center hover:border-primary hover:bg-primary/5 transition-all duration-200"
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
    >
      <div className="flex size-10 items-center justify-center rounded-full bg-muted">
        <Upload className="size-5 text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground/80">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={handleChange}
      />
    </div>
  );
}

interface MessageEditorProps {
  message: MessageItem;
  onChange: React.Dispatch<React.SetStateAction<MessageItem>>;
  uploadingIds: Set<string>;
  setUploadingIds: React.Dispatch<React.SetStateAction<Set<string>>>;
}

function TextEditor({ message, onChange }: MessageEditorProps) {
  const c = message.content as TextContent;
  return (
    <div>
      <Textarea
        className="min-h-[120px] resize-none"
        placeholder="พิมพ์ข้อความที่ต้องการ broadcast..."
        value={c.text}
        onChange={(e) => onChange({ ...message, content: { ...c, text: e.target.value } })}
        maxLength={5000}
      />
      <p className="mt-1.5 text-right text-xs text-muted-foreground">
        {c.text.length} / 5,000 ตัวอักษร
      </p>
    </div>
  );
}

function ImageEditor(props: MessageEditorProps) {
  const { message, onChange, uploadingIds } = props;
  const c = message.content as ImageContent;

  function handleRemove() {
    onChange({ ...message, content: makeDefaultContent('image') });
  }

  return (
    <div className="space-y-3">
      <FileUploadZone
        preview={c.imagePreview}
        onFile={(file) => uploadMessageImage(props, file)}
        onRemove={handleRemove}
        isUploading={uploadingIds.has(message.id)}
      />
      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground/80">
          Caption <span className="text-muted-foreground font-normal">(ไม่บังคับ)</span>
        </label>
        <Input
          placeholder="คำบรรยายใต้รูป..."
          value={c.caption}
          onChange={(e) => onChange({ ...message, content: { ...c, caption: e.target.value } })}
          maxLength={300}
        />
      </div>
    </div>
  );
}

function VideoEditor({
  message,
  onChange,
  uploadingIds,
  setUploadingIds,
}: MessageEditorProps) {
  const c = message.content as VideoContent;

  function handleVideoFile(file: File) {
    if (file.type !== 'video/mp4') {
      toast.error('กรุณาเลือกไฟล์ MP4 เท่านั้น');
      return;
    }
    if (file.size > 10 * 1024 * 1024) { toast.error('วิดีโอต้องมีขนาดไม่เกิน 10MB'); return; }
    setUploadingIds((prev) => new Set(prev).add(message.id + '-video'));
    uploadBroadcastFile(file, 'video')
      .then((res) => {
        onChange((current) => current.type !== 'video' ? current : ({ ...current, content: { ...current.content, videoFile: file, videoUrl: res.data.url } }));
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
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      toast.error('รูปปกต้องเป็น JPEG หรือ PNG');
      return;
    }
    if (file.size > 1024 * 1024) { toast.error('รูปปกต้องมีขนาดไม่เกิน 1MB'); return; }
    let uploaded = false;
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (uploaded) return; // Preserve the URL if the upload completes first.
      const preview = ev.target?.result as string;
      onChange((current) => current.type !== 'video' ? current : ({ ...current, content: { ...current.content, thumbnailFile: file, thumbnailPreview: preview } }));
    };
    reader.readAsDataURL(file);
    setUploadingIds((prev) => new Set(prev).add(message.id + '-thumb'));
    uploadBroadcastFile(file, 'video-thumbnail')
      .then((res) => {
        uploaded = true;
        onChange((current) => current.type !== 'video' ? current : ({ ...current, content: { ...current.content, thumbnailFile: file, thumbnailUrl: res.data.url, thumbnailPreview: res.data.url } }));
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
    <div className="space-y-4">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground/80">ไฟล์วิดีโอ (MP4 ไม่เกิน 10MB)</label>
        <FileUploadZone
          preview={null}
          onFile={handleVideoFile}
          onRemove={() =>
            onChange({ ...message, content: { ...c, videoFile: null, videoUrl: null } })
          }
          hint="MP4 — ไม่เกิน 10MB"
          accept="video/mp4"
          label={c.videoUrl ? `อัปโหลดแล้ว` : 'คลิกหรือลากไฟล์วิดีโอมาวาง'}
          isUploading={uploadingIds.has(message.id + '-video')}
        />
        {c.videoUrl && (
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-success">
            <CheckCircle2 className="size-3.5" />
            <span className="truncate">{c.videoUrl}</span>
          </p>
        )}
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground/80">
          รูปปก (JPEG/PNG ไม่เกิน 1MB)
        </label>
        <FileUploadZone
          hint="JPEG, PNG — ไม่เกิน 1MB"
          accept="image/jpeg,image/png"
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
  return (
    <FlexContentEditor content={c} onChange={(content) => onChange({ ...message, content })}>
    </FlexContentEditor>
  );
}

function RichEditor(props: MessageEditorProps) {
  const { message, onChange, uploadingIds } = props;
  const c = message.content as RichContent;

  return (
    <div className="space-y-4">
      <FileUploadZone
        preview={c.imagePreview}
        onFile={(file) => uploadMessageImage(props, file)}
        onRemove={() => onChange({ ...message, content: makeDefaultContent('rich') })}
        isUploading={uploadingIds.has(message.id)}
      />
      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground/80">
          ลิงก์เมื่อกด <span className="text-muted-foreground font-normal">(ไม่บังคับ)</span>
        </label>
        <Input
          placeholder="https://..."
          value={c.linkUrl}
          onChange={(e) => onChange({ ...message, content: { ...c, linkUrl: e.target.value } })}
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

interface MessageCardProps {
  message: MessageItem;
  index: number;
  total: number;
  onChange: React.Dispatch<React.SetStateAction<MessageItem>>;
  onDelete: () => void;
  uploadingIds: Set<string>;
  setUploadingIds: React.Dispatch<React.SetStateAction<Set<string>>>;
}

export function MessageCard({
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
    <Card className="relative shadow-sm hover:shadow-md transition-shadow duration-200 ring-1 ring-primary/10">
      <CardHeader className="pb-3 bg-muted/50 rounded-t-xl border-b border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <GripVertical className="size-4 text-muted-foreground" />
            <div className="flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold shadow-sm">
              {index + 1}
            </div>
            <CardTitle className="text-sm font-semibold text-foreground/80">
              ข้อความที่ {index + 1}
            </CardTitle>
          </div>
          {total > 1 && (
            <button
              type="button"
              onClick={onDelete}
              className="flex items-center gap-1 rounded-full px-3 py-1 text-xs text-destructive hover:bg-destructive/10 transition-all duration-200"
            >
              <Trash2 className="size-3.5" />
              ลบ
            </button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {/* Type selector */}
        <div className="flex flex-wrap gap-1.5">
          {MSG_TYPE_BUTTONS.map((btn) => (
            <button
              key={btn.type}
              type="button"
              onClick={() => changeType(btn.type)}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-200',
                message.type === btn.type
                  ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                  : 'border-border text-muted-foreground hover:border-primary/60 hover:text-primary bg-card',
              )}
            >
              {btn.icon}
              {btn.label}
            </button>
          ))}
        </div>
        {/* Content editor */}
        <div className="transition-all duration-300">
          <MessageEditor
            message={message}
            onChange={onChange}
            uploadingIds={uploadingIds}
            setUploadingIds={setUploadingIds}
          />
        </div>
      </CardContent>
    </Card>
  );
}
