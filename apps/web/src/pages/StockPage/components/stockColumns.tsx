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
  StockDeviceSpecifications,
  StockInstallmentSummary,
  StockPriceAmount,
  StockProductBranch,
  StockProductCategory,
  StockProductIdentity,
  StockProductSpecifications,
  StockProductStatus,
  StockQuantity,
  StockReceivedDate,
  getStockProductCode,
} from './StockProductCells';

/**
 * คอลัมน์ของหน้ารายการสินค้า — ตารางคอม (DataTable) กับการ์ดมือถือใช้ชุดเดียวกัน แต่เลือกโชว์คนละส่วน:
 * - `desktopHidden` = ตารางคอมไม่แสดง เพราะยุบข้อมูลเข้าคอลัมน์อื่นแล้ว (สาขา/ประเภท → ใต้ชื่อ · ความจุ/สี/แบต → สเปกย่อ)
 *   แต่การ์ดมือถือยังแสดงเป็นรายช่องเหมือนเดิม
 * - `mobileHidden` = คอลัมน์รวมสำหรับตารางคอมเท่านั้น (มือถือมีรายช่องอยู่แล้ว ไม่ต้องซ้ำ)
 * เจ้าของขอ 2026-09-11 "จัดตารางให้พอดีหน้าคอม ขี้เกียจเลื่อนไปเลื่อนมา" — ผลรวมความกว้างทุกแท็บ ≤ ~1,130px
 * จึงพอดีจอ 1280 (sidebar 70 + ระยะขอบ) โดยไม่ต้องเลื่อนแนวนอน
 */
export type StockColumn = Column<StockProduct> & {
  desktopHidden?: boolean;
  mobileHidden?: boolean;
};

