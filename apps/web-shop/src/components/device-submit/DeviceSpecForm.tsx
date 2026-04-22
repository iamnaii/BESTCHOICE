import { Input } from '../ui/input';
import { Label } from '../ui/label';

export interface DeviceSpec {
  condition: 'A' | 'B' | 'C';
  batteryHealth: number;
  imei?: string;
  notes?: string;
}

interface Props {
  value: DeviceSpec;
  onChange: (v: DeviceSpec) => void;
}

const CONDITIONS: Array<{ v: 'A' | 'B' | 'C'; label: string; desc: string }> = [
  { v: 'A', label: 'เกรด A', desc: 'เหมือนใหม่ ไม่มีรอย' },
  { v: 'B', label: 'เกรด B', desc: 'มีรอยใช้งานเล็กน้อย' },
  { v: 'C', label: 'เกรด C', desc: 'มีรอยหรือตำหนิชัดเจน' },
];

export default function DeviceSpecForm({ value, onChange }: Props) {
  return (
    <div className="space-y-4 leading-snug">
      <div>
        <Label>สภาพเครื่อง</Label>
        <div className="grid sm:grid-cols-3 gap-2 mt-2">
          {CONDITIONS.map((c) => (
            <button
              key={c.v}
              type="button"
              onClick={() => onChange({ ...value, condition: c.v })}
              className={`rounded-xl border p-3 text-left ${
                value.condition === c.v
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:bg-accent'
              }`}
            >
              <div className="font-semibold">{c.label}</div>
              <div className="text-xs text-muted-foreground">{c.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="batteryHealth">สุขภาพแบตเตอรี่ (%)</Label>
        <Input
          id="batteryHealth"
          type="number"
          min={0}
          max={100}
          value={value.batteryHealth}
          onChange={(e) =>
            onChange({ ...value, batteryHealth: Math.max(0, Math.min(100, Number(e.target.value))) })
          }
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="imei">IMEI (15 หลัก — ถ้ามี)</Label>
        <Input
          id="imei"
          value={value.imei ?? ''}
          onChange={(e) => onChange({ ...value, imei: e.target.value })}
          maxLength={15}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="notes">หมายเหตุเพิ่มเติม</Label>
        <Input
          id="notes"
          value={value.notes ?? ''}
          onChange={(e) => onChange({ ...value, notes: e.target.value })}
          placeholder="เช่น เปลี่ยนแบตแล้ว มีรอยที่ขอบ"
        />
      </div>
    </div>
  );
}
