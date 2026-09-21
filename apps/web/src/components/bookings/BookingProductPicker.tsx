import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useDebounce } from '@/hooks/useDebounce';
import api from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { getPositiveDisplayPrices, normalizePositive, type ProductForDisplay } from '@/utils/getDisplayPrices';

type BookingProduct = ProductForDisplay & {
  id: string; name: string; imeiSerial?: string | null; branchId: string;
  status: string; wasPreviouslyDamaged?: boolean;
};

export default function BookingProductPicker({ branchId, selectedId, onSelect, onClear }: {
  branchId: string; selectedId?: string;
  onSelect: (selection: { productId: string; description: string; quantity: number; unitPrice: number }) => void;
  onClear: () => void;
}) {
  const [search, setSearch] = useState('');
  const term = useDebounce(search.trim());
  const { data = [], isFetching, isError, refetch } = useQuery<BookingProduct[]>({
    queryKey: ['booking-products', branchId, term],
    enabled: !!branchId && !selectedId && term.length >= 2,
    queryFn: async () => (await api.get('/products', {
      params: { branchId, search: term, status: 'IN_STOCK', limit: 10 },
    })).data.data ?? [],
  });
  if (selectedId) return <div className="flex items-center justify-between gap-3 text-sm">
    <span className="text-primary">ผูกเครื่องในสต็อกแล้ว</span>
    <Button type="button" size="sm" variant="outline" onClick={() => { setSearch(''); onClear(); }}>เปลี่ยนเครื่อง</Button>
  </div>;
  return <div className="space-y-2">
    <Input aria-label="ค้นหาเครื่องในสาขา" placeholder={branchId ? 'ค้นหาชื่อเครื่อง หรือ IMEI / Serial อย่างน้อย 2 ตัวอักษร' : 'เลือกสาขาก่อนค้นหาเครื่อง'}
      disabled={!branchId} value={search} onChange={event => setSearch(event.target.value)} />
    {term.length >= 2 && branchId && <div className="max-h-48 overflow-y-auto rounded-md border border-border" aria-live="polite">
      {isError ? <div className="p-3 text-sm">ค้นหาสินค้าไม่สำเร็จ <Button variant="outline" size="sm" onClick={() => refetch()}>ลองใหม่</Button></div>
        : isFetching ? <p className="p-3 text-sm text-muted-foreground">กำลังค้นหาเครื่อง...</p>
        : data.filter(product => product.branchId === branchId && product.status === 'IN_STOCK').length === 0
          ? <p className="p-3 text-sm text-muted-foreground">ไม่พบเครื่องพร้อมขายในสาขานี้</p>
          : data.filter(product => product.branchId === branchId && product.status === 'IN_STOCK').map(product => {
            const cash = normalizePositive(getPositiveDisplayPrices({ ...product, prices: product.prices ?? [] }).cash);
            return <button type="button" key={product.id} disabled={cash === null}
              className="block w-full border-b border-border p-3 text-left text-sm last:border-b-0 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              onClick={() => onSelect({ productId: product.id, description: `${product.name}${product.imeiSerial ? ` · ${product.imeiSerial}` : ''}`, quantity: 1, unitPrice: cash! })}>
              <span className="block font-medium">{product.name}</span>
              <span className="block break-all text-xs text-muted-foreground">IMEI / Serial: {product.imeiSerial || 'ไม่ระบุ'} · พร้อมขาย</span>
              <span className="block">{cash === null ? 'ยังไม่ได้ตั้งราคาเงินสด' : `ราคาเงินสด ${cash.toLocaleString('th-TH')} บาท`}</span>
              {product.wasPreviouslyDamaged && <span className="block text-warning-strong">มีประวัติเสียหาย ต้องให้ผู้มีสิทธิ์ยืนยันก่อนขาย</span>}
            </button>;
          })}
    </div>}
  </div>;
}
