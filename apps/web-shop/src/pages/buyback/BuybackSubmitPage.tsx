import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useTrackEvent } from '@/hooks/useTrackEvent';
import ShopLayout from '@/components/layout/ShopLayout';
import DeviceSelector, {
  type DeviceSelectorValue,
} from '@/components/device-submit/DeviceSelector';
import DeviceSpecForm, { type DeviceSpec } from '@/components/device-submit/DeviceSpecForm';
import PhotoUploadGrid from '@/components/device-submit/PhotoUploadGrid';
import ValuationDisplay from '@/components/device-submit/ValuationDisplay';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { BuybackEstimate, BuybackSubmitResponse } from '@/types/buyback';

const PHONE_RE = /^0\d{9}$/;

function isGrade(v: string | null): v is 'A' | 'B' | 'C' {
  return v === 'A' || v === 'B' || v === 'C';
}

export default function BuybackSubmitPage() {
  const nav = useNavigate();
  const track = useTrackEvent();
  const [searchParams] = useSearchParams();

  const seedCondition = searchParams.get('condition');
  const [device, setDevice] = useState<DeviceSelectorValue>({
    brand: searchParams.get('brand') ?? '',
    model: searchParams.get('model') ?? '',
    storage: searchParams.get('storage') ?? '',
  });
  const [spec, setSpec] = useState<DeviceSpec>({
    condition: isGrade(seedCondition) ? seedCondition : 'A',
    batteryHealth: 90,
  });
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [sellerName, setSellerName] = useState('');
  const [sellerPhone, setSellerPhone] = useState('');
  const [lineUserId, setLineUserId] = useState('');

  const deviceReady = !!(device.brand && device.model && device.storage);

  const estimateQ = useQuery<BuybackEstimate>({
    queryKey: ['buyback-estimate', device.brand, device.model, device.storage, spec.condition],
    queryFn: () =>
      api
        .post<BuybackEstimate>('/api/shop/buyback/quick-quote', {
          brand: device.brand,
          model: device.model,
          storage: device.storage,
          condition: spec.condition,
        })
        .then((r) => r.data),
    enabled: deviceReady,
  });

  const submit = useMutation({
    mutationFn: () =>
      api
        .post<BuybackSubmitResponse>('/api/shop/buyback/submit', {
          brand: device.brand,
          model: device.model,
          storage: device.storage,
          condition: spec.condition,
          batteryHealth: spec.batteryHealth,
          imei: spec.imei || undefined,
          notes: spec.notes || undefined,
          photoUrls,
          sellerName,
          sellerPhone,
          lineUserId: lineUserId || undefined,
        })
        .then((r) => r.data),
    onSuccess: (res) => {
      track('Lead', {
        type: 'buyback',
        brand: device.brand,
        model: device.model,
        storage: device.storage,
        condition: spec.condition,
      });
      toast.success('ส่งเรื่องรับซื้อแล้ว ทีมงานจะติดต่อกลับภายใน 24 ชั่วโมง');
      nav(`/buyback/${res.id}`);
    },
    onError: (e: { response?: { data?: { message?: string } } }) => {
      toast.error(e.response?.data?.message ?? 'ส่งเรื่องไม่สำเร็จ กรุณาลองใหม่');
    },
  });

  const canSubmit =
    deviceReady &&
    photoUrls.length >= 1 &&
    sellerName.trim().length >= 2 &&
    PHONE_RE.test(sellerPhone);

  return (
    <ShopLayout>
      <div className="container mx-auto px-4 py-6 max-w-2xl space-y-6 leading-snug">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold">ขายมือถือเก่า — ส่งข้อมูลเครื่อง</h1>
          <p className="text-sm text-muted-foreground">
            กรอกข้อมูลและรูปเครื่อง — ทีมงานจะประเมินราคาจริงและติดต่อกลับใน 24 ชั่วโมง
          </p>
        </header>

        <section className="space-y-3">
          <h2 className="font-semibold">1. เครื่องของคุณ</h2>
          <DeviceSelector value={device} onChange={setDevice} />
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold">2. สภาพเครื่อง</h2>
          <DeviceSpecForm value={spec} onChange={setSpec} />
        </section>

        {deviceReady && estimateQ.data && (
          <ValuationDisplay
            min={estimateQ.data.min}
            max={estimateQ.data.max}
            available={estimateQ.data.available}
          />
        )}

        <section className="space-y-3">
          <h2 className="font-semibold">3. รูปเครื่อง (อย่างน้อย 1 รูป)</h2>
          <PhotoUploadGrid kind="BUYBACK_PHOTO" value={photoUrls} onChange={setPhotoUrls} />
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold">4. ข้อมูลติดต่อ</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="sellerName">ชื่อ-นามสกุล</Label>
              <Input
                id="sellerName"
                value={sellerName}
                onChange={(e) => setSellerName(e.target.value)}
                placeholder="เช่น สมชาย ใจดี"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sellerPhone">เบอร์โทร (10 หลัก)</Label>
              <Input
                id="sellerPhone"
                value={sellerPhone}
                onChange={(e) => setSellerPhone(e.target.value.replace(/\D/g, ''))}
                maxLength={10}
                inputMode="numeric"
                placeholder="0812345678"
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="lineUserId">LINE ID (ถ้ามี)</Label>
              <Input
                id="lineUserId"
                value={lineUserId}
                onChange={(e) => setLineUserId(e.target.value)}
                placeholder="ทีมงานจะติดต่อกลับทาง LINE ที่ระบุ"
              />
            </div>
          </div>
        </section>

        <Button
          onClick={() => submit.mutate()}
          disabled={!canSubmit || submit.isPending}
          size="lg"
          className="w-full"
        >
          {submit.isPending ? 'กำลังส่ง...' : 'ส่งข้อมูล'}
        </Button>
      </div>
    </ShopLayout>
  );
}
