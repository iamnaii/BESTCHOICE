import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import api from '@/lib/api';
import { afterSalesKeys, baht } from './after-sales';

export interface ReplacementProduct {
  id: string;
  brand: string;
  model: string;
  storage: string | null;
  color: string | null;
  imeiSerial: string | null;
  cashPrice: string | null;
  branchId: string;
}

interface ReplacementProductPickerProps {
  imei: string;
  sameModel: boolean;
  value: string | null;
  onChange: (id: string | null) => void;
  /** ให้หน้าแม่อ่านรายละเอียดเครื่องที่เลือก (สรุปก่อนบันทึก) โดยไม่ต้องรู้ query key/queryFn
   * ของตัวนี้ — คอมโพเนนต์ยังเป็นเจ้าของ query เดียวเหมือนเดิม แค่รายงานผลขึ้นไปเพิ่ม */
  onProductsChange?: (products: ReplacementProduct[]) => void;
}

/** ทางเลือกเครื่องทดแทนตอนแจ้งปัญหาเครื่อง — sameModel=true กรองยี่ห้อ/รุ่น/ความจุเดิม (เปลี่ยนรุ่นเดิม),
 * sameModel=false คือทุกรุ่นพร้อมขาย (เปลี่ยนแบบมีราคา) การกรองตามสาขาเป็นหน้าที่ API แล้ว
 * (ดู after-sales-exchange.service.ts replacementProducts — ส่งแค่ imei/sameModel พอ) */
export default function ReplacementProductPicker({
  imei,
  sameModel,
  value,
  onChange,
  onProductsChange,
}: ReplacementProductPickerProps) {
  const query = useQuery<ReplacementProduct[]>({
    queryKey: afterSalesKeys.replacementProducts({ imei, sameModel }),
    queryFn: async () =>
      (
        await api.get('/after-sales/replacement-products', {
          params: { imei, sameModel: sameModel ? '1' : '0' },
        })
      ).data,
    enabled: !!imei,
  });

  useEffect(() => {
    if (query.data) onProductsChange?.(query.data);
  }, [query.data, onProductsChange]);

  if (query.isLoading) {
    return (
      <p className="text-sm leading-snug text-muted-foreground">กำลังโหลดรายการเครื่องทดแทน…</p>
    );
  }

  if (query.isError) {
    return (
      <p className="flex items-center gap-2 text-sm leading-snug text-destructive">
        <AlertTriangle aria-hidden className="h-4 w-4 shrink-0" />
        โหลดรายการเครื่องทดแทนไม่สำเร็จ
      </p>
    );
  }

  const products = query.data ?? [];

  if (products.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-border bg-muted p-3 text-sm leading-snug text-muted-foreground">
        <AlertTriangle aria-hidden className="h-4 w-4 shrink-0" />
        ไม่มีเครื่องรุ่น/ความจุเดิมพร้อมขายในสาขานี้
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
      {products.map((p) => {
        const selected = value === p.id;
        return (
          <button
            key={p.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(p.id)}
            className={`rounded-lg border p-3 text-left leading-snug ${
              selected
                ? 'border-2 border-primary bg-primary/5'
                : 'border-border bg-card hover:bg-accent'
            }`}
          >
            <span className="block text-sm font-semibold">
              {[p.brand, p.model, p.storage, p.color].filter(Boolean).join(' ')}
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              IMEI {p.imeiSerial ?? '—'} · {p.cashPrice ? `฿${baht(p.cashPrice)}` : '—'}
            </span>
          </button>
        );
      })}
    </div>
  );
}
