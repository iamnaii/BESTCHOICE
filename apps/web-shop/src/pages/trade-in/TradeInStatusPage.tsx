import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import ShopLayout from '@/components/layout/ShopLayout';
import type { TradeIn, TradeInStatus } from '@/types/trade-in';

const STATUS_LABEL: Record<TradeInStatus, string> = {
  PENDING_APPRAISAL: 'รอทีมงานประเมินราคา',
  APPRAISED: 'ประเมินราคาแล้ว',
  ACCEPTED: 'ตกลงราคาแล้ว',
  COMPLETED: 'ดำเนินการเสร็จสิ้น',
  REJECTED: 'ไม่รับซื้อ',
};

function priceValue(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

export default function TradeInStatusPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, isError } = useQuery<TradeIn>({
    queryKey: ['trade-in', id],
    queryFn: () => api.get<TradeIn>(`/api/shop/trade-in/${id}`).then((r) => r.data),
    enabled: !!id,
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <ShopLayout>
        <div className="container mx-auto px-4 py-8 text-muted-foreground leading-snug">
          กำลังโหลด...
        </div>
      </ShopLayout>
    );
  }

  if (isError || !data) {
    return (
      <ShopLayout>
        <div className="container mx-auto px-4 py-8 text-destructive leading-snug">
          ไม่พบข้อมูลเรื่องเก่าแลกใหม่
        </div>
      </ShopLayout>
    );
  }

  const offered = priceValue(data.offeredPrice);
  const agreed = priceValue(data.agreedPrice);

  return (
    <ShopLayout>
      <div className="container mx-auto px-4 py-6 max-w-xl space-y-4 leading-snug">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold">เก่าแลกใหม่</h1>
          <p className="text-sm text-muted-foreground">เลขที่เรื่อง: {data.id.slice(0, 8)}</p>
        </header>

        <div className="rounded-xl border border-border p-4 space-y-2">
          <div className="font-semibold">
            {data.deviceBrand} {data.deviceModel} {data.deviceStorage}
          </div>
          <div className="text-sm text-muted-foreground">
            เกรด {data.deviceCondition} · แบตเตอรี่ {data.batteryHealth}%
          </div>
          <div className="text-sm">
            สถานะ: <b>{STATUS_LABEL[data.status] ?? data.status}</b>
          </div>
          {offered !== null && (
            <div className="text-xl font-bold text-primary">
              ราคาที่เสนอ ฿{offered.toLocaleString()}
            </div>
          )}
          {agreed !== null && (
            <div className="text-sm">
              ราคาที่ตกลง: <b>฿{agreed.toLocaleString()}</b>
            </div>
          )}
          {data.notes && (
            <div className="text-sm text-muted-foreground">หมายเหตุ: {data.notes}</div>
          )}
        </div>

        {data.photoUrls.length > 0 && (
          <section className="space-y-2">
            <h2 className="font-semibold text-sm">รูปเครื่อง</h2>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {data.photoUrls.map((url, i) => (
                <div
                  key={i}
                  className="relative aspect-square rounded-xl overflow-hidden bg-muted"
                >
                  <img
                    src={url}
                    alt={`รูปที่ ${i + 1}`}
                    className="h-full w-full object-cover"
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        <p className="text-xs text-muted-foreground">
          ทีมงานจะติดต่อกลับทาง LINE/โทรศัพท์ภายใน 24 ชั่วโมง
        </p>
      </div>
    </ShopLayout>
  );
}
