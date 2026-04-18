import { useMemo, useState } from 'react';
import DataTable from '@/components/ui/DataTable';
import QueryBoundary from '@/components/QueryBoundary';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getStatusBadgeProps, enabledStatusMap } from '@/lib/status-badges';
import { formatDateShort, formatDateMedium } from '@/utils/formatters';
import { MoreVertical, PowerOff, Power, Pencil, UserX } from 'lucide-react';
import {
  User,
  InviteToken,
  roleLabels,
  roleColors,
  roleAvatarColors,
  getInviteStatus,
} from '../types';

const Empty = () => <span className="text-muted-foreground/50">—</span>;

const formatLastLogin = (iso: string | null): string => {
  if (!iso) return 'ไม่เคยเข้าสู่ระบบ';
  const then = new Date(iso);
  const diffDays = Math.floor((Date.now() - then.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'วันนี้';
  if (diffDays === 1) return 'เมื่อวาน';
  if (diffDays < 7) return `${diffDays} วันก่อน`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} สัปดาห์ก่อน`;
  return formatDateShort(iso);
};

interface UserTableProps {
  users: User[];
  branches: { id: string; name: string }[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  onEdit: (user: User) => void;
  onToggleActive: (id: string, isActive: boolean, name: string) => void;
  onBulkDeactivate: (users: User[]) => void;
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
  branches,
  isLoading,
  isError,
  error,
  onRetry,
  onEdit,
  onToggleActive,
  onBulkDeactivate,
}: UserTableProps) {
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [branchFilter, setBranchFilter] = useState<string>('ALL');
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');

  const filtered = useMemo(() => {
    return users.filter((u) => {
      if (roleFilter !== 'ALL' && u.role !== roleFilter) return false;
      if (branchFilter !== 'ALL') {
        if (branchFilter === 'NONE' && u.branchId) return false;
        if (branchFilter !== 'NONE' && u.branchId !== branchFilter) return false;
      }
      if (activeFilter === 'ACTIVE' && !u.isActive) return false;
      if (activeFilter === 'INACTIVE' && u.isActive) return false;
      return true;
    });
  }, [users, roleFilter, branchFilter, activeFilter]);

  const columns = [
    {
      key: 'name',
      label: 'ชื่อ',
      sortable: true,
      render: (u: User) => {
        const avatarClass = roleAvatarColors[u.role] || 'bg-muted text-muted-foreground';
        return (
          <div className="flex items-center gap-3 min-w-0">
            {u.avatarUrl ? (
              <img
                src={u.avatarUrl}
                alt={u.name || 'รูปโปรไฟล์'}
                className="size-9 rounded-full object-cover shrink-0"
              />
            ) : (
              <div
                className={`size-9 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 ${avatarClass}`}
              >
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
        );
      },
    },
    {
      key: 'employeeId',
      label: 'รหัสพนง.',
      sortable: true,
      hideable: true,
      render: (u: User) => u.employeeId || <Empty />,
    },
    {
      key: 'role',
      label: 'ตำแหน่ง',
      sortable: true,
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
    {
      key: 'branch',
      label: 'สาขา',
      sortable: true,
      render: (u: User) => u.branch?.name || <Empty />,
    },
    {
      key: 'phone',
      label: 'เบอร์โทร',
      hideable: true,
      render: (u: User) => u.phone || <Empty />,
    },
    {
      key: 'lineId',
      label: 'LINE ID',
      hideable: true,
      render: (u: User) => u.lineId || <Empty />,
    },
    {
      key: 'lastLoginAt',
      label: 'เข้าสู่ระบบล่าสุด',
      sortable: true,
      hideable: true,
      render: (u: User) => (
        <span
          className={`whitespace-nowrap text-sm ${
            u.lastLoginAt ? 'text-foreground' : 'text-muted-foreground/60 italic'
          }`}
        >
          {formatLastLogin(u.lastLoginAt)}
        </span>
      ),
    },
    {
      key: 'startDate',
      label: 'วันเริ่มงาน',
      sortable: true,
      hideable: true,
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
      sortable: true,
      render: (u: User) => {
        const cfg = getStatusBadgeProps(String(u.isActive), enabledStatusMap);
        return (
          <Badge variant={cfg.variant} appearance={cfg.appearance} size="sm">
            {cfg.label}
          </Badge>
        );
      },
    },
    {
      key: 'actions',
      label: '',
      sortable: false,
      hideable: false,
      render: (u: User) => (
        <DropdownMenu>
          <DropdownMenuTrigger
            asChild
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              aria-label="เมนูการทำงาน"
            >
              <MoreVertical className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onClick={() => onEdit(u)}>
              <Pencil className="size-4" />
              แก้ไข
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onToggleActive(u.id, u.isActive, u.name)}
              variant={u.isActive ? 'destructive' : undefined}
            >
              {u.isActive ? (
                <>
                  <PowerOff className="size-4" />
                  ปิดใช้งาน
                </>
              ) : (
                <>
                  <Power className="size-4" />
                  เปิดใช้งาน
                </>
              )}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const filterToolbar = (
    <div className="flex items-center gap-2 flex-wrap">
      <Select value={roleFilter} onValueChange={setRoleFilter}>
        <SelectTrigger className="h-9 w-auto min-w-[140px]">
          <SelectValue placeholder="ตำแหน่งทั้งหมด" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">ตำแหน่งทั้งหมด</SelectItem>
          {Object.entries(roleLabels).map(([k, v]) => (
            <SelectItem key={k} value={k}>
              {v}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={branchFilter} onValueChange={setBranchFilter}>
        <SelectTrigger className="h-9 w-auto min-w-[140px]">
          <SelectValue placeholder="สาขาทั้งหมด" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">สาขาทั้งหมด</SelectItem>
          <SelectItem value="NONE">ไม่ได้ระบุสาขา</SelectItem>
          {branches.map((b) => (
            <SelectItem key={b.id} value={b.id}>
              {b.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={activeFilter}
        onValueChange={(v) => setActiveFilter(v as 'ALL' | 'ACTIVE' | 'INACTIVE')}
      >
        <SelectTrigger className="h-9 w-auto min-w-[120px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">ทุกสถานะ</SelectItem>
          <SelectItem value="ACTIVE">ใช้งานอยู่</SelectItem>
          <SelectItem value="INACTIVE">ปิดใช้งาน</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <QueryBoundary
      isLoading={isLoading && users.length === 0}
      isError={isError}
      error={error}
      onRetry={onRetry}
      errorTitle="ไม่สามารถโหลดรายชื่อผู้ใช้ได้"
    >
      <DataTable
        columns={columns}
        data={filtered}
        isLoading={isLoading}
        searchable
        searchPlaceholder="ค้นหาชื่อ, อีเมล, เบอร์..."
        selectable
        columnToggle
        toolbar={filterToolbar}
        onRowClick={onEdit}
        bulkActions={[
          {
            label: 'ปิดใช้งานที่เลือก',
            icon: <UserX className="size-4" />,
            variant: 'destructive',
            onAction: onBulkDeactivate,
          },
        ]}
        emptyMessage={
          filtered.length === 0 && users.length > 0
            ? 'ไม่พบผู้ใช้ที่ตรงกับเงื่อนไข'
            : 'ยังไม่มีผู้ใช้'
        }
      />
    </QueryBoundary>
  );
}

type InviteStatusFilter = 'ALL' | 'PENDING' | 'USED' | 'EXPIRED';

export function InviteTable({
  invites,
  isLoading,
  onResend,
  onRevoke,
  isResendPending,
}: InviteTableProps) {
  const [statusFilter, setStatusFilter] = useState<InviteStatusFilter>('PENDING');

  const filtered = useMemo(() => {
    return invites.filter((i) => {
      const status = getInviteStatus(i).label;
      if (statusFilter === 'ALL') return true;
      if (statusFilter === 'PENDING') return status === 'รอลงทะเบียน';
      if (statusFilter === 'USED') return status === 'ใช้แล้ว';
      if (statusFilter === 'EXPIRED') return status === 'หมดอายุ';
      return true;
    });
  }, [invites, statusFilter]);

  const counts = useMemo(() => {
    const c = { pending: 0, used: 0, expired: 0 };
    for (const i of invites) {
      const s = getInviteStatus(i).label;
      if (s === 'รอลงทะเบียน') c.pending += 1;
      else if (s === 'ใช้แล้ว') c.used += 1;
      else if (s === 'หมดอายุ') c.expired += 1;
    }
    return c;
  }, [invites]);

  const inviteColumns = [
    {
      key: 'email',
      label: 'อีเมล',
      sortable: true,
      render: (i: InviteToken) => <span className="font-medium">{i.email}</span>,
    },
    {
      key: 'role',
      label: 'ตำแหน่ง',
      sortable: true,
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
    {
      key: 'branch',
      label: 'สาขา',
      render: (i: InviteToken) => i.branch?.name || <Empty />,
    },
    {
      key: 'inviter',
      label: 'เชิญโดย',
      hideable: true,
      render: (i: InviteToken) => i.inviter?.name || <Empty />,
    },
    {
      key: 'status',
      label: 'สถานะ',
      sortable: true,
      render: (i: InviteToken) => {
        const s = getInviteStatus(i);
        return (
          <span
            className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${s.className}`}
          >
            {s.label}
          </span>
        );
      },
    },
    {
      key: 'createdAt',
      label: 'วันที่สร้าง',
      sortable: true,
      hideable: true,
      render: (i: InviteToken) => (
        <span className="whitespace-nowrap">{formatDateMedium(i.createdAt)}</span>
      ),
    },
    {
      key: 'actions',
      label: '',
      sortable: false,
      hideable: false,
      render: (i: InviteToken) => {
        const status = getInviteStatus(i);
        if (status.label === 'ใช้แล้ว') return null;
        return (
          <div className="flex items-center gap-3 whitespace-nowrap">
            <button
              onClick={() => onResend(i.id, i.email)}
              disabled={isResendPending}
              className="text-primary hover:text-primary/80 text-sm font-medium disabled:opacity-50"
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

  const statusFilterToolbar = (
    <div className="flex items-center gap-1 flex-wrap">
      {(
        [
          { value: 'PENDING' as const, label: `รอลงทะเบียน (${counts.pending})` },
          { value: 'USED' as const, label: `ใช้แล้ว (${counts.used})` },
          { value: 'EXPIRED' as const, label: `หมดอายุ (${counts.expired})` },
          { value: 'ALL' as const, label: 'ทั้งหมด' },
        ]
      ).map((opt) => (
        <button
          key={opt.value}
          onClick={() => setStatusFilter(opt.value)}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
            statusFilter === opt.value
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:bg-muted/70'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );

  return (
    <DataTable
      columns={inviteColumns}
      data={filtered}
      isLoading={isLoading}
      searchable
      searchPlaceholder="ค้นหาอีเมล..."
      columnToggle
      toolbar={statusFilterToolbar}
      emptyMessage="ไม่พบคำเชิญที่ตรงกับเงื่อนไข"
    />
  );
}
