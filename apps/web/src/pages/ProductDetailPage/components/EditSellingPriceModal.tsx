import { NumberInput } from '@/components/ui/NumberInput';
import Modal from '@/components/ui/Modal';
import { useId as useUiFieldId } from 'react';
import type { SellingPriceFormValues } from '../utils/buildSellingPricePayload';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  values: SellingPriceFormValues;
  onChange: (next: SellingPriceFormValues) => void;
  onSubmit: (e: React.FormEvent) => void;
  isPending: boolean;
}

export default function EditSellingPriceModal({ isOpen, onClose, values, onChange, onSubmit, isPending }: Props) {
  const uiFieldId = useUiFieldId();
  const set = (patch: Partial<SellingPriceFormValues>) =>
    onChange({
      cashPrice: values.cashPrice,
      installmentPrice: values.installmentPrice,
      financePrice: values.financePrice ?? '',
      ...patch,
    });
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="แก้ราคาขาย">
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor={`${uiFieldId}-1`} className="block text-sm font-medium text-foreground mb-1 leading-snug">
            ราคาเงินสด (บาท)
          </label>
          <NumberInput unstyled id={`${uiFieldId}-1`}
            step="0.01"
            min="1"
            value={values.cashPrice}
            onChange={(e) => set({ cashPrice: e.target.value })}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm"
          />
        </div>
        <div>
          <label htmlFor={`${uiFieldId}-2`} className="block text-sm font-medium text-foreground mb-1 leading-snug">
            ราคาผ่อน — ราคาตั้งต้นสำหรับคำนวณค่างวด (บาท)
          </label>
          <NumberInput unstyled id={`${uiFieldId}-2`}
            step="0.01"
            min="1"
            value={values.installmentPrice}
            onChange={(e) => set({ installmentPrice: e.target.value })}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm"
          />
        </div>
        <div>
          <label htmlFor={`${uiFieldId}-3`} className="block text-sm font-medium text-foreground mb-1 leading-snug">
            ราคาขาย GFIN (บาท)
          </label>
          <NumberInput unstyled id={`${uiFieldId}-3`}
            step="0.01"
            min="1"
            value={values.financePrice ?? ''}
            aria-describedby={`${uiFieldId}-3-hint`}
            onChange={(e) => set({ financePrice: e.target.value })}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm"
          />
          <p id={`${uiFieldId}-3-hint`} className="mt-1 text-xs text-muted-foreground leading-snug">
            ราคาที่ใช้คิดผ่อน GFIN (เรท 2) · ว่างอยู่ = ใช้ราคาผ่อน BESTCHOICE · ลบตัวเลขออกแล้วบันทึก = ล้างราคาขาย GFIN
          </p>
        </div>
        <p className="text-xs text-muted-foreground leading-snug">
          ราคานี้คือแหล่งเดียวที่เว็บลูกค้า/บอท/เครื่องคิดค่างวดใช้ — ราคาเงินสดและราคาผ่อนเว้นว่าง = ไม่แก้ไขค่านั้น
        </p>
        <div className="flex justify-end gap-3 pt-2">
          <button data-ui-control="button" type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground">
            ยกเลิก
          </button>
          <button data-ui-control="button"
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
