import { useState } from 'react';
import { PackageCheck } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

export interface ReturnToStockPayload {
  cashPrice?: number;
  installmentPrice?: number;
  note?: string;
}

interface Props {
  /** สถานะจริงของสินค้า — ปุ่มโผล่เฉพาะ REFURBISHED (ตรงกับ guard ฝั่ง API) */
  status: string;
  /** OWNER / BRANCH_MANAGER เท่านั้น (ตรงกับ @Roles ของ POST /products/:id/return-to-stock) */
  canManage: boolean;
  isPending: boolean;
  /** ราคาที่ค้างอยู่บนเครื่อง = ราคาจากตอนขายครั้งก่อน (ไม่มี flow ไหนล้างให้) */
  currentCashPrice: number | null;
  currentInstallmentPrice: number | null;
  onConfirm: (payload: ReturnToStockPayload) => void;
}

/** '' / ค่าที่ไม่ใช่ตัวเลข / ≤ 0 → undefined (ถือว่า "ไม่ระบุ") */
function parsePrice(raw: string): number | undefined {
  const n = Number(raw.replace(/,/g, '').trim());
  return raw.trim() !== '' && Number.isFinite(n) && n > 0 ? n : undefined;
}

const priceText = (v: number | null) => (v != null && v > 0 ? String(v) : '');

/**
 * Phase 5 Task 3 — ปุ่ม "นำเข้าคลังพร้อมขาย" (REFURBISHED → IN_STOCK)
 *
 * คำตัดสินเจ้าของ 2026-08-21: หน้าร้านกดยืนยันเอง ไม่ให้ POS ขายจาก REFURBISHED ตรง ๆ
 * เพราะมีจังหวะตรวจสภาพ/ตั้งราคาก่อน — ปุ่มนี้คือจุดที่บันทึกว่าใครเป็นคนตัดสิน
 *
 * Fix round 1 [Important 2]: dialog **บังคับให้ราคาผ่านตาคน** — เครื่องที่คืนมาจาก
 * เปลี่ยนเครื่อง/ยึดยังถือราคาเครื่องใหม่ค้างอยู่เสมอ (ไม่มี flow ไหนล้างคอลัมน์ราคา)
 * ⇒ เติมราคาปัจจุบันให้พร้อมป้ายว่าเป็น "ราคาจากตอนขายครั้งก่อน" กดยืนยันโดยไม่แก้ก็ได้
 * แต่ต้องเห็นมันก่อน และค่าที่กดยืนยันจะถูกเขียนทับลงเครื่องจริง (ไม่ใช่แค่ผ่านด่าน)
 *
 * ตัวคอมโพเนนต์เป็น presentational ล้วน (ไม่มี mutation ในตัว) — หน้า ProductDetailPage
 * เป็นเจ้าของ mutation + invalidateQueries เหมือน action อื่นบนหน้าเดียวกัน
 */
export default function ReturnToStockAction({
  status,
  canManage,
  isPending,
  currentCashPrice,
  currentInstallmentPrice,
  onConfirm,
}: Props) {
  const [open, setOpen] = useState(false);
  const [cash, setCash] = useState('');
  const [installment, setInstallment] = useState('');
  const [note, setNote] = useState('');

  if (!canManage || status !== 'REFURBISHED') return null;

  const cashValue = parsePrice(cash);
  const installmentValue = parsePrice(installment);
  const hasPrice = cashValue !== undefined || installmentValue !== undefined;
  const hadCash = currentCashPrice != null && currentCashPrice > 0;
  const hadInstallment = currentInstallmentPrice != null && currentInstallmentPrice > 0;
  const hadPreviousPrice = hadCash || hadInstallment;

  /**
   * Fix round 2 [Important 2]: ช่องที่ "เคยมีราคา" แล้วถูกล้างจนว่าง = ราคาเก่าจะค้างอยู่ใน
   * คอลัมน์นั้นและยังเป็นแถวราคาตั้งต้นที่ POS อ่าน — server ปฏิเสธเคสนี้ ฝั่งนี้จึงบอกก่อน
   * ตั้งแต่ยังไม่กด (endpoint นี้ "ยืนยันราคา" ไม่ใช่ "ล้างราคา" — ล้างทำที่หน้าแก้ราคาขาย)
   */
  const unconfirmed = [
    hadCash && cashValue === undefined ? 'ราคาเงินสด' : null,
    hadInstallment && installmentValue === undefined ? 'ราคาผ่อน' : null,
  ].filter(Boolean) as string[];

  const inputClass =
    'w-full px-3 py-2 border border-input rounded-lg text-sm leading-snug bg-background';

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setCash(priceText(currentCashPrice));
          setInstallment(priceText(currentInstallmentPrice));
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
        description="ยืนยันว่าตรวจสภาพและราคาเรียบร้อยแล้ว — เครื่องจะพร้อมขายที่ POS ทันทีหลังกดยืนยัน และระบบจะบันทึกว่าใครยืนยันราคาเท่าไร"
        confirmLabel="ยืนยันนำเข้าคลัง"
        loading={isPending}
        confirmDisabled={!hasPrice || unconfirmed.length > 0}
        onConfirm={() =>
          onConfirm({
            cashPrice: cashValue,
            installmentPrice: installmentValue,
            note: note.trim() || undefined,
          })
        }
      >
        <div className="space-y-3">
          {hadPreviousPrice && (
            <p className="text-xs text-warning leading-snug">
              ราคาด้านล่างคือ ราคาจากตอนขายครั้งก่อน — เครื่องมือสองที่รับคืนมายังไม่เคยถูกตั้งราคาใหม่
              กรุณาตรวจก่อนยืนยัน
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label
                htmlFor="return-to-stock-cash"
                className="block text-xs font-medium text-foreground leading-snug"
              >
                ราคาเงินสด (บาท)
              </label>
              <input
                id="return-to-stock-cash"
                type="number"
                min={0}
                step="0.01"
                value={cash}
                onChange={(e) => setCash(e.target.value)}
                className={inputClass}
              />
            </div>
            <div className="space-y-1">
              <label
                htmlFor="return-to-stock-installment"
                className="block text-xs font-medium text-foreground leading-snug"
              >
                ราคาผ่อน (บาท)
              </label>
              <input
                id="return-to-stock-installment"
                type="number"
                min={0}
                step="0.01"
                value={installment}
                onChange={(e) => setInstallment(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
          {!hasPrice && (
            <p className="text-xs text-destructive leading-snug">
              ต้องระบุราคาอย่างน้อยหนึ่งช่อง (มากกว่า 0) ก่อนนำเข้าคลัง — เครื่องในคลังต้องขายที่ POS ได้ทันที
            </p>
          )}
          {hasPrice && unconfirmed.length > 0 && (
            <p className="text-xs text-destructive leading-snug">
              ต้องยืนยัน {unconfirmed.join(' และ ')} ด้วย — ปล่อยว่างไว้ราคาเดิม (ราคาจากตอนขายครั้งก่อน)
              จะยังค้างอยู่และกลายเป็นราคาตั้งต้นที่ POS; ถ้าต้องการยกเลิกราคานั้น ให้แก้ที่ &quot;แก้ราคาขาย&quot; ก่อน
            </p>
          )}
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
              className={inputClass}
            />
          </div>
        </div>
      </ConfirmDialog>
    </>
  );
}
