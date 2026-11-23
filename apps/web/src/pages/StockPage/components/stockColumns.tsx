import { ArrowUpRight, ChevronRight, Pencil } from 'lucide-react';
import type { StockInventoryScope } from '@installment/shared';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import type { Column } from '@/components/ui/DataTable';
import { getPositiveDisplayPrices, normalizePositive } from '@/utils/getDisplayPrices';
import type { StockProduct } from '../types';
import type { StockView } from '../hooks/useStockProducts';
import type { useStockInstallments } from '../hooks/useStockInstallments';
import {
  StockAccessoryType,
  StockAccessoryMargin,
  StockBatteryHealth,
  StockImei,
  StockInstallmentPlan,
  StockManufacturerWarranty,
  StockPriceAmount,
  StockProductBranch,
  StockProductCategory,
  StockProductIdentity,
  StockProductStatus,
  StockQuantity,
  StockReceivedDate,
  StockTabletConnectivity,
  getStockProductCode,
} from './StockProductCells';

export type StockColumn = Column<StockProduct> & {
  desktopHidden?: boolean;
  mobileHidden?: boolean;
};

export interface StockColumnsParams {
  isManager: boolean;
  view: StockView;
  inventoryScope?: StockInventoryScope;
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
  gfinInstallments?: ReturnType<typeof useStockInstallments>['gfinInstallments'];
}

