import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { getCompanyScopeRevision } from '@/lib/company-scope';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useChatWorkSettings } from '../hooks/useChatWork';
import { bangkokInput, bangkokInstant } from './chat-work-time';
import { workDate } from './WorkQueue';
import type { AssigneeRef, TodoStatus } from '@/pages/TodosPage/types';
export interface FollowUpDraft {
  id: string;
  title: string;
  dueDate?: string | null;
  assigneeId?: string | null;
  revision: number;
  status: TodoStatus;
}
const statusLabels: Record<TodoStatus, string> = {
  TODO: 'รอดำเนินการ',
  DOING: 'กำลังทำ',
  REVIEW: 'รอตรวจ',
  DONE: 'เสร็จแล้ว',
  CANCELLED: 'ยกเลิกนัด',
};
export default function ChatFollowUpDialog({
  roomId,
  open,
  onOpenChange,
  editing,
  handoff = false,
}: {
  roomId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: FollowUpDraft;
  handoff?: boolean;
}) {
  const work = useChatWorkSettings();
  const client = useQueryClient();
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [due, setDue] = useState('');
  const [assignee, setAssignee] = useState('');
  const [status, setStatus] = useState<TodoStatus>('TODO');
  const [revision, setRevision] = useState(0);
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState<FollowUpDraft | null>(null);
  const token = useRef('');
  const identity = `${work.company}:${roomId}:${editing?.id ?? 'new'}:${open}`;
  const current = useRef(identity);
  current.current = identity;
  const staff = useQuery({
    queryKey: [...work.key, 'eligible', roomId],
    queryFn: () =>
      api
        .get<AssigneeRef[]>(`/staff-chat/rooms/${roomId}/eligible-staff`, { params: work.scope })
        .then((r) => r.data),
    enabled: open,
  });
  useEffect(() => {
    if (!open) return;
    setTitle(editing?.title ?? '');
    setNote('');
    setDue(bangkokInput(editing?.dueDate));
    setAssignee(editing?.assigneeId ?? '');
    setStatus(editing?.status ?? 'TODO');
    setRevision(editing?.revision ?? 0);
    setConflict(false);
    setLatest(null);
    token.current = crypto.randomUUID();
    // A new form session resets the draft; background refetches must not erase typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);
  const save = useMutation({
    mutationFn: async () => {
      const scopeRevision = getCompanyScopeRevision();
      const body = { title: title.trim(), dueAt: bangkokInstant(due), assigneeId: assignee };
      if (editing)
        await api.patch(
          `/staff-chat/follow-ups/${editing.id}`,
          { ...body, status, expectedRevision: revision },
          { params: work.scope },
        );
      else
        await api.post(
          `/staff-chat/rooms/${roomId}/${handoff ? 'handoffs' : 'follow-ups'}`,
          { ...body, clientRequestId: token.current, ...(handoff ? { note } : {}) },
          { params: work.scope },
        );
      return { identity, scopeRevision };
    },
    onSuccess: (saved) => {
      void client.invalidateQueries({ queryKey: ['chat-work'] });
      void client.invalidateQueries({ queryKey: ['todos'] });
      void client.invalidateQueries({ queryKey: ['chat-rooms'] });
      if (saved.identity !== current.current || saved.scopeRevision !== getCompanyScopeRevision())
        return;
      toast.success(handoff ? 'ส่งงานแล้ว' : 'บันทึกนัดติดตามแล้ว');
      onOpenChange(false);
    },
    onError: (error) => {
      if (identity !== current.current) return;
      if ((error as { response?: { status?: number } }).response?.status === 409) {
        setConflict(true);
        setLatest(null);
      } else toast.error(getErrorMessage(error));
    },
  });
  const refresh = useMutation({
    mutationFn: () =>
      api.get<FollowUpDraft>(`/todos/${editing!.id}`, { params: work.scope }).then((r) => r.data),
    onSuccess: (data) => {
      if (identity === current.current) setLatest(data);
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });
  const field =
    'mt-1 min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogTitle>
          {handoff ? 'ส่งงานให้ทีม' : editing ? 'แก้ไขนัดติดตาม' : 'ตั้งนัดติดตาม'}
        </DialogTitle>
        <DialogDescription>
          {handoff
            ? 'ฝากงานในห้องนี้ ผู้รับงานต้องกดรับเอง ผู้ดูแลแชทและเจ้าของยอดขายคงเดิม'
            : 'กำหนดงานและผู้รับผิดชอบในห้องนี้ เวลาทั้งหมดเป็นเวลาไทย'}
        </DialogDescription>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!conflict && !save.isPending) save.mutate();
          }}
        >
          <label className="block text-sm font-medium">
            {handoff ? 'เรื่องที่ฝาก' : 'เรื่องที่ติดตาม'}
            <input
              className={field}
              required
              maxLength={255}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          {handoff && (
            <label className="block text-sm font-medium">
              รายละเอียดงาน
              <textarea
                className={field}
                rows={3}
                maxLength={5000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          )}
          <label className="block text-sm font-medium">
            วันเวลานัด (เวลาไทย)
            <input
              className={field}
              required
              type="datetime-local"
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </label>
          {due && new Date(`${due}+07:00`).getTime() < Date.now() && (
            <p className="text-sm text-warning-strong">
              นัดนี้เป็นเวลาในอดีต จะแสดงเป็นงานเกินกำหนด
            </p>
          )}
          <label className="block text-sm font-medium">
            ผู้รับผิดชอบงาน
            <select
              className={field}
              required
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
            >
              <option value="">เลือกผู้รับผิดชอบ</option>
              {staff.data?.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.nickname || person.name}
                  {'detail' in person ? ` · ${String(person.detail)}` : ''}
                </option>
              ))}
            </select>
          </label>
          {staff.isError && (
            <div role="alert" className="text-sm text-destructive">
              โหลดผู้รับงานไม่ได้
              <Button type="button" variant="ghost" onClick={() => staff.refetch()}>
                ลองใหม่
              </Button>
            </div>
          )}
          {editing && (
            <label className="block text-sm font-medium">
              สถานะนัด
              <select
                className={field}
                value={status}
                onChange={(e) => setStatus(e.target.value as TodoStatus)}
              >
                {Object.entries(statusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {conflict && (
            <div
              role="alert"
              className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm leading-snug"
            >
              <p>มีคนแก้ไขนัดนี้แล้ว ฉบับร่างของคุณยังอยู่ กรุณาเทียบข้อมูลก่อนบันทึก</p>
              <Button
                type="button"
                variant="outline"
                disabled={refresh.isPending}
                onClick={() => refresh.mutate()}
              >
                โหลดข้อมูลล่าสุดเพื่อเทียบ
              </Button>
              {latest && (
                <>
                  <p className="break-words font-medium">{latest.title}</p>
                  <p>
                    {latest.dueDate ? workDate(latest.dueDate) : 'ไม่มีกำหนดเวลา'} ·{' '}
                    {statusLabels[latest.status]}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setRevision(latest.revision);
                      setConflict(false);
                    }}
                  >
                    ใช้ฉบับร่างนี้กับข้อมูลล่าสุด
                  </Button>
                </>
              )}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              ปิด
            </Button>
            <Button
              type="submit"
              disabled={
                save.isPending ||
                conflict ||
                staff.isLoading ||
                staff.isError ||
                !title.trim() ||
                !due ||
                !assignee
              }
            >
              {handoff ? 'ส่งงาน' : 'บันทึกนัด'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
