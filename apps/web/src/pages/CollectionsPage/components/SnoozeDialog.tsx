import { useState } from 'react';
import { Moon, Clock, Sunrise, CalendarDays, CalendarClock } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useSnoozeContract, type SnoozeDuration } from '../hooks/useSnooze';

interface Props {
  open: boolean;
  onClose: () => void;
  contract: {
    id: string;
    contractNumber: string;
    customer: { name: string };
  } | null;
}

interface PresetOption {
  key: Exclude<SnoozeDuration, 'custom'>;
  label: string;
  hint: string;
  icon: typeof Clock;
}

const PRESETS: PresetOption[] = [
  { key: '1h', label: '1 ชั่วโมง', hint: 'ลูกค้ากำลังขับรถ / ติดประชุม', icon: Clock },
  { key: '2h', label: '2 ชั่วโมง', hint: 'ออกธุระระยะสั้น', icon: Clock },
  {
    key: 'tomorrow_9am',
    label: 'พรุ่งนี้ 09:00',
    hint: 'รอเปิดเช้าวันถัดไป',
    icon: Sunrise,
  },
  {
    key: 'next_week',
    label: 'สัปดาห์หน้า',
    hint: '7 วันจากตอนนี้',
    icon: CalendarDays,
  },
];

/**
 * Format a Date as the value expected by `<input type="datetime-local">`
 * (YYYY-MM-DDTHH:mm) using the user's local timezone.
 */
function toLocalDatetimeValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * SnoozeDialog — pick a duration to hide a contract card from the queue.
 *
 * UX:
 *  - 4 preset buttons (1h / 2h / tomorrow 09:00 / next week) — one-click
 *    snooze for the common cases.
 *  - "กำหนดเอง" toggle reveals a `<input type="datetime-local">` for custom
 *    snoozes. The control's `min` is "now + 5min" so users can't pick the
 *    past in the picker UI; the BE re-validates anyway.
 *  - Optional reason note (max 200 chars) — shown to the OWNER who can audit
 *    snooze patterns per collector.
 */
export default function SnoozeDialog({ open, onClose, contract }: Props) {
  const [reason, setReason] = useState('');
  const [customMode, setCustomMode] = useState(false);
  const [customValue, setCustomValue] = useState('');
  const snooze = useSnoozeContract();

  const minDatetime = toLocalDatetimeValue(new Date(Date.now() + 5 * 60 * 1000));

  function reset() {
    setReason('');
    setCustomMode(false);
    setCustomValue('');
  }

  function handleClose() {
    if (snooze.isPending) return;
    reset();
    onClose();
  }

  function handlePreset(key: Exclude<SnoozeDuration, 'custom'>) {
    if (!contract || snooze.isPending) return;
    snooze.mutate(
      {
        contractId: contract.id,
        payload: { duration: key, reason: reason.trim() || undefined },
      },
      {
        onSuccess: () => {
          reset();
          onClose();
        },
      },
    );
  }

  function handleCustomSubmit() {
    if (!contract || !customValue || snooze.isPending) return;
    // datetime-local has no timezone — interpret as local then ship as ISO.
    const iso = new Date(customValue).toISOString();
    snooze.mutate(
      {
        contractId: contract.id,
        payload: {
          duration: 'custom',
          snoozedUntil: iso,
          reason: reason.trim() || undefined,
        },
      },
      {
        onSuccess: () => {
          reset();
          onClose();
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Moon className="size-4 text-muted-foreground" /> Snooze จน...
          </DialogTitle>
          {contract && (
            <DialogDescription className="leading-snug">
              {contract.contractNumber} · {contract.customer.name}
            </DialogDescription>
          )}
        </DialogHeader>

        {!customMode ? (
          <div className="grid gap-2">
            {PRESETS.map((p) => {
              const Icon = p.icon;
              return (
                <button
                  key={p.key}
                  onClick={() => handlePreset(p.key)}
                  disabled={snooze.isPending}
                  className="group flex items-center gap-3 rounded-lg border border-input bg-background p-3 text-left hover:border-primary/40 hover:bg-accent disabled:opacity-50 transition-colors"
                >
                  <div className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                    <Icon className="size-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium leading-snug">{p.label}</div>
                    <div className="text-2xs text-muted-foreground leading-snug">
                      {p.hint}
                    </div>
                  </div>
                </button>
              );
            })}
            <button
              onClick={() => setCustomMode(true)}
              disabled={snooze.isPending}
              className="flex items-center gap-3 rounded-lg border border-dashed border-input bg-background p-3 text-left hover:border-primary/40 hover:bg-accent disabled:opacity-50 transition-colors"
            >
              <div className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <CalendarClock className="size-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium leading-snug">กำหนดเอง...</div>
                <div className="text-2xs text-muted-foreground leading-snug">
                  เลือกวัน-เวลา
                </div>
              </div>
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="snooze-custom">วัน-เวลาที่ปลุก</Label>
              <Input
                id="snooze-custom"
                type="datetime-local"
                value={customValue}
                min={minDatetime}
                onChange={(e) => setCustomValue(e.target.value)}
              />
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="snooze-reason">เหตุผล (ไม่บังคับ)</Label>
          <Input
            id="snooze-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="เช่น รอลูกค้าโทรกลับ"
            maxLength={200}
          />
        </div>

        <DialogFooter>
          {customMode && (
            <Button
              variant="outline"
              onClick={() => setCustomMode(false)}
              disabled={snooze.isPending}
            >
              กลับ
            </Button>
          )}
          <Button variant="outline" onClick={handleClose} disabled={snooze.isPending}>
            ยกเลิก
          </Button>
          {customMode && (
            <Button
              onClick={handleCustomSubmit}
              disabled={!customValue || snooze.isPending}
            >
              Snooze
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
