import ChatServiceRequestCard from './ChatServiceRequestCard';
import FacebookCommentPanel from './FacebookCommentPanel';
import FacebookCommentList from './FacebookCommentList';
import ChatFollowUpDialog, { type FollowUpDraft } from './ChatFollowUpDialog';
import ChatHandoffCard from './ChatHandoffCard';
import { createPortal } from 'react-dom';
import { useContext } from 'react';
import { useTheme } from 'next-themes';
import { InboxNavigationContext } from '@/components/layout/InboxNavigationContext';
import { useRef, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import type { ChatWorkTarget, WorkQueueView } from '@installment/shared';
import { BarChart3, Bell, ListTodo, Inbox, Globe, Moon, Sun } from 'lucide-react';
import { toast } from 'sonner';
import { getCompanyScopeRevision } from '@/lib/company-scope';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import WorkQueue, { workDate } from './WorkQueue';
import StaffWorkInbox from './StaffWorkInbox';
import { useChatWork } from '../hooks/useChatWork';
export default function InboxWorkTools({
  onSelectRoom,
  branchName,
}: {
  onSelectRoom: (roomId: string) => void;
  branchName?: string;
}) {
  const navigation = useContext(InboxNavigationContext);
  const { resolvedTheme, setTheme } = useTheme();
  const [view, setView] = useState<WorkQueueView>('WAITING');
  const [page, setPage] = useState(1);
  const [panel, setPanel] = useState<'queue' | 'inbox' | 'comments' | null>(null);
  const [selected, setSelected] = useState<{
    type: ChatWorkTarget;
    id: string;
    scope: string;
  } | null>(null);
  const [editingTask, setEditingTask] = useState<{
    roomId: string;
    task: FollowUpDraft;
    scope: string;
  } | null>(null);
  const [opening, setOpening] = useState(false);
  const work = useChatWork(view, page);
  const [params] = useSearchParams();
  const active = selected?.scope === work.identity ? selected : null;
  const targetQuery = useQuery({
    queryKey: [...work.key, 'target', active?.type, active?.id],
    queryFn: () => work.getTarget(active!.type, active!.id),
    enabled: !!active,
    retry: false,
    refetchInterval: 15_000,
  });
  const target = targetQuery.isError ? null : targetQuery.data;
  useEffect(() => {
    setPanel(null);
    setSelected(null);
    setEditingTask(null);
    setPage(1);
  }, [work.identity]);
  const scopeRef = useRef(work.identity);
  scopeRef.current = work.identity;
  const open = async (type: ChatWorkTarget, id: string, notificationId?: string) => {
    if (opening) return;
    const scope = work.identity;
    const revision = getCompanyScopeRevision();
    setOpening(true);
    try {
      const result = await work.getTarget(type, id);
      if (scopeRef.current !== scope || getCompanyScopeRevision() !== revision) return;
      if (notificationId) await work.markRead(notificationId);
      if (scopeRef.current !== scope || getCompanyScopeRevision() !== revision) return;
      if (result.roomId) onSelectRoom(result.roomId);
      setPanel(null);
      if (type !== 'ROOM') setSelected({ type, id, scope });
    } catch {
      toast.error('เปิดรายการไม่ได้ รายการอาจถูกลบหรือคุณไม่มีสิทธิ์แล้ว');
    } finally {
      setOpening(false);
    }
  };
  const linkedId =
    params.get('serviceRequestId') ??
    params.get('commentId') ??
    params.get('noteId') ??
    params.get('todoId');
  const linkedType = params.get('serviceRequestId')
    ? 'SERVICE_REQUEST'
    : params.get('commentId')
      ? 'FACEBOOK_COMMENT'
      : params.get('noteId')
        ? 'NOTE'
        : 'TODO';
  const flags = work.settings.data?.flags;
  const linkEnabled =
    linkedType === 'FACEBOOK_COMMENT'
      ? work.company === 'SHOP' && !!flags?.chat_facebook_comments_enabled
      : linkedType === 'SERVICE_REQUEST'
        ? !!flags?.chat_service_requests_enabled
        : linkedType === 'NOTE'
          ? !!flags?.chat_mentions_enabled
          : !!(
              flags?.chat_follow_up_enabled ||
              flags?.chat_mentions_enabled ||
              flags?.chat_service_requests_enabled ||
              work.enabled
            );
  const openedLink = useRef('');
  useEffect(() => {
    const link = `${work.identity}:${linkedType}:${linkedId}`;
    if (
      !linkEnabled ||
      !linkedId ||
      openedLink.current === link ||
      !/^[0-9a-f-]{36}$/i.test(linkedId)
    )
      return;
    openedLink.current = link;
    void open(linkedType, linkedId);
    // Exact-resource access is checked before selecting the room.
  }, [linkedId, linkedType, linkEnabled, work.identity]);
  const workNavigation = <nav aria-label="การสื่อสารและงานทีม" className="inbox-work-navigation">
    <p className="inbox-navigation-label">การสื่อสารและงานทีม</p>
    <Button variant="ghost" aria-current={!panel ? 'page' : undefined} className={!panel ? 'inbox-navigation-active' : ''} onClick={() => setPanel(null)}><Inbox className="size-4" /><span>แชทลูกค้า</span></Button>
    <Button variant="ghost" disabled={!work.enabled} title={!work.enabled ? 'คิวงานยังไม่เปิดใช้งาน' : undefined} onClick={() => setPanel('queue')}><ListTodo className="size-4" /><span>คิวงาน</span></Button>
    {work.company === 'SHOP' && <Button variant="ghost" disabled={!flags?.chat_facebook_comments_enabled} title={!flags?.chat_facebook_comments_enabled ? 'คอมเมนต์ยังไม่เปิดใช้งาน' : undefined} onClick={() => setPanel('comments')}><Globe className="size-4" /><span>คอมเมนต์</span></Button>}
    <Button asChild variant="ghost"><Link to={`/chat-analytics?zone=${work.company === 'SHOP' ? 'shop' : 'fin'}`} aria-label="ภาพรวมงานแชท"><BarChart3 className="size-4" /><span>ภาพรวมทีม</span></Link></Button>
  </nav>;
  if (work.settings.isError)
    return (
      <div className="flex items-center gap-3 border-b px-4 py-2 text-xs" role="alert">
        โหลดเมนูคิวงานไม่ได้
        <Button variant="ghost" size="sm" onClick={() => work.settings.refetch()}>
          ลองใหม่
        </Button>
      </div>
    );
  return (
    <>
      <header className="inbox-workspace-header">
        <div className="min-w-0">
          <p className="text-xs leading-snug text-muted-foreground">{work.company === 'SHOP' ? 'งานหน้าร้าน' : 'งานการเงิน'}{branchName ? ` / ${branchName}` : ''}</p>
          <h1 className="mt-1 text-xl font-semibold leading-snug">แชทลูกค้า</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="icon" aria-label="สลับธีม" onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>
            {resolvedTheme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
          <Button variant="outline" size="icon" aria-label={`การแจ้งเตือนงาน ${work.inbox.data?.unreadCount ?? 'กำลังโหลด'}`} onClick={() => setPanel('inbox')} className="relative">
            <Bell className="size-4" />
            {!!work.inbox.data?.unreadCount && <span className="absolute -right-1 -top-1 rounded-full bg-primary px-1.5 text-[10px] tabular-nums text-primary-foreground">{work.inbox.data.unreadCount > 99 ? '99+' : work.inbox.data.unreadCount}</span>}
          </Button>
        </div>
      </header>
      {navigation?.host ? createPortal(workNavigation, navigation.host) : <div className="inbox-mobile-work-navigation">{workNavigation}</div>}
      <Sheet open={!!panel} onOpenChange={(o) => !o && setPanel(null)}>
        <SheetContent
          side="left"
          className="flex w-full max-w-full flex-col gap-0 p-0 sm:max-w-lg"
          aria-busy={opening}
        >
          <div className="border-b px-4 py-5 pr-12">
            <SheetTitle>
              {panel === 'queue'
                ? 'คิวงานแชท'
                : panel === 'comments'
                  ? 'คอมเมนต์ Facebook'
                  : 'การแจ้งเตือนของฉัน'}
            </SheetTitle>
            <SheetDescription>
              {work.company === 'SHOP' ? 'งานหน้าร้าน' : 'งานการเงิน'}
            </SheetDescription>
          </div>
          {panel === 'comments' ? (
            <FacebookCommentList
              key={work.identity}
              onOpen={(id) => void open('FACEBOOK_COMMENT', id)}
            />
          ) : panel === 'queue' ? (
            <WorkQueue
              data={work.queue.data}
              loading={work.queue.isLoading}
              error={work.queue.isError}
              view={view}
              onView={(v) => {
                setView(v);
                setPage(1);
              }}
              onPage={setPage}
              onRetry={() => work.queue.refetch()}
              onOpen={(item) => void open(item.targetType, item.targetId)}
            />
          ) : (
            <StaffWorkInbox
              items={work.inbox.data?.data}
              total={work.inbox.data?.total}
              loading={work.inbox.isLoading}
              error={work.inbox.isError}
              onRetry={() => work.inbox.refetch()}
              onOpen={(item) => void open(item.targetType, item.targetId, item.id)}
            />
          )}
        </SheetContent>
      </Sheet>
      <Dialog open={!!active} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogTitle>{target?.title ?? 'รายละเอียดรายการ'}</DialogTitle>
          <DialogDescription>
            {active?.type === 'FACEBOOK_COMMENT'
              ? 'จัดการคำถามใต้โพสต์ Facebook'
              : active?.type === 'NOTE'
                ? 'โน้ตภายในห้องแชทนี้'
                : 'รายละเอียดงานในห้องแชทนี้'}
          </DialogDescription>
          {targetQuery.isError ? (
            <p role="alert">เปิดรายการไม่ได้ รายการอาจถูกลบหรือคุณไม่มีสิทธิ์แล้ว</p>
          ) : !target ? (
            <p role="status">กำลังโหลด…</p>
          ) : active?.type === 'FACEBOOK_COMMENT' ? (
            <FacebookCommentPanel
              key={`${work.identity}:${target.targetId}`}
              threadId={target.targetId}
            />
          ) : target.targetType === 'SERVICE_REQUEST' ? (
            <ChatServiceRequestCard
              key={`${work.identity}:${target.targetId}`}
              requestId={target.targetId}
            />
          ) : target.workKind === 'CHAT_HANDOFF' ? (
            <ChatHandoffCard key={`${work.identity}:${target.targetId}`} taskId={target.targetId} />
          ) : (
            <>
              <p className="whitespace-pre-wrap break-words text-sm leading-snug">
                {target.content || 'ไม่มีรายละเอียดเพิ่มเติม'}
              </p>
              {target.dueAt && <p className="text-sm">กำหนด {workDate(target.dueAt)}</p>}
              {target.status && (
                <p className="text-sm">
                  สถานะ{' '}
                  {(
                    {
                      TODO: 'รอดำเนินการ',
                      DOING: 'กำลังทำ',
                      REVIEW: 'รอตรวจ',
                      DONE: 'เสร็จแล้ว',
                      CANCELLED: 'ยกเลิก',
                    } as Record<string, string>
                  )[target.status] ?? target.status}
                </p>
              )}
              {target.workKind === 'CHAT_FOLLOW_UP' && target.roomId && (
                <Button
                  onClick={() => {
                    setEditingTask({
                      scope: work.identity,
                      roomId: target.roomId!,
                      task: {
                        id: target.targetId,
                        title: target.title,
                        dueDate: target.dueAt,
                        assigneeId: target.assigneeId,
                        status: target.status as FollowUpDraft['status'],
                        revision: target.revision!,
                      },
                    });
                    setSelected(null);
                  }}
                >
                  แก้ไขนัดติดตาม
                </Button>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
      {editingTask?.scope === work.identity && (
        <ChatFollowUpDialog
          roomId={editingTask.roomId}
          editing={editingTask.task}
          open
          onOpenChange={(o) => !o && setEditingTask(null)}
        />
      )}
    </>
  );
}
