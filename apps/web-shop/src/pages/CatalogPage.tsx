import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Search, SlidersHorizontal, ChevronRight, ChevronDown } from 'lucide-react';
import ShopLayout from '@/components/layout/ShopLayout';
import { FilterSidebar, type CatalogFilters } from '@/components/catalog/FilterSidebar';
import {
  Container,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  StatefulList,
  ProductCard,
  type ProductGroup,
} from '@/components';
import { api } from '@/lib/api';
import { copy } from '@/lib/copy';
import { useTrackEvent } from '@/hooks/useTrackEvent';
import { cn } from '@/lib/utils';

interface CatalogResponse {
  data: ProductGroup[];
  total: number;
  page: number;
  limit: number;
}

const BRANDS = ['ทั้งหมด', 'Apple', 'Samsung', 'OPPO', 'Xiaomi'] as const;

const GRADES: Array<{ v: string; label: string }> = [
  { v: '', label: 'ทุกเกรด' },
  { v: 'A', label: 'A' },
  { v: 'B', label: 'B' },
  { v: 'C', label: 'C' },
];

const SORTS: Array<{ v: string; label: string }> = [
  { v: 'popular', label: 'ยอดนิยม' },
  { v: 'newest', label: 'ใหม่ล่าสุด' },
  { v: 'price_asc', label: 'ราคา ต่ำ → สูง' },
  { v: 'price_desc', label: 'ราคา สูง → ต่ำ' },
];

interface PillProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function Pill({ active, onClick, children }: PillProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'px-4 py-1.5 text-[13px] rounded-full border transition-colors leading-snug whitespace-nowrap',
        active
          ? 'bg-foreground text-background border-foreground'
          : 'bg-background text-foreground border-border hover:border-foreground/60',
      )}
    >
      {children}
    </button>
  );
}

