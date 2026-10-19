import { useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Todo } from '@/pages/TodosPage/types';
import { apptState } from './appointment';
import { workDate } from './WorkQueue';

interface Props {
  todos: Todo[];
  loading: boolean;
  error: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onRetry: () => void;
  onLoadMore: () => void;
  onNew: () => void;
  onEdit: (todo: Todo) => void;
}

/** Room follow-ups are internal work; store visits have their own section and scheduler. */
export default function RoomFollowUps({ todos, loading, error, hasMore, loadingMore, onRetry, onLoadMore, onNew, onEdit }: Props) {
  const [expanded, setExpanded] = useState(false);
  const open = todos.filter(t => !['DONE', 'CANCELLED'].includes(t.status) && !['CHAT_HANDOFF', 'CHAT_SERVICE'].includes(t.workKind ?? ''))
    .sort((a, b) => (a.dueDate ?? '9').localeCompare(b.dueDate ?? '9'));
  const rows = expanded ? open : open.slice(0, 3);
  return (
    <section aria-label="งานติดตาม" className="inbox-dossier-group inbox-follow-ups">
      <div className="mb-3">
        <h3 className="text-sm font-semibold leading-snug">งานติดตาม{!loading && !error && !hasMore && open.length > 0 ? ` (${open.length})` : ''}</h3>
      </div>
      {loading && <p role="status" className="text-xs text-muted-foreground">กำลังโหลดงานติดตาม…</p>}
      {error && <div role="alert" className="mb-2 text-xs leading-snug"><p>โหลดงานติดตามไม่สำเร็จ</p><Button variant="ghost" size="sm" onClick={onRetry}>ลองใหม่</Button></div>}
      {!loading && !error && !hasMore && open.length === 0 && <p className="text-xs leading-snug text-muted-foreground">ยังไม่มีงานติดตาม</p>}
      <ul className="m-0 list-none space-y-2 p-0">
        {rows.map(t => {
          const state = apptState(t.dueDate);
          const label = state?.urgent ? state.label : t.status === 'REVIEW' ? 'รอตรวจ' : t.status === 'DOING' ? 'กำลังทำ' : state?.label ?? 'ยังไม่กำหนดเวลา';
          return <li key={t.id} className="rounded-lg bg-muted/50 p-3">
            <p className="inbox-follow-up-title text-sm font-semibold leading-snug">{t.title}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs leading-snug">
              <span className="tabular-nums text-muted-foreground">{t.dueDate ? workDate(t.dueDate) : 'ไม่ระบุวัน'}</span>
              <span className={cn('rounded px-2 py-1 font-medium', state?.tone === 'danger' ? 'bg-destructive/10 text-destructive' : state?.tone === 'warn' ? 'bg-warning/10 text-warning-strong' : 'bg-muted text-muted-foreground')}>{label}</span>
            </div>
            <p className="mt-1 break-words text-xs leading-snug text-muted-foreground">ผู้ดูแล: {t.assignee?.name ?? 'ยังไม่มอบหมาย'}</p>
            <Button variant="ghost" size="sm" className="mt-1 text-primary" onClick={() => onEdit(t)}>ดู / แก้ไขนัด</Button>
          </li>;
        })}
      </ul>
      <Button variant="outline" className="mt-3 w-full text-primary" onClick={onNew}><CalendarPlus aria-hidden="true" className="size-4" />ตั้งนัดติดตาม</Button>
      {open.length > 3 && <Button variant="ghost" className="w-full" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'ย่อรายการ' : `ดูอีก ${open.length - 3} งาน`}</Button>}
      {hasMore && <Button variant="outline" className="mt-2 w-full" disabled={loadingMore} onClick={() => { setExpanded(true); onLoadMore(); }}>{loadingMore ? 'กำลังโหลด…' : 'โหลดงานในห้องเพิ่มเติม'}</Button>}
    </section>
  );
}
