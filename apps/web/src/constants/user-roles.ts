/**
 * Canonical user-role display data — labels + Tailwind color tokens.
 * Promoted from `pages/UsersPage/types.ts` so cross-page consumers (e.g.
 * Settings cards) don't have to import from a sibling page module.
 *
 * Keep enum values in sync with `UserRole` in `apps/api/prisma/schema.prisma`.
 */

export const ROLE_LABELS: Record<string, string> = {
  OWNER: 'เจ้าของร้าน',
  BRANCH_MANAGER: 'ผู้จัดการสาขา',
  FINANCE_MANAGER: 'ผู้จัดการการเงิน',
  SALES: 'พนักงานขาย',
  ACCOUNTANT: 'ฝ่ายบัญชี',
  VIEWER: 'ผู้ตรวจสอบ (Read-only)',
};

export const ROLE_AVATAR_COLORS: Record<string, string> = {
  OWNER: 'bg-destructive/15 text-destructive',
  BRANCH_MANAGER: 'bg-primary/15 text-primary',
  FINANCE_MANAGER: 'bg-info/15 text-info',
  SALES: 'bg-success/15 text-success',
  ACCOUNTANT: 'bg-warning/15 text-warning',
  // Owner Q4 (2026-05-17) — external auditor (CPA / สรรพากร). Read-only;
  // backend RolesGuard gates via `viewer_role_enabled` SystemConfig.
  VIEWER: 'bg-secondary text-secondary-foreground',
};

export const ROLE_COLORS: Record<string, string> = {
  OWNER: 'bg-destructive/10 text-destructive dark:bg-destructive/15',
  BRANCH_MANAGER: 'bg-primary/10 text-primary dark:bg-primary/15',
  FINANCE_MANAGER: 'bg-info/10 text-info dark:bg-info/15',
  SALES: 'bg-success/10 text-success dark:bg-success/15',
  ACCOUNTANT: 'bg-warning/10 text-warning dark:bg-warning/15',
  VIEWER: 'bg-secondary text-secondary-foreground',
};
