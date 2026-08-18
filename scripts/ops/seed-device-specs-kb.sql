-- v3.3 (2026-08-15 คำสั่งเจ้าของ): คลังสเปคต่อรุ่นใน KB — ให้บอทอ้างสเปคจริงตอนเทียบรุ่น
-- แทนการพูดจากความจำ ("กล้องใหม่กว่า" ลอย ๆ) — เขียนเป็น "ภาษาประโยชน์" พร้อมใช้
-- แก้สเปค: แก้แถวใน SQL นี้แล้วรันซ้ำ (idempotent) — id ขึ้นต้น spec:
BEGIN;

INSERT INTO chat_knowledge_base
  (id, channel, category, intent, trigger_keywords, example_questions, response_template, response_type, requires_auth, active, priority, created_at, updated_at)
VALUES
('spec:iphone-12', NULL, 'SPEC', 'spec_iphone_12',
 ARRAY['สเปค','iPhone 12','12','ต่างกัน','ดียังไง'],
 ARRAY['iPhone 12 สเปคเป็นไง','12 กับ 13 ต่างกันยังไง'],
 $K$iPhone 12 — รุ่นเริ่มต้นคุ้มสุดของร้าน
จอ OLED 6.1" สีสวยคมชัด · กล้องคู่ ถ่ายโซเชียลสวยเกินราคา · รองรับ 5G
เหมาะกับ: ใช้ทั่วไป โซเชียล ไลน์ เฟซ งบเบาสุด$K$,
 'info', false, true, 40, NOW(), NOW()),

('spec:iphone-13', NULL, 'SPEC', 'spec_iphone_13',
 ARRAY['สเปค','iPhone 13','13','ต่างกัน','ดียังไง'],
 ARRAY['iPhone 13 สเปคเป็นไง','13 ดีกว่า 12 ยังไง'],
 $K$iPhone 13 — จุดเด่นคือแบตอึดขึ้นจาก 12 ชัดเจน (ใช้ได้เต็มวันสบาย)
กล้องรับแสงดีขึ้น ถ่ายที่มืดสวยขึ้น · ชิปแรงขึ้น ลื่นยาว ๆ
เหมาะกับ: อยากได้เครื่องอึด ๆ ใช้ทน งบกลาง$K$,
 'info', false, true, 40, NOW(), NOW()),

('spec:iphone-14', NULL, 'SPEC', 'spec_iphone_14',
 ARRAY['สเปค','iPhone 14','14','ต่างกัน','ดียังไง'],
 ARRAY['iPhone 14 สเปคเป็นไง','14 กับ 13 ต่างกันยังไง'],
 $K$iPhone 14 — ต่อยอดจาก 13: กล้องหน้าโฟกัสอัตโนมัติ เซลฟี่คมขึ้นเยอะ
ถ่ายกลางคืนดีขึ้น · แบตอึดใกล้เคียง 13
เหมาะกับ: สายเซลฟี่/วิดีโอคอล งบกลาง$K$,
 'info', false, true, 40, NOW(), NOW()),

('spec:iphone-15', NULL, 'SPEC', 'spec_iphone_15',
 ARRAY['สเปค','iPhone 15','15','ต่างกัน','ดียังไง','USB-C'],
 ARRAY['iPhone 15 สเปคเป็นไง','15 ดีกว่า 14 ยังไง'],
 $K$iPhone 15 — ก้าวใหญ่เรื่องกล้อง: กล้องหลัก 48MP คมขึ้นชัดเจน ซูม 2 เท่าไม่แตก
เปลี่ยนเป็นสาย USB-C ชาร์จสายเดียวกับแอนดรอยด์ หายห่วงเรื่องสาย · มี Dynamic Island
เหมาะกับ: สายถ่ายรูป อยากได้เครื่องทันสมัยในงบสบาย$K$,
 'info', false, true, 40, NOW(), NOW()),

('spec:iphone-16', NULL, 'SPEC', 'spec_iphone_16',
 ARRAY['สเปค','iPhone 16','16','ต่างกัน','ดียังไง','ปุ่มกล้อง'],
 ARRAY['iPhone 16 สเปคเป็นไง','16 กับ 15 ต่างกันยังไง'],
 $K$iPhone 16 — เครื่องใหม่สายคุ้ม: ชิปรุ่นใหม่รองรับฟีเจอร์ AI ของ Apple ยาว ๆ
มีปุ่มชัตเตอร์กล้องด้านข้าง กดถ่ายเหมือนกล้องจริง · กล้อง 48MP + มุมกว้างดีขึ้น · แบตอึดขึ้นจาก 15
เหมาะกับ: อยากได้เครื่องใหม่ล่าสุดที่ใช้ได้ยาว ๆ หลายปี$K$,
 'info', false, true, 40, NOW(), NOW()),

