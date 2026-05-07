import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Printer,
  Plus,
  X,
  Search,
  ScanLine,
  Check,
  Smartphone,
  Package,
  CheckCircle2,
  CircleAlert,
  Loader2,
  Trash2,
  Tag,
} from 'lucide-react';
import api from '@/lib/api';
import { formatGregorianDate } from '@/lib/date';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';

/* ─── types ─────────────────────────────────────────── */
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

interface StockProduct {
  id: string;
  brand: string;
  model: string;
  color: string | null;
  storage: string | null;
  imeiSerial: string | null;
  photos: string[];
  branch: { id: string; name: string } | null;
  prices: Array<{ price: string }>;
}

interface PrintItem {
  productId: string;
  qty: number;
}

/* ─── constants ────────────────────────────────────── */
const RECENT_KEY = 'sticker-print:recent';
const MAX_RECENT = 8;
const TAPE_PER_STICKER_MM = 52;

const BRAND_TINTS: Record<string, string> = {
  Apple: 'from-zinc-900 to-zinc-700',
  Samsung: 'from-blue-900 to-blue-700',
  OPPO: 'from-emerald-900 to-emerald-700',
  Vivo: 'from-violet-900 to-violet-700',
  Xiaomi: 'from-orange-900 to-orange-700',
  Huawei: 'from-rose-900 to-rose-700',
  Realme: 'from-yellow-900 to-amber-700',
  Honor: 'from-sky-900 to-sky-700',
};

function brandTint(brand: string): string {
  return BRAND_TINTS[brand] ?? 'from-slate-800 to-slate-600';
}

function formatBaht(n: number): string {
  return n.toLocaleString('th-TH');
}

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

/* ─── 50×30mm thermal sticker — receipt-card aesthetic ─ */
function StickerCard({ data }: { data: StickerData }) {
  const specParts = [
    data.color,
    data.storage,
    data.batteryHealth !== null ? `แบต ${data.batteryHealth}%` : null,
  ].filter(Boolean);
  const warrantyText = data.warrantyExpireDate
    ? `ประกัน ${formatGregorianDate(data.warrantyExpireDate)}`
    : null;

  return (
    <div className="sticker bg-white text-black relative">
      {/* Top: brand badge + model + price hero */}
      <div className="st-row st-row-top">
        <div className="st-brandblock min-w-0">
          <span className="st-brand">{data.brand}</span>
          <span className="st-model">{data.model}</span>
        </div>
        {data.cashPrice !== null && (
          <div className="st-price tabular-nums">
            <span className="st-currency">฿</span>
            <span className="st-amount">{formatBaht(data.cashPrice)}</span>
          </div>
        )}
      </div>

      {/* Spec line */}
      {(specParts.length > 0 || warrantyText) && (
        <div className="st-row st-spec">
          <span className="truncate">{specParts.join(' · ') || ' '}</span>
          {warrantyText && <span className="st-warranty whitespace-nowrap">{warrantyText}</span>}
        </div>
      )}

      <div className="st-rule" />

      {/* Rates as mini-table */}
      {(data.rate1 || data.rate2) && (
        <div className="st-rates tabular-nums">
          {data.rate1 && (
            <div className="st-rate">
              <span className="st-rate-tag">1</span>
              <span className="st-rate-down">ดาวน์ {formatBaht(data.rate1.downPayment)}</span>
              <span className="st-rate-monthly">
                {formatBaht(data.rate1.monthlyPrice)}<span className="st-x"> × </span>{data.rate1.termMonths} ด.
              </span>
            </div>
          )}
          {data.rate2 && (
            <div className="st-rate">
              <span className="st-rate-tag">2</span>
              <span className="st-rate-down">ดาวน์ {formatBaht(data.rate2.downPayment)}</span>
              <span className="st-rate-monthly">
                {formatBaht(data.rate2.monthlyPrice)}<span className="st-x"> × </span>{data.rate2.termMonths} ด.
              </span>
            </div>
          )}
        </div>
      )}

      {/* Footer: IMEI + brand mark */}
      <div className="st-footer">
        <span className="st-imei truncate">
          {data.imei ?? ' '}
        </span>
        {data.shopLogoUrl ? (
          <img src={data.shopLogoUrl} alt="" className="st-logo" />
        ) : (
          <span className="st-mark">
            <span className="st-mark-b">B</span>
            <span className="st-mark-rest">ESTCHOICE</span>
          </span>
        )}
      </div>
    </div>
  );
}

