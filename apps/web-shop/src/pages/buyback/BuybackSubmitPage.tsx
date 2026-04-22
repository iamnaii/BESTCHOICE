import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { copy } from '@/lib/copy';
import { useTrackEvent } from '@/hooks/useTrackEvent';
import ShopLayout from '@/components/layout/ShopLayout';
import DeviceSelector, {
  type DeviceSelectorValue,
} from '@/components/device-submit/DeviceSelector';
import DeviceSpecForm, { type DeviceSpec } from '@/components/device-submit/DeviceSpecForm';
import PhotoUploadGrid from '@/components/device-submit/PhotoUploadGrid';
import ValuationDisplay from '@/components/device-submit/ValuationDisplay';
import {
  Button,
  Card,
  CardBody,
  CategoryHero,
  Container,
  Input,
  Label,
  Stepper,
  StickyBottomBar,
  StickyBottomBarSpacer,
} from '@/components';
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
  const specReady = deviceReady;
  const photosReady = photoUrls.length >= 1;
  const sellerReady =
    sellerName.trim().length >= 2 && PHONE_RE.test(sellerPhone);

  let currentStep = 1;
  if (deviceReady) currentStep = 2;
  if (deviceReady && specReady) currentStep = photosReady ? 4 : 3;
  if (deviceReady && specReady && photosReady && sellerReady) currentStep = 4;

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
      toast.success(copy.buyback.submitSuccess);
      nav(`/buyback/${res.id}`);
    },
    onError: (e: { response?: { data?: { message?: string } } }) => {
      toast.error(e.response?.data?.message ?? copy.buyback.submitError);
    },
  });

  const canSubmit = deviceReady && photosReady && sellerReady;
  const submitLabel = submit.isPending ? 'กำลังส่ง...' : copy.buyback.submitCta;

  return (
    <ShopLayout>
      <CategoryHero
        title="ส่งข้อมูลเครื่อง"
        breadcrumbs={[
          { label: copy.buyback.pageTitle, to: '/buyback' },
          { label: 'ส่งข้อมูล' },
        ]}
      />

      <Container narrow className="py-6 md:py-10 space-y-6 leading-snug">
        <Stepper
          steps={[
            { label: copy.buyback.stepDevice },
            { label: copy.buyback.stepCondition },
            { label: copy.buyback.stepPhotos },
            { label: copy.buyback.stepSeller },
          ]}
          current={currentStep}
        />

        <Card variant="elevated">
          <CardBody className="space-y-6 leading-snug">
            <section className="space-y-3">
              <h2 className="font-semibold leading-snug">1. เครื่องของคุณ</h2>
              <DeviceSelector value={device} onChange={setDevice} />
            </section>

            <section className="space-y-3">
              <h2 className="font-semibold leading-snug">2. สภาพเครื่อง</h2>
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
              <h2 className="font-semibold leading-snug">
                3. {copy.buyback.photosRequired}
              </h2>
              <PhotoUploadGrid
                kind="BUYBACK_PHOTO"
                value={photoUrls}
                onChange={setPhotoUrls}
              />
            </section>

            <section className="space-y-3">
              <h2 className="font-semibold leading-snug">4. ข้อมูลติดต่อ</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label htmlFor="sellerName" required>
                    {copy.buyback.sellerName}
                  </Label>
                  <Input
                    id="sellerName"
                    variant="lg"
                    value={sellerName}
                    onChange={(e) => setSellerName(e.target.value)}
                    placeholder="เช่น สมชาย ใจดี"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="sellerPhone" required>
                    {copy.buyback.sellerPhone}
                  </Label>
                  <Input
                    id="sellerPhone"
                    variant="lg"
                    value={sellerPhone}
                    onChange={(e) => setSellerPhone(e.target.value.replace(/\D/g, ''))}
                    maxLength={10}
                    inputMode="numeric"
                    placeholder="0812345678"
                  />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="lineUserId">{copy.buyback.sellerLineId}</Label>
                  <Input
                    id="lineUserId"
                    variant="lg"
                    value={lineUserId}
                    onChange={(e) => setLineUserId(e.target.value)}
                    placeholder="ทีมงานจะติดต่อกลับทาง LINE ที่ระบุ"
                  />
                </div>
              </div>
            </section>

            <div className="hidden md:block">
              <Button
                onClick={() => submit.mutate()}
                disabled={!canSubmit || submit.isPending}
                loading={submit.isPending}
                variant="primary"
                size="lg"
                fullWidth
              >
                {submitLabel}
              </Button>
            </div>
          </CardBody>
        </Card>
      </Container>

      <StickyBottomBar>
        <Button
          onClick={() => submit.mutate()}
          disabled={!canSubmit || submit.isPending}
          loading={submit.isPending}
          variant="primary"
          size="lg"
          fullWidth
        >
          {submitLabel}
        </Button>
      </StickyBottomBar>
      <StickyBottomBarSpacer />
    </ShopLayout>
  );
}
