import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useDebounce } from '@/hooks/useDebounce';
import api from '@/lib/api';
import { Search, Users, FileText, Package, ArrowRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SearchResults {
  customers: { id: string; name: string; phone: string }[];
  contracts: {
    id: string;
    contractNumber: string;
    customerName: string;
    status: string;
  }[];
  products: { id: string; name: string; sku: string; category: string }[];
}

interface SearchItem {
  type: 'customer' | 'contract' | 'product';
  id: string;
  label: string;
  sub: string;
  icon: typeof Users;
  href: string;
}

function flattenResults(data: SearchResults | undefined): SearchItem[] {
  if (!data) return [];
  const items: SearchItem[] = [];

  data.customers.forEach((c) =>
    items.push({
      type: 'customer',
      id: c.id,
      label: c.name,
      sub: c.phone || '',
      icon: Users,
      href: `/customers/${c.id}`,
    }),
  );

  data.contracts.forEach((c) =>
    items.push({
      type: 'contract',
      id: c.id,
      label: c.contractNumber,
      sub: `${c.customerName} · ${c.status}`,
      icon: FileText,
      href: `/contracts/${c.id}`,
    }),
  );

  data.products.forEach((p) =>
    items.push({
      type: 'product',
      id: p.id,
      label: p.name,
      sub: p.sku || p.category,
      icon: Package,
      href: '/stock',
    }),
  );

  return items;
}

const categoryLabels: Record<string, string> = {
  customer: 'ลูกค้า',
  contract: 'สัญญา',
  product: 'สินค้า',
};

const categoryIcons: Record<string, typeof Users> = {
  customer: Users,
  contract: FileText,
  product: Package,
};

interface SearchModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function SearchModal({ open, onOpenChange }: SearchModalProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 300);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery<SearchResults>({
    queryKey: ['global-search', debouncedQuery],
    queryFn: () =>
      api.get(`/search?q=${encodeURIComponent(debouncedQuery)}&limit=5`).then((r) => r.data),
    enabled: open && debouncedQuery.length > 0,
    staleTime: 30_000,
  });

  const items = flattenResults(data);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [debouncedQuery]);

  const navigateToItem = useCallback(
    (item: SearchItem) => {
      onOpenChange(false);
      navigate(item.href);
    },
    [navigate, onOpenChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) => (prev < items.length - 1 ? prev + 1 : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) => (prev > 0 ? prev - 1 : items.length - 1));
      } else if (e.key === 'Enter' && items[activeIndex]) {
        e.preventDefault();
        navigateToItem(items[activeIndex]);
      } else if (e.key === 'Escape') {
        onOpenChange(false);
      }
    },
    [items, activeIndex, navigateToItem, onOpenChange],
  );

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const grouped = items.reduce(
    (acc, item) => {
      if (!acc[item.type]) acc[item.type] = [];
      acc[item.type].push(item);
      return acc;
    },
    {} as Record<string, SearchItem[]>,
  );

  if (!open) return null;

  let runningIndex = 0;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50 bg-black/50" onClick={() => onOpenChange(false)} />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
        <div className="w-full max-w-lg bg-background border border-border rounded-xl shadow-2xl overflow-hidden animate-in fade-in-0 zoom-in-95 duration-200">
          {/* Search Input */}
          <div className="flex items-center gap-3 px-4 border-b border-border">
            <Search className="size-5 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="ค้นหาลูกค้า, สัญญา, สินค้า..."
              className="flex-1 h-12 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
              autoComplete="off"
            />
            {isLoading && <Loader2 className="size-4 text-muted-foreground animate-spin" />}
            <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded bg-muted text-2xs text-muted-foreground border border-border font-mono">
              ESC
            </kbd>
          </div>

          {/* Results */}
          <div ref={listRef} className="max-h-80 overflow-y-auto p-2">
            {debouncedQuery.length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">
                พิมพ์เพื่อค้นหา...
              </div>
            )}

            {debouncedQuery.length > 0 && !isLoading && items.length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">ไม่พบผลลัพธ์</div>
            )}

            {debouncedQuery.length > 0 && isLoading && items.length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">กำลังค้นหา...</div>
            )}

            {Object.entries(grouped).map(([type, groupItems]) => {
              const GroupIcon = categoryIcons[type];
              return (
                <div key={type}>
                  <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    <GroupIcon className="size-3.5" />
                    {categoryLabels[type]}
                  </div>
                  {groupItems.map((item) => {
                    const idx = runningIndex++;
                    return (
                      <button
                        key={`${item.type}-${item.id}`}
                        data-index={idx}
                        onClick={() => navigateToItem(item)}
                        onMouseEnter={() => setActiveIndex(idx)}
                        className={cn(
                          'flex items-center justify-between w-full px-3 py-2.5 rounded-lg text-left text-sm transition-colors',
                          idx === activeIndex
                            ? 'bg-primary/10 text-primary'
                            : 'text-foreground hover:bg-muted',
                        )}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <item.icon className="size-4 shrink-0 text-muted-foreground" />
                          <div className="min-w-0">
                            <p className="font-medium truncate">{item.label}</p>
                            {item.sub && (
                              <p className="text-xs text-muted-foreground truncate">{item.sub}</p>
                            )}
                          </div>
                        </div>
                        {idx === activeIndex && (
                          <ArrowRight className="size-4 shrink-0 text-primary" />
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {/* Footer */}
          {items.length > 0 && (
            <div className="flex items-center gap-4 px-4 py-2 border-t border-border text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 rounded bg-muted border border-border font-mono">
                  ↑↓
                </kbd>
                เลื่อน
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 rounded bg-muted border border-border font-mono">
                  Enter
                </kbd>
                เปิด
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 rounded bg-muted border border-border font-mono">
                  ESC
                </kbd>
                ปิด
              </span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
