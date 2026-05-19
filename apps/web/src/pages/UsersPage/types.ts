export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  branchId: string | null;
  isActive: boolean;
  employeeId: string | null;
  nickname: string | null;
  phone: string | null;
  lineId: string | null;
  address: string | null;
  avatarUrl: string | null;
  startDate: string | null;
  nationalId: string | null;
  birthDate: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  branch: { id: string; name: string } | null;
}

export const roleAvatarColors: Record<string, string> = {
  OWNER: 'bg-destructive/15 text-destructive',
  BRANCH_MANAGER: 'bg-primary/15 text-primary',
  FINANCE_MANAGER: 'bg-info/15 text-info',
  SALES: 'bg-success/15 text-success',
  ACCOUNTANT: 'bg-warning/15 text-warning',
  // Owner Q4 (2026-05-17) — external auditor (CPA / สรรพากร). Read-only;
  // backend RolesGuard gates via `viewer_role_enabled` SystemConfig.
  VIEWER: 'bg-secondary text-secondary-foreground',
};

export interface InviteToken {
  id: string;
  email: string;
  role: string;
  branchId: string | null;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
  branch: { id: string; name: string } | null;
  inviter: { id: string; name: string } | null;
}

export const roleLabels: Record<string, string> = {
  OWNER: 'เจ้าของร้าน',
  BRANCH_MANAGER: 'ผู้จัดการสาขา',
  FINANCE_MANAGER: 'ผู้จัดการการเงิน',
  SALES: 'พนักงานขาย',
  ACCOUNTANT: 'ฝ่ายบัญชี',
  VIEWER: 'ผู้ตรวจสอบ (Read-only)',
};

export const roleColors: Record<string, string> = {
  OWNER: 'bg-destructive/10 text-destructive dark:bg-destructive/15',
  BRANCH_MANAGER: 'bg-primary/10 text-primary dark:bg-primary/15',
  FINANCE_MANAGER: 'bg-info/10 text-info dark:bg-info/15',
  SALES: 'bg-success/10 text-success dark:bg-success/15',
  ACCOUNTANT: 'bg-warning/10 text-warning dark:bg-warning/15',
  VIEWER: 'bg-secondary text-secondary-foreground',
};

export const inputClass =
  'w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20';
export const labelClass = 'block text-xs font-medium text-foreground mb-1.5';

export const emptyForm = {
  email: '',
  password: '',
  name: '',
  role: 'SALES',
  branchId: '',
  employeeId: '',
  nickname: '',
  phone: '',
  lineId: '',
  address: '',
  avatarUrl: '',
  startDate: '',
  nationalId: '',
  birthDate: '',
};

export function getInviteStatus(invite: InviteToken): { label: string; className: string } {
  if (invite.usedAt) return { label: 'ใช้แล้ว', className: 'bg-success/10 text-success dark:bg-success/15' };
  if (new Date(invite.expiresAt) < new Date())
    return { label: 'หมดอายุ', className: 'bg-muted text-muted-foreground' };
  return { label: 'รอลงทะเบียน', className: 'bg-warning/10 text-warning dark:bg-warning/15' };
}
