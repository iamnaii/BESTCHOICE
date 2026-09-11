import { Check, Copy, MapPin } from 'lucide-react';
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
}: {
  product: StockProduct;
  onOpen: () => void;
  showProductCode?: boolean;
}) {
  const { copy, copied } = useCopyToClipboard();
  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={onOpen}
        className="cursor-pointer rounded text-left text-base font-semibold leading-snug text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:text-sm"
      >
        {product.category === 'ACCESSORY'
          ? product.name || product.model
          : product.model || product.name}
      </button>
      {product.imeiSerial ? (
        <div className="flex min-w-0 items-center gap-1">
          <span
            className="min-w-0 truncate font-mono text-xs text-muted-foreground"
            title={product.imeiSerial}
          >
            {product.imeiSerial}
          </span>
          <button
            type="button"
            onClick={() => copy(product.imeiSerial!)}
            aria-label="คัดลอก IMEI/Serial"
            className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:size-7"
          >
            {copied ? (
              <Check aria-hidden="true" className="size-3.5 text-primary" />
            ) : (
              <Copy aria-hidden="true" className="size-3.5" />
            )}
          </button>
        </div>
      ) : product.category !== 'ACCESSORY' ? (
        <p className="mt-1 text-xs text-muted-foreground leading-snug">ยังไม่ระบุ IMEI / Serial</p>
      ) : null}
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

export function StockProductSpecifications({ product }: { product: StockProduct }) {
  const specifications = [product.storage, product.color].filter(Boolean);
  return (
    <div className="text-sm leading-snug">
      {specifications.join(' · ') || '—'}
      {product.category === 'TABLET' && (
        <div className="mt-1 text-xs text-muted-foreground">
          <StockTabletConnectivity product={product} />
        </div>
      )}
    </div>
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

export function StockMonthlyPayment({ plan }: { plan: InstallmentPlan | undefined }) {
  if (!plan?.quote) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="space-y-1 leading-snug">
      <StockPriceAmount value={plan.quote.monthlyPayment} accent />
      <div className="whitespace-nowrap text-xs text-muted-foreground leading-snug">
        ต่อเดือน · {plan.quote.months} งวด
      </div>
    </div>
  );
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
  return (
    <div className="flex flex-wrap gap-1">
      {(product.stockGroup?.statuses ?? [product.status]).map((value) => {
        const status = statusLabels[value];
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
