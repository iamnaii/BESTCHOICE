import { DeviceDisclosureSummary } from '@/components/product/DeviceDisclosureSummary';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import { AlertCircle, CheckCircle2, ScanLine } from 'lucide-react';
import { DeviceOriginFilter } from '@/components/product/DeviceOriginFilter';
import { useDebounce } from '@/hooks/useDebounce';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Alert, AlertContent, AlertDescription, AlertIcon, AlertTitle } from '@/components/ui/alert';
import api, { getErrorMessage } from '@/lib/api';
import type { Product } from '../types';
import { describeScanBlock, isScanCandidate, scanIdLabel, type ScanBlockMessage, type ScanOutcome } from '../scanOutcome';

const inputClass =
  'w-full min-h-11 bg-background px-3 py-2 border border-input rounded-lg text-sm outline-hidden focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background';

const alertButtonClass =
  'inline-flex min-h-10 items-center rounded-lg border border-destructive-foreground/40 bg-destructive-foreground/15 px-3 text-sm font-semibold text-destructive-foreground hover:bg-destructive-foreground/25';

interface ProductSearchProps {
  productSearch: string;
  setProductSearch: (v: string) => void;
  selectedProduct: Product | null;
  onSelectProduct: (product: Product) => void;
  onClearProduct: () => void;
  // Bundle exclusion
  bundleProductIds: string[];
}

/**
 * ผลการยิงครั้งล่าสุด — แถบเขียวผูกกับ `product.id` ที่ยิง (หายเมื่อเครื่องที่เลือกไม่ใช่ตัวนั้น)
 * แถบแดง = ยิงแล้วขายไม่ได้ หรือเรียกไม่สำเร็จ (ข้อความอยู่ตรงช่องค้นหา ไม่ใช้ toast)
 */
type ScanState =
  | { kind: 'selected'; productId: string; label: string; text: string }
  | { kind: 'blocked'; message: ScanBlockMessage };

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
  const [scanState, setScanState] = useState<ScanState | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  // ยิง QR / IMEI (A4): Enter = ค้นค่าเท่ากันผ่าน GET /products/scan แล้วเลือกให้ หรือบอกเหตุผลที่ขายไม่ได้
  const scan = useMutation({
    mutationFn: async (code: string) => {
      const { data } = await api.get<ScanOutcome>('/products/scan', { params: { code } });
      return data;
    },
    onSuccess: (outcome) => {
      if (outcome.sellable && outcome.product) {
        const id = scanIdLabel(outcome.product);
        setScanState({ kind: 'selected', productId: outcome.product.id, ...id });
        onSelectProduct(outcome.product);
        return;
      }
      setScanState({ kind: 'blocked', message: describeScanBlock(outcome) });
    },
    onError: (error) => {
      setScanState({
        kind: 'blocked',
        message: { title: 'ตรวจรหัสไม่สำเร็จ', detail: getErrorMessage(error), link: null },
      });
    },
  });

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    const code = productSearch.trim();
    if (!isScanCandidate(code) || scan.isPending) return;
    event.preventDefault();
    scan.mutate(code);
  };

  const handlePickFromList = (product: Product) => {
    setScanState(null);
    onSelectProduct(product);
  };

  const handleScanAnother = () => {
    setScanState(null);
    setProductSearch('');
    inputRef.current?.focus();
  };

  const filteredProducts = useMemo(
    () => products?.filter((p) => !bundleProductIds.includes(p.id)) ?? [],
    [products, bundleProductIds],
  );

  const scannedBanner =
    selectedProduct && scanState?.kind === 'selected' && scanState.productId === selectedProduct.id
      ? scanState
      : null;
  const blocked = !selectedProduct && scanState?.kind === 'blocked' ? scanState.message : null;

  return (
    <>
      {/* Product Selection */}
      <Card className="border-border/60 shadow-sm">
        <CardHeader>
          <div className="text-sm font-semibold text-foreground">1. เลือกสินค้า</div>
        </CardHeader>
        <CardContent>
          {selectedProduct ? (
            <div className="flex flex-col gap-3">
              {scannedBanner && (
                <Alert variant="success" appearance="solid" role="status">
                  <AlertIcon>
                    <CheckCircle2 aria-hidden className="size-5" />
                  </AlertIcon>
                  <AlertContent>
                    <AlertTitle>ยิงแล้ว · เลือกเครื่องให้แล้ว</AlertTitle>
                    <AlertDescription className="font-mono text-xs opacity-90">
                      {scannedBanner.label} {scannedBanner.text}
                    </AlertDescription>
                  </AlertContent>
                </Alert>
              )}
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
                  onClick={() => {
                    setScanState(null);
                    onClearProduct();
                  }}
                  className="min-h-11 shrink-0 px-2 text-sm text-destructive hover:underline"
                >
                  เปลี่ยน
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {blocked && (
                <Alert variant="destructive" appearance="solid" role="alert">
                  <AlertIcon>
                    <AlertCircle aria-hidden className="size-5" />
                  </AlertIcon>
                  <AlertContent>
                    <AlertTitle>{blocked.title}</AlertTitle>
                    {blocked.detail && <AlertDescription>{blocked.detail}</AlertDescription>}
                    <div className="flex flex-wrap gap-2 pt-1">
                      {blocked.link && (
                        <Link to={blocked.link.to} className={alertButtonClass}>
                          {blocked.link.label}
                        </Link>
                      )}
                      <button type="button" onClick={handleScanAnother} className={alertButtonClass}>
                        ยิงเครื่องอื่น
                      </button>
                    </div>
                  </AlertContent>
                </Alert>
              )}
              <div className="relative">
                <ScanLine
                  aria-hidden
                  className="absolute left-3 top-3 size-5 text-muted-foreground"
                />
                <input
                  ref={inputRef}
                  id="pos-product-search"
                  aria-label="ค้นหาสินค้า รุ่น หรือ IMEI"
                  type="text"
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="ค้นหารุ่น / IMEI / รหัสสินค้า — ยิง QR ได้เลย"
                  className={`${inputClass} pl-10`}
                />
              </div>
              {scan.isPending && (
                <div className="text-xs text-muted-foreground" aria-live="polite">
                  กำลังตรวจรหัส…
                </div>
              )}
              <DeviceOriginFilter
                value={deviceOrigin}
                onChange={setDeviceOrigin}
                wrapperClassName="mb-0 w-full sm:w-auto sm:self-start"
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
                        onClick={() => handlePickFromList(p)}
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
