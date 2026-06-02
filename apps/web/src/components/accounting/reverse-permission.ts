/**
 * InternalControlActionBar — client mirror of the backend reverse-permission
 * resolver (`apps/api/src/modules/auth/guards/reverse-permission.guard.ts` →
 * `canUserReverse`).
 *
 * Used by the three accounting modules (Other Income, Expense, Asset) to decide
 * whether to SHOW the "↺ ยกเลิก / กลับรายการ" button, so the UI never offers an
 * action the server will reject with 403. The server stays authoritative —
 * `ReversePermissionGuard` re-validates every reverse/void request.
 *
 * Modes mirror SystemConfig `reverse_permission`:
 *   - `OWNER_ONLY`
 *   - `OWNER+FINANCE_MANAGER` (default)
 *   - `OWNER+FINANCE_MANAGER+ACCOUNTANT`
 *   - `CUSTOM` — per-user opt-in via `User.canReverseOverride`
 * OWNER is always allowed regardless of mode.
 */
export type ReversePermissionMode =
  | 'OWNER_ONLY'
  | 'OWNER+FINANCE_MANAGER'
  | 'OWNER+FINANCE_MANAGER+ACCOUNTANT'
  | 'CUSTOM';

const MODE_ROLE_SETS: Record<Exclude<ReversePermissionMode, 'CUSTOM'>, readonly string[]> = {
  OWNER_ONLY: ['OWNER'],
  'OWNER+FINANCE_MANAGER': ['OWNER', 'FINANCE_MANAGER'],
  'OWNER+FINANCE_MANAGER+ACCOUNTANT': ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'],
};

/**
 * Resolve whether the given user may reverse, mirroring the server's
 * `canUserReverse`. Pass the value straight to the bar's `canReverse` prop.
 *
 * @param mode               active reverse_permission mode (from `useUiFlags`)
 * @param role               current user's role
 * @param canReverseOverride per-user flag — only consulted when mode = CUSTOM
 */
export function resolveCanReverse(
  mode: ReversePermissionMode,
  role: string | undefined | null,
  canReverseOverride?: boolean | null,
): boolean {
  if (!role) return false;
  if (role === 'OWNER') return true;
  if (mode === 'CUSTOM') return canReverseOverride === true;
  return MODE_ROLE_SETS[mode]?.includes(role) ?? false;
}
