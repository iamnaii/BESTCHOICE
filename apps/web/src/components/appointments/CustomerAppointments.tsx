import { CalendarDays, Clock, MessageCircle } from 'lucide-react';
import { confirmationStatusLabel } from './ConfirmationMessage';
import { getRequestCompany } from '@/lib/company-scope';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { hasCompanyAccess } from '@installment/shared';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import { StaffVisit, thaiDate, thaiTime, visitStatus } from './types';
export default function CustomerAppointments({
  customerId,
  roomId,
}: {
  customerId?: string | null;
  roomId?: string;
}) {
  const { user } = useAuth();
  const allowed =
    getRequestCompany() !== 'FINANCE' &&
    !!user &&
    ['OWNER', 'BRANCH_MANAGER', 'SALES'].includes(user.role) &&
    hasCompanyAccess(user.role, user.accessibleCompanies, 'SHOP');
  const query = useQuery({
    queryKey: ['appointments', 'customer-summary', customerId, roomId],
    queryFn: () =>
      api
        .get<StaffVisit[]>('/store-appointments', { params: { customerId, roomId, open: true } })
        .then((r) => r.data),
    enabled: allowed && !!customerId,
    refetchInterval: 30_000,
  });
  if (!allowed || !customerId) return null;
  const url = `/appointments?customerId=${encodeURIComponent(customerId)}${roomId ? `&roomId=${encodeURIComponent(roomId)}` : ''}`;
  return (
    <section
      className="space-y-2 rounded-lg border border-border bg-card p-3"
      aria-label="นัดเข้าร้าน"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">นัดเข้าร้าน</h3>
        <Button asChild size="sm" variant="outline">
          <Link to={url}>จัดการนัด</Link>
        </Button>
      </div>
      {query.isLoading ? (
        <p className="text-xs" role="status">
          กำลังโหลดนัด…
        </p>
      ) : query.isError ? (
        <p role="alert" className="text-xs">
          โหลดนัดไม่ได้{' '}
          <button className="underline" onClick={() => void query.refetch()}>
            ลองใหม่
          </button>
        </p>
      ) : query.data?.length ? (
        query.data.map((a) => (
          <article key={a.id} className="space-y-3 border-t border-border pt-3">
            <Link
              className="block space-y-2 rounded-md text-sm hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
              to={`${url}&appointmentId=${a.id}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{thaiDate(a.startsAt)}</p>
                <span className="rounded-full bg-primary/10 px-2 py-1 text-xs text-primary">
                  {visitStatus[a.status]}
                </span>
              </div>
              <p className="flex items-center gap-2 font-semibold">
                <Clock aria-hidden="true" className="size-4 text-primary" />
                {thaiTime(a.startsAt)}–{thaiTime(a.endsAt)}
              </p>
              <p className="text-xs text-muted-foreground">
                {a.branch.name} · ผู้รับนัด {a.staff.name}
              </p>
              <p className="text-xs text-muted-foreground">เลขนัด {a.reference}</p>
              {a.assignmentIssue && (
                <p className="text-xs text-destructive">ต้องจัดพนักงานรับแทน</p>
              )}
            </Link>
            {a.confirmations?.[0] && (
              <p
                role="status"
                className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"
              >
                <MessageCircle aria-hidden="true" className="size-4 shrink-0" />
                {confirmationStatusLabel(a.confirmations[0].status)}
              </p>
            )}
            <Button asChild variant="outline" className="min-h-11 w-full">
              <Link
                to={`/appointments?view=calendar&branchId=${a.branch.id}&day=${new Date(new Date(a.startsAt).getTime() + 7 * 3600000).toISOString().slice(0, 10)}`}
              >
                <CalendarDays aria-hidden="true" className="size-4" />
                ดูปฏิทินสาขา
              </Link>
            </Button>
          </article>
        ))
      ) : (
        <p className="text-xs text-muted-foreground">ยังไม่มีนัดเข้าร้านที่เปิดอยู่</p>
      )}
    </section>
  );
}
