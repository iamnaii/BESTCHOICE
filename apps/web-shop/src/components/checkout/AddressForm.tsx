import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import type { ShippingAddress } from '../../types/shipping';

const schema = z.object({
  recipientName: z.string().min(2, 'กรุณาระบุชื่อผู้รับ'),
  phone: z.string().regex(/^0\d{9}$/, 'เบอร์โทร 10 หลัก'),
  line1: z.string().min(5, 'ที่อยู่ไม่ครบ'),
  line2: z.string().optional(),
  subDistrict: z.string().min(2, 'กรุณาระบุตำบล/แขวง'),
  district: z.string().min(2, 'กรุณาระบุอำเภอ/เขต'),
  province: z.string().min(2, 'กรุณาระบุจังหวัด'),
  postalCode: z.string().regex(/^\d{5}$/, 'รหัสไปรษณีย์ 5 หลัก'),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  onSubmit: (addr: ShippingAddress) => void;
  initial?: Partial<ShippingAddress>;
}

export default function AddressForm({ onSubmit, initial }: Props) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: initial as FormValues | undefined,
  });

  return (
    <form onSubmit={handleSubmit((v) => onSubmit(v))} className="space-y-4 max-w-xl leading-snug">
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="recipientName">ชื่อผู้รับ</Label>
          <Input id="recipientName" {...register('recipientName')} />
          {errors.recipientName && (
            <span className="text-xs text-destructive">{errors.recipientName.message}</span>
          )}
        </div>
        <div className="space-y-1">
          <Label htmlFor="phone">เบอร์โทร</Label>
          <Input id="phone" {...register('phone')} placeholder="0812345678" />
          {errors.phone && <span className="text-xs text-destructive">{errors.phone.message}</span>}
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="line1">ที่อยู่ (บ้านเลขที่ ซอย ถนน)</Label>
        <Input id="line1" {...register('line1')} />
        {errors.line1 && <span className="text-xs text-destructive">{errors.line1.message}</span>}
      </div>
      <div className="space-y-1">
        <Label htmlFor="line2">ที่อยู่เพิ่มเติม (ถ้ามี)</Label>
        <Input id="line2" {...register('line2')} />
      </div>
      <div className="grid sm:grid-cols-3 gap-4">
        <div className="space-y-1">
          <Label htmlFor="subDistrict">ตำบล/แขวง</Label>
          <Input id="subDistrict" {...register('subDistrict')} />
          {errors.subDistrict && (
            <span className="text-xs text-destructive">{errors.subDistrict.message}</span>
          )}
        </div>
        <div className="space-y-1">
          <Label htmlFor="district">อำเภอ/เขต</Label>
          <Input id="district" {...register('district')} />
          {errors.district && (
            <span className="text-xs text-destructive">{errors.district.message}</span>
          )}
        </div>
        <div className="space-y-1">
          <Label htmlFor="province">จังหวัด</Label>
          <Input id="province" {...register('province')} />
          {errors.province && (
            <span className="text-xs text-destructive">{errors.province.message}</span>
          )}
        </div>
      </div>
      <div className="max-w-[180px] space-y-1">
        <Label htmlFor="postalCode">รหัสไปรษณีย์</Label>
        <Input id="postalCode" {...register('postalCode')} />
        {errors.postalCode && (
          <span className="text-xs text-destructive">{errors.postalCode.message}</span>
        )}
      </div>
      <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto">
        ดำเนินการต่อ
      </Button>
    </form>
  );
}
