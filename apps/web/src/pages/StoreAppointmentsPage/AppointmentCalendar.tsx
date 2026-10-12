import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import api, { getErrorMessage } from '@/lib/api';
import {
  StaffVisit,
  thaiDate,
  thaiTime,
  visitDay,
  visitStatus,
} from '@/components/appointments/types';
interface DaySummary {
  day: string;
  customers: number;
  appointments: number;
  booked: number;
  checkedIn: number;
  inService: number;
  completed: number;
  canceled: number;
  noShow: number;
}
interface MonthSummary {
  month: string;
  customers: number;
  appointments: number;
  days: DaySummary[];
}
export function monthCells(month: string): (string | null)[] {
  const first = new Date(`${month}-01T12:00:00Z`);
  const next = new Date(first);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const count = Math.round((+next - +first) / 86400000);
  const offset = first.getUTCDay();
  return Array.from({ length: Math.ceil((offset + count) / 7) * 7 }, (_, i) =>
    i < offset || i >= offset + count
      ? null
      : `${month}-${String(i - offset + 1).padStart(2, '0')}`,
  );
}
export default function AppointmentCalendar({
  branchId,
  day,
  onDay,
}: {
  branchId: string;
  day: string;
  onDay: (day: string) => void;
}) {
  const month = day.slice(0, 7);
  const [pagination, setPagination] = useState({ key: '', page: 1 });
  const key = `${branchId}:${day}`;
  const page = pagination.key === key ? pagination.page : 1;
  const summary = useQuery({
    queryKey: ['appointments', 'calendar', branchId, month],
    queryFn: () =>
      api
        .get<MonthSummary>('/store-appointments/calendar', { params: { branchId, month } })
        .then((r) => r.data),
    enabled: !!branchId,
    refetchInterval: 30_000,
  });
  const details = useQuery({
    queryKey: ['appointments', 'calendar-day', branchId, day, page],
    queryFn: () =>
      api
        .get<{
          rows: StaffVisit[];
          total: number;
          pageSize: number;
        }>('/store-appointments/calendar/day', { params: { branchId, day, page } })
        .then((r) => r.data),
    enabled: !!branchId,
    refetchInterval: 30_000,
  });
  const days = new Map(summary.data?.days.map((item) => [item.day, item]));
  const selected = days.get(day);
  const shift = (offset: number) => {
    const date = new Date(`${month}-01T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + offset);
    onDay(date.toISOString().slice(0, 10));
  };
  const monthLabel = new Date(`${month}-01T12:00:00+07:00`).toLocaleDateString('th-TH', {
    timeZone: 'Asia/Bangkok',
    month: 'long',
    year: 'numeric',
  });
  return (
    <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,1fr)]">
      <section
        className="min-w-0 rounded-xl border border-border bg-card p-3 sm:p-5"
        aria-label="ปฏิทินนัดเข้าร้าน"
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <CalendarDays aria-hidden="true" className="size-5 text-primary" />
            {monthLabel}
          </h2>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              className="size-11 p-0"
              aria-label="เดือนก่อนหน้า"
              onClick={() => shift(-1)}
            >
              <ChevronLeft aria-hidden="true" className="size-4" />
            </Button>
            <Button variant="outline" className="h-11" onClick={() => onDay(visitDay())}>
              วันนี้
            </Button>
            <Button
              variant="outline"
              className="size-11 p-0"
              aria-label="เดือนถัดไป"
              onClick={() => shift(1)}
            >
              <ChevronRight aria-hidden="true" className="size-4" />
            </Button>
          </div>
        </div>
        {summary.isLoading ? (
          <p role="status" className="py-12 text-center">
            กำลังโหลดปฏิทิน…
          </p>
        ) : summary.isError ? (
          <div role="alert" className="space-y-3 py-8">
            <p>{getErrorMessage(summary.error)}</p>
            <Button variant="outline" onClick={() => void summary.refetch()}>
              ลองโหลดปฏิทินอีกครั้ง
            </Button>
          </div>
        ) : (
          <>
            <p className="mb-4 text-sm text-muted-foreground" role="status" aria-atomic="true">
              เดือนนี้ {summary.data?.customers || 0} คน · {summary.data?.appointments || 0} นัด
            </p>
            <table
              className="w-full table-fixed border-separate border-spacing-0.5"
              aria-label={`ปฏิทิน ${monthLabel}`}
            >
              <thead>
                <tr>
                  {['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'].map((label) => (
                    <th
                      key={label}
                      scope="col"
                      className="pb-2 text-center text-xs font-medium text-muted-foreground"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: monthCells(month).length / 7 }, (_, week) => (
                  <tr key={week}>
                    {monthCells(month)
                      .slice(week * 7, week * 7 + 7)
                      .map((cell, i) => (
                        <td key={cell || i} className="align-top">
                          {cell && (
                            <button
                              aria-pressed={cell === day}
                              aria-label={`${thaiDate(cell)}: ${days.get(cell)?.customers || 0} คน, ${days.get(cell)?.appointments || 0} นัด`}
                              onClick={() => onDay(cell)}
                              className={`flex min-h-20 w-full flex-col items-center justify-center gap-2 rounded-lg border px-0.5 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:items-start sm:px-3 ${cell === day ? 'border-primary bg-primary text-primary-foreground' : cell === visitDay() ? 'border-primary bg-primary/5 text-foreground' : 'border-border bg-background hover:bg-muted'}`}
                            >
                              <span className="font-medium tabular-nums">
                                {Number(cell.slice(-2))}
                              </span>
                              <span className="whitespace-nowrap text-[11px] sm:text-sm">
                                {days.get(cell)?.customers || 0} คน
                              </span>
                            </button>
                          )}
                        </td>
                      ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              นับลูกค้าไม่ซ้ำในแต่ละวัน รวมผู้รับบริการเสร็จแล้ว ไม่นับนัดยกเลิกและไม่มาตามนัด
              กดวันที่เพื่อดูรายชื่อ
            </p>
          </>
        )}
      </section>
      <section aria-label="รายชื่อนัดในวันที่เลือก" className="min-w-0 space-y-3">
        <div className="rounded-xl bg-primary/5 p-4">
          <h2 className="font-semibold">นัดวันที่ {thaiDate(day)}</h2>
          {summary.isLoading ? (
            <p className="mt-2 text-sm">กำลังโหลดจำนวน…</p>
          ) : summary.isError ? (
            <p className="mt-2 text-sm">ยังโหลดจำนวนไม่ได้</p>
          ) : (
            <>
              <p className="mt-2 flex items-center gap-2 text-sm">
                <Users aria-hidden="true" className="size-4 text-primary" />
                {selected?.customers || 0} คน · {selected?.appointments || 0} นัด
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                รอเข้าร้าน {selected?.booked || 0} · มาถึง/รับบริการ{' '}
                {(selected?.checkedIn || 0) + (selected?.inService || 0)} · เสร็จแล้ว{' '}
                {selected?.completed || 0}
              </p>
              {!!((selected?.canceled || 0) + (selected?.noShow || 0)) && (
                <p className="mt-1 text-xs text-muted-foreground">
                  ยกเลิก {selected?.canceled || 0} · ไม่มาตามนัด {selected?.noShow || 0}
                </p>
              )}
            </>
          )}
        </div>
        {details.isLoading ? (
          <p role="status">กำลังโหลดรายชื่อ…</p>
        ) : details.isError ? (
          <div role="alert">
            <p>โหลดรายชื่อไม่ได้</p>
            <Button variant="outline" onClick={() => void details.refetch()}>
              ลองโหลดรายชื่ออีกครั้ง
            </Button>
          </div>
        ) : details.data?.rows.length ? (
          <>
            {details.data.rows.map((a) => (
              <Link
                key={a.id}
                to={`/appointments?appointmentId=${a.id}&customerId=${a.customer.id}`}
                className="block space-y-2 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-primary"
              >
                <div className="flex flex-wrap justify-between gap-2">
                  <p className="font-semibold">{a.customer.name}</p>
                  <span className="text-xs text-muted-foreground">{visitStatus[a.status]}</span>
                </div>
                <p className="flex items-center gap-2 text-sm">
                  <Clock aria-hidden="true" className="size-4 text-primary" />
                  {thaiTime(a.startsAt)}–{thaiTime(a.endsAt)}
                </p>
                <p className="text-xs text-muted-foreground">
                  ผู้รับนัด {a.staff.name} · {a.reference}
                </p>
                {a.assignmentIssue && (
                  <p className="text-xs text-destructive">ต้องจัดพนักงานรับแทน</p>
                )}
                <span className="inline-block text-xs font-medium text-primary">
                  เปิดรายละเอียดนัด →
                </span>
              </Link>
            ))}
            {details.data.total > details.data.pageSize && (
              <div className="flex items-center justify-between gap-2">
                <Button
                  variant="outline"
                  disabled={page === 1}
                  onClick={() => setPagination({ key, page: page - 1 })}
                >
                  ก่อนหน้า
                </Button>
                <span className="text-xs">
                  หน้า {page} / {Math.ceil(details.data.total / details.data.pageSize)}
                </span>
                <Button
                  variant="outline"
                  disabled={page * details.data.pageSize >= details.data.total}
                  onClick={() => setPagination({ key, page: page + 1 })}
                >
                  ถัดไป
                </Button>
              </div>
            )}
          </>
        ) : (
          <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            วันนี้ยังไม่มีนัดหมาย
          </p>
        )}
      </section>
    </div>
  );
}
