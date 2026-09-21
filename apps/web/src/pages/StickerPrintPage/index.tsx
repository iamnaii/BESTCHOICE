import { useCallback, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Plus,
  Printer,
  ScanLine,
  Search,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import type { TableSort } from '@/components/ui/DataTable';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { useDebounce } from '@/hooks/useDebounce';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { cn } from '@/lib/utils';
import type { StockProduct } from '@/pages/StockPage/types';
import { StickerCard, STICKER_STYLES } from './StickerCard';
import { DEFAULT_PICKER_SORT, StickerPickerTable } from './StickerPickerTable';
import { buildStickerView, type StickerProductData, type StickerQuotes, type StickerView } from './stickerView';
import { useStickerQuotes, type QuotableProduct } from './useStickerQuotes';

interface PrintItem {
  /** Product ID หรือ IMEI ตามที่ถูกเพิ่ม (ตาราง = ID · ช่องสแกน = อะไรก็ได้ที่ยิงมา) */
  key: string;
  qty: number;
}

interface StockPage {
  data: StockProduct[];
  total: number;
  page: number;
  totalPages: number;
}

type QueueState = 'ready' | 'noPrice' | 'loading' | 'missing';

const PAGE_SIZE = 20;
const ALL_BRANDS = 'ทั้งหมด';
const TAPE_PER_STICKER_MM = 52;
const PREVIEW_LIMIT = 8;
const RECENT_KEY = 'sticker-print:recent';
const MAX_RECENT = 8;
const EMPTY_QUOTES: StickerQuotes = { rate1: null, rate2: null };

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string').slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function saveRecent(keys: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([...new Set([...keys, ...loadRecent()])].slice(0, MAX_RECENT)));
  } catch {
    // localStorage ปิดอยู่ — ไม่ต้องจำรายการล่าสุด
  }
}

function toQuotable(product: StockProduct | StickerProductData): QuotableProduct {
  return {
    id: 'productId' in product ? product.productId : product.id,
    brand: product.brand,
    model: product.model,
    storage: product.storage,
    category: product.category,
    cashPrice: product.cashPrice,
    installmentPrice: product.installmentPrice,
    prices: product.prices,
  };
}

const QUEUE_ICON: Record<QueueState, typeof CheckCircle2> = {
  ready: CheckCircle2,
  noPrice: AlertCircle,
  loading: Loader2,
  missing: AlertCircle,
};

/**
 * หน้าพิมพ์สติกเกอร์ติดเครื่อง (thermal 50×30 มม.) — ราคาและค่างวดจากตัวเครื่อง สูตรเดียวกับหน้าสินค้า
 * ซ้าย: ตารางเลือกเครื่องพร้อมขาย (เรียงรับเข้าใหม่ → เก่า) · ขวา: คิวพิมพ์ + พรีวิวดวง + ปุ่มพิมพ์
 * เครื่องที่ยังไม่ตั้งราคาถูกเตือนในคิวและถูกข้ามตอนพิมพ์ (ไม่มีดวง ฿0 อีก)
 */
