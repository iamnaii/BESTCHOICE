import { useState } from 'react';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { useUpdateAttendanceSettings, type AttendanceSettings } from '@/hooks/useAttendance';

const CLOCK_RE = /^\d{2}:\d{2}$/;
const fieldClass = 'h-11 lg:h-10 rounded-lg border border-input bg-background px-3 text-sm';

interface Props {
  initial: AttendanceSettings;
}

/** เวลางานค่าระบบ + ตั้งทับรายสาขา (เว้นว่าง = ใช้ค่าระบบ) + ผ่อนผันสาย + อายุเก็บรูปหลักฐาน */
export default function WorkHoursForm({ initial }: Props) {
  const update = useUpdateAttendanceSettings();
  const [workStart, setWorkStart] = useState(initial.workStart);
  const [workEnd, setWorkEnd] = useState(initial.workEnd);
  const [grace, setGrace] = useState(String(initial.lateGraceMinutes));
  const [retention, setRetention] = useState(String(initial.photoRetentionDays));
  const [branches, setBranches] = useState(() => initial.branches.map((b) => ({ ...b, workStart: b.workStart ?? '', workEnd: b.workEnd ?? '' })));

  const graceNum = Number(grace);
  const retentionNum = Number(retention);
  const error =
    !CLOCK_RE.test(workStart) || !CLOCK_RE.test(workEnd) ? 'กรอกเวลาเข้างานและเลิกงานให้ครบ'
    : workEnd <= workStart ? 'เวลาเลิกงานต้องหลังเวลาเข้างาน'
    : !Number.isInteger(graceNum) || graceNum < 0 || graceNum > 120 ? 'ผ่อนผันสายต้องเป็น 0–120 นาที'
    : !Number.isInteger(retentionNum) || retentionNum < 30 || retentionNum > 3650 ? 'อายุเก็บรูปต้องเป็น 30–3650 วัน'
    : branches.some((b) => (b.workStart && !CLOCK_RE.test(b.workStart)) || (b.workEnd && !CLOCK_RE.test(b.workEnd))) ? 'เวลาเฉพาะสาขาต้องเป็น HH:mm หรือเว้นว่าง'
    : null;

  const setBranch = (branchId: string, key: 'workStart' | 'workEnd', value: string) =>
    setBranches((rows) => rows.map((r) => (r.branchId === branchId ? { ...r, [key]: value } : r)));

  const save = () =>
    update.mutate(
      {
        workStart,
        workEnd,
        lateGraceMinutes: graceNum,
        photoRetentionDays: retentionNum,
        branches: branches.map((b) => ({ branchId: b.branchId, workStart: b.workStart || null, workEnd: b.workEnd || null })),
      },
      {
        onSuccess: () => toast.success('บันทึกเวลางานแล้ว — มีผลกับการตอกบัตรครั้งถัดไป'),
        onError: (err: unknown) => toast.error(getErrorMessage(err)),
      },
    );

  return (
    <section aria-labelledby="work-hours-heading" className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-sm">
      <div>
        <h2 id="work-hours-heading" className="text-base font-semibold">เวลางาน</h2>
        <p className="text-xs text-muted-foreground leading-snug">
          ค่าระบบใช้ทุกสาขา ตั้งทับรายสาขาได้ด้านล่าง · OT เริ่มนับเมื่อออกหลังเลิกงานตั้งแต่ 15 นาที (ต่ำกว่า 15 นาทีไม่คิด · 15–44 นาที = 0.5 ชม. · 45–59 นาที = 1 ชม.)
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="wh-start" className="text-sm font-medium">เวลาเข้างาน</label>
          <input id="wh-start" type="time" value={workStart} onChange={(e) => setWorkStart(e.target.value)} className={fieldClass} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="wh-end" className="text-sm font-medium">เวลาเลิกงาน</label>
          <input id="wh-end" type="time" value={workEnd} onChange={(e) => setWorkEnd(e.target.value)} className={fieldClass} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="wh-grace" className="text-sm font-medium">ผ่อนผันสาย (นาที)</label>
          <input id="wh-grace" type="number" inputMode="numeric" min={0} max={120} value={grace} onChange={(e) => setGrace(e.target.value)} className={fieldClass} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="wh-retention" className="text-sm font-medium">เก็บรูปหลักฐาน (วัน)</label>
          <input id="wh-retention" type="number" inputMode="numeric" min={30} max={3650} value={retention} onChange={(e) => setRetention(e.target.value)} className={fieldClass} />
        </div>
      </div>

      {branches.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm" aria-label="เวลางานเฉพาะสาขา">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="py-2 text-left font-medium">สาขา (เว้นว่าง = ใช้ค่าระบบ)</th>
                <th scope="col" className="py-2 text-left font-medium">เข้างาน</th>
                <th scope="col" className="py-2 text-left font-medium">เลิกงาน</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {branches.map((b) => (
                <tr key={b.branchId}>
                  <td className="py-2 pr-3">{b.branchName}</td>
                  <td className="py-2 pr-3">
                    <input type="time" aria-label={`เข้างาน — ${b.branchName}`} value={b.workStart} onChange={(e) => setBranch(b.branchId, 'workStart', e.target.value)} className={fieldClass} />
                  </td>
                  <td className="py-2">
                    <input type="time" aria-label={`เลิกงาน — ${b.branchName}`} value={b.workEnd} onChange={(e) => setBranch(b.branchId, 'workEnd', e.target.value)} className={fieldClass} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3">
        {error && <span role="alert" className="text-sm text-destructive">{error}</span>}
        <Button onClick={save} disabled={!!error || update.isPending} className="max-lg:min-h-11">
          {update.isPending ? 'กำลังบันทึก…' : 'บันทึกเวลางาน'}
        </Button>
      </div>
    </section>
  );
}
