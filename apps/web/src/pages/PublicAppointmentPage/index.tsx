import { useState } from 'react';
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { CalendarDays, Check, Clock, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { appointmentPublicApi as api, getErrorMessage } from '@/lib/api';
import { getAppointmentToken } from '@/lib/appointment-token';
import SlotPicker from '@/components/appointments/SlotPicker';
import {
  Branch,
  Selection,
  Slot,
  Visit,
  thaiDate,
  thaiTime,
  visitDay,
  visitStatus,
} from '@/components/appointments/types';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
interface Context {
  canBook: boolean;
  eligibility: { eligible: boolean; reason: string | null };
  branches: Branch[];
  appointment: Visit | null;
  hasOtherAppointment: boolean;
}
const tokenHeaders = () => ({ headers: { 'X-Appointment-Token': getAppointmentToken() } });
const base = '/store-appointments-public';
function VisitPage() {
  useDocumentTitle('นัดเข้าร้าน · BESTCHOICE');
  const qc = useQueryClient();
  const context = useQuery({
    queryKey: ['visit-context'],
    queryFn: () => api.get<Context>(`${base}/context`, tokenHeaders()).then((r) => r.data),
    retry: false,
    refetchInterval: 30_000,
  });
  const [selection, setSelection] = useState<Selection>({
    branchId: '',
    day: visitDay(),
    startsAt: '',
  });
  const [fresh, setFresh] = useState(false);
  const [editing, setEditing] = useState(false),
    [review, setReview] = useState(false),
    [canceling, setCanceling] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const data = context.data,
    a = data?.appointment;
  const branchId = selection.branchId || data?.branches[0]?.id || '';
  const chosenBranch = data?.branches.find((b) => b.id === branchId);
  const change = (next: Selection) => {
    setSelection(next);
    setReview(false);
    setRequestId(crypto.randomUUID());
  };
  const mutate = useMutation({
    mutationFn: async (action: 'book' | 'cancel') => {
      if (action === 'cancel' && a)
        return api.post<Visit>(
          `${base}/${a.id}/cancel`,
          { version: a.version, requestId },
          tokenHeaders(),
        );
      return api.post<Visit>(
        editing && a ? `${base}/${a.id}/reschedule` : `${base}/book`,
        {
          branchId,
          startsAt: selection.startsAt,
          requestId,
          ...(editing && a ? { version: a.version } : {}),
        },
        tokenHeaders(),
      );
    },
    onSuccess: () => {
      setEditing(false);
      setFresh(false);
      setReview(false);
      setCanceling(false);
      setSelection((s) => ({ ...s, startsAt: '' }));
      setRequestId(crypto.randomUUID());
      void qc.invalidateQueries();
    },
    onError: () => {
      setReview(false);
      void qc.invalidateQueries();
    },
  });
  const canChange = a?.status === 'BOOKED' && new Date(a.startsAt) > new Date();
  return (
    <div className="min-h-screen bg-muted/40 px-4 py-8 text-foreground leading-snug">
      <main className="mx-auto max-w-md rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
        <header className="mb-8 flex items-center gap-3 border-b border-border pb-5">
          <div className="rounded-lg bg-primary p-2 text-primary-foreground">
            <CalendarDays className="size-5" />
          </div>
          <div>
            <p className="font-bold tracking-wide">BESTCHOICE</p>
            <p className="text-xs text-muted-foreground">นัดหมายเข้าร้าน</p>
          </div>
        </header>
        {context.isLoading ? (
          <p role="status">กำลังเปิดข้อมูลนัดหมาย…</p>
        ) : context.isError ? (
          <div role="alert" className="space-y-4">
            <h1 className="text-xl font-semibold">เปิดลิงก์นัดหมายไม่ได้</h1>
            <p className="text-sm text-muted-foreground">
              {getErrorMessage(context.error)} กรุณาเปิดลิงก์ที่ได้รับอีกครั้ง หรือติดต่อสาขา
            </p>
            <Button variant="outline" onClick={() => void context.refetch()}>
              ลองใหม่
            </Button>
          </div>
        ) : (
          data && (
            <>
              {mutate.isError && (
                <p
                  role="alert"
                  className="mb-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
                >
                  {getErrorMessage(mutate.error)}
                </p>
              )}
              {a && !editing && !fresh ? (
                <div className="space-y-5">
                  <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-sm text-primary">
                    <Check className="size-4" />
                    {visitStatus[a.status]}
                  </div>
                  <h1 className="text-2xl font-semibold">
                    {a.status === 'BOOKED' ? 'แล้วพบกันที่ร้านครับ' : 'รายละเอียดนัดหมาย'}
                  </h1>
                  <div className="space-y-4 rounded-xl bg-muted/60 p-5">
                    <p className="text-lg font-semibold">{thaiDate(a.startsAt)}</p>
                    <p className="flex items-center gap-2">
                      <Clock className="size-4" />
                      {thaiTime(a.startsAt)} – {thaiTime(a.endsAt)}
                    </p>
                    <p className="flex items-center gap-2">
                      <MapPin className="size-4" />
                      {a.branch.name}
                    </p>
                    {a.branch.location && (
                      <p className="text-sm text-muted-foreground">{a.branch.location}</p>
                    )}
                    <p className="text-xs text-muted-foreground">เลขนัด {a.reference}</p>
                  </div>
                  {a.branch.location && (
                    <Button asChild variant="outline" className="w-full">
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.branch.location)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        ดูเส้นทางไปร้าน
                      </a>
                    </Button>
                  )}
                  {a.branch.phone && (
                    <a
                      className="block text-center text-sm text-primary underline"
                      href={`tel:${a.branch.phone}`}
                    >
                      โทรติดต่อสาขา {a.branch.phone}
                    </a>
                  )}
                  {canChange && (
                    <div className="flex gap-2">
                      <Button
                        className="flex-1"
                        variant="outline"
                        disabled={mutate.isPending || !data.eligibility.eligible}
                        onClick={() => {
                          setEditing(true);
                          change({
                            branchId: a.branch.id,
                            day: new Date(+new Date(a.startsAt) + 7 * 3600000)
                              .toISOString()
                              .slice(0, 10),
                            startsAt: '',
                          });
                        }}
                      >
                        เลื่อนนัด
                      </Button>
                      <Button
                        className="flex-1"
                        variant="ghost"
                        disabled={mutate.isPending}
                        onClick={() => {
                          setCanceling(true);
                          setRequestId(crypto.randomUUID());
                        }}
                      >
                        ยกเลิกนัด
                      </Button>
                    </div>
                  )}
                  {canceling && (
                    <div role="alert" className="space-y-3 rounded-lg border border-border p-4">
                      <p>ต้องการยกเลิกนัดนี้ใช่ไหมครับ?</p>
                      <div className="flex gap-2">
                        <Button
                          variant="destructive"
                          disabled={mutate.isPending}
                          onClick={() => mutate.mutate('cancel')}
                        >
                          ยืนยันยกเลิกนัด
                        </Button>
                        <Button
                          variant="outline"
                          disabled={mutate.isPending}
                          onClick={() => setCanceling(false)}
                        >
                          เก็บนัดไว้
                        </Button>
                      </div>
                    </div>
                  )}
                  {['CANCELED', 'NO_SHOW', 'COMPLETED'].includes(a.status) &&
                    data.canBook &&
                    data.eligibility.eligible &&
                    !data.hasOtherAppointment && (
                      <Button
                        className="w-full"
                        onClick={() => {
                          setFresh(true);
                          change({ branchId: a.branch.id, day: visitDay(), startsAt: '' });
                        }}
                      >
                        จองนัดใหม่
                      </Button>
                    )}
                  {!data.eligibility.eligible && (
                    <p className="text-sm text-muted-foreground">
                      {data.eligibility.reason} นัดเดิมยังแสดงอยู่ กรุณาติดต่อสาขา
                    </p>
                  )}
                </div>
              ) : !data.eligibility.eligible ||
                (!editing && !data.canBook) ||
                data.hasOtherAppointment ? (
                <div className="space-y-3">
                  <h1 className="text-xl font-semibold">กรุณาติดต่อสาขา</h1>
                  <p>
                    {data.hasOtherAppointment
                      ? 'คุณมีนัดอยู่แล้ว กรุณาขอลิงก์สำหรับนัดเดิมจากพนักงาน'
                      : data.eligibility.reason || 'สิทธิ์จองนัดใหม่หมดอายุแล้ว'}
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  <div>
                    <p className="mb-2 text-sm font-medium text-primary">
                      {editing ? 'เลือกเวลาใหม่' : 'พร้อมนัดเข้าร้าน'}
                    </p>
                    <h1 className="text-2xl font-semibold">
                      {review ? 'ตรวจสอบนัดของคุณ' : 'เลือกเวลาที่สะดวก'}
                      <br />
                      {!review && 'แล้วพบกันที่ร้าน'}
                    </h1>
                    <p className="mt-3 text-sm text-muted-foreground">
                      ผ่านเครดิตเบื้องต้นแล้ว นัดเข้าร้านเพื่อดำเนินการต่อ ใช้เวลาประมาณ 45 นาที
                    </p>
                  </div>
                  {review ? (
                    <div className="space-y-3 rounded-xl bg-muted p-5">
                      <p className="font-medium">{chosenBranch?.name}</p>
                      <p>
                        {thaiDate(selection.day)} · {thaiTime(selection.startsAt)}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        การนัดหมายยังไม่ใช่การอนุมัติสินเชื่อขั้นสุดท้าย
                      </p>
                    </div>
                  ) : (
                    <SlotPicker
                      branches={data.branches}
                      branchId={branchId}
                      day={selection.day}
                      selected={selection.startsAt}
                      onChange={change}
                      queryScope={editing && a ? a.id : 'public-new'}
                      load={(b, d) =>
                        api
                          .get<
                            Slot[]
                          >(`${base}/availability`, { ...tokenHeaders(), params: { branchId: b, day: d, ...(editing && a ? { excludeId: a.id } : {}) } })
                          .then((r) => r.data)
                      }
                    />
                  )}
                  <Button
                    className="h-12 w-full"
                    disabled={!selection.startsAt || mutate.isPending}
                    onClick={() => (review ? mutate.mutate('book') : setReview(true))}
                  >
                    {mutate.isPending
                      ? 'กำลังยืนยัน…'
                      : review
                        ? editing
                          ? 'ยืนยันเลื่อนนัด'
                          : 'ยืนยันนัดหมาย'
                        : 'ตรวจสอบนัดหมาย'}
                  </Button>
                  {(review || editing) && (
                    <Button
                      variant="ghost"
                      className="w-full"
                      disabled={mutate.isPending}
                      onClick={() => (review ? setReview(false) : setEditing(false))}
                    >
                      ย้อนกลับ
                    </Button>
                  )}
                </div>
              )}
              <p className="mt-7 border-t border-border pt-4 text-xs text-muted-foreground">
                ผลเครดิตเป็นการประเมินเบื้องต้น การอนุมัติขั้นสุดท้ายเป็นไปตามการตรวจสอบที่ร้าน
              </p>
            </>
          )
        )}
      </main>
    </div>
  );
}
export default function PublicAppointmentPage() {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  return (
    <QueryClientProvider client={client}>
      <VisitPage />
    </QueryClientProvider>
  );
}
