import { useState } from 'react';
import { PackageCheck } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

interface Props {
  /** สถานะจริงของสินค้า — ปุ่มโผล่เฉพาะ REFURBISHED (ตรงกับ guard ฝั่ง API) */
  status: string;
  /** OWNER / BRANCH_MANAGER เท่านั้น (ตรงกับ @Roles ของ POST /products/:id/return-to-stock) */
  canManage: boolean;
  isPending: boolean;
  onConfirm: (note?: string) => void;
}

/**
 * Phase 5 Task 3 — ปุ่ม "นำเข้าคลังพร้อมขาย" (REFURBISHED → IN_STOCK)
 *
 * คำตัดสินเจ้าของ 2026-08-21: หน้าร้านกดยืนยันเอง ไม่ให้ POS ขายจาก REFURBISHED ตรง ๆ
 * เพราะมีจังหวะตรวจสภาพ/ตั้งราคาก่อน — ปุ่มนี้คือจุดที่บันทึกว่าใครเป็นคนตัดสิน
 *
 * ตัวคอมโพเนนต์เป็น presentational ล้วน (ไม่มี mutation ในตัว) — หน้า ProductDetailPage
 * เป็นเจ้าของ mutation + invalidateQueries เหมือน action อื่นบนหน้าเดียวกัน
 */
export default function ReturnToStockAction({ status, canManage, isPending, onConfirm }: Props) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');

  if (!canManage || status !== 'REFURBISHED') return null;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setNote('');
          setOpen(true);
        }}
        className="inline-flex items-center gap-1.5 px-4 py-2 text-sm text-primary border border-input rounded-lg hover:bg-muted/50 leading-snug min-h-11"
      >
        <PackageCheck className="size-4" aria-hidden />
        นำเข้าคลังพร้อมขาย
      </button>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="นำเข้าคลังพร้อมขาย"
        description="ยืนยันว่าตรวจสภาพและตั้งราคาเรียบร้อยแล้ว — เครื่องจะพร้อมขายที่ POS ทันทีหลังกดยืนยัน และระบบจะบันทึกว่าใครเป็นผู้ยืนยัน"
        confirmLabel="ยืนยันนำเข้าคลัง"
        loading={isPending}
        onConfirm={() => onConfirm(note.trim() || undefined)}
      >
        <div className="space-y-1">
          <label
            htmlFor="return-to-stock-note"
            className="block text-xs font-medium text-foreground leading-snug"
          >
            หมายเหตุ (ไม่บังคับ)
          </label>
          <textarea
            id="return-to-stock-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="เช่น ตรวจสภาพแล้ว เปลี่ยนแบตใหม่"
            className="w-full px-3 py-2 border border-input rounded-lg text-sm leading-snug bg-background"
          />
        </div>
      </ConfirmDialog>
    </>
  );
}
