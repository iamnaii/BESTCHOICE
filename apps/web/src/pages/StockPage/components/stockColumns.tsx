import { ArrowUpRight, ChevronRight, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import type { Column } from '@/components/ui/DataTable';
import { getPositiveDisplayPrices, normalizePositive } from '@/utils/getDisplayPrices';
import type { StockProduct } from '../types';
import type { StockView } from '../hooks/useStockProducts';
import type { useStockInstallments } from '../hooks/useStockInstallments';
import {
  StockAccessoryType,
  StockBatteryHealth,
  StockDownPayment,
  StockManufacturerWarranty,
  StockMonthlyPayment,
  StockPriceAmount,
  StockProductBranch,
  StockProductCategory,
  StockProductIdentity,
  StockProductSpecifications,
  StockProductStatus,
  StockQuantity,
  StockReceivedDate,
  StockTabletConnectivity,
  getStockProductCode,
} from './StockProductCells';

/**
 * คอลัมน์ของหน้ารายการสินค้า — ตารางคอม (DataTable) กับการ์ดมือถือใช้ชุดเดียวกัน
 *
 * เจ้าของ 2026-09-11: "จัดตารางให้พอดีหน้าคอม ขี้เกียจเลื่อนไปเลื่อนมา" แล้วย้ำว่า
 * "ต้องการให้ข้อมูลครบเหมือนเดิม แต่ให้พอดีหน้า" ⇒ **คอลัมน์ทุกคอลัมน์คงไว้ครบ ไม่ยุบ ไม่ซ่อน**
 * ที่ทำคือบีบความกว้างต่อคอลัมน์ + ตาราง density `dense` (padding 16px แทน 24px) ให้ผลรวมของ
 * แท็บที่กว้างที่สุด (มือ 2: 14 คอลัมน์) = 1,152px พอดีพื้นที่ตารางบนจอ 1280 (sidebar 70 + ระยะขอบ)
 * หัวคอลัมน์และข้อความยาวยอมให้ขึ้นบรรทัดใหม่ในคอลัมน์แคบแทนการเลื่อนแนวนอน
 *
 * `desktopHidden` / `mobileHidden` เผื่อไว้สำหรับคอลัมน์ที่อยากโชว์แค่ฝั่งเดียว (ตอนนี้ไม่มีคอลัมน์ใช้)
 */
export type StockColumn = Column<StockProduct> & {
  desktopHidden?: boolean;
  mobileHidden?: boolean;
};

/** คอลัมน์ชื่อไม่กำหนดความกว้าง (ยืดเต็มที่เหลือ) แต่ต้องไม่แคบกว่านี้ — IMEI 15 หลัก + ปุ่มคัดลอก */
export const STOCK_NAME_COLUMN_MIN_WIDTH = 140;
/** ความกว้างขั้นต่ำของตารางคอม = ผลรวมคอลัมน์กว้างคงที่ + คอลัมน์ชื่อ */
export function stockTableMinWidth(columns: StockColumn[]): number {
  return columns
    .filter((column) => !column.desktopHidden)
    .reduce(
      (sum, column) => sum + (column.width ? parseInt(column.width, 10) : STOCK_NAME_COLUMN_MIN_WIDTH),
      0,
    );
}

export interface StockColumnsParams {
  isManager: boolean;
  view: StockView;
  filterCategory: string;
  listProducts: StockProduct[];
  selectableProducts: StockProduct[];
  selectedIds: Set<string>;
  toggleSelectAll: (products: StockProduct[]) => void;
  toggleSelect: (id: string) => void;
  navigateToProduct: (id: string) => void;
  openPriceEdit: (product: StockProduct) => void;
  setAccessoryGroupId: (id: string) => void;
  installments: ReturnType<typeof useStockInstallments>['installments'];
}

export function buildStockColumns({
  isManager,
  view,
  filterCategory,
  listProducts,
  selectableProducts,
  selectedIds,
  toggleSelectAll,
  toggleSelect,
  navigateToProduct,
  openPriceEdit,
  setAccessoryGroupId,
  installments,
}: StockColumnsParams): StockColumn[] {
  const isUsedPhoneView = filterCategory === 'PHONE_USED';
  const isTabletView = filterCategory === 'TABLET';
  const isAccessoryView = filterCategory === 'ACCESSORY';
  const isDeviceView = filterCategory === 'PHONE_NEW' || isUsedPhoneView || isTabletView;
  const isAllCategories = filterCategory === '';

  return [
    ...(isManager
      ? [
          {
            key: 'select',
            label: (
              <Checkbox
                aria-label="เลือกสินค้าหน้านี้"
                disabled={selectableProducts.length === 0}
                checked={
                  selectableProducts.length > 0 &&
                  selectableProducts.every((product) => selectedIds.has(product.id))
                    ? true
                    : selectedIds.size > 0
                      ? 'indeterminate'
                      : false
                }
                onCheckedChange={() => toggleSelectAll(listProducts)}
                className="cursor-pointer"
              />
            ) as unknown as string,
            hideable: false,
            sortable: false,
            width: '36px',
            render: (product: StockProduct) =>
              product.stockGroup ? null : (
                <Checkbox
                  aria-label={`เลือก ${product.model || product.name} ${product.imeiSerial || product.id}`}
                  checked={selectedIds.has(product.id)}
                  onCheckedChange={() => toggleSelect(product.id)}
                  className="cursor-pointer"
                />
              ),
          } satisfies StockColumn,
        ]
      : []),
    ...(!isDeviceView
      ? [
          {
            key: isAccessoryView ? 'productCode' : 'category',
            label: isAccessoryView ? 'รหัสสินค้า' : 'ประเภท',
            sortable: true,
            hideable: false,
            width: isAccessoryView ? '96px' : '88px',
            render: (product: StockProduct) =>
              isAccessoryView ? (
                <span className="font-mono text-xs break-all">{getStockProductCode(product) || '—'}</span>
              ) : (
                <StockProductCategory product={product} />
              ),
          } satisfies StockColumn,
        ]
      : []),
    {
      key: 'name',
      label: isDeviceView ? 'รุ่น' : 'ชื่อสินค้า/รุ่น',
      sortable: true,
      hideable: false,
      render: (product) => (
        <StockProductIdentity
          product={product}
          onOpen={() =>
            product.stockGroup
              ? setAccessoryGroupId(product.stockGroup!.key)
              : navigateToProduct(product.id)
          }
          showProductCode={!isAccessoryView}
        />
      ),
    },
    ...(!isDeviceView && !isAccessoryView
      ? [
          {
            key: 'specifications',
            label: 'สเปกย่อ',
            sortable: true,
            hideable: false,
            width: '100px',
            render: (product: StockProduct) => <StockProductSpecifications product={product} />,
          } satisfies StockColumn,
        ]
      : []),
    ...(isAccessoryView
      ? [
          {
            key: 'accessoryType',
            label: 'ประเภท',
            sortable: true,
            hideable: false,
            width: '84px',
            render: (product: StockProduct) => <StockAccessoryType product={product} />,
          } satisfies StockColumn,
        ]
      : []),
    ...(isDeviceView || isAccessoryView
      ? [
          ...(!isAccessoryView
            ? [
                {
                  key: 'storage',
                  label: 'ความจุ',
                  sortable: true,
                  hideable: false,
                  width: '60px',
                  render: (product: StockProduct) => product.storage || '—',
                } satisfies StockColumn,
              ]
            : []),
          {
            key: 'color',
            label: 'สี',
            sortable: true,
            hideable: false,
            width: isAccessoryView ? '64px' : '60px',
            render: (product: StockProduct) => product.color || '—',
          } satisfies StockColumn,
        ]
      : []),
    ...(isTabletView
      ? [
          {
            key: 'connectivity',
            label: 'การเชื่อมต่อ',
            sortable: true,
            hideable: false,
            width: '100px',
            render: (product: StockProduct) => <StockTabletConnectivity product={product} />,
          } satisfies StockColumn,
        ]
      : []),
    ...(isUsedPhoneView
      ? [
          {
            key: 'batteryHealth',
            label: '%แบตเตอรี่',
            sortable: true,
            hideable: false,
            width: '68px',
            render: (product: StockProduct) => <StockBatteryHealth product={product} />,
          } satisfies StockColumn,
          {
            key: 'hasBox',
            label: 'มีกล่อง',
            sortable: true,
            hideable: false,
            width: '56px',
            render: (product: StockProduct) =>
              product.hasBox == null ? 'ยังไม่ระบุ' : product.hasBox ? 'มี' : 'ไม่มี',
          } satisfies StockColumn,
          {
            key: 'warrantyExpireDate',
            label: 'ประกันศูนย์',
            sortable: true,
            hideable: false,
            width: '92px',
            render: (product: StockProduct) => <StockManufacturerWarranty product={product} />,
          } satisfies StockColumn,
        ]
      : []),
    ...(isManager && !isDeviceView
      ? [
          {
            key: 'costPrice',
            label: 'ราคาทุน',
            sortable: true,
            hideable: true,
            align: 'right' as const,
            width: '84px',
            render: (product: StockProduct) => (
              <StockPriceAmount
                value={
                  product.costPrice != null && product.costPrice !== ''
                    ? Number(product.costPrice)
                    : null
                }
                maxValue={
                  product.stockGroup?.costPriceMax != null
                    ? Number(product.stockGroup.costPriceMax)
                    : null
                }
                muted
              />
            ),
          } satisfies StockColumn,
        ]
      : []),
    {
      key: 'cashPrice',
      label: isAccessoryView ? 'ราคาขาย' : 'ราคาเต็มจำนวน',
      sortable: true,
      hideable: false,
      align: 'right',
      width: '96px',
      render: (product) => (
        <div className="space-y-1">
          <StockPriceAmount
            value={
              product.stockGroup
                ? normalizePositive(product.cashPrice)
                : normalizePositive(getPositiveDisplayPrices(product).cash)
            }
            maxValue={normalizePositive(product.stockGroup?.cashPriceMax)}
          />
          {!!product.stockGroup?.cashPriceMissingCount && (
            <div className="text-xs text-muted-foreground leading-snug">
              ยังไม่ตั้ง {product.stockGroup.cashPriceMissingCount} ชิ้น
            </div>
          )}
        </div>
      ),
    },
    ...(!isAccessoryView
      ? [
          {
            key: 'downPayment',
            label: 'ดาวน์',
            sortable: true,
            hideable: false,
            align: 'right' as const,
            width: '72px',
            render: (product: StockProduct) => (
              <StockDownPayment plan={installments.get(product.id)} />
            ),
          } satisfies StockColumn,
          {
            key: 'monthlyPayment',
            label: 'ยอดผ่อนต่อเดือน',
            sortable: true,
            hideable: false,
            align: 'right' as const,
            width: '116px',
            render: (product: StockProduct) => (
              <StockMonthlyPayment plan={installments.get(product.id)} />
            ),
          } satisfies StockColumn,
        ]
      : []),
    // เจ้าของขอ 2026-09-11 ให้แท็บ "ทั้งหมด" มีวันที่รับเข้าด้วย — แถวกลุ่มอุปกรณ์เว้นว่าง
    // (วันที่ของกลุ่มไม่มีความหมายเดียว ส่วนแท็บอุปกรณ์ล้วนยังไม่แสดงคอลัมน์นี้เหมือนเดิม)
    ...(isDeviceView || isAllCategories
      ? [
          {
            key: 'stockInDate',
            label: 'วันที่รับเข้า',
            sortable: true,
            hideable: false,
            width: '96px',
            render: (product: StockProduct) =>
              product.stockGroup ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <StockReceivedDate product={product} />
              ),
          } satisfies StockColumn,
        ]
      : []),
    ...(!isDeviceView
      ? [
          {
            key: 'quantity',
            label: 'คงเหลือ',
            sortable: true,
            hideable: false,
            align: 'right' as const,
            width: '62px',
            render: (product: StockProduct) => <StockQuantity product={product} />,
          } satisfies StockColumn,
        ]
      : []),
    // มุมมอง "พร้อมขาย" ทุกแถวเป็นสถานะเดียวกัน — ซ่อนคอลัมน์ให้ตารางแคบลง (mockup 54e6c624)
    ...(view === 'all'
      ? [
          {
            key: 'status',
            label: 'สถานะ',
            sortable: true,
            hideable: false,
            width: '84px',
            render: (product: StockProduct) => <StockProductStatus product={product} />,
          } satisfies StockColumn,
        ]
      : []),
    {
      key: 'branch',
      label: 'สาขา',
      sortable: true,
      hideable: false,
      width: '80px',
      render: (product) => <StockProductBranch product={product} />,
    },
    {
      key: 'actions',
      label: '',
      stickyRight: true,
      sortable: false,
      hideable: false,
      width: '96px',
      render: (product) =>
        product.stockGroup ? (
          <Button
            variant="ghost"
            className="h-11 w-full justify-between gap-1 rounded-md px-1 text-xs font-medium text-primary hover:bg-primary/10 lg:h-9"
            onClick={() => setAccessoryGroupId(product.stockGroup!.key)}
          >
            ดู {product.stockGroup.unitCount} ชิ้น
            <ChevronRight aria-hidden="true" className="size-4" />
          </Button>
        ) : (
          <div className="flex items-center justify-end gap-1">
            {isManager && (
              <Button
                variant="ghost"
                mode="icon"
                className="size-11 lg:size-9"
                aria-label="จัดการราคา"
                title="จัดการราคา"
                onClick={() => openPriceEdit(product)}
              >
                <Pencil aria-hidden="true" className="size-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              className="h-11 px-3 lg:size-9 lg:px-0"
              aria-label="ดูรายละเอียด"
              title="ดูรายละเอียดสินค้า"
              onClick={() => navigateToProduct(product.id)}
            >
              <span className="lg:hidden">รายละเอียด</span>
              <ArrowUpRight aria-hidden="true" className="size-4" />
            </Button>
          </div>
        ),
    },
  ];
}
