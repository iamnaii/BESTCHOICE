import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Banknote, CalendarDays, ShieldCheck, Smartphone } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { invalidateSalesQueries } from '@/lib/invalidate-sales-queries';
import { formatThaiDateLong, toBangkokDateString, toBangkokExpiryInstant } from '@/lib/date';
import { cn } from '@/lib/utils';
import BookingProductPicker from '@/components/bookings/BookingProductPicker';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { Booking, BranchOption, CustomerOption } from '../types';
import { fmtMoneyShort, isDepositInRange } from '../utils';
import CustomerCombobox from './CustomerCombobox';

export interface CreateBookingDialogProps {
  open: boolean;
  onClose: () => void;
  /** บันทึกสำเร็จ · `collectDeposit` = ผู้ใช้กด "บันทึกและรับมัดจำเลย" (หน้าเปิดแผงรับเงินต่อ) */
  onSaved: (booking: Booking, opts: { collectDeposit: boolean }) => void;
  initialBooking?: Booking;
  initialCustomer?: CustomerOption | null;
}

interface SelectedProduct {
  productId: string;
  description: string;
  unitPrice: number;
}

const EXPIRY_PRESETS = [3, 7, 14] as const;
const DEPOSIT_PRESETS = [10, 20, 50] as const;
const plusDays = (days: number) => toBangkokDateString(new Date(Date.now() + days * 86_400_000));
/** วันไทยของเวลาหมดอายุเดิม (เก็บเป็นสิ้นวัน −1 ms ไว้ตรงตัว จึงถอย 1 ms ก่อนแปลง) */
const originalExpiryDateOnly = (b: Booking) =>
  toBangkokDateString(new Date(new Date(b.expireDate).getTime() - 1));
const chipClass = (active: boolean) =>
  cn(
    'inline-flex h-8 items-center gap-1 rounded-full border px-3 text-[13px] leading-snug transition-colors',
    active
      ? 'border-foreground bg-foreground text-background'
      : 'border-border bg-card hover:bg-muted',
  );

interface FormState {
  customer: CustomerOption | null;
  branchId: string;
  product: SelectedProduct | null;
  agreedPrice: number;
  deposit: number;
  expireDate: string;
  customDate: boolean;
  notes: string;
}

function buildInitialState(
  initialBooking: Booking | undefined,
  initialCustomer: CustomerOption | null | undefined,
  userBranchId: string | null | undefined,
): FormState {
  const item = initialBooking?.items[0];
  return {
    customer: initialBooking?.customer ?? initialCustomer ?? null,
    branchId: initialBooking?.branch.id ?? userBranchId ?? '',
    product: item?.productId
      ? {
          productId: item.productId,
          description: item.description,
          unitPrice: Number(item.unitPrice),
        }
      : null,
    agreedPrice: item ? Number(item.unitPrice) : 0,
    deposit: Number(initialBooking?.depositAmount ?? 0),
    expireDate: initialBooking ? originalExpiryDateOnly(initialBooking) : plusDays(7),
    customDate: false,
    notes: initialBooking?.notes ?? '',
  };
}

const hasMoreThan2Decimals = (n: number) =>
  Number.isFinite(n) && Math.abs(n * 100 - Math.round(n * 100)) > 1e-6;

function Step({
  n,
  title,
  right,
  children,
}: {
  n: number;
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2.5 text-sm font-semibold leading-snug">
          <span className="inline-flex size-6 items-center justify-center rounded-full bg-muted text-xs font-semibold">
            {n}
          </span>
          {title}
        </h3>
        {right}
      </div>
      {children}
    </section>
  );
}

