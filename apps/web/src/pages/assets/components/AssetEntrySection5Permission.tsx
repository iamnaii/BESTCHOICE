// Asset module — Section 5 (PR 2a Task 6 / P7): Permission settings.
//
// Replaces the legacy single-approver dropdown. UI lets the user pick N users
// from the user master and grant each one view/edit/post permissions. The
// configuration is persisted as JSONB metadata on FixedAsset — there is NO
// API-level enforcement yet (deferred to a later phase). The disclaimer at the
// bottom of the card makes that explicit.

import { useFormContext } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { UserPlus, X, Info } from 'lucide-react';
import api from '@/lib/api';
import type { AssetEntryFormValues } from '../schema';
import { AssetSectionHeader } from './AssetSectionHeader';

interface User {
  id: string;
  name: string;
  role: string;
}

export function AssetEntrySection5Permission() {
  const { watch, setValue } = useFormContext<AssetEntryFormValues>();
  const permissions = watch('permissionConfig') ?? [];

  const usersQuery = useQuery({
    queryKey: ['users', 'asset-permission'],
    queryFn: async () => {
      // /users now returns paginated `{ data, total, page, limit }` — must unwrap.
      // Fallback to bare array for backward-compat.
      const res = await api.get('/users', { params: { limit: 500 } });
      const list: User[] =
        res.data?.data ?? (Array.isArray(res.data) ? (res.data as User[]) : []);
      return list;
    },
  });

  const addUser = (userId: string) => {
    if (!userId || permissions.some((p) => p.userId === userId)) return;
    setValue(
      'permissionConfig',
      [...permissions, { userId, canView: true, canEdit: false, canPost: false }],
      { shouldDirty: true },
    );
  };

  const removeUser = (userId: string) => {
    setValue(
      'permissionConfig',
      permissions.filter((p) => p.userId !== userId),
      { shouldDirty: true },
    );
  };

  const togglePerm = (userId: string, key: 'canView' | 'canEdit' | 'canPost') => {
    setValue(
      'permissionConfig',
      permissions.map((p) => (p.userId === userId ? { ...p, [key]: !p[key] } : p)),
      { shouldDirty: true },
    );
  };

  const userMap = new Map(usersQuery.data?.map((u) => [u.id, u]) ?? []);
  const availableUsers = (usersQuery.data ?? []).filter(
    (u) => !permissions.some((p) => p.userId === u.id),
  );

  return (
    <Card>
      <AssetSectionHeader number={5} title="กำหนดสิทธิ์ (Permission)" />
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          กำหนดว่าใครมีสิทธิ์ดู / แก้ไข / ลงบัญชี เอกสารนี้
        </p>

        <div className="flex items-center gap-2">
          <Select value="" onValueChange={(v) => v && addUser(v)}>
            <SelectTrigger aria-label="เพิ่มผู้ใช้" className="max-w-xs">
              <SelectValue placeholder="+ เพิ่มผู้ใช้" />
            </SelectTrigger>
            <SelectContent>
              {availableUsers.length === 0 ? (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">
                  ไม่มีผู้ใช้เพิ่มเติม
                </div>
              ) : (
                availableUsers.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                    <span className="text-xs text-muted-foreground ml-2">{u.role}</span>
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          <UserPlus className="size-4 text-muted-foreground" />
        </div>

        {permissions.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            ยังไม่มีผู้ใช้ในรายการสิทธิ์ · ใช้ปุ่ม "+ เพิ่มผู้ใช้" ด้านบนเพื่อระบุ
          </div>
        ) : (
          <div className="space-y-2">
            {permissions.map((perm) => {
              const user = userMap.get(perm.userId);
              return (
                <div key={perm.userId} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">{user?.name ?? perm.userId}</div>
                      <div className="text-xs text-muted-foreground">
                        {user?.role ?? '—'}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeUser(perm.userId)}
                      aria-label={`ลบ ${user?.name ?? perm.userId}`}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-4 pl-1">
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={perm.canView}
                        onCheckedChange={() => togglePerm(perm.userId, 'canView')}
                      />
                      ดู (view)
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={perm.canEdit}
                        onCheckedChange={() => togglePerm(perm.userId, 'canEdit')}
                      />
                      แก้ไข (edit)
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={perm.canPost}
                        onCheckedChange={() => togglePerm(perm.userId, 'canPost')}
                      />
                      ลงบัญชี (post)
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
          <Info className="size-4 shrink-0 mt-0.5" />
          <span>
            การกำหนดสิทธิ์นี้บันทึกเป็น metadata ของเอกสาร · การบังคับสิทธิ์ที่ระดับ API
            จะเพิ่มในเฟสถัดไป
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
