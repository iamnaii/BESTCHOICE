-- คลังคำตอบ 32 แถว: ภาษาแชทไทยจริง + แบ่งบรรทัดสั้น ๆ อ่านง่ายบนมือถือ (2026-08-14 v2)
-- ทรง: บรรทัดเปิด → เว้นบรรทัด → เนื้อหาทีละบรรทัด → เว้นบรรทัด → คำถามปิดท้าย
BEGIN;

UPDATE chat_knowledge_base SET response_template = $KBX$สนใจรุ่นไหนสีไหนคะ เดี๋ยวเช็คให้เลยค่า 😊
ของเข้าใหม่เรื่อย ๆ นะคะ$KBX$, updated_at = NOW()
WHERE id = 'extracted:product_availability' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$แล้วแต่รุ่นเลยค่ะ
ลูกค้าสนใจรุ่นไหนอยู่คะ เดี๋ยวคิดยอดผ่อนให้ดูเลยค่า 😊$KBX$, updated_at = NOW()
WHERE id = 'extracted:price_installment' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$ร้านอยู่เส้นหลัง บขส สระแก้วลพบุรีค่ะ
ที่เดียวกับร้านประกัน ตรงข้ามชาบูแม็คซิโกเลยค่า

แผนที่ 🗺️ https://maps.app.goo.gl/bqGcmr5FupWLw1378
เปิดทุกวัน 10 โมงเช้าถึง 1 ทุ่มค่ะ

แวะมาดูเครื่องได้เลยนะคะ 😊$KBX$, updated_at = NOW()
WHERE id = 'extracted:store_location_hours' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$มี 2 แบบค่ะ

ดาวน์น้อย ผ่อน 10 เดือน
ใช้สลิปเงินเดือนใบนึงค่า

ดาวน์สูงขึ้นหน่อย ผ่อน 12 เดือน
บัตรประชาชนใบเดียวจบ ไม่เช็คอะไรเลยค่ะ

ลูกค้าสะดวกแบบไหนคะ 😊$KBX$, updated_at = NOW()
WHERE id = 'extracted:installment_terms' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$ไม่เช็คบูโรนะคะ 😊

ผ่อน 12 เดือน ใช้บัตรประชาชนใบเดียวเลยค่า
แบบดาวน์น้อย ผ่อน 10 เดือน ขอสลิปเงินเดือนเพิ่มใบนึงค่ะ

สะดวกแบบไหนแจ้งได้เลยนะคะ$KBX$, updated_at = NOW()
WHERE id = 'extracted:documents_required' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$ไม่เช็คบูโรค่า ใช้บัตรประชาชนใบเดียวก็ผ่านได้ 😊
อนุมัติไวใน 5 นาทีค่ะ

สะดวกส่งเอกสารให้เช็คเลยมั้ยคะ$KBX$, updated_at = NOW()
WHERE id = 'extracted:approval_process' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$มือสองของร้านคัดสภาพทุกเครื่องเลยค่ะ ตรวจก่อนขายค่า
สภาพแบตกับตำหนิถ้ามี บอกตรง ๆ ต่อเครื่องเลยนะคะ

มาดูเครื่องจริงที่ร้านก่อนได้เลยค่ะ 😊$KBX$, updated_at = NOW()
WHERE id = 'extracted:second_hand_condition' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$ได้เลยค่า วางดาวน์ปุ๊บรับเครื่องกลับบ้านเลย ไม่ต้องรอค่ะ 😊
สนใจรุ่นไหนอยู่คะ$KBX$, updated_at = NOW()
WHERE id = 'extracted:down_payment_channel' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$เทิร์นได้ค่ะ 😊
เอาเครื่องเดิมมาขายให้ร้าน แล้วผ่อนเครื่องใหม่กลับไปเลยค่า

รับ iPhone 12 ขึ้นไปถึง 17 Pro Max (ไม่รับรุ่น Mini นะคะ)
เครื่องศูนย์ไทย ไม่ติด iCloud ไม่ติดสัญญาที่อื่น สภาพใช้งานปกติค่ะ

ลูกค้าใช้รุ่นไหนอยู่คะ เดี๋ยวตีราคาให้เลยค่า$KBX$, updated_at = NOW()
WHERE id = 'extracted:trade_in' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$จ่ายได้ 2 ทางค่ะ