export default function StickerPrintPage() {
  useDocumentTitle('พิมพ์สติกเกอร์');
  const [searchParams] = useSearchParams();

  const [items, setItems] = useState<PrintItem[]>(() =>
    (searchParams.get('productIds') ?? '')
      .split(',')
      .map((key) => key.trim())
      .filter(Boolean)
      .map((key) => ({ key, qty: 1 })),
  );
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 200);
  const [brand, setBrand] = useState(ALL_BRANDS);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<TableSort>(DEFAULT_PICKER_SORT);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanInput, setScanInput] = useState('');
  const [recent, setRecent] = useState<string[]>(() => loadRecent());
  const scanRef = useRef<HTMLInputElement>(null);

  /* ─── สต็อกพร้อมขาย (endpoint เดียวกับหน้ารายการสินค้า — เรียง/แบ่งหน้า/ค้นหาที่เซิร์ฟเวอร์) ── */
  const stockQuery = useQuery<StockPage>({
    queryKey: ['sticker-stock', debouncedSearch, brand, page, sort.key, sort.direction],
    queryFn: async () => {
      const params: Record<string, string | number> = {
        status: 'IN_STOCK',
        page,
        limit: PAGE_SIZE,
        sortBy: sort.key,
        sortDirection: sort.direction,
      };
      if (debouncedSearch) params.search = debouncedSearch;
      if (brand !== ALL_BRANDS) params.brand = brand;
      const res = await api.get('/products', { params });
      return res.data as StockPage;
    },
  });

  const brandsQuery = useQuery<string[]>({
    queryKey: ['sticker-brands'],
    queryFn: async () => {
      const res = await api.get('/products/brands');
      return Array.isArray(res.data) ? (res.data as string[]) : [];
    },
  });

  /* ─── ข้อมูลเครื่องในคิว (ค้นได้ทั้ง ID และ IMEI) ───────────────────────────── */
  const keys = useMemo(() => items.map((item) => item.key), [items]);
  const keysKey = keys.join(',');
  const dataQuery = useQuery<StickerProductData[]>({
    queryKey: ['sticker-data', keysKey],
    queryFn: async () => {
      const res = await api.get(`/sticker-templates/products/data?ids=${encodeURIComponent(keysKey)}`);
      return Array.isArray(res.data) ? (res.data as StickerProductData[]) : [];
    },
    enabled: keys.length > 0,
  });

  const productByKey = useMemo(() => {
    const map = new Map<string, StickerProductData>();
    for (const product of dataQuery.data ?? []) {
      map.set(product.productId, product);
      if (product.imei) map.set(product.imei, product);
    }
    return map;
  }, [dataQuery.data]);

  /* ─── ค่างวด (เรท 1/เรท 2) ของทั้งคิวและหน้าตาราง — สูตรเดียวกับหน้ารายละเอียดสินค้า ─ */
  const quotable = useMemo(() => {
    const map = new Map<string, QuotableProduct>();
    for (const product of stockQuery.data?.data ?? []) map.set(product.id, toQuotable(product));
    for (const product of dataQuery.data ?? []) map.set(product.productId, toQuotable(product));
    return [...map.values()];
  }, [stockQuery.data, dataQuery.data]);
  const { quotes, isLoading: quotesLoading } = useStickerQuotes(quotable);

  const queue = useMemo(
    () =>
      items.map((item) => {
        const product = productByKey.get(item.key) ?? null;
        const view = product ? buildStickerView(product, quotes.get(product.productId) ?? EMPTY_QUOTES) : null;
        const state: QueueState = product
          ? view
            ? 'ready'
            : 'noPrice'
          : dataQuery.isFetching
            ? 'loading'
            : 'missing';
        return { item, product, view, state };
      }),
    [items, productByKey, quotes, dataQuery.isFetching],
  );

  const printable = useMemo(
    () =>
      queue.flatMap((entry) =>
        entry.view ? Array.from({ length: entry.item.qty }, (): StickerView => entry.view as StickerView) : [],
      ),
    [queue],
  );
  const skippedNoPrice = queue.filter((entry) => entry.state === 'noPrice').length;
  const queuedQty = useMemo(
    () => new Map(queue.filter((entry) => entry.product).map((entry) => [entry.product!.productId, entry.item.qty])),
    [queue],
  );
  const tapeCm = (printable.length * TAPE_PER_STICKER_MM) / 10;

  /* ─── การกระทำ ────────────────────────────────────────────────────────────── */
  const addKeys = useCallback(
    (incoming: string[]) => {
      const cleaned = incoming.map((key) => key.trim()).filter(Boolean);
      if (cleaned.length === 0) return;
      setItems((prev) => {
        const next = [...prev];
        const known = new Set(prev.map((item) => item.key));
        const knownProducts = new Set(
          prev.map((item) => productByKey.get(item.key)?.productId).filter((id): id is string => !!id),
        );
        for (const key of cleaned) {
          const productId = productByKey.get(key)?.productId;
          if (known.has(key) || (productId && knownProducts.has(productId))) continue;
          known.add(key);
          if (productId) knownProducts.add(productId);
          next.push({ key, qty: 1 });
        }
        return next;
      });
      saveRecent(cleaned);
      setRecent(loadRecent());
    },
    [productByKey],
  );
  const setQty = useCallback((productId: string, delta: number) => {
    setItems((prev) =>
      prev.map((item) => {
        const resolved = productByKey.get(item.key)?.productId ?? item.key;
        return resolved === productId ? { ...item, qty: Math.max(1, item.qty + delta) } : item;
      }),
    );
  }, [productByKey]);
  const removeProduct = useCallback(
    (productId: string) =>
      setItems((prev) => prev.filter((item) => (productByKey.get(item.key)?.productId ?? item.key) !== productId)),
    [productByKey],
  );
  const removeKey = (key: string) => setItems((prev) => prev.filter((item) => item.key !== key));
  const handleScan = () => {
    addKeys(scanInput.split(/[\s,]+/));
    setScanInput('');
    scanRef.current?.focus();
  };
  const onSortChange = (next: TableSort | null) => {
    setSort(next ?? DEFAULT_PICKER_SORT);
    setPage(1);
  };

  const products = stockQuery.data?.data ?? [];
  const brandChips = [ALL_BRANDS, ...(brandsQuery.data ?? [])];
  const printLabel =
    printable.length > 0
      ? `${printable.length} ดวง · ใช้เทป ~${tapeCm.toFixed(1)} ซม.` +
        (skippedNoPrice > 0 ? ` · ข้าม ${skippedNoPrice} เครื่องที่ยังไม่ตั้งราคา` : '')
      : skippedNoPrice > 0
        ? `ยังพิมพ์ไม่ได้ — ${skippedNoPrice} เครื่องในคิวยังไม่ตั้งราคา`
        : 'ยังไม่มีรายการในคิว';

  return (
    <div>
      <style>{STICKER_STYLES}</style>
      <div className="print:hidden">
        <PageHeader
          icon={<Tag aria-hidden="true" className="size-4" strokeWidth={1.75} />}
          title="พิมพ์สติกเกอร์"
          subtitle="เลือกเครื่องจากสต็อกพร้อมขาย เพิ่มเข้าคิว แล้วสั่งพิมพ์ทีเดียว · thermal 50 × 30 mm · ราคาและค่างวดจากตัวเครื่อง"
          action={
            <div className="hidden items-center gap-3 rounded-md border border-border bg-card px-3.5 py-1.5 text-xs sm:flex">
              <span>
                <b className="font-semibold tabular-nums">{items.length}</b>{' '}
                <span className="text-muted-foreground">รายการ</span>
              </span>
              <span className="text-border">·</span>
              <span>
                <b className="font-semibold tabular-nums">{printable.length}</b>{' '}
                <span className="text-muted-foreground">ดวง</span>
              </span>
              <span className="text-border">·</span>
              <span>
                <b className="font-semibold tabular-nums">{tapeCm.toFixed(0)}</b>{' '}
                <span className="text-muted-foreground">ซม.เทป</span>
              </span>
            </div>
          }
        />

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* ─── ซ้าย: เลือกเครื่อง ─────────────────────────────────────────── */}
          <section className="min-w-0 rounded-xl border border-border bg-card p-4">
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  placeholder="ค้นหาแบรนด์ / รุ่น / IMEI ในสต็อก…"
                  className="h-11 w-full rounded-lg border border-input bg-background pl-10 pr-9 text-sm text-foreground outline-none placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
                  spellCheck={false}
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    aria-label="ล้างคำค้น"
                    className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <X aria-hidden="true" className="size-3.5" />
                  </button>
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => setScanOpen((open) => !open)}
                className={cn('h-11', scanOpen && 'border-primary bg-primary/10 text-primary')}
              >
                <ScanLine aria-hidden="true" className="size-4" />
                <span className="hidden sm:inline">สแกน IMEI / วาง ID</span>
              </Button>
            </div>

            {scanOpen && (
              <div className="mt-2.5 rounded-lg border border-border bg-background p-3.5">
                <div className="flex gap-2">
                  <input
                    ref={scanRef}
                    autoFocus
                    type="text"
                    value={scanInput}
                    onChange={(e) => setScanInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleScan();
                      }
                    }}
                    placeholder="ยิงบาร์โค้ด IMEI หรือวาง Product ID หลายตัว คั่นด้วยช่องว่าง / comma"
                    className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-card px-3 font-mono text-sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
                    spellCheck={false}
                  />
                  <Button type="button" onClick={handleScan} disabled={!scanInput.trim()} className="h-10">
                    <Plus aria-hidden="true" className="size-4" />
                    เพิ่ม
                  </Button>
                </div>
                {recent.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="mr-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">ใช้ล่าสุด</span>
                    {recent.map((key) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => addKeys([key])}
                        disabled={items.some((item) => item.key === key)}
                        className="rounded-full border border-border bg-card px-2 py-0.5 font-mono text-[11px] text-foreground hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {key.length > 14 ? `…${key.slice(-12)}` : key}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {brandChips.length > 1 && (
              <div className="my-3.5 flex flex-wrap gap-1.5 border-b border-dashed border-border pb-3.5">
                {brandChips.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => {
                      setBrand(chip);
                      setPage(1);
                    }}
                    className={cn(
                      'rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors',
                      brand === chip
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-background text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {chip}
                  </button>
                ))}
              </div>
            )}

            <QueryBoundary
              isLoading={false}
              isError={stockQuery.isError}
              error={stockQuery.error}
              onRetry={stockQuery.refetch}
              errorTitle="โหลดสต็อกไม่สำเร็จ"
            >
              <StickerPickerTable
                products={products}
                isLoading={stockQuery.isLoading}
                quotes={quotes}
                quotesLoading={quotesLoading}
                queued={queuedQty}
                sort={sort}
                onSortChange={onSortChange}
                pagination={{
                  page: stockQuery.data?.page ?? page,
                  totalPages: stockQuery.data?.totalPages ?? 1,
                  total: stockQuery.data?.total ?? 0,
                  onPageChange: setPage,
                }}
                onAdd={(product) => addKeys([product.id])}
                onIncrement={(id) => setQty(id, 1)}
                onDecrement={(id) => setQty(id, -1)}
                onRemove={removeProduct}
              />
            </QueryBoundary>
            <p className="mt-3 text-xs text-muted-foreground leading-snug">
              เรียงตามวันที่รับเข้า ใหม่ → เก่า เป็นค่าเริ่มต้น · กดหัวคอลัมน์ รุ่น / เงินสด / รับเข้า เพื่อเรียงอย่างอื่น ·
              ตัวเลขเรท 1 (ผ่อนกับร้าน) และเรท 2 (ไฟแนนซ์) เป็นชุดเดียวกับหน้ารายละเอียดสินค้า
            </p>
          </section>

          {/* ─── ขวา: คิวพิมพ์ + พรีวิว ────────────────────────────────────── */}
          <aside className="flex flex-col gap-3.5 lg:sticky lg:top-4">
            <div className="rounded-xl border border-border bg-card px-4 py-3.5">
              <div className="mb-2 flex items-center justify-between border-b border-border pb-2.5">
                <h2 className="text-[15px] font-semibold leading-snug">คิวพิมพ์</h2>
                {items.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={() => setItems([])}>
                    <Trash2 aria-hidden="true" className="size-3" />
                    ล้าง
                  </Button>
                )}
              </div>
              {items.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground leading-snug">
                  เลือกเครื่องจากตารางด้านซ้าย หรือยิงบาร์โค้ด IMEI เพื่อเริ่มสร้างคิวพิมพ์
                </p>
              ) : (
                <ul aria-label="คิวพิมพ์" className="max-h-72 overflow-y-auto">
                  {queue.map(({ item, product, view, state }, index) => {
                    const Icon = QUEUE_ICON[state];
                    const sub =
                      state === 'ready' && view
                        ? [
                            `฿${view.cash}`,
                            ...view.rates.map((rate) => `เรท ${rate.no} ${rate.monthly}`),
                            view.used
                              ? `แบต ${view.used.battery ?? '—'}${view.used.battery != null ? '%' : ''}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')
                        : state === 'noPrice'
                          ? 'ยังไม่ตั้งราคา — จะไม่ถูกพิมพ์ จนกว่าจะตั้งราคาที่หน้าสินค้า'
                          : state === 'loading'
                            ? 'กำลังโหลด…'
                            : 'ไม่พบ ID / IMEI นี้ในสต็อก';
                    return (
                      <li
                        key={item.key}
                        className="flex items-center gap-2.5 border-b border-dashed border-border py-2 last:border-b-0"
                      >
                        <Icon
                          aria-hidden="true"
                          className={cn(
                            'size-4 shrink-0',
                            state === 'ready' && 'text-primary',
                            state === 'noPrice' && 'text-warning-strong',
                            state === 'missing' && 'text-destructive',
                            state === 'loading' && 'animate-spin text-muted-foreground',
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-medium leading-snug">
                            {product ? product.model || product.name : state === 'loading' ? 'กำลังโหลด…' : 'ไม่พบสินค้า'}
                          </div>
                          <div
                            className={cn(
                              'text-[11px] leading-snug',
                              state === 'noPrice' ? 'text-warning-strong' : state === 'missing' ? 'text-destructive' : 'text-muted-foreground',
                            )}
                          >
                            #{index + 1} · {sub}
                          </div>
                        </div>
                        <span
                          className={cn(
                            'shrink-0 rounded-md bg-muted px-2 py-1 text-xs',
                            state !== 'ready' && 'opacity-50',
                          )}
                        >
                          <span className="font-mono font-semibold tabular-nums">{item.qty}</span>
                          <span className="ml-0.5 text-[10px] text-muted-foreground">ดวง</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => removeKey(item.key)}
                          aria-label={`ลบ ${product?.model || item.key} ออกจากคิว`}
                          className="grid size-7 shrink-0 place-items-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        >
                          <X aria-hidden="true" className="size-3.5" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {printable.length > 0 && (
              <div className="rounded-xl border border-border bg-card px-4 py-3.5">
                <div className="mb-2 flex items-center justify-between border-b border-border pb-2.5 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  <span>preview</span>
                  <span className="tabular-nums">
                    {printable.length} ดวง · {tapeCm.toFixed(1)} cm
                  </span>
                </div>
                <div className="flex max-h-96 flex-col items-center gap-3 overflow-y-auto rounded-lg bg-background p-2.5">
                  {printable.slice(0, PREVIEW_LIMIT).map((view, index) => (
                    <div key={`${view.productId}-${index}`} className="bg-white p-1.5 shadow-md">
                      <StickerCard view={view} />
                    </div>
                  ))}
                  {printable.length > PREVIEW_LIMIT && (
                    <div className="w-full rounded-md border border-dashed border-border py-2 text-center font-mono text-[11px] text-muted-foreground">
                      + อีก {printable.length - PREVIEW_LIMIT} ดวง
                    </div>
                  )}
                </div>
              </div>
            )}

            <Button
              type="button"
              size="lg"
              onClick={() => window.print()}
              disabled={printable.length === 0}
              className="h-auto items-center justify-start gap-3 px-4 py-3.5 text-left"
            >
              <Printer aria-hidden="true" className="size-5" />
              <span className="flex-1">
                <span className="block text-[15px] font-semibold leading-snug">พิมพ์สติกเกอร์</span>
                <span className="block text-[11px] font-normal leading-snug opacity-85">{printLabel}</span>
              </span>
              <span className="font-mono text-sm tabular-nums opacity-90">{printable.length}</span>
            </Button>
          </aside>
        </div>
      </div>

      {/* ─── ชุดพิมพ์จริง (แสดงเฉพาะตอนพิมพ์) ─────────────────────────────────── */}
      <div className="print-stickers hidden print:block">
        {printable.map((view, index) => (
          <StickerCard key={`print-${view.productId}-${index}`} view={view} />
        ))}
      </div>
    </div>
  );
}