/** Widths are relative weights, so the table fits the actual workspace, not a fixed viewport. */
export function buildStockColumns({
  isManager,
  view,
  inventoryScope = 'all',
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
  gfinInstallments,
}: StockColumnsParams): StockColumn[] {
  const accessory = inventoryScope === 'accessories' || filterCategory === 'ACCESSORY';
  const mixed = inventoryScope === 'all' && !filterCategory;
  const columns: StockColumn[] = [];
  const add = (column: StockColumn, weight: number) =>
    columns.push({ ...column, width: `${weight}%` });
  if (isManager)
    add(
      {
        key: 'select',
        className: 'stock-select-cell',
        headerClassName: 'stock-select-cell',
        label: (
          <Checkbox
            aria-label="เลือกสินค้าหน้านี้"
            disabled={!selectableProducts.length}
            checked={
              selectableProducts.length > 0 &&
              selectableProducts.every((p) => selectedIds.has(p.id))
                ? true
                : selectableProducts.some((p) => selectedIds.has(p.id))
                  ? 'indeterminate'
                  : false
            }
            onCheckedChange={() => toggleSelectAll(listProducts)}
          />
        ) as unknown as string,
        hideable: false,
        render: (p) =>
          p.stockGroup ? null : (
            <Checkbox
              aria-label={`เลือก ${p.model || p.name} ${p.imeiSerial || p.id}`}
              checked={selectedIds.has(p.id)}
              onCheckedChange={() => toggleSelect(p.id)}
            />
          ),
      },
      3,
    );
  add(
    {
      key: 'name',
      className: 'stock-name-cell',
      headerClassName: 'stock-name-cell',
      label: accessory ? 'สินค้า / รุ่น' : 'รุ่นสินค้า',
      sortable: true,
      hideable: false,
      render: (p) => (
        <div className="space-y-1.5">
          <StockProductIdentity
            product={p}
            showImei={false}
            showProductCode={mixed}
            onOpen={() =>
              p.stockGroup ? setAccessoryGroupId(p.stockGroup.key) : navigateToProduct(p.id)
            }
          />
          {mixed && p.category === 'ACCESSORY' && <StockProductCategory product={p} />}
        </div>
      ),
    },
    22,
  );
  if (accessory) {
    add(
      {
        key: 'productCode',
        label: 'SKU / รหัสสินค้า',
        sortable: true,
        hideable: false,
        render: (p) => (
          <span className="font-mono text-xs break-all">
            {getStockProductCode(p) || 'ยังไม่ระบุ'}
          </span>
        ),
      },
      12,
    );
    add(
      {
        key: 'accessoryType',
        label: 'ประเภท',
        sortable: true,
        hideable: true,
        render: (p) => <StockAccessoryType product={p} />,
      },
      11,
    );
  } else {
    add(
      {
        key: 'storage',
        label: 'ความจุ',
        sortable: true,
        hideable: false,
        render: (p) => (
          <div className="space-y-1">
            <span className="tabular-nums">{p.storage || '—'}</span>
            {p.category === 'TABLET' && (
              <div className="text-xs text-muted-foreground">
                <StockTabletConnectivity product={p} />
              </div>
            )}
          </div>
        ),
      },
      6,
    );
  }
  add(
    { key: 'color', label: 'สี', sortable: true, hideable: false, render: (p) => p.color || '—' },
    8,
  );
  if (!accessory) {
    add(
      {
        key: 'imeiSerial',
        label: 'IMEI / Serial',
        sortable: false,
        hideable: false,
        render: (p) => <StockImei product={p} />,
        className: 'stock-imei-cell',
      },
      18,
    );
    add(
      {
        key: 'batteryHealth',
        label: 'แบต %',
        sortable: true,
        hideable: true,
        render: (p) => (p.category === 'ACCESSORY' ? '—' : <StockBatteryHealth product={p} />),
      },
      5,
    );
    add(
      {
        key: 'warrantyExpireDate',
        label: 'ประกันศูนย์',
        sortable: true,
        hideable: true,
        render: (p) =>
          p.category === 'ACCESSORY' ? '—' : <StockManufacturerWarranty product={p} />,
      },
      8,
    );
    add(
      {
        key: 'hasBox',
        label: 'กล่อง',
        sortable: true,
        hideable: true,
        render: (p) =>
          p.category === 'ACCESSORY' ? '—' : p.hasBox == null ? '—' : p.hasBox ? 'มี' : 'ไม่มี',
      },
      4,
    );
  }
  if (isManager)
    add(
      {
        key: 'costPrice',
        label: 'ราคาทุน',
        sortable: true,
        hideable: true,
        defaultHidden: !accessory,
        align: 'right',
        render: (p) => (
          <StockPriceAmount
            value={p.costPrice != null && p.costPrice !== '' ? Number(p.costPrice) : null}
            maxValue={p.stockGroup?.costPriceMax != null ? Number(p.stockGroup.costPriceMax) : null}
            muted
          />
        ),
      },
      10,
    );
  add(
    {
      key: 'cashPrice',
      label: accessory ? 'ราคาขาย' : 'ราคาเงินสด',
      sortable: true,
      hideable: false,
      align: 'right',
      className: 'stock-cash-cell',
      headerClassName: 'bg-muted/50',
      render: (p) => (
        <div className="space-y-1">
          <StockPriceAmount
            value={
              p.stockGroup
                ? normalizePositive(p.cashPrice)
                : normalizePositive(getPositiveDisplayPrices(p).cash)
            }
            maxValue={normalizePositive(p.stockGroup?.cashPriceMax)}
          />
          {!!p.stockGroup?.cashPriceMissingCount && (
            <div className="text-xs text-muted-foreground">
              ยังไม่ตั้ง {p.stockGroup.cashPriceMissingCount} ชิ้น
            </div>
          )}
        </div>
      ),
    },
    accessory ? 11 : 9,
  );
  if (accessory && isManager)
    add(
      {
        key: 'margin',
        label: 'กำไร / ชิ้น',
        hideable: true,
        align: 'right',
        render: (p) => <StockAccessoryMargin product={p} />,
      },
      11,
    );
  if (!accessory) {
    add(
      {
        key: 'downPayment',
        label: 'BESTCHOICE',
        sortable: true,
        hideable: false,
        align: 'right',
        className: 'stock-bc-cell',
        headerClassName: 'bg-primary/10 text-primary',
        render: (p) =>
          p.category === 'ACCESSORY' ? '—' : <StockInstallmentPlan plan={installments.get(p.id)} />,
      },
      14,
    );
    add(
      {
        key: 'gfin',
        label: 'GFIN',
        hideable: false,
        align: 'right',
        className: 'stock-gfin-cell',
        headerClassName: 'bg-info/10 text-foreground',
        render: (p) =>
          p.category === 'ACCESSORY' ? (
            '—'
          ) : (
            <StockInstallmentPlan plan={gfinInstallments?.get(p.id)} />
          ),
      },
      14,
    );
    add(
      {
        key: 'stockInDate',
        label: 'วันที่รับเข้า',
        sortable: true,
        hideable: true,
        defaultHidden: true,
        render: (p) => (p.stockGroup ? '—' : <StockReceivedDate product={p} />),
      },
      10,
    );
  }
  if (accessory || mixed)
    add(
      {
        key: 'quantity',
        label: 'พร้อมขาย',
        sortable: true,
        hideable: false,
        align: 'right',
        render: (p) => <StockQuantity product={p} />,
      },
      accessory ? 9 : 7,
    );
  if (view === 'all')
    add(
      {
        key: 'status',
        label: 'สถานะ',
        sortable: true,
        hideable: true,
        render: (p) => <StockProductStatus product={p} />,
      },
      9,
    );
  add(
    {
      key: 'branch',
      label: 'สาขา',
      sortable: true,
      hideable: true,
      defaultHidden: !accessory,
      render: (p) => <StockProductBranch product={p} />,
    },
    9,
  );
  add(
    {
      key: 'actions',
      label: '',
      className: 'stock-actions-cell',
      headerClassName: 'stock-actions-cell',
      hideable: false,
      render: (p) =>
        p.stockGroup ? (
          <Button
            variant="ghost"
            className="min-h-11 h-auto w-full flex-wrap px-1 text-xs text-primary"
            onClick={() => setAccessoryGroupId(p.stockGroup!.key)}
          >
            ดู {p.stockGroup.unitCount} ชิ้น
            <ChevronRight aria-hidden className="size-4" />
          </Button>
        ) : (
          <div className="flex items-center justify-end gap-1 lg:flex-col lg:justify-center">
            {isManager && (
              <Button
                variant="ghost"
                mode="icon"
                className="size-11 lg:size-8"
                aria-label="จัดการราคา"
                title="จัดการราคา"
                onClick={() => openPriceEdit(p)}
              >
                <Pencil aria-hidden className="size-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              mode="icon"
              className="size-11 lg:size-8"
              aria-label="ดูรายละเอียด"
              title="ดูรายละเอียดสินค้า"
              onClick={() => navigateToProduct(p.id)}
            >
              <ArrowUpRight aria-hidden className="size-4" />
            </Button>
          </div>
        ),
    },
    4,
  );
  // Percentages include optional columns: CSS table layout redistributes unused space when hidden.
  const total = columns.reduce((sum, col) => sum + parseFloat(col.width!), 0);
  return columns.map((col) => ({
    ...col,
    width: `${(parseFloat(col.width!) / total) * 100}%`,
    headerWrap: true,
  }));
}
