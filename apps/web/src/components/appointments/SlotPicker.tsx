import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { getErrorMessage } from '@/lib/api';
import type { Branch, Selection, Slot } from './types';
import { thaiTime, visitDay } from './types';
import { appointmentControlClass, appointmentFieldClass } from './field-styles';
export default function SlotPicker({
  branches,
  branchId,
  day,
  selected,
  onChange,
  load,
  queryScope,
}: {
  branches: Branch[];
  branchId: string;
  day: string;
  selected: string;
  onChange: (next: Selection) => void;
  load: (branchId: string, day: string) => Promise<Slot[]>;
  queryScope: string;
}) {
  const query = useQuery({
    queryKey: ['appointments', 'slots', queryScope, branchId, day],
    queryFn: () => load(branchId, day),
    enabled: !!branchId && !!day,
    staleTime: 0,
    refetchInterval: 30_000,
  });
  return (
    <div className="space-y-4">
      <label className={appointmentFieldClass}>
        <span>สาขา</span>
        <NativeSelect
          aria-label="สาขา"
          className={appointmentControlClass}
          disabled={!branches.length}
          value={branchId}
          onChange={(e) => onChange({ branchId: e.target.value, day, startsAt: '' })}
        >
          <option value="" disabled>
            เลือกสาขา
          </option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </NativeSelect>
      </label>
      <label className={appointmentFieldClass}>
        <span>วันที่นัด</span>
        <Input
          aria-label="วันที่นัด"
          className={appointmentControlClass}
          disabled={!branchId}
          type="date"
          min={visitDay()}
          max={visitDay(13)}
          value={day}
          onChange={(e) => onChange({ branchId, day: e.target.value, startsAt: '' })}
        />
      </label>
      <div className="space-y-3">
        <p className="space-y-1 text-sm font-medium">
          <span className="block">เวลาที่สะดวก</span>
          <span className="block text-xs font-normal text-muted-foreground">
            ครั้งละ 45 นาที · คิวสุดท้าย 18:30 น.
          </span>
        </p>
        {!branchId || !day ? (
          <p role="status" className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
            {!branchId ? 'เลือกสาขาเพื่อดูเวลาว่าง' : 'เลือกวันที่เพื่อดูเวลาว่าง'}
          </p>
        ) : query.isLoading ? (
          <p role="status">กำลังตรวจสอบเวลาว่าง…</p>
        ) : query.isError ? (
          <div role="alert" className="space-y-2 text-sm text-destructive">
            <p>{getErrorMessage(query.error)}</p>
            <Button variant="outline" onClick={() => void query.refetch()}>
              ลองใหม่
            </Button>
          </div>
        ) : branchId && query.data?.length === 0 ? (
          <p className="rounded-lg bg-muted p-4 text-sm">
            วันนี้ยังไม่มีเวลาว่าง กรุณาเลือกวันอื่น
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {query.data?.map((slot) => (
              <Button
                key={slot.startsAt}
                variant={selected === slot.startsAt ? 'primary' : 'outline'}
                className="h-12"
                aria-pressed={selected === slot.startsAt}
                disabled={slot.available < 1}
                onClick={() => onChange({ branchId, day, startsAt: slot.startsAt })}
              >
                {thaiTime(slot.startsAt)}
                {slot.available < 1 ? ' · เต็ม' : ''}
              </Button>
            ))}
          </div>
        )}
        {selected &&
          query.data &&
          !query.data.some((s) => s.startsAt === selected && s.available > 0) && (
            <p role="alert" className="text-sm text-destructive">
              เวลาที่เลือกเพิ่งเต็ม กรุณาเลือกเวลาใหม่
            </p>
          )}
      </div>
    </div>
  );
}
