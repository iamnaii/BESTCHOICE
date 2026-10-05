import type { ChatWorkItem, ChatWorkPage, WorkQueueView } from '@installment/shared';
import { Clock3, CalendarDays, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
const labels: Record<WorkQueueView, string> = { WAITING: 'รอตอบ', UNASSIGNED: 'ยังไม่มีผู้ดูแล', TODAY: 'วันนี้', OVERDUE: 'เกินกำหนด', FOR_ME: 'ถึงฉัน' };
export function workDate(value: string) { return new Intl.DateTimeFormat('th-TH', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(new Date(value)); }
export default function WorkQueue({ data, view, loading, error, onView, onOpen, onRetry, onPage }: {
  data?: ChatWorkPage; view: WorkQueueView; loading?: boolean; error?: boolean;
  onView: (view: WorkQueueView) => void; onOpen: (item: ChatWorkItem) => void; onRetry: () => void; onPage: (page: number) => void;
}) {
  return <section aria-label="รายการคิวงาน" className="flex min-h-0 flex-1 flex-col">
    <div className="grid grid-cols-2 gap-2 border-b p-4 sm:grid-cols-3">
      {(Object.keys(labels) as WorkQueueView[]).map(v => <Button key={v} variant={v === view ? 'primary' : 'outline'} className="h-11 justify-between gap-2" aria-pressed={v === view} onClick={() => onView(v)}>
        <span>{labels[v]}</span><span className="tabular-nums">{error || !data ? '—' : data.counts[v]}</span>
      </Button>)}
    </div>
    <p className="px-4 py-3 text-xs leading-snug text-muted-foreground">เปิดอ่านแล้วก็ยังรอตอบ จนกว่าพนักงานส่งคำตอบสำเร็จ • เวลาประเทศไทย</p>
    <div className="min-h-0 flex-1 overflow-y-auto px-4" aria-busy={loading}>
      {error ? <div role="alert" className="rounded-lg border p-4"><p>โหลดคิวงานไม่ได้</p><Button variant="outline" className="mt-3" onClick={onRetry}>ลองใหม่</Button></div>
      : loading ? <p role="status" className="py-6 text-muted-foreground">กำลังโหลดคิวงาน…</p>
      : data?.data.length === 0 ? <p className="py-8 text-center text-muted-foreground">ไม่มีงานในมุมมองนี้</p>
      : <ul className="divide-y">{data?.data.map(item => <li key={item.key}><button type="button" className="flex min-h-20 w-full items-center gap-3 rounded-md py-4 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring" onClick={() => onOpen(item)}>
        {item.kind === 'ROOM_WAIT' ? <Clock3 className="size-5 shrink-0 text-primary" /> : <CalendarDays className="size-5 shrink-0 text-primary" />}
        <span className="min-w-0 flex-1"><span className="block break-words font-medium leading-snug">{item.title}</span><span className="mt-1 block text-xs text-muted-foreground">{item.waitingSince ? `รอตั้งแต่ ${workDate(item.waitingSince)}` : item.dueAt ? `กำหนด ${workDate(item.dueAt)}` : 'ยังไม่กำหนดเวลา'}</span></span><ChevronRight className="size-4 shrink-0" />
      </button></li>)}</ul>}
    </div>
    {!!data && !error && data.total > data.limit && <div className="flex items-center justify-between border-t p-4"><Button variant="outline" disabled={data.page === 1} onClick={() => onPage(data.page - 1)}>ก่อนหน้า</Button><span className="text-sm">หน้า {data.page} / {Math.ceil(data.total / data.limit)}</span><Button variant="outline" disabled={data.page * data.limit >= data.total} onClick={() => onPage(data.page + 1)}>ถัดไป</Button></div>}
  </section>;
}
