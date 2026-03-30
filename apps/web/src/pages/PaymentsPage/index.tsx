import { useState } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import PaymentHistorySheet from '@/components/payment/PaymentHistorySheet';
import ReceiptModal from '@/components/payment/ReceiptModal';
import PendingPaymentsTab from './PendingPaymentsTab';
import PaymentSummaryTab from './PaymentSummaryTab';

export default function PaymentsPage() {
  const [tab, setTab] = useState<'pending' | 'summary'>('pending');
  const [historyContractId, setHistoryContractId] = useState<string | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);

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

      {tab === 'pending' && <PendingPaymentsTab onViewHistory={setHistoryContractId} />}
      {tab === 'summary' && <PaymentSummaryTab />}

      <PaymentHistorySheet contractId={historyContractId} onClose={() => setHistoryContractId(null)} onViewReceipt={(id) => setReceiptId(id)} />
      <ReceiptModal receiptId={receiptId} onClose={() => setReceiptId(null)} />
    </div>
  );
}
