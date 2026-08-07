import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import QueryBoundary from '@/components/QueryBoundary';
import Modal from '@/components/ui/Modal';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { formatDateShort } from '@/utils/formatters';
import { Badge } from '@/components/ui/badge';
import { getStatusBadgeProps, repossessionStatusMap, conditionGradeMap } from '@/lib/status-badges';
import { Download, Send } from 'lucide-react';
import { CashAccountSelect, KBANK_ONLY_CODES } from '@/components/CashAccountSelect';
import { useAuth } from '@/contexts/AuthContext';

async function downloadReceiptPdf(receiptId: string, receiptNumber: string) {
  try {
    const res = await api.get(`/receipts/${receiptId}/pdf`, { responseType: 'blob' });
    const blob = new Blob([res.data], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${receiptNumber}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    toast.error(getErrorMessage(err) || 'ไม่สามารถดาวน์โหลดใบลดหนี้');
  }
}

interface Repossession {
  id: string;
  repossessedDate: string;
  conditionGrade: string;
  appraisalPrice: string;
  repairCost: string;
  resellPrice: string | null;
  status: string;
  notes: string | null;
  contract: {
    id: string;
    contractNumber: string;
    sellingPrice: string;
    financedAmount: string;
    customer: { id: string; name: string; phone: string };
    branch: { id: string; name: string };
  };
  product: { id: string; name: string; brand: string; model: string; imeiSerial: string | null };
  appraisedBy: { id: string; name: string };
  /** Auto-issued ใบลดหนี้ (CN) from JP5 repossession — null when this repossession
   *  wrote off no accrued-unpaid installments (outstandingBalance was 0). */
  creditNote: { receiptId: string; receiptNumber: string; lastDeliveryStatus: string | null } | null;
}


export default function RepossessionsPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  // POST /contracts/:id/shop-collect-settlement roles (OWNER/FM/ACC)
  const canSettle = ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'].includes(user?.role ?? '');
  const [statusFilter, setStatusFilter] = useState('');
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<Repossession | null>(null);
  // Shop-collect settlement dialog (ยึดคืนแบบตั้งลูกหนี้-หน้าร้าน 11-2107)
  const [settlementRepo, setSettlementRepo] = useState<Repossession | null>(null);
  const [settlementAmount, setSettlementAmount] = useState('');
  const [settlementAccountCode, setSettlementAccountCode] = useState('11-1201');
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; message: string; action: () => void }>({ open: false, message: '', action: () => {} });
  const [updateForm, setUpdateForm] = useState({
    repairCost: '',
    resellPrice: '',
    status: '',
    notes: '',
  });

  const {
    data: repos = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<Repossession[]>({
    queryKey: ['repossessions', statusFilter],
    queryFn: async () => {
      // limit=200 = the server cap (default is a silent 20) — same convention
      // as the contracts fetches above. Endpoint is paginated
      // ({ data, total, page, limit }) — unwrap the inner array, otherwise
      // DataTable receives an object and renders the list as permanently empty.
      const params = statusFilter ? `?status=${statusFilter}&limit=200` : '?limit=200';
      const res = (await api.get(`/repossessions${params}`)).data;
      return res?.data ?? [];
    },
  });

  const { data: profitLoss } = useQuery({
    queryKey: ['repossessions-pl'],
    queryFn: async () => (await api.get('/repossessions/profit-loss')).data,
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.patch(`/repossessions/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repossessions'] });
      queryClient.invalidateQueries({ queryKey: ['repossessions-pl'] });
      toast.success('อัพเดทสำเร็จ');
      setIsUpdateModalOpen(false);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const readyForSaleMutation = useMutation({
    mutationFn: async (id: string) => api.post(`/repossessions/${id}/ready-for-sale`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repossessions'] });
      toast.success('เปลี่ยนสถานะเป็น พร้อมขาย แล้ว');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  // Resend the auto-issued ใบลดหนี้ (CN) over LINE FINANCE — routes through
  // CreditNoteDeliveryService server-side (receipts.service sendReceiptToCustomer).
  const resendCnMutation = useMutation({
    mutationFn: async (receiptId: string) => api.post(`/receipts/${receiptId}/send-line`),
    onSuccess: () => {
      toast.success('ส่งใบลดหนี้ทาง LINE เรียบร้อยแล้ว');
      queryClient.invalidateQueries({ queryKey: ['repossessions'] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  // Clears the Dr 11-2107 parked by a shop-collect repossession (same generic
  // endpoint the early-payoff settlement uses — Dr KBank / Cr 11-2107).
  const settlementMutation = useMutation({
    mutationFn: async () =>
      api.post(`/contracts/${settlementRepo!.contract.id}/shop-collect-settlement`, {
        depositAccountCode: settlementAccountCode,
        amount: Number(settlementAmount),
      }),
    onSuccess: () => {
      toast.success('บันทึกรับโอนจากหน้าร้านแล้ว — ล้างลูกหนี้-หน้าร้าน (11-2107)');
      queryClient.invalidateQueries({ queryKey: ['repossessions'] });
      setSettlementRepo(null);
      setSettlementAmount('');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const openSettlement = (repo: Repossession) => {
    setSettlementRepo(repo);
    // Prefill with the parked repossession value (the JP5 Dr 11-2107 amount).
    setSettlementAmount(String(Number(repo.appraisalPrice)));
    setSettlementAccountCode('11-1201');
  };

  const openUpdate = (repo: Repossession) => {
    setSelectedRepo(repo);
    setUpdateForm({
      repairCost: repo.repairCost,
      resellPrice: repo.resellPrice || '',
      status: repo.status,
      notes: repo.notes || '',
    });
    setIsUpdateModalOpen(true);
  };

  const handleUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRepo) return;
    updateMutation.mutate({
      id: selectedRepo.id,
      data: {
        repairCost: Number(updateForm.repairCost),
        resellPrice: updateForm.resellPrice ? Number(updateForm.resellPrice) : undefined,
        status: updateForm.status,
        notes: updateForm.notes,
      },
    });
  };

  const columns = [
    {
      key: 'contract',
      label: 'สัญญา',
      render: (r: Repossession) => (
        <div>
          <div className="font-medium text-primary">{r.contract.contractNumber}</div>
          <div className="text-xs text-muted-foreground">{r.contract.customer.name}</div>
        </div>
      ),
    },
    {
      key: 'product',
      label: 'สินค้า',
      render: (r: Repossession) => (
        <div className="text-sm">
          {r.product.brand} {r.product.model}
          {r.product.imeiSerial && (
            <div className="text-xs text-muted-foreground">{r.product.imeiSerial}</div>
          )}
        </div>
      ),
    },
    {
      key: 'grade',
      label: 'สภาพ',
      render: (r: Repossession) => {
        const cfg = getStatusBadgeProps(r.conditionGrade, conditionGradeMap);
        return <Badge variant={cfg.variant} appearance={cfg.appearance} size="sm">{cfg.label}</Badge>;
      },
    },
    {
      key: 'appraisalPrice',
      label: 'ราคาตี',
      render: (r: Repossession) => (
        <span className="text-sm">{Number(r.appraisalPrice).toLocaleString()} บาท</span>
      ),
    },
    {
      key: 'resellPrice',
      label: 'ราคาขาย',
      render: (r: Repossession) =>
        r.resellPrice ? (
          <span className="text-sm">{Number(r.resellPrice).toLocaleString()} บาท</span>
        ) : (
          <span className="text-xs text-muted-foreground">ยังไม่กำหนด</span>
        ),
    },
    {
      key: 'status',
      label: 'สถานะ',
      render: (r: Repossession) => {
        const cfg = getStatusBadgeProps(r.status, repossessionStatusMap);
        return <Badge variant={cfg.variant} appearance={cfg.appearance} size="sm">{cfg.label}</Badge>;
      },
    },
    {
      key: 'date',
      label: 'วันที่ยึด',
      render: (r: Repossession) => (
        <span className="text-sm">{formatDateShort(r.repossessedDate)}</span>
      ),
    },
    {
      key: 'actions',
      label: '',
      render: (r: Repossession) => (
        <div className="flex items-center gap-2">
          {(r.status === 'REPOSSESSED' || r.status === 'UNDER_REPAIR') && (
            <button
              onClick={() => setConfirmDialog({ open: true, message: 'เปลี่ยนสถานะเป็น พร้อมขาย?', action: () => readyForSaleMutation.mutate(r.id) })}
              disabled={readyForSaleMutation.isPending}
              className="text-success hover:text-success/80 text-sm font-medium"
            >
              พร้อมขาย
            </button>
          )}
          <button
            onClick={() => openUpdate(r)}
            className="text-primary hover:text-primary/80 text-sm font-medium"
          >
            จัดการ
          </button>
          {canSettle && (
            <button
              onClick={() => openSettlement(r)}
              title="บันทึกรับโอนจากหน้าร้าน — ล้างลูกหนี้-หน้าร้าน (11-2107) กรณียึดคืนแบบตั้งลูกหนี้-หน้าร้าน"
              className="text-warning hover:text-warning/80 text-sm font-medium"
            >
              รับโอนหน้าร้าน
            </button>
          )}
          {r.creditNote && (
            <>
              <button
                onClick={() => downloadReceiptPdf(r.creditNote!.receiptId, r.creditNote!.receiptNumber)}
                title="ดูใบลดหนี้ PDF"
                className="inline-flex items-center gap-1 text-info hover:text-info/80 text-sm font-medium"
              >
                <Download className="h-3.5 w-3.5" />
                ใบลดหนี้
              </button>
              <button
                onClick={() => resendCnMutation.mutate(r.creditNote!.receiptId)}
                disabled={resendCnMutation.isPending}
                title="ส่งใบลดหนี้ให้ลูกค้าทาง LINE อีกครั้ง"
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground text-sm font-medium disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" />
                ส่งซ้ำ
              </button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="ยึดคืน & ขายต่อ"
        subtitle="จัดการเครื่องที่ยึดคืนแล้ว — การยึดเครื่องทำผ่านหน้ารับชำระ (เลือกสัญญา → ยึดเครื่อง)"
        action={
          <Link
            to="/payments"
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            ยึดเครื่อง — ไปหน้ารับชำระ
          </Link>
        }
      />

      {/* Profit/Loss Summary */}
      {profitLoss?.summary && (
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-5 lg:gap-7.5 mb-6">
          <Card className="shadow-card hover:shadow-card-hover transition-all border-l-[3px] border-l-primary">
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">เครื่องที่ขายแล้ว</div>
              <div className="text-2xl font-bold">{profitLoss.summary.count ?? 0}</div>
            </CardContent>
          </Card>
          <Card className="shadow-card hover:shadow-card-hover transition-all border-l-[3px] border-l-primary">
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">ราคาตีรวม</div>
              <div className="text-lg font-bold">{(profitLoss.summary.totalAppraisal ?? 0).toLocaleString()} บาท</div>
            </CardContent>
          </Card>
          <Card className="shadow-card hover:shadow-card-hover transition-all border-l-[3px] border-l-warning">
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">ค่าซ่อมรวม</div>
              <div className="text-lg font-bold">{(profitLoss.summary.totalRepairCost ?? 0).toLocaleString()} บาท</div>
            </CardContent>
          </Card>
          <Card className="shadow-card hover:shadow-card-hover transition-all border-l-[3px] border-l-success">
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">ราคาขายรวม</div>
              <div className="text-lg font-bold">{(profitLoss.summary.totalResellPrice ?? 0).toLocaleString()} บาท</div>
            </CardContent>
          </Card>
          <Card className="shadow-card hover:shadow-card-hover transition-all border-l-[3px] border-l-success">
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">กำไร/ขาดทุน</div>
              <div className={`text-lg font-bold ${(profitLoss.summary.totalProfit ?? 0) >= 0 ? 'text-success' : 'text-destructive'}`}>
                {(profitLoss.summary.totalProfit ?? 0).toLocaleString()} บาท
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Itemized P&L Table — API returns the rows under `data` (paginated shape) */}
      {(profitLoss?.data?.length ?? 0) > 0 && (
        <Card className="shadow-card mb-6 overflow-hidden">
          <CardHeader className="px-4 py-3 border-b bg-secondary">
            <h3 className="text-sm font-medium text-foreground">รายละเอียดกำไร/ขาดทุน</h3>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-secondary text-muted-foreground text-xs">
                <tr>
                  <th className="px-4 py-2 text-left">สัญญา</th>
                  <th className="px-4 py-2 text-left">ลูกค้า</th>
                  <th className="px-4 py-2 text-left">สินค้า</th>
                  <th className="px-4 py-2 text-center">เกรด</th>
                  <th className="px-4 py-2 text-right">ราคาตี</th>
                  <th className="px-4 py-2 text-right">ค่าซ่อม</th>
                  <th className="px-4 py-2 text-right">ราคาขาย</th>
                  <th className="px-4 py-2 text-right">กำไร</th>
                  <th className="px-4 py-2 text-right">Margin</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {profitLoss?.data?.map((item: { id: string; contract: string; customer: string; product: string; conditionGrade: string; appraisalPrice: number; repairCost: number; resellPrice: number; profit: number; marginPct: string }) => (
                  <tr key={item.id} className="hover:bg-muted/50">
                    <td className="px-4 py-2 font-medium text-primary">{item.contract}</td>
                    <td className="px-4 py-2">{item.customer}</td>
                    <td className="px-4 py-2">{item.product}</td>
                    <td className="px-4 py-2 text-center">
                      {(() => { const cfg = getStatusBadgeProps(item.conditionGrade, conditionGradeMap); return <Badge variant={cfg.variant} appearance={cfg.appearance} size="sm">{cfg.label}</Badge>; })()}
                    </td>
                    <td className="px-4 py-2 text-right">{item.appraisalPrice.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right">{item.repairCost.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right">{item.resellPrice.toLocaleString()}</td>
                    <td className={`px-4 py-2 text-right font-medium ${item.profit >= 0 ? 'text-success' : 'text-destructive'}`}>
                      {item.profit.toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-right text-muted-foreground">{item.marginPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Filter */}
      <div className="mb-5">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-input rounded-lg text-sm bg-background focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden"
        >
          <option value="">ทุกสถานะ</option>
          <option value="REPOSSESSED">ยึดคืนแล้ว</option>
          <option value="UNDER_REPAIR">กำลังซ่อม</option>
          <option value="READY_FOR_SALE">พร้อมขาย</option>
          <option value="SOLD">ขายแล้ว</option>
        </select>
      </div>

      <QueryBoundary
        isLoading={isLoading && repos.length === 0}
        isError={isError}
        error={error}
        onRetry={refetch}
        errorTitle="ไม่สามารถโหลดรายการยึดคืนได้"
      >
        <DataTable columns={columns} data={repos} isLoading={isLoading} emptyMessage="ยังไม่มีการยึดคืน" />
      </QueryBoundary>

      {/* Shop-collect settlement Modal — Dr KBank / Cr 11-2107 */}
      <Modal
        isOpen={!!settlementRepo}
        onClose={() => setSettlementRepo(null)}
        title="บันทึกรับโอนจากหน้าร้าน"
      >
        {settlementRepo && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              settlementMutation.mutate();
            }}
            className="space-y-4"
          >
            <div className="bg-muted rounded-lg p-3 text-sm space-y-0.5">
              <div><strong>สัญญา:</strong> {settlementRepo.contract.contractNumber}</div>
              <div><strong>ลูกค้า:</strong> {settlementRepo.contract.customer.name}</div>
              <div className="text-xs text-muted-foreground leading-snug pt-1">
                ล้างลูกหนี้-หน้าร้าน (Dr บัญชีรับเงิน / Cr 11-2107) — ใช้กับการยึดคืนที่ติ๊ก
                "ตั้งลูกหนี้-หน้าร้าน" ไว้ · ระบบจะปฏิเสธถ้ายอดเกินลูกหนี้คงค้างของสัญญา
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                บัญชีรับเงิน (FINANCE) <span className="text-destructive">*</span>
              </label>
              <CashAccountSelect
                value={settlementAccountCode}
                onChange={setSettlementAccountCode}
                codes={KBANK_ONLY_CODES}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                จำนวนเงินที่รับโอน <span className="text-destructive">*</span>
              </label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={settlementAmount}
                onChange={(e) => setSettlementAmount(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-hidden focus:ring-2 focus:ring-ring/20"
                placeholder="0.00"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setSettlementRepo(null)}
                className="px-5 py-2.5 text-sm border border-border rounded-lg hover:bg-accent transition-colors"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={settlementMutation.isPending || !(Number(settlementAmount) > 0)}
                className="px-6 py-2.5 text-sm bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg disabled:opacity-50 font-semibold transition-colors"
              >
                {settlementMutation.isPending ? 'กำลังบันทึก...' : 'ยืนยันรับโอน'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Update Modal */}
      <Modal isOpen={isUpdateModalOpen} onClose={() => setIsUpdateModalOpen(false)} title="จัดการเครื่องยึดคืน">
        {selectedRepo && (
          <form onSubmit={handleUpdate} className="space-y-4">
            <div className="bg-muted rounded-lg p-3 text-sm">
              <div><strong>สินค้า:</strong> {selectedRepo.product.brand} {selectedRepo.product.model}</div>
              <div><strong>สัญญา:</strong> {selectedRepo.contract.contractNumber}</div>
              <div><strong>ลูกค้า:</strong> {selectedRepo.contract.customer.name}</div>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">สถานะ</label>
              <select
                value={updateForm.status}
                onChange={(e) => setUpdateForm({ ...updateForm, status: e.target.value })}
                className="w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden"
              >
                {/* Show only valid status transitions based on current status */}
                {selectedRepo.status === 'REPOSSESSED' && <>
                  <option value="REPOSSESSED">ยึดคืนแล้ว</option>
                  <option value="UNDER_REPAIR">กำลังซ่อม</option>
                  <option value="READY_FOR_SALE">พร้อมขาย</option>
                </>}
                {selectedRepo.status === 'UNDER_REPAIR' && <>
                  <option value="UNDER_REPAIR">กำลังซ่อม</option>
                  <option value="READY_FOR_SALE">พร้อมขาย</option>
                </>}
                {selectedRepo.status === 'READY_FOR_SALE' && <>
                  <option value="READY_FOR_SALE">พร้อมขาย</option>
                  <option value="SOLD">ขายแล้ว</option>
                </>}
                {selectedRepo.status === 'SOLD' && <>
                  <option value="SOLD">ขายแล้ว</option>
                </>}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">ค่าซ่อม (บาท)</label>
                <input
                  type="number"
                  value={updateForm.repairCost}
                  onChange={(e) => setUpdateForm({ ...updateForm, repairCost: e.target.value })}
                  className="w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">ราคาขายต่อ (บาท)</label>
                <input
                  type="number"
                  value={updateForm.resellPrice}
                  onChange={(e) => setUpdateForm({ ...updateForm, resellPrice: e.target.value })}
                  className="w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">หมายเหตุ</label>
              <textarea
                value={updateForm.notes}
                onChange={(e) => setUpdateForm({ ...updateForm, notes: e.target.value })}
                rows={2}
                className="w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setIsUpdateModalOpen(false)} className="px-4 py-2 text-sm text-muted-foreground">
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={updateMutation.isPending}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
              >
                {updateMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) => setConfirmDialog((prev) => ({ ...prev, open }))}
        description={confirmDialog.message}
        onConfirm={confirmDialog.action}
      />
    </div>
  );
}
