import type { ProductUnit } from '@/types/product';
import { copy } from '@/lib/copy';

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
  // accessories มาจาก API แล้ว (รวม 'กล่อง' จาก hasBox ให้เสร็จ) — คง fallback
  // เดิมไว้เผื่อ deploy skew ที่ web ใหม่กว่า api
  const accessories =
    unit.accessories && unit.accessories.length > 0
      ? unit.accessories
      : ([unit.hasBox && 'กล่อง'].filter(Boolean) as string[]);
  const qc = unit.qcChecklist ?? [];
  const qcPassed = qc.filter((q) => q.passed).length;
  const qcFailed = qc.filter((q) => !q.passed);

  const rows: Array<{ label: string; value: string } | null> = [
    storage ? { label: 'ความจุ', value: storage } : null,
    unit.color ? { label: 'สี', value: unit.color } : null,
    !isNew && unit.batteryHealth != null
      ? { label: 'สุขภาพแบตเตอรี่', value: `${unit.batteryHealth}%` }
      : null,
    accessories.length ? { label: copy.product.accessoriesLabel, value: accessories.join(' · ') } : null,
    unit.cosmeticNotes ? { label: copy.product.cosmeticLabel, value: unit.cosmeticNotes } : null,
    unit.shopWarrantyDays != null
      ? { label: 'ประกันร้าน', value: `${unit.shopWarrantyDays} วัน` }
      : null,
    unit.branchName ? { label: copy.product.branchLabel, value: unit.branchName } : null,
    unit.imeiPartial ? { label: 'IMEI', value: unit.imeiPartial } : null,
  ];
  const visible = rows.filter((r): r is { label: string; value: string } => r !== null);
  if (visible.length === 0 && qc.length === 0) return null;

  return (
    <div className="rounded-2xl border border-border p-4 md:p-5">
      <h2 className="font-semibold text-base mb-1 leading-snug">รายละเอียดเครื่อง</h2>
      <div>
        {visible.map((r) => (
          <Row key={r.label} label={r.label} value={r.value} />
        ))}
      </div>

      {qc.length > 0 && (
        <div className="mt-4 pt-3 border-t border-border leading-snug">
          <p className="text-sm font-medium text-foreground">
            {copy.product.qcTitle}{' '}
            <span className="num text-emerald-700">
              {copy.product.qcPassed} {qcPassed}/{qc.length} จุด
            </span>
          </p>
          {qcFailed.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">
              {qcFailed.map((q) => (
                <li key={q.item}>
                  • {q.item} — {copy.product.qcFailed}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
