import { useMutation, useQuery } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate, useParams } from 'react-router';
import { z } from 'zod';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { copy } from '@/lib/copy';
import { media } from '@/lib/media-placeholders';
import { useTrackEvent } from '@/hooks/useTrackEvent';
import ShopLayout from '@/components/layout/ShopLayout';
import {
  Button,
  Card,
  CardBody,
  CategoryHero,
  Container,
  Input,
  Label,
  StickyBottomBar,
  StickyBottomBarSpacer,
} from '@/components';

const schema = z.object({
  fullName: z.string().min(2, 'กรุณาระบุชื่อ'),
  phone: z.string().regex(/^0\d{9}$/, 'เบอร์โทร 10 หลัก'),
  nationalId: z.string().regex(/^\d{13}$/, 'เลขบัตรประชาชน 13 หลัก'),
  proposedDownPayment: z.coerce.number().int().min(0),
  proposedTotalMonths: z.coerce.number().int().min(3).max(12),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

interface ProductPreview {
  brand?: string | null;
  model?: string | null;
  storage?: string | null;
  price?: number | string | null;
  gallery?: string[];
}

function toNumber(v: number | string | null | undefined): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? n : 0;
}

export default function InstallmentApplyPage() {
  const { productId } = useParams<{ productId: string }>();
  const nav = useNavigate();
  const track = useTrackEvent();

  const { data: product } = useQuery<ProductPreview>({
    queryKey: ['shop-product', productId],
    queryFn: () => api.get(`/api/shop/products/${productId}`).then((r) => r.data),
    enabled: !!productId,
  });

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { proposedTotalMonths: 12, proposedDownPayment: 2000 },
  });

  const proposedDownPayment = useWatch({ control, name: 'proposedDownPayment' });
  const proposedTotalMonths = useWatch({ control, name: 'proposedTotalMonths' });

  const productPrice = toNumber(product?.price);
  const downValue = toNumber(proposedDownPayment);
  const monthsValue = Math.max(1, toNumber(proposedTotalMonths) || 1);
  const financed = Math.max(0, productPrice - downValue);
  const estimatedMonthly = financed > 0 ? Math.round(financed / monthsValue) : 0;
  const galleryImage = product?.gallery?.[0] ?? media('product.placeholder');

  const mut = useMutation({
    mutationFn: (v: FormValues) =>
      api.post('/api/shop/applications', { productId, ...v }).then((r) => r.data),
    onSuccess: (res) => {
      track('Lead', {
        type: 'installment-apply',
        productId,
        applicationNumber: res.applicationNumber,
      });
      toast.success('รับเรื่องแล้ว ทีมงานจะติดต่อกลับภายใน 2 ชั่วโมง');
      nav(`/apply/success/${res.applicationNumber}`);
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e.response?.data?.message ?? 'ส่งใบสมัครไม่สำเร็จ'),
  });

  const submitting = isSubmitting || mut.isPending;
  const submitLabel = mut.isPending ? 'กำลังส่ง...' : copy.apply.submitCta;
  const onSubmit = handleSubmit((v) => mut.mutate(v));

  return (
    <ShopLayout>
      <CategoryHero
        title={copy.apply.pageTitle}
        breadcrumbs={[
          { label: 'สินค้า', to: '/products' },
          { label: copy.apply.pageTitle },
        ]}
      />

      <Container className="py-6 md:py-10">
        <form onSubmit={onSubmit} className="grid gap-6 md:grid-cols-[1fr_320px]">
          <div className="space-y-6 leading-snug">
            {product && (
              <Card variant="outlined">
                <CardBody className="flex gap-4 items-center">
                  <img
                    src={galleryImage}
                    alt={product.brand ?? 'product'}
                    className="h-16 w-16 rounded-xl object-cover bg-muted shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="font-semibold leading-snug truncate">
                      {[product.brand, product.model, product.storage]
                        .filter(Boolean)
                        .join(' ')}
                    </div>
                    {productPrice > 0 && (
                      <div className="text-sm text-muted-foreground leading-snug">
                        ราคาเครื่อง ฿{productPrice.toLocaleString()}
                      </div>
                    )}
                  </div>
                </CardBody>
              </Card>
            )}

            <Card variant="elevated">
              <CardBody className="space-y-4 leading-snug">
                <div className="space-y-1">
                  <Label htmlFor="fullName" required error={errors.fullName?.message}>
                    {copy.apply.fullName}
                  </Label>
                  <Input
                    id="fullName"
                    variant="lg"
                    {...register('fullName')}
                    aria-invalid={!!errors.fullName}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="phone" required error={errors.phone?.message}>
                      {copy.apply.phone}
                    </Label>
                    <Input
                      id="phone"
                      variant="lg"
                      inputMode="numeric"
                      placeholder="0812345678"
                      {...register('phone')}
                      aria-invalid={!!errors.phone}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label
                      htmlFor="nationalId"
                      required
                      error={errors.nationalId?.message}
                    >
                      {copy.apply.nationalId}
                    </Label>
                    <Input
                      id="nationalId"
                      variant="lg"
                      inputMode="numeric"
                      placeholder="1234567890123"
                      {...register('nationalId')}
                      aria-invalid={!!errors.nationalId}
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label
                      htmlFor="proposedDownPayment"
                      required
                      error={errors.proposedDownPayment?.message}
                    >
                      {copy.apply.downPayment}
                    </Label>
                    <Input
                      id="proposedDownPayment"
                      type="number"
                      variant="lg"
                      {...register('proposedDownPayment')}
                      aria-invalid={!!errors.proposedDownPayment}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label
                      htmlFor="proposedTotalMonths"
                      required
                      help="3 – 12 เดือน"
                      error={errors.proposedTotalMonths?.message}
                    >
                      {copy.apply.totalMonths}
                    </Label>
                    <Input
                      id="proposedTotalMonths"
                      type="number"
                      min={3}
                      max={12}
                      variant="lg"
                      {...register('proposedTotalMonths')}
                      aria-invalid={!!errors.proposedTotalMonths}
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="notes">{copy.apply.notes}</Label>
                  <textarea
                    id="notes"
                    rows={3}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm leading-snug focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring/30 focus-visible:border-ring"
                    {...register('notes')}
                  />
                </div>

                <p className="text-xs text-muted-foreground leading-snug">
                  {copy.apply.pdpaNotice}
                </p>

                <div className="hidden md:block">
                  <Button
                    type="submit"
                    variant="primary"
                    size="lg"
                    fullWidth
                    disabled={submitting}
                    loading={mut.isPending}
                  >
                    {submitLabel}
                  </Button>
                </div>
              </CardBody>
            </Card>
          </div>

          <aside className="space-y-4 leading-snug">
            <Card variant="elevated" className="md:sticky md:top-4">
              <CardBody className="space-y-3">
                <div className="text-sm font-semibold text-foreground leading-snug">
                  ประเมินค่างวดเบื้องต้น
                </div>
                {productPrice > 0 ? (
                  <>
                    <div className="flex items-center justify-between text-sm leading-snug">
                      <span className="text-muted-foreground">ราคาเครื่อง</span>
                      <span className="font-medium">
                        ฿{productPrice.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm leading-snug">
                      <span className="text-muted-foreground">ดาวน์</span>
                      <span className="font-medium">฿{downValue.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm leading-snug">
                      <span className="text-muted-foreground">ยอดจัด</span>
                      <span className="font-medium">
                        ฿{financed.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm leading-snug">
                      <span className="text-muted-foreground">จำนวนงวด</span>
                      <span className="font-medium">{monthsValue} เดือน</span>
                    </div>
                    <div className="pt-3 border-t border-zinc-200 space-y-1">
                      <div className="text-xs text-muted-foreground leading-snug">
                        ประมาณค่างวด/เดือน
                      </div>
                      <div className="text-2xl font-bold text-emerald-600 leading-snug">
                        ฿{estimatedMonthly.toLocaleString()}
                      </div>
                      <p className="text-xs text-muted-foreground leading-snug">
                        ไม่รวมดอกเบี้ย ทีมงานจะแจ้งยอดจริงหลังตรวจเครดิต
                      </p>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground leading-snug">
                    กรอกดาวน์และจำนวนงวดเพื่อดูประมาณค่างวด
                  </p>
                )}
              </CardBody>
            </Card>
          </aside>
        </form>
      </Container>

      <StickyBottomBar>
        <Button
          type="button"
          variant="primary"
          size="lg"
          fullWidth
          disabled={submitting}
          loading={mut.isPending}
          onClick={() => onSubmit()}
        >
          {submitLabel}
        </Button>
      </StickyBottomBar>
      <StickyBottomBarSpacer />
    </ShopLayout>
  );
}
