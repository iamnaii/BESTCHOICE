// Asset module — EntryPage Section 3 (vendor + payment)
// PR 2a Task 5 (P6): vendor master combobox + inline "+ เพิ่มผู้ขายใหม่" dialog
// + partial-payment amount input ("จำนวนเงินที่จ่าย").
//
// P1a: bespoke Popover/Command picker replaced with shared <ContactCombobox>.
// Free-text path removed; vendors must now be real Contacts (SUPPLIER role).
// Previously-used names ("เคยใช้") also removed.
//
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
import { accountDisplayName } from '@/utils/accountName';
import type { AssetEntryFormValues } from '../schema';
import { CASH_ACCOUNTS } from '../types';
import { AssetSectionHeader } from './AssetSectionHeader';
import { ContactCombobox, type ContactPickResult } from '@/components/contacts/ContactCombobox';

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
  const supplierName = watch('supplierName') ?? '';

  // Every selection is now a real Supplier contact — set all three fields.
  const handleVendorSelect = ({ childId, name, taxId }: ContactPickResult) => {
    setValue('supplierName', name, { shouldDirty: true, shouldValidate: true });
    setValue('vendorId', childId, { shouldDirty: true });
    setValue('supplierTaxId', taxId ?? '', { shouldDirty: true });
  };

  const clearSupplier = () => {
    setValue('vendorId', undefined, { shouldDirty: true });
    setValue('supplierName', '', { shouldDirty: true, shouldValidate: true });
    setValue('supplierTaxId', '', { shouldDirty: true });
  };

  return (
    <Card>
      <AssetSectionHeader number={3} title="ผู้ขาย & การชำระเงิน" />
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="vendor-combobox">ชื่อผู้ขาย / บริษัท *</Label>
          <ContactCombobox
            roleNeeded="SUPPLIER"
            value={supplierName}
            invalid={!!errors.supplierName}
            placeholder="เลือกผู้ขาย / บริษัท"
            onSelect={handleVendorSelect}
          />
          {supplierName && (
            <button
              type="button"
              onClick={clearSupplier}
              className="mt-1 text-xs text-muted-foreground hover:text-foreground underline"
            >
              ล้างชื่อผู้ขาย
            </button>
          )}
          {errors.supplierName && (
            <p className="text-sm text-destructive mt-1">{errors.supplierName.message}</p>
          )}
        </div>
        <div>
          <Label htmlFor="vendor-tax-id">เลขประจำตัวผู้เสียภาษี (13 หลัก)</Label>
          <Input
            id="vendor-tax-id"
            {...register('supplierTaxId')}
            maxLength={13}
            placeholder="0123456789012"
          />
        </div>
        <div>
          <Label htmlFor="tax-invoice-no">เลขใบกำกับภาษี</Label>
          <Input id="tax-invoice-no" {...register('taxInvoiceNo')} placeholder="INV-2026-XXXXX" />
        </div>
        <div>
          <Label>วันที่ใบกำกับ</Label>
          <ThaiDateInput
            value={invoiceDate ?? ''}
            onChange={(e) => setValue('invoiceDate', e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="pr-ref">อ้างอิง PR</Label>
          <Input id="pr-ref" {...register('invoiceNo')} placeholder="PR-2026-XXXX" />
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
                  {accountDisplayName(c.name)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.paymentAccount && (
            <p className="text-sm text-destructive mt-1">{errors.paymentAccount.message}</p>
          )}
        </div>
        <div className="md:col-span-2">
          <Label htmlFor="vendor-amount-paid">จำนวนเงินที่จ่าย</Label>
          <Input
            id="vendor-amount-paid"
            type="number"
            step="0.01"
            min="0"
            {...register('vendorAmountPaid', { valueAsNumber: true })}
            placeholder="ว่างไว้ = ชำระเต็มจำนวน"
          />
          <p className="text-xs text-muted-foreground mt-1">
            หากชำระบางส่วน — JE preview จะตั้งเป็นเจ้าหนี้สำหรับยอดคงเหลือ (รองรับใน
            phase ถัดไป)
          </p>
          {errors.vendorAmountPaid && (
            <p className="text-sm text-destructive mt-1">
              {errors.vendorAmountPaid.message}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
