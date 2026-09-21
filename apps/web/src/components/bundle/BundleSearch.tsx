import { useQuery } from '@tanstack/react-query';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import api from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';

/** ข้อมูลขั้นต่ำของของแถมหนึ่งชิ้น — หน้า POS / หน้าสัญญาใช้ชนิดสินค้าของตัวเองที่กว้างกว่านี้ได้ */
export interface BundleProduct {
  id: string;
  name: string;
  brand: string;
  model: string;
  imeiSerial?: string | null;
  category: string;
}

const inputClass =
  'w-full min-h-11 px-3 py-2 border border-input rounded-lg text-sm bg-background outline-hidden focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background';

interface BundleSearchProps<T extends BundleProduct> {
  bundleSearch: string;
  setBundleSearch: (v: string) => void;
  bundleProducts: T[];
  excludeIds: string[];
  onAddBundle: (product: T) => void;
  onRemoveBundle: (productId: string) => void;
  /** ข้อความมุมขวาของหัวการ์ด — แต่ละหน้าบอกจังหวะตัดสต๊อกของตัวเอง */
  hint?: string;
  /** กรองเฉพาะของสาขานี้ (หน้าสัญญา: ของแถมต้องอยู่สาขาเดียวกับสัญญา) */
  branchId?: string;
  /** ป้ายกำกับเหนือช่องค้นหา (ไม่ส่ง = ไม่แสดง) */
  searchLabel?: string;
  /** ห่อด้วยการ์ดของตัวเอง (ค่าเริ่มต้น) — false = ใช้ในกล่องโต้ตอบ */
  framed?: boolean;
  disabled?: boolean;
}

/**
 * ช่องเลือกของแถม — เลือกได้เฉพาะสินค้าหมวดอุปกรณ์เสริม (คำตัดสินเจ้าของ 2026-09-20).
 * เซิร์ฟเวอร์ปฏิเสธหมวดอื่นด้วย (`assertBundleIsAccessory`) ตัวกรองนี้กันพนักงานเลือกแล้วไปชน 400 ตอนบันทึก
 */
export default function BundleSearch<T extends BundleProduct>({
  bundleSearch,
  setBundleSearch,
  bundleProducts,
  excludeIds,
  onAddBundle,
  onRemoveBundle,
  hint = 'เลือกได้เฉพาะอุปกรณ์เสริม · ตัดสต๊อกให้ลูกค้า (ราคา 0 บาท)',
  branchId,
  searchLabel,
  framed = true,
  disabled = false,
}: BundleSearchProps<T>) {
  const debouncedBundleSearch = useDebounce(bundleSearch);

  const { data: bundleSearchResults, isFetching: bundleSearchFetching } = useQuery<T[]>({
    queryKey: ['bundle-products', debouncedBundleSearch, branchId ?? null, excludeIds],
    queryFn: async () => {
      if (!debouncedBundleSearch || debouncedBundleSearch.length < 2) return [];
      const { data } = await api.get('/products', {
        params: {
          search: debouncedBundleSearch, status: 'IN_STOCK', category: 'ACCESSORY', limit: '10',
          ...(branchId ? { branchId } : {}),
        },
      });
      const all: T[] = data.data ?? [];
      return all.filter((p) => !excludeIds.includes(p.id));
    },
    enabled: !!debouncedBundleSearch && debouncedBundleSearch.length >= 2,
  });

  const body = (
    <div className="flex flex-col gap-3">
      {bundleProducts.map((p) => (
        <div
          key={p.id}
          className="flex items-center justify-between gap-3 bg-success/5 dark:bg-success/10 rounded-xl px-3 py-2.5 border border-success/20"
        >
          <div className="min-w-0">
            <div className="text-sm font-medium text-success leading-snug">{p.name}</div>
            <div className="text-xs text-muted-foreground leading-snug">
              อุปกรณ์เสริม · {p.brand} {p.model}
              {p.imeiSerial && <span className="ml-1 font-mono">· {p.imeiSerial}</span>}
            </div>
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onRemoveBundle(p.id)}
            className="shrink-0 min-h-11 px-3 text-sm font-medium text-destructive hover:underline disabled:opacity-50"
          >
            นำออก
          </button>
        </div>
      ))}

      <div className="relative">
        {searchLabel && (
          <label htmlFor="bundle-search" className="block text-xs text-muted-foreground mb-1.5 leading-snug">
            {searchLabel}
          </label>
        )}
        <input
          id="bundle-search"
          type="text"
          value={bundleSearch}
          disabled={disabled}
          onChange={(e) => setBundleSearch(e.target.value)}
          placeholder="ค้นหาของแถม เช่น ฟิล์ม, เคส, ชุดชาร์จ..."
          className={inputClass}
        />
        {bundleSearch.length >= 2 && (
          <div className="absolute z-40 w-full mt-1 bg-popover border border-border rounded-xl shadow-xl max-h-56 overflow-y-auto">
            {bundleSearchFetching ? (
              <div className="px-3 py-3 text-center text-sm text-muted-foreground">กำลังค้นหา...</div>
            ) : bundleSearchResults && bundleSearchResults.length > 0 ? (
              bundleSearchResults.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => onAddBundle(p)}
                  className="w-full min-h-12 text-left px-3 py-2 hover:bg-success/5 dark:hover:bg-success/10 border-b border-border last:border-b-0 flex items-center justify-between gap-3"
                >
                  <span className="text-sm text-foreground leading-snug">{p.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground leading-snug">
                    {p.brand} {p.model} · พร้อมขาย
                  </span>
                </button>
              ))
            ) : (
              <div className="px-3 py-3 text-center text-sm text-muted-foreground">
                ไม่พบอุปกรณ์เสริม &quot;{bundleSearch}&quot;
              </div>
            )}
          </div>
        )}
      </div>
      <div className="text-xs text-muted-foreground leading-snug">มือถือและแท็บเล็ตจะไม่ขึ้นในช่องนี้</div>
    </div>
  );

  if (!framed) return body;

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 w-full">
          <div className="text-sm font-semibold text-foreground">ของแถม / อุปกรณ์เสริม</div>
          <span className="text-xs text-muted-foreground leading-snug">{hint}</span>
        </div>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
