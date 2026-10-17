import { NameAutocomplete } from '@/components/ui/NameAutocomplete';
import { useId } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BANK_OPTIONS } from '@/components/credit-check/types';

export interface SellerPayment {
  paymentMethod: 'CASH' | 'TRANSFER';
  transferBankName: string;
  transferAccountNumber: string;
  transferAccountName: string;
}

/** Seller destination only. The SHOP funding account is resolved by the API. */
export default function SellerPaymentFields({ value, onChange, disabled = false }: {
  value: SellerPayment;
  onChange: (patch: Partial<SellerPayment>) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <fieldset disabled={disabled} className="space-y-3 border-t pt-3">
      <legend className="text-sm font-medium">จ่ายเงินให้ผู้ขาย</legend>
      <div className="flex gap-4">
        {(['CASH', 'TRANSFER'] as const).map((method) => (
          <label key={method} className="flex min-h-11 items-center gap-2 text-sm">
            <input type="radio" name={`${id}-method`} checked={value.paymentMethod === method}
              onChange={() => onChange({ paymentMethod: method })} />
            {method === 'CASH' ? 'เงินสด' : 'โอนเงิน'}
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {value.paymentMethod === 'CASH' ? 'จ่ายจากเงินสดของสาขาที่รับซื้อ' : 'จ่ายจากบัญชีจ่ายของ SHOP'}
      </p>
      {value.paymentMethod === 'TRANSFER' && (
        <div className="space-y-3 rounded-lg border p-3">
          <p className="text-sm font-medium">บัญชีผู้ขายที่รับเงิน</p>
          <div>
            <Label htmlFor={`${id}-bank`}>ธนาคารผู้ขาย *</Label>
            <NameAutocomplete id={`${id}-bank`} value={value.transferBankName}
              options={BANK_OPTIONS} disabled={disabled}
              onChange={(transferBankName) => onChange({ transferBankName })} />
          </div>
          <div>
            <Label htmlFor={`${id}-account`}>เลขบัญชีผู้ขาย *</Label>
            <Input id={`${id}-account`} inputMode="numeric" value={value.transferAccountNumber}
              onChange={(e) => onChange({ transferAccountNumber: e.target.value.replace(/[^\d-]/g, '') })} />
          </div>
          <div>
            <Label htmlFor={`${id}-name`}>ชื่อบัญชีผู้ขาย *</Label>
            <Input id={`${id}-name`} value={value.transferAccountName}
              onChange={(e) => onChange({ transferAccountName: e.target.value })} />
          </div>
        </div>
      )}
    </fieldset>
  );
}