export default function CatalogPage() {
  const [filters, setFilters] = useState<CatalogFilters>({});
  const [sort, setSort] = useState<string>('popular');
  const [sortOpen, setSortOpen] = useState(false);
  const sortBtnRef = useRef<HTMLButtonElement>(null);
  const track = useTrackEvent();

  useEffect(() => {
    track('ViewContent', { content_type: 'catalog' });
  }, [track]);

  // Close sort menu on Escape; return focus to the trigger.
  useEffect(() => {
    if (!sortOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setSortOpen(false);
        sortBtnRef.current?.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sortOpen]);

  const { data, isLoading, isError, refetch } = useQuery<CatalogResponse>({
    queryKey: ['shop', 'catalog', filters, sort],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters.brand) params.set('brand', filters.brand);
      if (filters.conditionGrade) params.set('conditionGrade', filters.conditionGrade);
      if (filters.minPrice !== undefined) params.set('minPrice', String(filters.minPrice));
      if (filters.maxPrice !== undefined) params.set('maxPrice', String(filters.maxPrice));
      params.set('sort', sort);
      return api.get(`/api/shop/products?${params}`).then((r) => r.data);
    },
  });

  const total = data?.total ?? 0;
  const activeBrand = filters.brand ?? 'ทั้งหมด';
  const activeGrade = filters.conditionGrade ?? '';
  const activeSortLabel = SORTS.find((s) => s.v === sort)?.label ?? '';

  // Hero headline noun follows the brand filter — Apple-style single-noun
  // headline must reflect what's actually being shown.
  const heroNoun =
    activeBrand === 'Samsung' ? 'Galaxy'
    : activeBrand === 'OPPO' ? 'OPPO'
    : activeBrand === 'Xiaomi' ? 'Xiaomi'
    : 'iPhone';

  return (
    <ShopLayout>
      {/* Apple-minimal hero — center-aligned, generous breathing room */}
      <section className="pt-16 md:pt-24 pb-12 md:pb-16 text-center">
        <Container>
          <p className="text-sm text-muted-foreground tracking-wide mb-3">
            สินค้าทั้งหมด · พร้อมจัด {total > 0 && `${total} รุ่น`}
          </p>
          {/* Two spans so each language gets safe leading: tight (~0.92) for
             the English noun + period, snug for Thai so สระบน/ไม้เอก are not
             clipped. */}
          <h1 className="font-display text-5xl sm:text-6xl md:text-7xl font-semibold tracking-tight text-foreground">
            <span className="block leading-[0.92]">{heroNoun}.</span>
            <span className="block text-primary leading-tight pt-1 md:pt-1.5">
              ผ่อนได้บัตรเดียว.
            </span>
          </h1>
          <p className="font-display text-xl md:text-2xl font-medium text-muted-foreground mt-5 md:mt-6 max-w-2xl mx-auto leading-tight">
            เครื่องผ่านตรวจ 30 จุด รับประกันร้าน 30 วัน
          </p>
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-3 mt-8 text-[15px]">
            <a
              href="#catalog"
              className="text-primary hover:underline underline-offset-4 inline-flex items-center gap-1.5"
            >
              เริ่มเลือกเครื่อง
              <ChevronRight className="size-4" aria-hidden />
            </a>
            <Link
              to="/how-it-works"
              className="text-foreground hover:underline underline-offset-4 inline-flex items-center gap-1.5"
            >
              ดูวิธีผ่อน
              <ChevronRight className="size-4" aria-hidden />
            </Link>
          </div>
        </Container>
      </section>

      {/* Sticky filter toolbar — Apple subtle bar */}
      <div
        id="catalog"
        className="sticky top-[57px] z-20 bg-muted/70 backdrop-blur-md border-y border-border"
      >
        <Container>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
            <div className="flex flex-wrap gap-2">
              {BRANDS.map((b) => (
                <Pill
                  key={b}
                  active={activeBrand === b}
                  onClick={() =>
                    setFilters({
                      ...filters,
                      brand: b === 'ทั้งหมด' ? undefined : b,
                    })
                  }
                >
                  {b}
                </Pill>
              ))}
            </div>

            <span className="hidden md:inline-block w-px h-5 bg-border mx-1" />

            <div className="flex flex-wrap gap-2">
              {GRADES.map((g) => (
                <Pill
                  key={g.v || 'all'}
                  active={activeGrade === g.v}
                  onClick={() =>
                    setFilters({ ...filters, conditionGrade: g.v || undefined })
                  }
                >
                  {g.label}
                </Pill>
              ))}
            </div>

            <div className="flex-1" />

            {/* More filters */}
            <Dialog>
              <DialogTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] border border-border rounded-full hover:border-foreground/60 transition-colors text-foreground bg-background leading-snug"
                >
                  <SlidersHorizontal className="size-3.5" />
                  ตัวกรอง
                </button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>ตัวกรองเพิ่มเติม</DialogTitle>
                </DialogHeader>
                <FilterSidebar filters={filters} onChange={setFilters} />
              </DialogContent>
            </Dialog>

            {/* Sort dropdown — listbox semantics for screen readers + ESC to
               close (handled by effect). Outside-click closes via overlay. */}
            <div className="relative">
              <button
                ref={sortBtnRef}
                type="button"
                aria-haspopup="listbox"
                aria-expanded={sortOpen}
                onClick={() => setSortOpen((o) => !o)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] border border-border rounded-full hover:border-foreground/60 transition-colors text-foreground bg-background leading-snug"
              >
                <span className="text-muted-foreground">เรียง:</span>
                <span>{activeSortLabel}</span>
                <ChevronDown className="size-3.5 text-muted-foreground" />
              </button>
              {sortOpen && (
                <>
                  <button
                    type="button"
                    aria-label="ปิดเมนูเรียง"
                    tabIndex={-1}
                    className="fixed inset-0 z-10"
                    onClick={() => setSortOpen(false)}
                  />
                  <ul
                    role="listbox"
                    aria-label="เรียงโดย"
                    className="absolute right-0 mt-2 w-52 bg-background border border-border rounded-xl shadow-lg z-20 py-1.5 overflow-hidden"
                  >
                    {SORTS.map((s) => {
                      const selected = sort === s.v;
                      return (
                        <li key={s.v}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={selected}
                            onClick={() => {
                              setSort(s.v);
                              setSortOpen(false);
                              sortBtnRef.current?.focus();
                            }}
                            className={cn(
                              'block w-full text-left px-3.5 py-2 text-[13px] leading-snug',
                              selected
                                ? 'text-primary font-medium bg-primary/5'
                                : 'text-foreground hover:bg-muted',
                            )}
                          >
                            {s.label}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
          </div>
        </Container>
      </div>

      {/* Product grid — Apple-style 3-col / mobile 2-col.
         No <main> wrapper here: ShopLayout already provides one. */}
      <Container>
        <div className="py-12 md:py-16">
          <StatefulList<ProductGroup>
            isLoading={isLoading}
            isError={isError}
            data={data?.data}
            loadingVariant="card-grid"
            onRetry={() => refetch()}
            emptyState={{
              icon: <Search className="size-12" />,
              title: copy.catalog.emptyTitle,
              description: copy.catalog.emptyDescription,
            }}
            wrapperClassName="grid grid-cols-2 lg:grid-cols-3 gap-x-3 gap-y-6 md:gap-x-6 md:gap-y-10 lg:gap-x-8 lg:gap-y-12"
            renderItem={(p) => (
              <ProductCard key={`${p.brand}-${p.model}`} product={p} />
            )}
          />
        </div>
      </Container>
    </ShopLayout>
  );
}
