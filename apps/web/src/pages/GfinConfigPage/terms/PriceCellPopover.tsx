import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { NumberInput } from '@/components/ui/NumberInput';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { GFIN_QUERY_KEYS } from '@/pages/ProductDetailPage/hooks/gfinQueryKeys';
import { parseGfinPrice } from '../gfinPriceListImport';
import { HAND_LABEL, type ModelTermsRow, type PriceCell } from './modelTerms';

const fmt = (n: number) => n.toLocaleString('th-TH');

/** กดช่องราคา → แก้ราคา / ปิด / เปิดคืน / ใส่ราคาช่องว่าง (สเปก §6.2 ข้อ 4) */
export function PriceCellPopover({ row, cell, canEdit }: { row: ModelTermsRow; cell: PriceCell; canEdit: boolean }) {
  const qc = useQueryClient();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const hand = HAND_LABEL[row.condition];
  const shown = cell.price === null ? '—' : fmt(cell.price);

  const save = useMutation({
    mutationFn: (body: { maxPrice?: number; isActive: boolean }) =>
      cell.mappingId
        ? api.patch(`/gfin-config/max-prices/${cell.mappingId}`, body)
        : api.post('/gfin-config/max-prices', {
            gfinSeries: row.series,
            gfinVariant: null,
            storage: cell.storage,
            condition: row.condition,
            maxPrice: body.maxPrice,
            modelMatchPattern: row.series,
            isActive: true,
          }),
    onSuccess: (_d, body) => {
      void qc.invalidateQueries({ queryKey: GFIN_QUERY_KEYS.prices });
      toast.success(
        body.isActive ? `บันทึกราคา ${row.series} ${cell.storage} ${hand} แล้ว` : `ปิดราคา ${row.series} ${cell.storage} ${hand} แล้ว`,
      );
      setOpen(false);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  if (!canEdit) return <span className="tabular-nums">{shown}</span>;

  const price = parseGfinPrice(value);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setValue(cell.price === null ? '' : String(cell.price));
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="rounded px-1 tabular-nums hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`${row.series} ${cell.storage} ${hand} ${cell.price === null ? 'ไม่มีราคา' : `ราคา ${shown}`}`}
        >
          {shown}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-3">
        <p className="font-medium leading-snug">
          {row.series} · {cell.storage} · {hand}
        </p>
        <div>
          <label htmlFor={id} className="text-sm leading-snug">
            ราคาสูงสุดที่ GFIN รับ (บาท)
          </label>
          <NumberInput id={id} min="1" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <p className="text-sm text-muted-foreground leading-snug">
          {row.allowance === null
            ? 'ยังไม่ตั้งเงื่อนไข — ราคาส่งยังคิดไม่ได้'
            : price !== null
              ? `ราคาส่ง GFIN = ราคานี้ + OVER ${fmt(row.allowance)} = ${fmt(price + row.allowance)}`
              : `ราคาส่ง GFIN = ราคานี้ + OVER ${fmt(row.allowance)}`}
        </p>
        <div className="flex flex-wrap justify-between gap-2">
          {cell.price !== null ? (
            <Button variant="outline" size="sm" onClick={() => save.mutate({ isActive: false })} disabled={save.isPending}>
              GFIN ไม่รับแล้ว (ปิด)
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={save.isPending}>
              ยกเลิก
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => price !== null && save.mutate({ maxPrice: price, isActive: true })}
              disabled={save.isPending || price === null}
            >
              บันทึก
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground leading-snug">
          ปิดแล้วช่องนี้เป็น "—" · กดช่อง "—" เพื่อเปิดคืนหรือใส่ราคาใหม่ · ทุกการแก้เก็บประวัติ
        </p>
      </PopoverContent>
    </Popover>
  );
}
