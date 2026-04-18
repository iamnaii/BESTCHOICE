import DataTable from '@/components/ui/DataTable';
import QueryBoundary from '@/components/QueryBoundary';
import { Badge } from '@/components/ui/badge';
import { getStatusBadgeProps, enabledStatusMap } from '@/lib/status-badges';
import { formatDateShort, formatDateMedium } from '@/utils/formatters';
import { User, InviteToken, roleLabels, roleColors, getInviteStatus } from '../types';

const Empty = () => <span className="text-muted-foreground/50">—</span>;

interface UserTableProps {
  users: User[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  onEdit: (user: User) => void;
  onToggleActive: (id: string, isActive: boolean, name: string) => void;
}

interface InviteTableProps {
  invites: InviteToken[];
  isLoading: boolean;
  onResend: (id: string, email: string) => void;
  onRevoke: (id: string, email: string) => void;
  isResendPending: boolean;
}

export function UserTable({
  users,
  isLoading,
  isError,
  error,
  onRetry,
  onEdit,
  onToggleActive,
}: UserTableProps) {
  const columns = [
    {
      key: 'name',
      label: 'ชื่อ',
      render: (u: User) => (
        <div className="flex items-center gap-3">
          {u.avatarUrl ? (
            <img
              src={u.avatarUrl}
              alt={u.name || 'รูปโปรไฟล์'}
              className="size-8 rounded-full object-cover shrink-0"
            />
          ) : (
            <div className="size-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground shrink-0">
              {u.name.charAt(0)}
            </div>
          )}
          <div className="min-w-0">
            <div className="font-medium text-foreground truncate">
              {u.name}
              {u.nickname && (
                <span className="text-muted-foreground font-normal"> ({u.nickname})</span>
              )}
            </div>
            <div className="text-xs text-muted-foreground truncate">{u.email}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'employeeId',
      label: 'รหัสพนง.',
      render: (u: User) => u.employeeId || <Empty />,
    },
    {
      key: 'role',
      label: 'ตำแหน่ง',
      render: (u: User) => (
        <span
          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${
            roleColors[u.role] || 'bg-muted text-foreground'
          }`}
        >
          {roleLabels[u.role] || u.role}
        </span>
      ),
    },
    { key: 'branch', label: 'สาขา', render: (u: User) => u.branch?.name || <Empty /> },
    { key: 'phone', label: 'เบอร์โทร', render: (u: User) => u.phone || <Empty /> },
    { key: 'lineId', label: 'LINE ID', render: (u: User) => u.lineId || <Empty /> },
    {
      key: 'startDate',
      label: 'วันเริ่มงาน',
      render: (u: User) =>
        u.startDate ? (
          <span className="whitespace-nowrap">{formatDateShort(u.startDate)}</span>
        ) : (
          <Empty />
        ),
    },
    {
      key: 'isActive',
      label: 'สถานะ',
      render: (u: User) => {
        const cfg = getStatusBadgeProps(String(u.isActive), enabledStatusMap);
        return (
          <button
            onClick={() => onToggleActive(u.id, u.isActive, u.name)}
            className="cursor-pointer whitespace-nowrap"
          >
            <Badge variant={cfg.variant} appearance={cfg.appearance} size="sm">
              {cfg.label}
            </Badge>
          </button>
        );
      },
    },
    {
      key: 'actions',
      label: '',
      render: (u: User) => (
        <button
          onClick={() => onEdit(u)}
          className="text-primary hover:text-primary/80 text-sm font-medium whitespace-nowrap"
        >
          แก้ไข
        </button>
      ),
    },
  ];

  return (
    <div className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
      <QueryBoundary
        isLoading={isLoading && users.length === 0}
        isError={isError}
        error={error}
        onRetry={onRetry}
        errorTitle="ไม่สามารถโหลดรายชื่อผู้ใช้ได้"
      >
        <DataTable columns={columns} data={users} isLoading={isLoading} />
      </QueryBoundary>
    </div>
  );
}

export function InviteTable({
  invites,
  isLoading,
  onResend,
  onRevoke,
  isResendPending,
}: InviteTableProps) {
  const inviteColumns = [
    {
      key: 'email',
      label: 'อีเมล',
      render: (i: InviteToken) => <span className="font-medium">{i.email}</span>,
    },
    {
      key: 'role',
      label: 'ตำแหน่ง',
      render: (i: InviteToken) => (
        <span
          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${
            roleColors[i.role] || 'bg-muted text-foreground'
          }`}
        >
          {roleLabels[i.role] || i.role}
        </span>
      ),
    },
    { key: 'branch', label: 'สาขา', render: (i: InviteToken) => i.branch?.name || <Empty /> },
    { key: 'inviter', label: 'เชิญโดย', render: (i: InviteToken) => i.inviter?.name || <Empty /> },
    {
      key: 'status',
      label: 'สถานะ',
      render: (i: InviteToken) => {
        const s = getInviteStatus(i);
        return (
          <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${s.className}`}>
            {s.label}
          </span>
        );
      },
    },
    {
      key: 'createdAt',
      label: 'วันที่สร้าง',
      render: (i: InviteToken) => (
        <span className="whitespace-nowrap">{formatDateMedium(i.createdAt)}</span>
      ),
    },
    {
      key: 'actions',
      label: '',
      render: (i: InviteToken) => {
        const status = getInviteStatus(i);
        if (status.label === 'ใช้แล้ว') return null;
        return (
          <div className="flex items-center gap-3 whitespace-nowrap">
            <button
              onClick={() => onResend(i.id, i.email)}
              disabled={isResendPending}
              className="text-primary hover:text-primary/80 text-sm font-medium"
            >
              ส่งซ้ำ
            </button>
            {status.label === 'รอลงทะเบียน' && (
              <button
                onClick={() => onRevoke(i.id, i.email)}
                className="text-destructive hover:text-destructive/80 text-sm font-medium"
              >
                ยกเลิก
              </button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
      <DataTable columns={inviteColumns} data={invites} isLoading={isLoading} />
    </div>
  );
}
