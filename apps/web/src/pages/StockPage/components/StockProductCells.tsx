import Decimal from 'decimal.js';
import { getPositiveDisplayPrices } from '@/utils/getDisplayPrices';
import { Link } from 'react-router';
import { deviceOriginLabel } from '@/components/product/DeviceDisclosureSummary';
import { Check, Copy, MapPin } from '@/lib/icons';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import { categoryLabels, statusLabels } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { calendarDaysSince, formatThaiDate } from '@/lib/date';
import { formatBaht } from '@/pages/ProductDetailPage/utils/buildCustomerSummary';
import { isAccessoryProductCode } from '@/pages/PurchaseOrdersPage/po-catalog.util';
import type { StockProduct } from '../types';
import type { useStockInstallments } from '../hooks/useStockInstallments';

type InstallmentPlan =
  ReturnType<typeof useStockInstallments>['installments'] extends Map<string, infer T> ? T : never;

export function StockProductIdentity({
  product,
  onOpen,
  showProductCode = true,
  showImei = true,
}: {
  product: StockProduct;
  onOpen: () => void;
  showProductCode?: boolean;
  showImei?: boolean;
}) {
  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'cursor-pointer rounded text-left text-base font-semibold leading-snug text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:text-sm',
          product.category !== 'ACCESSORY' && 'stock-device-name',
        )}
      >
        {product.category === 'ACCESSORY'
          ? product.name || product.model
          : product.model || product.name}
      </button>
      {product.category !== 'ACCESSORY' && (
        <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground leading-snug">
          {product.deviceOrigin && (
            <>
              <span className="whitespace-nowrap">{deviceOriginLabel(product.deviceOrigin)}</span>
              <span aria-hidden="true">·</span>
            </>
          )}
          <span className="whitespace-nowrap">
            {product.category === 'PHONE_NEW'
              ? 'มือ 1'
              : product.category === 'PHONE_USED'
                ? 'มือ 2'
                : categoryLabels[product.category] || product.category}
          </span>
        </p>
      )}
      {product.category === 'ACCESSORY' && product.model && product.model !== product.name && (
        <p className="mt-1 text-xs text-muted-foreground leading-snug">{product.model}</p>
      )}
      {showImei && product.category !== 'ACCESSORY' && <StockImei product={product} />}
      {product.stockGroup && (
        <p className="mt-1 text-xs text-muted-foreground leading-snug">
          รวม {product.stockGroup.unitCount} ชิ้น
        </p>
      )}
      {showProductCode && !product.imeiSerial && product.category === 'ACCESSORY' && (
        <p className="mt-1 font-mono text-xs text-muted-foreground leading-snug">
          {getStockProductCode(product) || 'ยังไม่ระบุรหัสสินค้า'}
        </p>
      )}
    </div>
  );
}

export function getStockProductCode(product: StockProduct) {
  return product.accessoryType && isAccessoryProductCode(product.accessoryType)
    ? product.accessoryType
    : product.stockGroup
      ? null
      : product.legacyProductCode || null;
}

export function StockAccessoryType({ product }: { product: StockProduct }) {
  return product.accessoryType && !isAccessoryProductCode(product.accessoryType)
    ? product.accessoryType
    : 'ยังไม่ระบุ';
}

export function StockProductCategory({ product }: { product: StockProduct }) {
  return (
    <span className="whitespace-nowrap text-xs font-medium">
      {categoryLabels[product.category] || product.category}
    </span>
  );
}

export function StockQuantity({ product }: { product: StockProduct }) {
  const quantity = product.stockGroup?.inStockQuantity ?? (product.status === 'IN_STOCK' ? 1 : 0);
  return (
    <span
      className={cn('whitespace-nowrap tabular-nums', quantity === 0 && 'text-muted-foreground')}
    >
      {quantity} ชิ้น
    </span>
  );
}

export function StockPriceAmount({
  value,
  muted = false,
  accent = false,
  maxValue,
}: {
  value: number | null | undefined;
  muted?: boolean;
  accent?: boolean;
  maxValue?: number | null;
}) {
  const hasRange =
    value != null && maxValue != null && Number.isFinite(maxValue) && maxValue > value;
  return value != null && Number.isFinite(value) && value >= 0 ? (
    <span
      className={cn(
        'inline-block max-w-full text-base font-semibold tabular-nums leading-snug lg:text-sm',
        hasRange ? 'whitespace-normal' : 'whitespace-nowrap',
        muted && 'font-normal text-muted-foreground',
        accent && 'text-primary',
      )}
    >
      {formatBaht(value)}
      {hasRange && (
        <>
          –<wbr />
          {formatBaht(maxValue!)}
        </>
      )}{' '}
      ฿
    </span>
  ) : (
    <span className="text-muted-foreground">—</span>
  );
}

