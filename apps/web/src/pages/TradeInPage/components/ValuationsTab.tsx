import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface ValuationRow {
  id: string;
  brand: string;
  model: string;
  storage: string;
  condition: string;
  basePrice: string | number;
  note: string | null;
}

interface ValuationsResponse {
  data: ValuationRow[];
  total: number;
  page: number;
  limit: number;
}

const EMPTY_FORM = { brand: 'Apple', model: '', storage: '', condition: 'A', basePrice: '' };

/**
 * ตารางราคากลาง (TradeInValuation CRUD) — แถว condition A ของ Apple/iPhone
 * = "ราคารับซื้อสูงสุด" ที่ลูกค้าเห็นบนเว็บ shop ทันที
 */
export default function ValuationsTab() {
  const queryClient = useQueryClient();
  const [brandInput, setBrandInput] = useState('Apple');
  const brand = useDebounce(brandInput, 400);
  const [page, setPage] = useState(1);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [form, setForm] = useState(EMPTY_FORM);

  // รีเซ็ตหน้ากลับ 1 เมื่อคำค้นหา (หลัง debounce) เปลี่ยน
  useEffect(() => {
    setPage(1);
  }, [brand]);

  const { data, isLoading } = useQuery<ValuationsResponse>({
    queryKey: ['trade-in-valuations', brand, page],
    queryFn: () =>
      api
        .get('/trade-ins/valuations', { params: { brand: brand || undefined, page, limit: 50 } })
        .then((r) => r.data),
  });

  const upsert = useMutation({
    mutationFn: (body: {
      brand: string;
      model: string;
      storage: string;
      condition: string;
      basePrice: number;
      rowId?: string;
    }) => {
      const { rowId, ...payload } = body;
      return api.post('/trade-ins/valuations', payload).then(() => ({ rowId }));
    },
    onSuccess: ({ rowId }) => {
      toast.success('บันทึกราคาแล้ว');
      queryClient.invalidateQueries({ queryKey: ['trade-in-valuations'] });
      if (rowId) {
        setEdits((prev) => {
          const next = { ...prev };
          delete next[rowId];
          return next;
        });
      } else {
        setForm(EMPTY_FORM);
      }
    },
    // เก็บ draft ที่พิมพ์ไว้ (edits/form) ไว้เหมือนเดิมถ้าบันทึกไม่สำเร็จ — ไม่ล้างทิ้ง
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  function saveRow(row: ValuationRow) {
    const price = Number(edits[row.id]);
    if (!Number.isFinite(price) || price <= 0) {
      toast.error('กรุณาระบุราคาให้ถูกต้อง');
      return;
    }
    upsert.mutate({
      brand: row.brand,
      model: row.model,
      storage: row.storage,
      condition: row.condition,
      basePrice: price,
      rowId: row.id,
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-warning/10 p-3 text-sm leading-snug">
        ⚠️ แถว Apple + เกรด A ของรุ่น iPhone = <strong>ราคารับซื้อสูงสุด</strong> ที่ลูกค้าเห็นบนเว็บทันที
        และราคาชุดนี้ยังใช้กับ quote เก่าแลกใหม่ + กรอบ ±15% ของการตีราคาหน้าร้านด้วย
      </div>

      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <Label>ยี่ห้อ</Label>
          <Input className="mt-1 w-40" value={brandInput} onChange={(e) => setBrandInput(e.target.value)} placeholder="เช่น Apple" />
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground leading-snug">กำลังโหลด...</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left">
              <tr>
                <th className="p-2">ยี่ห้อ</th>
                <th className="p-2">รุ่น</th>
                <th className="p-2">ความจุ</th>
                <th className="p-2">เกรด</th>
                <th className="p-2">ราคา (บาท)</th>
                <th className="p-2 w-24"></th>
              </tr>
            </thead>
            <tbody>
              {(data?.data ?? []).map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="p-2">{row.brand}</td>
                  <td className="p-2">{row.model}</td>
                  <td className="p-2">{row.storage}</td>
                  <td className="p-2">{row.condition}</td>
                  <td className="p-2">
                    <Input
                      className="w-28 h-8"
                      type="number"
                      value={edits[row.id] ?? String(Number(row.basePrice))}
                      onChange={(e) => setEdits((prev) => ({ ...prev, [row.id]: e.target.value }))}
                    />
                  </td>
                  <td className="p-2">
                    {edits[row.id] !== undefined && (
                      <Button size="sm" onClick={() => saveRow(row)} disabled={upsert.isPending}>
                        บันทึก
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {(data?.data ?? []).length === 0 && (
                <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">ไม่มีข้อมูล</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {(data?.total ?? 0) > 50 && (
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>ก่อนหน้า</Button>
          <Button variant="outline" size="sm" disabled={page * 50 >= (data?.total ?? 0)} onClick={() => setPage((p) => p + 1)}>ถัดไป</Button>
        </div>
      )}

      <div className="rounded-lg border border-border p-3 space-y-3">
        <div className="font-medium leading-snug">เพิ่มรุ่น / ราคาใหม่</div>
        <div className="grid gap-3 sm:grid-cols-5">
          <div><Label>ยี่ห้อ</Label><Input className="mt-1" value={form.brand} onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))} /></div>
          <div><Label>รุ่น</Label><Input className="mt-1" placeholder="iPhone 15" value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} /></div>
          <div><Label>ความจุ</Label><Input className="mt-1" placeholder="128GB" value={form.storage} onChange={(e) => setForm((f) => ({ ...f, storage: e.target.value }))} /></div>
          <div>
            <Label>เกรด</Label>
            <select
              className="mt-1 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm"
              value={form.condition}
              onChange={(e) => setForm((f) => ({ ...f, condition: e.target.value }))}
            >
              <option value="A">A (= ราคาสูงสุดบนเว็บ)</option>
              <option value="B">B</option>
              <option value="C">C</option>
              <option value="D">D</option>
            </select>
          </div>
          <div><Label>ราคา (บาท)</Label><Input className="mt-1" type="number" value={form.basePrice} onChange={(e) => setForm((f) => ({ ...f, basePrice: e.target.value }))} /></div>
        </div>
        <Button
          onClick={() => {
            const price = Number(form.basePrice);
            if (!form.model || !form.storage || !Number.isFinite(price) || price <= 0) {
              toast.error('กรอกรุ่น/ความจุ/ราคาให้ครบ');
              return;
            }
            upsert.mutate({ brand: form.brand, model: form.model, storage: form.storage, condition: form.condition, basePrice: price });
          }}
          disabled={upsert.isPending}
        >
          เพิ่ม
        </Button>
      </div>
    </div>
  );
}
