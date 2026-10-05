import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Ban,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  HandCoins,
  MoreHorizontal,
  Pencil,
  Phone,
  ShoppingCart,
  Smartphone,
  Trash2,
  AlertTriangle,
} from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import { invalidateSalesQueries } from '@/lib/invalidate-sales-queries';
import { cn } from '@/lib/utils';
import { Badge, BadgeDot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { TenderInput, useTenders } from '@/components/tender/TenderInput';
import type { TenderRow } from '@/components/tender/tender-utils';
import { useBookingClock } from '../hooks/useBookingClock';
import type { Booking, BookingItem } from '../types';
import { formatThaiDateShort } from '@/lib/date';
import {
  awaitingExpiry,
  describeExpiry,
  fmtDate,
  fmtMoney,
  fmtMoneyShort,
  isOpenStatus,
  lastValidMs,
  STATUS_LABEL,
  STATUS_VARIANT,
} from '../utils';
import BookingTimeline, { METHOD_LABEL } from './BookingTimeline';
import CancelBookingDialog from './CancelBookingDialog';
import CreateBookingDialog from './CreateBookingDialog';

export interface BookingDetailSheetProps {
  bookingId: string;
  canMutate: boolean;
  canDelete: boolean;
  canAcknowledgeDamage: boolean;
  /** เปิดมาจาก "บันทึกและรับมัดจำเลย" / เมนู "รับมัดจำ" — ไฮไลต์กล่องรับเงิน */
  autoCollectDeposit?: boolean;
  onClose: () => void;
  onChanged: () => void;
}

/** บอกว่าเงินแต่ละวิธีของบิลนี้ลงบัญชีไหน — เงินสดเข้าลิ้นชักสาขา โอน/QR เข้าธนาคารรับเงินของร้าน (ย้ายมาจากหน้าเดิม) */
function ReceiptAccounts({ branch, rows }: { branch: Booking['branch']; rows: TenderRow[] }) {
  const cash = rows.some((r) => r.method === 'CASH');
  const bank = rows.some((r) => r.method !== 'CASH');
  return (
    <p className="text-xs leading-snug text-muted-foreground">
      รับเข้าบัญชี SHOP ·{' '}
      {[
        cash &&
          `เงินสด ${branch.name} (${branch.shopCashAccountCode || 'ยังไม่ได้ตั้งบัญชีเงินสดสาขา'})`,
        bank && 'ธนาคารรับเงิน (S11-1201)',
      ]
        .filter(Boolean)
        .join(' · ')}
    </p>
  );
}

function productState(
  booking: Booking,
  item?: BookingItem,
): { label: string; tone: 'ok' | 'muted' | 'bad' } {
  if (booking.status === 'CONVERTED') return { label: 'ส่งมอบแล้ว', tone: 'muted' };
  if (!item?.productId) return { label: 'ไม่ได้ผูกเครื่อง — แปลงขายไม่ได้', tone: 'bad' };
  const s = item.product?.status;
  if (!s) return { label: 'ไม่พบข้อมูลเครื่อง', tone: 'muted' };
  if (s === 'IN_STOCK') return { label: 'พร้อมขาย · ยังอยู่ในสต็อก', tone: 'ok' };
  if (s === 'RESERVED') return { label: 'จองไว้แล้ว', tone: 'ok' };
  if (s.startsWith('SOLD'))
    return { label: 'ถูกขายไปแล้ว — ต้องยกเลิกใบนี้แล้วออกใบใหม่', tone: 'bad' };
  return { label: `สถานะเครื่อง ${s}`, tone: 'muted' };
}

const usesCash = (rows: TenderRow[]) => rows.some((r) => r.method === 'CASH');

export default function BookingDetailSheet({
  bookingId,
  canMutate,
  canDelete,
  canAcknowledgeDamage,
  autoCollectDeposit,
  onClose,
  onChanged,
}: BookingDetailSheetProps) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const now = useBookingClock();
  const {
    data: booking,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<Booking>({
    queryKey: ['booking', bookingId],
    queryFn: async () => (await api.get(`/bookings/${bookingId}`)).data,
  });

  const [editOpen, setEditOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [collectBalance, setCollectBalance] = useState(false);
  const [damageAck, setDamageAck] = useState(false);

  const expired = !!booking && awaitingExpiry(booking, now);
  const item = booking?.items[0];
  const conversionBlocked =
    !!booking && (booking.items.length !== 1 || !item?.productId || item.quantity !== 1);
  const total = Number(booking?.totalAmount ?? 0);
  const deposit = Number(booking?.depositAmount ?? 0);
  const balance = total - deposit;
  const isPartial = !!booking && deposit < total;
  const depositTenders = useTenders(deposit);
  const balanceTenders = useTenders(isPartial ? balance : 0);

  const done = (event: 'booking-updated' | 'booking-converted', message: string) => {
    toast.success(message);
    void invalidateSalesQueries(qc, event);
    void qc.invalidateQueries({ queryKey: ['bookings-summary'] });
    onChanged();
  };
  const payMut = useMutation({
    mutationFn: () =>
      api.post(`/bookings/${bookingId}/pay-deposit`, {
        depositMethod: depositTenders.payload[0]?.method ?? 'CASH',
        tenders: depositTenders.payload,
      }),
    onSuccess: () => done('booking-updated', 'บันทึกการรับมัดจำแล้ว'),
    onError: (err) => toast.error(getErrorMessage(err)),
  });
  const convertMut = useMutation({
    mutationFn: async () =>
      (
        await api.post(`/bookings/${bookingId}/convert`, {
          saleType: 'CASH',
          collectBalance: isPartial ? collectBalance : undefined,
          paymentMethod: isPartial ? balanceTenders.payload[0]?.method : undefined,
          tenders: isPartial ? balanceTenders.payload : undefined,
          previouslyDamagedAcknowledged: damageAck || undefined,
        })
      ).data as { sale?: { id: string } },
    onSuccess: (data) => {
      done('booking-converted', 'บันทึกขายเงินสดแล้ว นำมัดจำมาหักยอดเรียบร้อย');
      if (data.sale?.id) navigate(`/sales?saleId=${encodeURIComponent(data.sale.id)}`);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });
  const cancelMut = useMutation({
    mutationFn: (cancelReason: string) =>
      api.post(`/bookings/${bookingId}/cancel`, { cancelReason }),
    onSuccess: () => {
      setCancelOpen(false);
      done(
        'booking-updated',
        deposit > 0 && booking?.status === 'PAID'
          ? 'ยกเลิกใบจองและคืนมัดจำแล้ว'
          : 'ยกเลิกใบจองแล้ว',
      );
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });
  const deleteMut = useMutation({
    mutationFn: () => api.delete(`/bookings/${bookingId}`),
    onSuccess: () => {
      setDeleteOpen(false);
      done('booking-updated', 'ลบใบจองแล้ว');
      onClose();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });
  const pending =
    payMut.isPending || convertMut.isPending || cancelMut.isPending || deleteMut.isPending;

  const copyPhone = async (phone: string) => {
    try {
      await navigator.clipboard.writeText(phone);
      toast.success('คัดลอกเบอร์แล้ว');
    } catch {
      toast.error('คัดลอกไม่สำเร็จ');
    }
  };

  if (editOpen && booking) {
    return (
      <CreateBookingDialog
        open
        initialBooking={booking}
        onClose={() => setEditOpen(false)}
        onSaved={() => {
          setEditOpen(false);
          void refetch();
          onChanged();
        }}
      />
    );
  }

  const expiry = booking ? describeExpiry(booking, now) : null;
  const canActOnOpen = canMutate && !!booking && isOpenStatus(booking.status) && !expired;
  const showMenu = canActOnOpen || (canDelete && booking?.status === 'PENDING_DEPOSIT' && !expired);
  const state = booking ? productState(booking, item) : null;

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        aria-label="รายละเอียดใบจอง"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-[620px]"
      >
        <SheetHeader className="space-y-1.5 border-b border-border px-5 py-4 pr-20 text-left">
          <SheetTitle className="flex flex-wrap items-center gap-2.5 font-mono text-base">
            {booking?.bookingNumber ?? (isError ? 'ใบจอง' : 'กำลังโหลด...')}
            {booking && (
              <Badge variant={STATUS_VARIANT[booking.status]} className="gap-1.5 font-sans">
                <BadgeDot />
                {STATUS_LABEL[booking.status]}
              </Badge>
            )}
          </SheetTitle>
          <SheetDescription className="leading-snug">
            {booking
              ? `สร้าง ${fmtDate(booking.createdAt)} · โดย ${booking.createdBy.name} · สาขา${booking.branch.name}`
              : 'รายละเอียดใบจอง'}
          </SheetDescription>
          {showMenu && (
            <div className="absolute right-12 top-3">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="การกระทำเพิ่มเติม">
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  {canActOnOpen && !conversionBlocked && (
                    <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                      <Pencil className="size-4" />{' '}
                      {booking!.status === 'PAID' ? 'แก้หมายเหตุ / วันหมดอายุ' : 'แก้ไขใบจอง'}
                    </DropdownMenuItem>
                  )}
                  {canActOnOpen && (
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={() => setCancelOpen(true)}
                    >
                      <Ban className="size-4" /> ยกเลิกใบจอง
                      {booking!.status === 'PAID' ? ` · คืนมัดจำ ${fmtMoneyShort(deposit)}` : ''}
                    </DropdownMenuItem>
                  )}
                  {canDelete && booking?.status === 'PENDING_DEPOSIT' && !expired && (
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={() => setDeleteOpen(true)}
                    >
                      <Trash2 className="size-4" /> ลบใบจอง
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </SheetHeader>

        {isError ? (
          <div role="alert" className="space-y-3 p-5 text-sm">
            <p>โหลดใบจองไม่สำเร็จ: {getErrorMessage(error)}</p>
            <Button variant="outline" onClick={() => refetch()}>
              ลองใหม่
            </Button>
          </div>
        ) : isLoading || !booking ? (
          <div className="py-10 text-center text-sm text-muted-foreground">กำลังโหลด...</div>
        ) : (
          <>
            {/* แถบใต้หัว: วันหมดอายุ / เหตุการณ์ปิด */}
            {expired ? (
              <div
                role="status"
                className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted px-5 py-2.5 text-[13px] leading-snug"
              >
                <span className="flex items-center gap-2">
                  <Clock className="size-4 text-destructive" />
                  ถึงกำหนดหมดอายุแล้ว กำลังรอระบบปิด (00:30) จึงรับเงิน แก้ไข หรือแปลงขายต่อไม่ได้
                </span>
                <Button size="sm" variant="outline" onClick={() => refetch()}>
                  โหลดสถานะล่าสุด
                </Button>
              </div>
            ) : booking.status === 'CONVERTED' ? (
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-primary/10 px-5 py-2.5 text-[13px] leading-snug">
                <span className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-primary" />
                  ขายแล้ว {booking.convertedAt ? fmtDate(booking.convertedAt) : ''} · ใบขาย{' '}
                  <span className="font-mono font-semibold">
                    {booking.convertedToSale?.saleNumber ?? '—'}
                  </span>
                </span>
                {booking.convertedToSale && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      navigate(`/sales?saleId=${encodeURIComponent(booking.convertedToSale!.id)}`)
                    }
                  >
                    <ExternalLink className="size-3.5" /> เปิดใบขาย / ใบเสร็จ
                  </Button>
                )}
              </div>
            ) : booking.status === 'CANCELED' ? (
              <div className="border-b border-border bg-destructive/10 px-5 py-2.5 text-[13px] leading-snug">
                ยกเลิก {booking.canceledAt ? fmtDate(booking.canceledAt) : ''}
                {booking.canceledBy ? ` · โดย ${booking.canceledBy.name}` : ''}
                {booking.cancelReason ? ` · เหตุผล: ${booking.cancelReason}` : ''}
                {booking.depositPaidAt
                  ? ` · คืนมัดจำ ${fmtMoneyShort(deposit)} (${METHOD_LABEL[booking.depositMethod ?? ''] ?? 'ตามวิธีที่รับมา'})`
                  : ''}
              </div>
            ) : booking.status === 'EXPIRED' ? (
              <div className="border-b border-border bg-muted px-5 py-2.5 text-[13px] leading-snug">
                หมดอายุสิ้นวัน {formatThaiDateShort(new Date(lastValidMs(booking.expireDate)))}
                {booking.depositPaidAt
                  ? ` · ริบมัดจำ ${fmtMoneyShort(deposit)} เข้ารายได้`
                  : ' · ยังไม่ได้รับมัดจำ'}
              </div>
            ) : (
              <div className="flex items-center gap-2 border-b border-border bg-muted px-5 py-2.5 text-[13px] leading-snug">
                <Clock className="size-4 text-muted-foreground" />
                <span>
                  {booking.status === 'PAID' ? 'ลูกค้าต้องมารับภายในสิ้นวัน' : 'ใช้ได้ถึงสิ้นวัน'}{' '}
                  <strong className="font-semibold">{expiry?.sub}</strong> (เวลาไทย) ·{' '}
                  {expiry?.label}
                </span>
              </div>
            )}

            <fieldset
              disabled={pending}
              className="min-w-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 text-sm"
            >
              {booking.status === 'PAID' && conversionBlocked && (
                <p
                  role="alert"
                  className="rounded-md border border-warning/40 bg-warning/10 p-3 leading-snug"
                >
                  ใบจองนี้ยังแปลงขายไม่ได้ ต้องมีเครื่องที่ผูกสต็อก 1 รายการ จำนวน 1 ชิ้น
                  กรุณายกเลิกและคืนเงินก่อนออกใบจองใหม่
                </p>
              )}

              <section>
                <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground">
                  ลูกค้า
                </h3>
                <div className="flex items-center gap-3">
                  <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-base font-semibold text-primary">
                    {booking.customer.name.slice(0, 1)}
                  </span>
                  <div className="min-w-0 flex-1 leading-snug">
                    <div className="text-[15px] font-semibold">{booking.customer.name}</div>
                    <div className="flex items-center gap-1.5 text-[13px] tabular-nums text-muted-foreground">
                      <Phone className="size-3.5" />
                      {booking.customer.phone ?? 'ไม่มีเบอร์'}
                      {booking.customer.phone && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6"
                          aria-label="คัดลอกเบอร์โทร"
                          onClick={() => copyPhone(booking.customer.phone!)}
                        >
                          <Copy className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="link"
                    size="sm"
                    onClick={() => navigate(`/customers/${booking.customer.id}`)}
                  >
                    ดูลูกค้า <ExternalLink className="size-3.5" />
                  </Button>
                </div>
              </section>

              <section>
                <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground">
                  เครื่องที่จอง
                </h3>
                <div className="flex items-center gap-3 rounded-lg border border-border p-3">
                  <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <Smartphone className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1 leading-snug">
                    <div className="truncate font-semibold">{item?.description ?? '—'}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {item?.product?.imeiSerial ? `IMEI ${item.product.imeiSerial}` : ''}
                      {item?.product?.wasPreviouslyDamaged ? ' · มีประวัติเสียหาย' : ''}
                    </div>
                    {state && (
                      <div
                        className={cn(
                          'mt-1 flex items-center gap-1 text-xs',
                          state.tone === 'ok'
                            ? 'text-success'
                            : state.tone === 'bad'
                              ? 'text-destructive'
                              : 'text-muted-foreground',
                        )}
                      >
                        {state.tone === 'bad' ? (
                          <AlertTriangle className="size-3.5" />
                        ) : (
                          <CheckCircle2 className="size-3.5" />
                        )}
                        {state.label}
                      </div>
                    )}
                  </div>
                  <div className="text-right leading-snug">
                    <div className="text-[11px] text-muted-foreground">ราคาตกลง</div>
                    <div className="font-semibold tabular-nums">
                      {fmtMoneyShort(item?.unitPrice ?? 0)}
                    </div>
                  </div>
                </div>
              </section>

              <section>
                <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground">
                  ยอดเงิน
                </h3>
                <div className="space-y-1.5">
                  <div className="flex justify-between">
                    <span>ยอดรวม</span>
                    <span className="tabular-nums">{fmtMoney(booking.totalAmount)}</span>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <span>
                      {booking.depositPaidAt ? 'มัดจำรับแล้ว' : 'มัดจำที่ต้องรับ'}
                      {booking.depositPaidAt && (
                        <span className="block text-xs text-muted-foreground">
                          {METHOD_LABEL[booking.depositMethod ?? ''] ?? booking.depositMethod} ·{' '}
                          {fmtDate(booking.depositPaidAt)}
                        </span>
                      )}
                    </span>
                    <span className="tabular-nums">{fmtMoney(booking.depositAmount)}</span>
                  </div>
                  <div className="flex justify-between border-t border-border pt-1.5 font-semibold">
                    <span>
                      {booking.status === 'PENDING_DEPOSIT'
                        ? 'ยอดที่ยังไม่ได้รับ'
                        : booking.status === 'PAID'
                          ? 'คงเหลือที่ต้องรับวันนี้'
                          : 'คงเหลือ'}
                    </span>
                    <span className="tabular-nums">
                      {fmtMoney(
                        booking.status === 'PENDING_DEPOSIT'
                          ? total
                          : booking.status === 'PAID'
                            ? balance
                            : 0,
                      )}
                    </span>
                  </div>
                </div>
              </section>

              {canMutate && booking.status === 'PENDING_DEPOSIT' && !expired && (
                <section
                  className={cn(
                    'space-y-3 rounded-xl border border-primary p-4',
                    autoCollectDeposit && 'ring-2 ring-primary/30',
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 font-semibold">
                      <HandCoins className="size-4 text-primary" />
                      รับมัดจำ
                    </span>
                    <span className="text-[13px] text-muted-foreground">
                      ยอดที่ต้องรับ{' '}
                      <strong className="font-semibold text-foreground tabular-nums">
                        {fmtMoneyShort(deposit)}
                      </strong>
                    </span>
                  </div>
                  <TenderInput
                    due={deposit}
                    value={depositTenders.rows}
                    onChange={depositTenders.setRows}
                    dueLabel="มัดจำที่ต้องรับ"
                    disabled={pending}
                  />
                  <ReceiptAccounts branch={booking.branch} rows={depositTenders.rows} />
                  <Button
                    size="lg"
                    className="w-full"
                    onClick={() => payMut.mutate()}
                    disabled={
                      pending ||
                      !depositTenders.status.ready ||
                      (usesCash(depositTenders.rows) && !booking.branch.shopCashAccountCode)
                    }
                  >
                    <HandCoins className="size-4" /> บันทึกรับมัดจำ {fmtMoneyShort(deposit)} บาท
                  </Button>
                </section>
              )}

              {canMutate &&
                booking.status === 'PAID' &&
                !expired &&
                !conversionBlocked &&
                !booking.convertedToSale && (
                  <section className="space-y-3 rounded-xl border border-primary p-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 font-semibold">
                        <ShoppingCart className="size-4 text-primary" />
                        {isPartial ? 'รับส่วนต่างและออกใบขาย' : 'ออกใบขายโดยใช้มัดจำ'}
                      </span>
                      {isPartial && (
                        <span className="text-[13px] text-muted-foreground">
                          ต้องรับ{' '}
                          <strong className="font-semibold text-foreground tabular-nums">
                            {fmtMoneyShort(balance)}
                          </strong>
                        </span>
                      )}
                    </div>
                    {isPartial && (
                      <>
                        <TenderInput
                          due={balance}
                          value={balanceTenders.rows}
                          onChange={balanceTenders.setRows}
                          dueLabel="ส่วนต่างที่ต้องรับ"
                          disabled={pending}
                        />
                        <ReceiptAccounts branch={booking.branch} rows={balanceTenders.rows} />
                        <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-2.5 leading-snug">
                          <Checkbox
                            checked={collectBalance}
                            onCheckedChange={(v) => setCollectBalance(v === true)}
                            className="mt-0.5"
                            aria-label="ยืนยันว่าได้รับยอดส่วนต่างครบแล้ว และส่งมอบเครื่องให้ลูกค้า"
                          />
                          <span>ยืนยันว่าได้รับยอดส่วนต่างครบแล้ว และส่งมอบเครื่องให้ลูกค้า</span>
                        </label>
                      </>
                    )}
                    {canAcknowledgeDamage && item?.product?.wasPreviouslyDamaged && (
                      <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-2.5 leading-snug">
                        <Checkbox
                          checked={damageAck}
                          onCheckedChange={(v) => setDamageAck(v === true)}
                          className="mt-0.5"
                        />
                        <span>
                          เครื่องมีประวัติเสียหาย — ยืนยันว่าได้แจ้งลูกค้าและอนุมัติให้ขายแล้ว
                        </span>
                      </label>
                    )}
                    <Button
                      size="lg"
                      className="w-full"
                      onClick={() => convertMut.mutate()}
                      disabled={
                        pending ||
                        (isPartial &&
                          (!collectBalance ||
                            !balanceTenders.status.ready ||
                            (usesCash(balanceTenders.rows) && !booking.branch.shopCashAccountCode)))
                      }
                    >
                      <ShoppingCart className="size-4" />{' '}
                      {isPartial
                        ? `รับส่วนต่าง ${fmtMoneyShort(balance)} และออกใบขาย`
                        : 'ออกใบขายโดยใช้มัดจำ'}
                    </Button>
                    <p className="text-center text-xs leading-snug text-muted-foreground">
                      ออกใบขายเงินสด · นำมัดจำ {fmtMoneyShort(deposit)} มาหักยอด ·
                      เปิดใบขายให้ต่อทันที
                    </p>
                  </section>
                )}

              {booking.notes && (
                <section>
                  <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground">
                    หมายเหตุ
                  </h3>
                  <p className="rounded-md bg-muted px-3 py-2 leading-snug">{booking.notes}</p>
                </section>
              )}

              <section>
                <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground">
                  ประวัติ
                </h3>
                <BookingTimeline events={booking.events ?? []} />
              </section>
            </fieldset>
          </>
        )}

        <CancelBookingDialog
          booking={booking ?? null}
          open={cancelOpen}
          onOpenChange={setCancelOpen}
          onConfirm={(reason) => cancelMut.mutate(reason)}
          loading={cancelMut.isPending}
        />
        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title={`ลบใบจอง ${booking?.bookingNumber ?? ''}?`}
          description="ลบได้เฉพาะใบที่ยังไม่รับมัดจำ ใบจะหายจากรายการ (เก็บประวัติไว้ในระบบ)"
          variant="destructive"
          confirmLabel="ลบใบจอง"
          loading={deleteMut.isPending}
          closeOnConfirm={false}
          onConfirm={() => deleteMut.mutate()}
        />
      </SheetContent>
    </Sheet>
  );
}
