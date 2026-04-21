interface Props {
  step: 1 | 2 | 3;
}

export default function CheckoutStepper({ step }: Props) {
  const steps = ['ที่อยู่จัดส่ง', 'วิธีจัดส่ง', 'ชำระเงิน'];
  return (
    <div className="flex items-center justify-center gap-4 py-6 leading-snug">
      {steps.map((label, i) => {
        const n = i + 1;
        return (
          <div key={n} className="flex items-center gap-2">
            <div
              className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold ${
                n <= step ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
              }`}
            >
              {n}
            </div>
            <span className={n === step ? 'font-semibold' : 'text-muted-foreground'}>{label}</span>
            {n < 3 && <div className="w-8 h-px bg-border" />}
          </div>
        );
      })}
    </div>
  );
}
