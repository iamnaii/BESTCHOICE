import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Loader2,
  ArrowRightLeft,
  AlertTriangle,
  Check,
  CheckCircle2,
  History,
  Clock,
} from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { formatThaiDateShort } from '@/lib/date';

interface BalanceResponse {
  financeOwesToShop: number;
  shopReceivableFromFinance: number;
  balanced: boolean;
  drift: number;
}

interface SettlementHistory {
  id: string;
  entryNumber: string;
  entryDate: string;
  description: string;
  referenceId: string;
  lines: Array<{
    accountCode: string;
    debit: string | number;
    credit: string | number;
  }>;
}

interface AgingBucket {
  range: '0-30' | '31-60' | '61-90' | '90+';
  count: number;
  totalAmount: number;
}

interface AgingDetail {
  txId: string;
  contractId: string;
  contractNumber: string | null;
  branchId: string;
  branchName: string | null;
  principal: number;
  commission: number;
  interest: number;
  vat: number;
  totalAmount: number;
  /** SP2 Critical #5 — principal + commission (the amount FINANCE owes SHOP). */
  settleableAmount: number;
  daysOutstanding: number;
  bucket: AgingBucket['range'];
  status: string;
  createdAt: string;
}

interface AgingResponse {
  buckets: AgingBucket[];
  totalAmount: number;
  totalCount: number;
  details: AgingDetail[];
  /** SP2 — set true when server returned `details` capped at 500 rows. */
  truncated?: boolean;
}

const fmtBaht = (n: number) =>
  n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const BUCKET_LABEL: Record<AgingBucket['range'], string> = {
  '0-30': '0-30 วัน',
  '31-60': '31-60 วัน',
  '61-90': '61-90 วัน',
  '90+': '90+ วัน (เร่งด่วน)',
};

const BUCKET_ACCENT: Record<AgingBucket['range'], string> = {
  '0-30': 'bg-success',
  '31-60': 'bg-info',
  '61-90': 'bg-warning',
  '90+': 'bg-destructive',
};

const BUCKET_TEXT_COLOR: Record<AgingBucket['range'], string> = {
  '0-30': 'text-success',
  '31-60': 'text-info',
  '61-90': 'text-warning',
  '90+': 'text-destructive',
};

