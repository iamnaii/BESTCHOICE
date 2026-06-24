import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { DateRangeChips } from '@/components/ui/DateRangeChips';

interface PaymentPeriodBarProps {
  startDate: string; // YYYY-MM-DD or ''
  endDate: string; // YYYY-MM-DD or ''
  onChange: (next: { startDate: string; endDate: string }) => void;
}

/**
 * Period selector above the payment queue. Reuses the app-wide `DateRangeChips`
 * (ทั้งหมด / เดือนนี้ / เดือนที่แล้ว / ช่วงวันที่...) so the formatted label +
 * preset behaviour match the rest of the system. The custom from–to inputs are
 * always rendered (พ.ศ. calendar via ThaiDateInput) so the "ช่วงวันที่..." chip
 * can focus the start field — the chip queries `data-date-range-custom-start`.
 */
export default function PaymentPeriodBar({ startDate, endDate, onChange }: PaymentPeriodBarProps) {
  return (
    <div className="bg-card rounded-xl border border-border/50 p-4 mb-5 shadow-sm space-y-3">
      <DateRangeChips startDate={startDate} endDate={endDate} onChange={onChange} />

      <div className="flex flex-wrap items-center gap-2 border-t border-border/40 pt-3">
        <span className="text-xs font-medium text-muted-foreground">กำหนดช่วงเอง :</span>
        <ThaiDateInput
          data-date-range-custom-start="true"
          value={startDate}
          max={endDate || undefined}
          onChange={(e) => onChange({ startDate: e.target.value, endDate })}
          className="px-3 py-2 border border-input rounded-lg text-sm bg-background outline-hidden focus:ring-2 focus:ring-ring/30"
          placeholder="วันที่เริ่ม"
        />
        <span className="text-xs text-muted-foreground">ถึง</span>
        <ThaiDateInput
          value={endDate}
          min={startDate || undefined}
          onChange={(e) => onChange({ startDate, endDate: e.target.value })}
          className="px-3 py-2 border border-input rounded-lg text-sm bg-background outline-hidden focus:ring-2 focus:ring-ring/30"
          placeholder="วันที่สิ้นสุด"
        />
      </div>
    </div>
  );
}
