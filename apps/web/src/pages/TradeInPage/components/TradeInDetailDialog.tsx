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
import Modal from '@/components/ui/Modal';
import type { TradeIn } from '../types';

interface Props {
  id: string | null;
  onClose: () => void;
  onVoucher?: (item: TradeIn) => void;
  voucherLoading?: boolean;
}

/** รายละเอียด TradeIn — โชว์คำตอบประเมินออนไลน์ + breakdown + รูป/แบต/โน้ตของ record online เก่า */
export default function TradeInDetailDialog({ id, onClose, onVoucher, voucherLoading }: Props) {
  const { user } = useAuth();
  const canIssueVoucher = ['OWNER', 'BRANCH_MANAGER'].includes(user?.role ?? '');
  const { data, isLoading, isError, error, refetch } = useQuery<TradeIn>({
    queryKey: ['trade-in-detail', id],
    queryFn: () => api.get(`/trade-ins/${id}`).then((r) => r.data),
    enabled: !!id,
    staleTime: 0,
  });

  return (
    <Modal isOpen={!!id} onClose={onClose} title="รายละเอียดรายการรับซื้อ" size="lg">
      <QueryBoundary
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={refetch}
        errorTitle="ไม่สามารถโหลดรายละเอียดรายการรับซื้อได้"
      >
        {data && (
          <div className="min-w-0 space-y-5 text-sm leading-snug">
            <section
              aria-label="ข้อมูลการรับซื้อ"
              className="rounded-lg border border-border p-4 space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">ข้อมูลการรับซื้อ</h2>
                <Badge
                  variant={getStatusBadgeProps(data.status, tradeInStatusMap).variant}
                  appearance={getStatusBadgeProps(data.status, tradeInStatusMap).appearance}
                >
                  {getStatusBadgeProps(data.status, tradeInStatusMap).label}
                </Badge>
              </div>
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <DetailField label="เลขเอกสาร">
                  {data.voucherNumber || 'ยังไม่ออกเอกสาร'}
                </DetailField>
                <DetailField label="ประเภท">
                  {data.paymentMethod === 'TRADE_IN_CREDIT' ||
                  (!['CASH', 'TRANSFER'].includes(data.paymentMethod ?? '') &&
                    data.flow === 'EXCHANGE')
                    ? 'เทิร์นเครื่อง'
                    : ['CASH', 'TRANSFER'].includes(data.paymentMethod ?? '') ||
                        data.flow === 'BUYBACK'
                      ? 'รับซื้อเงินสด / โอน'
                      : 'ไม่ระบุ'}
                </DetailField>
                <DetailField label="วันที่ทำรายการ">{dateTime(data.createdAt)}</DetailField>
                <DetailField label="สาขาที่รับเครื่อง">{data.branch?.name}</DetailField>
                <DetailField label="ราคาตกลงรับเครื่อง">{amount(data.agreedPrice)}</DetailField>
                {data.agreedPrice == null && (
                  <>
                    <DetailField label="ราคาที่เสนอ">{amount(data.offeredPrice)}</DetailField>
                    <DetailField label="ราคาประเมิน">{amount(data.estimatedValue)}</DetailField>
                  </>
                )}
                <DetailField label="วิธีจ่าย">
                  {data.paymentMethod === 'TRADE_IN_CREDIT'
                    ? 'เครดิตเทิร์นเครื่อง'
                    : data.paymentMethod === 'CASH'
                      ? 'เงินสด'
                      : data.paymentMethod === 'TRANSFER'
                        ? 'โอนเงิน'
                        : 'ยังไม่ระบุ'}
                </DetailField>
                <DetailField label="ผู้รับซื้อ">
                  {data.idCardVerifiedBy?.name || data.appraisedBy?.name}
                </DetailField>
                <DetailField label="วันที่ตรวจบัตรและรับเครื่อง">
                  {dateTime(data.idCardVerifiedAt)}
                </DetailField>
                {data.paymentMethod === 'TRANSFER' && (
                  <>
                    <DetailField label="ธนาคารผู้ขาย">{data.transferBankName}</DetailField>
                    <DetailField label="บัญชีผู้ขาย">
                      {maskAccountNumber(data.transferAccountNumber)}
                    </DetailField>
                    <DetailField label="ชื่อบัญชีผู้ขาย">{data.transferAccountName}</DetailField>
                  </>
                )}
                {data.paymentMethod === 'TRADE_IN_CREDIT' && (
                  <>
                    <DetailField label="มูลค่าเครื่องเป็นเครดิต">
                      {amount(data.creditBaseAmount)}
                    </DetailField>
                    <DetailField label="โบนัสส่วนลด">{amount(data.creditBonusAmount)}</DetailField>
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
              {onVoucher &&
                ['ACCEPTED', 'COMPLETED'].includes(data.status) &&
                (data.voucherNumber || canIssueVoucher) && (
                  <Button
                    variant="outline"
                    disabled={voucherLoading}
                    onClick={() => onVoucher(data)}
                  >
                    {voucherLoading
                      ? 'กำลังเปิดเอกสาร...'
                      : data.voucherNumber
                        ? 'พิมพ์เอกสารรับเครื่อง'
                        : 'ออกเอกสารรับเครื่อง'}
                  </Button>
                )}
              {onVoucher &&
                ['ACCEPTED', 'COMPLETED'].includes(data.status) &&
                !data.voucherNumber &&
                !canIssueVoucher && (
                  <p className="text-sm text-muted-foreground">
                    ให้ผู้จัดการออกเอกสารรับเครื่องก่อน แล้วจึงพิมพ์เอกสารได้
                  </p>
                )}
            </section>
            {data.productId && <InventorySummary productId={data.productId} />}

            <section aria-label="เครื่องและผู้ขายตามใบรับเครื่อง" className="space-y-3">
              <h2 className="font-semibold">เครื่องและผู้ขายตามใบรับเครื่อง</h2>
              <div>
                <div className="font-semibold">
                  {data.deviceBrand} {data.deviceModel} {data.deviceStorage ?? ''}
                </div>
                <div className="text-muted-foreground">
                  {data.deviceCondition && <>เกรด {data.deviceCondition}</>}
                  {data.batteryHealth != null && <> · แบตเตอรี่ {data.batteryHealth}%</>}
                </div>
                <div className="text-muted-foreground">
                  <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <DetailField label="IMEI">{data.imei || 'ไม่ระบุ'}</DetailField>
                    <DetailField label="Serial Number">
                      {data.serialNumber || 'ไม่ระบุ'}
                    </DetailField>
                  </dl>
                  {data.imeiMissingReason && <p>เหตุผลที่ไม่มี IMEI: {data.imeiMissingReason}</p>}
                  {data.serialNumberMissingReason && (
                    <p>เหตุผลที่ไม่มี Serial: {data.serialNumberMissingReason}</p>
                  )}
                </div>
                {data.preferredVisitDate && (
                  <div className="text-muted-foreground">
                    วันที่สะดวกเข้าร้าน:{' '}
                    {new Date(data.preferredVisitDate).toLocaleDateString('th-TH')}
                  </div>
                )}
              </div>

              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <DetailField label="สี">{data.deviceColor}</DetailField>
                <DetailField label="ชื่อผู้ขาย">
                  {data.sellerName ?? data.customer?.name}
                </DetailField>
                <DetailField label="โทรศัพท์ผู้ขาย">{data.sellerPhone}</DetailField>
                <DetailField label="ที่อยู่ผู้ขาย">{data.sellerAddress}</DetailField>
                <DetailField label="ตรวจบัตรประชาชน">
                  {data.idCardVerifiedAt ? 'ตรวจแล้ว' : 'ยังไม่มีข้อมูลการตรวจ'}
                </DetailField>
                <DetailField label="คำรับรองผู้ขาย">
                  {data.sellerConsentSigned ? 'ผู้ขายยอมรับแล้ว' : 'ยังไม่มีข้อมูลการยอมรับ'}
                </DetailField>
              </dl>
              {data.notes && (
                <p className="whitespace-pre-wrap wrap-anywhere">หมายเหตุพนักงาน: {data.notes}</p>
              )}
            </section>

            {data.quoteBreakdown && (
              <div className="rounded-lg border border-border p-3 space-y-1">
                <div className="font-medium">ใบเสนอราคาออนไลน์</div>
                {data.quoteBreakdown.chosenFlow && (
                  <div className="text-xs text-muted-foreground">
                    ประเภท:{' '}
                    {data.quoteBreakdown.chosenFlow === 'EXCHANGE'
                      ? 'เทิร์นแลกเครื่องใหม่ (เครดิต)'
                      : 'รับซื้อเงินสด'}
                  </div>
                )}
                <div className="flex justify-between text-muted-foreground">
                  <span>ราคาสูงสุด</span>
                  <span>{amount(data.quoteBreakdown.maxPrice)}</span>
                </div>
                {data.quoteBreakdown.cashPrice != null && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>ราคารับซื้อเงินสด</span>
                    <span>{amount(data.quoteBreakdown.cashPrice)}</span>
                  </div>
                )}
                {(Array.isArray(data.quoteBreakdown.lines) ? data.quoteBreakdown.lines : [])
                  .filter((l) => Number(l.amount) > 0)
                  .map((l, i) => (
                    <div key={i} className="flex justify-between text-muted-foreground">
                      <span>{l.label}</span>
                      <span>−฿{Number(l.amount).toLocaleString()}</span>
                    </div>
                  ))}
                {data.quoteBreakdown.chosenFlow === 'EXCHANGE' &&
                  data.quoteBreakdown.cashPrice &&
                  data.quoteBreakdown.exchangePrice && (
                    <div className="flex justify-between text-muted-foreground">
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
                <div className="font-medium">คำตอบประเมินออนไลน์ของลูกค้า</div>
                {data.conditionAnswers.map((a) => (
                  <div key={a.questionKey} className="flex justify-between gap-3">
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
              <div className="grid grid-cols-4 gap-2">
                {data.photoUrls!.map((url, i) => (
                  <a
                    key={i}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="block aspect-square rounded-lg overflow-hidden bg-muted"
                  >
                    <img src={url} alt={`รูปที่ ${i + 1}`} className="h-full w-full object-cover" />
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
      </QueryBoundary>
    </Modal>
  );
}

function DetailField({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="whitespace-pre-wrap wrap-anywhere">{children ?? 'ยังไม่ระบุ'}</dd>
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
      className="rounded-lg border border-border bg-muted/20 p-4 space-y-3"
    >
      <h2 className="font-semibold">สถานะเครื่องปัจจุบัน</h2>
      <QueryBoundary
        isLoading={product.isLoading}
        isError={product.isError}
        error={product.error}
        onRetry={product.refetch}
        errorTitle="ไม่สามารถโหลดสถานะเครื่องได้"
      >
        {product.data && (
          <>
            {badge && (
              <Badge variant={badge.variant} appearance={badge.appearance}>
                {badge.label}
              </Badge>
            )}
            <dl className="grid grid-cols-2 gap-3">
              <DetailField label="ราคาเงินสด">
                {normalizePositive(prices?.cash) != null ? amount(prices?.cash) : 'ยังไม่ตั้งราคา'}
              </DetailField>
              <DetailField label="ราคาผ่อน (ตั้งต้น)">
                {normalizePositive(prices?.installment) != null
                  ? amount(prices?.installment)
                  : 'ยังไม่ตั้งราคา'}
              </DetailField>
            </dl>
            {product.data.status === 'PHOTO_PENDING' && (
              <p className="text-sm text-muted-foreground">
                {canSetPrice ? 'ตรวจและตั้งราคาขาย' : 'ให้ผู้จัดการตั้งราคาขาย'} ถ่ายรูป 6 มุม
                แล้วกด “ยืนยันรูปครบ” ที่หน้าสินค้าเพื่อเข้าคลัง
              </p>
            )}
          </>
        )}
      </QueryBoundary>
      {photos.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
          <span>ไม่สามารถโหลดข้อมูลรูปถ่ายได้</span>
          <Button size="sm" variant="outline" onClick={() => photos.refetch()}>
            ลองโหลดรูปใหม่
          </Button>
        </div>
      ) : (
        <dl>
          <DetailField label="รูปถ่ายสินค้า">
            {photos.isLoading
              ? 'กำลังโหลดรูปถ่าย...'
              : photos.data && Number.isInteger(photos.data.completedCount)
                ? `${photos.data.completedCount}/${photos.data.totalCount} มุม`
                : 'ยังไม่มีข้อมูลรูปถ่าย'}
          </DetailField>
        </dl>
      )}
      <Button asChild variant="outline">
        <Link to={`/products/${productId}?zone=shop`}>เปิดเครื่อง ดูรูปและราคา</Link>
      </Button>
    </section>
  );
}
