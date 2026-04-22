import { useMutation, useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate, useParams } from 'react-router';
import { z } from 'zod';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { useTrackEvent } from '../../hooks/useTrackEvent';
import ShopLayout from '../../components/layout/ShopLayout';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';

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
  gallery?: string[];
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
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { proposedTotalMonths: 12, proposedDownPayment: 2000 },
  });

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

  return (
    <ShopLayout>
      <div className="container mx-auto px-4 py-6 max-w-xl space-y-6 leading-snug">
        <h1 className="text-2xl font-bold">สมัครผ่อน</h1>
        {product && (
          <div className="rounded-xl border border-border p-4 flex gap-4">
            {product.gallery?.[0] && (
              <img
                src={product.gallery[0]}
                alt={product.brand ?? 'product'}
                className="h-16 w-16 rounded-lg object-cover bg-muted"
              />
            )}
            <div>
              <div className="font-semibold">
                {[product.brand, product.model, product.storage].filter(Boolean).join(' ')}
              </div>
            </div>
          </div>
        )}
        <form onSubmit={handleSubmit((v) => mut.mutate(v))} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="fullName">ชื่อ-นามสกุล</Label>
            <Input id="fullName" {...register('fullName')} />
            {errors.fullName && (
              <span className="text-xs text-destructive">{errors.fullName.message}</span>
            )}
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="phone">เบอร์โทร</Label>
              <Input id="phone" {...register('phone')} placeholder="0812345678" />
              {errors.phone && (
                <span className="text-xs text-destructive">{errors.phone.message}</span>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="nationalId">เลขบัตรประชาชน</Label>
              <Input id="nationalId" {...register('nationalId')} placeholder="1234567890123" />
              {errors.nationalId && (
                <span className="text-xs text-destructive">{errors.nationalId.message}</span>
              )}
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="proposedDownPayment">ดาวน์ (บาท)</Label>
              <Input
                id="proposedDownPayment"
                type="number"
                {...register('proposedDownPayment')}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="proposedTotalMonths">จำนวนงวด (เดือน)</Label>
              <Input
                id="proposedTotalMonths"
                type="number"
                min={3}
                max={12}
                {...register('proposedTotalMonths')}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="notes">หมายเหตุ (ถ้ามี)</Label>
            <Input id="notes" {...register('notes')} />
          </div>
          <Button type="submit" disabled={isSubmitting || mut.isPending} className="w-full">
            {mut.isPending ? 'กำลังส่ง...' : 'ส่งใบสมัคร'}
          </Button>
          <p className="text-xs text-muted-foreground">
            ข้อมูลของคุณถูกเก็บภายใต้นโยบาย PDPA — ใช้เพื่อประเมินสินเชื่อเท่านั้น
          </p>
        </form>
      </div>
    </ShopLayout>
  );
}