/** ความกว้างขั้นต่ำของตารางคอม = คอลัมน์กว้างคงที่ทั้งหมด + คอลัมน์ชื่อที่ยืดได้ */
export const STOCK_NAME_COLUMN_MIN_WIDTH = 220;
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
  /** ตารางคอม: โชว์ประเภท · สาขา ใต้ชื่อ (มือถือส่ง false เพราะการ์ดมีช่องของตัวเอง) */
  showNameCaption: boolean;
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
  showNameCaption,
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

  const selectColumn: StockColumn[] = isManager
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
          width: '44px',
          render: (product) =>
            product.stockGroup ? null : (
              <Checkbox
                aria-label={`เลือก ${product.model || product.name} ${product.imeiSerial || product.id}`}
                checked={selectedIds.has(product.id)}
                onCheckedChange={() => toggleSelect(product.id)}
                className="cursor-pointer"
              />
            ),
        },
      ]
    : [];

  const codeColumn: StockColumn[] = isAccessoryView
    ? [
        {
          key: 'productCode',
          label: 'รหัสสินค้า',
          sortable: true,
          hideable: false,
          width: '110px',
          render: (product) => (
            <span className="font-mono text-xs">{getStockProductCode(product) || '—'}</span>
          ),
        },
      ]
    : [];

  // ประเภท: ตารางคอมของแท็บ "ทั้งหมด" โชว์เป็นบรรทัดเล็กใต้ชื่อ (พร้อมสาขา) — การ์ดมือถือยังเป็นช่องของตัวเอง
  const categoryColumn: StockColumn[] = isAllCategories
    ? [
        {
          key: 'category',
          label: 'ประเภท',
          sortable: true,
          hideable: false,
          width: '110px',
          desktopHidden: true,
          render: (product) => <StockProductCategory product={product} />,
        },
      ]
    : [];

  const nameColumn: StockColumn = {
    key: 'name',
    label: isDeviceView ? 'รุ่น' : 'ชื่อสินค้า/รุ่น',
    sortable: true,
    hideable: false,
    render: (product) => (
      <div className="min-w-0">
        <StockProductIdentity
          product={product}
          onOpen={() =>
            product.stockGroup
              ? setAccessoryGroupId(product.stockGroup!.key)
              : navigateToProduct(product.id)
          }
          showProductCode={!isAccessoryView}
        />
        {/* ประเภท · สาขา ใต้ชื่อ — เฉพาะตารางคอม (การ์ดมือถือมีช่องแยกอยู่แล้ว จึงไม่ render ซ้ำ) */}
        {showNameCaption && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {isAllCategories && (
              <span className="text-xs text-muted-foreground leading-snug">
                <StockProductCategory product={product} />
              </span>
            )}
            <StockProductBranch product={product} />
          </div>
        )}
      </div>
    ),
  };

  const specificationColumns: StockColumn[] = isAccessoryView
    ? [
        {
          key: 'accessoryType',
          label: 'ประเภท',
          sortable: true,
          hideable: false,
          width: '110px',
          render: (product) => <StockAccessoryType product={product} />,
        },
        {
          key: 'color',
          label: 'สี',
          sortable: true,
          hideable: false,
          width: '80px',
          render: (product) => product.color || '—',
        },
      ]
    : isDeviceView
      ? [
          // ตารางคอม: ความจุ · สี (+ แบต/กล่อง/ประกัน ของมือ 2 · การเชื่อมต่อของแท็บเล็ต) รวมช่องเดียว
          {
            key: 'specifications',
            label: 'สเปกย่อ',
            sortable: true,
            hideable: false,
            width: isUsedPhoneView ? '190px' : isTabletView ? '160px' : '140px',
            mobileHidden: true,
            render: (product) => <StockDeviceSpecifications product={product} />,
          },
          // การ์ดมือถือ: ยังเป็นรายช่องเหมือนเดิม
          {
            key: 'storage',
            label: 'ความจุ',
            sortable: true,
            hideable: false,
            width: '80px',
            desktopHidden: true,
            render: (product) => product.storage || '—',
          },
          {
            key: 'color',
            label: 'สี',
            sortable: true,
            hideable: false,
            width: '90px',
            desktopHidden: true,
            render: (product) => product.color || '—',
          },
          ...(isTabletView
            ? [
                {
                  key: 'connectivity',
                  label: 'การเชื่อมต่อ',
                  sortable: true,
                  hideable: false,
                  width: '150px',
                  desktopHidden: true,
                  render: (product: StockProduct) => (
                    <StockDeviceSpecifications product={product} part="connectivity" />
                  ),
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
                  width: '96px',
                  desktopHidden: true,
                  render: (product: StockProduct) => (
                    <StockDeviceSpecifications product={product} part="battery" />
                  ),
                } satisfies StockColumn,
                {
                  key: 'hasBox',
                  label: 'มีกล่อง',
                  sortable: true,
                  hideable: false,
                  width: '80px',
                  desktopHidden: true,
                  render: (product: StockProduct) =>
                    product.hasBox == null ? 'ยังไม่ระบุ' : product.hasBox ? 'มี' : 'ไม่มี',
                } satisfies StockColumn,
                {
                  key: 'warrantyExpireDate',
                  label: 'ประกันศูนย์',
                  sortable: true,
                  hideable: false,
                  width: '140px',
                  desktopHidden: true,
                  render: (product: StockProduct) => (
                    <StockDeviceSpecifications product={product} part="warranty" />
                  ),
                } satisfies StockColumn,
              ]
            : []),
        ]
      : [
          {
            key: 'specifications',
            label: 'สเปกย่อ',
            sortable: true,
            hideable: false,
            width: '132px',
            render: (product) => <StockProductSpecifications product={product} />,
          },
        ];

  const costColumn: StockColumn[] =
    isManager && !isDeviceView
      ? [
          {
            key: 'costPrice',
            label: 'ราคาทุน',
            sortable: true,
            hideable: true,
            align: 'right',
            width: '96px',
            render: (product) => (
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
          },
        ]
      : [];

  const cashColumn: StockColumn = {
    key: 'cashPrice',
    label: isAccessoryView ? 'ราคาขาย' : 'ราคาเต็มจำนวน',
    sortable: true,
    hideable: false,
    align: 'right',
    width: '120px',
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
  };

  // ค่างวด: ยอดต่อเดือน + งวด + ดาวน์ ในช่องเดียว (เดิมดาวน์แยกคอลัมน์ กินที่ 95px)
  const installmentColumn: StockColumn[] = !isAccessoryView
    ? [
        {
          key: 'monthlyPayment',
          label: 'ยอดผ่อนต่อเดือน',
          sortable: true,
          hideable: false,
          align: 'right',
          width: '146px',
          render: (product) => <StockInstallmentSummary plan={installments.get(product.id)} />,
        },
      ]
    : [];

  const receivedColumn: StockColumn[] =
    isDeviceView || isAllCategories
      ? [
          {
            key: 'stockInDate',
            label: 'วันที่รับเข้า',
            sortable: true,
            hideable: false,
            width: '110px',
            render: (product) =>
              product.stockGroup ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <StockReceivedDate product={product} />
              ),
          },
        ]
      : [];

  const quantityColumn: StockColumn[] = !isDeviceView
    ? [
        {
          key: 'quantity',
          label: 'คงเหลือ',
          sortable: true,
          hideable: false,
          align: 'right',
          width: '84px',
          render: (product) => <StockQuantity product={product} />,
        },
      ]
    : [];

  // มุมมอง "พร้อมขาย" ทุกแถวเป็นสถานะเดียวกัน — ซ่อนคอลัมน์ให้ตารางแคบลง (mockup 54e6c624)
  const statusColumn: StockColumn[] =
    view === 'all'
      ? [
          {
            key: 'status',
            label: 'สถานะ',
            sortable: true,
            hideable: false,
            width: '96px',
            render: (product) => <StockProductStatus product={product} />,
          },
        ]
      : [];

  // สาขา: ตารางคอมโชว์ใต้ชื่อ (ดูคอลัมน์ชื่อ) — การ์ดมือถือยังใช้ช่องนี้
  const branchColumn: StockColumn = {
    key: 'branch',
    label: 'สาขา',
    sortable: true,
    hideable: false,
    width: '130px',
    desktopHidden: true,
    render: (product) => <StockProductBranch product={product} />,
  };

  const actionsColumn: StockColumn = {
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
          className="h-11 w-full justify-between gap-1 rounded-md px-1 text-xs font-medium text-primary hover:bg-primary/10"
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
              className="size-11"
              aria-label="จัดการราคา"
              title="จัดการราคา"
              onClick={() => openPriceEdit(product)}
            >
              <Pencil aria-hidden="true" className="size-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            className="h-11 px-3 lg:w-11 lg:px-0"
            aria-label="ดูรายละเอียด"
            title="ดูรายละเอียดสินค้า"
            onClick={() => navigateToProduct(product.id)}
          >
            <span className="lg:hidden">รายละเอียด</span>
            <ArrowUpRight aria-hidden="true" className="size-4" />
          </Button>
        </div>
      ),
  };

  return [
    ...selectColumn,
    ...codeColumn,
    ...categoryColumn,
    nameColumn,
    ...specificationColumns,
    ...costColumn,
    cashColumn,
    ...installmentColumn,
    ...receivedColumn,
    ...quantityColumn,
    ...statusColumn,
    branchColumn,
    actionsColumn,
  ];
}
