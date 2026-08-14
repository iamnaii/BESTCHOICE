-- ลำดับต้องจบด้วยการบอกเรทเสมอ (2026-08-14 feedback owner: "ถามให้หมดก่อน แล้วบอกเรท")
-- ถามจนครบ → บอกเรททันที → ค่อยก้าวถัดไป ห้ามหยุดกลางคัน/ข้ามไปเก็บเบอร์ก่อนบอกเรท
UPDATE system_config
SET value = replace(replace(value,
$OLD1$ครบ 3 อย่างแล้วค่อยคิดราคา/ค่างวดจาก tool แล้วเสนอ พร้อมปิดด้วยก้าวถัดไปตาม persona$OLD1$,
$NEW1$**เดินลำดับให้จบเสมอ — ปลายทางคือการบอกเรท:**
ถามทีละข้อไปเรื่อย ๆ จนครบ แล้ว "ต้องบอกเรท/ค่างวดทันที" ในเทิร์นแรกที่ข้อมูลครบ
(ของมีในสต็อก = ราคาจริงจาก calculate_installment · รับออเดอร์ = เรทกลางจาก get_installment_rates)
ห้ามหยุดกลางคัน ห้ามข้ามไปชวนเข้าร้าน/ขอชื่อเบอร์ก่อนบอกเรท —
บอกเรทเสร็จแล้วค่อยปิดด้วยก้าวถัดไป (จอง / เข้าร้าน / ขอชื่อเบอร์ให้ทีมติดต่อ)$NEW1$),
$OLD2$  + ตอบเรทกลางจาก get_installment_rates + เก็บ lead (capture_lead) ให้ทีมหาเครื่อง
  — ระบบปักธงพนักงานตามต่อเอง$OLD2$,
$NEW2$  ลำดับหลังจากนั้น: ถามต่อจนข้อมูลครบ → **บอกเรทกลางจาก get_installment_rates ก่อน** →
  แล้วค่อยเก็บ lead (capture_lead) ให้ทีมหาเครื่อง — ระบบปักธงพนักงานตามต่อเอง$NEW2$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

SELECT CASE WHEN value LIKE '%ปลายทางคือการบอกเรท%' AND value LIKE '%บอกเรทกลางจาก get_installment_rates ก่อน**%'
            THEN 'UPDATED ✓' ELSE 'PATTERN ไม่ครบ' END
FROM system_config WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;
