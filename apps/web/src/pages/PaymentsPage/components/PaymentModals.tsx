import Modal from '@/components/ui/Modal';
import Decimal from 'decimal.js';
import { toast } from 'sonner';
import { formatThaiDate } from '@/lib/date';
import type { PendingPayment, OcrPaymentSlipResult } from '../types';
import { slipTypeLabels, isSlipRequired } from '../types';

/* ─── Slip Scanner Button ─── */
function SlipScannerSection({
  title,
  description,
  fileRef,
  onScan,
  loading,
  result,
  required,
}: {
  title: string;
  description: string;
  fileRef: React.RefObject<HTMLInputElement | null>;
  onScan: (e: React.ChangeEvent<HTMLInputElement>) => void;
  loading: boolean;
  result: OcrPaymentSlipResult | null;
  required?: boolean;
}) {
  return (
    <div className="bg-success/5 dark:bg-success/10 border border-success/20 rounded-lg p-3">
      <div className="flex items-center justify-between mb-1">
        <h4 className="text-sm font-semibold text-success">{title} {required && <span className="text-destructive">*</span>}</h4>
      </div>
      <p className="text-xs text-success mb-2">{description}</p>
      <input
        ref={fileRef as React.RefObject<HTMLInputElement>}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onScan}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={loading}
        className="inline-flex items-center gap-2 px-3 py-1.5 bg-success text-success-foreground rounded-lg text-xs font-medium hover:bg-success/90 disabled:opacity-50"
      >
        {loading ? (
          <>
            <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-success-foreground" />
            กำลังอ่านสลิป...
          </>
        ) : (
          <>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            สแกนสลิป
          </>
        )}
      </button>

      {result && (
        <div className="mt-2 p-2 rounded border border-success/20 space-y-1">
          <div className="text-xs text-muted-foreground">ผลการสแกน:</div>
          {result.amount && <div className="text-xs"><span className="text-muted-foreground">จำนวนเงิน:</span> <span className="font-bold text-success">{result.amount.toLocaleString()} ฿</span></div>}
          {result.senderName && <div className="text-xs"><span className="text-muted-foreground">ผู้โอน:</span> {result.senderName} {result.senderBank && `(${result.senderBank})`}</div>}
          {result.receiverName && <div className="text-xs"><span className="text-muted-foreground">ผู้รับ:</span> {result.receiverName} {result.receiverBank && `(${result.receiverBank})`}</div>}
          {result.transactionRef && <div className="text-xs"><span className="text-muted-foreground">Ref:</span> <span className="font-mono">{result.transactionRef}</span></div>}
          {result.transactionDate && <div className="text-xs"><span className="text-muted-foreground">วันเวลา:</span> {result.transactionDate} {result.transactionTime || ''}</div>}
          {result.slipType && <div className="text-xs"><span className="text-muted-foreground">ประเภท:</span> {slipTypeLabels[result.slipType] || result.slipType}</div>}
        </div>
      )}
      {required && !result && <p className="text-xs text-destructive mt-1">* จำเป็นต้องแนบสลิปสำหรับการโอนเงิน/QR</p>}
    </div>
  );
}

/* ─── Single Payment Modal ─── */
interface RecordPaymentModalProps {
  show: boolean;
  payment: PendingPayment | null;
  payForm: { amount: number; paymentMethod: string; notes: string; paidDate: string };
  onPayFormChange: (form: { amount: number; paymentMethod: string; notes: string; paidDate: string }) => void;
  onClose: () => void;
  onSubmit: () => void;
  isPending: boolean;
  slipFileRef: React.RefObject<HTMLInputElement | null>;
  onSlipScan: (e: React.ChangeEvent<HTMLInputElement>) => void;
  ocrSlipLoading: boolean;
  slipResult: OcrPaymentSlipResult | null;
}

