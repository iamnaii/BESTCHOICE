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

/**
 * Branch scope descriptor used by services to apply consistent `where`
 * filters on multi-branch resources.
 *
 * Shape:
 *  - `{ all: true }`   — cross-branch role; service should NOT filter by branchId
 *  - `{ branchId }`    — single-branch role; service MUST filter by user.branchId
 *  - `{ branchId: null }` — branch-scoped role without a branchId assignment
 *                          (defensive — return zero rows by filtering to a
 *                          guaranteed-empty set rather than leaking data)
 */
export type BranchScope =
  | { all: true; branchId?: undefined }
  | { all?: false; branchId: string | null };

/**
 * Build a BranchScope from the authenticated request user.
 *
 * Services should call this once at the top of read methods and apply the
 * returned scope to their `where` clause:
 *
 *   const scope = getBranchScope(user);
 *   if (!scope.all) {
 *     if (!scope.branchId) return { data: [], total: 0 };
 *     where.branchId = scope.branchId;
 *   }
 *
 * This mirrors BranchGuard but works at the service layer where we can
 * scope the query rather than just gate the request — important for list
 * endpoints that don't receive a branchId from the client.
 */
export function getBranchScope(
  user: { role?: string | null; branchId?: string | null } | null | undefined,
): BranchScope {
  if (hasCrossBranchAccess(user)) {
    return { all: true };
  }
  return { branchId: user?.branchId ?? null };
}