export default function IntercompanySettlementPage() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<'settle' | 'aging'>('settle');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [paidDate, setPaidDate] = useState(new Date().toISOString().slice(0, 10));
  const [agingBranchId, setAgingBranchId] = useState('');
  const [agingCompanyId, setAgingCompanyId] = useState('');
  // SP2 Critical #5 — when aging row's ชำระ is clicked, this is set to that
  // InterCompanyTransaction.id so settle() can post the JE + flip status.
  // Free-form settlement (top "บันทึกการชำระเงิน" button) keeps it null and
  // falls through to the legacy no-JE path.
  const [selectedTransactionId, setSelectedTransactionId] = useState<string | null>(null);

  const balanceQ = useQuery<BalanceResponse>({
    queryKey: ['intercompany-balance'],
    queryFn: async () => (await api.get('/accounting/intercompany/balance')).data,
    staleTime: 30_000,
  });

  const historyQ = useQuery<{ data: SettlementHistory[] }>({
    queryKey: ['intercompany-history'],
    queryFn: async () =>
      (
        await api.get('/journal-entries', {
          params: { search: 'IC_SETTLEMENT', limit: 50 },
        })
      ).data,
    staleTime: 30_000,
  });

  const agingQ = useQuery<AgingResponse>({
    queryKey: ['ic-aging', agingBranchId, agingCompanyId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (agingBranchId) params.set('branchId', agingBranchId);
      if (agingCompanyId) params.set('companyId', agingCompanyId);
      const qs = params.toString();
      return (await api.get(`/inter-company/aging${qs ? `?${qs}` : ''}`)).data;
    },
    enabled: activeTab === 'aging',
    staleTime: 30_000,
  });

  const branchesQ = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches-ic'],
    queryFn: async () => (await api.get('/branches')).data,
    enabled: activeTab === 'aging',
  });

  const companiesQ = useQuery<{ id: string; companyCode: string; nameTh: string }[]>({
    queryKey: ['companies-ic'],
    queryFn: async () => (await api.get('/companies')).data,
    enabled: activeTab === 'aging',
  });

  const settleMut = useMutation({
    mutationFn: async () =>
      (
        await api.post('/accounting/intercompany/settle', {
          amount: parseFloat(amount),
          reference,
          notes: notes || undefined,
          paidDate: paidDate ? new Date(paidDate).toISOString() : undefined,
          // SP2 Critical #5 — passing transactionId routes to settleWithJournal
          // (posts real JE + flips status RECONCILED). Omitted = legacy path.
          transactionId: selectedTransactionId ?? undefined,
        })
      ).data,
    onSuccess: () => {
      toast.success(
        selectedTransactionId
          ? 'บันทึกการชำระและบันทึกบัญชีเรียบร้อย'
          : 'บันทึกการชำระเงินระหว่างบริษัทเรียบร้อย',
      );
      qc.invalidateQueries({ queryKey: ['intercompany-balance'] });
      qc.invalidateQueries({ queryKey: ['intercompany-history'] });
      qc.invalidateQueries({ queryKey: ['ic-aging'] });
      setDialogOpen(false);
      setAmount('');
      setReference('');
      setNotes('');
      setSelectedTransactionId(null);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const balance = balanceQ.data;
  const settlementHistory = (historyQ.data?.data ?? []).filter(
    (e) => e.description?.includes('IC-') && e.description?.includes('ชำระเงินระหว่างบริษัท'),
  );

  const aging = agingQ.data;
  const agingBuckets = useMemo<AgingBucket[]>(() => {
    const order: AgingBucket['range'][] = ['0-30', '31-60', '61-90', '90+'];
    if (!aging?.buckets) {
      return order.map((range) => ({ range, count: 0, totalAmount: 0 }));
    }
    const byRange = new Map(aging.buckets.map((b) => [b.range, b]));
    return order.map(
      (range) => byRange.get(range) ?? { range, count: 0, totalAmount: 0 },
    );
  }, [aging]);

  const handleSubmit = () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      toast.error('กรอกจำนวนเงินให้ถูกต้อง');
      return;
    }
    if (balance && amt > balance.financeOwesToShop + 0.01) {
      toast.error(`จำนวนเกินยอดค้าง (สูงสุด ${fmtBaht(balance.financeOwesToShop)} บาท)`);
      return;
    }
    if (!reference.trim()) {
      toast.error('กรอกเลขที่อ้างอิง');
      return;
    }
    settleMut.mutate();
  };

  const openSettleFor = (detail: AgingDetail) => {
    // SP2 Critical #5 — use settleableAmount (= principal + commission), NOT
    // totalAmount (= principal + commission + interest + vat). The backend's
    // settleWithJournal validates `inputAmount === txn.principal + commission`
    // (1-satang tolerance) and rejects the JE if interest+vat are bundled in.
    setAmount(detail.settleableAmount.toFixed(2));
    setReference(
      detail.contractNumber
        ? `IC-${detail.contractNumber}`
        : `IC-${detail.txId.slice(0, 8)}`,
    );
    setNotes(
      `ชำระยอดค้าง ${BUCKET_LABEL[detail.bucket]} (${detail.daysOutstanding} วัน) — สาขา ${detail.branchName ?? 'ไม่ระบุ'}`,
    );
    // SP2 Critical #5 — route to settleWithJournal (posts JE + RECONCILED)
    setSelectedTransactionId(detail.txId);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="ชำระเงินระหว่างบริษัท (FINANCE → SHOP)"
        subtitle="ตรวจสอบยอด FINANCE ค้างจ่าย SHOP และบันทึกการโอนเงินจริง"
      />

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'settle' | 'aging')}>
        <TabsList variant="line" size="md">
          <TabsTrigger value="settle">ชำระเงิน</TabsTrigger>
          <TabsTrigger value="aging">รายการค้างจ่าย</TabsTrigger>
        </TabsList>

        <TabsContent value="settle" className="space-y-6 pt-4">
          <QueryBoundary
            isLoading={balanceQ.isLoading}
            isError={balanceQ.isError}
            error={balanceQ.error}
            onRetry={() => balanceQ.refetch()}
          >
            {balance && (
              <Card>
                <CardHeader>
                  <h2 className="text-lg font-semibold flex items-center gap-2 leading-snug">
                    <ArrowRightLeft className="h-5 w-5 text-primary" />
                    ยอดค้างจ่ายปัจจุบัน
                  </h2>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="rounded-lg border border-border bg-muted p-4">
                      <p className="text-sm text-muted-foreground leading-snug">
                        FINANCE ค้างจ่าย SHOP
                      </p>
                      <p className="text-3xl font-bold mt-1 leading-snug">
                        ฿{fmtBaht(balance.financeOwesToShop)}
                      </p>
                    </div>
                    <div className="rounded-lg border border-border bg-muted p-4">
                      <p className="text-sm text-muted-foreground leading-snug">
                        SHOP ลูกหนี้ FINANCE
                      </p>
                      <p className="text-3xl font-bold mt-1 leading-snug">
                        ฿{fmtBaht(balance.shopReceivableFromFinance)}
                      </p>
                    </div>
                  </div>

                  {balance.balanced ? (
                    <div className="flex items-center gap-2 text-sm text-primary leading-snug">
                      <CheckCircle2 className="h-4 w-4" />
                      ยอดสองฝั่งตรงกัน (Inter-company invariant{' '}
                      <Check className="size-3.5 inline" />)
                    </div>
                  ) : (
                    <div className="flex items-start gap-2 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive leading-snug">
                      <AlertTriangle className="h-4 w-4 mt-0.5" />
                      <div>
                        <strong>ยอดสองฝั่งไม่ตรงกัน</strong> — ส่วนต่าง ฿
                        {fmtBaht(Math.abs(balance.drift))}. ตรวจสอบ JE ที่ผ่านมา
                        หรือแจ้งฝ่าย dev ทันที
                      </div>
                    </div>
                  )}

                  <Button
                    onClick={() => setDialogOpen(true)}
                    disabled={balance.financeOwesToShop <= 0}
                    className="w-full md:w-auto"
                  >
                    บันทึกการชำระเงิน
                  </Button>
                </CardContent>
              </Card>
            )}
          </QueryBoundary>

          <QueryBoundary
            isLoading={historyQ.isLoading}
            isError={historyQ.isError}
            error={historyQ.error}
            onRetry={() => historyQ.refetch()}
          >
            <Card>
              <CardHeader>
                <h2 className="text-lg font-semibold flex items-center gap-2 leading-snug">
                  <History className="h-5 w-5 text-muted-foreground" />
                  ประวัติการชำระล่าสุด
                </h2>
              </CardHeader>
              <CardContent>
                {settlementHistory.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8 leading-snug">
                    ยังไม่มีรายการชำระระหว่างบริษัท
                  </p>
                ) : (
                  <div className="space-y-2">
                    {settlementHistory.slice(0, 20).map((entry) => {
                      const cashLine = entry.lines.find(
                        (l) => l.accountCode === '11-1101' && Number(l.debit) > 0,
                      );
                      const amt = cashLine ? Number(cashLine.debit) : 0;
                      const isShopSide = entry.description.includes('(SHOP)');
                      return (
                        <div
                          key={entry.id}
                          className="flex items-center justify-between rounded-md border border-border bg-card p-3"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate leading-snug">
                              {entry.referenceId}
                            </p>
                            <p className="text-xs text-muted-foreground leading-snug">
                              {formatThaiDateShort(new Date(entry.entryDate))} •{' '}
                              {isShopSide ? 'SHOP' : 'FINANCE'}
                            </p>
                          </div>
                          <p className="text-sm font-semibold tabular-nums">
                            ฿{fmtBaht(amt)}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </QueryBoundary>
        </TabsContent>

        <TabsContent value="aging" className="space-y-4 pt-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">สาขา</Label>
              <select
                value={agingBranchId}
                onChange={(e) => setAgingBranchId(e.target.value)}
                className="px-3 py-2 border border-input rounded-lg text-sm bg-background min-w-[150px]"
              >
                <option value="">ทุกสาขา</option>
                {(branchesQ.data ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">บริษัท</Label>
              <select
                value={agingCompanyId}
                onChange={(e) => setAgingCompanyId(e.target.value)}
                className="px-3 py-2 border border-input rounded-lg text-sm bg-background min-w-[150px]"
              >
                <option value="">ทุกบริษัท</option>
                {(companiesQ.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nameTh} ({c.companyCode})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <QueryBoundary
            isLoading={agingQ.isLoading && !aging}
            isError={agingQ.isError}
            error={agingQ.error}
            onRetry={() => agingQ.refetch()}
            errorTitle="ไม่สามารถโหลดรายการค้างจ่ายได้"
          >
            {/* Bucket summary cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {agingBuckets.map((b) => (
                <Card
                  key={b.range}
                  className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden"
                >
                  <div className="flex h-full">
                    <div className={`w-1 shrink-0 rounded-r-full ${BUCKET_ACCENT[b.range]}`} />
                    <div className="p-4 flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider leading-snug">
                          {BUCKET_LABEL[b.range]}
                        </span>
                        <Clock className={`size-4 ${BUCKET_TEXT_COLOR[b.range]}`} />
                      </div>
                      <div className={`text-xl font-bold tabular-nums ${BUCKET_TEXT_COLOR[b.range]}`}>
                        ฿{fmtBaht(b.totalAmount)}
                      </div>
                      <div className="text-xs text-muted-foreground leading-snug">
                        {b.count} รายการ
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            {/* SP2 — pagination cap notice */}
            {aging?.truncated && (
              <div className="rounded-md border border-warning bg-warning/10 p-3 text-sm text-warning leading-snug flex items-start gap-2">
                <AlertTriangle className="size-4 mt-0.5 shrink-0" />
                <div>
                  <strong>แสดงผล 500 รายการแรก</strong> จากทั้งหมด {aging.totalCount} รายการ —
                  กรุณากรองตามสาขา/บริษัทเพื่อแคบผลลัพธ์
                </div>
              </div>
            )}

            {/* Details table */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h2 className="text-lg font-semibold leading-snug">
                    รายการค้างจ่ายทั้งหมด ({aging?.totalCount ?? 0} รายการ)
                  </h2>
                  <span className="text-sm text-muted-foreground tabular-nums leading-snug">
                    รวม ฿{fmtBaht(aging?.totalAmount ?? 0)}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm leading-snug">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-3 font-medium text-muted-foreground">
                          สัญญา / สาขา
                        </th>
                        <th className="text-right p-3 font-medium text-muted-foreground">
                          ยอดจัด
                        </th>
                        <th className="text-right p-3 font-medium text-muted-foreground">
                          ค่าคอม
                        </th>
                        <th className="text-right p-3 font-medium text-muted-foreground">
                          รวม
                        </th>
                        <th className="text-center p-3 font-medium text-muted-foreground">
                          วันค้าง
                        </th>
                        <th className="text-center p-3 font-medium text-muted-foreground">
                          สถานะ
                        </th>
                        <th className="p-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {(aging?.details ?? []).length === 0 ? (
                        <tr>
                          <td
                            colSpan={7}
                            className="p-8 text-center text-muted-foreground leading-snug"
                          >
                            ไม่มีรายการค้างจ่าย
                          </td>
                        </tr>
                      ) : (
                        (aging?.details ?? []).map((d) => (
                          <tr key={d.txId} className="border-t border-border hover:bg-accent/30">
                            <td className="p-3">
                              <div className="font-medium leading-snug">
                                {d.contractNumber ?? d.txId.slice(0, 8)}
                              </div>
                              <div className="text-xs text-muted-foreground leading-snug">
                                {d.branchName ?? '—'}
                              </div>
                            </td>
                            <td className="p-3 text-right tabular-nums">{fmtBaht(d.principal)}</td>
                            <td className="p-3 text-right tabular-nums">{fmtBaht(d.commission)}</td>
                            <td className="p-3 text-right tabular-nums font-semibold">
                              {fmtBaht(d.totalAmount)}
                            </td>
                            <td className="p-3 text-center">
                              <span
                                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium leading-snug ${BUCKET_TEXT_COLOR[d.bucket]} bg-muted`}
                              >
                                {d.daysOutstanding} วัน
                              </span>
                            </td>
                            <td className="p-3 text-center">
                              <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground leading-snug">
                                {d.status}
                              </span>
                            </td>
                            <td className="p-3 text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openSettleFor(d)}
                              >
                                ชำระ
                              </Button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </QueryBoundary>
        </TabsContent>
      </Tabs>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          // SP2 Critical #5 — clearing on close prevents the next "บันทึกการชำระเงิน"
          // (free-form, top-card button) from inheriting a stale transactionId.
          if (!open) setSelectedTransactionId(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>บันทึกการชำระเงิน FINANCE → SHOP</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="amount">จำนวนเงิน (บาท)</Label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                min="0"
                max={balance?.financeOwesToShop}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
              />
              {balance && (
                <p className="text-xs text-muted-foreground mt-1 leading-snug">
                  สูงสุด ฿{fmtBaht(balance.financeOwesToShop)}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="reference">เลขที่อ้างอิง (Bank ref / เลขที่โอน)</Label>
              <Input
                id="reference"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="เช่น TXN-2026-04-001"
                maxLength={50}
              />
            </div>
            <div>
              <Label htmlFor="paidDate">วันที่ชำระ</Label>
              <Input
                id="paidDate"
                type="date"
                value={paidDate}
                onChange={(e) => setPaidDate(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="notes">หมายเหตุ (ถ้ามี)</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                maxLength={500}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              ยกเลิก
            </Button>
            <Button onClick={handleSubmit} disabled={settleMut.isPending}>
              {settleMut.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