export function RecordPaymentModal({
  show,
  payment,
  payForm,
  onPayFormChange,
  onClose,
  onSubmit,
  isPending,
  slipFileRef,
  onSlipScan,
  ocrSlipLoading,
  slipResult,
}: RecordPaymentModalProps) {
  if (!show || !payment) return null;

  // (Audit finding P0) Outstanding pre-fills the cashier's input field. JS float
  // arithmetic on Decimal-string fields could leave 1499.999... where the
  // backend stores 1500.00, causing the cashier to submit the wrong amount.
  // Compute via decimal.js then expose as numbers for the existing JSX.
  const amountDueD = new Decimal(payment.amountDue);
  const amountPaidD = new Decimal(payment.amountPaid);
  const lateFeeD = new Decimal(payment.lateFee);
  const outstandingD = amountDueD.add(lateFeeD).sub(amountPaidD).toDecimalPlaces(2);

  const amountDue = amountDueD.toNumber();
  const amountPaid = amountPaidD.toNumber();
  const lateFee = lateFeeD.toNumber();
  const outstanding = outstandingD.toNumber();

  // Breakdown
  const principalD = payment.monthlyPrincipal ? new Decimal(payment.monthlyPrincipal) : null;
  const interestD = payment.monthlyInterest ? new Decimal(payment.monthlyInterest) : null;
  const commissionD = payment.monthlyCommission ? new Decimal(payment.monthlyCommission) : null;
  const vatD = payment.vatAmount ? new Decimal(payment.vatAmount) : null;
  const hasBreakdown = principalD !== null;
  const subtotalD = hasBreakdown
    ? principalD!
        .add(interestD ?? 0)
        .add(commissionD ?? 0)
        .toDecimalPlaces(2)
    : null;
  const principal = principalD?.toNumber() ?? null;
  const interest = interestD?.toNumber() ?? null;
  const commission = commissionD?.toNumber() ?? null;
  const vat = vatD?.toNumber() ?? null;
  const subtotal = subtotalD?.toNumber() ?? null;

  // Summary
  const received = payForm.amount;
  const change = new Decimal(received).sub(outstandingD).toDecimalPlaces(2).toNumber();

  const inputClass = 'w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden';

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-start justify-center pt-8 pb-8">
      <div className="w-full max-w-2xl bg-background rounded-xl shadow-2xl overflow-y-auto max-h-[calc(100vh-4rem)]">
        {/* Sticky Header */}
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-xs border-b px-6 py-4 flex items-center justify-between">
          <button onClick={onClose} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            ← กลับ
          </button>
          <h2 className="text-lg font-semibold text-foreground">บันทึกการรับชำระ</h2>
          <div className="w-16" />
        </div>

        <div className="p-6 space-y-5">
          {/* Section 1: ข้อมูลสัญญา */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary">
                <svg xmlns="http://www.w3.org/2000/svg" className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15" /></svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">ข้อมูลสัญญา</h3>
                <p className="text-xs text-muted-foreground">สัญญา, ลูกค้า, งวดที่ชำระ</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <div><span className="text-muted-foreground">สัญญา: </span><span className="font-mono font-semibold">{payment.contract.contractNumber}</span></div>
              <div><span className="text-muted-foreground">ลูกค้า: </span><span className="font-medium">{payment.contract.customer.name}</span></div>
              <div><span className="text-muted-foreground">งวดที่: </span><span className="font-medium">{payment.installmentNo}</span></div>
              <div><span className="text-muted-foreground">ครบกำหนด: </span><span className="font-medium">{formatThaiDate(payment.dueDate)}</span></div>
              {payment.contract.branch && <div><span className="text-muted-foreground">สาขา: </span><span className="font-medium">{payment.contract.branch.name}</span></div>}
            </div>
          </div>

          {/* Section 2: ยอดค่างวด */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary">
                <svg xmlns="http://www.w3.org/2000/svg" className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75" /></svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">ยอดค่างวด</h3>
                <p className="text-xs text-muted-foreground">รายละเอียดยอดชำระ</p>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              {hasBreakdown ? (
                <>
                  <div className="flex justify-between"><span className="text-muted-foreground">เงินต้น + ดอกเบี้ย + ค่าคอม</span><span className="font-medium">{subtotal?.toLocaleString()} ฿</span></div>
                  {vat !== null && vat > 0 && <div className="flex justify-between"><span className="text-muted-foreground">VAT 7%</span><span className="font-medium">{vat.toLocaleString()} ฿</span></div>}
                </>
              ) : (
                <div className="flex justify-between"><span className="text-muted-foreground">ยอดค่างวด</span><span className="font-medium">{amountDue.toLocaleString()} ฿</span></div>
              )}
              {lateFee > 0 && (
                <div className="flex justify-between text-destructive"><span>ค่าปรับล่าช้า</span><span className="font-medium">+{lateFee.toLocaleString()} ฿</span></div>
              )}
              {amountPaid > 0 && (
                <div className="flex justify-between text-success"><span>ชำระแล้ว</span><span className="font-medium">-{amountPaid.toLocaleString()} ฿</span></div>
              )}
              <div className="border-t border-border pt-2.5 mt-1 flex justify-between font-bold text-lg">
                <span className="text-primary">ยอดคงค้าง</span><span className="text-primary">{outstanding.toLocaleString()} ฿</span>
              </div>
            </div>
          </div>

          {/* Section 3: สแกนสลิป */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex items-center justify-center size-8 rounded-lg bg-success/10 text-success">
                <svg xmlns="http://www.w3.org/2000/svg" className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" /><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" /></svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">สแกนสลิป</h3>
                <p className="text-xs text-muted-foreground">ถ่ายรูปสลิปเพื่อกรอกข้อมูลอัตโนมัติ</p>
              </div>
            </div>
            <SlipScannerSection
              title="สแกนสลิปโอนเงิน (OCR)"
              description="ถ่ายรูปสลิปเพื่อกรอกข้อมูลอัตโนมัติ"
              fileRef={slipFileRef}
              onScan={onSlipScan}
              loading={ocrSlipLoading}
              result={slipResult}
            />
          </div>

          {/* Section 4: บันทึกการชำระ */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex items-center justify-center size-8 rounded-lg bg-warning/10 text-warning">
                <svg xmlns="http://www.w3.org/2000/svg" className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" /></svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">บันทึกการชำระ</h3>
                <p className="text-xs text-muted-foreground">จำนวนเงิน, วันที่, วิธีชำระ</p>
              </div>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">จำนวนเงินที่รับ <span className="text-destructive">*</span></label>
                  <input type="number" value={payForm.amount} onChange={(e) => onPayFormChange({ ...payForm, amount: Number(e.target.value) })} className={inputClass} min={0} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">วันที่ชำระ</label>
                  <input type="date" value={payForm.paidDate} onChange={(e) => onPayFormChange({ ...payForm, paidDate: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">วิธีชำระ</label>
                  <select value={payForm.paymentMethod} onChange={(e) => onPayFormChange({ ...payForm, paymentMethod: e.target.value })} className={inputClass}>
                    <option value="CASH">เงินสด</option>
                    <option value="BANK_TRANSFER">โอนเงิน</option>
                    <option value="QR_EWALLET">QR/E-Wallet</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">หมายเหตุ</label>
                <input type="text" value={payForm.notes} onChange={(e) => onPayFormChange({ ...payForm, notes: e.target.value })} className={inputClass} placeholder="หมายเหตุเพิ่มเติม (ถ้ามี)" />
              </div>

              {/* Summary box */}
              {received > 0 && (
                <div className="bg-linear-to-br from-primary/5 to-primary/10 dark:from-primary/10 dark:to-primary/15 rounded-xl p-4 space-y-2 text-sm border border-primary/15">
                  <div className="flex justify-between"><span className="text-muted-foreground">ยอดคงค้าง</span><span className="font-medium">{outstanding.toLocaleString()} ฿</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">จำนวนที่รับ</span><span className="font-medium">{received.toLocaleString()} ฿</span></div>
                  <div className="border-t border-primary/20 pt-2.5 mt-1 flex justify-between font-bold text-lg">
                    {change >= 0 ? (
                      <><span className="text-success">เงินทอน/เงินเกิน</span><span className="text-success">{change.toLocaleString()} ฿</span></>
                    ) : (
                      <><span className="text-warning">ยอดค้างเหลือ</span><span className="text-warning">{Math.abs(change).toLocaleString()} ฿</span></>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Sticky Footer */}
        <div className="sticky bottom-0 bg-background/95 backdrop-blur-xs border-t px-6 py-4 flex justify-end gap-3">
          <button onClick={onClose} className="px-6 py-2.5 text-sm border border-input rounded-lg hover:bg-muted transition-colors">ยกเลิก</button>
          <button onClick={onSubmit} disabled={isPending || payForm.amount <= 0} className="px-6 py-2.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 font-semibold transition-colors shadow-sm">
            {isPending ? 'กำลังบันทึก...' : 'ยืนยันรับชำระ'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Batch Payment Modal ─── */
interface BatchPaymentModalProps {
  show: boolean;
  onClose: () => void;
  batchSelectedPayments: PendingPayment[];
  batchTotal: number;
  batchPayMethod: string;
  onBatchPayMethodChange: (method: string) => void;
  onSubmit: () => void;
  isPending: boolean;
  batchSlipFileRef: React.RefObject<HTMLInputElement | null>;
  onBatchSlipScan: (e: React.ChangeEvent<HTMLInputElement>) => void;
  batchOcrLoading: boolean;
  batchSlipResult: OcrPaymentSlipResult | null;
}

export function BatchPaymentModal({
  show,
  onClose,
  batchSelectedPayments,
  batchTotal,
  batchPayMethod,
  onBatchPayMethodChange,
  onSubmit,
  isPending,
  batchSlipFileRef,
  onBatchSlipScan,
  batchOcrLoading,
  batchSlipResult,
}: BatchPaymentModalProps) {
  if (!show) return null;

  return (
    <Modal isOpen title={`รับชำระรวม ${batchSelectedPayments.length} รายการ`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="bg-muted rounded-lg p-4 space-y-2 max-h-48 overflow-y-auto">
          {batchSelectedPayments.map(p => {
            const remaining = parseFloat(p.amountDue) + parseFloat(p.lateFee) - parseFloat(p.amountPaid);
            return (
              <div key={p.id} className="flex justify-between text-sm">
                <span>{p.contract.contractNumber} งวด {p.installmentNo}</span>
                <span className="font-medium">{remaining.toLocaleString()} ฿</span>
              </div>
            );
          })}
        </div>
        <div className="flex justify-between text-base font-bold border-t pt-3">
          <span>ยอดรวม</span>
          <span className="text-primary">{Math.round(batchTotal).toLocaleString()} ฿</span>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">วิธีชำระ</label>
          <select value={batchPayMethod} onChange={(e) => onBatchPayMethodChange(e.target.value)} className="w-full px-3 py-2 border border-input rounded-lg text-sm">
            <option value="CASH">เงินสด</option>
            <option value="BANK_TRANSFER">โอนเงิน</option>
            <option value="QR_EWALLET">QR/E-Wallet</option>
          </select>
        </div>

        {isSlipRequired(batchPayMethod) && (
          <SlipScannerSection
            title="แนบสลิปโอนเงิน"
            description="กรุณาแนบสลิปเพื่อยืนยันการชำระ"
            fileRef={batchSlipFileRef}
            onScan={onBatchSlipScan}
            loading={batchOcrLoading}
            result={batchSlipResult}
            required
          />
        )}

        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 px-4 py-2 text-sm border border-input rounded-lg">ยกเลิก</button>
          <button onClick={onSubmit} disabled={isPending || (isSlipRequired(batchPayMethod) && !batchSlipResult)} className="flex-1 px-4 py-2 text-sm bg-success text-success-foreground rounded-lg hover:bg-success/90 disabled:opacity-50">
            {isPending ? 'กำลังชำระ...' : `ยืนยันชำระ ${batchSelectedPayments.length} รายการ`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ─── Advance Payment Modal ─── */
interface AdvancePaymentModalProps {
  show: boolean;
  contract: PendingPayment | null;
  onClose: () => void;
  advanceAmount: string;
  onAdvanceAmountChange: (amount: string) => void;
  advanceMethod: string;
  onAdvanceMethodChange: (method: string) => void;
  onSubmit: () => void;
  isPending: boolean;
  advanceSlipFileRef: React.RefObject<HTMLInputElement | null>;
  onAdvanceSlipScan: (e: React.ChangeEvent<HTMLInputElement>) => void;
  advanceOcrLoading: boolean;
  advanceSlipResult: OcrPaymentSlipResult | null;
}

export function AdvancePaymentModal({
  show,
  contract,
  onClose,
  advanceAmount,
  onAdvanceAmountChange,
  advanceMethod,
  onAdvanceMethodChange,
  onSubmit,
  isPending,
  advanceSlipFileRef,
  onAdvanceSlipScan,
  advanceOcrLoading,
  advanceSlipResult,
}: AdvancePaymentModalProps) {
  if (!show || !contract) return null;

  return (
    <Modal isOpen title="จ่ายล่วงหน้าหลายงวด" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="bg-muted rounded-lg p-4">
          <div className="text-sm"><span className="text-muted-foreground">สัญญา: </span><span className="font-mono font-medium">{contract.contract.contractNumber}</span></div>
          <div className="text-sm"><span className="text-muted-foreground">ลูกค้า: </span>{contract.contract.customer.name}</div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">จำนวนเงินรวมที่ต้องการจ่าย</label>
          <input type="number" value={advanceAmount} onChange={(e) => onAdvanceAmountChange(e.target.value)} className="w-full px-3 py-2 border border-input rounded-lg text-sm" placeholder="ใส่ยอดรวม ระบบจะจัดสรรให้หลายงวดอัตโนมัติ" />
          <p className="text-xs text-muted-foreground mt-1">ระบบจะจัดสรรเงินให้งวดที่ค้างตามลำดับอัตโนมัติ</p>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">วิธีชำระ</label>
          <select value={advanceMethod} onChange={(e) => onAdvanceMethodChange(e.target.value)} className="w-full px-3 py-2 border border-input rounded-lg text-sm">
            <option value="CASH">เงินสด</option>
            <option value="BANK_TRANSFER">โอนเงิน</option>
            <option value="QR_EWALLET">QR/E-Wallet</option>
          </select>
        </div>

        {isSlipRequired(advanceMethod) && (
          <SlipScannerSection
            title="แนบสลิปโอนเงิน"
            description="กรุณาแนบสลิปเพื่อยืนยันการชำระ"
            fileRef={advanceSlipFileRef}
            onScan={onAdvanceSlipScan}
            loading={advanceOcrLoading}
            result={advanceSlipResult}
            required
          />
        )}

        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 px-4 py-2 text-sm border border-input rounded-lg">ยกเลิก</button>
          <button
            onClick={() => {
              if (isSlipRequired(advanceMethod) && !advanceSlipResult) {
                toast.error('กรุณาแนบสลิปก่อนยืนยันการชำระ');
                return;
              }
              onSubmit();
            }}
            disabled={isPending || !advanceAmount || parseFloat(advanceAmount) <= 0 || (isSlipRequired(advanceMethod) && !advanceSlipResult)}
            className="flex-1 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending ? 'กำลังจัดสรร...' : 'ยืนยันจ่ายล่วงหน้า'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
