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

// Re-exports — canonical source is `@/constants/user-roles.ts`. Kept here as
// shims so existing call sites inside UsersPage keep working unchanged.
export {
  ROLE_LABELS as roleLabels,
  ROLE_COLORS as roleColors,
  ROLE_AVATAR_COLORS as roleAvatarColors,
} from '@/constants/user-roles';

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
