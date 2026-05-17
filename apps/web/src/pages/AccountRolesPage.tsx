import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Lock, Check, ChevronsUpDown } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface RoleMapRow {
  id: string;
  role: string;
  accountCode: string;
  accountName: string | null;
  priority: number;
  isActive: boolean;
  note: string | null;
  required: boolean;
}

interface ChartOfAccount {
  id: string;
  code: string;
  name: string;
  status: string;
}

/**
 * D1.1.1.4 — Admin UI for `account_role_map` (Q7=WIRE IT). OWNER-only
 * route at `/settings/account-roles`. Table view with per-row Edit modal;
 * REQUIRED_ROLES rows show a lock icon and cannot be deactivated.
 *
 * Backend endpoints:
 *   GET  /settings/role-map     → list with CoA name + `required` flag
 *   PUT  /settings/role-map/:id → update one row (validates accountCode,
 *                                 blocks deactivate of required)
 */
export default function AccountRolesPage() {
  const queryClient = useQueryClient();
  const [editingRow, setEditingRow] = useState<RoleMapRow | null>(null);

  const rolesQuery = useQuery<RoleMapRow[]>({
    queryKey: ['settings', 'role-map'],
    queryFn: async () => (await api.get<RoleMapRow[]>('/settings/role-map')).data,
  });

  // Group rows by role for visual grouping when a role has multiple
  // priority levels (future context-aware lookup).
  const grouped = useMemo(() => {
    const byRole = new Map<string, RoleMapRow[]>();
    for (const r of rolesQuery.data ?? []) {
      const arr = byRole.get(r.role) ?? [];
      arr.push(r);
      byRole.set(r.role, arr);
    }
    return Array.from(byRole, ([role, rows]) => ({ role, rows }));
  }, [rolesQuery.data]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="บัญชีตาม Role"
        subtitle="กำหนดรหัสบัญชี (Chart of Accounts) สำหรับ semantic role แต่ละตัวที่ใช้ใน JE templates — แก้ไขเฉพาะ OWNER"
      />

      <QueryBoundary
        isLoading={rolesQuery.isLoading}
        isError={rolesQuery.isError}
        error={rolesQuery.error}
        onRetry={() => rolesQuery.refetch()}
        loadingFallback={<TableSkeleton />}
      >
        {(rolesQuery.data ?? []).length === 0 ? (
          <div className="rounded-md border border-border bg-card p-8 text-center text-muted-foreground leading-snug">
            ยังไม่มีข้อมูลใน account_role_map — รัน{' '}
            <code className="rounded bg-muted px-1.5 py-0.5">npm run seed:account-roles</code>{' '}
            เพื่อ seed ข้อมูลเริ่มต้น
          </div>
        ) : (
          <RoleMapTable groups={grouped} onEdit={setEditingRow} />
        )}
      </QueryBoundary>

      {editingRow ? (
        <EditRoleMapDialog
          row={editingRow}
          open={!!editingRow}
          onOpenChange={(open) => !open && setEditingRow(null)}
          onSuccess={async () => {
            await queryClient.invalidateQueries({ queryKey: ['settings', 'role-map'] });
            setEditingRow(null);
          }}
        />
      ) : null}
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="rounded-md border border-border bg-card p-8 text-center text-muted-foreground leading-snug">
      กำลังโหลด...
    </div>
  );
}

