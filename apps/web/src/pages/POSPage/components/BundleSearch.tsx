import { useQuery } from '@tanstack/react-query';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import api from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import type { Product } from '../types';

const inputClass =
  'w-full px-3 py-2 border border-input rounded-lg text-sm outline-hidden focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background';

interface BundleSearchProps {
  bundleSearch: string;
  setBundleSearch: (v: string) => void;
  bundleProducts: Product[];
  excludeIds: string[];
  onAddBundle: (product: Product) => void;
  onRemoveBundle: (productId: string) => void;
}

export default function BundleSearch({
  bundleSearch,
  setBundleSearch,
  bundleProducts,
  excludeIds,
  onAddBundle,
  onRemoveBundle,
}: BundleSearchProps) {
  const debouncedBundleSearch = useDebounce(bundleSearch);

  const { data: bundleSearchResults, isFetching: bundleSearchFetching } = useQuery<Product[]>({
    queryKey: ['pos-bundle-products', debouncedBundleSearch, excludeIds],
    queryFn: async () => {
      if (!debouncedBundleSearch || debouncedBundleSearch.length < 2) return [];
      const { data } = await api.get('/products', {
        params: { search: debouncedBundleSearch, status: 'IN_STOCK', limit: '10' },
      });
      const all: Product[] = data.data ?? [];
      return all.filter((p) => !excludeIds.includes(p.id));
    },
    enabled: !!debouncedBundleSearch && debouncedBundleSearch.length >= 2,
  });

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader>
        <div className="flex items-center justify-between w-full">
          <div className="text-sm font-semibold text-foreground">ของแถม / อุปกรณ์เสริม</div>
          <span className="text-xs text-muted-foreground">ตัดสต๊อกให้ลูกค้า (ราคา 0 บาท)</span>
        </div>
      </CardHeader>
      <CardContent>
        {/* Selected bundle products */}
        {bundleProducts.length > 0 && (
          <div className="space-y-2 mb-3">
            {bundleProducts.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between bg-success/5 dark:bg-success/10 rounded-xl px-3 py-2.5 border border-success/20"
              >
                <div>
                  <div className="text-sm font-medium text-success">
                    {p.brand} {p.model}
                  </div>
                  <div className="text-xs text-success/70">
                    {p.imeiSerial && <span className="font-mono">IMEI: {p.imeiSerial}</span>}
                    {p.category === 'ACCESSORY' && <span className="ml-1">({p.name})</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-success font-medium">ของแถม</span>
                  <button
                    onClick={() => onRemoveBundle(p.id)}
                    className="text-xs text-destructive hover:underline"
                  >
                    ลบ
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Bundle search */}
        <div className="relative">
          <input
            type="text"
            value={bundleSearch}
            onChange={(e) => setBundleSearch(e.target.value)}
            placeholder="ค้นหาของแถม เช่น ฟิล์ม, เคส, ชุดชาร์จ..."
            className={inputClass}
          />
          {bundleSearch.length >= 2 && (
            <div className="absolute z-40 w-full mt-1 bg-popover border border-border rounded-xl shadow-xl max-h-48 overflow-y-auto">
              {bundleSearchFetching ? (
                <div className="px-3 py-3 text-center text-sm text-muted-foreground">
                  กำลังค้นหา...
                </div>
              ) : bundleSearchResults && bundleSearchResults.length > 0 ? (
                bundleSearchResults.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => onAddBundle(p)}
                    className="w-full text-left px-3 py-2 hover:bg-success/5 dark:hover:bg-success/10 border-b last:border-b-0"
                  >
                    <div className="text-sm font-medium">
                      {p.brand} {p.model}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {p.name}
                      {p.imeiSerial && (
                        <span className="ml-2 font-mono">IMEI: {p.imeiSerial}</span>
                      )}
                      <span className="ml-2">ทุน: {parseFloat(p.costPrice).toLocaleString()} ฿</span>
                    </div>
                  </button>
                ))
              ) : (
                <div className="px-3 py-3 text-center text-sm text-muted-foreground">
                  ไม่พบสินค้า &quot;{bundleSearch}&quot;
                </div>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