/* ─── product row (catalog picker, list mode) ────── */
function ProductRow({
  product,
  selected,
  qty,
  onAdd,
  onInc,
  onDec,
  onRemove,
}: {
  product: StockProduct;
  selected: boolean;
  qty: number;
  onAdd: () => void;
  onInc: () => void;
  onDec: () => void;
  onRemove: () => void;
}) {
  const photo = product.photos?.[0];
  const cash = product.prices?.[0]?.price ? parseFloat(product.prices[0].price) : null;
  const tint = brandTint(product.brand);

  return (
    <div
      className={`product-row ${selected ? 'is-selected' : ''}`}
      onClick={() => {
        if (!selected) onAdd();
      }}
    >
      {/* Thumbnail */}
      <div className={`row-thumb bg-gradient-to-br ${tint}`}>
        {photo ? (
          <img src={photo} alt="" loading="lazy" className="size-full object-cover" />
        ) : (
          <Smartphone className="size-5 text-white/40" strokeWidth={1.4} />
        )}
        {selected && (
          <div className="row-check">
            <Check className="size-2.5" strokeWidth={3.5} />
          </div>
        )}
      </div>

      {/* Body */}
      <div className="row-body min-w-0 flex-1">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground shrink-0">
            {product.brand}
          </span>
          <h3 className="font-semibold text-[14px] leading-tight truncate">
            {product.model}
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 mt-1">
          {product.color && <span className="spec-pill">{product.color}</span>}
          {product.storage && <span className="spec-pill">{product.storage}</span>}
          {product.imeiSerial && (
            <span className="spec-pill spec-pill-mono" title={product.imeiSerial}>
              …{product.imeiSerial.slice(-6)}
            </span>
          )}
          {product.branch?.name && (
            <span className="text-[10px] text-muted-foreground/80">· {product.branch.name}</span>
          )}
        </div>
      </div>

      {/* Price */}
      {cash !== null && (
        <div className="row-price font-mono tabular-nums">
          ฿ {formatBaht(cash)}
        </div>
      )}

      {/* Action */}
      <div className="row-action" onClick={(e) => e.stopPropagation()}>
        {selected ? (
          <div className="qty-control">
            <button
              type="button"
              onClick={() => (qty <= 1 ? onRemove() : onDec())}
              aria-label={qty <= 1 ? 'ลบ' : 'ลด'}
            >
              {qty <= 1 ? <Trash2 className="size-3.5" /> : '−'}
            </button>
            <span className="qty-num font-mono tabular-nums">{qty}</span>
            <button type="button" onClick={onInc} aria-label="เพิ่ม">+</button>
          </div>
        ) : (
          <button type="button" onClick={onAdd} className="add-btn-row">
            <Plus className="size-3.5" />
            เพิ่ม
          </button>
        )}
      </div>
    </div>
  );
}

