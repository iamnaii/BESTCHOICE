import type { OcrPaymentSlipResult } from './hooks/usePaymentOcr';

const slipTypeLabels: Record<string, string> = {
  BANK_TRANSFER: 'โอนเงิน',
  QR_PAYMENT: 'QR Payment',
  PROMPTPAY: 'พร้อมเพย์',
  OTHER: 'อื่นๆ',
};

interface SlipScannerProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fileRef: any;
  loading: boolean;
  result: OcrPaymentSlipResult | null;
  onScan: (e: React.ChangeEvent<HTMLInputElement>) => void;
  required?: boolean;
  showDetails?: boolean;
}

export default function SlipScanner({ fileRef, loading, result, onScan, required, showDetails = true }: SlipScannerProps) {
  return (
    <div className="bg-green-50 border border-green-200 rounded-lg p-3">
      <div className="flex items-center justify-between mb-1">
        <h4 className="text-sm font-semibold text-green-800">
          {required ? <>แนบสลิปโอนเงิน <span className="text-red-500">*</span></> : 'สแกนสลิปโอนเงิน (OCR)'}
        </h4>
      </div>
      <p className="text-xs text-green-600 mb-2">
        {required ? 'กรุณาแนบสลิปเพื่อยืนยันการชำระ' : 'ถ่ายรูปสลิปเพื่อกรอกข้อมูลอัตโนมัติ'}
      </p>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onScan} className="hidden" />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={loading}
        className="inline-flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 disabled:opacity-50"
      >
        {loading ? (
          <><div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white" /> กำลังอ่านสลิป...</>
        ) : (
          <><svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg> สแกนสลิป</>
        )}
      </button>

      {result && showDetails && (
        <div className="mt-2 p-2 rounded border border-green-200 space-y-1">
          <div className="text-xs text-muted-foreground">ผลการสแกน:</div>
          {result.amount && <div className="text-xs"><span className="text-muted-foreground">จำนวนเงิน:</span> <span className="font-bold text-green-700">{result.amount.toLocaleString()} ฿</span></div>}
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
