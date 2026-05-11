// Asset module — EntryPage Section 3 (vendor + payment)
// Pure presentation. Uses parent FormProvider for state.

import { useFormContext } from 'react-hook-form';
import { Card, CardContent } from '@/components/ui/card';
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
import { AssetSectionHeader } from './AssetSectionHeader';

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
      <AssetSectionHeader number={3} title="ผู้ขาย & การชำระเงิน" />
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label>ชื่อผู้ขาย / บริษัท *</Label>
          <Input {...register('supplierName')} placeholder="ชื่อร้านค้า / บริษัท" />
          {errors.supplierName && (
            <p className="text-sm text-destructive mt-1">{errors.supplierName.message}</p>
          )}
        </div>
        <div>
          <Label>เลขประจำตัวผู้เสียภาษี (13 หลัก)</Label>
          <Input
            {...register('supplierTaxId')}
            maxLength={13}
            placeholder="0123456789012"
          />
        </div>
        <div>
          <Label>เลขใบกำกับภาษี</Label>
          <Input {...register('taxInvoiceNo')} placeholder="INV-2026-XXXXX" />
        </div>
        <div>
          <Label>วันที่ใบกำกับ</Label>
          <ThaiDateInput
            value={invoiceDate ?? ''}
            onChange={(e) => setValue('invoiceDate', e.target.value)}
          />
        </div>
        <div>
          <Label>อ้างอิง PR</Label>
          <Input {...register('invoiceNo')} placeholder="PR-2026-XXXX" />
          <p className="mt-1 text-xs text-muted-foreground">ปล่อยว่างถ้าไม่มี</p>
        </div>
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
          <Label>ช่องทางการชำระเงิน (Cr) *</Label>
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
