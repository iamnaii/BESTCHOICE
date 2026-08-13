-- รีวิวคลังคำตอบบอท 2026-08-13 — แก้ 16 แถว + เปิดใช้ 28 แถว
-- (4 แถวยังปิดรอ owner ยืนยันนโยบาย: store_location_hours, approval_process,
--  trade_in, warranty_claim)
-- ที่มา: ชีทรีวิว https://claude.ai/code/artifact/0b8226c8-3875-40ae-8dc6-613bb7c6c519
BEGIN;

UPDATE chat_knowledge_base SET response_template = $KBX$ร้านเราบอกเป็นยอดชัด ๆ เลยค่ะ 😊 ดาวน์เท่าไหร่ ผ่อนเดือนละเท่าไหร่ กี่เดือน จบ ไม่มีบวกเพิ่มทีหลัง

ลูกค้าสนใจรุ่นไหนคะ เดี๋ยวคำนวณยอดให้ดูทันทีค่ะ$KBX$, active = TRUE, updated_at = NOW()
WHERE id = 'extracted:objection_rate_question' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$เครื่องทุกเครื่องเป็นของแท้ 100% ค่ะ ไม่ติด iCloud ไม่ล็อกเครือข่าย ตรวจสอบได้ก่อนรับเครื่อง

ร้านเรามีหน้าร้านจริงที่ลพบุรี เข้ามาเช็คเครื่องด้วยตัวเองก่อนตัดสินใจได้เลยนะคะ 😊$KBX$, active = TRUE, updated_at = NOW()
WHERE id = 'extracted:objection_fake_or_icloud' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$เลือกได้ 2 แบบเลยค่ะ 😊

✅ ดาวน์น้อย ผ่อน 10 เดือน — ใช้บัตรประชาชน + สลิปเงินเดือน 1 เดือน
✅ ดาวน์สูงขึ้น ผ่อน 12 เดือน — ใช้บัตรประชาชนใบเดียว

ลูกค้าสะดวกแบบไหนคะ$KBX$, active = TRUE, updated_at = NOW()
WHERE id = 'extracted:objection_down_payment' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$สองรุ่นนี้ต่างกันที่สเปกและราคาค่ะ ลูกค้าเน้นเรื่องไหนเป็นหลักคะ — กล้อง แบต หน้าจอ หรืองบประมาณ 😊 เดี๋ยวเทียบให้ดูชัด ๆ พร้อมค่างวดของแต่ละรุ่นเลยค่ะ$KBX$, active = TRUE, updated_at = NOW()
WHERE id = 'extracted:spec_compare' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$เข้าใจเลยค่ะ 😊 ร้านเรามีหน้าร้านจริงที่ลพบุรี ลูกค้าส่วนใหญ่มาจากการแนะนำปากต่อปาก สัญญาถูกต้องตามกฎหมายทุกฉบับ

ยังไม่ต้องโอนอะไรทั้งนั้นนะคะ เข้ามาดูเครื่องจริง คุยกับพนักงานที่ร้านก่อนได้เลยค่ะ$KBX$, active = TRUE, updated_at = NOW()
WHERE id = 'extracted:objection_scam_fear' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$ไม่เช็คเครดิตบูโรค่ะ 😊

📄 แบบผ่อน 12 เดือน — บัตรประชาชนใบเดียวจบ
📄 แบบดาวน์น้อย ผ่อน 10 เดือน — บัตรประชาชน + สลิปเงินเดือน 1 เดือน$KBX$, active = TRUE, updated_at = NOW()
WHERE id = 'extracted:documents_required' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$ร้านเรามีเรทผ่อน 2 แบบค่ะ

✅ แบบที่ 1️⃣ ดาวน์น้อย ผ่อน 10 เดือน — ใช้สลิปเงินเดือน 1 เดือน
✅ แบบที่ 2️⃣ ดาวน์สูงขึ้น ผ่อน 12 เดือน — บัตรประชาชนใบเดียว ไม่เช็คอะไรเลย

ลูกค้าสะดวกแบบไหนคะ 😊$KBX$, active = TRUE, updated_at = NOW()
WHERE id = 'extracted:installment_terms' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$ชำระได้ 2 ทางค่ะ 😊

💳 กดจ่ายผ่านลิงก์/QR ที่ระบบส่งให้ในไลน์นี้ได้เลย
🏦 หรือโอนเข้าบัญชีของไฟแนนซ์ แล้วส่งสลิปมาในแชทนี้