กดจ่ายผ่านลิงก์หรือ QR ที่ส่งให้ในไลน์นี้ได้เลยค่า
หรือโอนเข้าบัญชีไฟแนนซ์ แล้วส่งสลิปมาในแชทนี้ก็ได้ค่ะ

เอายอดหรือเลขบัญชี แจ้งได้เลยนะคะ 😊$KBX$, updated_at = NOW()
WHERE id = 'extracted:payment_channel' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$เช็คได้จากเมนูในไลน์นี้เลยค่ะ
หรือแจ้งชื่อกับเบอร์ที่ทำสัญญามา เดี๋ยวเช็คให้เลยค่า 😊$KBX$, updated_at = NOW()
WHERE id = 'extracted:outstanding_balance' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$เครื่องใหม่ประกัน 12 เดือน
มือสองประกันร้าน 60 วันค่ะ

มีปัญหาช่วงประกัน เอาเครื่องเข้ามาให้ดูที่ร้านได้เลยนะคะ 😊$KBX$, updated_at = NOW()
WHERE id = 'extracted:warranty_claim' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$ส่งสลิปมาในแชทนี้ได้เลยค่า
เดี๋ยวเช็คแล้วยืนยันให้นะคะ 😊$KBX$, updated_at = NOW()
WHERE id = 'extracted:slip_confirm' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$ดูได้จากสัญญาเลยค่ะ
หรือทักมาแบบนี้ก็ได้ค่า เดี๋ยวเช็ควันครบกำหนดกับยอดงวดหน้าให้เลยนะคะ 😊$KBX$, updated_at = NOW()
WHERE id = 'extracted:due_date' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$ระบบจะเตือนก่อนถึงกำหนดเสมอนะคะ
ถ้าค้างนานเครื่องอาจโดนล็อกชั่วคราวค่ะ จ่ายแล้วระบบปลดให้ไวสุดเลยค่า

เดี๋ยวเช็คยอดของลูกค้าให้ก่อนนะคะ 😊$KBX$, updated_at = NOW()
WHERE id = 'extracted:device_lock' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$ปิดยอดก่อนได้ค่า
จ่ายยอดคงเหลือทั้งหมดทีเดียวจบเลยค่ะ

เดี๋ยวให้ทีมคิดยอดให้นะคะ 😊$KBX$, updated_at = NOW()
WHERE id = 'extracted:early_payoff' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$สองรุ่นนี้ต่างกันที่สเปกกับราคาค่ะ
ลูกค้าเน้นอะไรเป็นหลักคะ กล้อง แบต หรืองบประมาณ 😊

เดี๋ยวเทียบให้ดูพร้อมค่างวดของแต่ละรุ่นเลยค่า$KBX$, updated_at = NOW()
WHERE id = 'extracted:spec_compare' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$ถ้าเลยกำหนดจะมีค่าปรับตามสัญญานะคะ จ่ายตรงเวลาดีสุดค่ะ

ถ้าช่วงนี้ติดขัด ทักมาคุยได้เลยนะคะ
เดี๋ยวช่วยหาทางออกให้ค่า 😊$KBX$, updated_at = NOW()
WHERE id = 'extracted:late_fee' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$มีที่ร้านเลยค่ะ สายชาร์จ เคส ฟิล์ม ครบค่า
อยากได้อะไรแจ้งได้เลยนะคะ 😊$KBX$, updated_at = NOW()
WHERE id = 'extracted:accessories' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$ขอเลื่อนได้ค่ะ
ทักมาคุยกับทีมก่อนวันครบกำหนดนะคะ เดี๋ยวช่วยดูให้ค่า 😊$KBX$, updated_at = NOW()
WHERE id = 'extracted:extend_due_date' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$ได้เลยค่า แจ้งมาได้เลยนะคะ
เดี๋ยวส่งใบเสร็จให้ค่ะ 😊$KBX$, updated_at = NOW()
WHERE id = 'extracted:receipt_request' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$ดูได้ค่ะ เข้ามาดูที่ร้านหรือขอเป็นสำเนาก็ได้ค่า
แจ้งได้เลยนะคะ 😊$KBX$, updated_at = NOW()
WHERE id = 'extracted:contract_document' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$เปลี่ยนได้ค่ะ แจ้งข้อมูลใหม่มาได้เลยค่า
เดี๋ยวอัปเดตในระบบให้นะคะ 😊$KBX$, updated_at = NOW()
WHERE id = 'extracted:profile_change' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$เข้าใจค่า 😊
ผ่อนกับร้านแบ่งจ่ายสบายกว่าซื้อสดเยอะเลยนะคะ
ดาวน์น้อยก็เริ่มได้ ไม่เช็คบูโรด้วยค่ะ

