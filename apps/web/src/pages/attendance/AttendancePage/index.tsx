import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock } from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import PageHeader from '@/components/ui/PageHeader';
import { NativeSelect } from '@/components/ui/native-select';
import TodayTab from './components/TodayTab';
import MonthTab from './components/MonthTab';
import ScheduleTab from './components/ScheduleTab';
import CorrectDayDialog, { type CorrectTarget } from './components/CorrectDayDialog';
import { todayBangkok, weekStart } from '../attendance.util';

/**
 * เมนู ลงเวลา (ก้อน 10 D3 · mockup บอร์ด 3–4) — OWNER ทุกสาขา (เลือกสาขา) · ผจก.สาขาเฉพาะสาขาตัวเอง
 * แท็บ: วันนี้ (kpi + รายการ + แก้ไข) · รายเดือน (ตารางคน × วัน + สรุป + Excel) · ตารางหยุด/ลา รายสัปดาห์
 */
type Tab = 'today' | 'month' | 'schedule';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'today', label: 'วันนี้' },
  { id: 'month', label: 'รายเดือน' },
  { id: 'schedule', label: 'ตารางหยุด/ลา' },
];

export default function AttendancePage() {
  useDocumentTitle('ลงเวลา');
  const { user } = useAuth();
  const isOwner = user?.role === 'OWNER';
  const branches = useQuery<{ id: string; name: string }[]>({ queryKey: ['branches'], queryFn: async () => (await api.get('/branches')).data, enabled: isOwner });
  const [branchId, setBranchId] = useState<string>(isOwner ? '' : user?.branchId ?? '');
  const [tab, setTab] = useState<Tab>('today');
  const [date, setDate] = useState('');
  const [month, setMonth] = useState(() => todayBangkok().slice(0, 7));
  const [week, setWeek] = useState(() => weekStart(todayBangkok()));
  const [target, setTarget] = useState<CorrectTarget | null>(null);

  useEffect(() => {
    if (isOwner && !branchId && branches.data?.length) setBranchId(branches.data[0].id);
  }, [isOwner, branchId, branches.data]);

  const branchName = branches.data?.find((b) => b.id === branchId)?.name ?? '';

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="ลงเวลา"
        subtitle="ตอกจากเครื่องประจำสาขาเท่านั้น · สาย/OT นับอัตโนมัติ · เงิน OT คิดที่เงินเดือน"
        icon={<Clock className="size-5" aria-hidden="true" />}
        action={
          isOwner ? (
            <div className="flex items-center gap-2">
              <label htmlFor="att-branch" className="text-sm text-muted-foreground">สาขา</label>
              <NativeSelect id="att-branch" value={branchId} onChange={(e) => setBranchId(e.target.value)} aria-label="สาขา">
                {(branches.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </NativeSelect>
            </div>
          ) : undefined
        }
      />

      <div role="tablist" aria-label="มุมมอง" className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button key={t.id} role="tab" type="button" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={`h-11 lg:h-10 border-b-2 px-3.5 text-sm transition-colors ${tab === t.id ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {!branchId ? (
        <p className="text-sm text-muted-foreground">{isOwner ? 'กำลังโหลดสาขา…' : 'บัญชีนี้ไม่ได้ผูกสาขา — ดูข้อมูลลงเวลาไม่ได้'}</p>
      ) : tab === 'today' ? (
        <TodayTab branchId={branchId} date={date} onDateChange={setDate} actorId={user?.id ?? ''} isOwner={isOwner} onEdit={setTarget} />
      ) : tab === 'month' ? (
        <MonthTab branchId={branchId} branchName={branchName} month={month} onMonthChange={setMonth} />
      ) : (
        <ScheduleTab branchId={branchId} weekStart={week} onWeekChange={setWeek} actorId={user?.id ?? ''} isOwner={isOwner} />
      )}

      <CorrectDayDialog target={target} isOwner={isOwner} onClose={() => setTarget(null)} />
    </div>
  );
}
