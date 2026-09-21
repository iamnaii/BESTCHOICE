import { useMemo } from 'react';
import { AlertCircle, Minus, Plus, Trash2 } from 'lucide-react';
import DataTable, { type Column, type TableSort } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/button';
import { formatThaiDate } from '@/lib/date';
import { cn } from '@/lib/utils';
import { formatBaht } from '@/pages/ProductDetailPage/utils/buildCustomerSummary';
import type { StockProduct } from '@/pages/StockPage/types';
import { getPositiveDisplayPrices } from '@/utils/getDisplayPrices';
import type { DefaultInstallment } from '@installment/shared';
import { formatWarrantyShort, type StickerQuotes } from './stickerView';

export const DEFAULT_PICKER_SORT: TableSort = { key: 'stockInDate', direction: 'desc' };

/** ความกว้างรวม 748px = พอดีฝั่งซ้ายที่จอ 1280 พร้อมแถบข้าง (คอลัมน์ขวา 320px) โดยไม่ต้องเลื่อนแนวนอน */
const COLUMN_WIDTHS = { name: 120, spec: 64, battery: 58, warranty: 72, cash: 68, rate: 90, stockIn: 90, actions: 96 };
export const PICKER_MIN_WIDTH = `${Object.values(COLUMN_WIDTHS).reduce((sum, w) => sum + w, 0) + COLUMN_WIDTHS.rate}px`;

interface StickerPickerTableProps {
  products: StockProduct[];
  isLoading: boolean;
  quotes: Map<string, StickerQuotes>;
  quotesLoading: boolean;
  /** productId → จำนวนดวงในคิว (ไม่อยู่ในคิว = ไม่มี key) */
  queued: Map<string, number>;
  sort: TableSort;
  onSortChange: (sort: TableSort | null) => void;
  pagination: { page: number; totalPages: number; total: number; onPageChange: (page: number) => void };
  onAdd: (product: StockProduct) => void;
  onIncrement: (productId: string) => void;
  onDecrement: (productId: string) => void;
  onRemove: (productId: string) => void;
}

function activeWarrantyShort(product: StockProduct): string | null {
  if (!product.warrantyExpireDate || product.warrantyExpired) return null;
  if (new Date(product.warrantyExpireDate).getTime() < Date.now()) return null;
  return formatWarrantyShort(product.warrantyExpireDate.slice(0, 10));
}

function RateCell({
  rate,
  hasInstallmentPrice,
  loading,
  fallback,
}: {
  rate: DefaultInstallment | null | undefined;
  hasInstallmentPrice: boolean;
  loading: boolean;
  fallback: string;
}) {
  if (!hasInstallmentPrice) return <span className="text-muted-foreground">—</span>;
  if (rate) {
    return (
      <div className="leading-snug">
        <div className="text-[11px] text-muted-foreground whitespace-nowrap">ดาวน์ {formatBaht(rate.downAmount)}</div>
        <div className="text-xs font-semibold text-primary tabular-nums whitespace-nowrap">
          <span>{formatBaht(rate.monthlyPayment)}</span>
          <span className="font-normal text-muted-foreground">/ด.</span>
        </div>
      </div>
    );
  }
  if (loading) return <span className="text-[11px] text-muted-foreground leading-snug">กำลังคำนวณ…</span>;
  return <span className="text-[11px] text-muted-foreground leading-snug">{fallback}</span>;
}

/**
 * ตารางเลือกเครื่องของหน้าพิมพ์สติกเกอร์ — คอลัมน์ชุดเดียวกับข้อมูลที่จะพิมพ์บนดวง
 * (รุ่น/IMEI · สเปก · แบต/กล่อง · ประกันศูนย์ · เงินสด · เรท 1 · เรท 2 · รับเข้า) เรียงจากหัวคอลัมน์
 * เหมือนตารางรายการสินค้า ค่าเริ่มต้นวันที่รับเข้าใหม่ → เก่า
 */
