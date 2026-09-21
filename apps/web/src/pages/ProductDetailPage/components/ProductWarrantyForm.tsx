import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';

interface Props {
  product: { id: string; shopWarrantyDays?: number | null; warrantyTerms?: string | null };
  canEdit: boolean;
}

export default function ProductWarrantyForm({ product, canEdit }: Props) {
  const queryClient = useQueryClient();
  const serverDays = product.shopWarrantyDays == null ? '' : String(product.shopWarrantyDays);
  const serverTerms = product.warrantyTerms ?? '';
  const [days, setDays] = useState(serverDays);
  const [terms, setTerms] = useState(serverTerms);
  useEffect(() => { setDays(serverDays); }, [product.id, serverDays]);
  useEffect(() => { setTerms(serverTerms); }, [product.id, serverTerms]);

  const validDays = days === '' || (Number.isSafeInteger(Number(days)) && Number(days) >= 0);
  const dirty = days !== serverDays || terms !== serverTerms;
  const save = useMutation({
    mutationFn: () => api.patch(`/products/${product.id}/online-listing`, {
      ...(days !== serverDays ? { shopWarrantyDays: days === '' ? null : Number(days) } : {}),
      ...(terms !== serverTerms ? { warrantyTerms: terms.trim() || null } : {}),
    }),
    onSuccess: async () => {
      setTerms(terms.trim());
      await Promise.all([['product', product.id], ['stock-list'], ['products'], ['pos-products'], ['products-available']].map(queryKey => queryClient.invalidateQueries({ queryKey })));
      toast.success('บันทึกประกันเครื่องสำเร็จ');
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error)),
  });

  return (
    <form
      className="bg-card rounded-lg border p-4 space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (canEdit && dirty && validDays && !save.isPending) save.mutate();
      }}
    >
      <h2 className="text-sm font-semibold">ประกันเครื่องนี้</h2>
      <div>
        <label htmlFor="shop-warranty-days" className="block text-sm mb-1">ระยะเวลาประกันร้าน (วัน)</label>
        <input
          id="shop-warranty-days"
          type="number"
          min={0}
          step={1}
          value={days}
          onChange={(event) => setDays(event.target.value)}
          disabled={!canEdit || save.isPending}
          aria-describedby="shop-warranty-days-hint"
          className="w-full h-10 rounded-lg border border-input bg-background px-3 text-sm disabled:opacity-50"
        />
        <p id="shop-warranty-days-hint" className="mt-1 text-xs text-muted-foreground">
          เว้นว่าง = ใช้ประกันมาตรฐานของร้าน · 0 = ไม่มีประกันร้าน · จำนวนวันที่ระบุสำหรับเครื่องนี้มีผลก่อนค่ามาตรฐาน
        </p>
      </div>
      <div>
        <label htmlFor="warranty-terms" className="block text-sm mb-1">ผู้รับประกันและเงื่อนไขความคุ้มครอง</label>
        <textarea
          id="warranty-terms"
          value={terms}
          onChange={(event) => setTerms(event.target.value)}
          disabled={!canEdit || save.isPending}
          maxLength={2000}
          rows={4}
          placeholder="ระบุผู้รับประกัน ความคุ้มครอง ข้อยกเว้น และวิธีติดต่อเคลมของเครื่องนี้"
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm disabled:opacity-50"
        />
        <p className="text-xs text-muted-foreground">แสดงบนหน้าสินค้าตามเครื่องที่ลูกค้าเลือก · {terms.length}/2000</p>
      </div>
      <button
        type="submit"
        disabled={!canEdit || !dirty || !validDays || save.isPending}
        className="px-3 py-2 bg-primary text-primary-foreground rounded text-xs font-medium disabled:opacity-50"
      >
        {save.isPending ? 'กำลังบันทึก...' : 'บันทึกประกันเครื่อง'}
      </button>
    </form>
  );
}
