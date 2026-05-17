import { Navigate, useLocation } from 'react-router';

/**
 * SP5 Phase 1 — Insurance / Returns refactor (scope-reduced).
 *
 * The spec asks for a separate /insurance module covering
 * lifecycle: รับเข้า → ส่งศูนย์ → คืนลูกค้า. The existing /defect-exchange
 * page already covers the same in-warranty repair workflow, so Phase 1
 * just routes /insurance back into /defect-exchange (single source of truth).
 *
 * Preserves search params + hash so deep links (e.g. /insurance?ticketId=X)
 * keep working through the redirect.
 *
 * Phase 2 (deferred):
 * - Promote /insurance to its own page with a tabbed view
 *   (Repair / Returns / Out-of-warranty) backed by RepairTicket model + a
 *   new lifecycleStatus enum.
 * - Audit trail per status transition.
 */
export default function InsurancePage() {
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname: '/defect-exchange', search, hash }} replace />;
}
