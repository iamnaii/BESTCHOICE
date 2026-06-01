import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Info, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/contexts/AuthContext';
import api, { getErrorMessage } from '@/lib/api';
import { roleLabels } from '@/pages/UsersPage/types';

/**
 * InternalControlActionBar — Setting 1: who can reverse posted documents.
 *
 * OWNER picks one of 4 modes that map to `SystemConfig.reverse_permission`:
 *   - OWNER_ONLY
 *   - OWNER+FINANCE_MANAGER (default)
 *   - OWNER+FINANCE_MANAGER+ACCOUNTANT
 *   - CUSTOM — per-user opt-in via `User.canReverseOverride`
 *
 * When CUSTOM is selected, this card reveals a user list and lets the OWNER
 * tick `canReverseOverride` per user. The backend `ReversePermissionGuard`
 * consults that flag at request time; OWNER is always allowed regardless.
 */
type Mode =
  | 'OWNER_ONLY'
  | 'OWNER+FINANCE_MANAGER'
  | 'OWNER+FINANCE_MANAGER+ACCOUNTANT'
  | 'CUSTOM';

const MODE_OPTIONS: { value: Mode; label: string; sublabel: string }[] = [
  { value: 'OWNER_ONLY', label: 'OWNER เท่านั้น', sublabel: 'เข้มที่สุด' },
  { value: 'OWNER+FINANCE_MANAGER', label: 'OWNER + ผู้จัดการการเงิน', sublabel: 'Default' },
  {
    value: 'OWNER+FINANCE_MANAGER+ACCOUNTANT',
    label: 'OWNER + ผู้จัดการการเงิน + ฝ่ายบัญชี',
    sublabel: 'กว้างขึ้น',
  },
  { value: 'CUSTOM', label: 'กำหนดเอง (Custom)', sublabel: 'ติ๊กรายบุคคล' },
];

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  canReverseOverride: boolean | null;
}

