import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Pencil, Trash2 } from 'lucide-react';

interface RateFactor {
  id: string;
  months: number;
  factor: string;
  feePerInstallment: string;
  isActive: boolean;
  updatedAt: string;
}

export function RateFactorsTab() {
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<RateFactor | null>(null);
  const [creating, setCreating] = useState(false);
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery<RateFactor[]>({
    queryKey: ['gfin-rate-factors'],
    queryFn: async () => {
      const { data: rows } = await api.get<RateFactor[]>('/gfin-config/rate-factors');
      return rows;
    },
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/gfin-config/rate-factors/${id}`, { isActive }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gfin-rate-factors'] });
      toast.success('บันทึกแล้ว');
    },
    onError: () => toast.error('บันทึกไม่สำเร็จ'),
  });

  const deleteRow = useMutation({
    mutationFn: (id: string) => api.delete(`/gfin-config/rate-factors/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gfin-rate-factors'] });
      toast.success('ลบแล้ว');
    },
    onError: () => toast.error('ลบไม่สำเร็จ'),
  });

  if (isLoading) return <div className="p-4 text-muted-foreground">กำลังโหลด...</div>;
  if (error) return <div className="p-4 text-destructive">เกิดข้อผิดพลาด — โปรดลองรีเฟรช</div>;

  const filtered = (data ?? []).filter((r) => String(r.months).includes(search));

  const lastUpdated =
    data && data.length > 0
      ? new Date(Math.max(...data.map((r) => new Date(r.updatedAt).getTime())))
      : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{data?.length ?? 0} รายการ</span>
        {lastUpdated && (
          <span>อัปเดตล่าสุด: {lastUpdated.toLocaleString('th-TH')}</span>
        )}
      </div>
      <div className="flex gap-2">
        <Input
          placeholder="ค้นหาจำนวนงวด..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />
        <Button variant="primary" onClick={() => setCreating(true)}>
          + เพิ่ม
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-right">จำนวนงวด (เดือน)</TableHead>
            <TableHead className="text-right">Factor</TableHead>
            <TableHead className="text-right">ค่าธรรมเนียมต่องวด (฿)</TableHead>
            <TableHead>ใช้งาน</TableHead>
            <TableHead>การกระทำ</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="text-right font-medium">{row.months}</TableCell>
              <TableCell className="text-right font-mono">{row.factor}</TableCell>
              <TableCell className="text-right">
                {Number(row.feePerInstallment).toLocaleString('th-TH')}
              </TableCell>
              <TableCell>
                <Switch
                  checked={row.isActive}
                  onCheckedChange={(v) => toggleActive.mutate({ id: row.id, isActive: v })}
                />
              </TableCell>
              <TableCell>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(row)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (confirm(`ลบ ${row.months} งวด?`)) {
                        deleteRow.mutate(row.id);
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                ไม่พบรายการ
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {(editing || creating) && (
        <RateFactorFormDialog
          initial={editing}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['gfin-rate-factors'] });
            setEditing(null);
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}

interface DialogProps {
  initial: RateFactor | null;
  onClose: () => void;
  onSaved: () => void;
}

function RateFactorFormDialog({ initial, onClose, onSaved }: DialogProps) {
  const [form, setForm] = useState({
    months: initial ? String(initial.months) : '',
    factor: initial?.factor ?? '',
    feePerInstallment: initial?.feePerInstallment ?? '',
  });

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        months: Number(form.months),
        factor: form.factor,
        feePerInstallment: Number(form.feePerInstallment),
      };
      return initial
        ? api.patch(`/gfin-config/rate-factors/${initial.id}`, payload)
        : api.post('/gfin-config/rate-factors', payload);
    },
    onSuccess: () => {
      toast.success(initial ? 'บันทึกแล้ว' : 'เพิ่มแล้ว');
      onSaved();
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (err: any) =>
      toast.error(err.response?.data?.message ?? 'บันทึกไม่สำเร็จ'),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? 'แก้ไข' : 'เพิ่ม'} Rate Factor</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium">จำนวนงวด (เดือน)</label>
            <Input
              type="number"
              min="1"
              value={form.months}
              onChange={(e) => setForm((f) => ({ ...f, months: e.target.value }))}
              placeholder="เช่น 12"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Factor (6 ทศนิยม)</label>
            <Input
              value={form.factor}
              onChange={(e) => setForm((f) => ({ ...f, factor: e.target.value }))}
              placeholder="เช่น 0.090000"
            />
            <p className="text-xs text-muted-foreground mt-1 leading-snug">
              ค่า factor ที่ใช้คำนวณค่างวด — ระบุทศนิยม 6 หลัก
            </p>
          </div>
          <div>
            <label className="text-sm font-medium">ค่าธรรมเนียมต่องวด (฿)</label>
            <Input
              type="number"
              step="0.01"
              value={form.feePerInstallment}
              onChange={(e) =>
                setForm((f) => ({ ...f, feePerInstallment: e.target.value }))
              }
              placeholder="เช่น 0"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button variant="primary" onClick={() => save.mutate()} disabled={save.isPending}>
            บันทึก
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
