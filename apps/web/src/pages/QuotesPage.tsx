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
  FileText,
  Plus,
  Send,
  CheckCircle2,
  XCircle,
  ShoppingCart,
  Trash2,
  Printer,
  Search,
} from 'lucide-react';

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

type QuoteStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'CONVERTED';

interface QuoteItem {
  id: string;
  productId?: string | null;
  description: string;
  quantity: number;
  unitPrice: string | number;
  amount: string | number;
}

interface Quote {
  id: string;
  quoteNumber: string;
  status: QuoteStatus;
  validUntil: string;
  subtotal: string | number;
  discount: string | number;
  vatAmount: string | number;
  total: string | number;
  notes?: string | null;
  customer: { id: string; name: string; phone?: string | null };
  branch: { id: string; name: string };
  createdBy: { id: string; name: string };
  convertedToSale?: { id: string; saleNumber: string } | null;
  items: QuoteItem[];
  createdAt: string;
}

interface QuoteListResponse {
  data: Quote[];
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

const STATUS_LABEL: Record<QuoteStatus, string> = {
  DRAFT: 'ร่าง',
  SENT: 'ส่งแล้ว',
  ACCEPTED: 'ยอมรับ',
  REJECTED: 'ปฏิเสธ',
  EXPIRED: 'หมดอายุ',
  CONVERTED: 'แปลงเป็นการขายแล้ว',
};

const STATUS_VARIANT: Record<
  QuoteStatus,
  'primary' | 'secondary' | 'destructive' | 'outline' | 'success' | 'info'
> = {
  DRAFT: 'secondary',
  SENT: 'info',
  ACCEPTED: 'success',
  REJECTED: 'destructive',
  EXPIRED: 'outline',
  CONVERTED: 'primary',
};

function fmtMoney(v: string | number): string {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (!Number.isFinite(n)) return '0.00';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(s: string): string {
  // Thai พ.ศ. / Asia/Bangkok formatting — shared util normalizes across pages.
  return formatThaiDate(s);
}

// ──────────────────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────────────────

export default function QuotesPage() {
  useDocumentTitle('ใบเสนอราคา');
  const { user } = useAuth();
  const qc = useQueryClient();

  // FINANCE_MANAGER is read-only per spec — they can view + print PDF but not
  // send/accept/reject/convert or create. SALES/BM/OWNER can mutate.
  const canCreate = ['OWNER', 'BRANCH_MANAGER', 'SALES'].includes(user?.role ?? '');
  const canMutate = ['OWNER', 'BRANCH_MANAGER', 'SALES'].includes(user?.role ?? '');
  const canDelete = ['OWNER', 'BRANCH_MANAGER'].includes(user?.role ?? '');

  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [detailQuoteId, setDetailQuoteId] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery<QuoteListResponse>({
    queryKey: ['quotes', statusFilter, search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter && statusFilter !== 'ALL') params.set('status', statusFilter);
      if (search.trim()) params.set('search', search.trim());
      const { data } = await api.get(`/quotes?${params}`);
      return data;
    },
  });

  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader
        title="ใบเสนอราคา"
        subtitle="สร้าง ส่ง และแปลงใบเสนอราคาเป็นการขาย"
        action={
          canCreate ? (
            <Button onClick={() => setCreateOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              สร้างใบเสนอราคา
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
                  {(Object.keys(STATUS_LABEL) as QuoteStatus[]).map((s) => (
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
            errorTitle="โหลดรายการใบเสนอราคาไม่สำเร็จ"
            onRetry={refetch}
          >
            <QuoteTable
              quotes={data?.data ?? []}
              onOpenDetail={(id) => setDetailQuoteId(id)}
            />
          </QueryBoundary>
        </CardContent>
      </Card>

      {createOpen && (
        <CreateQuoteDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            qc.invalidateQueries({ queryKey: ['quotes'] });
            setCreateOpen(false);
          }}
        />
      )}

      {detailQuoteId && (
        <QuoteDetailDialog
          quoteId={detailQuoteId}
          canDelete={canDelete}
          canMutate={canMutate}
          onClose={() => setDetailQuoteId(null)}
          onChanged={() => qc.invalidateQueries({ queryKey: ['quotes'] })}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// QuoteTable
// ──────────────────────────────────────────────────────────────────────────

function QuoteTable({
  quotes,
  onOpenDetail,
}: {
  quotes: Quote[];
  onOpenDetail: (id: string) => void;
}) {
  if (quotes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
        <FileText className="h-10 w-10 opacity-30" />
        <p>ยังไม่มีใบเสนอราคา</p>
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
            <th className="px-3 py-2 text-right">ยอดรวม</th>
            <th className="px-3 py-2">สถานะ</th>
            <th className="px-3 py-2">ใช้ได้ถึง</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {quotes.map((q) => (
            <tr key={q.id} className="border-b border-border/60 hover:bg-accent/40">
              <td className="px-3 py-2 font-mono text-xs">{q.quoteNumber}</td>
              <td className="px-3 py-2">{q.customer.name}</td>
              <td className="px-3 py-2">{q.branch.name}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(q.total)}</td>
              <td className="px-3 py-2">
                <Badge variant={STATUS_VARIANT[q.status]}>{STATUS_LABEL[q.status]}</Badge>
              </td>
              <td className="px-3 py-2 text-muted-foreground">{fmtDate(q.validUntil)}</td>
              <td className="px-3 py-2 text-right">
                <Button size="sm" variant="ghost" onClick={() => onOpenDetail(q.id)}>
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
// CreateQuoteDialog
// ──────────────────────────────────────────────────────────────────────────

interface DraftItem {
  description: string;
  quantity: number;
  unitPrice: number;
  productId?: string;
}

export function computeQuoteTotals(
  items: { quantity: number; unitPrice: number }[],
  discount: number,
  vatAmount: number,
): { subtotal: number; total: number } {
  const subtotal = items.reduce(
    (sum, it) => sum + Math.round(it.quantity * it.unitPrice * 100) / 100,
    0,
  );
  return { subtotal, total: Math.max(0, subtotal - discount + vatAmount) };
}

function CreateQuoteDialog({
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
  const [validUntil, setValidUntil] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });
  const [discount, setDiscount] = useState(0);
  const [vatAmount, setVatAmount] = useState(0);
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<DraftItem[]>([
    { description: '', quantity: 1, unitPrice: 0 },
  ]);

  // Lookup data
  const { data: customers } = useQuery<CustomerOption[]>({
    queryKey: ['quote-customer-search'],
    queryFn: async () => {
      const { data } = await api.get('/customers?limit=200');
      return (data.data ?? data ?? []) as CustomerOption[];
    },
    enabled: open,
  });

  const { data: branches } = useQuery<BranchOption[]>({
    queryKey: ['quote-branches'],
    queryFn: async () => {
      const { data } = await api.get('/branches');
      return (data.data ?? data ?? []) as BranchOption[];
    },
    enabled: open,
  });

  const { subtotal, total } = useMemo(
    () => computeQuoteTotals(items, discount, vatAmount),
    [items, discount, vatAmount],
  );

  const createMutation = useMutation({
    mutationFn: async () => {
      return api.post('/quotes', {
        customerId,
        branchId,
        validUntil: new Date(validUntil).toISOString(),
        discount,
        vatAmount,
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
      toast.success('สร้างใบเสนอราคาแล้ว');
      onCreated();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const isValid =
    customerId &&
    branchId &&
    validUntil &&
    items.some((i) => i.description.trim() && i.quantity > 0);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>สร้างใบเสนอราคา</DialogTitle>
          <DialogDescription>
            ระบุลูกค้า สาขา รายการสินค้า แล้วบันทึกเป็น DRAFT
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
            <Label>ใช้ได้ถึง</Label>
            <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
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
            <Label>ส่วนลด</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={discount}
              onChange={(e) => setDiscount(Number(e.target.value) || 0)}
            />
          </div>
          <div className="space-y-2">
            <Label>ภาษี (VAT)</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={vatAmount}
              onChange={(e) => setVatAmount(Number(e.target.value) || 0)}
            />
          </div>
          <div className="space-y-2">
            <Label>รวมทั้งสิ้น</Label>
            <Input value={fmtMoney(total)} readOnly className="font-mono tabular-nums" />
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

        <div className="text-sm text-muted-foreground">
          ยอดรวม: <span className="font-mono">{fmtMoney(subtotal)}</span>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button onClick={() => createMutation.mutate()} disabled={!isValid || createMutation.isPending}>
            {createMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกใบเสนอราคา'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// QuoteDetailDialog
// ──────────────────────────────────────────────────────────────────────────

function QuoteDetailDialog({
  quoteId,
  canDelete,
  canMutate,
  onClose,
  onChanged,
}: {
  quoteId: string;
  canDelete: boolean;
  canMutate: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const { data: quote, isLoading } = useQuery<Quote>({
    queryKey: ['quote', quoteId],
    queryFn: async () => {
      const { data } = await api.get(`/quotes/${quoteId}`);
      return data;
    },
  });

  const sendMut = useMutation({
    mutationFn: () => api.post(`/quotes/${quoteId}/send`),
    onSuccess: () => {
      toast.success('ส่งใบเสนอราคาแล้ว');
      qc.invalidateQueries({ queryKey: ['quote', quoteId] });
      onChanged();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const acceptMut = useMutation({
    mutationFn: () => api.post(`/quotes/${quoteId}/accept`),
    onSuccess: () => {
      toast.success('บันทึกการยอมรับแล้ว');
      qc.invalidateQueries({ queryKey: ['quote', quoteId] });
      onChanged();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const rejectMut = useMutation({
    mutationFn: () => api.post(`/quotes/${quoteId}/reject`),
    onSuccess: () => {
      toast.success('บันทึกการปฏิเสธแล้ว');
      qc.invalidateQueries({ queryKey: ['quote', quoteId] });
      onChanged();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const convertMut = useMutation({
    mutationFn: () => api.post(`/quotes/${quoteId}/convert`, { saleType: 'CASH' }),
    onSuccess: () => {
      toast.success('แปลงเป็นการขายแล้ว');
      qc.invalidateQueries({ queryKey: ['quote', quoteId] });
      onChanged();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const deleteMut = useMutation({
    mutationFn: () => api.delete(`/quotes/${quoteId}`),
    onSuccess: () => {
      toast.success('ลบใบเสนอราคาแล้ว');
      onClose();
      onChanged();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const pdfMut = useMutation({
    mutationFn: async () => {
      // Use api.get so axios interceptors attach the in-memory JWT — the
      // /api/quotes/:id/pdf route is JWT-protected and window.open won't
      // include the bearer token.
      const res = await api.get(`/quotes/${quoteId}/pdf`, { responseType: 'blob' });
      const blob = res.data as Blob;
      const url = URL.createObjectURL(blob);
      try {
        const a = document.createElement('a');
        a.href = url;
        a.download = `quote-${quote?.quoteNumber ?? quoteId}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } finally {
        // Defer revoke so the browser has time to start the download
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{quote ? quote.quoteNumber : 'กำลังโหลด...'}</DialogTitle>
          {quote && (
            <DialogDescription>
              <Badge variant={STATUS_VARIANT[quote.status]}>{STATUS_LABEL[quote.status]}</Badge>
              <span className="ml-2 text-muted-foreground">ใช้ได้ถึง {fmtDate(quote.validUntil)}</span>
            </DialogDescription>
          )}
        </DialogHeader>

        {isLoading || !quote ? (
          <div className="py-8 text-center text-muted-foreground">กำลังโหลด...</div>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-muted-foreground">ลูกค้า</div>
                <div>{quote.customer.name}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">สาขา</div>
                <div>{quote.branch.name}</div>
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
                  {quote.items.map((it) => (
                    <tr key={it.id} className="border-b border-border/60">
                      <td className="px-3 py-2">{it.description}</td>
                      <td className="px-3 py-2 text-right">{it.quantity}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(it.unitPrice)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(it.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end">
              <div className="w-64 space-y-1">
                <div className="flex justify-between"><span>ยอดรวม</span><span className="tabular-nums">{fmtMoney(quote.subtotal)}</span></div>
                <div className="flex justify-between"><span>ส่วนลด</span><span className="tabular-nums">-{fmtMoney(quote.discount)}</span></div>
                <div className="flex justify-between"><span>ภาษี</span><span className="tabular-nums">{fmtMoney(quote.vatAmount)}</span></div>
                <div className="flex justify-between border-t border-border pt-1 font-semibold">
                  <span>รวมทั้งสิ้น</span><span className="tabular-nums">{fmtMoney(quote.total)}</span>
                </div>
              </div>
            </div>

            {quote.notes && (
              <div className="rounded-md border border-border bg-muted/30 p-3 text-muted-foreground">
                {quote.notes}
              </div>
            )}

            {quote.convertedToSale && (
              <div className="rounded-md border border-border bg-accent/40 p-3 text-sm">
                แปลงเป็นการขาย: <span className="font-mono">{quote.convertedToSale.saleNumber}</span>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => pdfMut.mutate()}
            disabled={pdfMut.isPending || !quote}
            className="gap-2"
          >
            <Printer className="h-4 w-4" /> {pdfMut.isPending ? 'กำลังสร้าง PDF...' : 'พิมพ์ PDF'}
          </Button>
          {canMutate && quote?.status === 'DRAFT' && (
            <Button onClick={() => sendMut.mutate()} disabled={sendMut.isPending} className="gap-2">
              <Send className="h-4 w-4" /> ส่งใบเสนอราคา
            </Button>
          )}
          {canMutate && quote?.status === 'SENT' && (
            <>
              <Button variant="outline" onClick={() => rejectMut.mutate()} disabled={rejectMut.isPending} className="gap-2">
                <XCircle className="h-4 w-4" /> ลูกค้าปฏิเสธ
              </Button>
              <Button onClick={() => acceptMut.mutate()} disabled={acceptMut.isPending} className="gap-2">
                <CheckCircle2 className="h-4 w-4" /> ลูกค้ายอมรับ
              </Button>
            </>
          )}
          {canMutate && quote?.status === 'ACCEPTED' && !quote.convertedToSale && (
            <Button onClick={() => convertMut.mutate()} disabled={convertMut.isPending} className="gap-2">
              <ShoppingCart className="h-4 w-4" /> แปลงเป็นการขาย
            </Button>
          )}
          {canDelete && quote?.status === 'DRAFT' && (
            <Button variant="destructive" onClick={() => deleteMut.mutate()} disabled={deleteMut.isPending} className="gap-2">
              <Trash2 className="h-4 w-4" /> ลบ
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>ปิด</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
