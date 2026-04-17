import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useDebounce } from '@/hooks/useDebounce';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import api from '@/lib/api';
import type { Product, TopProduct } from '../types';

const inputClass =
  'w-full px-3 py-2 border border-input rounded-lg text-sm outline-hidden focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background';

interface ProductSearchProps {
  productSearch: string;
  setProductSearch: (v: string) => void;
  selectedProduct: Product | null;
  onSelectProduct: (product: Product) => void;
  onClearProduct: () => void;
  topProducts: TopProduct[];
  // Bundle exclusion
  bundleProductIds: string[];
}

export default function ProductSearch({
  productSearch,
  setProductSearch,
  selectedProduct,
  onSelectProduct,
  onClearProduct,
  topProducts,
  bundleProductIds,
}: ProductSearchProps) {
  const debouncedProductSearch = useDebounce(productSearch);

  const {
    data: products,
    isFetching: productsFetching,
    isError: productsError,
  } = useQuery<Product[]>({
    queryKey: ['pos-products', debouncedProductSearch],
    queryFn: async () => {
      if (!debouncedProductSearch || debouncedProductSearch.length < 2) return [];
      const { data } = await api.get('/products', {
        params: { search: debouncedProductSearch, status: 'IN_STOCK', limit: '10' },
      });
      return data.data ?? [];
    },
    enabled: !!debouncedProductSearch && debouncedProductSearch.length >= 2,
  });

  const filteredProducts = useMemo(
    () => products?.filter((p) => !bundleProductIds.includes(p.id)) ?? [],
    [products, bundleProductIds],
  );

  return (
    <>
      {/* Quick Picks - Top Selling Products */}
      {!selectedProduct && topProducts.length > 0 && (
        <Card className="border-border/60 shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-2">
              <svg className="size-4 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
              <div className="text-sm font-semibold text-foreground">สินค้าขายดี</div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {topProducts.slice(0, 6).map((tp) => (
                <button
                  key={tp.id}
                  onClick={() => setProductSearch(tp.brand + ' ' + tp.model)}
                  className="p-3.5 rounded-xl border border-border/60 hover:border-primary/40 hover:bg-primary/5 hover:shadow-sm hover:-translate-y-0.5 text-left transition-all group"
                >
                  <div className="size-8 rounded-lg bg-muted mb-2 flex items-center justify-center text-muted-foreground text-xs font-bold group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                    {tp.brand.charAt(0)}
                  </div>
                  <div className="text-xs font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                    {tp.brand} {tp.model}
                  </div>
                  <div className="text-2xs text-muted-foreground mt-0.5">ขายแล้ว {tp.count} เครื่อง</div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Product Selection */}
      <Card className="border-border/60 shadow-sm">
        <CardHeader>
          <div className="text-sm font-semibold text-foreground">สินค้าหลัก</div>
        </CardHeader>
        <CardContent>
          {selectedProduct ? (
            <div className="flex items-center justify-between bg-muted rounded-lg p-3">
              <div>
                <div className="text-sm font-medium">
                  {selectedProduct.brand} {selectedProduct.model}
                </div>
                <div className="text-xs text-muted-foreground">
                  {selectedProduct.imeiSerial && (
                    <span className="font-mono">IMEI: {selectedProduct.imeiSerial}</span>
                  )}
                  {selectedProduct.branch && (
                    <span className="ml-2">| {selectedProduct.branch.name}</span>
                  )}
                </div>
                {selectedProduct.prices.length > 0 && (
                  <div className="flex gap-2 mt-1">
                    {selectedProduct.prices.map((p) => (
                      <span
                        key={p.id}
                        className={`text-xs px-2 py-0.5 rounded ${p.isDefault ? 'bg-primary/10 text-primary' : 'bg-secondary text-muted-foreground'}`}
                      >
                        {p.label}: {parseFloat(p.amount).toLocaleString()}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <button onClick={onClearProduct} className="text-xs text-red-500 hover:underline">
                เปลี่ยน
              </button>
            </div>
          ) : (
            <div className="relative">
              <input
                type="text"
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder="พิมพ์อย่างน้อย 2 ตัวอักษร เช่น IMEI, ชื่อ, รุ่น..."
                className={inputClass}
              />
              {productSearch.length >= 2 && (
                <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-xl shadow-xl max-h-60 overflow-y-auto">
                  {productsError ? (
                    <div className="px-3 py-4 text-center text-sm text-destructive">
                      ค้นหาสินค้าไม่สำเร็จ กรุณาลองใหม่
                    </div>
                  ) : productsFetching ? (
                    <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary mx-auto mb-2" />
                      กำลังค้นหา...
                    </div>
                  ) : filteredProducts.length > 0 ? (
                    filteredProducts.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => onSelectProduct(p)}
                        className="w-full text-left px-3 py-2 hover:bg-muted/50 border-b last:border-b-0"
                      >
                        <div className="text-sm font-medium">
                          {p.brand} {p.model}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {p.imeiSerial && <span className="font-mono">IMEI: {p.imeiSerial}</span>}
                          <span className="ml-2">{p.branch?.name}</span>
                          {(() => {
                            const defaultPrice = p.prices.find((pr) => pr.isDefault);
                            return defaultPrice ? (
                              <span className="ml-2 text-primary font-medium">
                                {parseFloat(defaultPrice.amount).toLocaleString()} ฿
                              </span>
                            ) : null;
                          })()}
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                      ไม่พบสินค้าที่ตรงกับ &quot;{productSearch}&quot;
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
