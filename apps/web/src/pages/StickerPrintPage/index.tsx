import { useCallback, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Minus,
  Plus,
  Printer,
  ScanLine,
  Search,
  Tag,
  Trash2,
  X,
} from '@/lib/icons';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import type { TableSort } from '@/components/ui/DataTable';
import { NativeSelect } from '@/components/ui/native-select';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { useDebounce } from '@/hooks/useDebounce';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useUiFlags } from '@/hooks/useUiFlags';
import { cn } from '@/lib/utils';
import type { StockProduct } from '@/pages/StockPage/types';
import { DEFAULT_STICKER_SIZE, STICKER_SIZES, StickerCard, stickerStyles, type StickerSize } from './StickerCard';
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
/**
 * ความสูงตารางเลือกเครื่อง — ให้ทั้งหน้าพอดีหนึ่งจอ (แถบบน + หัวหน้า + แถบค้นหา + ปุ่มเปลี่ยนหน้า
 * + ขอบล่างของเลย์เอาต์ ≈ 21.5rem · วัดที่จอ 1366×800) · จอเตี้ยมากยังเห็นอย่างน้อย ~4 แถว
 */
const PICKER_MAX_HEIGHT = 'max(16rem, calc(100dvh - 21.5rem))';
/** เปิดช่องสแกนอยู่ — ตารางหดเท่าความสูงช่องสแกน (+ แถวใช้ล่าสุด ≈ 8rem) หน้ายังพอดีจอ */
const PICKER_MAX_HEIGHT_SCAN = 'max(16rem, calc(100dvh - 29.5rem))';

/** ขนาดม้วนจากตั้งค่า — เซิร์ฟเวอร์รุ่นก่อนก้อน 3 ไม่ส่งช่องนี้ และค่าแปลก ๆ ตกไปขนาดเริ่มต้น */
function resolveStickerSize(raw: string | undefined): StickerSize {
  return raw && raw in STICKER_SIZES ? (raw as StickerSize) : DEFAULT_STICKER_SIZE;
}
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

function toQuotable(product: StickerProductData): QuotableProduct {
  return {
    id: product.productId,
    brand: product.brand,
    model: product.model,
    storage: product.storage,
    category: product.category,
    // ค่างวด GFIN บนดวงคิด OVER ตามที่มาเครื่อง (API ส่ง null เมื่อยังไม่ระบุ) — ส่งต่อแบบเดียวกับหน้ารายละเอียดสินค้า
    deviceOrigin: product.deviceOrigin,
    cashPrice: product.cashPrice,
    installmentPrice: product.installmentPrice,
    financePrice: product.financePrice ?? null,
    prices: product.prices,
    // เงื่อนไขผ่อนของราคากลาง (งวด/ดาวน์ตั้งต้น) มากับข้อมูลสติกเกอร์ของเครื่องในคิวอยู่แล้ว —
    // ตารางไม่แสดงค่างวด จึงไม่ต้องขอเงื่อนไขของทั้งหน้าตารางแยกอีกเส้น
    templateTerms: product.templateTerms ?? null,
  };
}

const QUEUE_ICON: Record<QueueState, typeof CheckCircle2> = {
  ready: CheckCircle2,
  noPrice: AlertCircle,
  loading: Loader2,
  missing: AlertCircle,
};

/**
 * หน้าพิมพ์สติกเกอร์ติดเครื่อง (thermal — ขนาดม้วนและ QR ตามตั้งค่า ค่าเริ่มต้น 60×40 มม. + QR)
 * ราคาและค่างวดจากตัวเครื่อง สูตรเดียวกับหน้าสินค้า
 * ซ้าย: ตารางเลือกเครื่องพร้อมขาย (เรียงรับเข้าใหม่ → เก่า · เลื่อนในกรอบ ทั้งหน้าพอดีหนึ่งจอ)
 * ขวา: คิวพิมพ์ (ปรับจำนวนดวง) + ตัวอย่างดวงที่เลือกทีละดวง + ปุ่มพิมพ์
 * เครื่องที่ยังไม่ตั้งราคาถูกเตือนในคิวและถูกข้ามตอนพิมพ์ (ไม่มีดวง ฿0 อีก)
 */
