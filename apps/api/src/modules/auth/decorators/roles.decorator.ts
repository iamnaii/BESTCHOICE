import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * D1.3.2.1 — Role union mirrors the Prisma `UserRole` enum. `VIEWER` exists
 * as a future-use read-only auditor role; today it has ZERO permissions wired
 * (no @Roles() decorator in the codebase includes it). When OWNER enables the
 * SystemConfig flag `viewer_role_enabled = 'true'`, the optional helper
 * `RolesWhenViewerEnabled` (below) augments a route's role list with VIEWER
 * at request time via a Reflector lookup. Until that flag flips, a VIEWER
 * user can authenticate but sees empty pages on GET endpoints that do NOT
 * include VIEWER in their @Roles() decorator.
 *
 * Q4-gated: this is the conservative default — schema enum exists so OWNER
 * has the option to create Viewer accounts, but no permissions are wired.
 * If owner's Q4 answer is "no viewer role at all" we drop this PR.
 */
type UserRole =
  | 'OWNER'
  | 'BRANCH_MANAGER'
  | 'FINANCE_MANAGER'
  | 'SALES'
  | 'ACCOUNTANT'
  | 'VIEWER';

export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
