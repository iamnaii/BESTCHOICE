import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Search, X, MessageSquare, CheckCircle } from 'lucide-react';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectCannedResponse: (content: string) => void;
  onResolve: () => void;
  roomId: string | null;
}

interface Command {
  id: string;
  label: string;
  description?: string;
  icon: typeof CheckCircle;
  action: () => void;
}

export default function CommandPalette({
  isOpen,
  onClose,
  onSelectCannedResponse,
  onResolve,
  roomId,
}: CommandPaletteProps) {
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Fetch canned responses
  const { data: cannedResponses } = useQuery({
    queryKey: ['canned-responses-palette'],
    queryFn: () => api.get('/staff-chat/canned-responses').then((r: any) => r.data),
    enabled: isOpen,
  });

  // Reset state when opening
  useEffect(() => {
    if (isOpen) {
      setSearch('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Build command list
  const commands: Command[] = [
    {
      id: 'resolve',
      label: 'resolve',
      description: 'ปิดการสนทนา',
      icon: CheckCircle,
      action: () => {
        onResolve();
        onClose();
      },
    },
    ...(cannedResponses ?? []).map((cr: any) => ({
      id: cr.id,
      label: cr.shortcut ? `/${cr.shortcut}` : cr.title,
      description: cr.title,
      icon: MessageSquare,
      action: () => {
        onSelectCannedResponse(cr.content);
        onClose();
      },
    })),
  ];

  // Filter by search
  const filtered = search
    ? commands.filter(
        (c) =>
          c.label.toLowerCase().includes(search.toLowerCase()) ||
          c.description?.toLowerCase().includes(search.toLowerCase()),
      )
    : commands;

  // Clamp selected index when filtered list changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [search]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filtered[selectedIndex]) {
          filtered[selectedIndex].action();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [filtered, selectedIndex, onClose],
  );

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" />

      {/* Palette */}
      <div
        className="relative mt-20 w-full max-w-lg bg-card rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search className="w-5 h-5 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="พิมพ์คำสั่งหรือค้นหาข้อความสำเร็จรูป..."
            className="flex-1 text-sm outline-none placeholder:text-muted-foreground"
          />
          <button
            onClick={onClose}
            className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Shortcut hint */}
        <div className="px-4 py-1.5 bg-muted text-[11px] text-muted-foreground flex items-center gap-4 border-b border-border">
          <span>
            <kbd className="px-1 py-0.5 bg-muted/80 rounded text-[10px]">Ctrl+K</kbd> เปิด
          </span>
          <span>
            <kbd className="px-1 py-0.5 bg-muted/80 rounded text-[10px]">Ctrl+Shift+R</kbd>{' '}
            ปิดสนทนา
          </span>
          <span>
            <kbd className="px-1 py-0.5 bg-muted/80 rounded text-[10px]">Esc</kbd> ปิด
          </span>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-72 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              ไม่พบคำสั่งที่ตรงกัน
            </div>
          ) : (
            filtered.map((cmd, index) => {
              const Icon = cmd.icon;
              const isActive = index === selectedIndex;
              return (
                <button
                  key={cmd.id}
                  onClick={cmd.action}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                    isActive ? 'bg-blue-50 text-blue-700' : 'text-foreground hover:bg-muted'
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 shrink-0 ${isActive ? 'text-blue-500' : 'text-muted-foreground'}`}
                  />
                  <div className="flex-1 min-w-0">
                    <span className="font-medium">{cmd.label}</span>
                    {cmd.description && cmd.description !== cmd.label && (
                      <span className="ml-2 text-muted-foreground text-xs">{cmd.description}</span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
