import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { OtherIncomeReverseReason } from '@/lib/otherIncome.types';

interface Props {
  docNumber: string;
  onCancel: () => void;
  onConfirm: (reason: OtherIncomeReverseReason, note: string) => void;
  isLoading?: boolean;
}

const REASONS: Array<{ value: OtherIncomeReverseReason; label: string }> = [
  { value: 'INPUT_ERROR', label: 'กรอกผิด — ลูกค้าผิด/ยอดผิด' },
  { value: 'CUSTOMER_REQUEST', label: 'ลูกค้าขอยกเลิก/คืนเงิน' },
  { value: 'DUPLICATE', label: 'บันทึกซ้ำ' },
  { value: 'WRONG_ACCOUNT', label: 'บัญชีผิด' },
  { value: 'WRONG_AMOUNT', label: 'ยอดเงินผิด' },
  { value: 'OTHER', label: 'อื่นๆ' },
];

export function ReverseModal({ docNumber, onCancel, onConfirm, isLoading }: Props) {
  const [reason, setReason] = useState<OtherIncomeReverseReason>('INPUT_ERROR');
  const [note, setNote] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-background rounded-2xl border-2 border-destructive max-w-2xl w-full p-6">
        <h3 className="text-lg font-bold flex items-center gap-2 text-destructive mb-3">
          <AlertTriangle size={20} /> สร้าง Reversing Entry
        </h3>
        <p className="text-sm mb-4">
          กลับรายการเอกสาร <span className="font-mono font-bold">{docNumber}</span> — ระบบจะสร้างเอกสารใหม่{' '}
          <span className="font-mono">{docNumber}-R</span> โดยสลับ Dr↔Cr อัตโนมัติ
        </p>
        <label className="text-xs font-semibold uppercase">ประเภทเหตุผล</label>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value as OtherIncomeReverseReason)}
          className="w-full border rounded-md px-3 py-2 text-sm mb-3"
        >
          {REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <label className="text-xs font-semibold uppercase">รายละเอียด (อย่างน้อย 5 ตัวอักษร)</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="เช่น ลูกค้าโทรมาแจ้งว่ายอดผิด ต้องเป็น 1,500 ฿ ไม่ใช่ 5,000 ฿"
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
        <div className="rounded-md p-3 mt-3 bg-orange-500/10 border border-orange-500 text-xs">
          <strong>การ Reverse ไม่สามารถยกเลิกได้</strong> —
          ทั้งเอกสารต้นฉบับและ Reversing Entry จะอยู่ในระบบถาวร
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onCancel}
            type="button"
            className="px-4 py-2 text-sm font-semibold rounded-md border"
          >
            ยกเลิก
          </button>
          <button
            onClick={() => onConfirm(reason, note)}
            disabled={note.trim().length < 5 || isLoading}
            className="px-5 py-2 text-sm font-bold rounded-md bg-destructive text-destructive-foreground disabled:opacity-50"
          >
            {isLoading ? 'กำลังกลับรายการ...' : 'ยืนยัน — สร้าง Reversing Entry'}
          </button>
        </div>
      </div>
    </div>
  );
}
