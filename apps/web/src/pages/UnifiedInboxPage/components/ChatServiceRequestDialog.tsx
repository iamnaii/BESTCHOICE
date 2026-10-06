import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useDebounce } from '@/hooks/useDebounce';
import { useChatWorkSettings } from '../hooks/useChatWork';
import { bangkokInstant } from './chat-work-time';
const field =
  'mt-1 min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm';
type Choice = { id: string; kind: 'SALE' | 'CONTRACT' | 'MESSAGE'; label: string };
export default function ChatServiceRequestDialog({
  roomId,
  onClose,
  onCreated,
}: {
  roomId: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const work = useChatWorkSettings(),
    client = useQueryClient();
  const [symptom, setSymptom] = useState(''),
    [assignee, setAssignee] = useState(''),
    [due, setDue] = useState(''),
    [kind, setKind] = useState<Choice['kind']>('SALE'),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [purchase, setPurchase] = useState<Choice | null>(null),
    [sources, setSources] = useState<Choice[]>([]),
    [failure, setFailure] = useState('');
  const token = useRef(crypto.randomUUID());
  const debounced = useDebounce(search);
  const staff = useQuery({
    queryKey: [...work.key, 'eligible', roomId],
    queryFn: () =>
      api
        .get<
          { id: string; name: string; detail?: string }[]
        >(`/staff-chat/rooms/${roomId}/eligible-staff`, { params: work.scope })
        .then((r) => r.data),
  });
  const options = useQuery({
    queryKey: [...work.key, 'service-intake-options', roomId, kind, debounced, page],
    queryFn: () =>
      api
        .get<{
          data: Choice[];
          total: number;
        }>(`/staff-chat/rooms/${roomId}/service-intake-options`, { params: { ...work.scope, kind, search: debounced, page, limit: 10 } })
        .then((r) => r.data),
  });
  // Freeze the first submitted payload across uncertain retries; editing explicitly starts a new draft.
  const [submitted, setSubmitted] = useState<Record<string, unknown> | null>(null);
  const create = useMutation({
    mutationFn: async () => {
      const body = submitted ?? {
        clientRequestId: token.current,
        symptom: symptom.trim(),
        assigneeId: assignee,
        dueAt: bangkokInstant(due),
        ...(purchase ? { [purchase.kind === 'SALE' ? 'saleId' : 'contractId']: purchase.id } : {}),
        sourceMessageIds: sources.map((s) => s.id),
      };
      setSubmitted(body);
      return api.post<{ id: string }>(`/staff-chat/rooms/${roomId}/service-requests`, body, {
        params: work.scope,
      });
    },
    onSuccess: (r) => {
      void client.invalidateQueries({ queryKey: ['chat-work'] });
      void client.invalidateQueries({ queryKey: ['todos'] });
      toast.success('รับเรื่องและตั้งนัดติดตามแล้ว');
      onCreated(r.data.id);
    },
    onError: (e) => {
      setFailure(getErrorMessage(e));
      const status = (e as { response?: { status?: number } }).response?.status;
      if (status && status < 500 && status !== 409) {
        setSubmitted(null);
      }
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && !create.isPending && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogTitle>รับเรื่องหลังการขาย</DialogTitle>
        <DialogDescription>บันทึกอาการและคนติดตาม ยังไม่ใช่การรับฝากเครื่อง</DialogDescription>
        <form
          className="min-w-0 space-y-4 text-sm leading-snug"
          onSubmit={(e) => {
            e.preventDefault();
            if (!create.isPending) create.mutate();
          }}
        >
          <fieldset disabled={!!submitted || create.isPending} className="min-w-0 space-y-4">
            <label className="block">
              อาการที่ลูกค้าแจ้ง
              <textarea
                className={field}
                value={symptom}
                required
                minLength={5}
                maxLength={5000}
                rows={3}
                onChange={(e) => setSymptom(e.target.value)}
              />
            </label>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <label className="block min-w-0">
                ผู้รับผิดชอบ
                <select
                  className={field}
                  required
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                >
                  <option value="">เลือกผู้ติดตาม</option>
                  {!staff.isError &&
                    staff.data?.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} {s.detail}
                      </option>
                    ))}
                </select>
              </label>
              <label className="block min-w-0">
                นัดติดตาม (เวลาไทย)
                <input
                  type="datetime-local"
                  className={field}
                  value={due}
                  required
                  onChange={(e) => setDue(e.target.value)}
                />
              </label>
            </div>
            {staff.isError && (
              <p role="alert">
                โหลดผู้รับงานไม่ได้{' '}
                <Button type="button" variant="ghost" onClick={() => staff.refetch()}>
                  ลองใหม่
                </Button>
              </p>
            )}
            <details className="rounded-lg border p-3">
              <summary className="cursor-pointer font-medium">
                เครื่องและข้อความอ้างอิง (เลือกได้)
              </summary>
              <div className="mt-3 space-y-3">
                <p className="text-xs text-muted-foreground">
                  เลือกจากหลักฐานของลูกค้าที่ผูกกับห้องนี้ หากยังไม่ทราบเครื่อง
                  สามารถรับเรื่องก่อนได้
                </p>
                <label className="block">
                  ประเภทข้อมูล
                  <select
                    className={field}
                    value={kind}
                    onChange={(e) => {
                      setKind(e.target.value as Choice['kind']);
                      setPage(1);
                      setSearch('');
                    }}
                  >
                    <option value="SALE">ใบขาย / เครื่อง</option>
                    <option value="CONTRACT">สัญญา / เครื่อง</option>
                    <option value="MESSAGE">ข้อความในแชท</option>
                  </select>
                </label>
                <label className="block">
                  ค้นหาข้อมูลอ้างอิง
                  <input
                    className={field}
                    value={search}
                    maxLength={100}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                    placeholder={kind === 'MESSAGE' ? 'คำในข้อความ' : 'รุ่น, IMEI หรือเลขเอกสาร'}
                  />
                </label>
                {options.isError ? (
                  <p role="alert">
                    โหลดข้อมูลไม่ได้{' '}
                    <Button type="button" variant="ghost" onClick={() => options.refetch()}>
                      ลองใหม่
                    </Button>
                  </p>
                ) : options.isPending ? (
                  <p role="status">กำลังค้นหา…</p>
                ) : options.data?.data.length ? (
                  options.data.data.map((o) => (
                    <label
                      key={o.id}
                      className="flex min-h-11 items-start gap-3 rounded-md border p-3"
                    >
                      <input
                        className="mt-1"
                        type={kind === 'MESSAGE' ? 'checkbox' : 'radio'}
                        name="purchase"
                        checked={
                          kind === 'MESSAGE'
                            ? sources.some((s) => s.id === o.id)
                            : purchase?.id === o.id
                        }
                        disabled={
                          kind === 'MESSAGE' &&
                          sources.length >= 10 &&
                          !sources.some((s) => s.id === o.id)
                        }
                        onChange={() =>
                          kind === 'MESSAGE'
                            ? setSources((s) =>
                                s.some((x) => x.id === o.id)
                                  ? s.filter((x) => x.id !== o.id)
                                  : [...s, o],
                              )
                            : setPurchase(o)
                        }
                      />
                      <span className="min-w-0 whitespace-pre-wrap break-words">{o.label}</span>
                    </label>
                  ))
                ) : (
                  <p className="text-muted-foreground">ไม่พบข้อมูลที่ตรงกัน</p>
                )}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={page === 1}
                    onClick={() => setPage(page - 1)}
                  >
                    ก่อนหน้า
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={page * 10 >= (options.data?.total ?? 0)}
                    onClick={() => setPage(page + 1)}
                  >
                    ถัดไป
                  </Button>
                </div>
              </div>
            </details>
            {purchase && (
              <div className="flex min-w-0 items-start gap-2 rounded-md bg-muted p-3">
                <p className="min-w-0 flex-1 break-words">{purchase.label}</p>
                <Button type="button" size="sm" variant="ghost" onClick={() => setPurchase(null)}>
                  นำออก
                </Button>
              </div>
            )}
            {!!sources.length && (
              <div className="space-y-2">
                <p>ข้อความอ้างอิง {sources.length}/10</p>
                {sources.map((s) => (
                  <div key={s.id} className="flex min-w-0 items-start gap-2 rounded-md border p-2">
                    <p className="min-w-0 flex-1 truncate">{s.label}</p>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setSources((v) => v.filter((x) => x.id !== s.id))}
                    >
                      นำออก
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </fieldset>
          {failure && (
            <p role="alert" className="text-destructive">
              {failure}
              {submitted && ' · กดลองอีกครั้งเพื่อตรวจและใช้คำขอเดิม ไม่สร้างงานซ้ำ'}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" disabled={create.isPending} onClick={onClose}>
              ปิด
            </Button>
            <Button
              disabled={
                create.isPending ||
                (!submitted && (symptom.trim().length < 5 || !assignee || !due || staff.isError))
              }
            >
              {create.isPending
                ? 'กำลังบันทึก…'
                : submitted
                  ? 'ลองคำขอเดิมอีกครั้ง'
                  : 'บันทึกรับเรื่อง'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
