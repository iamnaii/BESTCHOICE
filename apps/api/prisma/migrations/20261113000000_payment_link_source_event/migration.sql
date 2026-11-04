-- Task 42 — หน้า /pay/:token เลิกเดาหัวยอดจากยอด: ลิงก์ AMOUNT จำว่ากฎทวงตามเหตุการณ์ตัวไหนสร้าง + วันนัดของลิงก์ยอดนัด
--   source_event = DEVICE_LOCKED          → หัว "ยอดค้างชำระ" · เงินเข้าแล้ว webhook สร้างงานให้เจ้าหน้าที่ตรวจยอดแล้วปลดล็อค
--   source_event = CALL_ANSWERED_PROMISE  → หัว "ยอดนัดชำระ" + "วันนัด ภายใน <promise_date>"
--   null (ลิงก์อื่น · แถวก่อน migration)   → หัว "ยอดที่ต้องชำระ" (ไม่เคยเป็น "ยอดปิดสัญญา" ถ้า purpose ไม่ใช่ PAYOFF)
-- additive · nullable · ไม่ rewrite ตาราง · ไม่ backfill (ลิงก์ AMOUNT มีอายุ 24 ชม.)
ALTER TABLE "payment_links"
  ADD COLUMN "source_event" "DunningEventTrigger",
  ADD COLUMN "promise_date" TIMESTAMP(3);
