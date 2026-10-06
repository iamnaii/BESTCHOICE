import ChatServiceRequestCard from './ChatServiceRequestCard';
import FacebookCommentPanel from './FacebookCommentPanel';
import FacebookCommentList from './FacebookCommentList';
import ChatFollowUpDialog, { type FollowUpDraft } from './ChatFollowUpDialog';
import ChatHandoffCard from './ChatHandoffCard';
import { useTheme } from 'next-themes';
import { useRef, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { ChatWorkTarget, WorkQueueView } from '@installment/shared';
import {
  ArrowLeft,
  BarChart3,
  Bell,
  CircleDollarSign,
  Globe,
  Inbox,
  ListTodo,
  LockKeyhole,
  LogOut,
  Moon,
  Settings2,
  ShoppingCart,
  Sun,
} from 'lucide-react';
import { toast } from 'sonner';
import { getCompanyScopeRevision, WORK_COMPANY } from '@/lib/company-scope';
import { getWorkZoneHref, getZoneConfigForRole } from '@/config/menu';
import { useIsMobile } from '@/hooks/useIsMobile';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import WorkQueue, { workDate } from './WorkQueue';
import StaffWorkInbox from './StaffWorkInbox';
import ChatWorkSettingsDialog from '../../chat-analytics/ChatWorkSettingsDialog';
import { useAuth } from '@/contexts/AuthContext';
import { useChatWork } from '../hooks/useChatWork';

/** หมวดงานที่สลับได้จากแถบข้างของ inbox — ค่าและป้ายเดียวกับ PillSwitcher/แถบย่อของเมนูระบบ */
const WORK_ZONES = [
  { zone: 'shop', label: 'งานหน้าร้าน (SHOP)', short: 'หน้าร้าน', Icon: ShoppingCart },
  { zone: 'fin', label: 'งานการเงิน (FINANCE)', short: 'การเงิน', Icon: CircleDollarSign },
] as const;

export default function InboxWorkTools({
  onSelectRoom,
  branchName,
}: {
  onSelectRoom: (roomId: string) => void;
  branchName?: string;
}) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  // จอใหญ่ = แถบข้าง 72px (เมนูระบบไม่ถูกวาดบน /inbox — ดู MainLayout) · จอเล็ก = แถบหัวแบบย่อเหมือนเดิม
  const isMobile = useIsMobile();
  const [settingsOpen, setSettingsOpen] = useState(false);
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
    setSettingsOpen(false);
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
  const waitingCount = work.queue.isError ? undefined : work.queue.data?.counts.WAITING;
  const chatActive = !panel || panel === 'inbox';
  // สลับหมวดงานจากในแชทได้ เพราะเมนูระบบ (ที่เคยมีสวิตช์นี้) ไม่ถูกวาดบน /inbox จอใหญ่
  const zoneConfig = getZoneConfigForRole(user?.role ?? '', user?.accessibleCompanies);
  const workZones = WORK_ZONES.filter((z) => zoneConfig?.zones.includes(z.zone));
  const currentZone = work.company === WORK_COMPANY.fin ? 'fin' : 'shop';
  const zoneShort = WORK_ZONES.find((z) => z.zone === currentZone)?.short ?? 'หน้าร้าน';
  const identityLabel = `งาน${zoneShort}${branchName ? ` / ${branchName}` : ''}`;
  const homeLink = (
    <Link to="/" className="inbox-rail-home" aria-label="กลับหน้าหลัก" title="กลับหน้าหลัก">
      <img src="/logo-icon.svg" alt="" />
      <span><ArrowLeft aria-hidden="true" />หน้าหลัก</span>
    </Link>
  );
  const workNavigation = (
    <nav aria-label="การสื่อสารและงานทีม" className="inbox-work-navigation">
      <Button variant="ghost" aria-current={chatActive ? 'page' : undefined}
        className={chatActive ? 'inbox-navigation-active' : ''} onClick={() => setPanel(null)}>
        <Inbox className="size-4" aria-hidden="true" /><span>แชทลูกค้า</span>
      </Button>
      <Button variant="ghost" aria-label="คิวงาน" disabled={!work.enabled}
        aria-description={!work.enabled ? 'คิวงานยังไม่เปิดใช้งาน' :
          work.queue.isError ? 'โหลดจำนวนงานไม่ได้ เปิดคิวงานเพื่อลองใหม่' :
          waitingCount === undefined ? 'กำลังโหลดจำนวนงาน' : `งานรอดำเนินการ ${waitingCount}`}
        title={!work.enabled ? 'คิวงานยังไม่เปิดใช้งาน' : undefined}
        aria-haspopup="dialog" aria-expanded={panel === 'queue'}
        className={panel === 'queue' ? 'inbox-navigation-active' : ''} onClick={() => setPanel('queue')}>
        <ListTodo className="size-4" aria-hidden="true" /><span>คิวงาน</span>
        {!work.enabled ? <LockKeyhole className="inbox-navigation-lock" aria-hidden="true" /> :
          waitingCount !== undefined && waitingCount > 0 && <span className="inbox-navigation-count" aria-hidden="true">{waitingCount > 99 ? '99+' : waitingCount}</span>}
      </Button>
      {work.company === 'SHOP' && (
        <Button variant="ghost" disabled={!flags?.chat_facebook_comments_enabled}
          aria-description={!flags?.chat_facebook_comments_enabled ? 'คอมเมนต์ยังไม่เปิดใช้งาน' : undefined}
          title={!flags?.chat_facebook_comments_enabled ? 'คอมเมนต์ยังไม่เปิดใช้งาน' : undefined}
          aria-haspopup="dialog" aria-expanded={panel === 'comments'}
          className={panel === 'comments' ? 'inbox-navigation-active' : ''} onClick={() => setPanel('comments')}>
          <Globe className="size-4" aria-hidden="true" /><span>คอมเมนต์</span>
          {!flags?.chat_facebook_comments_enabled && <LockKeyhole className="inbox-navigation-lock" aria-hidden="true" />}
        </Button>
      )}
      <Button asChild variant="ghost">
        <Link to={`/chat-analytics?zone=${work.company === 'SHOP' ? 'shop' : 'fin'}`} aria-label="ภาพรวมงานแชท">
          <BarChart3 className="size-4" aria-hidden="true" /><span>ภาพรวมทีม</span>
        </Link>
      </Button>
    </nav>
  );
  const utilities = (
    <div className="inbox-workspace-utilities">
      {user?.role === 'OWNER' && <Button variant="ghost" size="icon" aria-label="ตั้งค่างานแชท" title="ตั้งค่างานแชทและตรวจการเชื่อมต่อ" onClick={() => setSettingsOpen(true)}>
        <Settings2 className="size-4" />
      </Button>}
      <Button variant="ghost" size="icon" aria-label="สลับธีม" title="สลับธีม" onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>
        {resolvedTheme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
      </Button>
      <Button variant="ghost" size="icon" aria-label={`การแจ้งเตือนงาน ${work.inbox.data?.unreadCount ?? 'กำลังโหลด'}`} title="การแจ้งเตือนงาน" onClick={() => setPanel('inbox')} className="relative">
        <Bell className="size-4" />
        {!!work.inbox.data?.unreadCount && <span className="absolute -right-1 -top-1 rounded-full bg-primary px-1.5 text-[10px] tabular-nums text-primary-foreground">{work.inbox.data.unreadCount > 99 ? '99+' : work.inbox.data.unreadCount}</span>}
      </Button>
    </div>
  );
  if (work.settings.isError)
    return isMobile ? (
      <div className="flex items-center gap-3 border-b px-4 py-2 text-xs" role="alert">
        โหลดเมนูคิวงานไม่ได้
        <Button variant="ghost" size="sm" onClick={() => work.settings.refetch()}>
          ลองใหม่
        </Button>
      </div>
    ) : (
      <aside className="inbox-rail" aria-label="ศูนย์การสื่อสาร">
        {homeLink}
        <p className="inbox-rail-alert" role="alert">โหลดเมนูคิวงานไม่ได้</p>
        <Button variant="ghost" size="sm" onClick={() => work.settings.refetch()}>
          ลองใหม่
        </Button>
      </aside>
    );
  /* เจ้าของเคาะ 2026-10-07 (mockup Kv9EZdAFQeoYYGUpkenkda แบบ ค): เข้าแชทบนจอใหญ่แล้ว "ยุบเมนูอื่นออกเลย
     ค่อยกดกลับหน้าหลัก" — แถบข้างนี้คือเมนูเดียวของหน้า: กลับหน้าหลัก · หมวดงาน · เมนูแชท · เครื่องมือ · ออกจากระบบ
     จอเล็กไม่มีที่วางแถบข้าง จึงคงแถบหัวแบบย่อไว้ */
  const rail = (
    <aside className="inbox-rail" aria-label="ศูนย์การสื่อสาร">
      {homeLink}
      <div className="inbox-rail-divider" aria-hidden="true" />
      {workZones.length >= 2 && (
        <div role="tablist" aria-label="หมวดงาน" className="inbox-rail-zones">
          {workZones.map(({ zone, label, Icon }) => (
            <button key={zone} type="button" role="tab" aria-selected={zone === currentZone} aria-label={label} title={label}
              onClick={() => { if (zone !== currentZone) navigate(getWorkZoneHref('/inbox', zone)); }}>
              <Icon aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
      <p className="inbox-rail-zone" title={identityLabel}>{zoneShort}</p>
      <h1 className="sr-only">ศูนย์การสื่อสาร</h1>
      {workNavigation}
      <span className="inbox-rail-spacer" aria-hidden="true" />
      {utilities}
      <div className="inbox-rail-user">
        {user && <div className="inbox-rail-avatar" title={user.name} aria-hidden="true">{user.name?.charAt(0)}</div>}
        <Button variant="ghost" size="icon" aria-label="ออกจากระบบ" title="ออกจากระบบ" onClick={logout}>
          <LogOut className="size-4" />
        </Button>
      </div>
    </aside>
  );
  const header = (
    <header className="inbox-workspace-header">
      <div className="inbox-workspace-identity">
        <p className="text-xs leading-snug text-muted-foreground" title={branchName}>{identityLabel}</p>
        <h1 className="font-semibold leading-snug">ศูนย์การสื่อสาร</h1>
      </div>
      <div className="inbox-header-navigation">{workNavigation}</div>
      {utilities}
    </header>
  );
  return (
    <>
      {isMobile ? header : rail}
      {settingsOpen && user?.role === 'OWNER' && <ChatWorkSettingsDialog key={work.identity} onClose={() => setSettingsOpen(false)} />}
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
