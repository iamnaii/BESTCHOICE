import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useChatWorkSettings } from '../hooks/useChatWork';
import type { CommentThread } from '../hooks/useFacebookComments';
export default function FacebookCommentLink({
  thread,
  onSaved,
}: {
  thread: CommentThread;
  onSaved: () => Promise<unknown>;
}) {
  const { scope, key } = useChatWorkSettings();
  const [search, setSearch] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [selected, setSelected] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const query = useQuery({
    queryKey: [...key, 'comment-link-options', thread.id, submitted],
    queryFn: () =>
      api
        .get<
          {
            id: string;
            displayName: string | null;
            customerId: string;
            channel: string;
            customer: { name: string };
          }[]
        >(`/staff-chat/facebook-comments/${thread.id}/link-options`, {
          params: { ...scope, search: submitted },
        })
        .then((r) => r.data),
    enabled: !!submitted,
    retry: false,
  });
  const save = async (unlink = false) => {
    const chosen = query.isError ? undefined : query.data?.find((r) => r.id === selected);
    if (busy || !reason.trim() || (!unlink && !chosen)) return;
    setBusy(true);
    setError('');
    try {
      await api.patch(
        `/staff-chat/facebook-comments/${thread.id}/link`,
        {
          expectedRevision: thread.revision,
          roomId: unlink ? null : chosen!.id,
          customerId: unlink ? null : chosen!.customerId,
          reason,
        },
        { params: scope },
      );
      await onSaved();
      setReason('');
      setSelected('');
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="rounded-lg border p-3">
      <summary className="min-h-8 cursor-pointer font-medium">
        {thread.customerId
          ? 'ผูกข้อมูลลูกค้าแล้ว · ตรวจหรือเปลี่ยนการผูก'
          : 'ผูกกับลูกค้าและห้องแชท'}
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-muted-foreground">
          ตรวจหลักฐานว่าเป็นคนเดียวกันก่อนผูกข้อมูล ชื่อหรือรูปเหมือนกันยังไม่พอยืนยัน
        </p>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSelected('');
            setSubmitted(search.trim());
          }}
        >
          <Input
            aria-label="ค้นหาลูกค้าหรือชื่อห้อง"
            value={search}
            maxLength={100}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button type="submit" variant="outline" disabled={!search.trim()}>
            ค้นหา
          </Button>
        </form>
        {query.isLoading && <p role="status">กำลังค้นหา…</p>}
        {query.isError ? (
          <p role="alert">ค้นหาไม่ได้ กรุณาลองใหม่</p>
        ) : (
          submitted && (
            <label className="block space-y-1">
              <span>เลือกห้องที่ผูกลูกค้าไว้แล้ว</span>
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                className="h-11 w-full min-w-0 rounded-md border bg-background px-2"
              >
                <option value="">
                  {query.data?.length ? 'เลือกจากผลค้นหา' : 'ไม่พบห้องที่เข้าถึงได้'}
                </option>
                {query.data?.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.customer.name} · {r.displayName} · {r.channel} · {r.id.slice(-6)}
                  </option>
                ))}
              </select>
            </label>
          )
        )}
        <label className="block space-y-1">
          <span>หลักฐานหรือเหตุผลที่ผูกข้อมูล</span>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
        </label>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy || query.isError || !selected || !reason.trim()}
            onClick={() => void save()}
          >
            ยืนยันการผูกข้อมูล
          </Button>
          {thread.customerId && (
            <Button
              variant="outline"
              disabled={busy || !reason.trim()}
              onClick={() => void save(true)}
            >
              ยกเลิกการผูก
            </Button>
          )}
        </div>
      </div>
    </details>
  );
}
