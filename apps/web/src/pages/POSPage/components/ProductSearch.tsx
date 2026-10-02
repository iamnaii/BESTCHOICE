import { DeviceDisclosureSummary } from '@/components/product/DeviceDisclosureSummary';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { DeviceOriginFilter } from '@/components/product/DeviceOriginFilter';
import { useDebounce } from '@/hooks/useDebounce';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import api from '@/lib/api';
import type { Product } from '../types';

const inputClass =
  'w-full min-h-11 bg-background px-3 py-2 border border-input rounded-lg text-sm outline-hidden focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background';

interface ProductSearchProps {
  productSearch: string;
  setProductSearch: (v: string) => void;
  selectedProduct: Product | null;
  onSelectProduct: (product: Product) => void;
  onClearProduct: () => void;
  // Bundle exclusion
  bundleProductIds: string[];
}

export default function ProductSearch({
  productSearch,
  setProductSearch,
  selectedProduct,
  onSelectProduct,
  onClearProduct,
  bundleProductIds,
}: ProductSearchProps) {
  const debouncedProductSearch = useDebounce(productSearch);
  const [deviceOrigin, setDeviceOrigin] = useState('');

  const {
    data: products,
    isFetching: productsFetching,
    isError: productsError,
  } = useQuery<Product[]>({
    queryKey: ['pos-products', debouncedProductSearch, deviceOrigin],
    queryFn: async () => {
      const { data } = await api.get('/products', {
        params: {
          search: debouncedProductSearch || undefined,
          status: 'IN_STOCK',
          limit: debouncedProductSearch ? '10' : '4',
          deviceOrigin: deviceOrigin || undefined,
        },
      });
      return data.data ?? [];
    },
    enabled:
      !selectedProduct &&
      (debouncedProductSearch.length === 0 || debouncedProductSearch.length >= 2),
  });

  const filteredProducts = useMemo(
    () => products?.filter((p) => !bundleProductIds.includes(p.id)) ?? [],
    [products, bundleProductIds],
  );

  return (
    <>
      {/* Product Selection */}
      <Card className="border-border/60 shadow-sm">
        <CardHeader>
          <div className="text-sm font-semibold text-foreground">1. เลือกสินค้า</div>
        </CardHeader>
        <CardContent>
          {selectedProduct ? (
            <div className="flex items-start justify-between gap-2 bg-muted rounded-lg p-3">
              <div className="min-w-0 break-words">
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
                <DeviceDisclosureSummary product={selectedProduct} />
                {selectedProduct.prices.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-1">
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
              <button
                onClick={onClearProduct}
                className="min-h-11 shrink-0 px-2 text-sm text-destructive hover:underline"
              >
                เปลี่ยน
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="relative">
                <Search
                  aria-hidden
                  className="absolute left-3 top-3 size-5 text-muted-foreground"
                />
                <input
                  id="pos-product-search"
                  aria-label="ค้นหาสินค้า รุ่น หรือ IMEI"
                  type="text"
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  placeholder="ค้นหารุ่น / IMEI / รหัสสินค้า"
                  className={`${inputClass} pl-10`}
                />
              </div>
              <DeviceOriginFilter
                value={deviceOrigin}
                onChange={setDeviceOrigin}
                className="min-h-11 mb-0 w-full sm:w-auto"
              />
              {(productSearch.length === 0 || productSearch.length >= 2) && (
                <div className="rounded-lg border border-border divide-y divide-border max-h-64 overflow-y-auto">
                  {productsError ? (
                    <div className="px-3 py-4 text-center text-sm text-destructive">
                      ค้นหาสินค้าไม่สำเร็จ กรุณาลองใหม่
                    </div>
                  ) : productsFetching || productSearch !== debouncedProductSearch ? (
                    <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary mx-auto mb-2" />
                      กำลังค้นหา...
                    </div>
                  ) : filteredProducts.length > 0 ? (
                    filteredProducts.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => onSelectProduct(p)}
                        className="w-full min-h-11 text-left px-3 py-3 hover:bg-muted/50 leading-snug break-words"
                      >
                        <div className="text-sm font-medium">
                          {p.brand} {p.model}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          <DeviceDisclosureSummary product={p} />
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
                      {productSearch
                        ? `ไม่พบสินค้าที่ตรงกับ “${productSearch}”`
                        : 'ยังไม่มีสินค้าพร้อมขายในตัวกรองนี้'}
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