export function StockDownPayment({ plan }: { plan: InstallmentPlan | undefined }) {
  if (plan?.isLoading)
    return <span className="text-xs text-muted-foreground leading-snug">กำลังคำนวณ…</span>;
  if (plan?.isError)
    return <span className="text-xs text-destructive leading-snug">โหลดไม่สำเร็จ</span>;
  if (plan?.unavailableReason)
    return (
      <span className="inline-block max-w-32 text-xs text-muted-foreground leading-snug">
        {plan.unavailableReason}
      </span>
    );
  return <StockPriceAmount value={plan?.quote?.downAmount} />;
}

export function StockBatteryHealth({ product }: { product: StockProduct }) {
  const health = product.batteryHealth;
  return (
    <span className="tabular-nums">
      {health != null && Number.isFinite(health) && health >= 0 && health <= 100
        ? `${health}%`
        : '—'}
    </span>
  );
}

export function StockTabletConnectivity({ product }: { product: StockProduct }) {
  // Imported tablet names carry connectivity; do not infer it from IMEI/Serial.
  for (const description of [product.model, product.name]) {
    const text = description.replace(/[\u2010-\u2015]/g, '-');
    if (/\b(?:cellular|lte|4g|5g)\b/i.test(text)) return 'Wi-Fi + Cellular';
    if (/\bwi[\s-]?fi\b/i.test(text)) return 'Wi-Fi';
  }
  return 'ยังไม่ระบุ';
}

export function StockManufacturerWarranty({ product }: { product: StockProduct }) {
  const expiryDate = formatThaiDate(product.warrantyExpireDate);
  return (
    <span className="text-xs leading-snug">
      {product.warrantyExpired
        ? 'หมดประกันแล้ว'
        : expiryDate !== '-'
          ? `ถึง ${expiryDate}`
          : 'ยังไม่ระบุ'}
    </span>
  );
}

export function StockReceivedDate({ product }: { product: StockProduct }) {
  const receivedDate = formatThaiDate(product.stockInDate, 'Asia/Bangkok');
  if (receivedDate === '-') {
    return <span className="text-xs text-muted-foreground leading-snug">ยังไม่ระบุ</span>;
  }
  // The latest ready-for-sale entry, never the product record's creation date.
  // Both date and age use the Thai business calendar, regardless of browser timezone.
  const now = Date.now();
  const receivedAt = new Date(product.stockInDate!);
  const days = calendarDaysSince(product.stockInDate, now, 'Asia/Bangkok');
  const showAge =
    days != null &&
    ['IN_STOCK', 'RESERVED'].includes(product.status) &&
    receivedAt.getTime() <= now;
  return (
    <div className="space-y-1 tabular-nums leading-snug">
      <time dateTime={product.stockInDate!} className="whitespace-nowrap text-sm">
        {receivedDate}
      </time>
      {showAge && (
        <p className="text-xs text-muted-foreground leading-snug">
          ในสต็อก {days!.toLocaleString('th-TH')} วัน
        </p>
      )}
    </div>
  );
}

export function StockProductStatus({ product }: { product: StockProduct }) {
  const lock = product.status === 'RESERVED' ? product.lockedByBookings?.[0] : undefined;
  return (
    <div className="flex flex-wrap gap-1">
      {(product.stockGroup?.statuses ?? [product.status]).map((value) => {
        const status = statusLabels[value];
        if (value === 'RESERVED' && lock) {
          // คอลัมน์สถานะกว้าง 84px — สองบรรทัด (ป้าย + เลขใบจอง truncate) ชื่อลูกค้าอยู่ใน title/aria-label
          const fullText = `จองไว้ · ${lock.bookingNumber} (${lock.customer.name})`;
          return (
            <Link
              key={value}
              to={`/bookings?bookingId=${lock.id}`}
              title={fullText}
              aria-label={fullText}
              className={cn(
                'inline-flex max-w-full flex-col overflow-hidden rounded-md px-2 py-1 leading-snug underline underline-offset-2 decoration-dotted hover:decoration-solid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                status?.className || 'bg-muted text-foreground',
              )}
            >
              <span className="text-xs font-medium">จองไว้</span>
              <span className="truncate font-mono text-[11px]">{lock.bookingNumber}</span>
            </Link>
          );
        }
        return (
          <span
            key={value}
            className={cn(
              'inline-flex items-center whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium leading-snug',
              status?.className || 'bg-muted text-foreground',
            )}
          >
            {status?.label || value}
          </span>
        );
      })}
    </div>
  );
}