export function ReversePermissionCard() {
  const { user } = useAuth();
  const isOwner = user?.role === 'OWNER';
  const queryClient = useQueryClient();

  const modeQuery = useQuery<{ value: Mode }>({
    queryKey: ['settings', 'reverse-permission-mode'],
    queryFn: async () =>
      (await api.get<{ value: Mode }>('/settings/reverse-permission')).data,
  });

  const usersQuery = useQuery<UserRow[]>({
    queryKey: ['users', 'reverse-overrides'],
    queryFn: async () => (await api.get<UserRow[]>('/users/reverse-overrides')).data,
    enabled: isOwner,
  });

  const [pendingMode, setPendingMode] = useState<Mode | null>(null);
  useEffect(() => {
    if (modeQuery.data) setPendingMode(modeQuery.data.value);
  }, [modeQuery.data]);

  const modeMutation = useMutation({
    mutationFn: (next: Mode) =>
      api.put('/settings/reverse-permission', { value: next }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'reverse-permission-mode'] });
      queryClient.invalidateQueries({ queryKey: ['settings-ui-flags'] });
      toast.success('บันทึกการตั้งค่าสำเร็จ');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const overrideMutation = useMutation({
    mutationFn: ({ userId, value }: { userId: string; value: boolean | null }) =>
      api.put(`/users/${userId}/reverse-override`, { canReverseOverride: value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users', 'reverse-overrides'] });
      toast.success('บันทึกสิทธิ์ผู้ใช้สำเร็จ');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const currentMode = modeQuery.data?.value ?? 'OWNER+FINANCE_MANAGER';
  const showCustomTable = pendingMode === 'CUSTOM' || currentMode === 'CUSTOM';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 leading-snug">
          <ShieldCheck size={18} className="text-info" aria-hidden />
          สิทธิ์การยกเลิก / กลับรายการ (Reverse Entry)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground leading-snug">
          ระบุว่าใครมีสิทธิ์กดปุ่ม{' '}
          <span className="font-mono">↺ ยกเลิก/กลับรายการ</span>{' '}
          ในเอกสารบัญชี (รายได้อื่น · รายจ่าย · สินทรัพย์)
        </p>

        <div className="space-y-2">
          {MODE_OPTIONS.map((opt) => {
            const checked = pendingMode === opt.value;
            return (
              <label
                key={opt.value}
                className={`flex items-start gap-3 rounded-md border px-3 py-2.5 cursor-pointer transition-colors ${
                  checked ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/50'
                } ${!isOwner ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                <input
                  type="radio"
                  name="reverse-mode"
                  value={opt.value}
                  checked={checked}
                  onChange={() => setPendingMode(opt.value)}
                  disabled={!isOwner || modeMutation.isPending}
                  className="mt-0.5 h-4 w-4 accent-primary"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium leading-snug">{opt.label}</div>
                  <div className="text-xs text-muted-foreground leading-snug">{opt.sublabel}</div>
                </div>
              </label>
            );
          })}
        </div>

        {showCustomTable && (
          <CustomUsersTable
            users={usersQuery.data ?? []}
            isLoading={usersQuery.isLoading}
            disabled={!isOwner || overrideMutation.isPending}
            onChange={(userId, value) => overrideMutation.mutate({ userId, value })}
          />
        )}

        <div className="flex items-start gap-2 rounded-md bg-muted p-3">
          <Info className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" aria-hidden />
          <p className="text-xs text-muted-foreground leading-snug">
            OWNER มีสิทธิ์เสมอ ไม่ว่าจะเลือก mode ใด ·{' '}
            การเปลี่ยน mode มีผลทันที (ผ่าน in-memory cache 5 นาที)
          </p>
        </div>

        <div className="flex justify-end">
          <Button
            onClick={() => pendingMode && modeMutation.mutate(pendingMode)}
            disabled={
              !isOwner ||
              !pendingMode ||
              pendingMode === currentMode ||
              modeMutation.isPending
            }
          >
            {modeMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CustomUsersTable({
  users,
  isLoading,
  disabled,
  onChange,
}: {
  users: UserRow[];
  isLoading: boolean;
  disabled: boolean;
  onChange: (userId: string, value: boolean) => void;
}) {
  if (isLoading) {
    return (
      <div className="rounded-md border border-border bg-muted/30 p-4 text-center text-sm text-muted-foreground leading-snug">
        กำลังโหลด...
      </div>
    );
  }
  if (users.length === 0) {
    return (
      <div className="rounded-md border border-border bg-muted/30 p-4 text-center text-sm text-muted-foreground leading-snug">
        ไม่มีผู้ใช้ในระบบ
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium leading-snug">ผู้ใช้</th>
            <th className="px-3 py-2 text-left font-medium leading-snug">บทบาท</th>
            <th className="px-3 py-2 text-center font-medium leading-snug">อนุญาตให้กลับรายการ</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {users.map((u) => (
            <tr key={u.id} className={u.role === 'OWNER' ? 'bg-muted/20' : ''}>
              <td className="px-3 py-2.5 align-middle">
                <div className="text-sm font-medium leading-snug">{u.name}</div>
                <div className="text-xs text-muted-foreground leading-snug">{u.email}</div>
              </td>
              <td className="px-3 py-2.5 align-middle">
                <span className="text-xs leading-snug">
                  {roleLabels[u.role] ?? u.role}
                </span>
              </td>
              <td className="px-3 py-2.5 align-middle text-center">
                {u.role === 'OWNER' ? (
                  <span className="text-xs text-muted-foreground leading-snug">
                    (อนุญาตอัตโนมัติ)
                  </span>
                ) : (
                  <Switch
                    checked={u.canReverseOverride === true}
                    onCheckedChange={(v) => onChange(u.id, v)}
                    disabled={disabled}
                    aria-label={`อนุญาตให้ ${u.name} กลับรายการ`}
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
