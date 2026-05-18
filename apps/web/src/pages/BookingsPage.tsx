import { useMemo, useState } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { formatThaiDate } from '@/lib/date';
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
  branch: { id: string; name: string };
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
  phone: string;
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
  return formatThaiDate(s);
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
  const [createOpen, setCreateOpen] = useState(false);
  const [detailBookingId, setDetailBookingId] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery<BookingListResponse>({
    queryKey: ['bookings', statusFilter, search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter && statusFilter !== 'ALL') params.set('status', statusFilter);
      if (search.trim()) params.set('search', search.trim());
      const { data } = await api.get(`/bookings?${params}`);
      return data;
    },
  });

  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader
        title="การจอง / มัดจำ"
        subtitle="สร้างใบจอง รับมัดจำ และแปลงเป็นการขาย — มัดจำเข้าเป็น downPayment อัตโนมัติ"
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
                value={search}
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
          </QueryBoundary>
        </CardContent>
      </Card>

      {createOpen && (
        <CreateBookingDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            qc.invalidateQueries({ queryKey: ['bookings'] });
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
          onChanged={() => qc.invalidateQueries({ queryKey: ['bookings'] })}
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
            <th className="px-3 py-2">หมดอายุ</th>
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
                <Badge variant={STATUS_VARIANT[b.status]}>{STATUS_LABEL[b.status]}</Badge>
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
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { user } = useAuth();

  const [customerId, setCustomerId] = useState('');
  const [branchId, setBranchId] = useState(user?.branchId ?? '');
  const [expireDate, setExpireDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });
  const [depositAmount, setDepositAmount] = useState(0);
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<DraftItem[]>([
    { description: '', quantity: 1, unitPrice: 0 },
  ]);

  const { data: customers } = useQuery<CustomerOption[]>({
    queryKey: ['booking-customer-search'],
    queryFn: async () => {
      const { data } = await api.get('/customers?limit=200');
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
      return api.post('/bookings', {
        customerId,
        branchId,
        expireDate: new Date(expireDate).toISOString(),
        depositAmount,
        notes: notes || undefined,
        items: items
          .filter((i) => i.description.trim() && i.quantity > 0 && i.unitPrice >= 0)
          .map((i) => ({
            description: i.description.trim(),
            quantity: Number(i.quantity),
            unitPrice: Number(i.unitPrice),
            productId: i.productId || undefined,
          })),
      });
    },
    onSuccess: () => {
      toast.success('สร้างใบจองแล้ว');
      onCreated();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const isValid =
    customerId &&
    branchId &&
    expireDate &&
    depositValid &&
    items.some((i) => i.description.trim() && i.quantity > 0);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>สร้างใบจอง</DialogTitle>
          <DialogDescription>
            ระบุลูกค้า รายการสินค้า มัดจำ และวันหมดอายุ — บันทึกเป็น "รอชำระมัดจำ"
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>ลูกค้า</Label>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger>
                <SelectValue placeholder="เลือกลูกค้า" />
              </SelectTrigger>
              <SelectContent>
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
            <Label>สาขา</Label>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger>
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
            <Label>หมดอายุภายใน</Label>
            <Input
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
              onClick={() =>
                setItems([...items, { description: '', quantity: 1, unitPrice: 0 }])
              }
            >
              + เพิ่มรายการ
            </Button>
          </div>
          <div className="space-y-2">
            {items.map((it, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2">
                <Input
                  className="col-span-6"
                  placeholder="รายละเอียดสินค้า/บริการ"
                  value={it.description}
                  onChange={(e) => {
                    const copy = [...items];
                    copy[idx] = { ...copy[idx], description: e.target.value };
                    setItems(copy);
                  }}
                />
                <Input
                  className="col-span-2"
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
                  className="col-span-3"
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
                  className="col-span-1"
                  onClick={() => setItems(items.filter((_, i) => i !== idx))}
                  disabled={items.length === 1}
                  aria-label="ลบรายการ"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>มัดจำ (บาท)</Label>
            <Input
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
          <Label>หมายเหตุ</Label>
          <Input
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
            {createMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกใบจอง'}
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
  const { data: booking, isLoading } = useQuery<Booking>({
    queryKey: ['booking', bookingId],
    queryFn: async () => {
      const { data } = await api.get(`/bookings/${bookingId}`);
      return data;
    },
  });

  const [depositMethod, setDepositMethod] = useState('CASH');
  const [cancelReason, setCancelReason] = useState('');

  const payMut = useMutation({
    mutationFn: () => api.post(`/bookings/${bookingId}/pay-deposit`, { depositMethod }),
    onSuccess: () => {
      toast.success('บันทึกการรับมัดจำแล้ว');
      qc.invalidateQueries({ queryKey: ['booking', bookingId] });
      onChanged();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const cancelMut = useMutation({
    mutationFn: () =>
      api.post(`/bookings/${bookingId}/cancel`, { cancelReason: cancelReason || undefined }),
    onSuccess: () => {
      toast.success('ยกเลิกใบจองแล้ว (คืนมัดจำ 100% ก่อนหมดอายุ)');
      qc.invalidateQueries({ queryKey: ['booking', bookingId] });
      onChanged();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const convertMut = useMutation({
    mutationFn: () => api.post(`/bookings/${bookingId}/convert`, { saleType: 'CASH' }),
    onSuccess: () => {
      toast.success('แปลงเป็นการขายแล้ว — มัดจำเข้า downPayment อัตโนมัติ');
      qc.invalidateQueries({ queryKey: ['booking', bookingId] });
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

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{booking ? booking.bookingNumber : 'กำลังโหลด...'}</DialogTitle>
          {booking && (
            <DialogDescription>
              <Badge variant={STATUS_VARIANT[booking.status]}>
                {STATUS_LABEL[booking.status]}
              </Badge>
              <span className="ml-2 text-muted-foreground">
                หมดอายุ {fmtDate(booking.expireDate)}
              </span>
            </DialogDescription>
          )}
        </DialogHeader>

        {isLoading || !booking ? (
          <div className="py-8 text-center text-muted-foreground">กำลังโหลด...</div>
        ) : (
          <div className="space-y-3 text-sm">
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

            <div className="rounded-md border border-border">
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
                  <span>มัดจำ</span>
                  <span className="tabular-nums">{fmtMoney(booking.depositAmount)}</span>
                </div>
                <div className="flex justify-between border-t border-border pt-1 font-semibold">
                  <span>คงค้าง</span>
                  <span className="tabular-nums">
                    {fmtMoney(Number(booking.totalAmount) - Number(booking.depositAmount))}
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

            {canMutate && booking.status === 'PENDING_DEPOSIT' && (
              <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
                <Label>วิธีรับมัดจำ</Label>
                <Select value={depositMethod} onValueChange={setDepositMethod}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CASH">เงินสด</SelectItem>
                    <SelectItem value="BANK_TRANSFER">โอนธนาคาร</SelectItem>
                    <SelectItem value="QR_EWALLET">QR / e-Wallet</SelectItem>
                    <SelectItem value="CREDIT_BALANCE">หักจากเครดิตคงเหลือ</SelectItem>
                    <SelectItem value="ONLINE_GATEWAY">ผ่าน Gateway</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {canMutate &&
              (booking.status === 'PENDING_DEPOSIT' || booking.status === 'PAID') && (
                <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
                  <Label>เหตุผลการยกเลิก (ถ้ายกเลิก)</Label>
                  <Input
                    placeholder="เช่น ลูกค้าเปลี่ยนใจ / ไม่ผ่านเครดิต"
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                  />
                </div>
              )}
          </div>
        )}

        <DialogFooter className="flex-wrap gap-2">
          {canMutate && booking?.status === 'PENDING_DEPOSIT' && (
            <Button
              onClick={() => payMut.mutate()}
              disabled={payMut.isPending}
              className="gap-2"
            >
              <HandCoins className="h-4 w-4" /> ชำระมัดจำ
            </Button>
          )}
          {canMutate &&
            (booking?.status === 'PENDING_DEPOSIT' || booking?.status === 'PAID') && (
              <Button
                variant="outline"
                onClick={() => cancelMut.mutate()}
                disabled={cancelMut.isPending}
                className="gap-2"
              >
                <Ban className="h-4 w-4" /> ยกเลิก
              </Button>
            )}
          {canMutate && booking?.status === 'PAID' && !booking.convertedToSale && (
            <Button
              onClick={() => convertMut.mutate()}
              disabled={convertMut.isPending}
              className="gap-2"
            >
              <ShoppingCart className="h-4 w-4" /> แปลงเป็นการขาย
            </Button>
          )}
          {canDelete && booking?.status === 'PENDING_DEPOSIT' && (
            <Button
              variant="destructive"
              onClick={() => deleteMut.mutate()}
              disabled={deleteMut.isPending}
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
