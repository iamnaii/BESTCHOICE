import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, ArrowRightLeft, AlertTriangle, CheckCircle2, History } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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

const fmtBaht = (n: number) =>
  n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function IntercompanySettlementPage() {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [paidDate, setPaidDate] = useState(new Date().toISOString().slice(0, 10));

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

  const settleMut = useMutation({
    mutationFn: async () =>
      (
        await api.post('/accounting/intercompany/settle', {
          amount: parseFloat(amount),
          reference,
          notes: notes || undefined,
          paidDate: paidDate ? new Date(paidDate).toISOString() : undefined,
        })
      ).data,
    onSuccess: () => {
      toast.success('บันทึกการชำระเงินระหว่างบริษัทเรียบร้อย');
      qc.invalidateQueries({ queryKey: ['intercompany-balance'] });
      qc.invalidateQueries({ queryKey: ['intercompany-history'] });
      setDialogOpen(false);
      setAmount('');
      setReference('');
      setNotes('');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const balance = balanceQ.data;
  const settlementHistory = (historyQ.data?.data ?? []).filter(
    (e) => e.description?.includes('IC-') && e.description?.includes('ชำระเงินระหว่างบริษัท'),
  );

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

  return (
    <div className="space-y-6">
      <PageHeader
        title="ชำระเงินระหว่างบริษัท (FINANCE → SHOP)"
        subtitle="ตรวจสอบยอด FINANCE ค้างจ่าย SHOP และบันทึกการโอนเงินจริง"
      />

      <QueryBoundary isLoading={balanceQ.isLoading} isError={balanceQ.isError} error={balanceQ.error} onRetry={() => balanceQ.refetch()}>
        {balance && (
          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <ArrowRightLeft className="h-5 w-5 text-primary" />
                ยอดค้างจ่ายปัจจุบัน
              </h2>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-lg border border-border bg-muted p-4">
                  <p className="text-sm text-muted-foreground">FINANCE ค้างจ่าย SHOP</p>
                  <p className="text-3xl font-bold mt-1 leading-snug">
                    ฿{fmtBaht(balance.financeOwesToShop)}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-muted p-4">
                  <p className="text-sm text-muted-foreground">SHOP ลูกหนี้ FINANCE</p>
                  <p className="text-3xl font-bold mt-1 leading-snug">
                    ฿{fmtBaht(balance.shopReceivableFromFinance)}
                  </p>
                </div>
              </div>

              {balance.balanced ? (
                <div className="flex items-center gap-2 text-sm text-primary">
                  <CheckCircle2 className="h-4 w-4" />
                  ยอดสองฝั่งตรงกัน (Inter-company invariant ✓)
                </div>
              ) : (
                <div className="flex items-start gap-2 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertTriangle className="h-4 w-4 mt-0.5" />
                  <div>
                    <strong>ยอดสองฝั่งไม่ตรงกัน</strong> — ส่วนต่าง ฿{fmtBaht(Math.abs(balance.drift))}.
                    ตรวจสอบ JE ที่ผ่านมา หรือแจ้งฝ่าย dev ทันที
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

      <QueryBoundary isLoading={historyQ.isLoading} isError={historyQ.isError} error={historyQ.error} onRetry={() => historyQ.refetch()}>
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <History className="h-5 w-5 text-muted-foreground" />
              ประวัติการชำระล่าสุด
            </h2>
          </CardHeader>
          <CardContent>
            {settlementHistory.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
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
                        <p className="text-sm font-medium truncate">
                          {entry.referenceId}
                        </p>
                        <p className="text-xs text-muted-foreground">
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
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
                <p className="text-xs text-muted-foreground mt-1">
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
