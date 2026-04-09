/**
 * Central definition of "cross-branch" roles — roles that are allowed
 * to see and operate on data from ANY branch.
 *
 * Previously the `user.role === 'OWNER' || 'FINANCE_MANAGER' || 'ACCOUNTANT'`
 * check was duplicated across controllers and services. Changing the
 * allow-list (e.g. adding a new HEAD_OFFICE role) required a grep across
 * the whole API; any missed spot was a silent security regression.
 *
 * Source of truth lives here. BranchGuard reads from the same set so
 * request-level and service-level checks can never drift apart.
 */
export const CROSS_BRANCH_ROLES: ReadonlySet<string> = new Set([
  'OWNER',
  'FINANCE_MANAGER',
  'ACCOUNTANT',
]);

/**
 * Returns true if the given user can access data from any branch.
 *
 * Accepts a partial user-ish object so it works with:
 *  - `request.user` on controllers
 *  - `{ role, branchId }` shapes passed into services
 *  - undefined / null (defensive: treated as NOT cross-branch)
 */
export function hasCrossBranchAccess(
  user: { role?: string | null } | null | undefined,
): boolean {
  if (!user || !user.role) return false;
  return CROSS_BRANCH_ROLES.has(user.role);
}
