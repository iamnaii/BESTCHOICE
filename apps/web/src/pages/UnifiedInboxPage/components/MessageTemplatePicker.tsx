import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Check, ChevronDown, ChevronRight, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import api from '@/lib/api';

interface CannedResponse {
  id: string;
  shortcut: string;
  title: string;
  content: string;
  category?: string | null;
  sortOrder?: number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onInsert: (content: string) => void;
  roomId: string | null;
}

export default function MessageTemplatePicker({ isOpen, onClose, onInsert, roomId }: Props) {
  // NOTE: roomId is reserved for future use (Task 5: preview pane will fetch
  // /staff-chat/canned-responses/:id/preview?roomId=... to expand variables).
  // onInsert is wired in Task 5 (preview pane "ใส่ข้อความ" button).
  void roomId;
  void onInsert;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const { data: templates = [], isError } = useQuery<CannedResponse[]>({
    queryKey: ['canned-responses-picker'],
    queryFn: () => api.get('/staff-chat/canned-responses').then((r: any) => r.data),
    enabled: isOpen,
    refetchOnWindowFocus: false,
  });

  // Group templates by category (null → "อื่นๆ")
  const grouped = useMemo(() => {
    const map = new Map<string, CannedResponse[]>();
    for (const t of templates) {
      const key = t.category ?? 'อื่นๆ';
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    }
    // Sort: by min(sortOrder) ascending, then category name
    return [...map.entries()].sort(([keyA, listA], [keyB, listB]) => {
      const minA = Math.min(...listA.map((t) => t.sortOrder ?? 999));
      const minB = Math.min(...listB.map((t) => t.sortOrder ?? 999));
      if (minA !== minB) return minA - minB;
      return keyA.localeCompare(keyB, 'th');
    });
  }, [templates]);

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
      <DialogContent className="max-w-4xl p-0 gap-0 flex flex-col" style={{ height: 600 }}>
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

          {/* Right: preview placeholder (built in Task 5) */}
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            {selectedId ? 'preview pending' : 'เลือก template เพื่อดูตัวอย่าง'}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-muted/30">
          <Button variant="ghost" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button disabled={!selectedId}>
            <Check className="w-4 h-4 mr-1.5" />
            ใส่ข้อความ
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