export default function CreateBookingDialog({
  open,
  onClose,
  onSaved,
  initialBooking,
  initialCustomer,
}: CreateBookingDialogProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const paidEdit = initialBooking?.status === 'PAID';
  const canCreateCustomer = ['OWNER', 'BRANCH_MANAGER', 'SALES'].includes(user?.role ?? '');
  const init = buildInitialState(initialBooking, initialCustomer, user?.branchId);

  const [customer, setCustomer] = useState<CustomerOption | null>(init.customer);
  const [branchId, setBranchId] = useState(init.branchId);
  const [product, setProduct] = useState<SelectedProduct | null>(init.product);
  const [agreedPrice, setAgreedPrice] = useState(init.agreedPrice);
  const [deposit, setDeposit] = useState(init.deposit);
  const [expireDate, setExpireDate] = useState(init.expireDate);
  const [customDate, setCustomDate] = useState(init.customDate);
  const [notes, setNotes] = useState(init.notes);

  // เปิดใหม่/เปลี่ยนใบที่แก้/เปลี่ยนลูกค้าตั้งต้น → เริ่มฟอร์มใหม่ (ไม่พึ่ง key จากหน้าแม่)
  useEffect(() => {
    if (!open) return;
    const next = buildInitialState(initialBooking, initialCustomer, user?.branchId);
    setCustomer(next.customer);
    setBranchId(next.branchId);
    setProduct(next.product);
    setAgreedPrice(next.agreedPrice);
    setDeposit(next.deposit);
    setExpireDate(next.expireDate);
    setCustomDate(next.customDate);
    setNotes(next.notes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialBooking?.id, initialCustomer?.id]);

  const { data: branches } = useQuery<BranchOption[]>({
    queryKey: ['booking-branches'],
    enabled: open,
    queryFn: async () => {
      const { data } = await api.get('/branches');
      return (data.data ?? data ?? []) as BranchOption[];
    },
  });

  const total = product ? agreedPrice : 0;
  const balance = Math.max(0, total - deposit);
  const depositValid = isDepositInRange(deposit, total);
  const today = plusDays(0);
  const expiryUnchanged = !!initialBooking && expireDate === originalExpiryDateOnly(initialBooking);
  const expiryInPast = !!expireDate && !expiryUnchanged && expireDate < today;
  const expiryValid = !!expireDate && !expiryInPast;
  const depositDecimals = hasMoreThan2Decimals(deposit);
  const priceDecimals = hasMoreThan2Decimals(agreedPrice);
  const isValid = paidEdit
    ? expiryValid
    : !!customer &&
      !!branchId &&
      !!product &&
      agreedPrice >= 0 &&
      !priceDecimals &&
      !depositDecimals &&
      depositValid &&
      expiryValid;

  const save = useMutation({
    mutationFn: async (_vars: { collectDeposit: boolean }): Promise<Booking> => {
      const keepOriginal =
        !!initialBooking && expireDate === originalExpiryDateOnly(initialBooking);
      const expire = keepOriginal ? initialBooking!.expireDate : toBangkokExpiryInstant(expireDate);
      const items = product
        ? [
            {
              productId: product.productId,
              description: product.description,
              quantity: 1,
              unitPrice: agreedPrice,
            },
          ]
        : [];
      if (initialBooking) {
        const body = paidEdit
          ? { notes, expireDate: expire }
          : {
              customerId: customer!.id,
              branchId,
              expireDate: expire,
              depositAmount: deposit,
              notes,
              items,
            };
        return (await api.patch(`/bookings/${initialBooking.id}`, body)).data as Booking;
      }
      return (
        await api.post('/bookings', {
          customerId: customer!.id,
          branchId,
          expireDate: expire,
          depositAmount: deposit,
          notes: notes || undefined,
          items,
        })
      ).data as Booking;
    },
    onSuccess: (booking, vars) => {
      toast.success(initialBooking ? 'แก้ไขใบจองแล้ว' : 'สร้างใบจองแล้ว');
      void invalidateSalesQueries(queryClient, 'booking-updated');
      void queryClient.invalidateQueries({ queryKey: ['bookings-summary'] });
      onSaved(booking, { collectDeposit: vars.collectDeposit });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });
  const submit = (collectDeposit: boolean) => save.mutate({ collectDeposit });

  const pickProduct = (sel: { productId: string; description: string; unitPrice: number }) => {
    setProduct(sel);
    setAgreedPrice(sel.unitPrice);
  };
  const title = initialBooking
    ? paidEdit
      ? 'แก้หมายเหตุ / วันหมดอายุ'
      : 'แก้ไขใบจอง'
    : 'สร้างใบจอง';

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="leading-snug">
            {paidEdit
              ? 'รับมัดจำแล้ว แก้ได้เฉพาะหมายเหตุและวันหมดอายุ สถานะรับมัดจำและยอดเงินคงเดิม'
              : 'ระบุลูกค้า เครื่อง มัดจำ และวันหมดอายุ — ยังไม่บันทึกการรับเงิน จนกว่าจะกดรับมัดจำ'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <Step n={1} title="ลูกค้าและสาขา">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>ลูกค้า</Label>
                <CustomerCombobox
                  value={customer}
                  onChange={setCustomer}
                  disabled={paidEdit}
                  canCreate={canCreateCustomer && !paidEdit}
                />
                <p className="text-xs leading-snug text-muted-foreground">
                  พิมพ์ชื่อหรือเบอร์เพื่อค้นหา · ไม่พบ กดสร้างลูกค้าใหม่ได้ในช่องเดียวกัน
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="booking-branch">สาขา</Label>
                <Select
                  value={branchId}
                  onValueChange={(v) => {
                    setBranchId(v);
                    setProduct(null);
                  }}
                  disabled={paidEdit || user?.role !== 'OWNER'}
                >
                  <SelectTrigger id="booking-branch">
                    <SelectValue placeholder="เลือกสาขา" />
                  </SelectTrigger>
                  <SelectContent>
                    {(branches ?? []).map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs leading-snug text-muted-foreground">
                  ตามสาขาของผู้ใช้ · เจ้าของเลือกสาขาอื่นได้
                </p>
              </div>
            </div>
          </Step>

          <Step
            n={2}
            title="เครื่องที่จอง"
            right={
              <span className="text-xs text-muted-foreground">
                เลือกได้เฉพาะเครื่องที่อยู่ในสต็อกและพร้อมขาย
              </span>
            }
          >
            {product ? (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
                <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Smartphone className="size-5" />
                </span>
                <div className="min-w-0 flex-1 leading-snug">
                  <div className="truncate font-semibold">{product.description}</div>
                  <div className="text-xs text-primary">พร้อมขาย · ผูกเครื่องในสต็อกแล้ว</div>
                </div>
                <div className="text-right leading-snug">
                  <div className="text-[11px] text-muted-foreground">ราคาเงินสด</div>
                  <div className="font-semibold tabular-nums">
                    {fmtMoneyShort(product.unitPrice)}
                  </div>
                </div>
                {!paidEdit && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setProduct(null)}
                  >
                    เปลี่ยนเครื่อง
                  </Button>
                )}
              </div>
            ) : (
              <BookingProductPicker
                branchId={branchId}
                onSelect={pickProduct}
                onClear={() => setProduct(null)}
              />
            )}
            {product && !paidEdit && (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="booking-price">ราคาตกลง (บาท)</Label>
                  <Input
                    id="booking-price"
                    type="number"
                    min={0}
                    step="0.01"
                    value={agreedPrice}
                    onChange={(e) => setAgreedPrice(Number(e.target.value) || 0)}
                    aria-invalid={priceDecimals}
                    className="text-right tabular-nums"
                  />
                  {priceDecimals && (
                    <p className="text-xs leading-snug text-destructive">ทศนิยมไม่เกิน 2 ตำแหน่ง</p>
                  )}
                </div>
              </div>
            )}
            <p className="flex items-start gap-1.5 text-xs leading-snug text-muted-foreground">
              <ShieldCheck aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-primary" />
              เครื่องจะถูกล็อกไว้ให้ลูกค้าทันทีที่รับมัดจำ (POS ขายไม่ได้จนกว่าจะยกเลิกหรือหมดอายุ)
              · ก่อนรับมัดจำยังขายได้ตามปกติ
            </p>
          </Step>

          <Step n={3} title="มัดจำและวันหมดอายุ">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="booking-deposit">
                  {paidEdit ? 'มัดจำที่รับแล้ว (บาท)' : 'เงินมัดจำที่จะรับ (บาท)'}
                </Label>
                <Input
                  id="booking-deposit"
                  type="number"
                  min={0}
                  step="0.01"
                  value={deposit}
                  readOnly={paidEdit}
                  onChange={(e) => setDeposit(Number(e.target.value) || 0)}
                  aria-invalid={!paidEdit && ((total > 0 && !depositValid) || depositDecimals)}
                  className="h-10 text-right text-base font-medium tabular-nums"
                />
                {!paidEdit && (
                  <div className="flex flex-wrap gap-1.5">
                    {DEPOSIT_PRESETS.map((pct) => {
                      const amount = Math.round((total * pct) / 100);
                      return (
                        <button
                          key={pct}
                          type="button"
                          disabled={!total}
                          aria-pressed={!!total && deposit === amount}
                          className={chipClass(!!total && deposit === amount)}
                          onClick={() => setDeposit(amount)}
                        >
                          {pct}% · {fmtMoneyShort(amount)}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      disabled={!total}
                      aria-pressed={!!total && deposit === total}
                      className={chipClass(!!total && deposit === total)}
                      onClick={() => setDeposit(total)}
                    >
                      เต็มจำนวน
                    </button>
                  </div>
                )}
                {!paidEdit && depositDecimals && (
                  <p className="text-xs leading-snug text-destructive">ทศนิยมไม่เกิน 2 ตำแหน่ง</p>
                )}
                {!paidEdit && total > 0 && !depositValid && (
                  <p className="text-xs leading-snug text-destructive">
                    มัดจำต้องมากกว่า 0 และไม่เกินยอดรวม ({fmtMoneyShort(total)})
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>ใช้ได้ถึง</Label>
                <div className="flex flex-wrap gap-1.5">
                  {EXPIRY_PRESETS.map((days) => (
                    <button
                      key={days}
                      type="button"
                      aria-pressed={!customDate && expireDate === plusDays(days)}
                      className={chipClass(!customDate && expireDate === plusDays(days))}
                      onClick={() => {
                        setCustomDate(false);
                        setExpireDate(plusDays(days));
                      }}
                    >
                      {days} วัน
                    </button>
                  ))}
                  <button
                    type="button"
                    aria-pressed={customDate}
                    className={chipClass(customDate)}
                    onClick={() => setCustomDate(true)}
                  >
                    เลือกวันที่…
                  </button>
                </div>
                {customDate && (
                  <Input
                    type="date"
                    aria-label="วันหมดอายุ"
                    min={today}
                    aria-invalid={expiryInPast}
                    value={expireDate}
                    onChange={(e) => setExpireDate(e.target.value)}
                  />
                )}
                {expiryInPast && (
                  <p className="text-xs leading-snug text-destructive">วันหมดอายุต้องไม่ย้อนหลัง</p>
                )}
                <p className="flex items-center gap-1.5 text-sm leading-snug">
                  <CalendarDays aria-hidden="true" className="size-4 text-muted-foreground" />
                  สิ้นวัน{formatThaiDateLong(`${expireDate}T12:00:00+07:00`)} (เวลาไทย)
                </p>
                <p className="text-xs leading-snug text-muted-foreground">
                  เลยกำหนดแล้วมัดจำที่รับไว้จะถูกริบ — ลูกค้าต้องมารับก่อนวันนี้
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted px-4 py-3">
              <div>
                <div className="text-xs text-muted-foreground">ยอดรวม</div>
                <div className="font-medium tabular-nums">{fmtMoneyShort(total)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">
                  {paidEdit ? 'มัดจำรับแล้ว' : 'มัดจำที่จะรับ'}
                </div>
                <div className="font-medium tabular-nums">{fmtMoneyShort(deposit)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">คงเหลือตอนรับเครื่อง</div>
                <div className="font-semibold tabular-nums">{fmtMoneyShort(balance)}</div>
              </div>
            </div>
          </Step>

          <Step n={4} title="หมายเหตุ">
            <Textarea
              id="booking-notes"
              aria-label="หมายเหตุ"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="เช่น ลูกค้าจะมารับวันเสาร์ · ขอสีอื่นถ้ามี (ไม่บังคับ)"
            />
          </Step>
        </div>

        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <span className="self-center text-xs text-muted-foreground">
            ยังไม่บันทึกการรับเงิน จนกว่าจะกดรับมัดจำ
          </span>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              ยกเลิก
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!isValid || save.isPending}
              onClick={() => submit(false)}
            >
              {save.isPending
                ? 'กำลังบันทึก...'
                : initialBooking
                  ? 'บันทึกการแก้ไข'
                  : 'บันทึกใบจอง'}
            </Button>
            {!paidEdit && (
              <Button
                type="button"
                disabled={!isValid || save.isPending}
                onClick={() => submit(true)}
              >
                <Banknote className="size-4" /> บันทึกและรับมัดจำเลย
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
