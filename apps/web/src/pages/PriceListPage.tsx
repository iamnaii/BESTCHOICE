import { useState } from 'react';
import { Search, SearchX } from 'lucide-react';
import type { GfinDeviceOrigin } from '@installment/shared';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import { formControlClass } from '@/components/ui/form-styles';
import { useDebounce } from '@/hooks/useDebounce';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useIsMobile } from '@/hooks/useIsMobile';
import { cn } from '@/lib/utils';
import PriceQuoteCards from './price-list/PriceQuoteCards';
import PriceQuoteTable from './price-list/PriceQuoteTable';
import SegmentedToggle, { type SegmentOption } from './price-list/SegmentedToggle';
import { emptyListMessage, formatUpdatedAt, notFoundMessage } from './price-list/format';
import type { PriceListCategory } from './price-list/types';
import { usePriceQuotes } from './price-list/usePriceQuotes';

const PRICE_LIST_TITLE = 'ราคาและเรทผ่อน';

const CATEGORY_OPTIONS: SegmentOption<PriceListCategory>[] = [
  { value: 'PHONE_NEW', label: 'มือ 1' },
  { value: 'PHONE_USED', label: 'มือ 2' },
];

const ORIGIN_OPTIONS: SegmentOption<GfinDeviceOrigin>[] = [
  { value: 'THAI', label: 'เครื่องไทย' },
  { value: 'IMPORTED', label: 'เครื่องนอก' },
];

/**
 * หน้า "ราคาและเรทผ่อน" (`/prices`) — สเปค 2026-11-19 ข้อ 6 · แทนหน้าพนักงานของชีต MASTER
 * ทุกตำแหน่งที่ทำงานหน้าร้านเปิดได้ (รวมพนักงานขาย) · อ่าน `GET /pricing-templates/quotes` อย่างเดียว —
 * API คิดด้วยตัวคำนวณกลางตัวเดียวกับบอทขาย และไม่ส่งทุน กำไร หรือราคาส่ง GFIN มาเลย
 * เครื่องไทย / เครื่องนอก มีผลกับเรท 2 เท่านั้น (สเปคข้อ 3.4 — เครื่องนอกได้ OVER ครึ่งเดียว)
 */
export default function PriceListPage() {
  useDocumentTitle(PRICE_LIST_TITLE);
  const isMobile = useIsMobile();
  const [category, setCategory] = useState<PriceListCategory>('PHONE_NEW');
  const [origin, setOrigin] = useState<GfinDeviceOrigin>('THAI');
  const [search, setSearch] = useState('');
  const q = useDebounce(search.trim(), 300);

  const quotes = usePriceQuotes({ category, origin, q });
  const rows = quotes.data?.rows ?? [];
  const updatedText = quotes.data?.updatedAt ? formatUpdatedAt(quotes.data.updatedAt) : null;
  const stale = quotes.isPlaceholderData;

  return (
    <div>
      <PageHeader
        title={PRICE_LIST_TITLE}
        subtitle="ราคาเงินสดและเรทผ่อนของแต่ละรุ่น สำหรับตอบลูกค้า"
        action={
          updatedText ? (
            <p className="text-xs leading-snug text-muted-foreground">ราคาอัปเดตล่าสุด {updatedText}</p>
          ) : undefined
        }
      />

      <div className="mb-2 flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 basis-full sm:min-w-64 sm:flex-1 sm:basis-auto">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            aria-label="ค้นหารุ่น"
            placeholder="ค้นหารุ่น เช่น iPhone 15"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={cn(formControlClass, 'pl-9')}
          />
        </div>
        <SegmentedToggle label="มือ 1 หรือ มือ 2" options={CATEGORY_OPTIONS} value={category} onChange={setCategory} />
        <SegmentedToggle label="เครื่องไทย หรือ เครื่องนอก" options={ORIGIN_OPTIONS} value={origin} onChange={setOrigin} />
      </div>
      <p className="mb-4 text-xs leading-snug text-muted-foreground">
        เครื่องไทย / เครื่องนอก มีผลกับเรท 2 (GFIN) เท่านั้น · ค่างวดปัดขึ้นเป็นบาทเต็ม
      </p>

      <QueryBoundary
        isLoading={quotes.isLoading || (stale && rows.length === 0)}
        isError={quotes.isError}
        error={quotes.error}
        onRetry={() => void quotes.refetch()}
        errorTitle="โหลดราคาไม่สำเร็จ"
      >
        <div aria-busy={stale} className={cn('transition-opacity', stale && 'opacity-60')}>
          {rows.length === 0 ? (
            <div role="status" className="flex flex-col items-center gap-3 py-12 text-center">
              <SearchX className="size-12 text-muted-foreground" aria-hidden="true" />
              <p className="max-w-md text-sm leading-snug text-muted-foreground">
                {q ? notFoundMessage(q, category) : emptyListMessage(category)}
              </p>
            </div>
          ) : isMobile ? (
            <PriceQuoteCards rows={rows} />
          ) : (
            <PriceQuoteTable rows={rows} />
          )}
        </div>
      </QueryBoundary>
    </div>
  );
}
