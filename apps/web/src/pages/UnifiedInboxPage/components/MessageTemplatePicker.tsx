import { useState, useMemo, useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Check, ChevronDown, ChevronRight, FileText, Search, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import api from '@/lib/api';

interface CannedResponse {
  id: string;
  shortcut: string;
  title: string;
  content: string;
  category?: string | null;
  sortOrder?: number;
}

interface PreviewBubble {
  id: string;
  type: 'TEXT' | 'IMAGE' | 'STICKER' | 'CARD' | 'LOCATION' | 'VIDEO' | 'JSON';
  sortOrder: number;
  text: string | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  stickerPackageId: string | null;
  stickerId: string | null;
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
  locationTitle?: string | null;
  json?: any;
}

interface PreviewResponse {
  id: string;
  shortcut: string;
  title: string;
  content: string;
  expandedContent: string;
  bubbles?: PreviewBubble[];
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onInsert: (content: string) => void;
  roomId: string | null;
}

export default function MessageTemplatePicker({ isOpen, onClose, onInsert, roomId }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  // Reset local state when modal opens — prevents stale selection/search from
  // a previous conversation leaking into the current one.
  useEffect(() => {
    if (isOpen) {
      setSelectedId(null);
      setSearchQuery('');
      setExpandedCategories(new Set());
    }
  }, [isOpen]);

  const { data: templates = [], isError } = useQuery<CannedResponse[]>({
    queryKey: ['canned-responses-picker'],
    queryFn: () => api.get('/staff-chat/canned-responses').then((r: any) => r.data),
    enabled: isOpen,
    refetchOnWindowFocus: false,
  });

  const {
    data: preview,
    isLoading: isPreviewLoading,
    isError: isPreviewError,
  } = useQuery<PreviewResponse>({
    queryKey: ['canned-response-preview', roomId, selectedId],
    queryFn: () =>
      api
        .get(`/staff-chat/rooms/${roomId}/canned-responses/${selectedId}/preview`)
        .then((r: any) => r.data),
    enabled: !!selectedId && !!roomId,
    refetchOnWindowFocus: false,
  });

  const handleInsert = () => {
    if (!preview) return;
    const textBubbles = (preview.bubbles ?? []).filter((b) => b.type === 'TEXT' && b.text);
    const nonTextCount = (preview.bubbles ?? []).filter((b) => b.type !== 'TEXT').length;
    if (nonTextCount > 0) {
      toast.warning(
        `มี ${nonTextCount} bubble ที่ไม่ใช่ข้อความ — "ใส่ข้อความ" จะใส่เฉพาะ text. กด "ส่งทันที" เพื่อส่งทุก bubble`,
      );
    }
    const content =
      textBubbles.length > 0
        ? textBubbles.map((b) => b.text).join('\n\n')
        : (preview.expandedContent ?? '');
    onInsert(content);
    onClose();
  };

  const sendDirectMut = useMutation({
    mutationFn: () =>
      api.post(`/staff-chat/rooms/${roomId}/send-canned-response`, { templateId: selectedId }),
    onSuccess: (res: any) => {
      const data = res?.data ?? res;
      const sent = data?.sent ?? 0;
      const dropped = data?.dropped ?? 0;
      const errors: string[] = data?.errors ?? [];
      if (errors.length > 0) {
        toast.error(`ส่งสำเร็จ ${sent}/${sent + errors.length} bubble — บาง bubble ล้มเหลว`);
      } else if (dropped > 0) {
        toast.success(`ส่ง ${sent} bubble แล้ว (${dropped} bubble ถูก drop เพราะ channel ไม่รองรับ)`);
      } else {
        toast.success(`ส่ง ${sent} bubble แล้ว`);
      }
      onClose();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message ?? 'ส่งไม่สำเร็จ');
    },
  });

  const handleSendDirect = () => {
    if (!preview || !roomId || !selectedId) return;
    sendDirectMut.mutate();
  };

  // Apply search filter, then group
  const grouped = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = q
      ? templates.filter(
          (t) =>
            t.title.toLowerCase().includes(q) ||
            t.content.toLowerCase().includes(q) ||
            t.shortcut.toLowerCase().includes(q),
        )
      : templates;

    const map = new Map<string, CannedResponse[]>();
    for (const t of filtered) {
      const key = t.category ?? 'อื่นๆ';
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    }
    return [...map.entries()].sort(([keyA, listA], [keyB, listB]) => {
      const minA = Math.min(...listA.map((t) => t.sortOrder ?? 999));
      const minB = Math.min(...listB.map((t) => t.sortOrder ?? 999));
      if (minA !== minB) return minA - minB;
      return keyA.localeCompare(keyB, 'th');
    });
  }, [templates, searchQuery]);

  // Auto-expand all categories during search; collapse when cleared.
  // Bail out when value would not change — a fresh `new Set()` every render
  // would otherwise loop with Radix Dialog's Presence transitions.
  useEffect(() => {
    setExpandedCategories((prev) => {
      if (searchQuery.trim()) {
        const all = new Set(grouped.map(([cat]) => cat));
        if (prev.size === all.size && [...all].every((c) => prev.has(c))) return prev;
        return all;
      }
      return prev.size === 0 ? prev : new Set();
    });
  }, [searchQuery, grouped]);

  const toggleCategory = (cat: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl p-0 gap-0 flex flex-col h-[min(600px,80vh)]">
        <DialogHeader className="px-5 py-3.5 border-b border-border">
          <DialogTitle className="text-base font-semibold leading-snug">
            เลือกข้อความสำเร็จรูป
          </DialogTitle>
          <DialogDescription className="text-xs leading-snug">
            เลือก template เพื่อใส่ในช่องตอบ — ตัวแปร เช่น {'{customerName}'} จะถูกแทนค่าอัตโนมัติ
          </DialogDescription>
        </DialogHeader>

        {/* Search bar */}
        <div className="px-5 py-3 border-b border-border bg-muted/30">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ค้นหาตามชื่อ, เนื้อหา, หรือ shortcut..."
              className="pl-9"
            />
          </div>
        </div>

        {/* Body: tree + preview */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left: tree */}
          <div className="w-72 border-r border-border overflow-y-auto py-2">
            {isError && (
              <div className="px-4 py-8 text-sm text-muted-foreground text-center">
                โหลด template ไม่สำเร็จ
              </div>
            )}
            {!isError && templates.length === 0 && (
              <div className="px-4 py-8 text-sm text-muted-foreground text-center leading-snug">
                ยังไม่มี template — ไปสร้างที่
                <br />
                <a href="/admin/canned-responses" className="text-primary hover:underline">
                  /admin/canned-responses
                </a>
              </div>
            )}
            {grouped.map(([cat, items]) => {
              const isExpanded = expandedCategories.has(cat);
              return (
                <div key={cat}>
                  <button
                    onClick={() => toggleCategory(cat)}
                    className="w-full px-4 py-2 flex items-center gap-2 text-sm font-medium text-foreground hover:bg-accent leading-snug"
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                    )}
                    <span className="flex-1 text-left">{cat}</span>
                    <span className="text-[10px] text-muted-foreground">{items.length}</span>
                  </button>
                  {isExpanded && (
                    <div className="pl-5">
                      {items.map((t) => {
                        const isSelected = t.id === selectedId;
                        return (
                          <button
                            key={t.id}
                            onClick={() => setSelectedId(t.id)}
                            aria-selected={isSelected}
                            className={cn(
                              'w-full px-4 py-1.5 text-left text-sm flex items-center gap-2 leading-snug',
                              isSelected
                                ? 'bg-primary/10 text-primary font-medium border-l-2 border-primary'
                                : 'text-muted-foreground hover:bg-accent',
                            )}
                          >
                            <span
                              className={cn(
                                'w-1 h-1 rounded-full',
                                isSelected ? 'bg-primary' : 'bg-muted-foreground',
                              )}
                            />
                            {t.title}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Right: preview */}
          <div className="flex-1 flex flex-col overflow-hidden bg-muted/10">
            {!selectedId && (
              <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground leading-snug">
                <div className="text-center">
                  <FileText className="w-10 h-10 mx-auto mb-2 text-muted-foreground/40" />
                  เลือก template เพื่อดูตัวอย่าง
                </div>
              </div>
            )}
            {selectedId && (
              <>
                <div className="flex items-center justify-between px-5 py-2.5 border-b border-border bg-card">
                  <div className="flex items-center gap-2 leading-snug">
                    <span className="text-sm font-semibold text-foreground">{preview?.title ?? '...'}</span>
                    {preview?.shortcut && (
                      <>
                        <span className="text-xs text-muted-foreground">·</span>
                        <code className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{preview.shortcut.startsWith('/') ? preview.shortcut : `/${preview.shortcut}`}</code>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-5">
                  {isPreviewLoading && (
                    <div className="bg-card border border-border rounded-lg p-4 text-sm leading-relaxed min-h-[80px]">
                      <span className="text-muted-foreground">กำลังโหลด...</span>
                    </div>
                  )}
                  {!isPreviewLoading && isPreviewError && (
                    <div className="bg-card border border-border rounded-lg p-4 text-sm leading-relaxed min-h-[80px]">
                      <span className="text-destructive">โหลดตัวอย่างไม่สำเร็จ — ลองเลือกใหม่หรือปิด/เปิด modal</span>
                    </div>
                  )}
                  {!isPreviewLoading && !isPreviewError && (
                    preview?.bubbles && preview.bubbles.length > 0 ? (
                      <div className="space-y-2">
                        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                          ตัวอย่าง ({preview.bubbles.length} บับเบิ้ล)
                        </div>
                        {preview.bubbles.map((b: any) => (
                          <div key={b.id} className="bg-card border border-border rounded-lg p-3">
                            {b.type === 'TEXT' && (
                              <div className="text-sm whitespace-pre-line leading-relaxed">{b.text}</div>
                            )}
                            {b.type === 'IMAGE' && b.mediaUrl && (
                              <img src={b.mediaUrl} alt="" className="max-w-full max-h-48 rounded" />
                            )}
                            {b.type === 'STICKER' && b.stickerPackageId && (
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <img
                                  src={`https://stickershop.line-scdn.net/stickershop/v1/sticker/${b.stickerId}/android/sticker.png`}
                                  alt="sticker"
                                  className="w-16 h-16"
                                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                                />
                                <span>Sticker {b.stickerPackageId}/{b.stickerId}</span>
                              </div>
                            )}
                            {b.type === 'CARD' && (
                              <div className="border border-border rounded overflow-hidden">
                                {b.json?.heroImageUrl && <img src={b.json.heroImageUrl} alt="" className="w-full max-h-32 object-cover" />}
                                {b.json?.title && <div className="px-3 py-2 text-sm font-semibold">{b.json.title}</div>}
                                {b.json?.subtitle && <div className="px-3 pb-2 text-xs text-muted-foreground">{b.json.subtitle}</div>}
                                {Array.isArray(b.json?.buttons) && b.json.buttons.length > 0 && (
                                  <div className="px-3 pb-2 flex flex-col gap-1">
                                    {b.json.buttons.map((btn: any, i: number) => (
                                      <span key={i} className="text-xs border border-border rounded py-1 text-center text-primary">{btn.label}</span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                            {b.type === 'LOCATION' && (
                              <div className="text-xs">
                                <div className="font-medium">{b.locationTitle ?? '(ไม่มีชื่อ)'}</div>
                                {b.address && <div className="text-muted-foreground">{b.address}</div>}
                                {b.latitude && b.longitude && (
                                  <a href={`https://www.google.com/maps?q=${b.latitude},${b.longitude}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                                    {b.latitude}, {b.longitude}
                                  </a>
                                )}
                              </div>
                            )}
                            {b.type === 'VIDEO' && b.mediaUrl && (
                              <video src={b.mediaUrl} poster={b.thumbnailUrl ?? undefined} controls className="max-w-full max-h-48 rounded" />
                            )}
                            {b.type === 'JSON' && (
                              <details className="text-xs">
                                <summary className="cursor-pointer text-muted-foreground">JSON payload</summary>
                                <pre className="mt-1 p-2 bg-muted rounded font-mono text-[10px] overflow-x-auto">{JSON.stringify(b.json, null, 2)}</pre>
                              </details>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <>
                        <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">ตัวอย่าง (แทนค่าตัวแปรจากลูกค้า)</div>
                        <div className="bg-card border border-border rounded-lg p-4 text-sm leading-relaxed whitespace-pre-line min-h-[80px]">
                          {preview?.expandedContent}
                        </div>
                      </>
                    )
                  )}
                  {!isPreviewLoading && !isPreviewError && preview?.content && preview.content !== preview.expandedContent && (!preview.bubbles || preview.bubbles.length === 0) && (
                    <>
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mt-4 mb-2">เนื้อหาต้นฉบับ</div>
                      <div className="bg-muted border border-border rounded-lg p-3 text-xs font-mono text-muted-foreground whitespace-pre-line">
                        {preview.content}
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-muted/30">
          <Button variant="ghost" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button variant="outline" disabled={!preview} onClick={handleInsert}>
            <Check className="w-4 h-4 mr-1.5" />
            ใส่ข้อความ
          </Button>
          <Button
            disabled={!preview || !roomId || sendDirectMut.isPending}
            onClick={handleSendDirect}
            title="ส่งทุก bubble + Quick Reply ทันทีโดยไม่ผ่านช่องตอบ"
          >
            <Send className="w-4 h-4 mr-1.5" />
            {sendDirectMut.isPending ? 'กำลังส่ง...' : 'ส่งทันที'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
