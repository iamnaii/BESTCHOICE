import { invalidateSalesQueries } from '@/lib/invalidate-sales-queries';
import { usePaginationParams } from '@/hooks/usePaginationParams';
import { PaginationBar } from '@/components/ui/PaginationBar';
import { useDebounce } from '@/hooks/useDebounce';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { formatThaiDateTime, toBangkokDateString, toBangkokExpiryInstant } from '@/lib/date';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import BookingProductPicker from '@/components/bookings/BookingProductPicker';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import {
  CalendarDays,
  Plus,
  HandCoins,
  Ban,
  ShoppingCart,
  Trash2,
  Search,
} from 'lucide-react';

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export type BookingStatus =
  | 'PENDING_DEPOSIT'
  | 'PAID'
  | 'CANCELED'
  | 'EXPIRED'
  | 'CONVERTED';

interface BookingItem {
  id: string;
  productId?: string | null;
  description: string;
  quantity: number;
  unitPrice: string | number;
  amount: string | number;
}

interface Booking {
  id: string;
  bookingNumber: string;
  status: BookingStatus;
  depositAmount: string | number;
  totalAmount: string | number;
  expireDate: string;
  notes?: string | null;
  depositPaidAt?: string | null;
  depositMethod?: string | null;
  canceledAt?: string | null;
  cancelReason?: string | null;
  customer: { id: string; name: string; phone?: string | null };
  branch: { id: string; name: string; shopCashAccountCode?: string | null };
  createdBy: { id: string; name: string };
  canceledBy?: { id: string; name: string } | null;
  convertedToSale?: { id: string; saleNumber: string } | null;
  items: BookingItem[];
  createdAt: string;
}

interface BookingListResponse {
  data: Booking[];
  total: number;
  page: number;
  limit: number;
}

interface CustomerOption {
  id: string;
  name: string;
  phone?: string | null;
}

interface BranchOption {
  id: string;
  name: string;
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

export const STATUS_LABEL: Record<BookingStatus, string> = {
  PENDING_DEPOSIT: 'รอชำระมัดจำ',
  PAID: 'มัดจำแล้ว',
  CANCELED: 'ยกเลิก',
  EXPIRED: 'หมดอายุ',
  CONVERTED: 'ขายแล้ว',
};

const STATUS_VARIANT: Record<
  BookingStatus,
  'primary' | 'secondary' | 'destructive' | 'outline' | 'success' | 'info'
> = {
  PENDING_DEPOSIT: 'secondary',
  PAID: 'success',
  CANCELED: 'destructive',
  EXPIRED: 'outline',
  CONVERTED: 'primary',
};

export function computeBookingTotal(
  items: { quantity: number; unitPrice: number }[],
): number {
  return items.reduce(
    (sum, it) => sum + Math.round(it.quantity * it.unitPrice * 100) / 100,
    0,
  );
}

export function isDepositInRange(depositAmount: number, totalAmount: number): boolean {
  if (!Number.isFinite(depositAmount) || !Number.isFinite(totalAmount)) return false;
  if (depositAmount < 0) return false;
  if (totalAmount < 0) return false;
  return depositAmount <= totalAmount;
}

function fmtMoney(v: string | number): string {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (!Number.isFinite(n)) return '0.00';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(s: string): string {
  return formatThaiDateTime(s, 'Asia/Bangkok');
}

function awaitingExpiry(booking: Pick<Booking, 'status' | 'expireDate'>, now: number): boolean {
  return ['PAID', 'PENDING_DEPOSIT'].includes(booking.status) && new Date(booking.expireDate).getTime() <= now;
}

function useBookingClock() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = window.setInterval(tick, 1000);
    window.addEventListener('focus', tick);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', tick); };
  }, []);
  return now;
}

function ReceiptMethodSelect({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <div className="space-y-2"><Label>{label}</Label>
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label}><SelectValue placeholder="เลือกวิธีรับเงิน" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="CASH">เงินสด</SelectItem>
        <SelectItem value="BANK_TRANSFER">โอนธนาคาร</SelectItem>
        <SelectItem value="QR_EWALLET">QR / e-Wallet</SelectItem>
      </SelectContent>
    </Select>
  </div>;
}

