import ChatFollowUpDialog, { type FollowUpDraft } from './ChatFollowUpDialog';
import { useRef, useState, useEffect } from 'react';
import type { ChatWorkTarget, WorkQueueView } from '@installment/shared';
import { Bell, ListTodo } from 'lucide-react';
import { toast } from 'sonner';
import { getCompanyScopeRevision } from '@/lib/company-scope';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import WorkQueue, { workDate } from './WorkQueue';
import StaffWorkInbox from './StaffWorkInbox';
import { useChatWork, type WorkTarget } from '../hooks/useChatWork';
export default function InboxWorkTools({ onSelectRoom }: { onSelectRoom: (roomId: string) => void }) {
  const [view, setView] = useState<WorkQueueView>('WAITING');
  const [page, setPage] = useState(1);
  const [panel, setPanel] = useState<'queue' | 'inbox' | null>(null);
  const [target, setTarget] = useState<WorkTarget | null>(null);
  const [editingTask, setEditingTask] = useState<{ roomId: string; task: FollowUpDraft } | null>(null);
  const [opening, setOpening] = useState(false);
  const work = useChatWork(view, page);
  useEffect(() => { setPanel(null); setTarget(null); setEditingTask(null); setPage(1); }, [work.company]);
  const scopeRef = useRef(work.company); scopeRef.current = work.company;
  const open = async (type: ChatWorkTarget, id: string, notificationId?: string) => {
    if (opening) return;
    const scope = work.company;
    const revision = getCompanyScopeRevision();
    setOpening(true);
    try {
      const result = await work.getTarget(type, id);
      if (scopeRef.current !== scope || getCompanyScopeRevision() !== revision) return;
      if (notificationId) await work.markRead(notificationId);
      if (scopeRef.current !== scope || getCompanyScopeRevision() !== revision) return;
      onSelectRoom(result.roomId); setPanel(null);
      if (type !== 'ROOM') setTarget(result);
    } catch { toast.error('เปิดรายการไม่ได้ รายการอาจถูกลบหรือคุณไม่มีสิทธิ์แล้ว'); }
    finally { setOpening(false); }
  };
  if (work.settings.isError) return <div className="flex items-center gap-3 border-b px-4 py-2 text-xs" role="alert">โหลดเมนูคิวงานไม่ได้<Button variant="ghost" size="sm" onClick={() => work.settings.refetch()}>ลองใหม่</Button></div>;
  if (!work.enabled) return null;
  return <>
    <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b bg-card px-3">
      <Button variant="ghost" size="sm" onClick={() => setPanel('queue')}><ListTodo className="size-4" />คิวงาน</Button>
      <Button variant="outline" size="sm" aria-label={`การแจ้งเตือนงาน ${work.inbox.data?.unreadCount ?? 'กำลังโหลด'}`} onClick={() => setPanel('inbox')}><Bell className="size-4" /><span>แจ้งเตือน</span>{!!work.inbox.data?.unreadCount && <span className="rounded-full bg-primary px-1.5 text-xs tabular-nums text-primary-foreground">{work.inbox.data.unreadCount}</span>}</Button>
    </div>
    <Sheet open={!!panel} onOpenChange={o => !o && setPanel(null)}>
      <SheetContent side="left" className="flex w-full max-w-full flex-col gap-0 p-0 sm:max-w-lg" aria-busy={opening}>
        <div className="border-b px-4 py-5 pr-12"><SheetTitle>{panel === 'queue' ? 'คิวงานแชท' : 'การแจ้งเตือนของฉัน'}</SheetTitle><SheetDescription>{work.company === 'SHOP' ? 'งานหน้าร้าน' : 'งานการเงิน'}</SheetDescription></div>
        {panel === 'queue' ? <WorkQueue data={work.queue.data} loading={work.queue.isLoading} error={work.queue.isError} view={view} onView={v => { setView(v); setPage(1); }} onPage={setPage} onRetry={() => work.queue.refetch()} onOpen={item => void open(item.targetType, item.targetId)} />
          : <StaffWorkInbox items={work.inbox.data?.data} total={work.inbox.data?.total} loading={work.inbox.isLoading} error={work.inbox.isError} onRetry={() => work.inbox.refetch()} onOpen={item => void open(item.targetType, item.targetId, item.id)} />}
      </SheetContent>
    </Sheet>
    <Dialog open={!!target} onOpenChange={o => !o && setTarget(null)}><DialogContent><DialogTitle>{target?.title}</DialogTitle><DialogDescription>{target?.targetType === 'NOTE' ? 'โน้ตภายในห้องแชทนี้' : 'รายละเอียดงานในห้องแชทนี้'}</DialogDescription><p className="whitespace-pre-wrap break-words text-sm leading-snug">{target?.content || 'ไม่มีรายละเอียดเพิ่มเติม'}</p>{target?.dueAt && <p className="text-sm">กำหนด {workDate(target.dueAt)}</p>}{target?.status && <p className="text-sm">สถานะ {({ TODO: 'รอดำเนินการ', DOING: 'กำลังทำ', REVIEW: 'รอตรวจ', DONE: 'เสร็จแล้ว', CANCELLED: 'ยกเลิก' } as Record<string, string>)[target.status] ?? target.status}</p>}{target?.workKind === 'CHAT_FOLLOW_UP' && <Button onClick={() => { setEditingTask({ roomId: target.roomId, task: { id: target.targetId, title: target.title, dueDate: target.dueAt, assigneeId: target.assigneeId, status: target.status as FollowUpDraft['status'], revision: target.revision! } }); setTarget(null); }}>แก้ไขนัดติดตาม</Button>}</DialogContent></Dialog>
    {editingTask && <ChatFollowUpDialog roomId={editingTask.roomId} editing={editingTask.task} open onOpenChange={o => !o && setEditingTask(null)} />}
  </>;
}
