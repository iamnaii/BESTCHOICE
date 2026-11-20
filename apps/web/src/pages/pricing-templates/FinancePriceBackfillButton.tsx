import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

const BACKFILL_URL = '/pricing-templates/backfill-finance-price';
/** ขึ้นต้นด้วย 'pricing-templates' ⇒ แก้/นำเข้าราคากลางแล้วจำนวนนับใหม่เอง (หน้าตั้งราคา invalidate prefix นี้) */
export const FINANCE_BACKFILL_COUNT_KEY = ['pricing-templates', 'finance-backfill-count'] as const;

/**
 * ปุ่ม "เติมราคาขาย GFIN ให้เครื่องในสต๊อก (N เครื่อง)" — สเปค 2026-11-19 ข้อ 3.2 / 7.5
 * นับก่อนด้วย dry run แล้วยืนยันใน dialog · เติมเฉพาะเครื่องพร้อมขายที่ช่องว่าง ไม่ทับค่าที่มี
 */
export function FinancePriceBackfillButton() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const countQuery = useQuery({
    queryKey: FINANCE_BACKFILL_COUNT_KEY,
    queryFn: async () => (await api.post<{ count: number }>(`${BACKFILL_URL}?dryRun=true`)).data.count,
  });

  const fill = useMutation({
    mutationFn: async () => (await api.post<{ count: number }>(BACKFILL_URL, undefined, { timeout: 120000 })).data.count,
    onSuccess: (count) => {
      toast.success(`เติมราคาขาย GFIN แล้ว ${count.toLocaleString('th-TH')} เครื่อง`);
      queryClient.invalidateQueries({ queryKey: ['stock'] });
      queryClient.invalidateQueries({ queryKey: ['stock-list'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['product'] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
    // สำเร็จหรือล้มก็นับใหม่ (ล้มกลางทางอาจเขียนไปแล้วบางชุด)
    onSettled: () => queryClient.invalidateQueries({ queryKey: FINANCE_BACKFILL_COUNT_KEY }),
  });

  const count = countQuery.data;
  const countText = count === undefined ? '' : count.toLocaleString('th-TH');
  const label =
    count === undefined
      ? 'เติมราคาขาย GFIN ให้เครื่องในสต๊อก'
      : `เติมราคาขาย GFIN ให้เครื่องในสต๊อก (${countText} เครื่อง)`;

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        data-ui-control="button"
        type="button"
        onClick={() => setOpen(true)}
        disabled={!count || fill.isPending}
        className="px-3 py-2 text-sm whitespace-nowrap text-muted-foreground border border-input rounded-lg hover:bg-muted/50 disabled:opacity-50"
      >
        {fill.isPending ? 'กำลังเติมราคา...' : label}
      </button>
      {countQuery.isError && (
        <p className="text-xs text-destructive leading-snug">{getErrorMessage(countQuery.error)}</p>
      )}
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="เติมราคาขาย GFIN"
        description={`เติมราคาขาย GFIN จากตารางราคากลางให้เครื่องในสต๊อกที่ยังว่าง ${countText} เครื่อง · เครื่องที่มีราคาขาย GFIN อยู่แล้วไม่ถูกแก้`}
        confirmLabel={`เติม ${countText} เครื่อง`}
        loading={fill.isPending}
        onConfirm={() => fill.mutate()}
      />
    </div>
  );
}
