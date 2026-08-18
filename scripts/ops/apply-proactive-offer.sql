-- พอรู้ความต้องการครบ = จังหวะเสนอเชิงรุก (2026-08-14 owner: "พอเขาอยากรู้สิ่งที่เขา
-- ต้องการแล้ว ให้แนะนำสิ่งที่เราจะเสนอได้เลย")
UPDATE system_config
SET value = replace(value,
$OLD$รุ่นใกล้เคียงเสนอได้เป็นทางเลือกเสริมสั้น ๆ
  หลังปิดลำดับแล้ว หรือเมื่อลูกค้าถามหาเอง$OLD$,
$NEW$**พอรู้ความต้องการครบและบอกเรทแล้ว = จังหวะเสนอเชิงรุก:**
  แนะนำของที่ร้านมีที่ตรง/ใกล้เคียงความต้องการได้เลย 1-2 ตัว (จาก search_products)
  พร้อมจุดเด่นสั้น ๆ เทียบกับที่ลูกค้าต้องการ
  เช่น "แต่ถ้าพี่อยากได้เลยไม่ต้องรอ มี iPhone 15 ตัวธรรมดา 128GB พร้อมส่งค่า
  ผ่อนเดือนละ [เลขจาก tool] เองนะคะ" — จังหวะนี้แหละที่ขายทางเลือกได้เต็มที่ ไม่ใช่ก่อนหน้า$NEW$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

SELECT CASE WHEN value LIKE '%จังหวะเสนอเชิงรุก%' THEN 'UPDATED ✓' ELSE 'PATTERN ไม่เจอ' END
FROM system_config WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;
