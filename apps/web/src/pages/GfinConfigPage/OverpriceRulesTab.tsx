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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Pencil, Trash2 } from 'lucide-react';

interface OverpriceRule {
  id: string;
  label: string;
  seriesPattern: string;
  condition: 'HAND_1' | 'HAND_2';
  allowance: string;
  isActive: boolean;
  updatedAt: string;
}

export function OverpriceRulesTab() {
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<OverpriceRule | null>(null);
  const [creating, setCreating] = useState(false);
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery<OverpriceRule[]>({
    queryKey: ['gfin-overprice-rules'],
    queryFn: async () => {
      const { data: rows } = await api.get<OverpriceRule[]>('/gfin-config/overprice-rules');
      return rows;
    },
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/gfin-config/overprice-rules/${id}`, { isActive }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gfin-overprice-rules'] });
      toast.success('บันทึกแล้ว');
    },
    onError: () => toast.error('บันทึกไม่สำเร็จ'),
  });

  const deleteRow = useMutation({
    mutationFn: (id: string) => api.delete(`/gfin-config/overprice-rules/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gfin-overprice-rules'] });
      toast.success('ลบแล้ว');
    },
    onError: () => toast.error('ลบไม่สำเร็จ'),
  });

  if (isLoading) return <div className="p-4 text-muted-foreground">กำลังโหลด...</div>;
  if (error) return <div className="p-4 text-destructive">เกิดข้อผิดพลาด — โปรดลองรีเฟรช</div>;

  const filtered = (data ?? []).filter(
    (r) =>
      r.label.toLowerCase().includes(search.toLowerCase()) ||
      r.seriesPattern.toLowerCase().includes(search.toLowerCase()),
  );

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
          placeholder="ค้นหา label หรือ pattern..."
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
            <TableHead>Label</TableHead>
            <TableHead>Series Pattern</TableHead>
            <TableHead>สภาพ</TableHead>
            <TableHead className="text-right">Allowance (฿)</TableHead>
            <TableHead>ใช้งาน</TableHead>
            <TableHead>การกระทำ</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((row) => (
            <TableRow key={row.id}>
              <TableCell>{row.label}</TableCell>
              <TableCell className="font-mono text-xs">{row.seriesPattern}</TableCell>
              <TableCell>{row.condition === 'HAND_1' ? 'มือ 1' : 'มือ 2'}</TableCell>
              <TableCell className="text-right">
                {Number(row.allowance).toLocaleString('th-TH')}
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
                      if (confirm(`ลบ "${row.label}"?`)) {
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
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                ไม่พบรายการ
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {(editing || creating) && (
        <OverpriceRuleFormDialog
          initial={editing}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['gfin-overprice-rules'] });
            setEditing(null);
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}

interface DialogProps {
  initial: OverpriceRule | null;
  onClose: () => void;
  onSaved: () => void;
}

function OverpriceRuleFormDialog({ initial, onClose, onSaved }: DialogProps) {
  const [form, setForm] = useState({
    label: initial?.label ?? '',
    seriesPattern: initial?.seriesPattern ?? '',
    condition: (initial?.condition ?? 'HAND_2') as 'HAND_1' | 'HAND_2',
    allowance: initial?.allowance ?? '',
  });

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        ...form,
        allowance: Number(form.allowance),
      };
      return initial
        ? api.patch(`/gfin-config/overprice-rules/${initial.id}`, payload)
        : api.post('/gfin-config/overprice-rules', payload);
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
          <DialogTitle>{initial ? 'แก้ไข' : 'เพิ่ม'} Over Price Rule</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium">Label</label>
            <Input
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              placeholder="เช่น iPhone 14 Series มือ 2"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Series Pattern</label>
            <Input
              value={form.seriesPattern}
              onChange={(e) => setForm((f) => ({ ...f, seriesPattern: e.target.value }))}
              placeholder="เช่น iPhone 14|iPhone 15"
            />
            <p className="text-xs text-muted-foreground mt-1 leading-snug">
              ใช้ | คั่นหลาย series เช่น iPhone 14|iPhone 15
            </p>
          </div>
          <div>
            <label className="text-sm font-medium">สภาพ</label>
            <Select
              value={form.condition}
              onValueChange={(v) =>
                setForm((f) => ({ ...f, condition: v as 'HAND_1' | 'HAND_2' }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="HAND_1">มือ 1</SelectItem>
                <SelectItem value="HAND_2">มือ 2</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium">Allowance (฿)</label>
            <Input
              type="number"
              step="0.01"
              value={form.allowance}
              onChange={(e) => setForm((f) => ({ ...f, allowance: e.target.value }))}
              placeholder="เช่น 500"
            />
            <p className="text-xs text-muted-foreground mt-1 leading-snug">
              ราคาที่อนุญาตให้เกินได้จาก max price ของ GFIN
            </p>
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