export function StickerPickerTable({
  products,
  isLoading,
  quotes,
  quotesLoading,
  queued,
  sort,
  onSortChange,
  pagination,
  onAdd,
  onIncrement,
  onDecrement,
  onRemove,
}: StickerPickerTableProps) {
  const columns = useMemo<Column<StockProduct>[]>(
    () => [
      {
        key: 'name',
        label: 'รุ่น / IMEI',
        sortable: true,
        width: `${COLUMN_WIDTHS.name}px`,
        render: (product) => (
          <div className="min-w-0 leading-snug">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-foreground">{product.model || product.name}</span>
              {(product.category === 'PHONE_NEW' || product.category === 'PHONE_USED') && (
                <span
                  className={cn(
                    'rounded px-1.5 py-px text-[10px] font-semibold leading-snug whitespace-nowrap',
                    product.category === 'PHONE_USED' ? 'bg-info/15 text-info' : 'bg-muted text-muted-foreground',
                  )}
                >
                  {product.category === 'PHONE_USED' ? 'มือสอง' : 'มือ 1'}
                </span>
              )}
            </div>
            <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{product.imeiSerial ?? '—'}</div>
          </div>
        ),
      },
      {
        key: 'specifications',
        label: 'สเปก',
        sortable: false,
        width: `${COLUMN_WIDTHS.spec}px`,
        render: (product) => (
          <span className="leading-snug">{[product.color, product.storage].filter(Boolean).join(' · ') || '—'}</span>
        ),
      },
      {
        key: 'batteryHealth',
        label: 'แบต / กล่อง',
        sortable: false,
        headerWrap: true,
        width: `${COLUMN_WIDTHS.battery}px`,
        render: (product) =>
          product.category === 'PHONE_USED' ? (
            <div className="leading-snug">
              <div className="font-semibold tabular-nums">
                {product.batteryHealth != null ? `${product.batteryHealth}%` : '—'}
              </div>
              {product.hasBox != null && (
                <div className={cn('text-[11px]', product.hasBox ? 'text-muted-foreground' : 'text-warning-strong')}>
                  {product.hasBox ? 'มีกล่อง' : 'ไม่มีกล่อง'}
                </div>
              )}
            </div>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        key: 'warrantyExpireDate',
        label: 'ประกันศูนย์',
        sortable: false,
        headerWrap: true,
        width: `${COLUMN_WIDTHS.warranty}px`,
        render: (product) => {
          const short = activeWarrantyShort(product);
          return short ? (
            <span className="font-mono text-xs tabular-nums whitespace-nowrap">{short}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          );
        },
      },
      {
        key: 'cashPrice',
        label: 'เงินสด',
        sortable: true,
        align: 'right',
        width: `${COLUMN_WIDTHS.cash}px`,
        render: (product) => {
          const { cash } = getPositiveDisplayPrices(product);
          return cash != null ? (
            <span className="font-semibold tabular-nums whitespace-nowrap">{formatBaht(cash)}</span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-md bg-warning/15 px-1.5 py-0.5 text-[11px] font-semibold text-warning-strong leading-snug whitespace-nowrap">
              <AlertCircle aria-hidden="true" className="size-3" />
              ยังไม่ตั้งราคา
            </span>
          );
        },
      },
      {
        key: 'rate1',
        label: 'เรท 1',
        sortable: false,
        align: 'right',
        width: `${COLUMN_WIDTHS.rate}px`,
        render: (product) => (
          <RateCell
            rate={quotes.get(product.id)?.rate1}
            hasInstallmentPrice={getPositiveDisplayPrices(product).installment != null}
            loading={quotesLoading}
            fallback="ยังไม่มีเงื่อนไขผ่อน"
          />
        ),
      },
      {
        key: 'rate2',
        label: 'เรท 2',
        sortable: false,
        align: 'right',
        width: `${COLUMN_WIDTHS.rate}px`,
        render: (product) => (
          <RateCell
            rate={quotes.get(product.id)?.rate2}
            hasInstallmentPrice={getPositiveDisplayPrices(product).installment != null}
            loading={quotesLoading}
            fallback="ไม่มีใน GFIN"
          />
        ),
      },
      {
        key: 'stockInDate',
        label: 'รับเข้า',
        sortable: true,
        width: `${COLUMN_WIDTHS.stockIn}px`,
        render: (product) => (
          <div className="leading-snug">
            <div className="font-mono text-xs tabular-nums whitespace-nowrap">
              {formatThaiDate(product.stockInDate, 'Asia/Bangkok')}
            </div>
            <div className="text-[11px] text-muted-foreground">{product.branch?.name ?? ''}</div>
          </div>
        ),
      },
      {
        key: 'actions',
        label: '',
        sortable: false,
        hideable: false,
        align: 'right',
        stickyRight: true,
        width: `${COLUMN_WIDTHS.actions}px`,
        render: (product) => {
          const qty = queued.get(product.id) ?? 0;
          if (qty === 0) {
            return (
              <Button variant="outline" size="sm" className="h-8 px-2.5" onClick={() => onAdd(product)}>
                <Plus aria-hidden="true" className="size-3.5" />
                เพิ่ม
              </Button>
            );
          }
          return (
            <div className="inline-flex items-center overflow-hidden rounded-md border border-primary/40 bg-primary/10 text-primary">
              <button
                type="button"
                className="grid size-7 place-items-center hover:bg-primary/15"
                aria-label={qty <= 1 ? 'ลบออกจากคิว' : 'ลดจำนวนดวง'}
                onClick={() => (qty <= 1 ? onRemove(product.id) : onDecrement(product.id))}
              >
                {qty <= 1 ? <Trash2 aria-hidden="true" className="size-3.5" /> : <Minus aria-hidden="true" className="size-3.5" />}
              </button>
              <span className="min-w-5 border-x border-primary/25 text-center font-mono text-[11px] font-bold leading-7">
                {qty}
              </span>
              <button
                type="button"
                className="grid size-7 place-items-center hover:bg-primary/15"
                aria-label="เพิ่มจำนวนดวง"
                onClick={() => onIncrement(product.id)}
              >
                <Plus aria-hidden="true" className="size-3.5" />
              </button>
            </div>
          );
        },
      },
    ],
    [quotes, quotesLoading, queued, onAdd, onIncrement, onDecrement, onRemove],
  );

  return (
    <DataTable
      columns={columns}
      data={products}
      isLoading={isLoading}
      density="dense"
      minWidth={PICKER_MIN_WIDTH}
      sort={sort}
      onSortChange={onSortChange}
      pagination={pagination}
      emptyMessage="ไม่มีสินค้าพร้อมขายตามเงื่อนไข"
      emptyDescription="ลองเปลี่ยนคำค้นหรือแบรนด์"
    />
  );
}
