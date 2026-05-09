// Asset module — EntryPage Section 3 (vendor + payment)
// Pure presentation. Uses parent FormProvider for state.

import { useFormContext } from 'react-hook-form';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import type { AssetEntryFormValues } from '../schema';
import { CASH_ACCOUNTS } from '../types';

export function AssetEntrySection3Vendor() {
  const {
    register,
    setValue,
    watch,
    formState: { errors },
  } = useFormContext<AssetEntryFormValues>();
  const purchaseDate = watch('purchaseDate');
  const invoiceDate = watch('invoiceDate');
  const paymentMethod = watch('paymentMethod');
  const paymentAccount = watch('paymentAccount');

  return (
    <Card>
      <CardHeader>
        <CardTitle>3. ผู้ขาย + การชำระเงิน</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label>วันที่ซื้อ *</Label>
          <ThaiDateInput
            value={purchaseDate}
            onChange={(e) => setValue('purchaseDate', e.target.value, { shouldValidate: true })}
          />
          {errors.purchaseDate && (
            <p className="text-sm text-destructive mt-1">{errors.purchaseDate.message}</p>
          )}
        </div>
        <div>
          <Label>วันที่ใบกำกับภาษี</Label>
          <ThaiDateInput
            value={invoiceDate ?? ''}
            onChange={(e) => setValue('invoiceDate', e.target.value)}
          />
        </div>
        <div>
          <Label>ชื่อผู้ขาย</Label>
          <Input {...register('supplierName')} />
          {errors.supplierName && (
            <p className="text-sm text-destructive mt-1">{errors.supplierName.message}</p>
          )}
        </div>
        <div>
          <Label>เลขผู้เสียภาษี (13 หลัก)</Label>
          <Input {...register('supplierTaxId')} maxLength={13} />
        </div>
        <div>
          <Label>เลขที่ใบสั่งซื้อ / ใบแจ้งหนี้</Label>
          <Input {...register('invoiceNo')} />
        </div>
        <div>
          <Label>เลขใบกำกับภาษี</Label>
          <Input {...register('taxInvoiceNo')} />
        </div>
        <div>
          <Label>วิธีชำระ</Label>
          <Select
            value={paymentMethod ?? 'CASH'}
            onValueChange={(v) =>
              setValue('paymentMethod', v as AssetEntryFormValues['paymentMethod'])
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="CASH">เงินสด</SelectItem>
              <SelectItem value="BANK_TRANSFER">โอนเงิน</SelectItem>
              <SelectItem value="QR_EWALLET">QR / e-Wallet</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>บัญชีจ่ายเงิน *</Label>
          <Select
            value={paymentAccount}
            onValueChange={(v) => setValue('paymentAccount', v, { shouldValidate: true })}
          >
            <SelectTrigger>
              <SelectValue placeholder="เลือกบัญชี" />
            </SelectTrigger>
            <SelectContent>
              {CASH_ACCOUNTS.map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  {c.code} {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.paymentAccount && (
            <p className="text-sm text-destructive mt-1">{errors.paymentAccount.message}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
