import type { ProductUnit } from '@/types/product';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-2 border-b border-border last:border-0 text-sm leading-snug">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-foreground text-right font-medium">{value}</span>
    </div>
  );
}

export function SpecTable({
  unit,
  storage,
  isNew,
}: {
  unit: ProductUnit;
  storage?: string;
  isNew: boolean;
}) {
  const accessories = [unit.hasBox && 'กล่อง'].filter(Boolean) as string[];

  const rows: Array<{ label: string; value: string } | null> = [
    storage ? { label: 'ความจุ', value: storage } : null,
    unit.color ? { label: 'สี', value: unit.color } : null,
    !isNew && unit.batteryHealth != null
      ? { label: 'สุขภาพแบตเตอรี่', value: `${unit.batteryHealth}%` }
      : null,
    accessories.length ? { label: 'อุปกรณ์ในกล่อง', value: accessories.join(' · ') } : null,
    unit.shopWarrantyDays != null
      ? { label: 'ประกันร้าน', value: `${unit.shopWarrantyDays} วัน` }
      : null,
    unit.imeiPartial ? { label: 'IMEI', value: unit.imeiPartial } : null,
  ];
  const visible = rows.filter((r): r is { label: string; value: string } => r !== null);
  if (visible.length === 0) return null;

  return (
    <div className="rounded-2xl border border-border p-4 md:p-5">
      <h2 className="font-semibold text-base mb-1 leading-snug">รายละเอียดเครื่อง</h2>
      <div>
        {visible.map((r) => (
          <Row key={r.label} label={r.label} value={r.value} />
        ))}
      </div>
    </div>
  );
}