('spec:iphone-17', NULL, 'SPEC', 'spec_iphone_17',
 ARRAY['สเปค','iPhone 17','17','ต่างกัน','ดียังไง','จอลื่น'],
 ARRAY['iPhone 17 สเปคเป็นไง','17 กับ 16 ต่างกันยังไง'],
 $K$iPhone 17 — รุ่นธรรมดาที่ได้ของระดับ Pro: จอลื่น 120Hz ครั้งแรก + จอใหญ่ขึ้นเป็น 6.3"
ชิปใหม่ล่าสุดแรงสุดในสายธรรมดา · กล้องหน้าใหม่ เซลฟี่กว้างขึ้นไม่ต้องหมุนเครื่อง · แบตอึดขึ้น
เหมาะกับ: อยากได้ตัวท็อปสายธรรมดา จอลื่นเล่นอะไรก็เพลิน$K$,
 'info', false, true, 40, NOW(), NOW()),

('spec:variants', NULL, 'SPEC', 'spec_variants',
 ARRAY['ธรรมดา','Plus','Pro','Pro Max','Air','ต่างกัน','ตัวไหนดี'],
 ARRAY['ตัวธรรมดากับ Pro ต่างกันยังไง','Plus คืออะไร','Pro Max ดียังไง'],
 $K$ความต่างรุ่นย่อยในตระกูลเดียวกัน (ใช้ได้ทุกเจน):
ตัวธรรมดา = ครบทุกอย่างที่จำเป็น คุ้มสุด
Plus = เครื่องเดียวกับตัวธรรมดา แต่จอใหญ่กว่า + แบตอึดกว่า (17 Air = บางเบาพิเศษแทน Plus)
Pro = กล้อง 3 ตัว มีซูมไกล + จอลื่น 120Hz + ตัวเครื่องพรีเมียม
Pro Max = ตัว Pro ที่จอใหญ่สุด แบตอึดสุด ซูมไกลสุด — ท็อปสุดของเจน$K$,
 'info', false, true, 40, NOW(), NOW())

ON CONFLICT (id) DO UPDATE SET
  trigger_keywords = EXCLUDED.trigger_keywords,
  example_questions = EXCLUDED.example_questions,
  response_template = EXCLUDED.response_template,
  active = true, deleted_at = NULL, updated_at = NOW();

-- prompt: ใช้สเปคจาก KB ตอนเทียบ/ถามสเปค — ห้ามเดาจากความจำ
UPDATE system_config
SET value = replace(value,
$OLD$- รูปแบบ: การ์ดต่อรุ่น (คั่น ---) = จุดเด่นสั้น 1 บรรทัด + "ดาวน์ X ผ่อนเดือนละ Y บาท Z งวด"$OLD$,
$NEW$- รูปแบบ: การ์ดต่อรุ่น (คั่น ---) = จุดเด่นสั้น 1 บรรทัด + "ดาวน์ X ผ่อนเดือนละ Y บาท Z งวด"
- **จุดเด่นเชิงสเปคต้องมาจากคลังสเปค**: เรียก search_knowledge_base ("สเปค <รุ่น>") ของทุกตัวที่เทียบ
  พร้อมกันในรอบเดียว แล้วแปลเป็นภาษาประโยชน์ 1-2 บรรทัด/รุ่น (id ขึ้นต้น spec: · แถว spec:variants
  = ความต่างธรรมดา/Plus/Pro/Pro Max) — **ไม่เจอสเปคใน KB = ห้ามเดาสเปคจากความจำ** พูดได้เฉพาะ
  ข้อมูลจาก tool อื่น (สภาพ/แบต%/เรท) แล้วเสริม "สเปคละเอียดเดี๋ยวทีมงานส่งให้นะคะ"$NEW$),
    updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;

COMMIT;

SELECT count(*) AS spec_rows FROM chat_knowledge_base WHERE id LIKE 'spec:%' AND deleted_at IS NULL;
SELECT CASE WHEN value LIKE '%จุดเด่นเชิงสเปคต้องมาจากคลังสเปค%' THEN '✓ กฎสเปคจาก KB' ELSE '✗' END
FROM system_config WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;
