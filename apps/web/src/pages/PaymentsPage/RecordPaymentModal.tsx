/* eslint-disable @typescript-eslint/no-explicit-any */
import Modal from '@/components/ui/Modal';
import SlipScanner from './SlipScanner';
import { usePaymentOcr } from './hooks/usePaymentOcr';
import { useState, useEffect } from 'react';

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

interface RecordPaymentModalProps {
  payment: PendingPayment;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
  isPending: boolean;
}

export default function RecordPaymentModal({ payment, onClose, onSubmit, isPending }: RecordPaymentModalProps) {
  const remaining = parseFloat(payment.amountDue) + parseFloat(payment.lateFee) - parseFloat(payment.amountPaid);
  const [payForm, setPayForm] = useState({ amount: Math.round(remaining * 100) / 100, paymentMethod: 'CASH', notes: '' });

  const ocr = usePaymentOcr((data) => {
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
  });

  useEffect(() => {
    setPayForm({ amount: Math.round(remaining * 100) / 100, paymentMethod: 'CASH', notes: '' });
    ocr.reset();
  }, [payment.id]);

  const handlePay = () => {
    if (payForm.amount <= 0) return;
    if (payForm.amount > Math.round(remaining * 100) / 100) return;
    onSubmit({
      contractId: payment.contract.id,
      installmentNo: payment.installmentNo,
      amount: payForm.amount,
      paymentMethod: payForm.paymentMethod,
      notes: payForm.notes || undefined,
      transactionRef: ocr.result?.transactionRef || `${payForm.paymentMethod}-${Date.now()}`,
    });
  };

  return (
    <Modal isOpen title="บันทึกการรับชำระ" onClose={onClose}>
      <div className="flex flex-col gap-5 lg:gap-7.5">
        <div className="bg-muted rounded-lg p-4">
          <div className="text-sm"><span className="text-muted-foreground">สัญญา: </span><span className="font-mono font-medium">{payment.contract.contractNumber}</span></div>
          <div className="text-sm"><span className="text-muted-foreground">ลูกค้า: </span>{payment.contract.customer.name}</div>
          <div className="text-sm"><span className="text-muted-foreground">งวดที่: </span>{payment.installmentNo}</div>
          <div className="text-sm mt-2">
            <span className="text-muted-foreground">ยอดคงค้าง: </span>
            <span className="font-bold text-lg">{remaining.toLocaleString()} ฿</span>
          </div>
          {parseFloat(payment.lateFee) > 0 && (
            <div className="text-xs text-red-600 mt-1">รวมค่าปรับ {parseFloat(payment.lateFee).toLocaleString()} ฿</div>
          )}
        </div>

        <SlipScanner fileRef={ocr.fileRef} loading={ocr.loading} result={ocr.result} onScan={ocr.handleScan} />

        <div>
          <label className="block text-sm font-medium text-foreground mb-1">จำนวนเงินที่รับ</label>
          <input type="number" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: Number(e.target.value) })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" min={0} />
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
          <input type="text" value={payForm.notes} onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
        </div>

        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 px-4 py-2 text-sm border border-input rounded-lg">ยกเลิก</button>
          <button onClick={handlePay} disabled={isPending || payForm.amount <= 0} className="flex-1 px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
            {isPending ? 'กำลังบันทึก...' : 'ยืนยันรับชำระ'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
