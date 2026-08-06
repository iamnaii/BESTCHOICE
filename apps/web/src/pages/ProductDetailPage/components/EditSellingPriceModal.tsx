import Modal from '@/components/ui/Modal';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  cashPrice: string;
  installmentPrice: string;
  onChange: (next: { cashPrice: string; installmentPrice: string }) => void;
  onSubmit: (e: React.FormEvent) => void;
  isPending: boolean;
}

export default function EditSellingPriceModal({
  isOpen,
  onClose,
  cashPrice,
  installmentPrice,
  onChange,
  onSubmit,
  isPending,
}: Props) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="แก้ราคาขาย">
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1 leading-snug">
            ราคาเงินสด (บาท)
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={cashPrice}
            onChange={(e) => onChange({ cashPrice: e.target.value, installmentPrice })}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1 leading-snug">
            ราคาผ่อน — ราคาตั้งต้นสำหรับคำนวณค่างวด (บาท)
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={installmentPrice}
            onChange={(e) => onChange({ cashPrice, installmentPrice: e.target.value })}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm"
          />
        </div>
        <p className="text-xs text-muted-foreground leading-snug">
          ราคานี้คือแหล่งเดียวที่เว็บลูกค้า/บอท/เครื่องคิดค่างวดใช้ — เว้นว่างได้ถ้ายังไม่ตั้งราคา
        </p>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground">
            ยกเลิก
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
