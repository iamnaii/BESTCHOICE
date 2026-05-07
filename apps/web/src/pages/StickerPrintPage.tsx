import { useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Printer, Plus, X } from 'lucide-react';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Button } from '@/components/ui/button';

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

interface PrintItem {
  productId: string;
  qty: number;
}

function formatThaiDate(isoDate: string): string {
  // YYYY-MM-DD → DD/MM/YYYY (ค.ศ.)
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

function formatBaht(n: number): string {
  return n.toLocaleString('th-TH');
}

function StickerCard({ data }: { data: StickerData }) {
  const specParts = [data.color, data.storage, data.batteryHealth !== null ? `แบต ${data.batteryHealth}%` : null].filter(Boolean);
  const warrantyText = data.warrantyExpireDate ? `ประกันศูนย์ ${formatThaiDate(data.warrantyExpireDate)}` : null;

  return (
    <div className="sticker bg-white text-black relative overflow-hidden border border-dashed border-border print:border-0">
      <div className="flex justify-between items-start gap-1">
        <div className="font-bold text-[8pt] leading-tight truncate">
          {data.brand} {data.model}
        </div>
        {data.cashPrice !== null && (
          <div className="font-bold text-[9pt] leading-tight whitespace-nowrap">
            ฿ {formatBaht(data.cashPrice)}
          </div>
        )}
      </div>

      <div className="flex justify-between items-start gap-1 text-[6.5pt] leading-tight mt-[0.5mm]">
        <div className="truncate">{specParts.join(' · ') || ' '}</div>
        {warrantyText && <div className="whitespace-nowrap">{warrantyText}</div>}
      </div>

      <hr className="my-[0.8mm] border-t border-black/40" />

      {data.rate1 && (
        <div className="text-[6.5pt] leading-tight tabular-nums">
          เรทที่ 1  ดาวน์ {formatBaht(data.rate1.downPayment)}  {formatBaht(data.rate1.monthlyPrice)} × {data.rate1.termMonths} ด.
        </div>
      )}
      {data.rate2 && (
        <div className="text-[6.5pt] leading-tight tabular-nums">
          เรทที่ 2  ดาวน์ {formatBaht(data.rate2.downPayment)}  {formatBaht(data.rate2.monthlyPrice)} × {data.rate2.termMonths} ด.
        </div>
      )}

      <div className="absolute left-[1mm] right-[8mm] bottom-[0.5mm] text-[6pt] font-mono leading-none truncate">
        {data.imei ? `IMEI: ${data.imei}` : ' '}
      </div>

      {data.shopLogoUrl && (
        <img
          src={data.shopLogoUrl}
          alt=""
          className="absolute right-[1mm] bottom-[1mm] w-[7mm] h-[7mm] object-contain"
        />
      )}
    </div>
  );
}

export default function StickerPrintPage() {
  const [searchParams] = useSearchParams();
  const idsFromUrl = searchParams.get('productIds');

  const [items, setItems] = useState<PrintItem[]>([]);
  const [manualId, setManualId] = useState('');

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

  const productIdsKey = useMemo(() => items.map((i) => i.productId).sort().join(','), [items]);

  const {
    data: stickerData = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<StickerData[]>({
    queryKey: ['sticker-data', productIdsKey],
    queryFn: async () => {
      if (items.length === 0) return [];
      const ids = items.map((i) => i.productId).join(',');
      const res = await api.get(`/sticker-templates/products/data?ids=${encodeURIComponent(ids)}`);
      return Array.isArray(res.data) ? res.data : [];
    },
    enabled: items.length > 0,
  });

  // Build flat list expanded by qty, in user's input order
  const expandedStickers = useMemo(() => {
    const dataMap = new Map(stickerData.map((d) => [d.productId, d]));
    const out: StickerData[] = [];
    for (const item of items) {
      const data = dataMap.get(item.productId);
      if (!data) continue;
      for (let i = 0; i < item.qty; i++) out.push(data);
    }
    return out;
  }, [items, stickerData]);

  const addManual = () => {
    const id = manualId.trim();
    if (!id) return;
    if (items.some((i) => i.productId === id)) {
      setManualId('');
      return;
    }
    setItems([...items, { productId: id, qty: 1 }]);
    setManualId('');
  };

  const updateQty = (productId: string, qty: number) => {
    setItems(items.map((i) => (i.productId === productId ? { ...i, qty: Math.max(1, qty) } : i)));
  };

  const removeItem = (productId: string) => {
    setItems(items.filter((i) => i.productId !== productId));
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div>
      <div className="print:hidden">
        <PageHeader title="พิมพ์สติกเกอร์" subtitle="สติกเกอร์ติดเครื่อง 50×30mm สำหรับเครื่องพิมพ์ thermal" />

        <div className="bg-card rounded-xl border border-border/50 shadow-sm p-6 mb-6 space-y-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={manualId}
              onChange={(e) => setManualId(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addManual()}
              placeholder="วาง Product ID หรือ scan barcode แล้วกด Enter"
              className="flex-1 px-3 py-2 border border-input rounded-lg text-sm outline-hidden focus:ring-2 focus:ring-ring/30 focus:border-ring"
            />
            <Button onClick={addManual} disabled={!manualId.trim()} variant="outline">
              <Plus className="size-4 mr-1" /> เพิ่ม
            </Button>
            <Button onClick={handlePrint} disabled={expandedStickers.length === 0}>
              <Printer className="size-4 mr-1" /> พิมพ์ ({expandedStickers.length} ดวง)
            </Button>
          </div>

          {items.length > 0 && (
            <div className="space-y-1">
              {items.map((item) => {
                const data = stickerData.find((d) => d.productId === item.productId);
                return (
                  <div key={item.productId} className="flex items-center gap-2 text-sm py-1 border-b border-border/30 last:border-0">
                    <div className="flex-1 truncate">
                      {data ? `${data.brand} ${data.model}` : <span className="text-muted-foreground">{item.productId}</span>}
                    </div>
                    <input
                      type="number"
                      min={1}
                      value={item.qty}
                      onChange={(e) => updateQty(item.productId, parseInt(e.target.value) || 1)}
                      className="w-16 px-2 py-1 border border-input rounded text-sm text-center"
                    />
                    <span className="text-xs text-muted-foreground">ดวง</span>
                    <button
                      onClick={() => removeItem(item.productId)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="ลบ"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <QueryBoundary
          isLoading={isLoading}
          isError={isError}
          error={error}
          onRetry={refetch}
          errorTitle="โหลดข้อมูลสติกเกอร์ไม่สำเร็จ"
        >
          {expandedStickers.length === 0 && items.length > 0 && (
            <div className="text-center text-muted-foreground py-8">ไม่พบสินค้าตาม ID ที่ระบุ</div>
          )}
        </QueryBoundary>
      </div>

      {/* Preview / Print area */}
      <div className="print-stickers flex flex-wrap gap-2 print:gap-0 print:block justify-center">
        {expandedStickers.map((data, idx) => (
          <StickerCard key={`${data.productId}-${idx}`} data={data} />
        ))}
      </div>

      <style>{`
        .sticker {
          width: 50mm;
          height: 30mm;
          padding: 1mm 1.5mm;
          font-family: 'IBM Plex Sans Thai', system-ui, sans-serif;
          box-sizing: border-box;
        }
        @media print {
          @page { size: 50mm 30mm; margin: 0; }
          body { margin: 0; padding: 0; background: white; }
          .print\\:hidden { display: none !important; }
          .sticker {
            page-break-after: always;
            border: 0 !important;
            margin: 0;
          }
          .sticker:last-child { page-break-after: auto; }
        }
      `}</style>
    </div>
  );
}
