import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { accountingApi, type ReopenedPeriod } from '@/lib/accounting';
import { formatThaiDateTime } from '@/lib/date';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Roles the API will actually answer for — mirrors `@Roles` on
 * `GET /expenses/periods/reopened` (accounting.controller.ts:282-283).
 *
 * BRANCH_MANAGER is deliberately NOT here: the accounting period endpoints
 * aggregate across every branch and BM is not a cross-branch role
 * (branch-access.util.ts). But BM *can* reach /expenses, and this banner used
 * to fire its query unconditionally — so every branch manager opening that page
 * triggered a silent 403. The banner renders nothing on failure, so nobody
 * noticed except the console (and the page-health E2E check).
 *
 * Gate the query instead of widening the endpoint's roles: showing company-wide
 * period state to a branch manager would be a policy change, not a bug fix.
 */
const ALLOWED_ROLES = ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT', 'VIEWER'];

export function ReopenedPeriodBanner() {
  const { user } = useAuth();
  const { data } = useQuery<ReopenedPeriod[]>({
    queryKey: ['accounting-periods', 'reopened'],
    queryFn: () => accountingApi.listReopenedPeriods(),
    staleTime: 60_000,
    enabled: !!user && ALLOWED_ROLES.includes(user.role),
  });

  if (!data || data.length === 0) return null;

  return (
    <div className="space-y-2">
      {data.map((p) => {
        const periodLabel = `${p.year}-${String(p.month).padStart(2, '0')}`;
        return (
          <Alert
            key={p.id || periodLabel}
            variant="warning"
            className="border-warning bg-warning/10"
          >
            <AlertTriangle className="w-4 h-4 text-warning-strong" />
            <AlertTitle>งวด {periodLabel} ถูกเปิดชั่วคราว</AlertTitle>
            <AlertDescription className="space-y-1">
              <p>
                เปิดเมื่อ: {formatThaiDateTime(p.reopenedAt)}
                {p.reopenedBy?.name ? ` โดย ${p.reopenedBy.name}` : ''}
              </p>
              {p.reopenReason && <p>เหตุผล: {p.reopenReason}</p>}
              {p.taxFiled && (
                <p className="text-destructive font-medium">ภ.พ.30 ยื่นแล้ว — ต้องยื่นแก้ไขด้วย</p>
              )}
            </AlertDescription>
          </Alert>
        );
      })}
    </div>
  );
}