/* ─── main page ───────────────────────────────────── */
export default function StickerPrintPage() {
  const [searchParams] = useSearchParams();
  const idsFromUrl = searchParams.get('productIds');

  const [items, setItems] = useState<PrintItem[]>([]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [activeBrand, setActiveBrand] = useState<string>('ทั้งหมด');
  const [scanInput, setScanInput] = useState('');
  const [scanOpen, setScanOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>(() => loadRecent());
  const scanRef = useRef<HTMLInputElement>(null);

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
  }, [idsFromUrl]);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(t);
  }, [search]);

  // Focus scanner when opened
  useEffect(() => {
    if (scanOpen) scanRef.current?.focus();
  }, [scanOpen]);

  /* ─── data: stock products ────────────────────── */
  const stockQuery = useQuery({
    queryKey: ['sticker-stock', debouncedSearch, activeBrand],
    queryFn: async () => {
      const params = new URLSearchParams({
        status: 'IN_STOCK',
        limit: '60',
        page: '1',
      });
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (activeBrand && activeBrand !== 'ทั้งหมด') params.set('brand', activeBrand);
      const res = await api.get(`/products/stock?${params.toString()}`);
      return res.data as { products: StockProduct[]; total: number };
    },
  });

  /* ─── data: brand list ────────────────────────── */
  const brandsQuery = useQuery({
    queryKey: ['sticker-brands'],
    queryFn: async () => {
      const res = await api.get('/products/brands');
      return Array.isArray(res.data) ? (res.data as string[]) : [];
    },
  });

  /* ─── data: sticker preview data ──────────────── */
  const productIdsKey = useMemo(
    () => items.map((i) => i.productId).sort().join(','),
    [items],
  );

  const previewQuery = useQuery<StickerData[]>({
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
    () => new Map((previewQuery.data ?? []).map((d) => [d.productId, d])),
    [previewQuery.data],
  );

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
  const tapeCm = (totalSheets * TAPE_PER_STICKER_MM) / 10;

  /* ─── actions ────────────────────────────────── */
  const addProduct = (productId: string) => {
    setItems((prev) => {
      if (prev.some((p) => p.productId === productId)) return prev;
      return [...prev, { productId, qty: 1 }];
    });
    saveRecent([productId]);
    setRecent(loadRecent());
  };

  const incQty = (productId: string) =>
    setItems(items.map((i) => (i.productId === productId ? { ...i, qty: i.qty + 1 } : i)));
  const decQty = (productId: string) =>
    setItems(
      items.map((i) =>
        i.productId === productId ? { ...i, qty: Math.max(1, i.qty - 1) } : i,
      ),
    );
  const removeItem = (productId: string) =>
    setItems(items.filter((i) => i.productId !== productId));
  const clearAll = () => setItems([]);

  const handleScan = () => {
    const ids = scanInput
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length === 0) return;
    setItems((prev) => {
      const seen = new Set(prev.map((p) => p.productId));
      const next = [...prev];
      for (const id of ids) {
        if (!seen.has(id)) next.push({ productId: id, qty: 1 });
      }
      return next;
    });
    saveRecent(ids);
    setRecent(loadRecent());
    setScanInput('');
    scanRef.current?.focus();
  };

  const handlePrint = () => window.print();

  const products = stockQuery.data?.products ?? [];
  const brandPills = ['ทั้งหมด', ...(brandsQuery.data ?? [])];
  const itemMap = new Map(items.map((i) => [i.productId, i]));

  return (
    <div>
      <div className="print:hidden">
        <PageHeader
          icon={<Tag className="size-4" strokeWidth={1.75} />}
          title="พิมพ์สติกเกอร์"
          subtitle="เลือกหลายเครื่องจากสต็อกพร้อมขาย เพิ่มเข้าคิว แล้วสั่งพิมพ์ทีเดียว · thermal 50 × 30 mm"
          action={
            <div className="hidden sm:flex items-center gap-3 px-3.5 py-1.5 rounded-md border border-border bg-card text-[12px]">
              <div className="flex items-baseline gap-1">
                <span className="font-semibold tabular-nums">{totalItems}</span>
                <span className="text-muted-foreground">รายการ</span>
              </div>
              <span className="text-border">·</span>
              <div className="flex items-baseline gap-1">
                <span className="font-semibold tabular-nums">{totalSheets}</span>
                <span className="text-muted-foreground">ดวง</span>
              </div>
              <span className="text-border">·</span>
              <div className="flex items-baseline gap-1">
                <span className="font-semibold tabular-nums">{tapeCm.toFixed(0)}</span>
                <span className="text-muted-foreground">ซม.เทป</span>
              </div>
            </div>
          }
        />

        {/* ─── MAIN GRID ────────────────────────────────── */}
        <div className="main-grid">
          {/* LEFT: Picker */}
          <section className="picker">
            {/* Toolbar */}
            <div className="toolbar">
              <div className="search-box">
                <Search className="size-4 text-muted-foreground shrink-0" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="ค้นหาแบรนด์ / รุ่น / IMEI ในสต็อก…"
                  className="search-input"
                  spellCheck={false}
                />
                {search && (
                  <button type="button" onClick={() => setSearch('')} className="search-clear" aria-label="ล้าง">
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setScanOpen((v) => !v)}
                className={`scan-toggle ${scanOpen ? 'is-open' : ''}`}
              >
                <ScanLine className="size-4" />
                <span className="hidden sm:inline">สแกน / วาง ID</span>
              </button>
            </div>

            {/* Scanner panel (collapsed) */}
            {scanOpen && (
              <div className="scan-panel">
                <div className="scan-row">
                  <input
                    ref={scanRef}
                    type="text"
                    value={scanInput}
                    onChange={(e) => setScanInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleScan();
                      }
                    }}
                    placeholder="วาง Product ID หรือ IMEI หลายๆ ตัว คั่นด้วยช่องว่าง / comma"
                    className="scan-input font-mono"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    onClick={handleScan}
                    disabled={!scanInput.trim()}
                    className="scan-add"
                  >
                    <Plus className="size-4" />
                    เพิ่ม
                  </button>
                </div>
                {recent.length > 0 && (
                  <div className="recent-row">
                    <span className="recent-label">ใช้ล่าสุด</span>
                    {recent.map((id) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => addProduct(id)}
                        disabled={items.some((i) => i.productId === id)}
                        className="recent-pill font-mono"
                      >
                        {id.length > 14 ? `…${id.slice(-12)}` : id}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Brand chips */}
            {brandPills.length > 1 && (
              <div className="brand-chips">
                {brandPills.map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setActiveBrand(b)}
                    className={`brand-chip ${activeBrand === b ? 'is-active' : ''}`}
                  >
                    {b}
                  </button>
                ))}
              </div>
            )}

            {/* Product grid */}
            <QueryBoundary
              isLoading={stockQuery.isLoading}
              isError={stockQuery.isError}
              error={stockQuery.error}
              onRetry={stockQuery.refetch}
              errorTitle="โหลดสต็อกไม่สำเร็จ"
            >
              {products.length === 0 ? (
                <div className="empty-grid">
                  <Package className="size-10 text-muted-foreground/40 mb-2" strokeWidth={1.2} />
                  <p className="text-sm text-muted-foreground">
                    {debouncedSearch || activeBrand !== 'ทั้งหมด'
                      ? 'ไม่พบสินค้าตามเงื่อนไข — ลองเปลี่ยนคำค้นหรือแบรนด์'
                      : 'ไม่มีสินค้าพร้อมขายในสต็อก'}
                  </p>
                </div>
              ) : (
                <div className="product-list">
                  {products.map((p) => {
                    const item = itemMap.get(p.id);
                    return (
                      <ProductRow
                        key={p.id}
                        product={p}
                        selected={!!item}
                        qty={item?.qty ?? 0}
                        onAdd={() => addProduct(p.id)}
                        onInc={() => incQty(p.id)}
                        onDec={() => decQty(p.id)}
                        onRemove={() => removeItem(p.id)}
                      />
                    );
                  })}
                </div>
              )}
            </QueryBoundary>
          </section>

          {/* RIGHT: Print queue + preview */}
          <aside className="queue-side">
            <div className="queue-card">
              <div className="queue-card-head">
                <h2 className="text-[15px] font-semibold leading-tight">คิวพิมพ์</h2>
                {items.length > 0 && (
                  <button type="button" onClick={clearAll} className="queue-clear">
                    <Trash2 className="size-3" />
                    ล้าง
                  </button>
                )}
              </div>

              {items.length === 0 ? (
                <div className="queue-empty">
                  <div className="ghost-stack">
                    <div className="ghost-paper" />
                    <div className="ghost-paper" />
                    <div className="ghost-paper top">
                      <div className="text-[8pt] font-mono uppercase tracking-[0.2em] text-black/30">
                        sticker preview
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground text-center mt-3 max-w-[24ch]">
                    เลือกเครื่องจากด้านซ้าย เพื่อเริ่มสร้างคิวพิมพ์
                  </p>
                </div>
              ) : (
                <ul className="queue-list">
                  {items.map((item, idx) => {
                    const data = dataMap.get(item.productId);
                    const state = data
                      ? 'ready'
                      : previewQuery.isFetching
                        ? 'loading'
                        : 'missing';
                    return (
                      <li key={item.productId} className="queue-item">
                        <div className="queue-marker">
                          {state === 'ready' && <CheckCircle2 className="size-4 text-primary" />}
                          {state === 'loading' && <Loader2 className="size-4 text-muted-foreground animate-spin" />}
                          {state === 'missing' && <CircleAlert className="size-4 text-warning" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-medium truncate">
                            {data ? `${data.brand} ${data.model}` : (
                              <span className="text-muted-foreground">ไม่พบสินค้า</span>
                            )}
                          </div>
                          <div className="text-[11px] font-mono text-muted-foreground/80 truncate">
                            #{idx + 1} · {item.productId.slice(0, 12)}
                            {item.productId.length > 12 ? '…' : ''}
                          </div>
                        </div>
                        <div className="queue-qty">
                          <span className="font-mono font-semibold tabular-nums">{item.qty}</span>
                          <span className="text-[10px] text-muted-foreground ml-0.5">ดวง</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeItem(item.productId)}
                          className="queue-x"
                          aria-label="ลบ"
                        >
                          <X className="size-3.5" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Preview deck */}
            {expandedStickers.length > 0 && (
              <div className="preview-card">
                <div className="preview-head">
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                    preview
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground tabular-nums">
                    {totalSheets} ดวง · {tapeCm.toFixed(1)} cm
                  </span>
                </div>
                <div className="preview-stack">
                  {expandedStickers.slice(0, 8).map((data, idx) => (
                    <div key={`${data.productId}-${idx}`} className="dieline">
                      <span className="mark mark-tl" />
                      <span className="mark mark-tr" />
                      <span className="mark mark-bl" />
                      <span className="mark mark-br" />
                      <StickerCard data={data} />
                    </div>
                  ))}
                  {expandedStickers.length > 8 && (
                    <div className="preview-more font-mono">
                      + อีก {expandedStickers.length - 8} ดวง
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* PRINT button */}
            <button
              type="button"
              onClick={handlePrint}
              disabled={totalSheets === 0}
              className="print-cta"
            >
              <Printer className="size-5" />
              <span className="flex-1 text-left">
                <span className="block text-[15px] font-semibold leading-tight">พิมพ์สติกเกอร์</span>
                <span className="block text-[11px] opacity-80 leading-tight tabular-nums">
                  {totalSheets > 0 ? `${totalSheets} ดวง · ใช้เทป ~${tapeCm.toFixed(1)} ซม.` : 'ยังไม่มีรายการในคิว'}
                </span>
              </span>
              <span className="font-mono text-[14px] tabular-nums opacity-90">
                {totalSheets}
              </span>
            </button>
          </aside>
        </div>
      </div>

      {/* ─── PRINT-ONLY ─────────────────────────────────── */}
      <div className="print-stickers hidden print:block">
        {expandedStickers.map((data, idx) => (
          <StickerCard key={`p-${data.productId}-${idx}`} data={data} />
        ))}
      </div>

      <style>{`
        /* ─── Physical thermal sticker (50×30mm B&W) ───── */
        .sticker {
          width: 50mm;
          height: 30mm;
          padding: 1.6mm 1.8mm 1.2mm;
          font-family: 'IBM Plex Sans Thai', system-ui, sans-serif;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          color: #000;
          line-height: 1.12;
        }
        .st-row {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 1.2mm;
        }
        .st-row-top { align-items: center; }
        .st-brandblock {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .st-brand {
          font-size: 7pt;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          line-height: 1;
          color: #000;
          margin-bottom: 0.5mm;
        }
        .st-model {
          font-size: 11pt;
          font-weight: 800;
          line-height: 1;
          letter-spacing: -0.01em;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .st-price {
          display: inline-flex;
          align-items: baseline;
          gap: 0.6mm;
          flex-shrink: 0;
          padding: 0.9mm 1.4mm;
          background: #000;
          color: #fff;
          border-radius: 0.8mm;
        }
        .st-currency {
          font-size: 7pt;
          font-weight: 600;
          line-height: 1;
        }
        .st-amount {
          font-size: 12pt;
          font-weight: 800;
          line-height: 1;
          letter-spacing: -0.015em;
        }
        .st-spec {
          font-size: 7.5pt;
          margin-top: 1mm;
          color: #000;
          font-weight: 500;
        }
        .st-warranty { color: #333; font-weight: 400; }
        .st-rule {
          margin: 1mm 0 0.8mm;
          height: 0;
          border-top: 0.22mm solid #000;
        }
        .st-rates {
          display: flex;
          flex-direction: column;
          gap: 0.6mm;
        }
        .st-rate {
          display: grid;
          grid-template-columns: 3.8mm 1fr auto;
          align-items: center;
          gap: 1.2mm;
          font-size: 8pt;
          line-height: 1.1;
        }
        .st-rate-tag {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 3.4mm;
          height: 3.4mm;
          font-family: var(--font-mono);
          font-size: 7pt;
          font-weight: 700;
          color: #fff;
          background: #000;
          border-radius: 0.6mm;
          line-height: 1;
        }
        .st-rate-down { font-weight: 600; color: #000; }
        .st-rate-monthly { font-weight: 700; color: #000; white-space: nowrap; }
        .st-x { color: #555; font-weight: 400; }

        .st-footer {
          margin-top: auto;
          padding-top: 0.8mm;
          border-top: 0.22mm dotted #000;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1.2mm;
        }
        .st-imei {
          font-family: var(--font-mono);
          font-size: 6.6pt;
          letter-spacing: 0.02em;
          color: #000;
          flex: 1;
          min-width: 0;
          font-weight: 500;
        }
        .st-logo {
          width: 7mm;
          height: 5.5mm;
          object-fit: contain;
          flex-shrink: 0;
        }
        .st-mark {
          display: inline-flex;
          align-items: center;
          flex-shrink: 0;
          font-size: 6.4pt;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .st-mark-b {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 3.6mm;
          height: 3.6mm;
          margin-right: 0.8mm;
          color: #fff;
          background: #000;
          border-radius: 0.5mm;
          font-size: 6.6pt;
          font-weight: 800;
        }
        .st-mark-rest { color: #000; }

        /* ─── Layout ────────────────────────────────────── */
        .main-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 360px;
          gap: 1.25rem;
          align-items: start;
        }
        @media (max-width: 1100px) {
          .main-grid { grid-template-columns: 1fr; }
        }

        /* ─── Picker ────────────────────────────────────── */
        .picker {
          background: hsl(var(--card));
          border: 1px solid hsl(var(--border));
          border-radius: 14px;
          padding: 1rem;
        }

        .toolbar {
          display: flex;
          gap: 0.5rem;
        }
        .search-box {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 0.625rem;
          padding: 0 0.875rem;
          background: hsl(var(--background));
          border: 1px solid hsl(var(--border));
          border-radius: 10px;
          height: 42px;
          transition: border-color 200ms, box-shadow 200ms;
        }
        .search-box:focus-within {
          border-color: hsl(var(--primary));
          box-shadow: 0 0 0 3px hsl(var(--primary) / 0.12);
        }
        .search-input {
          flex: 1;
          background: transparent;
          border: 0;
          outline: 0;
          font-size: 14px;
          min-width: 0;
        }
        .search-input::placeholder { color: hsl(var(--muted-foreground) / 0.7); }
        .search-clear {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          color: hsl(var(--muted-foreground));
          background: transparent;
          border: 0;
          border-radius: 4px;
          cursor: pointer;
        }
        .search-clear:hover { background: hsl(var(--accent)); color: hsl(var(--foreground)); }

        .scan-toggle {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0 0.875rem;
          height: 42px;
          font-size: 13px;
          font-weight: 500;
          color: hsl(var(--foreground));
          background: hsl(var(--background));
          border: 1px solid hsl(var(--border));
          border-radius: 10px;
          cursor: pointer;
          transition: all 150ms;
        }
        .scan-toggle:hover { border-color: hsl(var(--primary) / 0.5); }
        .scan-toggle.is-open {
          background: hsl(var(--primary) / 0.1);
          border-color: hsl(var(--primary));
          color: hsl(var(--primary));
        }

        /* Scan panel */
        .scan-panel {
          margin-top: 0.625rem;
          padding: 0.875rem;
          background: hsl(var(--background));
          border: 1px solid hsl(var(--border));
          border-radius: 10px;
          animation: panel-in 200ms ease-out;
        }
        @keyframes panel-in {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .scan-row { display: flex; gap: 0.5rem; }
        .scan-input {
          flex: 1;
          padding: 0.5rem 0.75rem;
          background: hsl(var(--card));
          border: 1px solid hsl(var(--border));
          border-radius: 8px;
          font-size: 13px;
          outline: 0;
        }
        .scan-input:focus {
          border-color: hsl(var(--primary));
          box-shadow: 0 0 0 3px hsl(var(--primary) / 0.12);
        }
        .scan-add {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          padding: 0 0.875rem;
          font-size: 13px;
          font-weight: 600;
          color: hsl(var(--primary-foreground));
          background: hsl(var(--primary));
          border: 0;
          border-radius: 8px;
          cursor: pointer;
        }
        .scan-add:disabled { opacity: 0.4; cursor: not-allowed; }
        .recent-row {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.375rem;
          margin-top: 0.625rem;
        }
        .recent-label {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.16em;
          color: hsl(var(--muted-foreground));
          margin-right: 0.25rem;
        }
        .recent-pill {
          padding: 0.2rem 0.5rem;
          font-size: 11px;
          color: hsl(var(--foreground));
          background: hsl(var(--card));
          border: 1px solid hsl(var(--border));
          border-radius: 999px;
          cursor: pointer;
          transition: all 120ms;
        }
        .recent-pill:hover:not(:disabled) {
          border-color: hsl(var(--primary));
          color: hsl(var(--primary));
        }
        .recent-pill:disabled { opacity: 0.3; cursor: not-allowed; }

        /* Brand chips */
        .brand-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 0.375rem;
          margin: 1rem 0 0.875rem;
          padding-bottom: 0.875rem;
          border-bottom: 1px dashed hsl(var(--border));
        }
        .brand-chip {
          padding: 0.375rem 0.875rem;
          font-size: 12px;
          font-weight: 500;
          color: hsl(var(--muted-foreground));
          background: hsl(var(--background));
          border: 1px solid hsl(var(--border));
          border-radius: 999px;
          cursor: pointer;
          transition: all 150ms;
        }
        .brand-chip:hover { color: hsl(var(--foreground)); border-color: hsl(var(--primary) / 0.4); }
        .brand-chip.is-active {
          background: hsl(var(--primary));
          color: hsl(var(--primary-foreground));
          border-color: hsl(var(--primary));
          box-shadow: 0 4px 12px -4px hsl(var(--primary) / 0.5);
        }

        /* ─── Product list (rows) ───────────────────────── */
        .product-list {
          display: flex;
          flex-direction: column;
          gap: 0.375rem;
        }
        .product-row {
          display: flex;
          align-items: center;
          gap: 0.875rem;
          padding: 0.625rem 0.875rem;
          background: hsl(var(--card));
          border: 1px solid hsl(var(--border));
          border-radius: 10px;
          cursor: pointer;
          transition: border-color 150ms, background 150ms, transform 150ms;
        }
        .product-row:hover {
          border-color: hsl(var(--primary) / 0.5);
          background: hsl(var(--accent) / 0.4);
        }
        .product-row.is-selected {
          border-color: hsl(var(--primary));
          background: hsl(var(--primary) / 0.06);
          box-shadow: inset 3px 0 0 hsl(var(--primary));
        }
        .row-thumb {
          position: relative;
          width: 44px;
          height: 44px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 8px;
          overflow: hidden;
          flex-shrink: 0;
        }
        .row-check {
          position: absolute;
          top: -3px;
          right: -3px;
          width: 16px;
          height: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          background: hsl(var(--primary));
          border: 2px solid hsl(var(--card));
          border-radius: 999px;
          animation: check-in 180ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes check-in {
          from { transform: scale(0.3); opacity: 0; }
          to   { transform: scale(1); opacity: 1; }
        }
        .row-body {
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
        }
        .row-price {
          font-size: 14px;
          font-weight: 600;
          color: hsl(var(--foreground));
          flex-shrink: 0;
          padding: 0 0.625rem;
          border-left: 1px dashed hsl(var(--border));
          line-height: 1;
        }
        .row-action { flex-shrink: 0; }

        .spec-pill {
          padding: 0.1rem 0.4rem;
          font-size: 10px;
          color: hsl(var(--muted-foreground));
          background: hsl(var(--muted));
          border-radius: 3px;
          line-height: 1.4;
        }
        .spec-pill-mono { font-family: var(--font-mono); }

        .add-btn-row {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          padding: 0.375rem 0.75rem;
          font-size: 12px;
          font-weight: 600;
          color: hsl(var(--foreground));
          background: hsl(var(--background));
          border: 1px solid hsl(var(--border));
          border-radius: 8px;
          cursor: pointer;
          transition: all 150ms;
        }
        .add-btn-row:hover {
          color: hsl(var(--primary));
          border-color: hsl(var(--primary));
          background: hsl(var(--primary) / 0.06);
        }
        .qty-control {
          display: inline-flex;
          align-items: center;
          gap: 0;
          padding: 0;
          background: hsl(var(--primary) / 0.08);
          border: 1px solid hsl(var(--primary) / 0.4);
          border-radius: 8px;
          overflow: hidden;
        }
        .qty-control button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          font-size: 14px;
          font-weight: 600;
          color: hsl(var(--primary));
          background: transparent;
          border: 0;
          cursor: pointer;
          transition: background 150ms;
        }
        .qty-control button:hover { background: hsl(var(--primary) / 0.15); }
        .qty-num {
          min-width: 2rem;
          text-align: center;
          font-size: 13px;
          font-weight: 700;
          color: hsl(var(--primary));
          padding: 0 0.25rem;
          border-left: 1px solid hsl(var(--primary) / 0.25);
          border-right: 1px solid hsl(var(--primary) / 0.25);
        }

        .empty-grid {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 3rem 1rem;
          background: hsl(var(--background));
          border: 1px dashed hsl(var(--border));
          border-radius: 10px;
        }

        /* ─── Queue side ────────────────────────────────── */
        .queue-side {
          position: sticky;
          top: 1rem;
          display: flex;
          flex-direction: column;
          gap: 0.875rem;
        }
        .queue-card,
        .preview-card {
          background: hsl(var(--card));
          border: 1px solid hsl(var(--border));
          border-radius: 14px;
          padding: 0.875rem 1rem;
        }
        .queue-card-head,
        .preview-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding-bottom: 0.625rem;
          margin-bottom: 0.5rem;
          border-bottom: 1px solid hsl(var(--border));
        }
        .queue-clear {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          padding: 0.25rem 0.5rem;
          font-size: 11px;
          color: hsl(var(--muted-foreground));
          background: transparent;
          border: 0;
          border-radius: 4px;
          cursor: pointer;
        }
        .queue-clear:hover { color: hsl(var(--destructive)); background: hsl(var(--destructive) / 0.08); }

        .queue-list {
          list-style: none;
          padding: 0;
          margin: 0;
          max-height: 260px;
          overflow-y: auto;
        }
        .queue-item {
          display: flex;
          align-items: center;
          gap: 0.625rem;
          padding: 0.5rem 0;
          border-bottom: 1px dashed hsl(var(--border));
          animation: row-in 200ms ease-out;
        }
        .queue-item:last-child { border-bottom: 0; }
        @keyframes row-in {
          from { opacity: 0; transform: translateX(-4px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        .queue-marker {
          flex-shrink: 0;
          width: 20px;
          display: flex;
          justify-content: center;
        }
        .queue-qty {
          flex-shrink: 0;
          padding: 0.25rem 0.5rem;
          background: hsl(var(--muted));
          border-radius: 6px;
          font-size: 12px;
        }
        .queue-x {
          width: 22px;
          height: 22px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: hsl(var(--muted-foreground));
          background: transparent;
          border: 0;
          border-radius: 4px;
          cursor: pointer;
        }
        .queue-x:hover { color: hsl(var(--destructive)); background: hsl(var(--destructive) / 0.08); }

        .queue-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 1rem 0.5rem 0.5rem;
        }
        .ghost-stack {
          position: relative;
          width: 110px;
          height: 70px;
        }
        .ghost-paper {
          position: absolute;
          inset: 0;
          background: hsl(var(--background));
          border: 1px dashed hsl(var(--border));
          border-radius: 4px;
        }
        .ghost-paper:nth-child(1) { transform: rotate(-6deg) translate(-6px, 4px); opacity: 0.5; }
        .ghost-paper:nth-child(2) { transform: rotate(3deg) translate(2px, 2px); opacity: 0.7; }
        .ghost-paper.top {
          background: white;
          border-style: dashed;
          border-color: hsl(var(--border));
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 6px;
          color: black;
          box-shadow: 0 4px 12px -4px hsl(0 0% 0% / 0.15);
        }

        /* Preview deck */
        .preview-stack {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          align-items: center;
          max-height: 360px;
          overflow-y: auto;
          padding: 0.5rem;
          background:
            radial-gradient(circle at 1px 1px, hsl(var(--muted-foreground) / 0.15) 1px, transparent 0)
            0 0 / 14px 14px,
            hsl(var(--background));
          border-radius: 8px;
        }
        .dieline {
          position: relative;
          padding: 6px;
          background: white;
          box-shadow:
            0 1px 0 hsl(var(--border)),
            0 6px 16px -8px hsl(0 0% 0% / 0.2);
          animation: dieline-in 240ms ease-out;
        }
        @keyframes dieline-in {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .dieline .mark {
          position: absolute;
          width: 7px;
          height: 7px;
          border-color: hsl(var(--primary) / 0.65);
          border-style: solid;
          border-width: 0;
        }
        .dieline .mark-tl { top: -2px; left: -2px; border-top-width: 1.5px; border-left-width: 1.5px; }
        .dieline .mark-tr { top: -2px; right: -2px; border-top-width: 1.5px; border-right-width: 1.5px; }
        .dieline .mark-bl { bottom: -2px; left: -2px; border-bottom-width: 1.5px; border-left-width: 1.5px; }
        .dieline .mark-br { bottom: -2px; right: -2px; border-bottom-width: 1.5px; border-right-width: 1.5px; }

        .preview-more {
          width: 100%;
          padding: 0.5rem;
          text-align: center;
          font-size: 11px;
          color: hsl(var(--muted-foreground));
          background: hsl(var(--card));
          border: 1px dashed hsl(var(--border));
          border-radius: 6px;
        }

        /* PRINT cta */
        .print-cta {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.875rem 1rem;
          color: hsl(var(--primary-foreground));
          background:
            linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--primary) / 0.85) 100%);
          border: 0;
          border-radius: 14px;
          cursor: pointer;
          transition: transform 200ms, box-shadow 200ms, filter 200ms;
          box-shadow: 0 8px 24px -8px hsl(var(--primary) / 0.6);
        }
        .print-cta:not(:disabled):hover {
          transform: translateY(-1px);
          filter: brightness(1.05);
          box-shadow: 0 12px 28px -8px hsl(var(--primary) / 0.7);
        }
        .print-cta:disabled {
          background: hsl(var(--muted));
          color: hsl(var(--muted-foreground));
          cursor: not-allowed;
          box-shadow: none;
        }

        /* ─── Print rules ────────────────────────────────── */
        @media print {
          @page { size: 50mm 30mm; margin: 0; }

          /* Hide everything (MainLayout sidebar/topbar/etc.) */
          html, body { margin: 0; padding: 0; background: white; }
          body * { visibility: hidden !important; }

          /* Reveal only the stickers */
          .print-stickers, .print-stickers * { visibility: visible !important; }
          .print-stickers {
            position: absolute;
            top: 0;
            left: 0;
            width: 50mm;
          }

          .print\\:hidden { display: none !important; }
          .print\\:block { display: block !important; }
          .sticker {
            page-break-after: always;
            page-break-inside: avoid;
            break-after: page;
            break-inside: avoid;
            border: 0 !important;
            margin: 0;
          }
          .sticker:last-child {
            page-break-after: auto;
            break-after: auto;
          }
        }
      `}</style>
    </div>
  );
}
