import { FlexContentEditor } from '@/components/line-message/FlexContentEditor';
import type { FlexContent as BaseFlexContent } from '@/lib/line-flex';
import { FlexPreviewCard } from '@/components/line-message/FlexPreviewCard';
import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { MessageSquareMore, Save, RotateCcw, MessageSquare, Image as ImageIcon, LayoutTemplate, Plus, Trash2, GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// ─── Types ─────────────────────────────────────────────────────────────────────

type MessageType = 'text' | 'image' | 'flex';

interface TextContent {
  text: string;
}

interface ImageContent {
  imageUrl: string;
  caption: string;
}

interface FlexContent extends BaseFlexContent {
  altText: string;
}

type MessageContent = TextContent | ImageContent | FlexContent;

interface MessageItem {
  id: string;
  type: MessageType;
  content: MessageContent;
}

interface GreetingResponse {
  messages: Array<{ type: string; content: any }>;
  showQuickReply: boolean;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const MSG_TYPE_BUTTONS: { type: MessageType; icon: React.ReactNode; label: string }[] = [
  { type: 'text', icon: <MessageSquare className="size-3.5" />, label: 'ข้อความ' },
  { type: 'image', icon: <ImageIcon className="size-3.5" />, label: 'รูปภาพ' },
  { type: 'flex', icon: <LayoutTemplate className="size-3.5" />, label: 'Flex Card' },
];

const DEFAULT_MESSAGES: MessageItem[] = [
  {
    id: '1',
    type: 'text',
    content: {
      text: 'สวัสดีครับ! ยินดีต้อนรับสู่ BESTCHOICE 🎉\n\nร้านมือถือผ่อนราคาดี ดาวน์น้อย อนุมัติไว\nสนใจสอบถามได้เลยครับ/ค่ะ',
    } as TextContent,
  },
];

// ─── Factories ─────────────────────────────────────────────────────────────────

function makeDefaultContent(type: MessageType): MessageContent {
  switch (type) {
    case 'text':
      return { text: '' } as TextContent;
    case 'image':
      return { imageUrl: '', caption: '' } as ImageContent;
    case 'flex':
      return {
        flexMode: 'template',
        templateKey: 'product',
        fields: {},
        jsonText:
          '{\n  "type": "bubble",\n  "body": {\n    "type": "box",\n    "layout": "vertical",\n    "contents": []\n  }\n}',
        jsonValid: true,
        altText: 'ข้อความจาก BESTCHOICE',
      } as FlexContent;
  }
}

function makeMessage(type: MessageType = 'text'): MessageItem {
  return { id: crypto.randomUUID(), type, content: makeDefaultContent(type) };
}

// ─── Message Preview Bubble ────────────────────────────────────────────────────

function MessagePreviewBubble({ message }: { message: MessageItem }) {
  if (message.type === 'text') {
    const c = message.content as TextContent;
    return (
      <div className="bg-card rounded-2xl rounded-tl-sm px-3.5 py-2.5 max-w-[85%] shadow-sm">
        <p className="text-[13px] text-foreground/90 whitespace-pre-wrap leading-relaxed">
          {c.text || <span className="text-muted-foreground">ข้อความจะแสดงที่นี่...</span>}
        </p>
      </div>
    );
  }

  if (message.type === 'image') {
    const c = message.content as ImageContent;
    return (
      <div className="bg-card rounded-2xl rounded-tl-sm overflow-hidden max-w-[85%] shadow-sm">
        {c.imageUrl ? (
          <img
            src={c.imageUrl}
            alt="preview"
            className="max-w-full rounded-t-2xl"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="flex h-20 items-center justify-center bg-muted text-xs text-muted-foreground">
            รูปภาพจะแสดงที่นี่
          </div>
        )}
        {c.caption && <p className="px-3 py-1.5 text-xs text-foreground/70">{c.caption}</p>}
      </div>
    );
  }

  if (message.type === 'flex') {
    return <FlexPreviewCard content={message.content as FlexContent} />;
  }

  return null;
}

// ─── Editors ──────────────────────────────────────────────────────────────────

interface EditorProps {
  message: MessageItem;
  onChange: (updated: MessageItem) => void;
}

function TextEditor({ message, onChange }: EditorProps) {
  const c = message.content as TextContent;
  return (
    <div>
      <Textarea
        className="min-h-[120px] resize-none"
        placeholder="พิมพ์ข้อความต้อนรับ..."
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

function ImageEditor({ message, onChange }: EditorProps) {
  const c = message.content as ImageContent;
  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground/80">URL รูปภาพ</label>
        <Input
          placeholder="https://example.com/image.jpg"
          value={c.imageUrl}
          onChange={(e) => onChange({ ...message, content: { ...c, imageUrl: e.target.value } })}
        />
        <p className="mt-1 text-xs text-muted-foreground">ต้องเป็น HTTPS และขนาดไม่เกิน 10MB</p>
      </div>
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

function FlexEditor({ message, onChange }: EditorProps) {
  const c = message.content as FlexContent;
  return (
    <FlexContentEditor content={c} onChange={(content) => onChange({ ...message, content })} templateHoverClass="hover:border-primary/50">
      {/* Alt text */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground/80">Alt Text</label>
        <Input
          placeholder="ข้อความสำรองสำหรับการแจ้งเตือน"
          value={c.altText}
          onChange={(e) => onChange({ ...message, content: { ...c, altText: e.target.value } })}
          maxLength={400}
        />
      </div>

    </FlexContentEditor>
  );
}

function MessageEditorSwitch({ message, onChange }: EditorProps) {
  switch (message.type) {
    case 'text':
      return <TextEditor message={message} onChange={onChange} />;
    case 'image':
      return <ImageEditor message={message} onChange={onChange} />;
    case 'flex':
      return <FlexEditor message={message} onChange={onChange} />;
  }
}

// ─── Message Card ─────────────────────────────────────────────────────────────

interface MessageCardProps {
  message: MessageItem;
  index: number;
  total: number;
  onChange: (updated: MessageItem) => void;
  onDelete: () => void;
}

function MessageCard({ message, index, total, onChange, onDelete }: MessageCardProps) {
  function changeType(type: MessageType) {
    if (type === message.type) return;
    onChange({ ...message, type, content: makeDefaultContent(type) });
  }

  return (
    <Card className="relative shadow-sm hover:shadow-md transition-shadow duration-200 ring-1 ring-primary/10">
      <CardHeader className="pb-3 bg-muted/50 rounded-t-xl border-b border-border/50">
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
                  : 'border-border text-muted-foreground hover:border-primary/50 hover:text-primary bg-card',
              )}
            >
              {btn.icon}
              {btn.label}
            </button>
          ))}
        </div>
        {/* Content editor */}
        <div className="transition-all duration-300">
          <MessageEditorSwitch message={message} onChange={onChange} />
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Serialize / deserialize helpers ──────────────────────────────────────────

function serializeMessages(messages: MessageItem[]): Array<{ type: string; content: any }> {
  return messages.map((m) => ({ type: m.type, content: m.content }));
}

function deserializeMessages(raw: Array<{ type: string; content: any }>): MessageItem[] {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_MESSAGES;
  return raw.map((item) => ({
    id: crypto.randomUUID(),
    type: (item.type as MessageType) || 'text',
    content: item.content || makeDefaultContent((item.type as MessageType) || 'text'),
  }));
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function LineGreetingPage() {
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<MessageItem[]>(DEFAULT_MESSAGES);
  const [showQuickReply, setShowQuickReply] = useState(true);
  const [isDirty, setIsDirty] = useState(false);

  const { isLoading, isError, error, refetch, data: greetingData } = useQuery({
    queryKey: ['line-greeting-config'],
    queryFn: async () => {
      const res = await api.get<GreetingResponse>('/line-oa/greeting');
      return res.data;
    },
    retry: 1,
  });

  useEffect(() => {
    if (greetingData) {
      setMessages(deserializeMessages(greetingData.messages));
      setShowQuickReply(greetingData.showQuickReply);
      setIsDirty(false);
    }
  }, [greetingData]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      return api.put('/line-oa/greeting', {
        messages: serializeMessages(messages),
        showQuickReply,
      });
    },
    onSuccess: () => {
      toast.success('บันทึกข้อความต้อนรับแล้ว');
      setIsDirty(false);
      queryClient.invalidateQueries({ queryKey: ['line-greeting-config'] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const updateMessage = useCallback((updated: MessageItem) => {
    setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
    setIsDirty(true);
  }, []);

  function addMessage() {
    if (messages.length >= 5) return;
    setMessages((prev) => [...prev, makeMessage('text')]);
    setIsDirty(true);
  }

  function deleteMessage(id: string) {
    setMessages((prev) => prev.filter((m) => m.id !== id));
    setIsDirty(true);
  }

  function handleReset() {
    setMessages(DEFAULT_MESSAGES);
    setShowQuickReply(true);
    setIsDirty(true);
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <PageHeader
        title="ข้อความต้อนรับ LINE"
        subtitle="ข้อความที่ลูกค้าจะได้รับเมื่อเพิ่ม Bot เป็นเพื่อนครั้งแรก — รองรับหลายข้อความและ Flex Card"
        icon={<MessageSquareMore size={22} />}
      />

      <QueryBoundary
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={refetch}
        errorTitle="ไม่สามารถโหลดข้อความต้อนรับได้"
      >
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6 items-start">
          {/* ─── Editor Column ─── */}
          <div className="space-y-4">
            {/* Message cards */}
            {messages.map((msg, idx) => (
              <MessageCard
                key={msg.id}
                message={msg}
                index={idx}
                total={messages.length}
                onChange={updateMessage}
                onDelete={() => deleteMessage(msg.id)}
              />
            ))}

            {/* Add message */}
            {messages.length < 5 && (
              <button
                type="button"
                onClick={addMessage}
                className="w-full flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border py-3.5 text-sm text-muted-foreground hover:border-primary/50 hover:text-primary hover:bg-primary/5 transition-all duration-200"
              >
                <Plus className="size-4" />
                เพิ่มข้อความ ({messages.length}/5)
              </button>
            )}

            {/* Quick Reply toggle */}
            <div className="rounded-xl border border-border/50 bg-card shadow-sm p-5">
              <p className="text-sm font-semibold text-foreground mb-3">Quick Reply Buttons</p>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showQuickReply}
                  onChange={(e) => {
                    setShowQuickReply(e.target.checked);
                    setIsDirty(true);
                  }}
                  className="accent-[#06C755]"
                />
                <span className="text-sm">แสดง Quick Reply ต่อท้ายข้อความสุดท้าย</span>
              </label>
              <p className="text-xs text-muted-foreground mt-1.5">
                ปุ่มลัด: ดูสินค้า · สอบถามราคา · ดูสัญญา · คุยกับพนักงาน
              </p>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 items-center">
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || !isDirty}
                className="bg-gradient-to-r from-[#06C755] to-[#04B44C] hover:from-[#05a848] hover:to-[#039a40] text-white border-0 gap-1.5"
              >
                <Save size={14} />
                {saveMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
              </Button>
              <Button
                variant="outline"
                onClick={handleReset}
                disabled={saveMutation.isPending}
                className="gap-1.5"
              >
                <RotateCcw size={14} />
                รีเซ็ต
              </Button>
              {isDirty && (
                <span className="flex items-center gap-1.5 text-xs text-warning-strong ml-1">
                  <span className="w-2 h-2 rounded-full bg-warning shrink-0" />
                  มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก
                </span>
              )}
            </div>
          </div>

          {/* ─── Phone Preview Column ─── */}
          <div className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden sticky top-6">
            <div className="px-5 py-3.5 border-b border-border/50 bg-gradient-to-r from-[#06C755]/5 to-transparent">
              <h2 className="font-semibold text-foreground text-sm">ตัวอย่างใน LINE</h2>
            </div>
            <div className="p-4 flex justify-center">
              <div className="relative max-w-[280px] w-full">
                <div className="bg-foreground/90 rounded-[2.5rem] p-3 shadow-modal">
                  {/* Notch */}
                  <div className="bg-black w-20 h-4 rounded-full mx-auto mb-2" />
                  {/* LINE screen */}
                  <div className="bg-[#7b9ebc] rounded-2xl overflow-hidden flex flex-col min-h-[440px]">
                    {/* LINE green header */}
                    <div className="bg-[#06C755] px-3 py-2.5 flex items-center gap-2.5 shrink-0">
                      <div className="w-7 h-7 rounded-full bg-white/30" />
                      <div>
                        <div className="text-white font-bold text-xs">BESTCHOICE</div>
                        <div className="text-white/70 text-[9px]">Official Account</div>
                      </div>
                    </div>

                    {/* Chat area */}
                    <div className="p-3 space-y-2.5 flex-1 overflow-y-auto">
                      {/* System message */}
                      <div className="text-center">
                        <span className="text-[9px] text-white/60 bg-white/20 px-2.5 py-0.5 rounded-full">
                          เพิ่มเพื่อนแล้ว
                        </span>
                      </div>

                      {/* All message bubbles */}
                      {messages.map((msg) => (
                        <div key={msg.id} className="flex items-start gap-1.5">
                          <div className="w-7 h-7 rounded-full bg-white flex items-center justify-center shrink-0">
                            <span className="text-[#06C755] text-[9px] font-bold">BC</span>
                          </div>
                          <MessagePreviewBubble message={msg} />
                        </div>
                      ))}

                      {/* Quick Reply */}
                      {showQuickReply && (
                        <div className="flex gap-1.5 overflow-x-auto pb-1 mt-1 ml-8">
                          {['📱 ดูสินค้า', '💰 สอบถาม', '📄 ดูสัญญา', '💬 พนักงาน'].map(
                            (btn) => (
                              <div
                                key={btn}
                                className="shrink-0 px-2.5 py-1 bg-white rounded-full text-[10px] text-[#06C755] font-medium border border-[#06C755]/30 shadow-sm"
                              >
                                {btn}
                              </div>
                            ),
                          )}
                        </div>
                      )}
                    </div>

                    {/* Bottom input bar */}
                    <div className="bg-white/95 border-t px-3 py-2 flex items-center gap-2 shrink-0">
                      <div className="flex-1 bg-muted rounded-full px-3 py-1 text-[11px] text-muted-foreground">
                        Aa
                      </div>
                    </div>
                  </div>
                  {/* Home indicator */}
                  <div className="w-28 h-1 bg-white/30 rounded-full mx-auto mt-2" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </QueryBoundary>

      {/* ─── Tips Card ─── */}
      <div className="rounded-xl bg-info/10 border border-info/20 p-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">💡</span>
          <h3 className="font-semibold text-info text-sm">เคล็ดลับการเขียนข้อความต้อนรับที่ดี</h3>
        </div>
        <ul className="space-y-1.5 text-sm text-info/90">
          <li className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0">•</span>
            <span>ส่งได้สูงสุด 5 ข้อความพร้อมกัน — ผสม Text, รูปภาพ, และ Flex Card ได้ตามต้องการ</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0">•</span>
            <span>Quick Reply จะแสดงต่อท้ายข้อความสุดท้ายเสมอ</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0">•</span>
            <span>ส่งเมื่อลูกค้า Follow ครั้งแรก และเมื่อ Unblock แล้ว Follow ใหม่</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0">•</span>
            <span>Flex Card — ใช้ Template mode สำหรับสินค้า/โปร หรือ JSON mode สำหรับ custom design</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
