import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Printer,
  Plus,
  X,
  ScanBarcode,
  CornerDownLeft,
  CheckCircle2,
  CircleAlert,
  Loader2,
  Layers,
  Ruler,
  Trash2,
} from 'lucide-react';
import api from '@/lib/api';
import { formatGregorianDate } from '@/lib/date';
import QueryBoundary from '@/components/QueryBoundary';

interface StickerRate {
  downPayment: number;
  monthlyPrice: number;
  termMonths: number;
}

interface StickerData {
  productId: string;
  brand: string;
  model: string;
  color: string | null;
  storage: string | null;
  batteryHealth: number | null;
  warrantyExpireDate: string | null;
  imei: string | null;
  cashPrice: number | null;
  rate1: StickerRate | null;
  rate2: StickerRate | null;
  shopLogoUrl: string | null;
}

interface PrintItem {
  productId: string;
  qty: number;
}

const RECENT_KEY = 'sticker-print:recent';
const MAX_RECENT = 6;

function formatBaht(n: number): string {
  return n.toLocaleString('th-TH');
}

// 50mm sticker + ~2mm gap between labels on a continuous roll
const TAPE_PER_STICKER_MM = 52;

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function saveRecent(ids: string[]) {
  try {
    const merged = Array.from(new Set([...ids, ...loadRecent()])).slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(merged));
  } catch {
    // ignore
  }
}

// Physical-size sticker (50×30mm) — used for both screen preview AND print.
function StickerCard({ data }: { data: StickerData }) {
  const specParts = [
    data.color,
    data.storage,
    data.batteryHealth !== null ? `แบต ${data.batteryHealth}%` : null,
  ].filter(Boolean);
  const warrantyText = data.warrantyExpireDate
    ? `ประกันศูนย์ ${formatGregorianDate(data.warrantyExpireDate)}`
    : null;

  return (
    <div className="sticker bg-white text-black relative overflow-hidden">
      <div className="flex justify-between items-start gap-1">
        <div className="font-bold text-[8pt] leading-tight truncate">
          {data.brand} {data.model}
        </div>
        {data.cashPrice !== null && (
          <div className="font-bold text-[9pt] leading-tight whitespace-nowrap">
            ฿ {formatBaht(data.cashPrice)}
          </div>
        )}
      </div>

      <div className="flex justify-between items-start gap-1 text-[6.5pt] leading-tight mt-[0.5mm]">
        <div className="truncate">{specParts.join(' · ') || ' '}</div>
        {warrantyText && <div className="whitespace-nowrap">{warrantyText}</div>}
      </div>

      <hr className="my-[0.8mm] border-t border-black/40" />

      {data.rate1 && (
        <div className="text-[6.5pt] leading-tight tabular-nums">
          เรทที่ 1 ดาวน์ {formatBaht(data.rate1.downPayment)} {formatBaht(data.rate1.monthlyPrice)} ×{' '}
          {data.rate1.termMonths} ด.
        </div>
      )}
      {data.rate2 && (
        <div className="text-[6.5pt] leading-tight tabular-nums">
          เรทที่ 2 ดาวน์ {formatBaht(data.rate2.downPayment)} {formatBaht(data.rate2.monthlyPrice)} ×{' '}
          {data.rate2.termMonths} ด.
        </div>
      )}

      <div className="absolute left-[1mm] right-[8mm] bottom-[0.5mm] text-[6pt] font-mono leading-none truncate">
        {data.imei ? `IMEI: ${data.imei}` : ' '}
      </div>

      {data.shopLogoUrl && (
        <img
          src={data.shopLogoUrl}
          alt=""
          className="absolute right-[1mm] bottom-[1mm] w-[7mm] h-[7mm] object-contain"
        />
      )}
    </div>
  );
}

// Wraps a StickerCard inside crop-mark frame for on-screen preview only.
function DielineFrame({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <div className="dieline-frame">
      <div className="dieline-marks" aria-hidden="true">
        <span className="mark mark-tl" />
        <span className="mark mark-tr" />
        <span className="mark mark-bl" />
        <span className="mark mark-br" />
      </div>
      {children}
      {label && <div className="dieline-label font-mono">{label}</div>}
    </div>
  );
}

