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

interface MaxPrice {
  id: string;
  gfinSeries: string;
  gfinVariant: string | null;
  storage: string;
  condition: 'HAND_1' | 'HAND_2';
  maxPrice: string;
  modelMatchPattern: string;
  isActive: boolean;
  updatedAt: string;
}

export function MaxPricesTab() {
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<MaxPrice | null>(null);
  const [creating, setCreating] = useState(false);
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery<MaxPrice[]>({
    queryKey: ['gfin-max-prices'],
    queryFn: async () => {
      const { data: rows } = await api.get<MaxPrice[]>('/gfin-config/max-prices');
      return rows;
    },
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/gfin-config/max-prices/${id}`, { isActive }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gfin-max-prices'] });
      toast.success('บันทึกแล้ว');
    },
    onError: () => toast.error('บันทึกไม่สำเร็จ'),
  });

  const deleteRow = useMutation({
    mutationFn: (id: string) => api.delete(`/gfin-config/max-prices/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gfin-max-prices'] });
      toast.success('ลบแล้ว');
    },
    onError: () => toast.error('ลบไม่สำเร็จ'),
  });

  if (isLoading) return <div className="p-4 text-muted-foreground">กำลังโหลด...</div>;
  if (error) return <div className="p-4 text-destructive">เกิดข้อผิดพลาด — โปรดลองรีเฟรช</div>;

  const filtered = (data ?? []).filter(
    (r) =>
      r.gfinSeries.toLowerCase().includes(search.toLowerCase()) ||
      r.modelMatchPattern.toLowerCase().includes(search.toLowerCase()),
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
          placeholder="ค้นหา series หรือ pattern..."
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
            <TableHead>Series</TableHead>
            <TableHead>Variant</TableHead>
            <TableHead>Storage</TableHead>
            <TableHead>สภาพ</TableHead>
            <TableHead className="text-right">ราคาสูงสุด</TableHead>
            <TableHead>Match Pattern</TableHead>
            <TableHead>ใช้งาน</TableHead>
            <TableHead>การกระทำ</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((row) => (
            <TableRow key={row.id}>
              <TableCell>{row.gfinSeries}</TableCell>
              <TableCell>{row.gfinVariant ?? '—'}</TableCell>
              <TableCell>{row.storage}</TableCell>
              <TableCell>{row.condition === 'HAND_1' ? 'มือ 1' : 'มือ 2'}</TableCell>
              <TableCell className="text-right">
                {Number(row.maxPrice).toLocaleString('th-TH')}
              </TableCell>
              <TableCell className="font-mono text-xs">{row.modelMatchPattern}</TableCell>
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
                      if (
                        confirm(
                          `ลบ ${row.gfinSeries} ${row.gfinVariant ?? ''} ${row.storage}?`,
                        )
                      ) {
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
              <TableCell colSpan={8} className="text-center text-muted-foreground">
                ไม่พบรายการ
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {(editing || creating) && (
        <MaxPriceFormDialog
          initial={editing}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['gfin-max-prices'] });
            setEditing(null);
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}

interface DialogProps {
  initial: MaxPrice | null;
  onClose: () => void;
  onSaved: () => void;
}

function MaxPriceFormDialog({ initial, onClose, onSaved }: DialogProps) {
  const [form, setForm] = useState({
    gfinSeries: initial?.gfinSeries ?? '',
    gfinVariant: initial?.gfinVariant ?? '',
    storage: initial?.storage ?? '',
    condition: (initial?.condition ?? 'HAND_2') as 'HAND_1' | 'HAND_2',
    maxPrice: initial?.maxPrice ?? '',
    modelMatchPattern: initial?.modelMatchPattern ?? '',
  });

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        ...form,
        gfinVariant: form.gfinVariant || null,
        maxPrice: Number(form.maxPrice),
      };
      return initial
        ? api.patch(`/gfin-config/max-prices/${initial.id}`, payload)
        : api.post('/gfin-config/max-prices', payload);
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
          <DialogTitle>{initial ? 'แก้ไข' : 'เพิ่ม'} ราคาสูงสุด GFIN</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium">Series</label>
            <Input
              value={form.gfinSeries}
              onChange={(e) => setForm((f) => ({ ...f, gfinSeries: e.target.value }))}
              placeholder="เช่น iPhone 14"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Variant (ปล่อยว่างถ้าไม่มี)</label>
            <Input
              value={form.gfinVariant}
              onChange={(e) => setForm((f) => ({ ...f, gfinVariant: e.target.value }))}
              placeholder="เช่น Pro, Pro Max, Plus"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Storage</label>
            <Input
              value={form.storage}
              onChange={(e) => setForm((f) => ({ ...f, storage: e.target.value }))}
              placeholder="เช่น 128GB"
            />
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
            <label className="text-sm font-medium">ราคาสูงสุด (฿)</label>
            <Input
              type="number"
              step="0.01"
              value={form.maxPrice}
              onChange={(e) => setForm((f) => ({ ...f, maxPrice: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-sm font-medium">Model Match Pattern</label>
            <Input
              value={form.modelMatchPattern}
              onChange={(e) =>
                setForm((f) => ({ ...f, modelMatchPattern: e.target.value }))
              }
              placeholder="เช่น iPhone 14 Pro"
            />
            <p className="text-xs text-muted-foreground mt-1 leading-snug">
              ใช้สำหรับ match กับ Product.model — ระบบหา substring ของ pattern นี้ใน model
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
