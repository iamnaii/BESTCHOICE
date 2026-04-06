import Modal from '@/components/ui/Modal';
import { formatNumber } from '@/utils/formatters';

interface EarlyPayoffQuote {
  remainingMonths: number;
  remainingPrincipal: number;
  remainingInterest: number;
  discount: number;
  unpaidLateFees: number;
  totalPayoff: number;
}

interface ContractEarlyPayoffQuoteProps {
  payoffQuote: EarlyPayoffQuote;
  contractStatus: string;
}

/** Displays the early payoff quote summary card */
export function ContractEarlyPayoffQuote({ payoffQuote, contractStatus }: ContractEarlyPayoffQuoteProps) {
  if (!['ACTIVE', 'OVERDUE', 'DEFAULT'].includes(contractStatus)) return null;

  return (
    <div className="bg-primary/5 rounded-xl border border-primary/20 p-6 mb-6 shadow-sm">
      <h2 className="text-lg font-semibold text-primary mb-3">ประเมินปิดก่อนกำหนด</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div><div className="text-xs text-primary">งวดคงเหลือ</div><div className="font-medium">{payoffQuote.remainingMonths} งวด</div></div>
        <div><div className="text-xs text-primary">เงินต้นคงเหลือ</div><div className="font-medium">{formatNumber(payoffQuote.remainingPrincipal)} บาท</div></div>
        <div><div className="text-xs text-primary">ดอกเบี้ยคงเหลือ</div><div className="font-medium">{formatNumber(payoffQuote.remainingInterest)} บาท</div></div>
        <div><div className="text-xs text-success">ส่วนลดดอกเบี้ย (50%)</div><div className="font-medium text-success">-{formatNumber(payoffQuote.discount)} บาท</div></div>
        {payoffQuote.unpaidLateFees > 0 && <div><div className="text-xs text-destructive">ค่าปรับค้างชำระ</div><div className="font-medium text-destructive">{formatNumber(payoffQuote.unpaidLateFees)} บาท</div></div>}
        <div><div className="text-xs text-primary font-semibold">ยอดปิดสัญญา</div><div className="text-xl font-bold text-primary">{formatNumber(payoffQuote.totalPayoff)} บาท</div></div>
      </div>
    </div>
  );
}

interface ContractEarlyPayoffModalProps {
  payoffQuote: EarlyPayoffQuote;
  payoffMethod: string;
  onPayoffMethodChange: (method: string) => void;
  onConfirm: () => void;
  onClose: () => void;
  isPending: boolean;
}

/** Modal for confirming early payoff */
export function ContractEarlyPayoffModal({
  payoffQuote,
  payoffMethod,
  onPayoffMethodChange,
  onConfirm,
  onClose,
  isPending,
}: ContractEarlyPayoffModalProps) {
  return (
    <Modal isOpen title="ปิดสัญญาก่อนกำหนด" onClose={onClose}>
      <div className="space-y-4">
        <div className="bg-primary/5 rounded-lg p-4">
          <div className="text-sm">ยอดที่ต้องชำระ</div>
          <div className="text-2xl font-bold text-primary">{formatNumber(payoffQuote.totalPayoff)} บาท</div>
          <div className="text-xs text-primary mt-1">(รวมส่วนลดดอกเบี้ย 50% แล้ว)</div>
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">วิธีชำระ</label>
          <select value={payoffMethod} onChange={(e) => onPayoffMethodChange(e.target.value)} className="w-full px-3 py-2 border border-input rounded-lg text-sm">
            <option value="CASH">เงินสด</option>
            <option value="BANK_TRANSFER">โอนเงิน</option>
            <option value="QR_EWALLET">QR/E-Wallet</option>
          </select>
        </div>
        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 px-4 py-2 text-sm border border-input rounded-lg">ยกเลิก</button>
          <button onClick={onConfirm} disabled={isPending} className="flex-1 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50">
            {isPending ? 'กำลังปิด...' : 'ยืนยันปิดสัญญา'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
