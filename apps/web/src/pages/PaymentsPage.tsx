import { useState, useMemo, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import { compressImageForOcr } from '@/lib/compressImage';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { toast } from 'sonner';

interface OcrPaymentSlipResult {
  amount: number | null;
  senderName: string | null;
  senderBank: string | null;
  senderAccountNo: string | null;
  receiverName: string | null;
  receiverBank: string | null;
  receiverAccountNo: string | null;
  transactionRef: string | null;
  transactionDate: string | null;
  transactionTime: string | null;
  slipType: string | null;
  confidence: number;
}

interface PendingPayment {
  id: string;
  installmentNo: number;
  dueDate: string;
  amountDue: string;
  amountPaid: string;
  lateFee: string;
  status: string;
  contract: {
    id: string;
    contractNumber: string;
    customer: { id: string; name: string; phone: string };
    branch: { id: string; name: string };
  };
}

interface DailySummary {
  date: string;
  totalPayments: number;
  totalAmount: number;
  totalLateFees: number;
  byMethod: Record<string, number>;
  payments: any[];
}

const paymentStatusLabels: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'รอชำระ', className: 'bg-muted text-foreground' },
  PAID: { label: 'ชำระแล้ว', className: 'bg-green-100 text-green-700' },
  OVERDUE: { label: 'เกินกำหนด', className: 'bg-red-100 text-red-700' },
  PARTIALLY_PAID: { label: 'ชำระบางส่วน', className: 'bg-yellow-100 text-yellow-700' },
};

const methodLabels: Record<string, string> = {
  CASH: 'เงินสด',
  BANK_TRANSFER: 'โอนเงิน',
  QR_EWALLET: 'QR/E-Wallet',
};

const slipTypeLabels: Record<string, string> = {
  BANK_TRANSFER: 'โอนเงิน',
  QR_PAYMENT: 'QR Payment',
  PROMPTPAY: 'พร้อมเพย์',
  OTHER: 'อื่นๆ',
};