สนใจรุ่นไหนคะ เดี๋ยวคิดค่างวดให้ดูก่อน ไม่ผูกมัดค่า$KBX$, updated_at = NOW()
WHERE id = 'extracted:objection_price_too_high' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$เครื่องแท้ 100% ทุกเครื่องค่า
ไม่ติด iCloud ไม่ล็อกเครือข่าย เช็คได้ก่อนรับเครื่องเลยค่ะ

ร้านมีหน้าร้านจริงที่ลพบุรี
แวะมาดูเครื่องเองก่อนได้เลยนะคะ 😊$KBX$, updated_at = NOW()
WHERE id = 'extracted:objection_fake_or_icloud' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$เข้าใจเลยค่า
ร้านมีหน้าร้านจริงที่ลพบุรีนะคะ ลูกค้าส่วนใหญ่ปากต่อปากกันมาค่ะ
สัญญาถูกต้องทุกฉบับ

ยังไม่ต้องโอนอะไรทั้งนั้นนะคะ
มาดูเครื่องจริง คุยกับพนักงานที่ร้านก่อนได้เลยค่า 😊$KBX$, updated_at = NOW()
WHERE id = 'extracted:objection_scam_fear' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$ได้เลยค่า คิดก่อนได้เลยนะคะ 😊
ตัดสินใจแล้วทักมาได้ตลอด หรือแวะมาดูเครื่องที่ร้านก่อนก็ได้ค่ะ$KBX$, updated_at = NOW()
WHERE id = 'extracted:objection_think_about_it' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$ร้านบอกเป็นยอดชัด ๆ เลยค่ะ
ดาวน์เท่าไหร่ ผ่อนเดือนละเท่าไหร่ กี่เดือน จบ
ไม่มีบวกเพิ่มทีหลังค่า

สนใจรุ่นไหนคะ เดี๋ยวคิดให้ดูเลยค่ะ 😊$KBX$, updated_at = NOW()
WHERE id = 'extracted:objection_rate_question' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$ได้เลยค่า ปรึกษากันก่อนได้เลยนะคะ 😊
หรือพากันมาดูเครื่องที่ร้านเลยก็ได้ค่ะ
ตัดสินใจแล้วทักมาได้ตลอดนะคะ$KBX$, updated_at = NOW()
WHERE id = 'extracted:objection_consult_family' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$เลือกได้ 2 แบบค่า

ดาวน์น้อย ผ่อน 10 เดือน ใช้สลิปเงินเดือนค่ะ
ดาวน์สูงขึ้นหน่อย ผ่อน 12 เดือน บัตรประชาชนใบเดียวจบค่า

สะดวกแบบไหนคะ 😊$KBX$, updated_at = NOW()
WHERE id = 'extracted:objection_down_payment' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$ตอนนี้ผ่อนได้สูงสุด 12 เดือนค่ะ 😊
ลูกค้ามีงบผ่อนเดือนละประมาณเท่าไหร่คะ
เดี๋ยวหารุ่นที่ค่างวดพอดี ๆ ให้เลยค่า$KBX$, updated_at = NOW()
WHERE id = 'extracted:objection_longer_term' AND deleted_at IS NULL;

UPDATE chat_knowledge_base SET response_template = $KBX$เข้าใจค่า 😊
ของร้านเราไม่เช็คบูโร ใช้บัตรประชาชนใบเดียว
อนุมัติไวรับเครื่องได้เลย เครื่องแท้ทุกเครื่อง มีหน้าร้านจริงที่ลพบุรีค่ะ

สนใจรุ่นไหนคะ เดี๋ยวเทียบค่างวดให้ดูเลยค่า$KBX$, updated_at = NOW()
WHERE id = 'extracted:objection_competitor_finance' AND deleted_at IS NULL;

COMMIT;

SELECT count(*) AS updated_check FROM chat_knowledge_base
WHERE category IN ('EXTRACTED','EXTRACTED_OBJECTION') AND active AND deleted_at IS NULL
  AND updated_at > NOW() - interval '1 minute';
