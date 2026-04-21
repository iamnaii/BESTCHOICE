import type { PaymentChannel } from '../../types/order';

interface Props {
  value: PaymentChannel | null;
  onChange: (v: PaymentChannel) => void;
}

const OPTIONS: Array<{ value: PaymentChannel; label: string; desc: string }> = [
  { value: 'PROMPTPAY_QR', label: 'PromptPay QR', desc: 'สแกนจ่ายจากแอปธนาคาร — ยืนยันทันที' },
  { value: 'CREDIT_DEBIT_CARD', label: 'บัตรเครดิต/เดบิต', desc: 'Visa, Mastercard, JCB' },
  {
    value: 'BANK_TRANSFER',
    label: 'โอนเงินเข้าบัญชี',
    desc: 'แนบสลิปหลังโอน — ยืนยันภายใน 1 ชั่วโมง',
  },
];

export default function PaymentMethodPicker({ value, onChange }: Props) {
  return (
    <div className="space-y-2 leading-snug">
      <div className="text-sm font-medium">วิธีชำระเงิน</div>
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`w-full text-left rounded-xl border p-3 transition-colors ${
            value === o.value ? 'border-primary bg-primary/5' : 'border-border'
          }`}
        >
          <div className="font-semibold">{o.label}</div>
          <div className="text-xs text-muted-foreground">{o.desc}</div>
        </button>
      ))}
    </div>
  );
}