function RoleMapTable({
  groups,
  onEdit,
}: {
  groups: { role: string; rows: RoleMapRow[] }[];
  onEdit: (row: RoleMapRow) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            <th className="px-4 py-3 text-left font-medium leading-snug">Role</th>
            <th className="px-4 py-3 text-left font-medium leading-snug">รหัสบัญชี</th>
            <th className="px-4 py-3 text-left font-medium leading-snug">ชื่อบัญชี</th>
            <th className="px-4 py-3 text-right font-medium leading-snug">Priority</th>
            <th className="px-4 py-3 text-center font-medium leading-snug">ใช้งาน</th>
            <th className="px-4 py-3 text-left font-medium leading-snug">หมายเหตุ</th>
            <th className="px-4 py-3 text-right font-medium leading-snug">การจัดการ</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {groups.flatMap(({ rows }) =>
            rows.map((row) => (
              <tr key={row.id} className="hover:bg-accent/50">
                <td className="px-4 py-3 align-top">
                  <div className="flex items-center gap-1.5">
                    {row.required ? (
                      <span title="Required role — ห้ามปิดใช้งาน">
                        <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                      </span>
                    ) : null}
                    <code className="font-mono text-xs leading-snug">{row.role}</code>
                  </div>
                </td>
                <td className="px-4 py-3 align-top">
                  <code className="font-mono text-xs leading-snug">{row.accountCode}</code>
                </td>
                <td className="px-4 py-3 align-top leading-snug">
                  {row.accountName ?? (
                    <span className="text-destructive">ไม่พบในผังบัญชี</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right align-top tabular-nums leading-snug">
                  {row.priority}
                </td>
                <td className="px-4 py-3 text-center align-top">
                  {row.isActive ? (
                    <Badge variant="success" className="leading-snug">ใช้งาน</Badge>
                  ) : (
                    <Badge variant="secondary" className="leading-snug">ปิด</Badge>
                  )}
                </td>
                <td className="px-4 py-3 align-top text-muted-foreground leading-snug">
                  {row.note ?? '—'}
                </td>
                <td className="px-4 py-3 text-right align-top">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onEdit(row)}
                    aria-label={`แก้ไข ${row.role}`}
                  >
                    แก้ไข
                  </Button>
                </td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </div>
  );
}

function EditRoleMapDialog({
  row,
  open,
  onOpenChange,
  onSuccess,
}: {
  row: RoleMapRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [accountCode, setAccountCode] = useState(row.accountCode);
  const [priority, setPriority] = useState(String(row.priority));
  const [isActive, setIsActive] = useState(row.isActive);
  const [note, setNote] = useState(row.note ?? '');
  const [coaOpen, setCoaOpen] = useState(false);

  const coaQuery = useQuery<ChartOfAccount[]>({
    queryKey: ['chart-of-accounts', 'active'],
    queryFn: async () =>
      (await api.get<ChartOfAccount[]>('/chart-of-accounts', { params: { status: 'ใช้งาน' } })).data,
    enabled: open,
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {};
      const trimmedNote = note.trim();
      if (accountCode !== row.accountCode) payload.accountCode = accountCode;
      const priorityNum = Number.parseInt(priority, 10);
      if (Number.isFinite(priorityNum) && priorityNum !== row.priority) {
        payload.priority = priorityNum;
      }
      if (isActive !== row.isActive) payload.isActive = isActive;
      if (trimmedNote !== (row.note ?? '')) {
        payload.note = trimmedNote === '' ? null : trimmedNote;
      }
      if (Object.keys(payload).length === 0) {
        throw new Error('ไม่มีการเปลี่ยนแปลง');
      }
      return (await api.put(`/settings/role-map/${row.id}`, payload)).data;
    },
    onSuccess: () => {
      toast.success('บันทึก role mapping สำเร็จ');
      onSuccess();
    },
    onError: (err) => {
      toast.error(getErrorMessage(err));
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="leading-snug">
            แก้ไข role: <code className="font-mono text-sm">{row.role}</code>
          </DialogTitle>
          <DialogDescription className="leading-snug">
            การเปลี่ยนแปลงจะมีผลกับ JE templates ที่อ้างถึง role นี้ทันที (ผ่าน in-memory cache)
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {/* CoA combobox */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium leading-snug" htmlFor="ar-coa-trigger">
              รหัสบัญชี
            </label>
            <Popover open={coaOpen} onOpenChange={setCoaOpen}>
              <PopoverTrigger asChild>
                <Button
                  id="ar-coa-trigger"
                  variant="outline"
                  role="combobox"
                  aria-expanded={coaOpen}
                  className="w-full justify-between font-mono"
                >
                  {accountCode || 'เลือกบัญชี...'}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                <Command>
                  <CommandInput placeholder="ค้นหารหัส/ชื่อบัญชี..." />
                  <CommandList>
                    <CommandEmpty>ไม่พบบัญชี</CommandEmpty>
                    <CommandGroup>
                      {(coaQuery.data ?? []).map((acc) => (
                        <CommandItem
                          key={acc.id}
                          value={`${acc.code} ${acc.name}`}
                          onSelect={() => {
                            setAccountCode(acc.code);
                            setCoaOpen(false);
                          }}
                        >
                          <Check
                            className={cn(
                              'mr-2 h-4 w-4',
                              accountCode === acc.code ? 'opacity-100' : 'opacity-0',
                            )}
                            aria-hidden
                          />
                          <code className="mr-2 font-mono text-xs">{acc.code}</code>
                          <span className="leading-snug">{acc.name}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {/* Priority */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium leading-snug" htmlFor="ar-priority">
              ลำดับความสำคัญ (Priority)
            </label>
            <Input
              id="ar-priority"
              type="number"
              min={1}
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            />
            <p className="text-xs text-muted-foreground leading-snug">
              เลขต่ำกว่าจะถูกใช้ก่อน เมื่อ role เดียวกันมีหลายแถว
            </p>
          </div>

          {/* isActive */}
          <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/40 p-3">
            <div className="flex flex-col">
              <label htmlFor="ar-active" className="text-sm font-medium leading-snug">
                เปิดใช้งาน
              </label>
              {row.required ? (
                <p className="text-xs text-muted-foreground leading-snug">
                  Role นี้จำเป็นสำหรับระบบ — ปิดใช้งานไม่ได้
                </p>
              ) : (
                <p className="text-xs text-muted-foreground leading-snug">
                  ปิดการใช้งานจะทำให้ JE templates ที่อ้างถึง role นี้ throw error
                </p>
              )}
            </div>
            <Switch
              id="ar-active"
              checked={isActive}
              onCheckedChange={setIsActive}
              disabled={row.required && isActive}
              aria-label="เปิดใช้งาน"
            />
          </div>

          {/* Note */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium leading-snug" htmlFor="ar-note">
              หมายเหตุ
            </label>
            <Input
              id="ar-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              placeholder="(ว่างเปล่า = ลบหมายเหตุ)"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={updateMutation.isPending}
          >
            ยกเลิก
          </Button>
          <Button
            onClick={() => updateMutation.mutate()}
            disabled={updateMutation.isPending}
          >
            {updateMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
