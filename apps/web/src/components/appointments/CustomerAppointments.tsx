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
          <Link
            key={a.id}
            className="block space-y-1 text-sm hover:underline"
            to={`${url}&appointmentId=${a.id}`}
          >
            <p>
              {thaiDate(a.startsAt)} · {thaiTime(a.startsAt)} · {visitStatus[a.status]}
            </p>
            <p className="text-xs text-muted-foreground">
              {a.branch.name} · {a.staff.name}
            </p>
            {a.assignmentIssue && <p className="text-xs text-destructive">ต้องจัดพนักงานรับแทน</p>}
          </Link>
        ))
      ) : (
        <p className="text-xs text-muted-foreground">ยังไม่มีนัดเข้าร้านที่เปิดอยู่</p>
      )}
    </section>
  );
}
