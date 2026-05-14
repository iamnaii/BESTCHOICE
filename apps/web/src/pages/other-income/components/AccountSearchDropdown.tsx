import { useEffect, useRef, useState } from 'react';
import { Search, CheckCircle2 } from 'lucide-react';
import { useCoaGroups } from '@/hooks/useCoa';

interface CoaItem {
  code: string;
  name: string;
}

interface Props {
  value: string;
  onChange: (code: string) => void;
  /** CSS classes filter for which CoA codes to show. */
  filter?: (a: CoaItem) => boolean;
  placeholder?: string;
  disabled?: boolean;
  /**
   * Account codes that should be shown in the list (so users can see they exist)
   * but cannot be selected. Server-side validation (V4) still rejects these, but
   * surfacing them up-front with a tooltip avoids the surprise round-trip.
   */
  blockedCodes?: string[];
  /** Optional reason text shown as a tooltip on blocked rows. */
  blockedReason?: string;
}

/**
 * Searchable account-code dropdown — used by ItemsTable (filter: 42-XXXX)
 * and AdjustmentTable (filter: 52-/53-/11-41).
 */
export function AccountSearchDropdown({
  value,
  onChange,
  filter,
  placeholder = '— เลือกบัญชี —',
  disabled,
  blockedCodes,
  blockedReason,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const { data: groups, isLoading } = useCoaGroups({});

  const allAccounts: CoaItem[] = (groups?.groups ?? []).flatMap((g) => g.accounts);
  const filtered = allAccounts
    .filter((a) => (filter ? filter(a) : true))
    .filter((a) =>
      search
        ? a.code.toLowerCase().includes(search.toLowerCase()) ||
          a.name.toLowerCase().includes(search.toLowerCase())
        : true,
    );

  const selected = allAccounts.find((a) => a.code === value);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className="w-full text-left px-3 py-2 rounded-md border bg-background text-sm flex items-center justify-between gap-2 hover:bg-accent disabled:opacity-50"
      >
        {selected ? (
          <span className="flex items-baseline gap-2 truncate">
            <span className="font-mono text-xs font-bold text-primary">{selected.code}</span>
            <span className="truncate">{selected.name}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">{placeholder}</span>
        )}
        <span className="text-muted-foreground text-xs flex-shrink-0">{open ? '▲' : '▼'}</span>
      </button>
      {open && !disabled && (
        <div
          className="absolute z-30 w-full mt-1 rounded-md border shadow-lg bg-popover"
          style={{ maxHeight: 320 }}
        >
          <div className="p-2 border-b">
            <div className="relative">
              <Search size={14} className="absolute left-2 top-2.5 text-muted-foreground" />
              <input
                autoFocus
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ค้นหารหัส หรือ ชื่อบัญชี"
                className="w-full pl-7 pr-2 py-2 text-xs rounded border bg-background"
              />
            </div>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 260 }}>
            {isLoading ? (
              <p className="p-3 text-xs text-center text-muted-foreground">กำลังโหลด...</p>
            ) : filtered.length === 0 ? (
              <p className="p-3 text-xs text-center text-muted-foreground">ไม่พบบัญชี</p>
            ) : (
              filtered.map((a) => {
                const isSel = a.code === value;
                const isBlocked = blockedCodes?.includes(a.code) ?? false;
                const tooltip = isBlocked
                  ? (blockedReason ?? 'บัญชีนี้ยังไม่รองรับในระบบ')
                  : undefined;
                return (
                  <button
                    key={a.code}
                    type="button"
                    onClick={() => {
                      if (isBlocked) return;
                      onChange(a.code);
                      setOpen(false);
                      setSearch('');
                    }}
                    disabled={isBlocked}
                    title={tooltip}
                    aria-disabled={isBlocked || undefined}
                    className={`w-full text-left px-3 py-2 border-b text-xs flex items-baseline gap-2 ${
                      isBlocked ? 'opacity-50 cursor-not-allowed bg-muted/40' : 'hover:bg-accent'
                    } ${isSel ? 'bg-accent' : ''}`}
                  >
                    <span
                      className={`font-mono w-16 font-bold flex-shrink-0 ${
                        isBlocked ? 'text-muted-foreground' : 'text-primary'
                      }`}
                    >
                      {a.code}
                    </span>
                    <span className="flex-1 truncate">{a.name}</span>
                    {isBlocked && (
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        ยังไม่รองรับ
                      </span>
                    )}
                    {isSel && !isBlocked && <CheckCircle2 size={12} className="text-primary" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
