import ConfirmationMessage from '@/components/appointments/ConfirmationMessage';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import PageHeader from '@/components/ui/PageHeader';
import api, { getErrorMessage } from '@/lib/api';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import CustomerCombobox from '@/pages/BookingsPage/components/CustomerCombobox';
import type { CustomerOption } from '@/pages/BookingsPage/types';
import SlotPicker from '@/components/appointments/SlotPicker';
import {
  appointmentControlClass,
  appointmentFieldClass,
} from '@/components/appointments/field-styles';
import {
  Branch,
  Selection,
  Slot,
  StaffVisit,
  thaiDate,
  thaiTime,
  visitDay,
  visitStatus,
} from '@/components/appointments/types';
import Schedule from './Schedule';
import AppointmentCalendar from './AppointmentCalendar';
interface Options {
  branches: Branch[];
  staff: { id: string; name: string; branchId: string }[];
  canManage: boolean;
}
export default function StoreAppointmentsPage() {
  const [params] = useSearchParams();
  return (
    <AppointmentWorkspace
      key={`${params.get('customerId') || ''}:${params.get('appointmentId') || ''}:${params.get('roomId') || ''}`}
    />
  );
}
function AppointmentWorkspace() {
  useDocumentTitle('นัดเข้าร้าน');
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = params.get('view') || 'appointments';
  const setTab = (view: string) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set('view', view);
      return next;
    });
  // undefined uses the linked customer; null records an explicit clear.
  const [customer, setCustomer] = useState<CustomerOption | null | undefined>(undefined);
  const [localSelection, setSelection] = useState<Selection>({
    branchId: '',
    day: visitDay(),
    startsAt: '',
  });
  const paramDay = params.get('day') || '';
  const validDay =
    /^\d{4}-\d{2}-\d{2}$/.test(paramDay) &&
    Number.isFinite(Date.parse(`${paramDay}T12:00:00+07:00`));
  const selection = {
    ...localSelection,
    branchId: params.get('branchId') || localSelection.branchId,
    day: validDay ? paramDay : localSelection.day,
  };
  const [editing, setEditing] = useState<StaffVisit | null>(null),
    [action, setAction] = useState<{ visit: StaffVisit; kind: 'CANCELED' | 'reassign' } | null>(
      null,
    );
  const [reason, setReason] = useState(''),
    [staffId, setStaffId] = useState(''),
    [link, setLink] = useState<{ id: string; url: string } | null>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const options = useQuery({
    queryKey: ['appointments', 'options'],
    queryFn: () => api.get<Options>('/store-appointments/options').then((r) => r.data),
  });
  const deepCustomer = useQuery({
    queryKey: ['appointments', 'customer', params.get('customerId')],
    queryFn: () =>
      api.get<CustomerOption>(`/customers/${params.get('customerId')}`).then((r) => r.data),
    enabled: !!params.get('customerId'),
  });
  const currentCustomer = customer === undefined ? deepCustomer.data : customer;
  const roomForCustomer = (id: string | undefined) =>
    id && id === params.get('customerId') ? params.get('roomId') || undefined : undefined;
  const branchId = selection.branchId || options.data?.branches[0]?.id || '';
  const selectedId = params.get('appointmentId');
  const detail = useQuery({
    queryKey: ['appointments', 'detail', selectedId],
    queryFn: () => api.get<StaffVisit>(`/store-appointments/${selectedId}`).then((r) => r.data),
    enabled: !!selectedId,
    refetchInterval: 30_000,
  });
  const list = useQuery({
    queryKey: ['appointments', 'list', branchId, selection.day, currentCustomer?.id],
    queryFn: () =>
      api
        .get<
          StaffVisit[]
        >('/store-appointments', { params: { ...(!currentCustomer ? { branchId } : {}), ...(currentCustomer ? { customerId: currentCustomer.id, roomId: roomForCustomer(currentCustomer.id) } : { day: selection.day }) } })
        .then((r) => r.data),
    enabled: !!branchId,
    refetchInterval: 30_000,
  });
  const eligibility = useQuery({
    queryKey: ['appointments', 'eligibility', currentCustomer?.id],
    queryFn: () =>
      api
        .get<{
          eligible: boolean;
          reason: string | null;
        }>(`/store-appointments/eligibility/${currentCustomer?.id}`)
        .then((r) => r.data),
    enabled: !!currentCustomer,
  });
  const linkHistory = useQuery({
    queryKey: ['appointments', 'links', currentCustomer?.id],
    queryFn: () =>
      api
        .get<
          { id: string; createdAt: string; bookingExpiresAt: string; revokedAt: string | null }[]
        >('/store-appointment-links', { params: { customerId: currentCustomer?.id } })
        .then((r) => r.data),
    enabled: !!currentCustomer,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['appointments'] });
    void qc.invalidateQueries({ queryKey: ['chat'] });
    void qc.invalidateQueries({ queryKey: ['due-appointments'] });
  };
  const mutation = useMutation({
    mutationFn: async (input: {
      kind: 'book' | 'status' | 'reassign' | 'link' | 'revoke' | 'retryConfirmation';
      visit?: StaffVisit;
      status?: string;
      linkId?: string;
    }) => {
      if (input.kind === 'retryConfirmation' && input.visit)
        return api.post(`/store-appointments/${input.visit.id}/confirmation/retry`);
      if (input.kind === 'revoke')
        return api.post(`/store-appointment-links/${input.linkId || link?.id}/revoke`);
      if (input.kind === 'link') {
        const r = await api.post<{ id: string; token: string }>('/store-appointment-links', {
          customerId: input.visit?.customer.id || currentCustomer?.id,
          branchIds: [input.visit?.branch.id || branchId],
          appointmentId: input.visit?.id,
          sourceRoomId: roomForCustomer(input.visit?.customer.id || currentCustomer?.id),
        });
        setLink({ id: r.data.id, url: `${window.location.origin}/visit#${r.data.token}` });
        return r;
      }
      if (input.kind === 'status' && input.visit)
        return api.post(`/store-appointments/${input.visit.id}/status`, {
          status: input.status,
          version: input.visit.version,
          requestId,
          reason,
        });
      if (input.kind === 'reassign' && input.visit)
        return api.post(`/store-appointments/${input.visit.id}/reassign`, {
          staffUserId: staffId,
          version: input.visit.version,
          requestId,
          reason,
        });
      return api.post(
        editing ? `/store-appointments/${editing.id}/reschedule` : '/store-appointments',
        {
          branchId,
          startsAt: selection.startsAt,
          requestId,
          ...(editing
            ? { version: editing.version }
            : {
                customerId: currentCustomer?.id,
                sourceRoomId: roomForCustomer(currentCustomer?.id),
              }),
        },
      );
    },
    onSuccess: (_r, input) => {
      if (input.kind !== 'link')
        toast.success(
          input.kind === 'book'
            ? 'ยืนยันนัดแล้ว ตรวจสอบผลการส่งข้อความได้ที่รายการนัด'
            : 'บันทึกแล้ว',
        );
      if (input.kind === 'revoke') setLink(null);
      setEditing(null);
      setAction(null);
      setRequestId(crypto.randomUUID());
      setSelection((s) => ({ ...s, startsAt: '' }));
      refresh();
    },
    onError: (e) => {
      toast.error(getErrorMessage(e));
      refresh();
    },
  });
  const change = (s: Selection) => {
    if (!s.day) return;
    setSelection(s);
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set('branchId', s.branchId || branchId);
        next.set('day', s.day);
        return next;
      },
      { replace: true },
    );
    setRequestId(crypto.randomUUID());
  };
  const rows = list.data || [];
  const displayed =
    detail.data && !rows.some((r) => r.id === detail.data?.id) ? [detail.data, ...rows] : rows;
  return (
    <div className="space-y-5 leading-snug">
      <PageHeader
        title="นัดเข้าร้าน"
        subtitle="ลูกค้าที่ผ่านเครดิตเบื้องต้น · 45 นาทีต่อท่าน ตามจำนวนพนักงานที่ว่าง"
      />
      {options.isError ? (
        <p role="alert">
          {getErrorMessage(options.error)}{' '}
          <Button variant="outline" onClick={() => void options.refetch()}>
            ลองใหม่
          </Button>
        </p>
      ) : options.isLoading ? (
        <p role="status">กำลังโหลด…</p>
      ) : !options.data?.branches.length ? (
        <section
          aria-label="สถานะสาขารับนัด"
          className="space-y-3 rounded-xl border border-border bg-card p-5"
        >
          <h2 className="font-semibold">ยังไม่มีสาขาที่ใช้รับนัดได้</h2>
          <p className="max-w-xl text-sm text-muted-foreground">
            ให้เจ้าของระบบตรวจสอบว่าสาขาเปิดใช้งาน ผูกกับงานหน้าร้าน (SHOP)
            และบัญชีนี้มีสิทธิ์เข้าถึงสาขา แล้วโหลดข้อมูลอีกครั้ง
          </p>
          <Button
            variant="outline"
            className="min-h-11"
            disabled={options.isFetching}
            onClick={() => void options.refetch()}
          >
            {options.isFetching ? 'กำลังโหลดสาขา…' : 'โหลดสาขาอีกครั้ง'}
          </Button>
        </section>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Button
              className="h-11"
              aria-pressed={tab === 'appointments'}
              variant={tab === 'appointments' ? 'primary' : 'outline'}
              onClick={() => setTab('appointments')}
            >
              นัดหมาย
            </Button>
            <Button
              className="h-11"
              aria-pressed={tab === 'calendar'}
              variant={tab === 'calendar' ? 'primary' : 'outline'}
              onClick={() => setTab('calendar')}
            >
              ปฏิทิน
            </Button>
            {options.data?.canManage && (
              <Button
                className="h-11"
                aria-pressed={tab === 'schedule'}
                variant={tab === 'schedule' ? 'primary' : 'outline'}
                onClick={() => setTab('schedule')}
              >
                ตารางพนักงาน
              </Button>
            )}
          </div>
          <div className="grid max-w-xl grid-cols-1 gap-4 sm:grid-cols-2">
            <label className={appointmentFieldClass}>
              <span>สาขาที่ดู</span>
              <NativeSelect
                aria-label="สาขาที่ดู"
                value={branchId}
                onChange={(e) => change({ ...selection, branchId: e.target.value, startsAt: '' })}
                className={appointmentControlClass}
              >
                {options.data?.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className={appointmentFieldClass}>
              <span>วันที่ดู</span>
              <Input
                className={appointmentControlClass}
                aria-label="วันที่ดู"
                type="date"
                value={selection.day}
                onChange={(e) => change({ ...selection, day: e.target.value, startsAt: '' })}
              />
            </label>
          </div>
          {tab === 'calendar' ? (
            <AppointmentCalendar
              branchId={branchId}
              day={selection.day}
              onDay={(day) => change({ ...selection, branchId, day, startsAt: '' })}
            />
          ) : tab === 'schedule' ? (
            <Schedule
              key={branchId + selection.day}
              branchId={branchId}
              day={selection.day}
              staff={options.data?.staff || []}
            />
          ) : (
            <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
              <section
                aria-label="ฟอร์มนัดหมาย"
                className="min-w-0 space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5"
              >
                <h2 className="font-semibold">{editing ? 'เลื่อนนัดหมาย' : 'นัดให้ลูกค้า'}</h2>
                {editing ? (
                  <p>
                    {editing.customer.name}
                    <Button variant="ghost" onClick={() => setEditing(null)}>
                      เลิกแก้ไข
                    </Button>
                  </p>
                ) : (
                  <CustomerCombobox
                    className={appointmentControlClass}
                    value={currentCustomer || null}
                    onChange={(c) => {
                      setCustomer(c);
                      setLink(null);
                    }}
                    canCreate={false}
                  />
                )}
                {deepCustomer.isError && <p role="alert">โหลดลูกค้าไม่ได้</p>}
                {currentCustomer && !eligibility.data?.eligible && (
                  <p className="text-sm text-muted-foreground">
                    {eligibility.isError
                      ? 'ตรวจสอบเครดิตไม่ได้ กรุณาลองใหม่'
                      : eligibility.data?.reason || 'กำลังตรวจสอบผลเครดิต…'}
                  </p>
                )}
                <SlotPicker
                  branches={options.data?.branches || []}
                  branchId={branchId}
                  day={selection.day}
                  selected={selection.startsAt}
                  onChange={change}
                  queryScope={editing?.id || 'staff-new'}
                  load={(b, d) =>
                    api
                      .get<
                        Slot[]
                      >('/store-appointments/availability', { params: { branchId: b, day: d, excludeId: editing?.id } })
                      .then((r) => r.data)
                  }
                />
                <Button
                  className="min-h-11 w-full whitespace-normal"
                  disabled={
                    mutation.isPending ||
                    !selection.startsAt ||
                    (!editing && (!currentCustomer || !eligibility.data?.eligible))
                  }
                  onClick={() => mutation.mutate({ kind: 'book' })}
                >
                  {editing ? 'ยืนยันเลื่อนนัด' : 'ยืนยันนัดหมาย'}
                </Button>
                {!editing && (
                  <Button
                    variant="outline"
                    className="min-h-11 w-full whitespace-normal"
                    disabled={
                      mutation.isPending ||
                      !currentCustomer ||
                      !eligibility.data?.eligible ||
                      !branchId
                    }
                    onClick={() => mutation.mutate({ kind: 'link' })}
                  >
                    สร้างลิงก์ให้ลูกค้าเลือกเวลา
                  </Button>
                )}
                {currentCustomer && (
                  <details className="rounded-lg border border-border p-3 text-sm">
                    <summary className="cursor-pointer">ลิงก์ที่เคยออกให้ลูกค้า</summary>
                    {linkHistory.isError ? (
                      <p role="alert">
                        โหลดลิงก์ไม่ได้{' '}
                        <button className="underline" onClick={() => void linkHistory.refetch()}>
                          ลองใหม่
                        </button>
                      </p>
                    ) : (
                      linkHistory.data?.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between gap-2 border-t border-border py-2"
                        >
                          <span>
                            ออกเมื่อ {thaiDate(item.createdAt)} {thaiTime(item.createdAt)}
                            <br />
                            <span className="text-xs text-muted-foreground">
                              {item.revokedAt
                                ? 'ยกเลิกแล้ว'
                                : `จองใหม่ได้ถึง ${thaiDate(item.bookingExpiresAt)}`}
                            </span>
                          </span>
                          {!item.revokedAt && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={mutation.isPending}
                              onClick={() => mutation.mutate({ kind: 'revoke', linkId: item.id })}
                            >
                              ยกเลิกสิทธิ์ลิงก์
                            </Button>
                          )}
                        </div>
                      ))
                    )}
                  </details>
                )}
                {link && (
                  <div className="space-y-2 rounded-lg bg-muted p-3">
                    <label className={appointmentFieldClass}>
                      <span>ลิงก์เฉพาะลูกค้า</span>
                      <Input
                        className={appointmentControlClass}
                        readOnly
                        value={link.url}
                        aria-label="ลิงก์นัดหมาย"
                      />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          void navigator.clipboard
                            .writeText(link.url)
                            .then(() => toast.success('คัดลอกลิงก์แล้ว'))
                            .catch(() => toast.error('คัดลอกไม่ได้ กรุณาเลือกลิงก์และคัดลอกเอง'))
                        }
                      >
                        คัดลอกลิงก์
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={mutation.isPending}
                        onClick={() => mutation.mutate({ kind: 'revoke' })}
                      >
                        ยกเลิกลิงก์นี้
                      </Button>
                    </div>
                  </div>
                )}
              </section>
              <section className="min-w-0 space-y-3">
                <h2 className="font-semibold">
                  {currentCustomer ? 'นัดของลูกค้า' : 'นัดประจำวัน'}
                </h2>
                {list.isError ? (
                  <p role="alert">
                    {getErrorMessage(list.error)}{' '}
                    <Button variant="outline" onClick={() => void list.refetch()}>
                      ลองใหม่
                    </Button>
                  </p>
                ) : list.isLoading ? (
                  <p role="status">กำลังโหลดนัด…</p>
                ) : displayed.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">
                    ยังไม่มีนัดหมาย
                  </p>
                ) : (
                  displayed.map((a) => (
                    <article
                      key={a.id}
                      className="space-y-3 rounded-xl border border-border bg-card p-4"
                    >
                      <div className="flex flex-wrap justify-between gap-2">
                        <div>
                          <p className="font-semibold">{a.customer.name}</p>
                          <p className="text-sm">
                            {thaiDate(a.startsAt)} · {thaiTime(a.startsAt)}–{thaiTime(a.endsAt)}
                          </p>
                        </div>
                        <span className="text-sm font-medium text-primary">
                          {visitStatus[a.status]}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {a.branch.name} · {a.staff.name} · {a.reference}
                      </p>
                      {a.assignmentIssue && (
                        <p className="text-sm text-destructive">
                          พนักงานไม่พร้อมรับงาน กรุณาจัดคนรับแทน
                        </p>
                      )}
                      {a.creditEligible === false && (
                        <p className="text-sm text-warning-strong">
                          ผลเครดิตล่าสุดต้องตรวจสอบกับลูกค้า
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {a.status === 'BOOKED' && (
                          <Button
                            size="sm"
                            disabled={mutation.isPending}
                            onClick={() =>
                              mutation.mutate({ kind: 'status', visit: a, status: 'CHECKED_IN' })
                            }
                          >
                            ลูกค้ามาถึงแล้ว
                          </Button>
                        )}
                        {a.status === 'CHECKED_IN' && (
                          <Button
                            size="sm"
                            disabled={mutation.isPending || a.assignmentIssue}
                            onClick={() =>
                              mutation.mutate({ kind: 'status', visit: a, status: 'IN_SERVICE' })
                            }
                          >
                            เริ่มบริการ
                          </Button>
                        )}
                        {a.status === 'IN_SERVICE' && (
                          <Button
                            size="sm"
                            disabled={mutation.isPending}
                            onClick={() =>
                              mutation.mutate({ kind: 'status', visit: a, status: 'COMPLETED' })
                            }
                          >
                            เสร็จสิ้น
                          </Button>
                        )}
                        {['BOOKED', 'CHECKED_IN'].includes(a.status) && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditing(a);
                              change({ branchId: a.branch.id, day: visitDay(), startsAt: '' });
                            }}
                          >
                            เลื่อนนัด
                          </Button>
                        )}
                        {['BOOKED', 'CHECKED_IN', 'IN_SERVICE'].includes(a.status) && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={mutation.isPending}
                              onClick={() => {
                                setAction({ visit: a, kind: 'reassign' });
                                setReason('');
                                setStaffId('');
                                setRequestId(crypto.randomUUID());
                              }}
                            >
                              จัดพนักงานใหม่
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={mutation.isPending}
                              onClick={() => mutation.mutate({ kind: 'link', visit: a })}
                            >
                              ลิงก์ดูนัด
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={mutation.isPending}
                              onClick={() => {
                                setAction({ visit: a, kind: 'CANCELED' });
                                setReason('');
                                setRequestId(crypto.randomUUID());
                              }}
                            >
                              ยกเลิกนัด
                            </Button>
                          </>
                        )}
                        {a.status === 'BOOKED' && new Date(a.startsAt) <= new Date() && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={mutation.isPending}
                            onClick={() =>
                              mutation.mutate({ kind: 'status', visit: a, status: 'NO_SHOW' })
                            }
                          >
                            ไม่มาตามนัด
                          </Button>
                        )}
                      </div>
                      <ConfirmationMessage
                        confirmation={a.confirmations?.[0]}
                        retrying={mutation.isPending}
                        onRetry={() => mutation.mutate({ kind: 'retryConfirmation', visit: a })}
                      />
                      {action?.visit.id === a.id && (
                        <div className="space-y-3 rounded-lg bg-muted p-3">
                          {action.kind === 'reassign' && (
                            <label className={appointmentFieldClass}>
                              <span>พนักงานรับแทน</span>
                              <NativeSelect
                                aria-label="พนักงานรับแทน"
                                value={staffId}
                                onChange={(e) => setStaffId(e.target.value)}
                                className={appointmentControlClass}
                              >
                                <option value="">เลือกพนักงาน</option>
                                {options.data?.staff
                                  .filter((s) => s.branchId === a.branch.id && s.id !== a.staff.id)
                                  .map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {s.name}
                                    </option>
                                  ))}
                              </NativeSelect>
                            </label>
                          )}
                          <label className={appointmentFieldClass}>
                            <span>เหตุผล</span>
                            <Input
                              className={appointmentControlClass}
                              value={reason}
                              onChange={(e) => setReason(e.target.value)}
                              maxLength={500}
                            />
                          </label>
                          <div className="flex gap-2">
                            <Button
                              disabled={
                                mutation.isPending || (action.kind === 'reassign' && !staffId)
                              }
                              onClick={() =>
                                mutation.mutate({
                                  kind: action.kind === 'reassign' ? 'reassign' : 'status',
                                  visit: a,
                                  status: 'CANCELED',
                                })
                              }
                            >
                              ยืนยัน{action.kind === 'reassign' ? 'เปลี่ยนพนักงาน' : 'ยกเลิกนัด'}
                            </Button>
                            <Button variant="outline" onClick={() => setAction(null)}>
                              กลับ
                            </Button>
                          </div>
                        </div>
                      )}
                    </article>
                  ))
                )}
              </section>
            </div>
          )}
        </>
      )}
    </div>
  );
}
