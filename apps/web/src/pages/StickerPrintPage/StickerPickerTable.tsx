import { useMemo } from 'react';
import { AlertCircle, Check, Plus } from '@/lib/icons';
import DataTable, { type Column, type TableSort } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/button';
import { formatThaiDateShort } from '@/lib/date';
import { formatBaht } from '@/pages/ProductDetailPage/utils/buildCustomerSummary';
import type { StockProduct } from '@/pages/StockPage/types';
import { getPositiveDisplayPrices } from '@/utils/getDisplayPrices';

export const DEFAULT_PICKER_SORT: TableSort = { key: 'stockInDate', direction: 'desc' };

interface StickerPickerTableProps {
  products: StockProduct[];
  isLoading: boolean;
  /** productId → จำนวนดวงในคิว (ไม่อยู่ในคิว = ไม่มี key) */
  queued: Map<string, number>;
  sort: TableSort;
  onSortChange: (sort: TableSort | null) => void;
  pagination: { page: number; totalPages: number; total: number; onPageChange: (page: number) => void };
  /** ความสูงสูงสุดของตาราง — รายการเลื่อนในกรอบ หน้าไม่ยาวตามจำนวนแถว */
  maxHeight?: string;
  onAdd: (product: StockProduct) => void;
  onRemove: (productId: string) => void;
}

/**
 * ตารางเลือกเครื่องของหน้าพิมพ์สติกเกอร์ — แสดงเฉพาะสิ่งที่ใช้ "หาเครื่องให้เจอ" (รุ่น · สี/ความจุ · IMEI ·
 * วันที่รับเข้า · ราคาเงินสด) ส่วนค่างวด/แบต/ประกันดูที่ตัวอย่างดวงในคิว (ชุดเดียวกับที่พิมพ์จริง)
 * จำนวนดวงปรับที่คิวพิมพ์ — ตารางมีแค่ เพิ่ม / เอาออก
 */
export function StickerPickerTable({
  products,
  isLoading,
  queued,
  sort,
  onSortChange,
  pagination,
  maxHeight,
  onAdd,
  onRemove,
}: StickerPickerTableProps) {
  const columns = useMemo<Column<StockProduct>[]>(
    () => [
      {
        key: 'name',
        label: 'เครื่อง',
        sortable: true,
        render: (product) => {
          const spec = [product.color, product.storage].filter(Boolean).join(' · ');
          return (
            <div className="min-w-0 leading-snug">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="truncate font-semibold text-foreground">{product.model || product.name}</span>
                {product.category === 'PHONE_USED' && (
                  <span className="shrink-0 rounded bg-info/15 px-1.5 py-px text-[10px] font-semibold leading-snug text-info">
                    มือสอง
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                {spec && <span className="shrink-0">{spec}</span>}
                {spec && <span aria-hidden="true">·</span>}
                <span className="truncate font-mono">{product.imeiSerial ?? '—'}</span>
              </div>
            </div>
          );
        },
      },
      {
        key: 'stockInDate',
        label: 'รับเข้า',
        sortable: true,
        width: '92px',
        render: (product) => (
          <span className="text-xs tabular-nums whitespace-nowrap text-muted-foreground">
            {formatThaiDateShort(product.stockInDate)}
          </span>
        ),
      },
      {
        key: 'cashPrice',
        label: 'เงินสด',
        sortable: true,
        align: 'right',
        width: '112px',
        render: (product) => {
          const { cash } = getPositiveDisplayPrices(product);
          return cash != null ? (
            <span className="font-semibold tabular-nums whitespace-nowrap">{formatBaht(cash)}</span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-md bg-warning/15 px-1.5 py-0.5 text-[11px] font-semibold leading-snug whitespace-nowrap text-warning-strong">
              <AlertCircle aria-hidden="true" className="size-3" />
              ยังไม่ตั้งราคา
            </span>
          );
        },
      },
      {
        key: 'actions',
        label: '',
        sortable: false,
        hideable: false,
        align: 'right',
        stickyRight: true,
        width: '104px',
        render: (product) => {
          const qty = queued.get(product.id) ?? 0;
          const label = product.model || product.name;
          if (qty === 0) {
            return (
              <Button variant="outline" size="sm" className="h-8 px-2.5" onClick={() => onAdd(product)}>
                <Plus aria-hidden="true" className="size-3.5" />
                เพิ่ม
              </Button>
            );
          }
          return (
            <Button
              variant="outline"
              size="sm"
              className="h-8 border-primary/40 bg-primary/10 px-2.5 text-primary hover:bg-primary/15 hover:text-primary"
              aria-label={`เอา ${label} ออกจากคิว`}
              title="อยู่ในคิวแล้ว — กดอีกครั้งเพื่อเอาออก"
              onClick={() => onRemove(product.id)}
            >
              <Check aria-hidden="true" className="size-3.5" />
              ในคิว{qty > 1 ? ` (${qty})` : ''}
            </Button>
          );
        },
      },
    ],
    [queued, onAdd, onRemove],
  );

  return (
    <DataTable
      columns={columns}
      data={products}
      isLoading={isLoading}
      density="dense"
      // ความกว้างขั้นต่ำจริงของ 4 คอลัมน์ (ค่าเริ่มต้นของ DataTable 640px ทำให้แผงซ้ายที่แคบกว่านั้น —
      // จอขยาย 125% / แถบเมนูกาง — กลายเป็นการ์ดเรียงลงยาว ๆ ทั้งที่แถวพอดีอยู่แล้ว)
      minWidth="420px"
      embedded
      maxHeight={maxHeight}
      scrollLabel="รายการเครื่องพร้อมขาย"
      sort={sort}
      onSortChange={onSortChange}
      pagination={pagination}
      emptyMessage="ไม่มีสินค้าพร้อมขายตามเงื่อนไข"
      emptyDescription="ลองเปลี่ยนคำค้นหรือยี่ห้อ"
    />
  );
}
