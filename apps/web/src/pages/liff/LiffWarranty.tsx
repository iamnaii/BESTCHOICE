import { useLiffInit } from '@/hooks/useLiffInit';
import { liffApi } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';
import { formatDateMedium } from '@/utils/formatters';
import { ShieldCheck, ShieldAlert, Smartphone, MessageCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { LIFF_ERRORS } from '@/constants/liff-errors';

interface WarrantyDevice {
  title: string;
  imeiSerial: string | null;
  purchasedAt: string | null;
  shopWarrantyEndDate: string | null;
  shopWarrantyDaysLeft: number | null;
  manufacturerWarrantyEndDate: string | null;
  manufacturerWarrantyDaysLeft: number | null;
  status: 'IN_SHOP_WARRANTY' | 'IN_MANUFACTURER' | 'EXPIRED';
}

interface WarrantyResponse {
  linked: boolean;
  customerName: string | null;
  devices: WarrantyDevice[];
}

const STATUS: Record<
  WarrantyDevice['status'],
  { label: string; variant: 'success' | 'info' | 'secondary' }
> = {
  IN_SHOP_WARRANTY: { label: 'อยู่ในประกันร้าน', variant: 'success' },
  IN_MANUFACTURER: { label: 'อยู่ในประกันศูนย์', variant: 'info' },
  EXPIRED: { label: 'หมดประกันแล้ว', variant: 'secondary' },
};

/** บรรทัดประกันหนึ่งชั้น — ไม่แสดงเลยถ้าไม่มีวันหมดอายุ (เช่น เครื่องใหม่ไม่มีประกันร้าน) */
function WarrantyLine({
  label,
  endDate,
  daysLeft,
}: {
  label: string;
  endDate: string | null;
  daysLeft: number | null;
}) {
  if (!endDate) return null;
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm leading-snug">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-right">
        <span className="text-foreground">{formatDateMedium(endDate)}</span>
        {daysLeft !== null ? (
          <span className="text-success font-medium"> · เหลือ {daysLeft} วัน</span>
        ) : (
          <span className="text-muted-foreground"> · หมดแล้ว</span>
        )}
      </span>
    </div>
  );
}

export default function LiffWarranty() {
  const { lineId, loading, error } = useLiffInit();

  const {
    data,
    isLoading,
    error: dataError,
  } = useQuery<WarrantyResponse>({
    queryKey: ['liff-warranty', lineId],
    queryFn: async () => {
      const { data } = await liffApi.get('/line-oa/liff/my-warranties');
      return data;
    },
    enabled: !!lineId,
  });

  if (loading || isLoading) {
    return (
      <div className="min-h-screen bg-background p-4 space-y-4">
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    );
  }

  if (error || dataError) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="text-center py-10">
            <ShieldAlert className="size-12 text-destructive mx-auto mb-4" />
            <h2 className="text-lg font-bold mb-2 leading-snug">{LIFF_ERRORS.LOAD_FAILED}</h2>
            <p className="text-muted-foreground text-sm leading-snug">
              {error || (dataError as Error)?.message}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ยังไม่ผูกบัญชี — บอกวิธีที่ "ทำได้จริงตอนนี้" คือพิมพ์เบอร์โทรคุยกับ OA
  // (line-oa-chatbot.controller `handleSelfLinkByPhone` รับข้อความที่เป็นเบอร์โทรแล้วผูกให้)
  if (!data?.linked) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="text-center py-10">
            <MessageCircle className="size-12 text-primary mx-auto mb-4" />
            <h2 className="text-lg font-bold mb-2 leading-snug">ยังไม่ได้ผูกบัญชี</h2>
            <p className="text-muted-foreground text-sm leading-snug">
              พิมพ์ <span className="text-foreground font-medium">เบอร์โทรศัพท์</span> ของคุณ
              ส่งเข้ามาในแชทนี้ ระบบจะผูกบัญชีให้อัตโนมัติ แล้วกลับมาหน้านี้อีกครั้ง
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const devices = data.devices;

  if (devices.length === 0) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="text-center py-10">
            <Smartphone className="size-12 text-muted-foreground/40 mx-auto mb-4" />
            <h2 className="text-lg font-bold mb-2 leading-snug">ยังไม่มีเครื่องในระบบ</h2>
            <p className="text-muted-foreground text-sm leading-snug">
              เครื่องที่ซื้อกับเราจะแสดงที่นี่พร้อมวันหมดประกัน
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 space-y-4">
      <div className="px-1">
        <h1 className="text-xl font-bold text-foreground leading-snug">ประกันของฉัน</h1>
        {data.customerName && (
          <p className="text-sm text-muted-foreground leading-snug">คุณ{data.customerName}</p>
        )}
      </div>

      {devices.map((d, i) => {
        const cfg = STATUS[d.status];
        return (
          <Card key={`${d.imeiSerial ?? 'device'}-${i}`}>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-foreground leading-snug">{d.title}</div>
                  {d.imeiSerial && (
                    <div className="text-xs text-muted-foreground tabular-nums mt-0.5">
                      IMEI {d.imeiSerial}
                    </div>
                  )}
                </div>
                <Badge variant={cfg.variant} className="shrink-0">
                  {cfg.label}
                </Badge>
              </div>

              <div className="border-t border-border pt-3 space-y-1.5">
                <WarrantyLine
                  label="ประกันร้าน"
                  endDate={d.shopWarrantyEndDate}
                  daysLeft={d.shopWarrantyDaysLeft}
                />
                <WarrantyLine
                  label="ประกันศูนย์"
                  endDate={d.manufacturerWarrantyEndDate}
                  daysLeft={d.manufacturerWarrantyDaysLeft}
                />
                {!d.shopWarrantyEndDate && !d.manufacturerWarrantyEndDate && (
                  <p className="text-sm text-muted-foreground leading-snug">
                    ไม่มีข้อมูลวันหมดประกัน — ติดต่อสาขาที่ซื้อเพื่อตรวจสอบ
                  </p>
                )}
                {d.purchasedAt && (
                  <div className="flex items-baseline justify-between gap-3 text-sm leading-snug">
                    <span className="text-muted-foreground shrink-0">วันที่ซื้อ</span>
                    <span className="text-foreground">{formatDateMedium(d.purchasedAt)}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}

      <div className="flex items-start gap-2 px-1 pt-1 pb-6 text-xs text-muted-foreground leading-snug">
        <ShieldCheck className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
        <span>เครื่องที่อยู่ในประกันสามารถนำมาเคลมที่สาขาได้ กรุณานำเครื่องและบัตรประชาชนมาด้วย</span>
      </div>
    </div>
  );
}