export default function PaymentsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'pending' | 'summary'>('pending');
  const [statusFilter, setStatusFilter] = useState('');
  const [summaryDate, setSummaryDate] = useState(new Date().toISOString().split('T')[0]);
  const [showPayModal, setShowPayModal] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<PendingPayment | null>(null);
  const [payForm, setPayForm] = useState({ amount: 0, paymentMethod: 'CASH', notes: '' });

  // OCR slip state
  const slipFileRef = useRef<HTMLInputElement>(null);
  const [ocrSlipLoading, setOcrSlipLoading] = useState(false);
  const [slipResult, setSlipResult] = useState<OcrPaymentSlipResult | null>(null);

  // Pending payments
  const { data: pendingPayments = [], isLoading: loadingPending } = useQuery<PendingPayment[]>({
    queryKey: ['pending-payments', statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      const { data } = await api.get(`/payments/pending?${params}`);
      return data;
    },
    enabled: tab === 'pending',
  });

  // Daily summary
  const { data: summary, isLoading: loadingSummary } = useQuery<DailySummary>({
    queryKey: ['daily-summary', summaryDate],
    queryFn: async () => {
      const { data } = await api.get(`/payments/daily-summary?date=${summaryDate}`);
      return data;
    },
    enabled: tab === 'summary',
  });

  const recordMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const { data } = await api.post('/payments/record', body);
      return data;
    },
    onSuccess: () => {
      toast.success('บันทึกการชำระสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['pending-payments'] });
      queryClient.invalidateQueries({ queryKey: ['daily-summary'] });
      setShowPayModal(false);
      setSelectedPayment(null);
      setSlipResult(null);
    },
    onError: (err: any) => toast.error(getErrorMessage(err)),
  });

  const openPayModal = useCallback((payment: PendingPayment) => {
    setSelectedPayment(payment);
    const remaining = parseFloat(payment.amountDue) + parseFloat(payment.lateFee) - parseFloat(payment.amountPaid);
    setPayForm({ amount: Math.round(remaining * 100) / 100, paymentMethod: 'CASH', notes: '' });
    setSlipResult(null);
    setShowPayModal(true);
  }, []);

  const handlePay = () => {
    if (!selectedPayment || payForm.amount <= 0) return;
    const remaining = parseFloat(selectedPayment.amountDue) + parseFloat(selectedPayment.lateFee) - parseFloat(selectedPayment.amountPaid);
    if (payForm.amount > Math.round(remaining * 100) / 100) {
      toast.error(`จำนวนเงินไม่ควรเกินยอดคงค้าง ${remaining.toLocaleString()} ฿`);
      return;
    }
    recordMutation.mutate({
      contractId: selectedPayment.contract.id,
      installmentNo: selectedPayment.installmentNo,
      amount: payForm.amount,
      paymentMethod: payForm.paymentMethod,
      notes: payForm.notes || undefined,
    });
  };

  // OCR Slip Scanner
  const handleSlipScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error('ไฟล์ต้องมีขนาดไม่เกิน 10MB');
      return;
    }
    if (!file.type.startsWith('image/')) {
      toast.error('กรุณาเลือกไฟล์รูปภาพ');
      return;
    }

    setOcrSlipLoading(true);
    try {
      const imageBase64 = await compressImageForOcr(file);
      const { data } = await api.post<OcrPaymentSlipResult>('/ocr/payment-slip', { imageBase64 }, { timeout: 90000 });

      setSlipResult(data);

      // Auto-fill form from OCR result
      if (data.amount && data.amount > 0) {
        const slipType = data.slipType;
        let method = 'BANK_TRANSFER';
        if (slipType === 'QR_PAYMENT' || slipType === 'PROMPTPAY') method = 'QR_EWALLET';

        const notesParts: string[] = [];
        if (data.transactionRef) notesParts.push(`Ref: ${data.transactionRef}`);
        if (data.senderName) notesParts.push(`ผู้โอน: ${data.senderName}`);
        if (data.senderBank) notesParts.push(data.senderBank);
        if (data.transactionDate) notesParts.push(data.transactionDate);
        if (data.transactionTime) notesParts.push(data.transactionTime);

        setPayForm(prev => ({
          ...prev,
          amount: data.amount!,
          paymentMethod: method,
          notes: notesParts.join(' | '),
        }));
      }

      const pct = (data.confidence * 100).toFixed(0);
      if (data.confidence < 0.5) {
        toast.error(`อ่านสลิปได้ แต่ความมั่นใจต่ำมาก (${pct}%) กรุณาตรวจสอบข้อมูล`);
      } else if (data.confidence < 0.7) {
        toast.warning(`อ่านสลิปสำเร็จ ความมั่นใจ ${pct}% กรุณาตรวจสอบ`);
      } else {
        toast.success(`อ่านสลิปสำเร็จ (ความมั่นใจ ${pct}%)`);
      }
    } catch (err: any) {
      if (err.code === 'ECONNABORTED' || !err.response) {
        toast.error('ไม่สามารถเชื่อมต่อ OCR ได้ กรุณาลองใหม่');
      } else {
        toast.error(getErrorMessage(err));
      }
    } finally {
      setOcrSlipLoading(false);
      if (slipFileRef.current) slipFileRef.current.value = '';
    }
  };

  const pendingColumns = useMemo(() => [
    {
      key: 'contract',
      label: 'สัญญา',
      render: (p: PendingPayment) => (
        <div>
          <div className="font-mono text-sm text-primary">{p.contract.contractNumber}</div>
          <div className="text-xs text-muted-foreground">{p.contract.customer.name}</div>
        </div>
      ),
    },
    { key: 'installmentNo', label: 'งวดที่', render: (p: PendingPayment) => <span className="font-medium">{p.installmentNo}</span> },
    { key: 'dueDate', label: 'วันครบกำหนด', render: (p: PendingPayment) => {
      const isOverdue = new Date(p.dueDate) < new Date();
      return <span className={`text-sm ${isOverdue ? 'text-red-600 font-medium' : ''}`}>{new Date(p.dueDate).toLocaleDateString('th-TH')}</span>;
    }},
    { key: 'amountDue', label: 'ยอดที่ต้องชำระ', render: (p: PendingPayment) => {
      const total = parseFloat(p.amountDue) + parseFloat(p.lateFee);
      return <span className="text-sm font-medium">{total.toLocaleString()} ฿</span>;
    }},
    { key: 'amountPaid', label: 'ชำระแล้ว', render: (p: PendingPayment) => {
      const paid = parseFloat(p.amountPaid);
      return paid > 0 ? <span className="text-sm text-green-600">{paid.toLocaleString()} ฿</span> : <span className="text-xs text-muted-foreground">-</span>;
    }},
    { key: 'lateFee', label: 'ค่าปรับ', render: (p: PendingPayment) => {
      const fee = parseFloat(p.lateFee);
      return fee > 0 ? <span className="text-sm text-red-600">{fee.toLocaleString()} ฿</span> : <span className="text-xs text-muted-foreground">-</span>;
    }},
    {
      key: 'status',
      label: 'สถานะ',
      render: (p: PendingPayment) => {
        const s = paymentStatusLabels[p.status] || { label: p.status, className: 'bg-muted' };
        return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.className}`}>{s.label}</span>;
      },
    },
    { key: 'branch', label: 'สาขา', render: (p: PendingPayment) => <span className="text-xs">{p.contract.branch.name}</span> },
    {
      key: 'actions',
      label: '',
      render: (p: PendingPayment) => (
        <button onClick={() => openPayModal(p)} className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700">
          รับชำระ
        </button>
      ),
    },
  ], [openPayModal]);

  return (
    <div>
      <PageHeader title="ชำระเงิน" subtitle="บันทึกการรับชำระค่างวด" />

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-muted rounded-lg p-1 w-fit">
        <button onClick={() => setTab('pending')} className={`px-4 py-2 text-sm rounded-md ${tab === 'pending' ? 'bg-card shadow-xs shadow-black/5 font-medium' : 'text-muted-foreground'}`}>
          รายการรอชำระ
        </button>
        <button onClick={() => setTab('summary')} className={`px-4 py-2 text-sm rounded-md ${tab === 'summary' ? 'bg-card shadow-xs shadow-black/5 font-medium' : 'text-muted-foreground'}`}>
          สรุปรายวัน
        </button>
      </div>

      {/* Pending Tab */}
      {tab === 'pending' && (
        <div>
          <div className="flex gap-3 mb-4">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 border border-input rounded-lg text-sm">
              <option value="">ทุกสถานะ</option>
              <option value="PENDING">รอชำระ</option>
              <option value="OVERDUE">เกินกำหนด</option>
              <option value="PARTIALLY_PAID">ชำระบางส่วน</option>
            </select>
          </div>

          {loadingPending ? (
            <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>
          ) : (
            <DataTable columns={pendingColumns} data={pendingPayments} emptyMessage="ไม่มีรายการรอชำระ" />
          )}
        </div>
      )}

      {/* Summary Tab */}
      {tab === 'summary' && (
        <div>
          <div className="mb-4">
            <input
              type="date"
              value={summaryDate}
              onChange={(e) => setSummaryDate(e.target.value)}
              className="px-3 py-2 border border-input rounded-lg text-sm"
            />
          </div>

          {loadingSummary ? (
            <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>
          ) : summary ? (
            <div>
              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-5 lg:gap-7.5 mb-6">
                <Card>
                  <CardContent>
                    <div className="text-xs text-muted-foreground mb-1">จำนวนรายการ</div>
                    <div className="text-2xl font-bold">{summary.totalPayments}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent>
                    <div className="text-xs text-muted-foreground mb-1">ยอดรวม</div>
                    <div className="text-2xl font-bold text-green-600">{summary.totalAmount.toLocaleString()} ฿</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent>
                    <div className="text-xs text-muted-foreground mb-1">ค่าปรับรวม</div>
                    <div className="text-2xl font-bold text-red-600">{summary.totalLateFees.toLocaleString()} ฿</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent>
                    <div className="text-xs text-muted-foreground mb-1">แยกตามวิธี</div>
                    {Object.entries(summary.byMethod).map(([method, amount]) => (
                      <div key={method} className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{methodLabels[method] || method}</span>
                        <span className="font-medium">{amount.toLocaleString()} ฿</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>

              {/* Payment List */}
              {summary.payments.length > 0 && (
                <Card className="overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted">
                      <tr>
                        <th className="text-left p-3">สัญญา</th>
                        <th className="text-left p-3">ลูกค้า</th>
                        <th className="text-left p-3">งวดที่</th>
                        <th className="text-right p-3">ยอดชำระ</th>
                        <th className="text-left p-3">วิธี</th>
                        <th className="text-left p-3">เวลา</th>
                        <th className="text-left p-3">ผู้บันทึก</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.payments.map((p: any) => (
                        <tr key={p.id} className="border-t">
                          <td className="p-3 font-mono text-xs">{p.contract?.contractNumber}</td>
                          <td className="p-3 text-xs">{p.contract?.customer?.name}</td>
                          <td className="p-3">{p.installmentNo}</td>
                          <td className="p-3 text-right font-medium">{Number(p.amountPaid).toLocaleString()} ฿</td>
                          <td className="p-3 text-xs">{methodLabels[p.paymentMethod] || p.paymentMethod}</td>
                          <td className="p-3 text-xs">{p.paidDate ? new Date(p.paidDate).toLocaleTimeString('th-TH') : '-'}</td>
                          <td className="p-3 text-xs">{p.recordedBy?.name || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              )}
            </div>
          ) : null}
        </div>
      )}

      {/* Record Payment Modal */}
      {showPayModal && selectedPayment && (
        <Modal isOpen title="บันทึกการรับชำระ" onClose={() => { setShowPayModal(false); setSelectedPayment(null); setSlipResult(null); setPayForm({ amount: 0, paymentMethod: 'CASH', notes: '' }); }}>
          <div className="flex flex-col gap-5 lg:gap-7.5">
            <div className="bg-muted rounded-lg p-4">
              <div className="text-sm"><span className="text-muted-foreground">สัญญา: </span><span className="font-mono font-medium">{selectedPayment.contract.contractNumber}</span></div>
              <div className="text-sm"><span className="text-muted-foreground">ลูกค้า: </span>{selectedPayment.contract.customer.name}</div>
              <div className="text-sm"><span className="text-muted-foreground">งวดที่: </span>{selectedPayment.installmentNo}</div>
              <div className="text-sm mt-2">
                <span className="text-muted-foreground">ยอดคงค้าง: </span>
                <span className="font-bold text-lg">{(parseFloat(selectedPayment.amountDue) + parseFloat(selectedPayment.lateFee) - parseFloat(selectedPayment.amountPaid)).toLocaleString()} ฿</span>
              </div>
              {parseFloat(selectedPayment.lateFee) > 0 && (
                <div className="text-xs text-red-600 mt-1">รวมค่าปรับ {parseFloat(selectedPayment.lateFee).toLocaleString()} ฿</div>
              )}
            </div>

            {/* OCR Slip Scanner */}
            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <h4 className="text-sm font-semibold text-green-800">สแกนสลิปโอนเงิน (OCR)</h4>
              </div>
              <p className="text-xs text-green-600 mb-2">ถ่ายรูปสลิปเพื่อกรอกข้อมูลอัตโนมัติ</p>
              <input
                ref={slipFileRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleSlipScan}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => slipFileRef.current?.click()}
                disabled={ocrSlipLoading}
                className="inline-flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 disabled:opacity-50"
              >
                {ocrSlipLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white" />
                    กำลังอ่านสลิป...
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    สแกนสลิป
                  </>
                )}
              </button>

              {/* Show OCR slip result */}
              {slipResult && (
                <div className="mt-2 p-2 rounded border border-green-200 space-y-1">
                  <div className="text-xs text-muted-foreground">ผลการสแกน:</div>
                  {slipResult.amount && <div className="text-xs"><span className="text-muted-foreground">จำนวนเงิน:</span> <span className="font-bold text-green-700">{slipResult.amount.toLocaleString()} ฿</span></div>}
                  {slipResult.senderName && <div className="text-xs"><span className="text-muted-foreground">ผู้โอน:</span> {slipResult.senderName} {slipResult.senderBank && `(${slipResult.senderBank})`}</div>}
                  {slipResult.receiverName && <div className="text-xs"><span className="text-muted-foreground">ผู้รับ:</span> {slipResult.receiverName} {slipResult.receiverBank && `(${slipResult.receiverBank})`}</div>}
                  {slipResult.transactionRef && <div className="text-xs"><span className="text-muted-foreground">Ref:</span> <span className="font-mono">{slipResult.transactionRef}</span></div>}
                  {slipResult.transactionDate && <div className="text-xs"><span className="text-muted-foreground">วันเวลา:</span> {slipResult.transactionDate} {slipResult.transactionTime || ''}</div>}
                  {slipResult.slipType && <div className="text-xs"><span className="text-muted-foreground">ประเภท:</span> {slipTypeLabels[slipResult.slipType] || slipResult.slipType}</div>}
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1">จำนวนเงินที่รับ</label>
              <input
                type="number"
                value={payForm.amount}
                onChange={(e) => setPayForm({ ...payForm, amount: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-input rounded-lg text-sm"
                min={0}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1">วิธีชำระ</label>
              <select value={payForm.paymentMethod} onChange={(e) => setPayForm({ ...payForm, paymentMethod: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm">
                <option value="CASH">เงินสด</option>
                <option value="BANK_TRANSFER">โอนเงิน</option>
                <option value="QR_EWALLET">QR/E-Wallet</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1">หมายเหตุ</label>
              <input
                type="text"
                value={payForm.notes}
                onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })}
                className="w-full px-3 py-2 border border-input rounded-lg text-sm"
              />
            </div>

            <div className="flex gap-3 pt-2">
              <button onClick={() => { setShowPayModal(false); setSelectedPayment(null); setSlipResult(null); setPayForm({ amount: 0, paymentMethod: 'CASH', notes: '' }); }} className="flex-1 px-4 py-2 text-sm border border-input rounded-lg">ยกเลิก</button>
              <button onClick={handlePay} disabled={recordMutation.isPending || payForm.amount <= 0} className="flex-1 px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
                {recordMutation.isPending ? 'กำลังบันทึก...' : 'ยืนยันรับชำระ'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
