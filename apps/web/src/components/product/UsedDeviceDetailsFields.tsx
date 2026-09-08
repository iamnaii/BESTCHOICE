import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { cn } from '@/lib/utils';

export interface UsedDeviceDetails {
  batteryHealth: string;
  warrantyExpired: boolean;
  warrantyExpireDate: string;
  hasBox: boolean;
}

const fieldCls =
  'w-full min-h-11 px-3 border border-input rounded-lg bg-card text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden';
const labelCls = 'block h-[18px] leading-[18px] whitespace-nowrap text-[13px] text-muted-foreground mb-2';
const segBtn = 'min-h-11 px-4 rounded-md text-sm font-medium transition-colors';

/** The same device metadata used during PO receiving and subsequent product preparation. */
export default function UsedDeviceDetailsFields({ value, onChange, idPrefix, showRequired = false }: {
  value: UsedDeviceDetails;
  onChange: (patch: Partial<UsedDeviceDetails>) => void;
  idPrefix: string;
  showRequired?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-[100px_auto_minmax(0,1fr)_auto] sm:items-end">
      <div>
        <label htmlFor={`battery-${idPrefix}`} className={labelCls}>
          % แบตเตอรี่
          {showRequired && <span className="text-destructive"> *</span>}
        </label>
        <input
          id={`battery-${idPrefix}`}
          type="number"
          inputMode="numeric"
          min={0}
          max={100}
          value={value.batteryHealth}
          onChange={(e) => onChange({ batteryHealth: e.target.value })}
          placeholder="เช่น 89"
          className={cn(fieldCls, 'font-mono')}
        />
      </div>
      <div>
        <div className={labelCls}>กล่อง</div>
        <div className="inline-flex h-11 gap-0.5 rounded-lg bg-muted p-0.5">
          <button
            type="button"
            aria-pressed={value.hasBox}
            onClick={() => onChange({ hasBox: true })}
            className={cn(segBtn, 'min-h-0 px-3', value.hasBox ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')}
          >
            มีกล่อง
          </button>
          <button
            type="button"
            aria-pressed={!value.hasBox}
            onClick={() => onChange({ hasBox: false })}
            className={cn(segBtn, 'min-h-0 px-3', !value.hasBox ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')}
          >
            ไม่มีกล่อง
          </button>
        </div>
      </div>
      <div className="min-w-0">
        <div className={labelCls}>
          ประกันศูนย์ถึง
          {!value.warrantyExpired && showRequired && <span className="text-destructive"> *</span>}
        </div>
        <ThaiDateInput
          value={value.warrantyExpireDate}
          onChange={(e) => onChange({ warrantyExpireDate: e.target.value })}
          disabled={value.warrantyExpired}
          aria-label="ประกันศูนย์ถึง"
          className={cn(fieldCls, 'min-w-0')}
        />
      </div>
      <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-[13px] whitespace-nowrap text-muted-foreground">
        <input
          type="checkbox"
          checked={value.warrantyExpired}
          onChange={(e) => onChange({ warrantyExpired: e.target.checked })}
          className="size-[18px] rounded"
        />
        หมดประกันแล้ว
      </label>
    </div>
  );
}