ต้องการยอดหรือเลขบัญชี แจ้งได้เลยนะคะ$KBX$, active = TRUE, updated_at = NOW()
WHERE id = 'extracted:payment_channel' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$เช็คยอดคงเหลือได้จากเมนูในไลน์นี้เลยค่ะ 😊 หรือแจ้งชื่อ-เบอร์ที่ทำสัญญามา เดี๋ยวทีมเช็คให้ทันทีนะคะ$KBX$, active = TRUE, updated_at = NOW()
WHERE id = 'extracted:outstanding_balance' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$วันครบกำหนดของลูกค้าดูได้จากสัญญาเลยค่ะ 😊 หรือทักมาแบบนี้แหละ เดี๋ยวทีมเช็ควันที่ + ยอดงวดถัดไปให้ทันทีนะคะ$KBX$, active = TRUE, updated_at = NOW()
WHERE id = 'extracted:due_date' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$ระบบจะแจ้งเตือนก่อนถึงกำหนดเสมอค่ะ ถ้าค้างชำระนานเครื่องอาจถูกล็อกชั่วคราว — ชำระแล้วระบบจะปลดล็อกให้เร็วที่สุดค่ะ

เดี๋ยวทีมเช็คยอดของลูกค้าให้ก่อนนะคะ 😊$KBX$, active = TRUE, updated_at = NOW()
WHERE id = 'extracted:device_lock' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$ถ้าเลยกำหนดจะมีค่าปรับตามสัญญานะคะ แนะนำชำระตรงกำหนดเพื่อเลี่ยงค่าใช้จ่ายเพิ่มค่ะ

ถ้าช่วงนี้ติดขัด ทักมาคุยกับทีมได้เลยนะคะ เดี๋ยวช่วยหาทางออกให้ค่ะ 😊$KBX$, active = TRUE, updated_at = NOW()
WHERE id = 'extracted:late_fee' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$เครื่องมือสองของร้านคัดสภาพและตรวจการใช้งานก่อนขายทุกเครื่องค่ะ 😊 สภาพแบตและตำหนิ (ถ้ามี) แจ้งตรง ๆ ต่อเครื่อง เข้ามาเช็คเครื่องจริงที่ร้านก่อนตัดสินใจได้เลยนะคะ$KBX$, active = TRUE, updated_at = NOW()
WHERE id = 'extracted:second_hand_condition' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$เข้าใจค่ะ 😊 ผ่อนกับเราแบ่งเบากว่าจ่ายก้อนเดียวเยอะเลยนะคะ

✅ ดาวน์น้อย ผ่อน 10 เดือน
✅ ไม่เช็คเครดิต ใช้บัตรประชาชนใบเดียว (แบบ 12 เดือน)

ลูกค้าสนใจรุ่นไหนคะ เดี๋ยวคำนวณค่างวดให้ดูก่อน ไม่ผูกมัดค่ะ$KBX$, active = TRUE, updated_at = NOW()
WHERE id = 'extracted:objection_price_too_high' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$เข้าใจค่ะ 😊 จุดที่ BESTCHOICE ต่างจากที่อื่น:

✅ ไม่เช็คเครดิตบูโร
✅ บัตรประชาชนใบเดียว (แบบ 12 เดือน)
✅ อนุมัติเร็ว รับเครื่องได้เลย
✅ เลือกผ่อน 10 หรือ 12 เดือน
✅ เครื่องแท้ 100% ทุกเครื่อง มีหน้าร้านจริง

ลองเทียบดูได้เลยค่ะ 😊$KBX$, active = TRUE, updated_at = NOW()
WHERE id = 'extracted:objection_competitor_finance' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$ตอนนี้ผ่อนได้สูงสุด 12 เดือนค่ะ 😊 ลูกค้ามีงบผ่อนต่อเดือนประมาณเท่าไหร่คะ เดี๋ยวช่วยหารุ่นที่ค่างวดพอดีกับงบให้เลยค่ะ$KBX$, active = TRUE, updated_at = NOW()
WHERE id = 'extracted:objection_longer_term' AND deleted_at IS NULL;

-- 12 แถวที่ผ่านรีวิว เปิดใช้ตามเดิม
UPDATE chat_knowledge_base SET active = TRUE, updated_at = NOW()
WHERE id IN (
  'extracted:product_availability','extracted:price_installment',
  'extracted:down_payment_channel','extracted:slip_confirm',
  'extracted:early_payoff','extracted:accessories',
  'extracted:extend_due_date','extracted:receipt_request',
  'extracted:contract_document','extracted:profile_change',
  'extracted:objection_think_about_it','extracted:objection_consult_family'
) AND deleted_at IS NULL;

COMMIT;

SELECT category, active, count(*)
FROM chat_knowledge_base
WHERE category IN ('EXTRACTED','EXTRACTED_OBJECTION') AND deleted_at IS NULL
GROUP BY 1,2 ORDER BY 1,2;
