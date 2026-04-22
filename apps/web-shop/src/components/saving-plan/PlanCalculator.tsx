import { useState } from 'react';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

interface Props {
  targetAmount: number;
  onChange: (v: { monthlyAmount: number; durationMonths: number }) => void;
}

export default function PlanCalculator({ targetAmount, onChange }: Props) {
  const [duration, setDuration] = useState(6);
  const monthly = Math.ceil(targetAmount / duration);
  return (
    <div className="space-y-3 leading-snug">
      <div className="space-y-1">
        <Label htmlFor="dur">ออมกี่เดือน</Label>
        <Input
          id="dur"
          type="number"
          min={2}
          max={12}
          value={duration}
          onChange={(e) => {
            const d = Math.min(12, Math.max(2, Number(e.target.value)));
            setDuration(d);
            onChange({ monthlyAmount: Math.ceil(targetAmount / d), durationMonths: d });
          }}
        />
      </div>
      <div className="rounded-xl border border-border p-4">
        <div className="text-sm text-muted-foreground">ออมเดือนละ</div>
        <div className="text-2xl font-bold text-primary">฿{monthly.toLocaleString()}</div>
        <div className="text-xs text-muted-foreground mt-1">
          {duration} เดือน × ฿{monthly.toLocaleString()} = ฿
          {(monthly * duration).toLocaleString()}
        </div>
      </div>
    </div>
  );
}
