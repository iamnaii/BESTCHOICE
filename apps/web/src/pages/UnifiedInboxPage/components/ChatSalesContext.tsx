import SalesDispositionControl from './SalesDispositionControl';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import type { ChatSalesContext as SalesContext } from '@installment/shared';
import { ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { getCompanyScopeRevision } from '@/lib/company-scope';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import JourneyStageStrip from '@/pages/CustomerDetailPage/components/JourneyStageStrip';
import { useChatWorkSettings, type WorkTarget } from '../hooks/useChatWork';
import { workDate } from './WorkQueue';
import { hasAmount, type StatementResult } from './credit-statement';
type Evidence = SalesContext['evidenceLinks'][number];
export function SalesContextView({ context, onEvidence, actions }: { context: SalesContext; actions?: ReactNode; onEvidence: (e: Evidence) => void }) {
  if (!context.journey && !context.evidenceLinks.length) return null;
  return <section className="inbox-dossier-group rounded-lg border border-border bg-card p-3" aria-label="สถานะการขาย">
    <h3 className="text-sm font-semibold leading-snug">สถานะการขาย</h3>
    <p className="mt-1 text-xs text-muted-foreground">ตามข้อมูลที่คุณเข้าถึงได้ในบริษัทนี้</p>
    <p className="mt-1 text-sm font-semibold leading-snug" aria-label="ขั้นการขาย">{context.journey?.stageLabel ?? 'รายการที่เกี่ยวข้องกับห้องนี้'}</p>
    {context.journey && <details className="mt-2 text-xs"><summary className="min-h-11 cursor-pointer py-3 text-primary">ดูเส้นทาง 5 ขั้น</summary><div className="mt-2"><JourneyStageStrip summary={context.journey} customerId={context.customerId ?? ''} canRecord={false} /></div></details>}
    {!!context.evidenceLinks.length && <details className="mt-3 text-xs"><summary className="min-h-11 cursor-pointer py-3 text-muted-foreground">รายการที่เกี่ยวข้อง ({context.evidenceLinks.length})</summary><ul className="mt-2 divide-y">{context.evidenceLinks.map(e => <li key={`${e.kind}:${e.id}`}><button type="button" className="flex min-h-11 w-full items-center justify-between gap-2 py-2 text-left text-primary hover:underline" onClick={() => onEvidence(e)}><span className="min-w-0 break-words leading-snug">{e.label}</span><ChevronRight className="size-3 shrink-0" /></button></li>)}</ul></details>}
    {actions}
  </section>;
}
export default function ChatSalesContext({ roomId }: { roomId: string; }) {
  const { key, settings, scope } = useChatWorkSettings();
  const enabled = !!settings.data?.flags.chat_follow_up_enabled;
  const navigate = useNavigate();
  const [task, setTask] = useState<WorkTarget | null>(null);
  const [credit, setCredit] = useState<{ id: string; createdAt: string; result: StatementResult | null } | null>(null);
  const requestId = useRef(0);
  const currentRoom = useRef(roomId); currentRoom.current = roomId;
  useEffect(() => { setTask(null); setCredit(null); requestId.current++; }, [roomId, scope.company]);
  const query = useQuery({ queryKey: [...key, 'sales-context', roomId], queryFn: () => api.get<SalesContext>(`/staff-chat/rooms/${roomId}/sales-context`, { params: scope }).then(r => r.data), enabled, refetchInterval: 60_000 });
  const openEvidence = async (e: Evidence) => {
    if (e.kind === 'PURCHASE') { navigate(`/sales?saleId=${encodeURIComponent(e.id)}`); return; }
    if (e.kind !== 'APPOINTMENT' && e.kind !== 'CREDIT') return;
    const request = ++requestId.current;
    const revision = getCompanyScopeRevision();
    try {
      if (e.kind === 'CREDIT') {
        const { data } = await api.get<{ id: string; createdAt: string; result: StatementResult | null }>(`/staff-chat/rooms/${roomId}/sales-context/credit/${e.id}`, { params: scope });
        if (currentRoom.current === roomId && getCompanyScopeRevision() === revision && request === requestId.current) setCredit(data);
        return;
      }
      const { data } = await api.get<WorkTarget>(`/staff-chat/work-targets/TODO/${e.id}`, { params: scope });
      if (currentRoom.current === roomId && getCompanyScopeRevision() === revision && request === requestId.current) setTask(data);
    } catch { toast.error('เปิดรายการไม่ได้ รายการอาจถูกลบหรือคุณไม่มีสิทธิ์แล้ว'); }
  };
  if (!enabled) return null;
  if (query.isError) return <div role="alert" className="rounded-lg border p-3 text-sm">โหลดสถานะขายไม่ได้<Button variant="ghost" size="sm" onClick={() => query.refetch()}>ลองใหม่</Button></div>;
  if (!query.data) return <p role="status" className="p-3 text-xs text-muted-foreground">กำลังโหลดสถานะขาย…</p>;
  return <><SalesContextView context={query.data} onEvidence={e => void openEvidence(e)} actions={query.data.journey && <SalesDispositionControl roomId={roomId} journey={query.data.journey} />} />
    <Dialog open={!!task} onOpenChange={o => !o && setTask(null)}><DialogContent><DialogTitle>{task?.title}</DialogTitle><DialogDescription>งานที่ผูกกับห้องแชทนี้</DialogDescription><p className="whitespace-pre-wrap break-words text-sm">{task?.content || 'ไม่มีรายละเอียดเพิ่มเติม'}</p>{task?.dueAt && <p className="text-sm">กำหนด {workDate(task.dueAt)}</p>}</DialogContent></Dialog>
    <Dialog open={!!credit} onOpenChange={o => !o && setCredit(null)}><DialogContent><DialogTitle>ผลตรวจเครดิตจากหลักฐาน</DialogTitle><DialogDescription>{credit && `วิเคราะห์เมื่อ ${workDate(credit.createdAt)} · ผลที่บันทึกไว้ของห้องนี้`}</DialogDescription><dl className="grid grid-cols-2 gap-3 text-sm">{([['monthlyIncome', 'เงินเข้าเฉลี่ยต่อเดือน'], ['monthlyExpense', 'เงินออกเฉลี่ยต่อเดือน'], ['affordablePayment', 'ผ่อนไหวต่อเดือน'], ['averageBalance', 'ยอดคงเหลือเฉลี่ย']] as const).map(([key, label]) => <div key={key}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-medium tabular-nums">{hasAmount(credit?.result?.[key]) ? `${credit.result[key].toLocaleString('th-TH')} บาท` : 'ไม่มีข้อมูล'}</dd></div>)}</dl></DialogContent></Dialog>
  </>;
}