export default function StickerPrintPage() {
  useDocumentTitle('พิมพ์สติกเกอร์');
  const [searchParams] = useSearchParams();
  const flags = useUiFlags();
  const size = resolveStickerSize(flags.stickerSize);
  const showQr = flags.stickerShowQr ?? true;
  const sizeLabel = STICKER_SIZES[size].label;

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
  /** ดวงที่โชว์ในตัวอย่าง — ไม่ตั้ง/หาไม่เจอ = ดวงแรกในคิวที่พิมพ์ได้ */
  const [previewKey, setPreviewKey] = useState<string | null>(null);
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

  /* ─── ค่างวด (เรท 1/เรท 2) ของเครื่องในคิว — สูตรเดียวกับหน้ารายละเอียดสินค้า ─────── */
  const quotable = useMemo(() => (dataQuery.data ?? []).map(toQuotable), [dataQuery.data]);
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
  const preview =
    queue.find((entry) => entry.view && entry.item.key === previewKey) ?? queue.find((entry) => entry.view) ?? null;
  const readyCount = queue.filter((entry) => entry.view).length;

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
      // ดวงที่เพิ่งเพิ่มขึ้นตัวอย่างทันที — ให้เห็นว่ากำลังจะพิมพ์อะไร
      setPreviewKey(cleaned[cleaned.length - 1]);
      saveRecent(cleaned);
      setRecent(loadRecent());
    },
    [productByKey],
  );
  const changeQty = (key: string, delta: number) =>
    setItems((prev) => prev.map((item) => (item.key === key ? { ...item, qty: Math.max(1, item.qty + delta) } : item)));
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
  const brands = brandsQuery.data ?? [];
  const printLabel =
    printable.length > 0
      ? `${printable.length} ดวง` +
        (quotesLoading ? ' · กำลังคำนวณค่างวด…' : '') +
        (skippedNoPrice > 0 ? ` · ข้าม ${skippedNoPrice} เครื่องที่ยังไม่ตั้งราคา` : '')
      : skippedNoPrice > 0
        ? `ยังพิมพ์ไม่ได้ — ${skippedNoPrice} เครื่องในคิวยังไม่ตั้งราคา`
        : 'เพิ่มเครื่องเข้าคิวก่อน';

  return (
    <div>
      <style>{stickerStyles(size)}</style>
      <div className="print:hidden">
        <PageHeader
          className="mb-4 py-3"
          icon={<Tag aria-hidden="true" className="size-4" strokeWidth={1.75} />}
          title="พิมพ์สติกเกอร์"
          badge={
            <span className="rounded-md border border-border bg-muted px-2 py-0.5 text-xs leading-snug text-muted-foreground">
              ม้วน {sizeLabel} · {showQr ? 'มี QR' : 'ไม่มี QR'}
            </span>
          }
          helpLabel="วิธีพิมพ์สติกเกอร์"
          help={`กด "เพิ่ม" ที่เครื่องในรายการ หรือกด "สแกน IMEI" แล้วยิงบาร์โค้ด — เครื่องเข้าคิวทางขวา ปรับจำนวนดวงได้ที่คิว แล้วกดพิมพ์ ราคาและค่างวด (เรท 1 ผ่อนกับร้าน · เรท 2 ไฟแนนซ์) อ้างอิงข้อมูลของแต่ละเครื่อง ดูได้ที่ตัวอย่างดวง กดรายการในคิวเพื่อดูดวงอื่น · เครื่องพิมพ์ความร้อน ${sizeLabel}${showQr ? ' พร้อม QR ของ IMEI/รหัสสินค้าให้เครื่องยิงอ่าน' : ''} — เจ้าของระบบเปลี่ยนขนาดม้วนหรือเปิด/ปิด QR ได้ที่ ตั้งค่า › สินค้า & การขาย › สติกเกอร์ฉลาก`}
        />

        {/* การ์ดขวาแคบลงที่จอกลาง (≥ 300px ยังพอตัวอย่างดวง 60 มม.) — ให้ตารางซ้ายกว้างพอเป็นแถว ไม่กลายเป็นการ์ด */}
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_340px]">
          {/* ─── ซ้าย: เลือกเครื่อง ─────────────────────────────────────────── */}
          <section aria-label="เลือกเครื่อง" className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
            <div className="border-b border-border p-3">
              <div className="flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  />
                  <input
                    aria-label="ค้นหารุ่น หรือ IMEI ในสต็อก"
                    type="text"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                    placeholder="ค้นหารุ่น หรือ IMEI…"
                    className="h-11 w-full rounded-lg border border-input bg-background pl-10 pr-9 text-sm text-foreground outline-none placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
                    spellCheck={false}
                  />
                  {search && (
                    <button
                      data-ui-control="button"
                      data-ui-icon="true"
                      type="button"
                      onClick={() => setSearch('')}
                      aria-label="ล้างคำค้น"
                      className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <X aria-hidden="true" className="size-3.5" />
                    </button>
                  )}
                </div>
                {brands.length > 0 && (
                  <NativeSelect
                    aria-label="ยี่ห้อ"
                    value={brand}
                    onChange={(e) => {
                      setBrand(e.target.value);
                      setPage(1);
                    }}
                    wrapperClassName="w-32 shrink-0 sm:w-40"
                  >
                    <option value={ALL_BRANDS}>ทุกยี่ห้อ</option>
                    {brands.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </NativeSelect>
                )}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setScanOpen((open) => !open)}
                  aria-expanded={scanOpen}
                  aria-label="สแกน IMEI / วาง ID"
                  className={cn('h-11 shrink-0', scanOpen && 'border-primary bg-primary/10 text-primary')}
                >
                  <ScanLine aria-hidden="true" className="size-4" />
                  <span className="hidden xl:inline">สแกน IMEI</span>
                </Button>
              </div>

              {scanOpen && (
                <div className="mt-2.5 rounded-lg border border-border bg-background p-3">
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
                      aria-label="ยิงบาร์โค้ด IMEI หรือวางรหัสสินค้า"
                      placeholder="ยิงบาร์โค้ด IMEI หรือวางรหัสสินค้า (หลายตัวคั่นด้วยช่องว่าง)"
                      className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-card px-3 font-mono text-sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
                      spellCheck={false}
                    />
                    <Button type="button" onClick={handleScan} disabled={!scanInput.trim()} className="h-10">
                      <Plus aria-hidden="true" className="size-4" />
                      เพิ่ม
                    </Button>
                  </div>
                  {recent.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="mr-1 text-[11px] text-muted-foreground">ใช้ล่าสุด</span>
                      {recent.map((key) => (
                        <button
                          data-ui-control="button"
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
            </div>

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
                queued={queuedQty}
                sort={sort}
                onSortChange={onSortChange}
                maxHeight={scanOpen ? PICKER_MAX_HEIGHT_SCAN : PICKER_MAX_HEIGHT}
                pagination={{
                  page: stockQuery.data?.page ?? page,
                  totalPages: stockQuery.data?.totalPages ?? 1,
                  total: stockQuery.data?.total ?? 0,
                  onPageChange: setPage,
                }}
                onAdd={(product) => addKeys([product.id])}
                onRemove={removeProduct}
              />
            </QueryBoundary>
          </section>

          {/* ─── ขวา: คิวพิมพ์ + ตัวอย่าง + ปุ่มพิมพ์ (การ์ดเดียว) ──────────────────────── */}
          {/* จอเตี้ย: การ์ดไม่ยาวเกินจอ — รายการคิวหดก่อน (ตัวอย่างดวงและปุ่มพิมพ์อยู่ครบเสมอ) */}
          <aside
            aria-label="คิวพิมพ์และตัวอย่าง"
            className="flex flex-col overflow-hidden rounded-xl border border-border bg-card lg:sticky lg:top-4 lg:max-h-[calc(100dvh-12.75rem)]"
          >
            <div className="flex shrink-0 items-center justify-between gap-2 px-4 pb-2 pt-3">
              <h2 className="text-[15px] font-semibold leading-snug">
                คิวพิมพ์
                {items.length > 0 && (
                  <span className="ml-1.5 text-xs font-normal tabular-nums text-muted-foreground">
                    {items.length} เครื่อง
                  </span>
                )}
              </h2>
              {items.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setItems([])}>
                  <Trash2 aria-hidden="true" className="size-3" />
                  ล้าง
                </Button>
              )}
            </div>

            {items.length === 0 ? (
              <p className="mx-4 mb-4 shrink-0 rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs leading-snug text-muted-foreground">
                กด <b className="font-semibold text-foreground">เพิ่ม</b> ที่เครื่องในรายการ
                <br />
                หรือสแกน IMEI เพื่อเริ่มคิวพิมพ์
              </p>
            ) : (
              <ul aria-label="คิวพิมพ์" className="max-h-52 min-h-21 overflow-y-auto px-2 pb-2">
                {queue.map(({ item, product, view, state }) => {
                  const Icon = QUEUE_ICON[state];
                  const selected = preview?.item.key === item.key;
                  const title = product ? product.model || product.name : state === 'loading' ? 'กำลังโหลด…' : item.key;
                  const sub =
                    state === 'ready' && view
                      ? `฿${view.cash}`
                      : state === 'noPrice'
                        ? 'ยังไม่ตั้งราคา — ไม่พิมพ์'
                        : state === 'loading'
                          ? 'กำลังโหลด…'
                          : 'ไม่พบเครื่องนี้ในสต็อก';
                  return (
                    <li
                      key={item.key}
                      className={cn('flex items-center gap-1 rounded-lg px-2 py-0.5', selected && 'bg-accent')}
                    >
                      <button
                        type="button"
                        onClick={() => setPreviewKey(item.key)}
                        disabled={!view}
                        aria-pressed={view ? selected : undefined}
                        title={view ? 'ดูตัวอย่างดวงนี้' : undefined}
                        className="flex min-h-11 min-w-0 flex-1 items-center justify-start gap-2 text-left disabled:cursor-default"
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
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-medium leading-snug">{title}</span>
                          <span
                            className={cn(
                              'block truncate text-[11px] leading-snug',
                              state === 'noPrice'
                                ? 'text-warning-strong'
                                : state === 'missing'
                                  ? 'text-destructive'
                                  : 'text-muted-foreground tabular-nums',
                            )}
                          >
                            {sub}
                          </span>
                        </span>
                      </button>
                      {state === 'ready' && (
                        <div className="inline-flex shrink-0 items-center rounded-md border border-border bg-background">
                          <button
                            data-ui-control="button"
                            data-ui-icon="true"
                            type="button"
                            onClick={() => changeQty(item.key, -1)}
                            disabled={item.qty <= 1}
                            aria-label="ลดจำนวนดวง"
                            className="grid size-7 place-items-center text-muted-foreground hover:text-foreground disabled:opacity-35"
                          >
                            <Minus aria-hidden="true" className="size-3" />
                          </button>
                          <span
                            aria-label={`${item.qty} ดวง`}
                            className="min-w-5 text-center font-mono text-xs font-semibold tabular-nums"
                          >
                            {item.qty}
                          </span>
                          <button
                            data-ui-control="button"
                            data-ui-icon="true"
                            type="button"
                            onClick={() => changeQty(item.key, 1)}
                            aria-label="เพิ่มจำนวนดวง"
                            className="grid size-7 place-items-center text-muted-foreground hover:text-foreground"
                          >
                            <Plus aria-hidden="true" className="size-3" />
                          </button>
                        </div>
                      )}
                      <button
                        data-ui-control="button"
                        data-ui-icon="true"
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

            {preview?.view && (
              <div className="shrink-0 border-t border-border px-4 pb-2.5 pt-2">
                <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[11px] leading-snug text-muted-foreground">
                  <span className="truncate">
                    ตัวอย่าง · <span className="text-foreground">{preview.view.model}</span>
                  </span>
                  {readyCount > 1 && <span className="shrink-0">กดในคิวเพื่อดูดวงอื่น</span>}
                </div>
                <div data-testid="sticker-preview" className="grid place-items-center rounded-lg bg-muted/60 p-2">
                  <div className="bg-white p-1.5 shadow-md">
                    <StickerCard view={preview.view} size={size} showQr={showQr} />
                  </div>
                </div>
              </div>
            )}

            <div className="shrink-0 border-t border-border p-2.5">
              <Button
                type="button"
                size="lg"
                onClick={() => window.print()}
                disabled={printable.length === 0 || quotesLoading}
                className="h-auto w-full items-center justify-start gap-3 px-4 py-3 text-left"
              >
                <Printer aria-hidden="true" className="size-5" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold leading-snug">พิมพ์สติกเกอร์</span>
                  <span className="block text-[11px] font-normal leading-snug opacity-85">{printLabel}</span>
                </span>
              </Button>
            </div>
          </aside>
        </div>
      </div>

      {/* ─── ชุดพิมพ์จริง (แสดงเฉพาะตอนพิมพ์) ─────────────────────────────────── */}
      <div data-testid="print-set" className="print-stickers hidden print:block">
        {printable.map((view, index) => (
          <StickerCard key={`print-${view.productId}-${index}`} view={view} size={size} showQr={showQr} />
        ))}
      </div>
    </div>
  );
}
