import { downFloorText, useKnownDownFloor } from '@/hooks/useDownFloor';

/**
 * แถบโปรบาง ๆ เหนือเมนูทุกหน้า (เจ้าของ 2026-11-27 ส่วน B3).
 * พื้นกรมท่า (ข้อมูล) ตัวขาว 15:1 · ตัวเลขดาวน์เป็นเหลืองโปร 9.9:1 — เหลืองสงวนให้โปรโมชัน.
 * ไม่ติดหน้าจอ: เลื่อนหายไปพร้อมหน้า ให้หัวเว็บที่ติดด้านบนกินที่เท่าเดิม.
 *
 * "ดาวน์เริ่ม …" เปลี่ยนเองตามสต๊อก (เจ้าของ 2026-11-27): มีเครื่องฟรีดาวน์ = 0 บาท · หมด = ดาวน์ต่ำสุดจริง
 * · ยังไม่รู้ (กำลังโหลด / API ล่ม) = ไม่แสดงส่วนนี้ — ไม่อ้างตัวเลขที่ไม่มีเครื่องรองรับ.
 * พาดหัวหน้าแรกและการ์ดจุดเด่นใช้ยอดชุดเดียวกัน (useKnownDownFloor).
 * `data-down-floor` (= DOWN_FLOOR_ATTR) = ยอดที่ snapshot เห็นตอน prerender — main.tsx อ่านกลับก่อน mount
 * (seedDownFloorFromSnapshot) ให้พาดหัวใหญ่ไม่กะพริบ · ไม่รู้ยอด = ไม่มี attribute
 */
export default function PromoBar() {
  const down = useKnownDownFloor();
  return (
    <div className="bg-primary text-primary-foreground" data-down-floor={down?.amount}>
      <p className="mx-auto max-w-7xl px-4 py-1.5 text-center font-head text-xs leading-snug sm:text-sm">
        {down && (
          <>
            <span className="font-bold text-promo">{downFloorText(down)}</span>
            <span aria-hidden="true"> · </span>
          </>
        )}
        <span className="whitespace-nowrap">บัตรประชาชนใบเดียว</span>
        <span aria-hidden="true"> · </span>
        <span className="whitespace-nowrap">รับเครื่องวันนี้</span>
      </p>
    </div>
  );
}
