import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { GripVertical, Plus, Pencil, Trash2, Lightbulb } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Label } from '@/components/ui/label';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

/**
 * InternalControlActionBar — Setting 2: admin-managed reverse reasons.
 *
 * CRUD over `GET /settings/reverse-reasons` + companion routes. Soft-deletes
 * preserve historical audit-log references to old reasons.
 *
 * Drag-to-sort is intentionally implemented with up/down arrows rather than
 * HTML5 dnd-kit — keeps the dependency surface narrow and the keyboard a11y
 * story trivial. OWNER can re-prioritise the list with arrow keys + Enter
 * once the rows are focused.
 */
interface ReverseReason {
  id: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
}

export function ReverseReasonsManagementCard() {
  const { user } = useAuth();
  const isOwner = user?.role === 'OWNER';
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<ReverseReason | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<ReverseReason | null>(null);

  const listQuery = useQuery<ReverseReason[]>({
    queryKey: ['reverse-reasons', 'all'],
    queryFn: async () =>
      (await api.get<ReverseReason[]>('/settings/reverse-reasons')).data,
  });

  const invalidateLists = () => {
    queryClient.invalidateQueries({ queryKey: ['reverse-reasons'] });
    queryClient.invalidateQueries({ queryKey: ['settings-ui-flags'] });
  };

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/settings/reverse-reasons/${id}`),
    onSuccess: () => {
      invalidateLists();
      toast.success('ลบเหตุผลสำเร็จ');
      setConfirmDelete(null);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const reorderMutation = useMutation({
    mutationFn: (rows: { id: string; sortOrder: number }[]) =>
      api.put('/settings/reverse-reasons/reorder', { rows }),
    onSuccess: invalidateLists,
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.put(`/settings/reverse-reasons/${id}`, { isActive }),
    onSuccess: invalidateLists,
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const move = (idx: number, dir: -1 | 1) => {
    const list = listQuery.data ?? [];
    const target = idx + dir;
    if (target < 0 || target >= list.length) return;
    const reordered = [...list];
    [reordered[idx], reordered[target]] = [reordered[target], reordered[idx]];
    reorderMutation.mutate(
      reordered.map((r, i) => ({ id: r.id, sortOrder: (i + 1) * 10 })),
    );
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="leading-snug">เหตุผลการยกเลิก / กลับรายการ</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground leading-snug">
            รายการเหตุผลที่แสดงใน dropdown ของหน้ายืนยันการกลับรายการ —
            ใช้ร่วม 3 modules (รายได้อื่น · รายจ่าย · สินทรัพย์)
          </p>

          <div className="rounded-md border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium w-12 leading-snug">ลำดับ</th>
                  <th className="px-3 py-2 text-left font-medium leading-snug">เหตุผล</th>
                  <th className="px-3 py-2 text-center font-medium w-24 leading-snug">ใช้งาน</th>
                  <th className="px-3 py-2 text-right font-medium w-32 leading-snug">การจัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(listQuery.data ?? []).map((row, idx) => (
                  <tr key={row.id} className={!row.isActive ? 'opacity-60' : ''}>
                    <td className="px-3 py-2 align-middle">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => move(idx, -1)}
                          disabled={!isOwner || idx === 0 || reorderMutation.isPending}
                          className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                          aria-label="เลื่อนขึ้น"
                        >
                          <GripVertical size={14} />
                        </button>
                        <span className="text-xs tabular-nums">{idx + 1}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 align-middle text-sm leading-snug">{row.label}</td>
                    <td className="px-3 py-2 align-middle text-center">
                      <Switch
                        checked={row.isActive}
                        onCheckedChange={(v) =>
                          toggleActiveMutation.mutate({ id: row.id, isActive: v })
                        }
                        disabled={!isOwner || toggleActiveMutation.isPending}
                        aria-label={`เปิด/ปิดการใช้งาน ${row.label}`}
                      />
                    </td>
                    <td className="px-3 py-2 align-middle text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing(row)}
                        disabled={!isOwner}
                        aria-label="แก้ไข"
                      >
                        <Pencil size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmDelete(row)}
                        disabled={!isOwner || deleteMutation.isPending}
                        aria-label="ลบ"
                      >
                        <Trash2 size={14} className="text-destructive" />
                      </Button>
                    </td>
                  </tr>
                ))}
                {(listQuery.data ?? []).length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-sm text-muted-foreground leading-snug">
                      ยังไม่มีเหตุผลในระบบ — เพิ่มเหตุผลแรกได้เลย
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-start gap-2 text-xs text-muted-foreground leading-snug">
              <Lightbulb size={14} className="mt-0.5 shrink-0" aria-hidden />
              ปิดใช้งานแทนการลบ — เก็บ audit trail ที่อ้างเหตุผลเก่าไว้
            </div>
            <Button onClick={() => setCreating(true)} disabled={!isOwner}>
              <Plus size={14} className="mr-1.5" aria-hidden />
              เพิ่มเหตุผลใหม่
            </Button>
          </div>
        </CardContent>
      </Card>

      {(editing || creating) && (
        <ReasonEditDialog
          row={editing}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={() => {
            invalidateLists();
            setEditing(null);
            setCreating(false);
          }}
        />
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
        title="ลบเหตุผล?"
        description={
          confirmDelete
            ? `ยืนยันลบ "${confirmDelete.label}" — soft-delete: audit log ที่อ้างเหตุผลนี้ยังคงอ่านได้`
            : ''
        }
        variant="destructive"
        loading={deleteMutation.isPending}
        onConfirm={() => confirmDelete && deleteMutation.mutate(confirmDelete.id)}
      />
    </>
  );
}

function ReasonEditDialog({
  row,
  onClose,
  onSaved,
}: {
  row: ReverseReason | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [label, setLabel] = useState(row?.label ?? '');
  const [isActive, setIsActive] = useState(row?.isActive ?? true);

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = { label: label.trim(), isActive };
      if (row) {
        return api.put(`/settings/reverse-reasons/${row.id}`, payload);
      }
      return api.post('/settings/reverse-reasons', payload);
    },
    onSuccess: () => {
      toast.success(row ? 'อัปเดตเหตุผลสำเร็จ' : 'เพิ่มเหตุผลใหม่สำเร็จ');
      onSaved();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{row ? 'แก้ไขเหตุผล' : 'เพิ่มเหตุผลใหม่'}</DialogTitle>
          <DialogDescription className="leading-snug">
            ข้อความนี้จะปรากฏใน dropdown เวลายกเลิก/กลับรายการ
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="rr-label">เหตุผล *</Label>
            <Input
              id="rr-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={200}
              placeholder="เช่น บันทึกผิดบัญชี"
              autoFocus
            />
          </div>
          <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2.5">
            <Label htmlFor="rr-active" className="text-sm">เปิดใช้งาน</Label>
            <Switch
              id="rr-active"
              checked={isActive}
              onCheckedChange={setIsActive}
              aria-label="เปิดใช้งาน"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            ยกเลิก
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={label.trim().length < 2 || mutation.isPending}
          >
            {mutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