export function StockProductBranch({ product }: { product: StockProduct }) {
  return (
    <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground leading-snug">
      <MapPin aria-hidden="true" className="size-3 shrink-0" />
      <span className="truncate lg:max-w-32" title={product.branch.name}>
        {product.branch.name}
      </span>
    </div>
  );
}

/** Full identifier is selectable and never truncated; copying does not open the row. */
export function StockImei({ product }: { product: StockProduct }) {
  const { copy, copied } = useCopyToClipboard();
  if (product.category === 'ACCESSORY') return <span className="text-muted-foreground">—</span>;
  if (!product.imeiSerial) return <span className="text-xs text-muted-foreground">ยังไม่ระบุ</span>;
  return (
    <div className="stock-imei flex items-center gap-1">
      <span className="select-text font-mono text-xs tabular-nums leading-snug">
        {product.imeiSerial}
      </span>
      <button
        type="button"
        data-ui-control="button"
        data-ui-icon="true"
        aria-label="คัดลอก IMEI/Serial"
        onClick={() => copy(product.imeiSerial!)}
        className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:size-6"
      >
        {copied ? (
          <Check aria-hidden className="size-3.5 text-primary" />
        ) : (
          <Copy aria-hidden className="size-3.5" />
        )}
      </button>
    </div>
  );
}

export function StockInstallmentPlan({ plan }: { plan: InstallmentPlan | undefined }) {
  if (!plan?.quote) return <StockDownPayment plan={plan} />;
  return (
    <div className="stock-payment space-y-1.5 leading-snug">
      <div className="flex flex-wrap items-baseline justify-end gap-x-1.5">
        <span className="text-xs text-muted-foreground">ดาวน์</span>
        {plan.quote.downAmount === 0 ? (
          <strong className="text-primary">ฟรีดาวน์</strong>
        ) : (
          <StockPriceAmount value={plan.quote.downAmount} accent />
        )}
      </div>
      <div
        className="flex flex-wrap justify-end gap-x-1 text-xs tabular-nums text-muted-foreground"
        aria-label={`ผ่อนเดือนละ ${formatBaht(plan.quote.monthlyPayment)} บาท จำนวน ${plan.quote.months} งวด`}
      >
        <span>{formatBaht(plan.quote.monthlyPayment)} ฿</span>
        <span>× {plan.quote.months} งวด</span>
      </div>
    </div>
  );
}

/** Aggregated min cost and min price may belong to different units: never subtract those. */
export function StockAccessoryMargin({ product }: { product: StockProduct }) {
  const cash = product.stockGroup ? normalizeStockPrice(product.cashPrice) : getStockCash(product);
  const cost = normalizeStockPrice(product.costPrice);
  const group = product.stockGroup;
  if (
    cash == null ||
    cost == null ||
    (group &&
      (group.cashPriceMissingCount > 0 ||
        normalizeStockPrice(group.cashPriceMax) !== cash ||
        normalizeStockPrice(group.costPriceMax) !== cost))
  ) {
    return (
      <span className="text-xs text-muted-foreground">{group ? 'ดูแยกรายชิ้น' : 'ยังไม่ระบุ'}</span>
    );
  }
  const margin = new Decimal(cash).minus(cost).toNumber();
  return (
    <span className={cn('tabular-nums text-sm font-medium', margin < 0 && 'text-destructive')}>
      {formatBaht(margin)} ฿
    </span>
  );
}
function normalizeStockPrice(value: string | null | undefined) {
  return value != null &&
    value.trim() !== '' &&
    Number.isFinite(Number(value)) &&
    Number(value) >= 0
    ? Number(value)
    : null;
}
function getStockCash(product: StockProduct) {
  return getPositiveDisplayPrices(product).cash ?? null;
}
