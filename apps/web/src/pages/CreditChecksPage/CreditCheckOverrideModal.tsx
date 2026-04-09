import Modal from '@/components/ui/Modal';

interface CreditCheckOverrideModalProps {
  overrideStatus: string;
  onOverrideStatusChange: (v: string) => void;
  overrideNotes: string;
  onOverrideNotesChange: (v: string) => void;
  isPending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export default function CreditCheckOverrideModal({
  overrideStatus,
  onOverrideStatusChange,
  overrideNotes,
  onOverrideNotesChange,
  isPending,
  onConfirm,
  onClose,
}: CreditCheckOverrideModalProps) {
  return (
    <Modal isOpen title="ปรับแก้สถานะเครดิตเช็ค" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">สถานะใหม่</label>
          <select
            value={overrideStatus}
            onChange={(e) => onOverrideStatusChange(e.target.value)}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm"
          >
            <option value="">เลือกสถานะ...</option>
            <option value="APPROVED">อนุมัติ</option>
            <option value="REJECTED">ปฏิเสธ</option>
            <option value="MANUAL_REVIEW">ตรวจเพิ่มเติม</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">หมายเหตุ</label>
          <textarea
            value={overrideNotes}
            onChange={(e) => onOverrideNotesChange(e.target.value)}
            rows={2}
            placeholder="ระบุเหตุผล..."
            className="w-full px-3 py-2 border border-input rounded-lg text-sm"
          />
        </div>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 text-sm border border-input rounded-lg"
          >
            ยกเลิก
          </button>
          <button
            onClick={onConfirm}
            disabled={!overrideStatus || isPending}
            className="flex-1 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
