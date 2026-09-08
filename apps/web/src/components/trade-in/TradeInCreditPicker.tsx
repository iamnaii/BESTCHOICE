import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AvailableTradeInCredit } from '@installment/shared';
import api from '@/lib/api';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

export default function TradeInCreditPicker({ customerId, branchId, productId, value, disabled,
  onChange, onResolved }: { customerId?: string; branchId?: string; productId?: string; value: string; disabled?: boolean;
    onChange: (id: string) => void; onResolved: (credit: AvailableTradeInCredit | null) => void }) {
  const resolve = useRef(onResolved);
  resolve.current = onResolved;
  const query = useQuery<AvailableTradeInCredit[]>({
    queryKey: ['trade-in-credits', customerId, branchId, productId],
    queryFn: async () => (await api.get('/trade-ins/credits', { params: { customerId, branchId } })).data,
    enabled: !!customerId && !!branchId,
    staleTime: 0,
  });
  const rows = query.isFetchedAfterMount && !query.isError ? query.data ?? [] : [];
  const selected = rows.find((row) => row.id === value) ?? null;
  useEffect(() => { resolve.current(selected); }, [selected]);
  if (!customerId || !branchId) return null;
  return <div className="rounded-xl border p-4 space-y-2">
    <Label htmlFor="trade-in-credit">เครดิตเครื่องเทิร์นของลูกค้า</Label>
    <select id="trade-in-credit" className="w-full h-10 rounded-lg border bg-background px-3 text-sm"
      value={value} disabled={disabled || query.isPending}
      onChange={(e) => onChange(e.target.value)}>
      <option value="">ไม่ใช้เครดิตเทิร์น</option>
      {value && !selected && <option value={value}>กำลังตรวจเครดิตที่เลือก</option>}
      {rows.map((row) => <option key={row.id} value={row.id}>{row.voucherNumber ?? row.id.slice(0, 8)} · {row.deviceLabel} · {Number(row.totalAmount).toLocaleString()} บาท</option>)}
    </select>
    {query.isPending && <p role="status" className="text-xs">กำลังตรวจเครดิตคงเหลือ…</p>}
    {query.isError && <div role="alert" className="text-xs text-destructive">ตรวจเครดิตไม่ได้ <Button size="sm" variant="outline" onClick={() => query.refetch()}>ลองใหม่</Button></div>}
    {value && !selected && !query.isPending && <p role="alert" className="text-xs text-destructive">เครดิตที่เลือกยังไม่พร้อมใช้ กรุณาตรวจใหม่หรือเลือกไม่ใช้เครดิต</p>}
    {selected && <p className="text-xs text-muted-foreground">มูลค่าเครื่อง {Number(selected.baseAmount).toLocaleString()} บาท + โบนัสส่วนลด {Number(selected.bonusAmount).toLocaleString()} บาท · ใช้เต็มยอดครั้งเดียวในสาขาที่รับเครื่อง</p>}
  </div>;
}
