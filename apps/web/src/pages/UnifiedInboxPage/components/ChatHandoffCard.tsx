import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import type { Todo, TodoComment } from '@/pages/TodosPage/types';
import type { ChatHandoffAction } from '@installment/shared';
import { useChatWorkSettings } from '../hooks/useChatWork';
import { workDate } from './WorkQueue';
export default function ChatHandoffCard({ taskId }: { taskId: string }) {
  const { user } = useAuth();
  const work = useChatWorkSettings();
  const client = useQueryClient();
  const [result, setResult] = useState('');
  const [failure, setFailure] = useState('');
  const [conflict, setConflict] = useState(false);
  const task = useQuery({
    queryKey: [...work.key, 'handoff', taskId],
    queryFn: () => api.get<Todo>(`/todos/${taskId}`, { params: work.scope }).then((r) => r.data),
    refetchInterval: 30_000,
  });
  const comments = useQuery({
    queryKey: [...work.key, 'handoff', taskId, 'comments'],
    queryFn: () =>
      api
        .get<TodoComment[]>(`/todos/${taskId}/comments`, { params: work.scope })
        .then((r) => r.data),
    enabled: !!task.data && !task.isError,
  });
  const change = useMutation({
    mutationFn: (action: ChatHandoffAction) =>
      api.patch(
        `/staff-chat/handoffs/${taskId}`,
        {
          expectedRevision: task.data!.revision,
          action,
          ...(action === 'COMPLETE' ? { completionNote: result } : {}),
        },
        { params: work.scope },
      ),
    onSuccess: () => {
      setFailure('');
      setResult('');
      void client.invalidateQueries({ queryKey: ['chat-work'] });
      void client.invalidateQueries({ queryKey: ['todos'] });
    },
    onError: (e) => {
      const stale = (e as { response?: { status?: number } }).response?.status === 409;
      setConflict(stale);
      setFailure(
        stale
          ? 'สถานะงานเปลี่ยนไป ฉบับร่างยังอยู่ กรุณาโหลดสถานะล่าสุดก่อนดำเนินการ'
          : getErrorMessage(e),
      );
    },
  });
  if (task.isError)
    return (
      <div role="alert" className="space-y-2 text-sm">
        <p>เปิดงานไม่ได้ งานอาจถูกลบหรือคุณไม่มีสิทธิ์แล้ว</p>
        <Button variant="outline" onClick={() => task.refetch()}>
          ลองใหม่
        </Button>
      </div>
    );
  if (!task.data)
    return (
      <p role="status" className="text-sm">
        กำลังโหลดงาน…
      </p>
    );
  const data = task.data;
  if (data.workKind !== 'CHAT_HANDOFF') return <p role="alert">รายการนี้ไม่ใช่งานที่ฝาก</p>;
  const active = ['TODO', 'DOING'].includes(data.status);
  const mine = data.assigneeId === user?.id;
  const cancel =
    active &&
    (data.createdById === user?.id ||
      ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER'].includes(user?.role ?? ''));
  return (
    <section aria-label="รายละเอียดงานที่ฝาก" className="min-w-0 space-y-3 text-sm leading-snug">
      <p className="break-words font-semibold">{data.title}</p>
      <p>ผู้รับงาน: {data.assignee?.nickname || data.assignee?.name || 'ไม่พบผู้รับ'}</p>
      <p>ผู้ฝาก: {data.createdBy?.nickname || data.createdBy?.name || 'ไม่ระบุ'}</p>
      <p>
        สถานะ:{' '}
        {
          {
            TODO: 'รอรับงาน',
            DOING: 'กำลังทำ',
            DONE: 'เสร็จแล้ว',
            CANCELLED: 'ยกเลิก',
            REVIEW: 'รอตรวจ',
          }[data.status]
        }
      </p>
      {data.dueDate && <p>กำหนด {workDate(data.dueDate)}</p>}
      {data.description && <p className="whitespace-pre-wrap break-words">{data.description}</p>}
      <p className="text-xs text-muted-foreground">
        การรับงานนี้ไม่เปลี่ยนผู้ดูแลแชทหรือเจ้าของยอดขาย
      </p>
      {mine && data.status === 'DOING' && (
        <label className="block">
          ผลการทำงาน
          <textarea
            value={result}
            maxLength={2000}
            onChange={(e) => setResult(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-md border border-input bg-background p-2"
          />
        </label>
      )}
      {failure && (
        <div role="alert" className="space-y-2 text-destructive">
          <p>{failure}</p>
          {conflict && (
            <Button
              variant="outline"
              disabled={task.isFetching}
              onClick={async () => {
                const updated = await task.refetch();
                if (!updated.isError) {
                  setConflict(false);
                  setFailure('');
                }
              }}
            >
              โหลดสถานะล่าสุด
            </Button>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {mine && data.status === 'TODO' && (
          <Button disabled={change.isPending || conflict} onClick={() => change.mutate('ACCEPT')}>
            รับงาน
          </Button>
        )}
        {mine && data.status === 'DOING' && (
          <Button disabled={change.isPending || conflict} onClick={() => change.mutate('COMPLETE')}>
            จบงาน
          </Button>
        )}
        {cancel && (
          <Button
            variant="outline"
            disabled={change.isPending || conflict}
            onClick={() => change.mutate('CANCEL')}
          >
            ยกเลิกงาน
          </Button>
        )}
      </div>
      {!!comments.data?.length && (
        <div className="space-y-2 border-t pt-3">
          <p className="font-medium">บันทึกการทำงาน</p>
          {comments.data.map((c) => (
            <div key={c.id}>
              <p className="whitespace-pre-wrap break-words">{c.content}</p>
              <p className="text-xs text-muted-foreground">
                {c.user.nickname || c.user.name} · {workDate(c.createdAt)}
              </p>
            </div>
          ))}
        </div>
      )}
      {comments.isError && (
        <p role="alert">
          โหลดบันทึกการทำงานไม่ได้{' '}
          <Button size="sm" variant="ghost" onClick={() => comments.refetch()}>
            ลองใหม่
          </Button>
        </p>
      )}
    </section>
  );
}