function ReceiptAccount({ branch, method }: { branch: Booking['branch']; method: string }) {
  return <p className="text-xs text-muted-foreground">รับเข้าบัญชี SHOP · {method === 'CASH'
    ? `เงินสด ${branch.name} (${branch.shopCashAccountCode || 'ยังไม่ได้ตั้งบัญชีเงินสดสาขา'})`
    : 'ธนาคารรับเงิน (S11-1201)'}</p>;
}

// ──────────────────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────────────────

export default function BookingsPage() {
  useDocumentTitle('การจอง / มัดจำ');
  const { user } = useAuth();
  const qc = useQueryClient();

  const canCreate = ['OWNER', 'BRANCH_MANAGER', 'SALES'].includes(user?.role ?? '');
  const canMutate = ['OWNER', 'BRANCH_MANAGER', 'SALES'].includes(user?.role ?? '');
  const canDelete = ['OWNER', 'BRANCH_MANAGER'].includes(user?.role ?? '');

  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search);
  const { page, size, setPage, setSize } = usePaginationParams();
  const previousFilters = useRef([statusFilter, debouncedSearch].join('|'));
  useEffect(() => {
    const next = [statusFilter, debouncedSearch].join('|');
    if (previousFilters.current !== next) { previousFilters.current = next; setPage(1); }
  }, [statusFilter, debouncedSearch, setPage]);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailBookingId, setDetailBookingId] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery<BookingListResponse>({
    queryKey: ['bookings', statusFilter, debouncedSearch, page, size],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(size) });
      if (statusFilter && statusFilter !== 'ALL') params.set('status', statusFilter);
      if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());
      const { data } = await api.get(`/bookings?${params}`);
      return data;
    },
  });

  useEffect(() => {
    if (data && page > Math.max(1, Math.ceil(data.total / size))) setPage(Math.max(1, Math.ceil(data.total / size)));
  }, [data, page, size, setPage]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader
        title="การจอง / มัดจำ"
        subtitle="สร้างใบจอง รับมัดจำ และรับส่วนต่างเพื่อขายเงินสด"
        action={
          canCreate ? (
            <Button onClick={() => setCreateOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              สร้างใบจอง
            </Button>
          ) : null
        }
      />

      <Card>
        <CardContent className="space-y-4 pt-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="ค้นหาเลขที่ / ชื่อลูกค้า"
                className="pl-9"
                aria-label="ค้นหาใบจอง" value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="w-full md:w-56">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="สถานะ" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">ทั้งหมด</SelectItem>
                  {(Object.keys(STATUS_LABEL) as BookingStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <QueryBoundary
            isLoading={isLoading}
            isError={isError}
            error={error}
            errorTitle="โหลดรายการใบจองไม่สำเร็จ"
            onRetry={refetch}
          >
            <BookingTable
              bookings={data?.data ?? []}
              onOpenDetail={(id) => setDetailBookingId(id)}
            />
            {data && <PaginationBar total={data.total} page={page} size={size} sizeOptions={[20, 50, 100, 200]} onPageChange={setPage} onSizeChange={setSize} />}
          </QueryBoundary>
        </CardContent>
      </Card>

      {createOpen && (
        <CreateBookingDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            invalidateSalesQueries(qc, 'booking-updated');
            setCreateOpen(false);
          }}
        />
      )}

      {detailBookingId && (
        <BookingDetailDialog
          bookingId={detailBookingId}
          canDelete={canDelete}
          canMutate={canMutate}
          onClose={() => setDetailBookingId(null)}
          onChanged={() => invalidateSalesQueries(qc, 'booking-updated')}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// BookingTable
// ──────────────────────────────────────────────────────────────────────────

function BookingTable({
  bookings,
  onOpenDetail,
}: {
  bookings: Booking[];
  onOpenDetail: (id: string) => void;
}) {
  const now = useBookingClock();
  if (bookings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
        <CalendarDays className="h-10 w-10 opacity-30" />
        <p>ยังไม่มีใบจอง</p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2">เลขที่</th>
            <th className="px-3 py-2">ลูกค้า</th>
            <th className="px-3 py-2">สาขา</th>
            <th className="px-3 py-2 text-right">มัดจำ</th>
            <th className="px-3 py-2 text-right">ยอดรวม</th>
            <th className="px-3 py-2">สถานะ</th>
            <th className="px-3 py-2">หมดอายุ (เวลาไทย)</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {bookings.map((b) => (
            <tr key={b.id} className="border-b border-border/60 hover:bg-accent/40">
              <td className="px-3 py-2 font-mono text-xs">{b.bookingNumber}</td>
              <td className="px-3 py-2">{b.customer.name}</td>
              <td className="px-3 py-2">{b.branch.name}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(b.depositAmount)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(b.totalAmount)}</td>
              <td className="px-3 py-2">
                <Badge variant={awaitingExpiry(b, now) ? 'outline' : STATUS_VARIANT[b.status]}>{awaitingExpiry(b, now) ? 'รอประมวลผลหมดอายุ' : STATUS_LABEL[b.status]}</Badge>
              </td>
              <td className="px-3 py-2 text-muted-foreground">{fmtDate(b.expireDate)}</td>
              <td className="px-3 py-2 text-right">
                <Button size="sm" variant="ghost" onClick={() => onOpenDetail(b.id)}>
                  เปิด
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// CreateBookingDialog
// ──────────────────────────────────────────────────────────────────────────

interface DraftItem {
  description: string;
  quantity: number;
  unitPrice: number;
  productId?: string;
}

function CreateBookingDialog({
  open,
  onClose,
  onCreated,
  initialBooking,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  initialBooking?: Booking;
}) {
  const { user } = useAuth();
  const paidEdit = initialBooking?.status === 'PAID';

  const [customerId, setCustomerId] = useState(initialBooking?.customer.id ?? '');
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerOption | null>(initialBooking?.customer ?? null);
  const [branchId, setBranchId] = useState(initialBooking?.branch.id ?? user?.branchId ?? '');
  const [expireDate, setExpireDate] = useState(() => {
    if (initialBooking) return toBangkokDateString(new Date(new Date(initialBooking.expireDate).getTime() - 1));
    return toBangkokDateString(new Date(Date.now() + 7 * 86_400_000));
  });
  const [depositAmount, setDepositAmount] = useState(Number(initialBooking?.depositAmount ?? 0));
  const [notes, setNotes] = useState(initialBooking?.notes ?? '');
  const [items, setItems] = useState<DraftItem[]>(initialBooking?.items.map(item => ({
    productId: item.productId ?? undefined, description: item.description,
    quantity: item.quantity, unitPrice: Number(item.unitPrice),
  })) ?? [{ description: '', quantity: 1, unitPrice: 0 }]);

  const [customerSearch, setCustomerSearch] = useState('');
  const debouncedCustomerSearch = useDebounce(customerSearch);
  const { data: customers, isFetching: customerFetching, isError: customerError, refetch: retryCustomers } = useQuery<CustomerOption[]>({
    queryKey: ['booking-customer-search', debouncedCustomerSearch],
    queryFn: async () => {
      const { data } = await api.get(`/customers?${new URLSearchParams({ limit: '50', search: debouncedCustomerSearch })}`);
      return (data.data ?? data ?? []) as CustomerOption[];
    },
    enabled: open,
  });

  const { data: branches } = useQuery<BranchOption[]>({
    queryKey: ['booking-branches'],
    queryFn: async () => {
      const { data } = await api.get('/branches');
      return (data.data ?? data ?? []) as BranchOption[];
    },
    enabled: open,
  });

  const totalAmount = useMemo(() => computeBookingTotal(items), [items]);
  const depositValid = isDepositInRange(depositAmount, totalAmount);

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        customerId,
        branchId,
        expireDate: initialBooking && expireDate === toBangkokDateString(new Date(new Date(initialBooking.expireDate).getTime() - 1))
          ? initialBooking.expireDate : toBangkokExpiryInstant(expireDate),
        depositAmount,
        notes: initialBooking ? notes : notes || undefined,
        items: items
          .filter((i) => i.description.trim() && i.quantity > 0 && i.unitPrice >= 0)
          .map((i) => ({
            description: i.description.trim(),
            quantity: Number(i.quantity),
            unitPrice: Number(i.unitPrice),
            productId: i.productId || undefined,
          })),
      };
      return initialBooking ? api.patch(`/bookings/${initialBooking.id}`, paidEdit ? { notes, expireDate: payload.expireDate } : payload) : api.post('/bookings', payload);
    },
    onSuccess: () => {
      toast.success(initialBooking ? 'แก้ไขใบจองแล้ว' : 'สร้างใบจองแล้ว');
      onCreated();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const isValid = paidEdit ? !!expireDate :
    customerId &&
    branchId &&
    expireDate &&
    depositValid &&
    items.length > 0 && items.every((i) => i.description.trim() && Number.isInteger(i.quantity) && i.quantity > 0 && Number.isFinite(i.unitPrice) && i.unitPrice >= 0);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initialBooking ? 'แก้ไขใบจอง' : 'สร้างใบจอง'}</DialogTitle>
          <DialogDescription>
            {paidEdit ? 'แก้ได้เฉพาะหมายเหตุและวันหมดอายุ สถานะรับมัดจำและยอดเงินคงเดิม'
              : 'ระบุลูกค้า เครื่อง มัดจำ และวันหมดอายุ — ยังไม่บันทึกการรับเงิน'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="booking-customer">ลูกค้า</Label>
            {!paidEdit && <Input aria-label="ค้นหาลูกค้าสำหรับใบจอง" placeholder="ค้นหาชื่อหรือเบอร์โทรลูกค้า" value={customerSearch} onChange={e => setCustomerSearch(e.target.value)} />}
            {customerError && <button type="button" className="text-sm text-destructive underline" onClick={() => retryCustomers()}>โหลดลูกค้าไม่สำเร็จ ลองอีกครั้ง</button>}
            {customerFetching && <p className="text-xs text-muted-foreground">กำลังค้นหาลูกค้า...</p>}
            <Select value={customerId} onValueChange={id => { setCustomerId(id); setSelectedCustomer(customers?.find(customer => customer.id === id) ?? null); }} disabled={paidEdit || customerFetching || customerError}>
              <SelectTrigger id="booking-customer">
                <SelectValue placeholder="เลือกลูกค้า" />
              </SelectTrigger>
              <SelectContent>
                {selectedCustomer && !customers?.some(c => c.id === selectedCustomer.id) && <SelectItem value={selectedCustomer.id}>{selectedCustomer.name}</SelectItem>}
                {(customers ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.phone ? ` — ${c.phone}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="booking-branch">สาขา</Label>
            <Select value={branchId} onValueChange={value => {
              setBranchId(value);
              setItems([{ description: '', quantity: 1, unitPrice: 0 }]);
            }} disabled={paidEdit || user?.role !== 'OWNER'}>
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
          </div>
          <div className="space-y-2">
            <Label htmlFor="booking-expiry">ใช้ได้ถึงสิ้นวันที่ (เวลาไทย)</Label>
            <Input id="booking-expiry"
              type="date"
              value={expireDate}
              onChange={(e) => setExpireDate(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>รายการ</Label>
            <Button
              size="sm"
              variant="outline"
              disabled={paidEdit}
              onClick={() =>
                setItems([...items, { description: '', quantity: 1, unitPrice: 0 }])
              }
            >
              + เพิ่มรายการ
            </Button>
          </div>
          <div className="space-y-2">
            {items.map((it, idx) => (
              <div key={idx} className="space-y-2 rounded-md border border-border p-3">
                {!paidEdit && <BookingProductPicker key={`${idx}-${branchId}`} branchId={branchId} selectedId={it.productId}
                  onSelect={selection => setItems(items.map((item, index) => index === idx ? selection : item))}
                  onClear={() => setItems(items.map((item, index) => index === idx ? { description: '', quantity: 1, unitPrice: 0 } : item))} />}
                <div className="grid grid-cols-12 gap-2">
                <Input
                  className="col-span-12 sm:col-span-6"
                  aria-label={`รายละเอียดรายการที่ ${idx + 1}`}
                  readOnly={paidEdit || !!it.productId}
                  placeholder="รายละเอียดสินค้า/บริการ"
                  value={it.description}
                  onChange={(e) => {
                    const copy = [...items];
                    copy[idx] = { ...copy[idx], description: e.target.value };
                    setItems(copy);
                  }}
                />
                <Input
                  className="col-span-3 sm:col-span-2"
                  aria-label={`จำนวนรายการที่ ${idx + 1}`}
                  readOnly={paidEdit || !!it.productId}
                  type="number"
                  min={1}
                  placeholder="จำนวน"
                  value={it.quantity}
                  onChange={(e) => {
                    const copy = [...items];
                    copy[idx] = { ...copy[idx], quantity: Number(e.target.value) || 1 };
                    setItems(copy);
                  }}
                />
                <Input
                  className="col-span-7 sm:col-span-3"
                  aria-label={`ราคาต่อหน่วยรายการที่ ${idx + 1}`}
                  readOnly={paidEdit}
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="ราคา/หน่วย"
                  value={it.unitPrice}
                  onChange={(e) => {
                    const copy = [...items];
                    copy[idx] = { ...copy[idx], unitPrice: Number(e.target.value) || 0 };
                    setItems(copy);
                  }}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="col-span-2 sm:col-span-1"
                  onClick={() => setItems(items.filter((_, i) => i !== idx))}
                  disabled={paidEdit || items.length === 1}
                  aria-label="ลบรายการ"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs text-muted-foreground">ใบจองยังไม่ล็อกสต็อก ระบบตรวจเครื่องอีกครั้งตอนขาย · แปลงขายเงินสดได้เมื่อมีเครื่องที่ผูกสต็อก 1 รายการ จำนวน 1 ชิ้น</p>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="booking-deposit">{paidEdit ? 'มัดจำที่รับแล้ว (บาท)' : 'มัดจำที่ต้องรับ (บาท)'}</Label>
            <Input id="booking-deposit" readOnly={paidEdit}
              type="number"
              min={0}
              step="0.01"
              value={depositAmount}
              onChange={(e) => setDepositAmount(Number(e.target.value) || 0)}
              aria-invalid={!depositValid}
            />
            {!depositValid && (
              <p className="text-xs text-destructive">
                มัดจำต้องไม่ติดลบและไม่เกินยอดรวม ({fmtMoney(totalAmount)})
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label>ยอดรวมทั้งสิ้น</Label>
            <Input value={fmtMoney(totalAmount)} readOnly className="font-mono tabular-nums" />
          </div>
          <div className="space-y-2">
            <Label>ส่วนต่างต้องเก็บอีก</Label>
            <Input
              value={fmtMoney(Math.max(0, totalAmount - depositAmount))}
              readOnly
              className="font-mono tabular-nums text-muted-foreground"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="booking-notes">หมายเหตุ</Label>
          <Input id="booking-notes"
            placeholder="ระบุหมายเหตุ (ไม่บังคับ)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!isValid || createMutation.isPending}
          >
            {createMutation.isPending ? 'กำลังบันทึก...' : initialBooking ? 'บันทึกการแก้ไข' : 'บันทึกใบจอง'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// BookingDetailDialog
// ──────────────────────────────────────────────────────────────────────────

function BookingDetailDialog({
  bookingId,
  canDelete,
  canMutate,
  onClose,
  onChanged,
}: {
  bookingId: string;
  canDelete: boolean;
  canMutate: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const { data: booking, isLoading, isError, error, refetch } = useQuery<Booking>({
    queryKey: ['booking', bookingId],
    queryFn: async () => {
      const { data } = await api.get(`/bookings/${bookingId}`);
      return data;
    },
  });

  const [depositMethod, setDepositMethod] = useState('CASH');
  const { user } = useAuth();
  const now = useBookingClock();
  const [editOpen, setEditOpen] = useState(false);
  const [balanceMethod, setBalanceMethod] = useState('');
  const [damageAcknowledged, setDamageAcknowledged] = useState(false);
  const expired = !!booking && awaitingExpiry(booking, now);
  const conversionBlocked = !!booking && (booking.items.length !== 1 || !booking.items[0]?.productId || booking.items[0]?.quantity !== 1);
  const canAcknowledgeDamage = ['OWNER', 'FINANCE_MANAGER'].includes(user?.role ?? '');
  const [cancelReason, setCancelReason] = useState('');
  // C2 — convert UX: cashier must affirm balance collection when partial-paid
  const [collectBalance, setCollectBalance] = useState(false);

  // Derived: is this a partial-deposit booking? (deposit < total)
  const isPartialDeposit =
    !!booking && Number(booking.depositAmount) < Number(booking.totalAmount);
  const outstandingBalance = booking
    ? Number(booking.totalAmount) - Number(booking.depositAmount)
    : 0;

  const payMut = useMutation({
    mutationFn: () =>
      api.post(`/bookings/${bookingId}/pay-deposit`, {
        depositMethod,
      }),
    onSuccess: () => {
      toast.success('บันทึกการรับมัดจำแล้ว');
      void invalidateSalesQueries(qc, 'booking-updated');
      onChanged();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const cancelMut = useMutation({
    mutationFn: () =>
      api.post(`/bookings/${bookingId}/cancel`, { cancelReason: cancelReason || undefined }),
    onSuccess: () => {
      toast.success('ยกเลิกใบจองแล้ว (คืนมัดจำ 100% ก่อนหมดอายุ)');
      void invalidateSalesQueries(qc, 'booking-updated');
      onChanged();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const convertMut = useMutation({
    mutationFn: () =>
      api.post(`/bookings/${bookingId}/convert`, {
        saleType: 'CASH',
        // Only relevant on partial-deposit bookings; backend ignores otherwise.
        collectBalance: isPartialDeposit ? collectBalance : undefined,
        paymentMethod: isPartialDeposit ? balanceMethod : undefined,
        previouslyDamagedAcknowledged: damageAcknowledged || undefined,
      }),
    onSuccess: () => {
      toast.success('บันทึกขายเงินสดแล้ว นำมัดจำมาหักยอดเรียบร้อย');
      void invalidateSalesQueries(qc, 'booking-converted');
      onChanged();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const deleteMut = useMutation({
    mutationFn: () => api.delete(`/bookings/${bookingId}`),
    onSuccess: () => {
      toast.success('ลบใบจองแล้ว');
      onClose();
      onChanged();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const mutationPending = payMut.isPending || cancelMut.isPending || convertMut.isPending || deleteMut.isPending;

  if (editOpen && booking) return <CreateBookingDialog open initialBooking={booking}
    onClose={() => setEditOpen(false)} onCreated={() => { setEditOpen(false); refetch(); onChanged(); }} />;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{booking ? booking.bookingNumber : 'กำลังโหลด...'}</DialogTitle>
          {booking && (
            <DialogDescription>
              <Badge variant={expired ? 'outline' : STATUS_VARIANT[booking.status]}>
                {expired ? 'รอประมวลผลหมดอายุ' : STATUS_LABEL[booking.status]}
              </Badge>
              <span className="ml-2 text-muted-foreground">
                หมดอายุ {fmtDate(booking.expireDate)} น. (เวลาไทย)
              </span>
            </DialogDescription>
          )}
        </DialogHeader>

        {isError ? <div role="alert" className="space-y-3 py-4">
          <p>โหลดใบจองไม่สำเร็จ: {getErrorMessage(error)}</p>
          <Button variant="outline" onClick={() => refetch()}>ลองใหม่</Button>
        </div> : isLoading || !booking ? (
          <div className="py-8 text-center text-muted-foreground">กำลังโหลด...</div>
        ) : (
          <fieldset disabled={mutationPending} className="min-w-0 space-y-3 text-sm">
            {expired && <div role="status" className="space-y-2 rounded-md border border-border bg-muted p-3">
              <p>ถึงกำหนดหมดอายุแล้ว กำลังรอประมวลผลสถานะ จึงรับเงิน แก้ไข หรือแปลงขายต่อไม่ได้</p>
              <Button size="sm" variant="outline" onClick={() => refetch()}>โหลดสถานะล่าสุด</Button>
            </div>}
            {booking.status === 'PAID' && <p className="text-xs text-muted-foreground">รับมัดจำแล้ว จึงแก้ลูกค้า สาขา สินค้า และยอดเงินไม่ได้ หากต้องเปลี่ยนรายการให้ยกเลิกและคืนเงินก่อนหมดอายุ</p>}
            {booking.status === 'PAID' && conversionBlocked && <p role="alert" className="rounded-md border border-warning/40 bg-warning/10 p-3">ใบจองนี้ยังแปลงขายไม่ได้ ต้องมีเครื่องที่ผูกสต็อก 1 รายการ จำนวน 1 ชิ้น กรุณายกเลิกและคืนเงินก่อนออกใบจองใหม่</p>}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-muted-foreground">ลูกค้า</div>
                <div>{booking.customer.name}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">สาขา</div>
                <div>{booking.branch.name}</div>
              </div>
            </div>

            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">รายการ</th>
                    <th className="px-3 py-2 text-right">จำนวน</th>
                    <th className="px-3 py-2 text-right">ราคา/หน่วย</th>
                    <th className="px-3 py-2 text-right">รวม</th>
                  </tr>
                </thead>
                <tbody>
                  {booking.items.map((it) => (
                    <tr key={it.id} className="border-b border-border/60">
                      <td className="px-3 py-2">{it.description}</td>
                      <td className="px-3 py-2 text-right">{it.quantity}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {fmtMoney(it.unitPrice)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(it.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end">
              <div className="w-64 space-y-1">
                <div className="flex justify-between">
                  <span>ยอดรวม</span>
                  <span className="tabular-nums">{fmtMoney(booking.totalAmount)}</span>
                </div>
                <div className="flex justify-between">
                  <span>{booking.depositPaidAt ? 'มัดจำที่รับแล้ว' : 'มัดจำที่ต้องรับ'}</span>
                  <span className="tabular-nums">{fmtMoney(booking.depositAmount)}</span>
                </div>
                <div className="flex justify-between border-t border-border pt-1 font-semibold">
                  <span>{booking.status === 'PENDING_DEPOSIT' ? 'ยอดที่ยังไม่ได้รับ' : booking.status === 'PAID' ? 'ส่วนต่างก่อนขาย' : 'ยอดคงเหลือ'}</span>
                  <span className="tabular-nums">
                    {fmtMoney(booking.status === 'PENDING_DEPOSIT' ? Number(booking.totalAmount) : booking.status === 'PAID' ? outstandingBalance : 0)}
                  </span>
                </div>
              </div>
            </div>

            {booking.notes && (
              <div className="rounded-md border border-border bg-muted/30 p-3 text-muted-foreground">
                {booking.notes}
              </div>
            )}

            {booking.cancelReason && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm">
                <div className="font-semibold">เหตุผลการยกเลิก</div>
                <div className="text-muted-foreground">{booking.cancelReason}</div>
              </div>
            )}

            {booking.convertedToSale && (
              <div className="rounded-md border border-border bg-accent/40 p-3 text-sm">
                แปลงเป็นการขาย:{' '}
                <span className="font-mono">{booking.convertedToSale.saleNumber}</span>
              </div>
            )}

            {canMutate && booking.status === 'PENDING_DEPOSIT' && !expired && (
              <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
                <ReceiptMethodSelect label="วิธีรับมัดจำ" value={depositMethod} onChange={setDepositMethod} />
                <ReceiptAccount branch={booking.branch} method={depositMethod} />
              </div>
            )}

            {canMutate &&
              booking.status === 'PAID' && !expired && !conversionBlocked &&
              !booking.convertedToSale &&
              isPartialDeposit && (
                <div className="space-y-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm">
                  <div className="font-medium">ก่อนแปลงเป็นการขาย</div>
                  <div className="text-muted-foreground">
                    ใบจองนี้รับมัดจำเพียง{' '}
                    <span className="tabular-nums">{fmtMoney(booking.depositAmount)}</span>{' '}
                    บาท คงเหลือ{' '}
                    <span className="font-semibold tabular-nums">
                      {fmtMoney(outstandingBalance)}
                    </span>{' '}
                    บาท
                  </div>
                  <ReceiptMethodSelect label="วิธีรับส่วนต่าง" value={balanceMethod} onChange={setBalanceMethod} />
                  {balanceMethod && <ReceiptAccount branch={booking.branch} method={balanceMethod} />}
                  <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border bg-background p-2">
                    <Checkbox
                      checked={collectBalance}
                      onCheckedChange={(v) => setCollectBalance(v === true)}
                      className="mt-0.5"
                    />
                    <span className="leading-snug">
                      ยืนยันว่าได้รับยอดส่วนต่างครบแล้ว
                    </span>
                  </label>
                </div>
              )}

            {canMutate && canAcknowledgeDamage && booking.status === 'PAID' && !expired && !conversionBlocked && (
              <label className="flex items-start gap-2 rounded-md border border-border p-3">
                <Checkbox checked={damageAcknowledged} onCheckedChange={value => setDamageAcknowledged(value === true)} />
                <span>หากเครื่องมีประวัติเสียหาย ยืนยันว่าได้แจ้งลูกค้าและอนุมัติให้ขายแล้ว</span>
              </label>
            )}

            {canMutate &&
              (booking.status === 'PENDING_DEPOSIT' || booking.status === 'PAID') && !expired && (
                <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
                  <Label>เหตุผลการยกเลิก (ถ้ายกเลิก)</Label>
                  <Input
                    placeholder="เช่น ลูกค้าเปลี่ยนใจ / ไม่ผ่านเครดิต"
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                  />
                </div>
              )}
          </fieldset>
        )}

        <DialogFooter className="flex-wrap gap-2">
          {canMutate && booking && ['PENDING_DEPOSIT', 'PAID'].includes(booking.status) && !expired && !isError && (
            <Button variant="outline" disabled={mutationPending} onClick={() => setEditOpen(true)}>{booking.status === 'PAID' ? 'แก้หมายเหตุ / วันหมดอายุ' : 'แก้ไขใบจอง'}</Button>
          )}
          {canMutate && booking?.status === 'PENDING_DEPOSIT' && !expired && !isError && (
            <Button
              onClick={() => payMut.mutate()}
              disabled={mutationPending || (depositMethod === 'CASH' && !booking.branch.shopCashAccountCode)}
              className="gap-2"
            >
              <HandCoins className="h-4 w-4" /> บันทึกรับมัดจำ
            </Button>
          )}
          {canMutate &&
            (booking?.status === 'PENDING_DEPOSIT' || booking?.status === 'PAID') && !expired && !isError && (
              <Button
                variant="outline"
                onClick={() => cancelMut.mutate()}
                disabled={mutationPending}
                className="gap-2"
              >
                <Ban className="h-4 w-4" /> ยกเลิก
              </Button>
            )}
          {canMutate && booking?.status === 'PAID' && !booking.convertedToSale && !expired && !isError && (
            <Button
              onClick={() => convertMut.mutate()}
              disabled={
                mutationPending || conversionBlocked || (isPartialDeposit && (!collectBalance || !balanceMethod || (balanceMethod === 'CASH' && !booking.branch.shopCashAccountCode)))
              }
              className="gap-2"
              title={
                isPartialDeposit && !collectBalance
                  ? 'ติ๊ก "เรียกเก็บยอดส่วนต่างแล้ว" ก่อนแปลง'
                  : undefined
              }
            >
              <ShoppingCart className="h-4 w-4" /> {isPartialDeposit ? 'รับส่วนต่างและขาย' : 'ขายโดยใช้มัดจำที่รับแล้ว'}
            </Button>
          )}
          {canDelete && booking?.status === 'PENDING_DEPOSIT' && !expired && !isError && (
            <Button
              variant="destructive"
              onClick={() => deleteMut.mutate()}
              disabled={mutationPending}
              className="gap-2"
            >
              <Trash2 className="h-4 w-4" /> ลบใบจอง
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            ปิด
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
