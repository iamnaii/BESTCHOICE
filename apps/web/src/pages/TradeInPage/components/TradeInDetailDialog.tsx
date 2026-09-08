import type { ReactNode } from 'react';
import { Link } from 'react-router';
import QueryBoundary from '@/components/QueryBoundary';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { getStatusBadgeProps, productStatusMap, tradeInStatusMap } from '@/lib/status-badges';
import { formatThaiDate, formatThaiTime } from '@/lib/date';
import { maskAccountNumber } from '@/utils/mask.util';
import {
  getPositiveDisplayPrices,
  normalizePositive,
  type ProductForDisplay,
} from '@/utils/getDisplayPrices';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ArrowRight, Camera, FileText, Printer, Smartphone, UserRound, X } from 'lucide-react';
import type { TradeIn } from '../types';

interface Props {
  id: string | null;
  onClose: () => void;
  onVoucher?: (item: TradeIn) => void;
  voucherLoading?: boolean;
}

/** Receipt identity and agreed terms stay separate from current inventory data. */
export default function TradeInDetailDialog({ id, onClose, onVoucher, voucherLoading }: Props) {
  const { user } = useAuth();
  const canIssueVoucher = ['OWNER', 'BRANCH_MANAGER'].includes(user?.role ?? '');
  const { data, isLoading, isError, error, refetch } = useQuery<TradeIn>({
    queryKey: ['trade-in-detail', id],
    queryFn: () => api.get(`/trade-ins/${id}`).then((r) => r.data),
    enabled: !!id,
    staleTime: 0,
  });

  const status = data ? getStatusBadgeProps(data.status, tradeInStatusMap) : null;
  const canPrint = data && onVoucher && ['ACCEPTED', 'COMPLETED'].includes(data.status);
  const paymentLabel =
    data?.paymentMethod === 'TRADE_IN_CREDIT'
      ? 'เครดิตเทิร์นเครื่อง'
      : data?.paymentMethod === 'CASH'
        ? 'เงินสด'
        : data?.paymentMethod === 'TRANSFER'
          ? 'โอนเงิน'
          : 'ยังไม่ระบุ';

  return (
    <Dialog
      open={!!id}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="w-[calc(100%-1rem)] max-w-4xl max-h-[calc(100dvh-1rem)] gap-0 overflow-hidden rounded-xl p-0 motion-reduce:animate-none"
      >
        <DialogHeader className="mb-0 flex-row items-center justify-between gap-3 space-y-0 border-b border-border px-5 py-3 text-start sm:px-7">
          <div className="min-w-0">
            <DialogTitle className="text-base">รายละเอียดรายการรับซื้อ</DialogTitle>
            <DialogDescription className="sr-only">
              ข้อมูลตามใบรับเครื่อง สถานะสินค้า และเอกสารรับซื้อ
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <Button variant="ghost" size="icon" className="size-11" aria-label="Close">
              <X className="size-5" aria-hidden="true" />
            </Button>
          </DialogClose>
        </DialogHeader>
        <div
          className="min-h-0 overflow-y-auto overscroll-contain px-5 py-5 sm:px-7 sm:py-6"
          data-testid="trade-in-detail-body"
        >
          <QueryBoundary
            isLoading={isLoading}
            isError={isError}
            error={error}
            onRetry={refetch}
            errorTitle="ไม่สามารถโหลดรายละเอียดรายการรับซื้อได้"
          >
            {data && (
              <div className="min-w-0 space-y-6 text-sm leading-snug">
                <section aria-label="เครื่องตามใบรับเครื่อง" className="space-y-5">
                  <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <Smartphone className="size-6" aria-hidden="true" />
                      </div>
                      <div className="min-w-0 space-y-2">
                        <h3 className="text-xl font-semibold leading-snug tracking-tight wrap-anywhere sm:text-2xl">
                          {data.deviceBrand} {data.deviceModel}
                        </h3>
                        <p className="text-muted-foreground">
                          {[
                            data.deviceStorage,
                            data.deviceColor,
                            data.deviceCondition && `เกรด ${data.deviceCondition}`,
                            data.batteryHealth != null && `แบตเตอรี่ ${data.batteryHealth}%`,
                          ]
                            .filter(Boolean)
                            .join(' · ') || 'ยังไม่ระบุสภาพเครื่อง'}
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          {status && (
                            <Badge
                              variant={status.variant}
                              appearance={status.appearance}
                              className="text-foreground"
                            >
                              {status.label}
                            </Badge>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {data.paymentMethod === 'TRADE_IN_CREDIT' ||
                            (!['CASH', 'TRANSFER'].includes(data.paymentMethod ?? '') &&
                              data.flow === 'EXCHANGE')
                              ? 'เทิร์นเครื่อง'
                              : ['CASH', 'TRANSFER'].includes(data.paymentMethod ?? '') ||
                                  data.flow === 'BUYBACK'
                                ? 'รับซื้อเงินสด / โอน'
                                : 'ไม่ระบุ'}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-lg bg-muted/50 px-4 py-3 sm:min-w-44 sm:text-right">
                      <dl>
                        <div>
                          <dt className="text-xs text-muted-foreground">ราคาตกลงรับเครื่อง</dt>
                          <dd className="mt-1 text-2xl font-semibold leading-snug tracking-tight tabular-nums sm:text-3xl">
                            {amount(data.agreedPrice)}
                          </dd>
                        </div>
                      </dl>
                      <p className="mt-1 text-xs text-muted-foreground">{paymentLabel}</p>
                    </div>
                  </div>
                  <dl className="grid gap-3 rounded-lg border border-border px-4 py-3 sm:grid-cols-2">
                    <DetailField label="IMEI" mono>
                      {data.imei || 'ไม่ระบุ'}
                    </DetailField>
                    <DetailField label="Serial Number" mono>
                      {data.serialNumber || 'ไม่ระบุ'}
                    </DetailField>
                  </dl>
                  {(data.imeiMissingReason || data.serialNumberMissingReason) && (
                    <div className="space-y-1 text-muted-foreground">
                      {data.imeiMissingReason && (
                        <p>เหตุผลที่ไม่มี IMEI: {data.imeiMissingReason}</p>
                      )}
                      {data.serialNumberMissingReason && (
                        <p>เหตุผลที่ไม่มี Serial: {data.serialNumberMissingReason}</p>
                      )}
                    </div>
                  )}
                </section>

                {data.productId && <InventorySummary productId={data.productId} />}

                <div className="grid gap-6 sm:grid-cols-2 sm:gap-8">
                  <section aria-label="ข้อมูลการรับซื้อ" className="min-w-0 space-y-4">
                    <h3 className="flex items-center gap-2 font-semibold">
                      <FileText className="size-4 text-muted-foreground" aria-hidden="true" />
                      ข้อมูลการรับซื้อ
                    </h3>
                    <dl className="grid gap-4 sm:grid-cols-2">
                      <DetailField label="เลขเอกสาร">
                        {data.voucherNumber || 'ยังไม่ออกเอกสาร'}
                      </DetailField>
                      <DetailField label="วันที่ทำรายการ">{dateTime(data.createdAt)}</DetailField>
                      <DetailField label="สาขาที่รับเครื่อง">{data.branch?.name}</DetailField>
                      <DetailField label="ผู้รับซื้อ">
                        {data.idCardVerifiedBy?.name || data.appraisedBy?.name}
                      </DetailField>
                      <DetailField label="วิธีจ่าย">{paymentLabel}</DetailField>
                      <DetailField label="วันที่ตรวจบัตรและรับเครื่อง">
                        {dateTime(data.idCardVerifiedAt)}
                      </DetailField>
                      {data.agreedPrice == null && (
                        <>
                          <DetailField label="ราคาที่เสนอ">{amount(data.offeredPrice)}</DetailField>
                          <DetailField label="ราคาประเมิน">
                            {amount(data.estimatedValue)}
                          </DetailField>
                        </>
                      )}
                      {data.paymentMethod === 'TRANSFER' && (
                        <>
                          <DetailField label="ธนาคารผู้ขาย">{data.transferBankName}</DetailField>
                          <DetailField label="บัญชีผู้ขาย">
                            {maskAccountNumber(data.transferAccountNumber)}
                          </DetailField>
                          <DetailField label="ชื่อบัญชีผู้ขาย">
                            {data.transferAccountName}
                          </DetailField>
                        </>
                      )}
                      {data.paymentMethod === 'TRADE_IN_CREDIT' && (
                        <>
                          <DetailField label="มูลค่าเครื่องเป็นเครดิต">
                            {amount(data.creditBaseAmount)}
                          </DetailField>
                          <DetailField label="โบนัสส่วนลด">
                            {amount(data.creditBonusAmount)}
                          </DetailField>
                          <DetailField label="สถานะเครดิต">
                            {data.creditIssuedAt
                              ? data.currentRedemptionId
                                ? 'ใช้เครดิตแล้ว'
                                : 'ยังไม่ใช้เครดิต'
                              : 'ยังไม่ออกเครดิต'}
                          </DetailField>
                        </>
                      )}
                    </dl>
                  </section>

                  <section
                    aria-label="เครื่องและผู้ขายตามใบรับเครื่อง"
                    className="min-w-0 space-y-4 border-t border-border pt-5 sm:border-t-0 sm:border-l sm:pl-6 sm:pt-0"
                  >
                    <h3 className="flex items-center gap-2 font-semibold">
                      <UserRound className="size-4 text-muted-foreground" aria-hidden="true" />
                      ข้อมูลผู้ขายและหลักฐาน
                    </h3>
                    <dl className="grid gap-4 sm:grid-cols-2">
                      <DetailField label="ชื่อผู้ขาย">
                        {data.sellerName ?? data.customer?.name}
                      </DetailField>
                      <DetailField label="โทรศัพท์ผู้ขาย">{data.sellerPhone}</DetailField>
                      <div className="sm:col-span-2">
                        <DetailField label="ที่อยู่ผู้ขาย">{data.sellerAddress}</DetailField>
                      </div>
                      <DetailField label="ตรวจบัตรประชาชน">
                        {data.idCardVerifiedAt ? 'ตรวจแล้ว' : 'ยังไม่มีข้อมูลการตรวจ'}
                      </DetailField>
                      <DetailField label="คำรับรองผู้ขาย">
                        {data.sellerConsentSigned ? 'ผู้ขายยอมรับแล้ว' : 'ยังไม่มีข้อมูลการยอมรับ'}
                      </DetailField>
                      {data.preferredVisitDate && (
                        <DetailField label="วันที่สะดวกเข้าร้าน">
                          {formatThaiDate(data.preferredVisitDate)}
                        </DetailField>
                      )}
                    </dl>
                    {data.notes && (
                      <p className="whitespace-pre-wrap wrap-anywhere text-muted-foreground">
                        หมายเหตุพนักงาน: {data.notes}
                      </p>
                    )}
                  </section>
                </div>

                {data.quoteBreakdown && (
                  <div className="rounded-lg border border-border p-3 space-y-1">
                    <div className="font-medium">รายละเอียดราคาประเมิน</div>
                    {data.quoteBreakdown.chosenFlow && (
                      <div className="text-xs text-muted-foreground">
                        ประเภท:{' '}
                        {data.quoteBreakdown.chosenFlow === 'EXCHANGE'
                          ? 'เทิร์นแลกเครื่องใหม่ (เครดิต)'
                          : 'รับซื้อเงินสด'}
                      </div>
                    )}
                    <div className="flex justify-between gap-4 wrap-anywhere text-muted-foreground">
                      <span>ราคาสูงสุด</span>
                      <span>{amount(data.quoteBreakdown.maxPrice)}</span>
                    </div>
                    {data.quoteBreakdown.cashPrice != null && (
                      <div className="flex justify-between gap-4 wrap-anywhere text-muted-foreground">
                        <span>ราคารับซื้อเงินสด</span>
                        <span>{amount(data.quoteBreakdown.cashPrice)}</span>
                      </div>
                    )}
                    {(Array.isArray(data.quoteBreakdown.lines) ? data.quoteBreakdown.lines : [])
                      .filter((l) => Number(l.amount) > 0)
                      .map((l, i) => (
                        <div
                          key={i}
                          className="flex justify-between gap-4 wrap-anywhere text-muted-foreground"
                        >
                          <span>{l.label}</span>
                          <span>−฿{Number(l.amount).toLocaleString()}</span>
                        </div>
                      ))}
                    {data.quoteBreakdown.chosenFlow === 'EXCHANGE' &&
                      data.quoteBreakdown.cashPrice &&
                      data.quoteBreakdown.exchangePrice && (
                        <div className="flex justify-between gap-4 wrap-anywhere text-muted-foreground">
                          <span>โบนัสเทิร์น +{Number(data.quoteBreakdown.bonusPct ?? 0)}%</span>
                          <span>
                            +฿
                            {(
                              Number(data.quoteBreakdown.exchangePrice) -
                              Number(data.quoteBreakdown.cashPrice)
                            ).toLocaleString()}
                          </span>
                        </div>
                      )}
                    <div className="flex justify-between font-semibold border-t border-border pt-1">
                      <span>ราคาที่เสนอ</span>
                      <span>{amount(data.quoteBreakdown.price)}</span>
                    </div>
                  </div>
                )}

                {Array.isArray(data.conditionAnswers) && data.conditionAnswers.length > 0 && (
                  <div className="rounded-lg border border-border p-3 space-y-1.5">
                    <div className="font-medium">คำตอบแบบประเมินสภาพเครื่อง</div>
                    {data.conditionAnswers.map((a) => (
                      <div key={a.questionKey} className="flex justify-between gap-3 wrap-anywhere">
                        <span className="text-muted-foreground">{a.title}</span>
                        <span className="text-right">
                          {!Array.isArray(a.choices)
                            ? 'ยังไม่มีคำตอบ'
                            : a.choices.length === 0
                              ? 'ไม่มีปัญหา'
                              : a.choices.map((c) => c.label).join(', ')}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {data.customerNotes && (
                  <div className="text-muted-foreground">หมายเหตุลูกค้า: {data.customerNotes}</div>
                )}

                {(data.photoUrls?.length ?? 0) > 0 && (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {data.photoUrls!.map((url, i) => (
                      <a
                        key={i}
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="block aspect-square rounded-lg overflow-hidden bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        <img
                          src={url}
                          alt={`รูปประเมินเครื่องที่ ${i + 1}`}
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}
          </QueryBoundary>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/30 px-5 py-3 sm:px-7">
          <div className="min-w-0 flex-1">
            {!isError && canPrint && (data.voucherNumber || canIssueVoucher) && (
              <Button
                variant="outline"
                className="min-h-11 w-full whitespace-normal leading-snug sm:w-auto"
                disabled={voucherLoading}
                onClick={() => onVoucher(data)}
              >
                <Printer className="size-4" aria-hidden="true" />
                {voucherLoading
                  ? 'กำลังเปิดเอกสาร...'
                  : data.voucherNumber
                    ? 'พิมพ์เอกสารรับเครื่อง'
                    : 'ออกเอกสารรับเครื่อง'}
              </Button>
            )}
            {!isError && canPrint && !data.voucherNumber && !canIssueVoucher && (
              <p className="text-xs leading-snug text-muted-foreground">
                ให้ผู้จัดการออกเอกสารรับเครื่องก่อน แล้วจึงพิมพ์เอกสารได้
              </p>
            )}
          </div>
          <DialogClose asChild>
            <Button variant="ghost" className="min-h-11 px-5">
              ปิด
            </Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DetailField({
  label,
  children,
  mono = false,
}: {
  label: string;
  children?: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={`whitespace-pre-wrap wrap-anywhere text-base leading-snug sm:text-sm ${mono ? 'font-mono tabular-nums' : ''}`}
      >
        {children ?? 'ยังไม่ระบุ'}
      </dd>
    </div>
  );
}

function amount(value: string | number | null | undefined) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return 'ยังไม่ระบุ';
  return `฿${Number(value).toLocaleString('th-TH', { minimumFractionDigits: Number(value) % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
}

function dateTime(value?: string | null) {
  return value ? `${formatThaiDate(value)} ${formatThaiTime(value)} น.` : 'ยังไม่ระบุ';
}

function InventorySummary({ productId }: { productId: string }) {
  const { user } = useAuth();
  const canSetPrice = ['OWNER', 'BRANCH_MANAGER'].includes(user?.role ?? '');
  const product = useQuery<ProductForDisplay & { status: string }>({
    queryKey: ['product', productId],
    queryFn: async () => (await api.get(`/products/${productId}`)).data,
    refetchOnMount: 'always',
  });
  const photos = useQuery<{ completedCount: number; totalCount: number }>({
    queryKey: ['product-photos', productId],
    queryFn: async () => (await api.get(`/products/${productId}/photos`)).data,
    refetchOnMount: 'always',
  });
  const prices = product.data
    ? getPositiveDisplayPrices({ ...product.data, prices: product.data.prices ?? [] })
    : null;
  const badge = product.data ? getStatusBadgeProps(product.data.status, productStatusMap) : null;
  return (
    <section
      aria-label="สถานะเครื่องปัจจุบัน"
      className="space-y-4 rounded-xl border border-border bg-muted/30 p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">สถานะเครื่องปัจจุบัน</h3>
        {!product.isError && badge && (
          <Badge variant={badge.variant} appearance={badge.appearance} className="text-foreground">
            {badge.label}
          </Badge>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <QueryBoundary
          isLoading={product.isLoading}
          isError={product.isError}
          error={product.error}
          onRetry={product.refetch}
          errorTitle="ไม่สามารถโหลดสถานะเครื่องได้"
        >
          {product.data && (
            <dl className="grid grid-cols-2 gap-4 [&_dd]:text-lg [&_dd]:font-semibold [&_dd]:tabular-nums">
              <DetailField label="ราคาเงินสด">
                {normalizePositive(prices?.cash) != null ? amount(prices?.cash) : 'ยังไม่ตั้งราคา'}
              </DetailField>
              <DetailField label="ราคาผ่อน (ตั้งต้น)">
                {normalizePositive(prices?.installment) != null
                  ? amount(prices?.installment)
                  : 'ยังไม่ตั้งราคา'}
              </DetailField>
            </dl>
          )}
        </QueryBoundary>
        {photos.isError ? (
          <div role="alert" className="space-y-2 text-sm text-destructive">
            <p>ไม่สามารถโหลดข้อมูลรูปถ่ายได้</p>
            <Button variant="outline" className="min-h-11" onClick={() => photos.refetch()}>
              ลองโหลดรูปใหม่
            </Button>
          </div>
        ) : (
          <dl className="border-t border-border pt-3 sm:border-t-0 sm:border-l sm:pl-5 sm:pt-0">
            <div className="space-y-1">
              <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Camera className="size-3.5" aria-hidden="true" />
                รูปถ่ายสินค้า
              </dt>
              <dd className="text-lg font-semibold leading-snug tabular-nums">
                {photos.isLoading
                  ? 'กำลังโหลดรูปถ่าย...'
                  : photos.data && Number.isInteger(photos.data.completedCount)
                    ? `${photos.data.completedCount}/${photos.data.totalCount} มุม`
                    : 'ยังไม่มีข้อมูลรูปถ่าย'}
              </dd>
            </div>
          </dl>
        )}
      </div>
      <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground leading-snug">
          {!product.isError && product.data?.status === 'PHOTO_PENDING'
            ? `${canSetPrice ? 'ตรวจและตั้งราคาขาย' : 'ให้ผู้จัดการตั้งราคาขาย'} ถ่ายรูป 6 มุม แล้วกด “ยืนยันรูปครบ” ที่หน้าสินค้าเพื่อเข้าคลัง`
            : 'เปิดหน้าสินค้าเพื่อตรวจรูป ราคา และสถานะล่าสุด'}
        </p>
        <Button
          asChild
          className="min-h-11 shrink-0 whitespace-normal leading-snug bg-[color-mix(in_srgb,var(--color-primary)_85%,var(--color-foreground))] hover:bg-[color-mix(in_srgb,var(--color-primary)_75%,var(--color-foreground))] dark:bg-primary dark:text-background dark:hover:bg-primary/90"
        >
          <Link to={`/products/${productId}?zone=shop`}>
            เปิดเครื่อง ดูรูปและราคา
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </section>
  );
}
