import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { STAGE_LABEL } from '@/pages/after-sales/after-sales';
import type { AfterSalesStage } from '@/pages/after-sales/after-sales';
import { useDebounce } from '@/hooks/useDebounce';
import { useChatWorkSettings } from '../hooks/useChatWork';
import { useChatServiceRequest } from '../hooks/useChatServiceRequests';
import { bangkokInput, bangkokInstant } from './chat-work-time';
import { workDate } from './WorkQueue';
const field =
  'mt-1 min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm';
const labels = {
  OPEN: 'รับเรื่องแล้ว',
  WAITING_CUSTOMER: 'รอลูกค้า',
  RESOLVED: 'แก้ปัญหาแล้ว',
  CANCELLED: 'ยกเลิก',
  LINKED: 'เชื่อมเคสแล้ว',
};
export default function ChatServiceRequestCard({ requestId }: { requestId: string }) {
  const work = useChatWorkSettings(),
    client = useQueryClient(),
    request = useChatServiceRequest(requestId);
  const [editing, setEditing] = useState(false),
    [linking, setLinking] = useState(false),
    [due, setDue] = useState(''),
    [assignee, setAssignee] = useState(''),
    [status, setStatus] = useState('OPEN'),
    [reason, setReason] = useState(''),
    [revision, setRevision] = useState(0),
    [failure, setFailure] = useState(''),
    [conflict, setConflict] = useState(false),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [caseId, setCaseId] = useState('');
  const debounced = useDebounce(search);
  const staff = useQuery({
    queryKey: [...work.key, 'eligible', request.data?.roomId],
    queryFn: () =>
      api
        .get<
          { id: string; name: string; detail?: string }[]
        >(`/staff-chat/rooms/${request.data!.roomId}/eligible-staff`, { params: work.scope })
        .then((r) => r.data),
    enabled: editing && !!request.data && !request.isError,
  });
  const cases = useQuery({
    queryKey: [...work.key, 'service-case-options', requestId, debounced, page],
    queryFn: () =>
      api
        .get<{
          data: { id: string; caseNumber: string; deviceImei: string; stage: AfterSalesStage }[];
          total: number;
        }>(`/staff-chat/service-requests/${requestId}/case-options`, { params: { ...work.scope, search: debounced, page, limit: 10 } })
        .then((r) => r.data),
    enabled: linking && !!request.data?.canLinkCase && !request.isError,
  });
  const save = useMutation({
    mutationFn: async (action: 'edit' | 'link') => {
      if (action === 'link')
        return api.post(
          `/staff-chat/service-requests/${requestId}/link-case`,
          { caseId, expectedRevision: revision },
          { params: work.scope },
        );
      return api.patch(
        `/staff-chat/service-requests/${requestId}`,
        {
          expectedRevision: revision,
          ...(request.data?.status === 'LINKED' ? {} : { status, reason: reason || undefined }),
          ...(assignee && assignee !== request.data?.todo.assigneeId
            ? { assigneeId: assignee }
            : {}),
          ...(due && due !== bangkokInput(request.data?.todo.dueDate)
            ? { dueAt: bangkokInstant(due) }
            : {}),
        },
        { params: work.scope },
      );
    },
    onSuccess: () => {
      setEditing(false);
      setLinking(false);
      setFailure('');
      setReason('');
      void client.invalidateQueries({ queryKey: ['chat-work'] });
      void client.invalidateQueries({ queryKey: ['todos'] });
    },
    onError: (e) => {
      const stale = (e as { response?: { status?: number } }).response?.status === 409;
      setConflict(stale);
      setFailure(
        stale ? 'ข้อมูลเปลี่ยนไป ฉบับร่างยังอยู่ กรุณาโหลดสถานะล่าสุด' : getErrorMessage(e),
      );
    },
  });
  if (request.isError)
    return (
      <div role="alert">
        เปิดใบรับเรื่องไม่ได้ หรือคุณไม่มีสิทธิ์แล้ว{' '}
        <Button variant="outline" onClick={() => request.refetch()}>
          ลองใหม่
        </Button>
      </div>
    );
  const row = request.data;
  if (!row) return <p role="status">กำลังโหลดใบรับเรื่อง…</p>;
  const active = ['TODO', 'DOING', 'REVIEW'].includes(row.todo.status);
  return (
    <section
      aria-label="รายละเอียดรับเรื่องหลังการขาย"
      className="min-w-0 space-y-4 text-sm leading-snug"
    >
      <p className="whitespace-pre-wrap break-words font-medium">{row.symptom}</p>
      {row.status === 'LINKED' ? (
        row.linkedCase ? (
          <div className="rounded-lg border p-3">
            <Link
              className="font-semibold text-primary underline"
              to={`/after-sales/${row.linkedCase.id}`}
            >
              {row.linkedCase.caseNumber}
            </Link>
            <p className="mt-1">สถานะเคส: {STAGE_LABEL[row.linkedCase.stage]}</p>
            <p className="text-xs text-muted-foreground">สถานะจากเคสหลังการขาย</p>
          </div>
        ) : (
          <p role="alert">เปิดเคสที่เชื่อมไว้ไม่ได้ หรือไม่มีสิทธิ์</p>
        )
      ) : (
        <p className="rounded-lg bg-warning/10 p-3 text-warning-strong">
          รับเรื่องทางแชทแล้ว ยังไม่ใช่การรับฝากเครื่อง
        </p>
      )}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2">
        <dt>ผู้ติดตาม</dt>
        <dd>{row.todo.assignee?.name || 'ไม่ระบุ'}</dd>
        <dt>นัดติดตาม</dt>
        <dd>{row.todo.dueDate ? workDate(row.todo.dueDate) : 'ยังไม่ตั้งนัด'}</dd>
        <dt>สถานะรับเรื่อง</dt>
        <dd>{labels[row.status]}</dd>
      </dl>
      {!!row.sourceMessages?.length && (
        <div className="space-y-2">
          <p className="font-medium">ข้อความอ้างอิง</p>
          {row.sourceMessages.map((m) => (
            <blockquote
              key={m.id}
              className="whitespace-pre-wrap break-words rounded-md border p-3"
            >
              {m.text || 'ข้อความแนบสื่อ'}
              <span className="mt-1 block text-xs text-muted-foreground">
                {workDate(m.createdAt)}
              </span>
            </blockquote>
          ))}
        </div>
      )}
      {!row.currentCustomerId && active && (
        <p className="text-muted-foreground">ผูกลูกค้าในห้องก่อนเปิดหรือผูกเคสหลังการขาย</p>
      )}
      <div className="flex flex-wrap gap-2">
        {row.canOpenCase && (
          <Button asChild variant="outline">
            <Link to={`/after-sales/new?serviceRequestId=${row.id}&company=${work.company}`}>
              เปิดเคสหลังการขาย
            </Link>
          </Button>
        )}
        {row.canLinkCase && (
          <Button
            variant="outline"
            onClick={() => {
              setLinking(true);
              setEditing(false);
              setRevision(row.revision);
              setFailure('');
              setConflict(false);
            }}
          >
            ผูกเคสเดิม
          </Button>
        )}
        {active && !editing && (
          <Button
            variant="outline"
            onClick={() => {
              setEditing(true);
              setLinking(false);
              setDue(bangkokInput(row.todo.dueDate));
              setAssignee(row.todo.assigneeId || '');
              setStatus(row.status);
              setRevision(row.revision);
              setFailure('');
              setConflict(false);
            }}
          >
            แก้ไขการติดตาม
          </Button>
        )}
      </div>
      {editing && active && (
        <form
          className="space-y-3 rounded-lg border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!conflict && !save.isPending) save.mutate('edit');
          }}
        >
          <label className="block">
            ผู้รับผิดชอบ
            <select
              className={field}
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
            >
              <option value={row.todo.assigneeId || ''}>
                {row.todo.assignee?.name || 'ไม่ระบุ'}
              </option>
              {!staff.isError &&
                staff.data
                  ?.filter((s) => s.id !== row.todo.assigneeId)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} {s.detail}
                    </option>
                  ))}
            </select>
          </label>
          {staff.isError && (
            <p role="alert">
              โหลดผู้รับงานไม่ได้{' '}
              <Button type="button" variant="ghost" onClick={() => staff.refetch()}>
                ลองใหม่
              </Button>
            </p>
          )}
          <label className="block">
            นัดติดตาม (เวลาไทย)
            <input
              type="datetime-local"
              className={field}
              value={due}
              required
              onChange={(e) => setDue(e.target.value)}
            />
          </label>
          {row.status !== 'LINKED' && (
            <>
              <label className="block">
                สถานะรับเรื่อง
                <select
                  className={field}
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  {Object.entries(labels)
                    .filter(([k]) => k !== 'LINKED')
                    .map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                </select>
              </label>
              {['RESOLVED', 'CANCELLED'].includes(status) && (
                <label className="block">
                  เหตุผล
                  <textarea
                    required
                    className={field}
                    value={reason}
                    maxLength={1000}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
              )}
            </>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={
                save.isPending ||
                conflict ||
                !due ||
                (['RESOLVED', 'CANCELLED'].includes(status) && !reason.trim())
              }
            >
              บันทึกการติดตาม
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              ยกเลิก
            </Button>
          </div>
        </form>
      )}
      {linking && row.canLinkCase && (
        <div className="space-y-3 rounded-lg border p-3">
          <label className="block">
            ค้นหาเคสเดิม
            <input
              className={field}
              value={search}
              maxLength={100}
              placeholder="เลขเคส หรือ IMEI"
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
                setCaseId('');
              }}
            />
          </label>
          <p className="text-xs text-muted-foreground">เฉพาะเคสของลูกค้าคนนี้ที่คุณเข้าถึงได้</p>
          {cases.isError ? (
            <p role="alert">
              โหลดเคสไม่ได้{' '}
              <Button variant="ghost" onClick={() => cases.refetch()}>
                ลองใหม่
              </Button>
            </p>
          ) : cases.isPending ? (
            <p role="status">กำลังค้นหา…</p>
          ) : !cases.data?.data.length ? (
            <p>ไม่พบเคสที่ตรงกัน</p>
          ) : (
            cases.data.data.map((c) => (
              <label key={c.id} className="flex min-h-11 items-start gap-3 rounded-md border p-3">
                <input
                  type="radio"
                  name="service-case"
                  checked={caseId === c.id}
                  onChange={() => setCaseId(c.id)}
                />
                <span className="min-w-0 break-words">
                  {c.caseNumber} · {c.deviceImei}
                  <span className="block text-muted-foreground">{STAGE_LABEL[c.stage]}</span>
                </span>
              </label>
            ))
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={page === 1}
              onClick={() => {
                setPage(page - 1);
                setCaseId('');
              }}
            >
              ก่อนหน้า
            </Button>
            <Button
              variant="outline"
              disabled={page * 10 >= (cases.data?.total ?? 0)}
              onClick={() => {
                setPage(page + 1);
                setCaseId('');
              }}
            >
              ถัดไป
            </Button>
          </div>
          <Button
            disabled={!caseId || cases.isError || cases.isFetching || save.isPending || conflict}
            onClick={() => save.mutate('link')}
          >
            ยืนยันผูกเคส
          </Button>
        </div>
      )}
      {failure && (
        <div role="alert" className="space-y-2 text-destructive">
          <p>{failure}</p>
          {conflict && (
            <Button
              variant="outline"
              disabled={request.isFetching}
              onClick={async () => {
                const r = await request.refetch();
                if (!r.isError && r.data) {
                  setRevision(r.data.revision);
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
    </section>
  );
}
