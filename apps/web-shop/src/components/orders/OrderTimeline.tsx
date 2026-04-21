const STEPS = [
  { key: 'PENDING_PAYMENT', label: 'สั่งซื้อ' },
  { key: 'PAID', label: 'ชำระเงิน' },
  { key: 'PACKING', label: 'แพ็คสินค้า' },
  { key: 'SHIPPED', label: 'จัดส่ง' },
  { key: 'DELIVERED', label: 'ส่งถึง' },
];

export default function OrderTimeline({ status }: { status: string }) {
  const idx = STEPS.findIndex((s) => s.key === status);
  return (
    <div className="flex items-center justify-between py-4 leading-snug">
      {STEPS.map((s, i) => (
        <div key={s.key} className="flex flex-col items-center flex-1">
          <div
            className={`h-3 w-3 rounded-full ${i <= idx ? 'bg-primary' : 'bg-muted'}`}
            aria-hidden="true"
          />
          <div className={`text-xs mt-1 ${i <= idx ? '' : 'text-muted-foreground'}`}>
            {s.label}
          </div>
        </div>
      ))}
    </div>
  );
}
