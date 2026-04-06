import type { UseMutationResult } from '@tanstack/react-query';
import Modal from '@/components/ui/Modal';
import { toast } from 'sonner';
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
        <h4 className="text-sm font-semibold text-success">{title} {required && <span className="text-red-500">*</span>}</h4>
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
        className="inline-flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 disabled:opacity-50"
      >
        {loading ? (
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
      {required && !result && <p className="text-xs text-red-500 mt-1">* จำเป็นต้องแนบสลิปสำหรับการโอนเงิน/QR</p>}
    </div>
  );
}

/* ─── Single Payment Modal ─── */
interface RecordPaymentModalProps {
  show: boolean;
  payment: PendingPayment | null;
  payForm: { amount: number; paymentMethod: string; notes: string };
  onPayFormChange: (form: { amount: number; paymentMethod: string; notes: string }) => void;
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

  return (
    <Modal isOpen title="บันทึกการรับชำระ" onClose={onClose}>
      <div className="flex flex-col gap-5 lg:gap-7.5">
        <div className="bg-muted rounded-lg p-4">
          <div className="text-sm"><span className="text-muted-foreground">สัญญา: </span><span className="font-mono font-medium">{payment.contract.contractNumber}</span></div>
          <div className="text-sm"><span className="text-muted-foreground">ลูกค้า: </span>{payment.contract.customer.name}</div>
          <div className="text-sm"><span className="text-muted-foreground">งวดที่: </span>{payment.installmentNo}</div>
          <div className="text-sm mt-2">
            <span className="text-muted-foreground">ยอดคงค้าง: </span>
            <span className="font-bold text-lg">{(parseFloat(payment.amountDue) + parseFloat(payment.lateFee) - parseFloat(payment.amountPaid)).toLocaleString()} ฿</span>
          </div>
          {parseFloat(payment.lateFee) > 0 && (
            <div className="text-xs text-destructive mt-1">รวมค่าปรับ {parseFloat(payment.lateFee).toLocaleString()} ฿</div>
          )}
        </div>

        <SlipScannerSection
          title="สแกนสลิปโอนเงิน (OCR)"
          description="ถ่ายรูปสลิปเพื่อกรอกข้อมูลอัตโนมัติ"
          fileRef={slipFileRef}
          onScan={onSlipScan}
          loading={ocrSlipLoading}
          result={slipResult}
        />

        <div>
          <label className="block text-sm font-medium text-foreground mb-1">จำนวนเงินที่รับ</label>
          <input
            type="number"
            value={payForm.amount}
            onChange={(e) => onPayFormChange({ ...payForm, amount: Number(e.target.value) })}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm"
            min={0}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-1">วิธีชำระ</label>
          <select value={payForm.paymentMethod} onChange={(e) => onPayFormChange({ ...payForm, paymentMethod: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm">
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
            onChange={(e) => onPayFormChange({ ...payForm, notes: e.target.value })}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm"
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 px-4 py-2 text-sm border border-input rounded-lg">ยกเลิก</button>
          <button onClick={onSubmit} disabled={isPending || payForm.amount <= 0} className="flex-1 px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
            {isPending ? 'กำลังบันทึก...' : 'ยืนยันรับชำระ'}
          </button>
        </div>
      </div>
    </Modal>
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
          <button onClick={onSubmit} disabled={isPending || (isSlipRequired(batchPayMethod) && !batchSlipResult)} className="flex-1 px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
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