function StatusBadge({
  state,
}: {
  state: 'ready' | 'loading' | 'missing' | 'pending';
}) {
  if (state === 'ready')
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase text-primary">
        <CheckCircle2 className="size-3" /> ready
      </span>
    );
  if (state === 'loading')
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase text-muted-foreground">
        <Loader2 className="size-3 animate-spin" /> lookup
      </span>
    );
  if (state === 'missing')
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase text-warning">
        <CircleAlert className="size-3" /> not found
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase text-muted-foreground/60">
      <span className="size-1.5 rounded-full bg-muted-foreground/40" /> queued
    </span>
  );
}

export default function StickerPrintPage() {
  const [searchParams] = useSearchParams();
  const idsFromUrl = searchParams.get('productIds');

  const [items, setItems] = useState<PrintItem[]>([]);
  const [manualInput, setManualInput] = useState('');
  const [recent, setRecent] = useState<string[]>(() => loadRecent());
  const [now, setNow] = useState(() => new Date());
  const inputRef = useRef<HTMLInputElement>(null);

  // Initialize from URL once on mount
  useEffect(() => {
    if (idsFromUrl) {
      const initial = idsFromUrl
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((id) => ({ productId: id, qty: 1 }));
      setItems(initial);
    }
    inputRef.current?.focus();
  }, [idsFromUrl]);

  // Live clock for the operator strip — refreshes once a minute
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const productIdsKey = useMemo(
    () => items.map((i) => i.productId).sort().join(','),
    [items],
  );

  const {
    data: stickerData = [],
    isFetching,
    isError,
    error,
    refetch,
  } = useQuery<StickerData[]>({
    queryKey: ['sticker-data', productIdsKey],
    queryFn: async () => {
      if (items.length === 0) return [];
      const ids = items.map((i) => i.productId).join(',');
      const res = await api.get(
        `/sticker-templates/products/data?ids=${encodeURIComponent(ids)}`,
      );
      return Array.isArray(res.data) ? res.data : [];
    },
    enabled: items.length > 0,
  });

  const dataMap = useMemo(
    () => new Map(stickerData.map((d) => [d.productId, d])),
    [stickerData],
  );

  // Build flat list expanded by qty, in user's input order
  const expandedStickers = useMemo(() => {
    const out: StickerData[] = [];
    for (const item of items) {
      const data = dataMap.get(item.productId);
      if (!data) continue;
      for (let i = 0; i < item.qty; i++) out.push(data);
    }
    return out;
  }, [items, dataMap]);

  const totalSheets = expandedStickers.length;
  const totalItems = items.length;
  const readyCount = items.filter((i) => dataMap.has(i.productId)).length;
  const tapeCm = (totalSheets * TAPE_PER_STICKER_MM) / 10; // mm → cm

  const addManual = (raw?: string) => {
    const value = raw ?? manualInput;
    const ids = value
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length === 0) return;

    setItems((prev) => {
      const seen = new Set(prev.map((p) => p.productId));
      const next = [...prev];
      for (const id of ids) {
        if (!seen.has(id)) {
          next.push({ productId: id, qty: 1 });
          seen.add(id);
        }
      }
      return next;
    });
    saveRecent(ids);
    setRecent(loadRecent());
    setManualInput('');
    inputRef.current?.focus();
  };

  const updateQty = (productId: string, qty: number) => {
    setItems(items.map((i) => (i.productId === productId ? { ...i, qty: Math.max(1, qty) } : i)));
  };

  const removeItem = (productId: string) => {
    setItems(items.filter((i) => i.productId !== productId));
  };

  const clearAll = () => {
    setItems([]);
    inputRef.current?.focus();
  };

  const handlePrint = () => window.print();

  const dateLabel = now.toLocaleDateString('th-TH', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  });
  const timeLabel = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

  return (
    <div>
      {/* ─── PRINT-HIDDEN OPERATOR CONSOLE ──────────────────────────── */}
      <div className="print:hidden">
        <header className="sticker-header">
          <div className="flex items-baseline gap-3 min-w-0">
            <div className="font-mono text-xs uppercase tracking-[0.18em] text-primary">
              <span className="inline-block size-1.5 rounded-full bg-primary mr-2 animate-pulse" />
              station / labels
            </div>
            <h1 className="text-lg font-semibold tracking-tight truncate">เครื่องพิมพ์สติกเกอร์</h1>
            <span className="text-xs text-muted-foreground hidden sm:inline">
              สติกเกอร์ติดเครื่อง 50 × 30 mm · thermal roll
            </span>
          </div>
          <div className="hidden md:flex items-center gap-4 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            <span>{dateLabel}</span>
            <span className="text-foreground tabular-nums">{timeLabel}</span>
          </div>
        </header>

        <div className="sticker-grid">
          {/* ─── LEFT: SCANNER + QUEUE ─────────────────────────── */}
          <section className="sticker-panel">
            {/* Scanner input */}
            <div className="scanner">
              <ScanBarcode className={`scanner-icon ${manualInput ? 'is-active' : ''}`} />
              <input
                ref={inputRef}
                type="text"
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addManual();
                  }
                }}
                placeholder="สแกน หรือ วาง Product ID / IMEI"
                className="scanner-input font-mono"
                spellCheck={false}
                autoComplete="off"
              />
              <kbd className="scanner-hint">
                <CornerDownLeft className="size-3" />
                <span>Enter</span>
              </kbd>
              <button
                type="button"
                onClick={() => addManual()}
                disabled={!manualInput.trim()}
                className="scanner-add"
              >
                <Plus className="size-3.5" />
                เพิ่ม
              </button>
            </div>

            {/* Stats strip */}
            <dl className="stats-strip">
              <div>
                <dt>รายการ</dt>
                <dd className="tabular-nums">
                  <span className="text-foreground font-semibold">{totalItems}</span>
                  <span className="text-muted-foreground/60 text-[11px] ml-1">/ {readyCount} พร้อม</span>
                </dd>
              </div>
              <div>
                <dt>ดวงทั้งหมด</dt>
                <dd className="tabular-nums">
                  <Layers className="size-3 inline-block mr-1 text-muted-foreground/70" />
                  <span className="text-foreground font-semibold">{totalSheets}</span>
                </dd>
              </div>
              <div>
                <dt>เทปประมาณ</dt>
                <dd className="tabular-nums">
                  <Ruler className="size-3 inline-block mr-1 text-muted-foreground/70" />
                  <span className="text-foreground font-semibold">
                    {tapeCm > 0 ? tapeCm.toFixed(1) : '—'}
                  </span>
                  <span className="text-muted-foreground/60 text-[11px] ml-1">cm</span>
                </dd>
              </div>
            </dl>

            {/* Recent chips */}
            {recent.length > 0 && (
              <div className="recent">
                <span className="recent-label">ใช้ล่าสุด</span>
                <div className="recent-chips">
                  {recent.map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => addManual(id)}
                      className="recent-chip font-mono"
                      disabled={items.some((i) => i.productId === id)}
                      title={`เพิ่ม ${id}`}
                    >
                      <Plus className="size-3 opacity-60" />
                      {id.length > 14 ? `…${id.slice(-12)}` : id}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Queue */}
            <div className="queue">
              <div className="queue-head">
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  คิวพิมพ์
                </span>
                {items.length > 0 && (
                  <button type="button" onClick={clearAll} className="queue-clear">
                    <Trash2 className="size-3" />
                    ล้างทั้งหมด
                  </button>
                )}
              </div>

              {items.length === 0 ? (
                <div className="queue-empty">
                  <p className="text-sm text-muted-foreground">
                    คิวยังว่าง — สแกน barcode, วาง ID,
                    <br />
                    หรือเปิดจากหน้า "สต็อกสินค้า" → "พิมพ์สติกเกอร์"
                  </p>
                </div>
              ) : (
                <ul className="queue-list">
                  {items.map((item, idx) => {
                    const data = dataMap.get(item.productId);
                    const state: 'ready' | 'loading' | 'missing' | 'pending' = data
                      ? 'ready'
                      : isFetching
                        ? 'loading'
                        : 'missing';
                    return (
                      <li key={item.productId} className="queue-row">
                        <span className="queue-num font-mono">
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="font-mono text-xs text-foreground/90 truncate">
                            {item.productId}
                          </div>
                          <div className="text-[11px] text-muted-foreground truncate">
                            {data ? (
                              <>
                                {data.brand} {data.model}
                                {data.cashPrice !== null && (
                                  <span className="ml-2 tabular-nums text-foreground/70">
                                    ฿ {formatBaht(data.cashPrice)}
                                  </span>
                                )}
                              </>
                            ) : (
                              <StatusBadge state={state} />
                            )}
                          </div>
                        </div>
                        {data && <StatusBadge state="ready" />}
                        <div className="qty-stepper">
                          <button
                            type="button"
                            onClick={() => updateQty(item.productId, item.qty - 1)}
                            disabled={item.qty <= 1}
                            aria-label="ลด"
                          >
                            −
                          </button>
                          <span className="font-mono tabular-nums">{item.qty}</span>
                          <button
                            type="button"
                            onClick={() => updateQty(item.productId, item.qty + 1)}
                            aria-label="เพิ่ม"
                          >
                            +
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeItem(item.productId)}
                          className="queue-remove"
                          aria-label="ลบรายการ"
                        >
                          <X className="size-3.5" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>

          {/* ─── RIGHT: PREVIEW DECK ────────────────────────────── */}
          <section className="sticker-deck">
            <div className="deck-head">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  preview deck
                </span>
                <span className="text-xs text-muted-foreground">· แสดงผลตามจริง 1 : 1</span>
              </div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground tabular-nums">
                {totalSheets} / {totalSheets} ดวง
              </div>
            </div>

            <QueryBoundary
              isLoading={false}
              isError={isError}
              error={error}
              onRetry={refetch}
              errorTitle="โหลดข้อมูลสติกเกอร์ไม่สำเร็จ"
            >
              <div className="deck-surface">
                {expandedStickers.length === 0 ? (
                  <div className="deck-empty">
                    <DielineFrame label="50 × 30 mm">
                      <div className="ghost-sticker">
                        <div className="text-[7pt] uppercase tracking-[0.2em] text-black/30 font-mono">
                          awaiting input
                        </div>
                        <div className="text-[10pt] text-black/40 mt-2">
                          รอข้อมูลแรก…
                        </div>
                      </div>
                    </DielineFrame>
                    <p className="text-xs text-muted-foreground text-center max-w-[28ch]">
                      ตัวอย่างจะปรากฏที่นี่ทันทีหลังเพิ่ม Product ID จากช่องสแกนทางซ้าย
                    </p>
                  </div>
                ) : (
                  <div className="deck-grid">
                    {expandedStickers.map((data, idx) => (
                      <DielineFrame
                        key={`${data.productId}-${idx}`}
                        label={`#${String(idx + 1).padStart(3, '0')}`}
                      >
                        <StickerCard data={data} />
                      </DielineFrame>
                    ))}
                  </div>
                )}
              </div>
            </QueryBoundary>
          </section>
        </div>

        {/* Sticky action bar */}
        {totalSheets > 0 && (
          <div className="print-bar">
            <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              {totalSheets} ดวง · {tapeCm.toFixed(1)} cm tape
            </div>
            <button type="button" onClick={handlePrint} className="print-btn">
              <Printer className="size-4" />
              <span>พิมพ์</span>
              <span className="font-mono tabular-nums opacity-80">({totalSheets})</span>
            </button>
          </div>
        )}
      </div>

      {/* ─── PRINT-ONLY AREA ───────────────────────────────────────── */}
      <div className="print-stickers hidden print:block">
        {expandedStickers.map((data, idx) => (
          <StickerCard key={`p-${data.productId}-${idx}`} data={data} />
        ))}
      </div>

      <style>{`
        /* ─── physical 50×30mm sticker ─────────────────────── */
        .sticker {
          width: 50mm;
          height: 30mm;
          padding: 1mm 1.5mm;
          font-family: 'IBM Plex Sans Thai', system-ui, sans-serif;
          box-sizing: border-box;
        }

        /* ─── operator console layout ──────────────────────── */
        .sticker-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          padding: 1rem 1.25rem;
          margin-bottom: 1rem;
          background: hsl(var(--card));
          border: 1px solid hsl(var(--border));
          border-radius: 8px;
          position: relative;
          overflow: hidden;
        }
        .sticker-header::before {
          content: '';
          position: absolute;
          left: 0; right: 0; bottom: 0;
          height: 2px;
          background: repeating-linear-gradient(
            90deg,
            hsl(var(--primary)) 0 8px,
            transparent 8px 16px
          );
          opacity: 0.6;
        }

        .sticker-grid {
          display: grid;
          grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
          gap: 1rem;
          align-items: start;
        }
        @media (max-width: 1024px) {
          .sticker-grid { grid-template-columns: 1fr; }
        }

        .sticker-panel,
        .sticker-deck {
          background: hsl(var(--card));
          border: 1px solid hsl(var(--border));
          border-radius: 8px;
          padding: 1rem;
        }

        /* ─── scanner input ────────────────────────────────── */
        .scanner {
          position: relative;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.625rem 0.75rem;
          background: hsl(var(--background));
          border: 1px solid hsl(var(--border));
          border-radius: 6px;
          transition: border-color 200ms, box-shadow 200ms;
        }
        .scanner:focus-within {
          border-color: hsl(var(--primary));
          box-shadow: 0 0 0 3px hsl(var(--primary) / 0.12);
        }
        .scanner::after {
          content: '';
          position: absolute;
          left: 2.25rem;
          right: 8rem;
          bottom: -1px;
          height: 1px;
          background: linear-gradient(
            90deg,
            transparent 0%,
            hsl(var(--primary)) 50%,
            transparent 100%
          );
          opacity: 0;
          transition: opacity 200ms;
        }
        .scanner:focus-within::after { opacity: 0.4; animation: scan-line 1.6s ease-in-out infinite; }
        @keyframes scan-line {
          0%   { transform: translateX(-30%); opacity: 0; }
          50%  { opacity: 0.6; }
          100% { transform: translateX(30%); opacity: 0; }
        }
        .scanner-icon {
          color: hsl(var(--muted-foreground));
          flex-shrink: 0;
          width: 1.125rem;
          height: 1.125rem;
        }
        .scanner-icon.is-active { color: hsl(var(--primary)); }
        .scanner-input {
          flex: 1;
          background: transparent;
          border: 0;
          outline: 0;
          font-size: 0.95rem;
          letter-spacing: 0.02em;
          min-width: 0;
        }
        .scanner-input::placeholder { color: hsl(var(--muted-foreground) / 0.7); letter-spacing: 0; }
        .scanner-hint {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          padding: 0.125rem 0.4rem;
          font-family: var(--font-mono);
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: hsl(var(--muted-foreground));
          background: hsl(var(--muted));
          border: 1px solid hsl(var(--border));
          border-radius: 4px;
        }
        .scanner-add {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          padding: 0.375rem 0.75rem;
          font-size: 0.8rem;
          font-weight: 600;
          color: hsl(var(--foreground));
          background: hsl(var(--muted));
          border: 1px solid hsl(var(--border));
          border-radius: 4px;
          cursor: pointer;
          transition: background 150ms;
        }
        .scanner-add:hover:not(:disabled) { background: hsl(var(--accent)); }
        .scanner-add:disabled { opacity: 0.4; cursor: not-allowed; }

        /* ─── stats strip ─────────────────────────────────── */
        .stats-strip {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 0;
          margin: 0.875rem 0;
          padding: 0;
          border-top: 1px dashed hsl(var(--border));
          border-bottom: 1px dashed hsl(var(--border));
        }
        .stats-strip > div {
          padding: 0.625rem 0.75rem;
          border-right: 1px dashed hsl(var(--border));
        }
        .stats-strip > div:last-child { border-right: 0; }
        .stats-strip dt {
          font-family: var(--font-mono);
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.16em;
          color: hsl(var(--muted-foreground));
          margin-bottom: 0.125rem;
        }
        .stats-strip dd {
          font-size: 0.95rem;
          margin: 0;
        }

        /* ─── recent chips ────────────────────────────────── */
        .recent {
          display: flex;
          align-items: flex-start;
          gap: 0.625rem;
          margin-bottom: 0.875rem;
        }
        .recent-label {
          flex-shrink: 0;
          padding-top: 0.3rem;
          font-family: var(--font-mono);
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.16em;
          color: hsl(var(--muted-foreground));
        }
        .recent-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 0.3rem;
          min-width: 0;
        }
        .recent-chip {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          padding: 0.25rem 0.5rem;
          font-size: 11px;
          color: hsl(var(--foreground));
          background: hsl(var(--background));
          border: 1px solid hsl(var(--border));
          border-radius: 4px;
          cursor: pointer;
          transition: all 120ms;
        }
        .recent-chip:hover:not(:disabled) {
          border-color: hsl(var(--primary));
          color: hsl(var(--primary));
        }
        .recent-chip:disabled { opacity: 0.35; cursor: not-allowed; }

        /* ─── queue list ──────────────────────────────────── */
        .queue-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.5rem 0.25rem 0.625rem;
          border-bottom: 1px solid hsl(var(--border));
        }
        .queue-clear {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          font-size: 11px;
          color: hsl(var(--muted-foreground));
          cursor: pointer;
          background: none;
          border: 0;
          padding: 0.25rem 0.5rem;
          border-radius: 4px;
          transition: color 150ms, background 150ms;
        }
        .queue-clear:hover { color: hsl(var(--destructive)); background: hsl(var(--destructive) / 0.08); }

        .queue-list {
          list-style: none;
          padding: 0;
          margin: 0;
          max-height: 50vh;
          overflow-y: auto;
        }
        .queue-row {
          display: flex;
          align-items: center;
          gap: 0.625rem;
          padding: 0.625rem 0.25rem;
          border-bottom: 1px dashed hsl(var(--border));
          animation: queue-in 220ms ease-out;
        }
        .queue-row:last-child { border-bottom: 0; }
        @keyframes queue-in {
          from { opacity: 0; transform: translateX(-4px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        .queue-num {
          font-size: 10px;
          color: hsl(var(--muted-foreground) / 0.7);
          min-width: 1.5ch;
          text-align: right;
        }

        .qty-stepper {
          display: inline-flex;
          align-items: center;
          border: 1px solid hsl(var(--border));
          border-radius: 4px;
          overflow: hidden;
          background: hsl(var(--background));
        }
        .qty-stepper button {
          width: 1.5rem;
          height: 1.5rem;
          font-size: 14px;
          line-height: 1;
          color: hsl(var(--foreground));
          background: transparent;
          border: 0;
          cursor: pointer;
          transition: background 120ms;
        }
        .qty-stepper button:hover:not(:disabled) { background: hsl(var(--accent)); }
        .qty-stepper button:disabled { opacity: 0.3; cursor: not-allowed; }
        .qty-stepper span {
          min-width: 1.75rem;
          text-align: center;
          font-size: 12px;
          padding: 0 0.25rem;
          border-left: 1px solid hsl(var(--border));
          border-right: 1px solid hsl(var(--border));
        }

        .queue-remove {
          width: 1.5rem;
          height: 1.5rem;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: hsl(var(--muted-foreground));
          background: transparent;
          border: 0;
          border-radius: 4px;
          cursor: pointer;
          transition: color 150ms, background 150ms;
        }
        .queue-remove:hover { color: hsl(var(--destructive)); background: hsl(var(--destructive) / 0.08); }

        .queue-empty {
          padding: 2rem 1rem;
          text-align: center;
          background: repeating-linear-gradient(
            -45deg,
            hsl(var(--muted) / 0.4) 0 6px,
            transparent 6px 12px
          );
          border-radius: 6px;
          margin-top: 0.625rem;
        }

        /* ─── preview deck ────────────────────────────────── */
        .deck-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding-bottom: 0.625rem;
          margin-bottom: 0.875rem;
          border-bottom: 1px solid hsl(var(--border));
        }
        .deck-surface {
          background:
            radial-gradient(circle at 1px 1px, hsl(var(--muted-foreground) / 0.18) 1px, transparent 0)
            0 0 / 16px 16px,
            hsl(var(--muted) / 0.4);
          border: 1px solid hsl(var(--border));
          border-radius: 6px;
          min-height: 320px;
          padding: 1.5rem;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .deck-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 1.5rem;
          justify-content: center;
          width: 100%;
        }
        .deck-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1rem;
        }

        /* ─── dieline frame (crop marks around sticker) ─── */
        .dieline-frame {
          position: relative;
          padding: 8px;
          background: white;
          box-shadow:
            0 1px 0 hsl(var(--border)),
            0 8px 20px -8px hsl(0 0% 0% / 0.18);
          animation: dieline-in 260ms ease-out;
        }
        @keyframes dieline-in {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .dieline-marks .mark {
          position: absolute;
          width: 8px;
          height: 8px;
          border-color: hsl(var(--primary) / 0.65);
          border-style: solid;
          border-width: 0;
        }
        .dieline-marks .mark-tl { top: -2px; left: -2px; border-top-width: 1.5px; border-left-width: 1.5px; }
        .dieline-marks .mark-tr { top: -2px; right: -2px; border-top-width: 1.5px; border-right-width: 1.5px; }
        .dieline-marks .mark-bl { bottom: -2px; left: -2px; border-bottom-width: 1.5px; border-left-width: 1.5px; }
        .dieline-marks .mark-br { bottom: -2px; right: -2px; border-bottom-width: 1.5px; border-right-width: 1.5px; }
        .dieline-label {
          position: absolute;
          right: 0;
          top: -1.1rem;
          font-size: 9px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: hsl(var(--muted-foreground));
        }

        .ghost-sticker {
          width: 50mm;
          height: 30mm;
          background: white;
          border: 1px dashed hsl(var(--border));
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 1mm;
        }

        /* ─── sticky print bar ────────────────────────────── */
        .print-bar {
          position: fixed;
          right: 1.5rem;
          bottom: 1.5rem;
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 0.5rem 0.5rem 0.5rem 1rem;
          background: hsl(var(--card));
          border: 1px solid hsl(var(--border));
          border-radius: 999px;
          box-shadow: 0 12px 32px -8px hsl(0 0% 0% / 0.25);
          z-index: 30;
          animation: bar-in 240ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes bar-in {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .print-btn {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem 1rem;
          font-weight: 600;
          color: hsl(var(--primary-foreground));
          background: hsl(var(--primary));
          border: 0;
          border-radius: 999px;
          cursor: pointer;
          transition: filter 150ms, transform 150ms;
        }
        .print-btn:hover { filter: brightness(1.1); transform: translateY(-1px); }
        .print-btn:active { transform: translateY(0); }

        /* ─── print rules ─────────────────────────────────── */
        @media print {
          @page { size: 50mm 30mm; margin: 0; }
          body { margin: 0; padding: 0; background: white; }
          .print\\:hidden { display: none !important; }
          .print\\:block { display: block !important; }
          .sticker {
            page-break-after: always;
            border: 0 !important;
            margin: 0;
          }
          .sticker:last-child { page-break-after: auto; }
        }
      `}</style>
    </div>
  );
}
