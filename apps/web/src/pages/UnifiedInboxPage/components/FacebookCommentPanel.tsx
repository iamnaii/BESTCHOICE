import FacebookCommentLink from './FacebookCommentLink';
import { useRef, useState } from 'react';
import { ExternalLink, Globe, Loader2 } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useFacebookComments, type CommentReply } from '../hooks/useFacebookComments';
export function canReplyPublic(input: {
  capability: boolean;
  deleted: boolean;
  pending: boolean;
  text: string;
}) {
  return input.capability && !input.deleted && !input.pending && input.text.trim().length > 0;
}
const states = { OPEN: 'รอตอบ', RESPONDED: 'ตอบแล้ว', RESOLVED: 'ปิดงาน' };
const replyStates = {
  PENDING: 'กำลังตรวจผลการส่ง',
  CONFIRMED: 'ส่งสำเร็จ',
  FAILED: 'ส่งไม่สำเร็จ',
  UNKNOWN: 'ยังไม่ทราบผลการส่ง',
};
export default function FacebookCommentPanel({ threadId }: { threadId: string }) {
  const [page, setPage] = useState(1);
  const { query, staff, scope, refresh } = useFacebookComments(threadId, page);
  const [text, setText] = useState('');
  const latestText = useRef(text);
  latestText.current = text;
  const request = useRef<{ text: string; id: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [localAttempt, setLocalAttempt] = useState<Pick<CommentReply, 'id' | 'status'> | null>(
    null,
  );
  const [externalId, setExternalId] = useState('');
  const [reason, setReason] = useState('');
  const row = query.isError ? null : query.data;
  const uncertain =
    row?.unresolvedReply ??
    (localAttempt && ['PENDING', 'UNKNOWN'].includes(localAttempt.status) ? localAttempt : null);
  const act = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const send = () =>
    act(async () => {
      const sentText = text.trim();
      if (!request.current || request.current.text !== sentText)
        request.current = { text: sentText, id: crypto.randomUUID() };
      const result = await api.post<CommentReply>(
        `/staff-chat/facebook-comments/${threadId}/replies`,
        { text: sentText, clientRequestId: request.current.id },
        { params: scope },
      );
      setLocalAttempt(result.data);
      if (result.data.status === 'CONFIRMED') {
        if (latestText.current.trim() === sentText) setText('');
        request.current = null;
      }
      if (result.data.status === 'FAILED') {
        request.current = null;
        setError('ส่งไม่สำเร็จ ตรวจข้อความแล้วกดตอบอีกครั้งได้');
      }
    });
  if (query.isError)
    return (
      <div role="alert" className="space-y-3">
        <p>เปิดคอมเมนต์ไม่ได้ หรือคุณไม่มีสิทธิ์แล้ว</p>
        <Button variant="outline" onClick={() => query.refetch()}>
          ลองใหม่
        </Button>
      </div>
    );
  if (!row) return <p role="status">กำลังโหลดคอมเมนต์…</p>;
  const echoIds = new Set(
    row.replies.filter((r) => r.status === 'CONFIRMED').map((r) => r.externalId),
  );
  return (
    <div className="min-w-0 space-y-4 text-sm leading-snug" aria-busy={busy}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 font-semibold">
          <Globe className="size-4" />
          คอมเมนต์สาธารณะ · {states[row.status]}
        </span>
        <a
          className="inline-flex min-h-11 items-center gap-1 text-primary underline underline-offset-4"
          href={row.permalink}
          target="_blank"
          rel="noopener noreferrer"
        >
          เปิด Meta
          <ExternalLink className="size-4" />
        </a>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 space-y-1">
          <span>ผู้รับผิดชอบคอมเมนต์</span>
          <select
            className="h-11 w-full rounded-md border bg-background px-3"
            value={row.assigneeId ?? ''}
            disabled={busy || staff.isError}
            onChange={(e) =>
              void act(() =>
                api.patch(
                  `/staff-chat/facebook-comments/${threadId}/assign`,
                  { expectedRevision: row.revision, assigneeId: e.target.value || null },
                  { params: scope },
                ),
              )
            }
          >
            <option value="">ยังไม่มีผู้รับผิดชอบ</option>
            {row.assigneeId && !staff.data?.some((s) => s.id === row.assigneeId) && (
              <option value={row.assigneeId}>ผู้รับเดิม · ต้องตรวจสิทธิ์</option>
            )}
            {staff.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.role} · {s.id.slice(-6)}
              </option>
            ))}
          </select>
        </label>
        <Button
          variant="outline"
          className="min-h-11"
          disabled={busy || row.rootDeleted}
          onClick={() =>
            void act(() =>
              api.patch(
                `/staff-chat/facebook-comments/${threadId}/status`,
                {
                  expectedRevision: row.revision,
                  status: row.status === 'RESOLVED' ? 'OPEN' : 'RESOLVED',
                },
                { params: scope },
              ),
            )
          }
        >
          {row.status === 'RESOLVED' ? 'เปิดงานอีกครั้ง' : 'ปิดงาน'}
        </Button>
      </div>
      {staff.isError && (
        <Button variant="outline" onClick={() => staff.refetch()}>
          โหลดผู้รับผิดชอบใหม่
        </Button>
      )}
      {row.rootDeleted && (
        <p role="status" className="rounded-lg bg-muted p-3">
          คอมเมนต์ต้นทางถูกลบแล้ว
        </p>
      )}
      {row.needsReconciliation && (
        <p role="status" className="rounded-lg bg-muted p-3">
          กำลังรอตรวจข้อมูลกับต้นทาง จึงยังตอบจากหน้านี้ไม่ได้
        </p>
      )}
      <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
        {row.records
          .filter((r) => !echoIds.has(r.commentId))
          .map((r) => (
            <article key={r.id} className="min-w-0 rounded-lg border bg-card p-3">
              <p className="mb-1 font-medium">{r.authorName || 'ผู้ใช้ Facebook'}</p>
              <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                {r.deletedAt ? 'คอมเมนต์ถูกลบ' : r.text || 'คอมเมนต์ไม่มีข้อความ'}
              </p>
            </article>
          ))}
        {row.replies.map((r) => (
          <article key={r.id} className="min-w-0 rounded-lg border bg-primary/5 p-3">
            <p className="mb-1 font-medium">
              {r.author?.name || 'พนักงาน'} · {replyStates[r.status]}
            </p>
            <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{r.text}</p>
          </article>
        ))}
      </div>
      {(row.recordsTotal > 50 || row.repliesTotal > 50) && (
        <div className="flex items-center justify-between gap-2">
          <Button variant="outline" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
            ก่อนหน้า
          </Button>
          <span>หน้า {page}</span>
          <Button
            variant="outline"
            disabled={page * 50 >= Math.max(row.recordsTotal, row.repliesTotal)}
            onClick={() => setPage((p) => p + 1)}
          >
            ถัดไป
          </Button>
        </div>
      )}
      {!row.capabilities.publicReply && (
        <p className="rounded-lg bg-muted p-3">
          {row.capabilities.reason || 'ยังไม่ยืนยันสิทธิ์ตอบคอมเมนต์จาก Meta'}
        </p>
      )}
      {uncertain && (
        <section className="space-y-3 rounded-lg border p-3">
          <p role="status" className="font-semibold">
            ยังไม่ทราบผลการส่ง
          </p>
          <p>
            เปิด Meta ตรวจคำตอบที่ส่งไปก่อน ระบุรหัสคำตอบเพื่อให้ระบบตรวจหลักฐานและป้องกันส่งซ้ำ
          </p>
          <label className="block space-y-1">
            <span>รหัสคำตอบบน Meta</span>
            <Input
              value={externalId}
              onChange={(e) => setExternalId(e.target.value)}
              maxLength={256}
            />
          </label>
          <label className="block space-y-1">
            <span>รายละเอียดที่ตรวจพบ</span>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
          </label>
          <Button
            variant="outline"
            disabled={busy || !externalId.trim() || !reason.trim()}
            onClick={() =>
              void act(async () => {
                const result = await api.post<CommentReply>(
                  `/staff-chat/facebook-comments/replies/${uncertain.id}/reconcile`,
                  { externalId, reason },
                  { params: scope },
                );
                setLocalAttempt(result.data);
                if (
                  result.data.status === 'CONFIRMED' &&
                  latestText.current.trim() === result.data.text
                )
                  setText('');
                request.current = null;
              })
            }
          >
            ตรวจหลักฐานการส่ง
          </Button>
        </section>
      )}
      <FacebookCommentLink thread={row} onSaved={refresh} />
      <label className="block space-y-2">
        <span className="font-medium">คำตอบสาธารณะ</span>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={5000}
          className="min-h-28 resize-none"
          placeholder="ทุกคนที่เห็นโพสต์จะเห็นคำตอบนี้"
        />
      </label>
      {error && (
        <div role="alert" className="space-y-2 text-destructive">
          <p>{error}</p>
          <Button variant="outline" onClick={() => query.refetch()}>
            โหลดสถานะล่าสุด
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">ข้อความส่วนตัว: ยังไม่เปิดสิทธิ์จาก Meta</p>
        <Button
          className="min-h-11"
          disabled={
            !canReplyPublic({
              capability: row.capabilities.publicReply,
              deleted: row.rootDeleted || row.needsReconciliation,
              pending: busy || !!uncertain,
              text,
            })
          }
          onClick={() => void send()}
        >
          {busy && <Loader2 className="size-4 animate-spin" />}ตอบสาธารณะ
        </Button>
      </div>
    </div>
  );
}
