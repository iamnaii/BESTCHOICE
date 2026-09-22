-- บอทขาย: ปรับจากแชทจริง 19-22 ก.ย. + โหมดไม่มีสต๊อก + รูปตารางผ่อน (คำสั่งเจ้าของ 2026-09-22) — ขึ้น
-- ลำดับ: apply-imported-free-down.sql (โปรฟรีดาวน์) → ไฟล์นี้ · ถอย: rollback-bot-tune-2026-09-22.sql → rollback-imported-free-down.sql
-- ต้องมีโค้ดที่รู้จัก send_rate_card / notify_staff / shop_bot_stock_mode บน prod แล้ว (PR เดียวกับไฟล์นี้)
-- ผลวัด bot:eval ของ persona ชุดนี้:
--   ผล bot:eval 2026-09-22 (claude-sonnet-5 effort medium · tool เป็น fixture · อ่านเป็นอัตรา ไม่ใช่ค่าคงที่):
--   · ชุดปกติ (LIVE) ฉบับก่อน X12/X13: 3 รอบ ตก 1-7 เทิร์น/68 · ฉบับร่างเดิม 2 รอบ ตก 0-2 เทิร์น
--     ฉากที่ตกซ้ำ: S11 (ถามงบซ้ำ — ตกในฉบับร่างด้วย แก้ด้วย X12) · S21 (ไม่ถามสด/ผ่อนก่อน — แก้ด้วย X13)
--     ที่เหลือเป็นความแกว่งรายรอบ (ความยาวบับเบิลเกินเพดานเล็กน้อย / ปุ่มรุ่นย่อย)
--   · ชุดไม่มีสต๊อก (NS1-NS8, 11 เทิร์น) หลังแก้ลูปเครื่องมือ: 6 รอบ 63/66 (ประกาศเครื่องมือสต๊อก 31/33)
--   · ฉบับสุดท้าย (X12/X13 + X2 ห้ามส่งตารางซ้ำ) ยังไม่ได้วัดซ้ำ — เครดิต Anthropic หมดระหว่างวัด
--     ต้องรัน bot:eval ทั้งสองชุดอีกรอบหลังเติมเครดิต ก่อนรันไฟล์นี้บน prod
BEGIN;
DO $G$
DECLARE ex text; bs text;
BEGIN
  SELECT value INTO ex FROM system_config WHERE key='shop_bot_persona_bot_extras' AND deleted_at IS NULL;
  SELECT value INTO bs FROM system_config WHERE key='shop_bot_persona_base' AND deleted_at IS NULL;
  IF ex IS NULL OR bs IS NULL THEN RAISE EXCEPTION 'ไม่พบ persona ใน system_config'; END IF;
  IF md5(ex) <> '4c0fb09ec182f519f9f7c1dd3426d043' THEN RAISE EXCEPTION 'EXTRAS บน DB ไม่ใช่ฉบับที่คาด (ร่างโปรฟรีดาวน์ — รัน apply-imported-free-down ก่อน หรือมีคนแก้ persona) md5=%', md5(ex); END IF;
  IF md5(bs) <> 'db81460176ea792872d2fa7855094d7d' THEN RAISE EXCEPTION 'BASE บน DB ไม่ตรงฉบับที่คาด md5=%', md5(bs); END IF;
  IF NOT EXISTS (SELECT 1 FROM chat_knowledge_base WHERE id = $K$faq:age-requirement$K$ AND deleted_at IS NULL) THEN RAISE EXCEPTION 'ไม่พบแถว KB faq:age-requirement'; END IF;
  IF EXISTS (SELECT 1 FROM chat_knowledge_base WHERE id = $K$faq:age-requirement$K$ AND deleted_at IS NULL AND (priority <> 0 OR trigger_keywords IS DISTINCT FROM ARRAY[$K$อายุ$K$,$K$กี่ปี$K$,$K$ปีเท่าไหร่$K$,$K$อายุเท่าไหร่$K$,$K$18$K$,$K$19$K$,$K$ยังไม่ 20$K$,$K$ไม่ถึง 20$K$,$K$เด็ก$K$,$K$นักเรียน$K$,$K$ผู้ปกครอง$K$,$K$ค้ำ$K$,$K$ค้ำประกัน$K$]::text[] OR response_template <> $K$อายุ 20 ปีขึ้นไป ทำสัญญาเองได้เลยค่ะ
17-19 ผ่อนได้ แต่มีผู้ปกครองมาเซ็นด้วยวันรับเครื่อง
ต่ำกว่า 17 ยังทำสัญญาไม่ได้ค่ะ
นักศึกษา มีผู้ปกครองค้ำให้ค่า$K$)) THEN RAISE EXCEPTION 'แถว KB faq:age-requirement ไม่ตรงค่าที่คาด — มีคนแก้หลังตรวจ'; END IF;
  IF NOT EXISTS (SELECT 1 FROM chat_knowledge_base WHERE id = $K$faq:device-lock$K$ AND deleted_at IS NULL) THEN RAISE EXCEPTION 'ไม่พบแถว KB faq:device-lock'; END IF;
  IF EXISTS (SELECT 1 FROM chat_knowledge_base WHERE id = $K$faq:device-lock$K$ AND deleted_at IS NULL AND (priority <> 0)) THEN RAISE EXCEPTION 'แถว KB faq:device-lock ไม่ตรงค่าที่คาด — มีคนแก้หลังตรวจ'; END IF;
  IF NOT EXISTS (SELECT 1 FROM chat_knowledge_base WHERE id = $K$faq:early-payoff$K$ AND deleted_at IS NULL) THEN RAISE EXCEPTION 'ไม่พบแถว KB faq:early-payoff'; END IF;
  IF EXISTS (SELECT 1 FROM chat_knowledge_base WHERE id = $K$faq:early-payoff$K$ AND deleted_at IS NULL AND (priority <> 0)) THEN RAISE EXCEPTION 'แถว KB faq:early-payoff ไม่ตรงค่าที่คาด — มีคนแก้หลังตรวจ'; END IF;
  IF NOT EXISTS (SELECT 1 FROM chat_knowledge_base WHERE id = $K$faq:late-fee$K$ AND deleted_at IS NULL) THEN RAISE EXCEPTION 'ไม่พบแถว KB faq:late-fee'; END IF;
  IF EXISTS (SELECT 1 FROM chat_knowledge_base WHERE id = $K$faq:late-fee$K$ AND deleted_at IS NULL AND (priority <> 0)) THEN RAISE EXCEPTION 'แถว KB faq:late-fee ไม่ตรงค่าที่คาด — มีคนแก้หลังตรวจ'; END IF;
  IF NOT EXISTS (SELECT 1 FROM chat_knowledge_base WHERE id = $K$faq:no-payslip-freelance$K$ AND deleted_at IS NULL) THEN RAISE EXCEPTION 'ไม่พบแถว KB faq:no-payslip-freelance'; END IF;
  IF EXISTS (SELECT 1 FROM chat_knowledge_base WHERE id = $K$faq:no-payslip-freelance$K$ AND deleted_at IS NULL AND (priority <> 0)) THEN RAISE EXCEPTION 'แถว KB faq:no-payslip-freelance ไม่ตรงค่าที่คาด — มีคนแก้หลังตรวจ'; END IF;
  IF NOT EXISTS (SELECT 1 FROM chat_knowledge_base WHERE id = $K$faq:paid-still-locked$K$ AND deleted_at IS NULL) THEN RAISE EXCEPTION 'ไม่พบแถว KB faq:paid-still-locked'; END IF;
  IF EXISTS (SELECT 1 FROM chat_knowledge_base WHERE id = $K$faq:paid-still-locked$K$ AND deleted_at IS NULL AND (priority <> 0)) THEN RAISE EXCEPTION 'แถว KB faq:paid-still-locked ไม่ตรงค่าที่คาด — มีคนแก้หลังตรวจ'; END IF;
  IF NOT EXISTS (SELECT 1 FROM chat_knowledge_base WHERE id = $K$faq:payment-channel-reminder$K$ AND deleted_at IS NULL) THEN RAISE EXCEPTION 'ไม่พบแถว KB faq:payment-channel-reminder'; END IF;
  IF EXISTS (SELECT 1 FROM chat_knowledge_base WHERE id = $K$faq:payment-channel-reminder$K$ AND deleted_at IS NULL AND (priority <> 0)) THEN RAISE EXCEPTION 'แถว KB faq:payment-channel-reminder ไม่ตรงค่าที่คาด — มีคนแก้หลังตรวจ'; END IF;
  IF NOT EXISTS (SELECT 1 FROM chat_knowledge_base WHERE id = $K$promo:imported-free-down$K$ AND deleted_at IS NULL) THEN RAISE EXCEPTION 'ไม่พบแถว KB promo:imported-free-down'; END IF;
  IF EXISTS (SELECT 1 FROM chat_knowledge_base WHERE id = $K$promo:imported-free-down$K$ AND deleted_at IS NULL AND (priority <> 85 OR response_template <> $K$โปรฟรีดาวน์ iPhone มือสอง เครื่องนอก (ของแท้ Apple โมเดลต่างประเทศ ประกันร้าน 30 วัน)
iPhone 13 128GB ผ่อนเดือนละ 1,758 บาท 12 งวด
iPhone 14 128GB ผ่อนเดือนละ 1,885 บาท 12 งวด
iPhone 15 128GB ผ่อนเดือนละ 2,395 บาท 12 งวด
iPhone 16 128GB ผ่อนเดือนละ 2,631 บาท 12 งวด
iPhone 13 Pro 128GB ผ่อนเดือนละ 2,140 บาท 12 งวด
iPhone 14 Pro 128GB ผ่อนเดือนละ 2,650 บาท 12 งวด
iPhone 15 Pro 128GB ผ่อนเดือนละ 3,288 บาท 12 งวด
iPhone 16 Pro 128GB ผ่อนเดือนละ 3,291 บาท 12 งวด
iPhone 13 Pro Max 128GB ผ่อนเดือนละ 2,395 บาท 12 งวด
iPhone 14 Pro Max 128GB ผ่อนเดือนละ 3,033 บาท 12 งวด
iPhone 15 Pro Max 256GB ผ่อนเดือนละ 3,401 บาท 15 งวด
iPhone 16 Pro Max 256GB ผ่อนเดือนละ 4,061 บาท 15 งวด
ทุกรุ่นฟรีดาวน์ ใช้บัตรประชาชนใบเดียว · รุ่น/ความจุนอกรายการนี้ไม่มีในโปร
ผู้สมัครอายุ 18-59 ปี ไม่เช็คบูโร · อยู่ต่างจังหวัดทำสัญญาออนไลน์ได้ (เฉพาะโปรนี้)
ขอคืนได้ก่อนชำระงวดแรก แต่ต้องจ่ายงวดแรก 1 งวด เครื่องต้องสภาพเดิม ครบกล่องอุปกรณ์ ออก iCloud แล้ว$K$)) THEN RAISE EXCEPTION 'แถว KB promo:imported-free-down ไม่ตรงค่าที่คาด — มีคนแก้หลังตรวจ'; END IF;
  IF NOT EXISTS (SELECT 1 FROM chat_knowledge_base WHERE id = $K$faq:imported-device$K$ AND deleted_at IS NULL) THEN RAISE EXCEPTION 'ไม่พบแถว KB faq:imported-device'; END IF;
  IF EXISTS (SELECT 1 FROM chat_knowledge_base WHERE id = $K$faq:imported-device$K$ AND deleted_at IS NULL AND (priority <> 60)) THEN RAISE EXCEPTION 'แถว KB faq:imported-device ไม่ตรงค่าที่คาด — มีคนแก้หลังตรวจ'; END IF;
  IF NOT EXISTS (SELECT 1 FROM chat_knowledge_base WHERE id = $K$faq:imported-tradein$K$ AND deleted_at IS NULL) THEN RAISE EXCEPTION 'ไม่พบแถว KB faq:imported-tradein'; END IF;
  IF EXISTS (SELECT 1 FROM chat_knowledge_base WHERE id = $K$faq:imported-tradein$K$ AND deleted_at IS NULL AND (priority <> 55)) THEN RAISE EXCEPTION 'แถว KB faq:imported-tradein ไม่ตรงค่าที่คาด — มีคนแก้หลังตรวจ'; END IF;
  IF NOT EXISTS (SELECT 1 FROM chat_knowledge_base WHERE id = $K$extracted:price_installment$K$ AND deleted_at IS NULL) THEN RAISE EXCEPTION 'ไม่พบแถว KB extracted:price_installment'; END IF;
  IF EXISTS (SELECT 1 FROM chat_knowledge_base WHERE id = $K$extracted:price_installment$K$ AND deleted_at IS NULL AND (priority <> 100 OR trigger_keywords IS DISTINCT FROM ARRAY[$K$ราคา$K$,$K$ดาว$K$,$K$ผ่อน$K$,$K$เงินเดือน$K$,$K$เท่าไร$K$,$K$เท่าไหร่$K$]::text[])) THEN RAISE EXCEPTION 'แถว KB extracted:price_installment ไม่ตรงค่าที่คาด — มีคนแก้หลังตรวจ'; END IF;
  IF NOT EXISTS (SELECT 1 FROM chat_knowledge_base WHERE id = $K$extracted:product_availability$K$ AND deleted_at IS NULL) THEN RAISE EXCEPTION 'ไม่พบแถว KB extracted:product_availability'; END IF;
  IF EXISTS (SELECT 1 FROM chat_knowledge_base WHERE id = $K$extracted:product_availability$K$ AND deleted_at IS NULL AND (priority <> 100 OR trigger_keywords IS DISTINCT FROM ARRAY[$K$มี$K$,$K$มั้ย$K$,$K$มีไหม$K$,$K$เหลือ$K$,$K$ยัง$K$,$K$สีไหน$K$]::text[])) THEN RAISE EXCEPTION 'แถว KB extracted:product_availability ไม่ตรงค่าที่คาด — มีคนแก้หลังตรวจ'; END IF;
  IF NOT EXISTS (SELECT 1 FROM chat_knowledge_base WHERE id = $K$extracted:installment_terms$K$ AND deleted_at IS NULL) THEN RAISE EXCEPTION 'ไม่พบแถว KB extracted:installment_terms'; END IF;
  IF EXISTS (SELECT 1 FROM chat_knowledge_base WHERE id = $K$extracted:installment_terms$K$ AND deleted_at IS NULL AND (priority <> 89 OR trigger_keywords IS DISTINCT FROM ARRAY[$K$ผ่อน$K$,$K$เรท$K$,$K$แบบไหน$K$,$K$เดือน$K$,$K$งวด$K$]::text[])) THEN RAISE EXCEPTION 'แถว KB extracted:installment_terms ไม่ตรงค่าที่คาด — มีคนแก้หลังตรวจ'; END IF;
  IF NOT EXISTS (SELECT 1 FROM chat_knowledge_base WHERE id = $K$extracted:approval_process$K$ AND deleted_at IS NULL) THEN RAISE EXCEPTION 'ไม่พบแถว KB extracted:approval_process'; END IF;
  IF EXISTS (SELECT 1 FROM chat_knowledge_base WHERE id = $K$extracted:approval_process$K$ AND deleted_at IS NULL AND (priority <> 78 OR trigger_keywords IS DISTINCT FROM ARRAY[$K$อนุมัติ$K$,$K$เช็ค$K$,$K$ได้ไหม$K$,$K$ผ่าน$K$,$K$ได้รับ$K$,$K$อายุงาน$K$]::text[])) THEN RAISE EXCEPTION 'แถว KB extracted:approval_process ไม่ตรงค่าที่คาด — มีคนแก้หลังตรวจ'; END IF;
  IF NOT EXISTS (SELECT 1 FROM chat_knowledge_base WHERE id = $K$extracted:second_hand_condition$K$ AND deleted_at IS NULL) THEN RAISE EXCEPTION 'ไม่พบแถว KB extracted:second_hand_condition'; END IF;
  IF EXISTS (SELECT 1 FROM chat_knowledge_base WHERE id = $K$extracted:second_hand_condition$K$ AND deleted_at IS NULL AND (trigger_keywords IS DISTINCT FROM ARRAY[$K$มือ$K$,$K$มือ1$K$,$K$มือ2$K$,$K$แบต$K$,$K$สภาพ$K$,$K$ผ่าน$K$]::text[])) THEN RAISE EXCEPTION 'แถว KB extracted:second_hand_condition ไม่ตรงค่าที่คาด — มีคนแก้หลังตรวจ'; END IF;
  IF NOT EXISTS (SELECT 1 FROM chat_knowledge_base WHERE id = $K$extracted:store_location_hours$K$ AND deleted_at IS NULL) THEN RAISE EXCEPTION 'ไม่พบแถว KB extracted:store_location_hours'; END IF;
  IF EXISTS (SELECT 1 FROM chat_knowledge_base WHERE id = $K$extracted:store_location_hours$K$ AND deleted_at IS NULL AND (trigger_keywords IS DISTINCT FROM ARRAY[$K$ที่ไหน$K$,$K$ที่อยู่$K$,$K$อยุ่$K$,$K$แถว$K$,$K$เปิด$K$,$K$ปิด$K$,$K$กี่โมง$K$]::text[])) THEN RAISE EXCEPTION 'แถว KB extracted:store_location_hours ไม่ตรงค่าที่คาด — มีคนแก้หลังตรวจ'; END IF;
END $G$;

UPDATE system_config SET value = replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(value,
  $P$
## ขั้น 3.5 — มือสอง: เครื่องนอก หรือ เครื่องไทย (กรองก่อนแยกสด/ผ่อน — เจ้าของสั่ง 2026-09-20)$P$,
  $P$- **รุ่นที่ใหม่กว่ารายการมือ 1 (เช่น iPhone 18 / 18 Pro / 18 Pro Max) ห้ามใช้สคริปต์ "มือ 1 ไม่มีผลิตแล้ว" เด็ดขาด** (เป็นรุ่นเพิ่งออก) → เรียก get_installment_rates ก่อน เจอเรท = บอกตามขั้น 4B · ไม่เจอ = "รุ่นนี้เดี๋ยวแอดมินเช็คเรทให้นะคะ" แล้วเรียก notify_staff (reason = รุ่น + ขอเรท) ห้ามถามงบแทน

## ขั้น 3.5 — มือสอง: เครื่องนอก หรือ เครื่องไทย (กรองก่อนแยกสด/ผ่อน — เจ้าของสั่ง 2026-09-20)$P$),
  $P$- ยังไม่รู้รุ่น → ตอบ 2 ก้อนนี้คำต่อคำ (ห้ามไล่รายการรุ่น/ความจุ ห้ามมีราคา):$P$,
  $P$- ยังไม่รู้รุ่น → เรียก send_rate_card(cards: ["imported_free_down"]) ในเทิร์นนี้ (รูปตารางโปร — ส่งครั้งเดียวต่อบทสนทนา) แล้วตอบ 2 ก้อนนี้คำต่อคำ (ห้ามไล่รายการรุ่น/ความจุ ห้ามมีราคา — ตัวเลขอยู่ในรูปแล้ว · send_rate_card คืน missing = ไม่มีรูป ตอบ 2 ก้อนเดิมโดยไม่พูดถึงรูป):$P$),
  $P$  ---
  พี่สนใจรุ่นไหนคะ [ตัวเลือก: iPhone 13 | iPhone 14 | iPhone 15 | iPhone 16]"
- รู้ตระกูลแล้ว (เช่น "16") แต่ยังไม่รู้รุ่นย่อย → ถามรุ่นย่อยด้วยปุ่มเฉพาะ 3 ตัวที่อยู่ในโปร ห้ามมี mini / Plus / Air / e ในปุ่มหรือในข้อความ:$P$,
  $P$  ประกันร้าน 30 วัน แถมเคสกับฟิล์มให้ด้วยค่ะ
  ---
  พี่สนใจรุ่นไหนคะ [ตัวเลือก: iPhone 13 | iPhone 14 | iPhone 15 | iPhone 16]"
- รู้ตระกูลแล้ว (เช่น "16") แต่ยังไม่รู้รุ่นย่อย → ถามรุ่นย่อยด้วยปุ่มเฉพาะ 3 ตัวที่อยู่ในโปร ห้ามมี mini / Plus / Air / e ในปุ่มหรือในข้อความ:$P$),
  $P$**ลูกค้าถามเอกสาร/สมัครใช้อะไรบ้าง โดยยังไม่รู้ว่าสนใจเครื่องนอกหรือเครื่องไทยและยังไม่เลือกรุ่น** (เช่นปุ่มโฆษณา "สมัครใช้เอกสารอะไรบ้าง?") → ตอบ 2 ก้อนนี้คำต่อคำ ห้ามอธิบายเรท/เงื่อนไขอนุมัติยาว (รายละเอียดเอกสารตามเรทค่อยบอกเมื่อลูกค้าเลือกเครื่องไทยและถึงขั้นเลือกเรท):$P$,
  $P$**ประวัติมีข้อความอัตโนมัติของเพจ** ("อันนี้ตารางผ่อนเครื่องนอกค่ะ ..." ส่งพร้อมรูปตารางโปร หรือ "ใช้บัตรประชาชนยื่นได้เลยค่ะ ...") = ลูกค้าเห็นตาราง/ถูกถามรุ่นแล้ว → เทิร์นนี้ตอบข้อความล่าสุดของลูกค้าต่อตามทางเครื่องนอกเลย ห้ามส่งตาราง (ห้ามเรียก send_rate_card imported_free_down อีก)/อธิบายโปรซ้ำตั้งแต่ต้น · **ห้ามลอกคำจากข้อความนั้น** ("ดาวน์ 0 บาท" → บอทใช้ "ฟรีดาวน์" · "บริษัทสินเชื่อ" ห้ามพูด)
**ลูกค้าถามเอกสาร/สมัครใช้อะไรบ้าง โดยยังไม่รู้ว่าสนใจเครื่องนอกหรือเครื่องไทยและยังไม่เลือกรุ่น** (เช่นปุ่มโฆษณา "สมัครใช้เอกสารอะไรบ้าง?") → ตอบ 2 ก้อนนี้คำต่อคำ ห้ามอธิบายเรท/เงื่อนไขอนุมัติยาว (รายละเอียดเอกสารตามเรทค่อยบอกเมื่อลูกค้าเลือกเครื่องไทยและถึงขั้นเลือกเรท):$P$),
  $P$**เมื่อไหร่ถาม:** ลูกค้าเดินทางมือสอง + รู้รุ่นย่อยและความจุแล้ว + อยู่ในรายการข้างบน + ไม่ได้ส่งสัญญาณซื้อสด → ถามกรองเทิร์นนี้ **ก่อน** คำถามเงินสด/ผ่อน และก่อนบอกตัวเลขใด ๆ (ถามครั้งเดียวต่อบทสนทนา · ลูกค้าบอกเองแล้วว่าเครื่องนอก/เครื่องไทย/ฟรีดาวน์ = ไม่ต้องถามซ้ำ ข้ามไปทางนั้นเลย) · **เส้นแนะนำตามงบ (recommend_devices): เทิร์นที่เสนอการ์ดให้ทำตามรูปแบบของหัวข้อ "เลือกไม่ถูก" เหมือนเดิมทุกประการ — ห้ามถามกรอง ห้ามเอ่ยถึงเครื่องนอก ห้ามเติมบรรทัดเปิดหรือบรรทัดอื่นนอกรูปแบบเดิม** · ถามกรองได้เฉพาะ**เทิร์นถัดไป** เมื่อลูกค้าเลือกรุ่นจากการ์ดแล้ว และรุ่น+ความจุนั้นเป็นมือสองที่อยู่ในรายการ (เทิร์นนั้นพิมพ์แค่สคริปต์กรอง ไม่ต้องค้นสต๊อก) · เทิร์นนี้ถามคำถามเดียวคือเครื่องนอก/เครื่องไทย ไม่ต้องถามค่ายมือถือ (กติกาถามงบดาวน์ของเส้น "ถามราคารวม ๆ โดยยังไม่เลือกรุ่น" ยังใช้ตามเดิมทุกอย่าง ไม่เกี่ยวกับขั้นนี้)$P$,
  $P$**เมื่อไหร่ถาม:** ลูกค้าเดินทางมือสอง + รู้รุ่นย่อยและความจุแล้ว + อยู่ในรายการข้างบน + ไม่ได้ส่งสัญญาณซื้อสด → ถามกรองเทิร์นนี้ **ก่อน** คำถามเงินสด/ผ่อน และก่อนบอกตัวเลขใด ๆ (ถามครั้งเดียวต่อบทสนทนา · ลูกค้าบอกเองแล้วว่าเครื่องนอก/เครื่องไทย/ฟรีดาวน์ = ไม่ต้องถามซ้ำ ข้ามไปทางนั้นเลย) · **เส้นแนะนำตามงบ (recommend_devices): เทิร์นที่เสนอการ์ดให้ทำตามรูปแบบของหัวข้อ "เลือกไม่ถูก" เหมือนเดิมทุกประการ — ห้ามถามกรอง ห้ามเอ่ยถึงเครื่องนอก ห้ามเติมบรรทัดเปิดหรือบรรทัดอื่นนอกรูปแบบเดิม** · ถามกรองได้เฉพาะ**เทิร์นถัดไป** เมื่อลูกค้าเลือกรุ่นจากการ์ดแล้ว และรุ่น+ความจุนั้นเป็นมือสองที่อยู่ในรายการ (เทิร์นนั้นพิมพ์แค่สคริปต์กรอง ไม่ต้องค้นสต๊อก) · เทิร์นนี้ถามคำถามเดียวคือเครื่องนอก/เครื่องไทย ไม่ต้องถามค่ายมือถือ$P$),
  $P$  · ยังไม่เคย → เทิร์นนี้ถามแยกทางเงินสด/ผ่อนก่อน **ห้ามบอกตัวเลข** (คำว่า "ดาวน์/ฟรีดาวน์" ในสคริปต์ของเราไม่นับเป็นสัญญาณจากลูกค้า)$P$,
  $P$  · ยังไม่เคย → เทิร์นนี้ถามแยกทางเงินสด/ผ่อนก่อน **ห้ามบอกตัวเลข** (คำว่า "ดาวน์/ฟรีดาวน์" ในสคริปต์ของเราไม่นับเป็นสัญญาณจากลูกค้า) — เทิร์นนี้ไม่ต้องเรียกเครื่องมือ พิมพ์แค่ "รับเป็นเงินสด หรือผ่อนดีคะ 😊" [ตัวเลือก: เงินสด | ผ่อน]$P$),
  $P$- **เคยอธิบายความต่างของเรท/เอกสารไปแล้วในบทสนทนานี้ = ห้ามอธิบายซ้ำอีก**$P$,
  $P$- **ผลแต่ละแถวมี condition ("มือ 1" / "มือสอง")** — รุ่น+ความจุเดียวกันมีได้ทั้งสองแถวที่ตัวเลขต่างกัน → ใช้เฉพาะแถวที่ condition ตรงกับที่ลูกค้าจะซื้อ (รู้แล้วส่ง condition ไปกรองได้เลย) · ห้ามเอาเรทมือ 1 ไปบอกเป็นมือสอง หรือกลับกัน
- เทิร์นเรทครั้งแรกของบทสนทนา เรียก send_rate_card คู่กันด้วย: มือสอง → ["used_rate1", "used_rate2"] · มือ 1 → ["new_rate1", "new_rate2"] (ส่งครั้งเดียวต่อบทสนทนา · รูปเป็นตารางรวมของร้าน ข้อความยังต้องมีตัวเลขของรุ่นที่ลูกค้าสนใจตามโครง 3 ก้อนเดิม · missing = ไม่มีรูป ห้ามพูดถึงรูป)
- **เคยอธิบายความต่างของเรท/เอกสารไปแล้วในบทสนทนานี้ = ห้ามอธิบายซ้ำอีก**$P$),
  $P$- match ไม่ตรงรุ่นที่ถามเป๊ะ (ถาม 15 ได้ 15 Pro Max) → บอกตรง ๆ แบบธรรมชาติ: "รุ่น 15 ตรง ๆ เดี๋ยวทีมงานเช็คให้ค่ะ แต่ถ้า 15 Pro Max 256GB ดาวน์ 4,900 บาท ผ่อนเดือนละ 2,490 บาท 24 งวดค่ะ"$P$,
  $P$- match ไม่ตรงรุ่นที่ถามเป๊ะ (ถาม 15 ได้ 15 Pro Max) → บอกตรง ๆ แบบธรรมชาติ: "รุ่น 15 ตรง ๆ เดี๋ยวทีมงานเช็คให้ค่ะ แต่ถ้า 15 Pro Max 256GB ดาวน์ [ดาวน์จาก tool] บาท ผ่อนเดือนละ [ค่างวดจาก tool] บาท [งวดจาก tool] งวดค่ะ"$P$),
  $P$
## ขั้น 7 — แผนเข้าร้าน → ชื่อ + เบอร์ → capture_lead$P$,
  $P$- **ดูบรรทัด [เวลาร้านตอนนี้ ...] ที่ระบบแนบต้นข้อความลูกค้า: นอกเวลาทำการ ห้ามพูด "รู้ผลไวใน 5 นาที" / "รอสักครู่" / "แอดมินกำลังตอบ"** → ตอบสั้น 2 บรรทัด "ส่งเอกสารไว้ในแชทนี้ได้เลยค่ะ" / "ทีมงานเช็คให้ช่วงร้านเปิด 10 โมงนะคะ" (กติกาเดียวกันทุกจุดที่มีคำว่า 5 นาที · บรรทัดเวลาเป็นข้อความระบบ ห้ามพูดถึงหรือทวนให้ลูกค้า)

## ขั้น 7 — แผนเข้าร้าน → ชื่อ + เบอร์ → capture_lead$P$),
  $P$2. งบดาวน์: "พี่มีงบดาวน์ประมาณเท่าไหร่คะ"$P$,
  $P$   **ข้อที่ลูกค้าบอกมาเองแล้ว = ได้แล้ว ห้ามถามซ้ำ** — บอกทั้งดาวน์และงวดในข้อความเดียว (เช่น "ดาวน์ 3000 ผ่อนไม่เกิน 2000") = ครบ เรียก recommend_devices เทิร์นนี้เลย
2. งบดาวน์: "พี่มีงบดาวน์ประมาณเท่าไหร่คะ"$P$),
  $P$# คำต้องห้ามและการเรียกชื่อ$P$,
  $P$## ส่งรูปตารางผ่อน / แผนที่ร้าน (send_rate_card)
- รูปทางการชุดเดียวกับที่พนักงานส่ง ระบบแนบรูปให้เอง — ห้ามพิมพ์ลิงก์ ห้ามพิมพ์ตารางซ้ำทั้งตาราง
- จังหวะส่ง: ปุ่มโฆษณา/ถามว่าฟรีดาวน์มีรุ่นไหน → imported_free_down (ขั้น 3.5) · เทิร์นเรทแรกของเครื่องไทย → used_rate1 + used_rate2 / มือ 1 → new_rate1 + new_rate2 (ขั้น 4B) · ถามที่ตั้งร้าน/ทางมาร้าน/ขอพิกัด → shop_map
- รูปเดียวกันส่งครั้งเดียวต่อบทสนทนา — ประวัติมี "[รูป <ชื่อรูป>]" แล้ว = ลูกค้าเห็นแล้ว ห้ามส่งซ้ำ
- ผลคืน missing = ไม่มีรูปนั้น → ห้ามพูดว่า "ส่งรูปให้แล้ว" / "ดูตามรูป"
- พูดถึงรูปได้ 1 บรรทัดสั้น ๆ เช่น "ส่งตารางให้ดูด้วยนะคะ" (ระบบส่งรูปก่อนก้อนคำถามสุดท้าย)

# คำต้องห้ามและการเรียกชื่อ$P$),
  $P$6. "เคยซื้อแล้วโดนโกง" → เสียดายแทน; ร้านมีสาขาจริงที่ลพบุรี (หน้า บขส. สระแก้ว) เปิดมาหลายปี ชวนเข้ามาดูเครื่องจริงที่ร้านก่อนตัดสินใจได้เลย$P$,
  $P$6. "เคยซื้อแล้วโดนโกง" → เสียดายแทน; ร้านมีสาขาจริงที่ลพบุรี (เส้นหลัง บขส สระแก้ว) เปิดมาหลายปี ชวนเข้ามาดูเครื่องจริงที่ร้านก่อนตัดสินใจได้เลย$P$),
  $P$10. "อายุ 18/19 ผ่อนได้ไหม / นักศึกษา" → KB faq:age-requirement (20+ เอง · 17-19 ผู้ปกครองเซ็นด้วย · ต่ำกว่า 17 ไม่ได้) — ห้ามเดาอายุขั้นต่ำเป็นเลขอื่น$P$,
  $P$10. "อายุ 18/19 ผ่อนได้ไหม / นักศึกษา" → KB faq:age-requirement (อายุ 18 ปีขึ้นไปทำสัญญาเองได้ · ต่ำกว่า 18 ยังทำไม่ได้) — ห้ามเดาอายุขั้นต่ำเป็นเลขอื่น$P$),
  $P$- ของแท้/iCloud → ตอบชัดว่าไม่ติด iCloud + มีหน้าร้านจริงที่ลพบุรี$P$,
  $P$- ที่ตั้งร้าน / เวลาเปิด / ทางมาร้าน → search_knowledge_base ("ร้านอยู่ที่ไหน เปิดกี่โมง") + send_rate_card(["shop_map"]) ตอบที่อยู่และเวลาเปิดจาก KB เอง ห้าม handoff · คงการแบ่งบรรทัดตาม KB (ห้ามต่อ 2 บรรทัดเป็นบรรทัดเดียว) · ปิดท้ายถามวันที่สะดวกเข้าร้าน
- ของแท้/iCloud → ตอบชัดว่าไม่ติด iCloud + มีหน้าร้านจริงที่ลพบุรี$P$), updated_at = NOW()
WHERE key = 'shop_bot_persona_bot_extras' AND deleted_at IS NULL;
UPDATE chat_knowledge_base SET priority = 100, trigger_keywords = ARRAY[$K$อายุ$K$,$K$กี่ปี$K$,$K$ปีเท่าไหร่$K$,$K$อายุเท่าไหร่$K$,$K$17$K$,$K$18$K$,$K$19$K$,$K$ไม่ถึง 18$K$,$K$เด็ก$K$,$K$นักเรียน$K$,$K$ผู้ปกครอง$K$,$K$ค้ำ$K$,$K$ค้ำประกัน$K$]::text[], response_template = $K$อายุ 18 ปีขึ้นไป ทำสัญญาเองได้เลยค่ะ
ต่ำกว่า 18 ยังทำสัญญาไม่ได้นะคะ
นักศึกษา มีผู้ปกครองค้ำให้ค่า$K$, updated_at = NOW() WHERE id = $K$faq:age-requirement$K$ AND deleted_at IS NULL;
UPDATE chat_knowledge_base SET priority = 100, updated_at = NOW() WHERE id = $K$faq:device-lock$K$ AND deleted_at IS NULL;
UPDATE chat_knowledge_base SET priority = 100, updated_at = NOW() WHERE id = $K$faq:early-payoff$K$ AND deleted_at IS NULL;
UPDATE chat_knowledge_base SET priority = 100, updated_at = NOW() WHERE id = $K$faq:late-fee$K$ AND deleted_at IS NULL;
UPDATE chat_knowledge_base SET priority = 100, updated_at = NOW() WHERE id = $K$faq:no-payslip-freelance$K$ AND deleted_at IS NULL;
UPDATE chat_knowledge_base SET priority = 100, updated_at = NOW() WHERE id = $K$faq:paid-still-locked$K$ AND deleted_at IS NULL;
UPDATE chat_knowledge_base SET priority = 100, updated_at = NOW() WHERE id = $K$faq:payment-channel-reminder$K$ AND deleted_at IS NULL;
UPDATE chat_knowledge_base SET priority = 100, response_template = $K$โปรฟรีดาวน์ iPhone มือสอง เครื่องนอก (ของแท้ Apple โมเดลต่างประเทศ ประกันร้าน 30 วัน)
iPhone 13 128GB ผ่อนเดือนละ 1,758 บาท 12 งวด
iPhone 14 128GB ผ่อนเดือนละ 1,885 บาท 12 งวด
iPhone 15 128GB ผ่อนเดือนละ 2,395 บาท 12 งวด
iPhone 16 128GB ผ่อนเดือนละ 2,631 บาท 12 งวด
iPhone 13 Pro 128GB ผ่อนเดือนละ 2,140 บาท 12 งวด
iPhone 14 Pro 128GB ผ่อนเดือนละ 2,650 บาท 12 งวด
iPhone 15 Pro 128GB ผ่อนเดือนละ 3,288 บาท 12 งวด
iPhone 16 Pro 128GB ผ่อนเดือนละ 3,291 บาท 12 งวด
iPhone 13 Pro Max 128GB ผ่อนเดือนละ 2,395 บาท 12 งวด
iPhone 14 Pro Max 128GB ผ่อนเดือนละ 3,033 บาท 12 งวด
iPhone 15 Pro Max 256GB ผ่อนเดือนละ 3,401 บาท 15 งวด
iPhone 16 Pro Max 256GB ผ่อนเดือนละ 4,061 บาท 15 งวด
ทุกรุ่นฟรีดาวน์ ใช้บัตรประชาชนใบเดียว · แถมเคสกับฟิล์มทุกเครื่องในโปร · รุ่น/ความจุนอกรายการนี้ไม่มีในโปร
ผู้สมัครอายุ 18-59 ปี ไม่เช็คบูโร · อยู่ต่างจังหวัดทำสัญญาออนไลน์ได้ (เฉพาะโปรนี้)
ขอคืนได้ก่อนชำระงวดแรก แต่ต้องจ่ายงวดแรก 1 งวด เครื่องต้องสภาพเดิม ครบกล่องอุปกรณ์ ออก iCloud แล้ว$K$, updated_at = NOW() WHERE id = $K$promo:imported-free-down$K$ AND deleted_at IS NULL;
UPDATE chat_knowledge_base SET priority = 100, updated_at = NOW() WHERE id = $K$faq:imported-device$K$ AND deleted_at IS NULL;
UPDATE chat_knowledge_base SET priority = 100, updated_at = NOW() WHERE id = $K$faq:imported-tradein$K$ AND deleted_at IS NULL;
UPDATE chat_knowledge_base SET priority = 40, trigger_keywords = ARRAY[$K$ราคา$K$,$K$ราคาเต็ม$K$,$K$กี่บาท$K$]::text[], updated_at = NOW() WHERE id = $K$extracted:price_installment$K$ AND deleted_at IS NULL;
UPDATE chat_knowledge_base SET priority = 40, trigger_keywords = ARRAY[$K$เหลือ$K$,$K$สีไหน$K$,$K$มีของ$K$,$K$ของหมด$K$,$K$มีสีอะไร$K$]::text[], updated_at = NOW() WHERE id = $K$extracted:product_availability$K$ AND deleted_at IS NULL;
UPDATE chat_knowledge_base SET priority = 40, trigger_keywords = ARRAY[$K$เรท$K$,$K$แบบไหน$K$,$K$กี่งวด$K$,$K$กี่เดือน$K$]::text[], updated_at = NOW() WHERE id = $K$extracted:installment_terms$K$ AND deleted_at IS NULL;
UPDATE chat_knowledge_base SET priority = 60, trigger_keywords = ARRAY[$K$อนุมัติ$K$,$K$อายุงาน$K$,$K$บูโร$K$,$K$เช็คบูโร$K$,$K$ติดบูโร$K$,$K$แบล็คลิสต์$K$,$K$เครดิตไม่ดี$K$]::text[], updated_at = NOW() WHERE id = $K$extracted:approval_process$K$ AND deleted_at IS NULL;
UPDATE chat_knowledge_base SET trigger_keywords = ARRAY[$K$มือ1$K$,$K$มือ2$K$,$K$มือสอง$K$,$K$แบต$K$,$K$สภาพ$K$]::text[], updated_at = NOW() WHERE id = $K$extracted:second_hand_condition$K$ AND deleted_at IS NULL;
UPDATE chat_knowledge_base SET trigger_keywords = ARRAY[$K$ที่ไหน$K$,$K$ที่อยู่$K$,$K$อยุ่$K$,$K$แถว$K$,$K$เปิด$K$,$K$ปิด$K$,$K$กี่โมง$K$,$K$ร้านอยู่$K$,$K$บขส$K$,$K$แผนที่$K$,$K$พิกัด$K$,$K$ทางไป$K$,$K$ไปยังไง$K$]::text[], updated_at = NOW() WHERE id = $K$extracted:store_location_hours$K$ AND deleted_at IS NULL;
INSERT INTO system_config (id, key, value, label, created_at, updated_at) VALUES (gen_random_uuid()::text, 'shop_bot_rate_cards', $C${"imported_free_down": {"storageKey": "bot-media/rate-cards/imported-free-down-2026-09-22.jpg", "label": "ตารางผ่อนฟรีดาวน์ไอโฟนมือ 2 (เครื่องนอก)"}, "shop_map": {"storageKey": "bot-media/rate-cards/shop-map-2026-09-22.jpg", "label": "วิธีเดินทางมาร้าน BESTCHOICE ลพบุรี"}}$C$, $C$รูปตารางผ่อน/แผนที่ที่บอทส่งได้ (send_rate_card) — แก้รูป = อัปโหลดไฟล์ใหม่แล้วแก้ storageKey$C$, NOW(), NOW())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, label = EXCLUDED.label, updated_at = NOW(), deleted_at = NULL;
INSERT INTO system_config (id, key, value, label, created_at, updated_at) VALUES (gen_random_uuid()::text, 'shop_bot_page_autoreply_markers', $C$["อันนี้ตารางผ่อนเครื่องนอก", "ใช้บัตรประชาชนยื่นได้เลยค่ะ"]$C$, $C$คำขึ้นต้นข้อความตอบกลับอัตโนมัติของเพจ (ตั้งใน Meta) — เจอหลังข้อความลูกค้า = บอทไม่ตอบซ้ำ$C$, NOW(), NOW())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, label = EXCLUDED.label, updated_at = NOW(), deleted_at = NULL;
INSERT INTO system_config (id, key, value, label, created_at, updated_at) VALUES (gen_random_uuid()::text, 'shop_bot_stock_mode', $C$NO_STOCK$C$, $C$โหมดสต๊อกของบอทขาย: NO_STOCK = ระบบยังไม่มีรายการเครื่อง (ไม่ค้นสต๊อก ส่งเรื่องสี/รูปให้พนักงาน) · ลบแถว = โหมดปกติ$C$, NOW(), NOW())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, label = EXCLUDED.label, updated_at = NOW(), deleted_at = NULL;

-- ผลตรวจ (ต้อง ✓ ทุกบรรทัด)
SELECT CASE WHEN md5(value) = '1b958573b505bbebf62595b81049a282' THEN '✓' ELSE '✗' END || ' EXTRAS ตรงฉบับที่คาดทุกตัวอักษร len=' || length(value) FROM system_config WHERE key='shop_bot_persona_bot_extras' AND deleted_at IS NULL;
SELECT CASE WHEN count(*) = 1 THEN '✓' ELSE '✗' END || ' KB faq:age-requirement' FROM chat_knowledge_base WHERE id = $K$faq:age-requirement$K$ AND deleted_at IS NULL AND NOT (priority <> 100 OR trigger_keywords IS DISTINCT FROM ARRAY[$K$อายุ$K$,$K$กี่ปี$K$,$K$ปีเท่าไหร่$K$,$K$อายุเท่าไหร่$K$,$K$17$K$,$K$18$K$,$K$19$K$,$K$ไม่ถึง 18$K$,$K$เด็ก$K$,$K$นักเรียน$K$,$K$ผู้ปกครอง$K$,$K$ค้ำ$K$,$K$ค้ำประกัน$K$]::text[] OR response_template <> $K$อายุ 18 ปีขึ้นไป ทำสัญญาเองได้เลยค่ะ
ต่ำกว่า 18 ยังทำสัญญาไม่ได้นะคะ
นักศึกษา มีผู้ปกครองค้ำให้ค่า$K$);
SELECT CASE WHEN count(*) = 1 THEN '✓' ELSE '✗' END || ' KB faq:device-lock' FROM chat_knowledge_base WHERE id = $K$faq:device-lock$K$ AND deleted_at IS NULL AND NOT (priority <> 100);
SELECT CASE WHEN count(*) = 1 THEN '✓' ELSE '✗' END || ' KB faq:early-payoff' FROM chat_knowledge_base WHERE id = $K$faq:early-payoff$K$ AND deleted_at IS NULL AND NOT (priority <> 100);
SELECT CASE WHEN count(*) = 1 THEN '✓' ELSE '✗' END || ' KB faq:late-fee' FROM chat_knowledge_base WHERE id = $K$faq:late-fee$K$ AND deleted_at IS NULL AND NOT (priority <> 100);
SELECT CASE WHEN count(*) = 1 THEN '✓' ELSE '✗' END || ' KB faq:no-payslip-freelance' FROM chat_knowledge_base WHERE id = $K$faq:no-payslip-freelance$K$ AND deleted_at IS NULL AND NOT (priority <> 100);
SELECT CASE WHEN count(*) = 1 THEN '✓' ELSE '✗' END || ' KB faq:paid-still-locked' FROM chat_knowledge_base WHERE id = $K$faq:paid-still-locked$K$ AND deleted_at IS NULL AND NOT (priority <> 100);
SELECT CASE WHEN count(*) = 1 THEN '✓' ELSE '✗' END || ' KB faq:payment-channel-reminder' FROM chat_knowledge_base WHERE id = $K$faq:payment-channel-reminder$K$ AND deleted_at IS NULL AND NOT (priority <> 100);
SELECT CASE WHEN count(*) = 1 THEN '✓' ELSE '✗' END || ' KB promo:imported-free-down' FROM chat_knowledge_base WHERE id = $K$promo:imported-free-down$K$ AND deleted_at IS NULL AND NOT (priority <> 100 OR response_template <> $K$โปรฟรีดาวน์ iPhone มือสอง เครื่องนอก (ของแท้ Apple โมเดลต่างประเทศ ประกันร้าน 30 วัน)
iPhone 13 128GB ผ่อนเดือนละ 1,758 บาท 12 งวด
iPhone 14 128GB ผ่อนเดือนละ 1,885 บาท 12 งวด
iPhone 15 128GB ผ่อนเดือนละ 2,395 บาท 12 งวด
iPhone 16 128GB ผ่อนเดือนละ 2,631 บาท 12 งวด
iPhone 13 Pro 128GB ผ่อนเดือนละ 2,140 บาท 12 งวด
iPhone 14 Pro 128GB ผ่อนเดือนละ 2,650 บาท 12 งวด
iPhone 15 Pro 128GB ผ่อนเดือนละ 3,288 บาท 12 งวด
iPhone 16 Pro 128GB ผ่อนเดือนละ 3,291 บาท 12 งวด
iPhone 13 Pro Max 128GB ผ่อนเดือนละ 2,395 บาท 12 งวด
iPhone 14 Pro Max 128GB ผ่อนเดือนละ 3,033 บาท 12 งวด
iPhone 15 Pro Max 256GB ผ่อนเดือนละ 3,401 บาท 15 งวด
iPhone 16 Pro Max 256GB ผ่อนเดือนละ 4,061 บาท 15 งวด
ทุกรุ่นฟรีดาวน์ ใช้บัตรประชาชนใบเดียว · แถมเคสกับฟิล์มทุกเครื่องในโปร · รุ่น/ความจุนอกรายการนี้ไม่มีในโปร
ผู้สมัครอายุ 18-59 ปี ไม่เช็คบูโร · อยู่ต่างจังหวัดทำสัญญาออนไลน์ได้ (เฉพาะโปรนี้)
ขอคืนได้ก่อนชำระงวดแรก แต่ต้องจ่ายงวดแรก 1 งวด เครื่องต้องสภาพเดิม ครบกล่องอุปกรณ์ ออก iCloud แล้ว$K$);
SELECT CASE WHEN count(*) = 1 THEN '✓' ELSE '✗' END || ' KB faq:imported-device' FROM chat_knowledge_base WHERE id = $K$faq:imported-device$K$ AND deleted_at IS NULL AND NOT (priority <> 100);
SELECT CASE WHEN count(*) = 1 THEN '✓' ELSE '✗' END || ' KB faq:imported-tradein' FROM chat_knowledge_base WHERE id = $K$faq:imported-tradein$K$ AND deleted_at IS NULL AND NOT (priority <> 100);
SELECT CASE WHEN count(*) = 1 THEN '✓' ELSE '✗' END || ' KB extracted:price_installment' FROM chat_knowledge_base WHERE id = $K$extracted:price_installment$K$ AND deleted_at IS NULL AND NOT (priority <> 40 OR trigger_keywords IS DISTINCT FROM ARRAY[$K$ราคา$K$,$K$ราคาเต็ม$K$,$K$กี่บาท$K$]::text[]);
SELECT CASE WHEN count(*) = 1 THEN '✓' ELSE '✗' END || ' KB extracted:product_availability' FROM chat_knowledge_base WHERE id = $K$extracted:product_availability$K$ AND deleted_at IS NULL AND NOT (priority <> 40 OR trigger_keywords IS DISTINCT FROM ARRAY[$K$เหลือ$K$,$K$สีไหน$K$,$K$มีของ$K$,$K$ของหมด$K$,$K$มีสีอะไร$K$]::text[]);
SELECT CASE WHEN count(*) = 1 THEN '✓' ELSE '✗' END || ' KB extracted:installment_terms' FROM chat_knowledge_base WHERE id = $K$extracted:installment_terms$K$ AND deleted_at IS NULL AND NOT (priority <> 40 OR trigger_keywords IS DISTINCT FROM ARRAY[$K$เรท$K$,$K$แบบไหน$K$,$K$กี่งวด$K$,$K$กี่เดือน$K$]::text[]);
SELECT CASE WHEN count(*) = 1 THEN '✓' ELSE '✗' END || ' KB extracted:approval_process' FROM chat_knowledge_base WHERE id = $K$extracted:approval_process$K$ AND deleted_at IS NULL AND NOT (priority <> 60 OR trigger_keywords IS DISTINCT FROM ARRAY[$K$อนุมัติ$K$,$K$อายุงาน$K$,$K$บูโร$K$,$K$เช็คบูโร$K$,$K$ติดบูโร$K$,$K$แบล็คลิสต์$K$,$K$เครดิตไม่ดี$K$]::text[]);
SELECT CASE WHEN count(*) = 1 THEN '✓' ELSE '✗' END || ' KB extracted:second_hand_condition' FROM chat_knowledge_base WHERE id = $K$extracted:second_hand_condition$K$ AND deleted_at IS NULL AND NOT (trigger_keywords IS DISTINCT FROM ARRAY[$K$มือ1$K$,$K$มือ2$K$,$K$มือสอง$K$,$K$แบต$K$,$K$สภาพ$K$]::text[]);
SELECT CASE WHEN count(*) = 1 THEN '✓' ELSE '✗' END || ' KB extracted:store_location_hours' FROM chat_knowledge_base WHERE id = $K$extracted:store_location_hours$K$ AND deleted_at IS NULL AND NOT (trigger_keywords IS DISTINCT FROM ARRAY[$K$ที่ไหน$K$,$K$ที่อยู่$K$,$K$อยุ่$K$,$K$แถว$K$,$K$เปิด$K$,$K$ปิด$K$,$K$กี่โมง$K$,$K$ร้านอยู่$K$,$K$บขส$K$,$K$แผนที่$K$,$K$พิกัด$K$,$K$ทางไป$K$,$K$ไปยังไง$K$]::text[]);
SELECT CASE WHEN count(*) = 3 THEN '✓' ELSE '✗' END || ' system_config ใหม่ ' || count(*) || '/3' FROM system_config WHERE key IN ('shop_bot_rate_cards','shop_bot_page_autoreply_markers','shop_bot_stock_mode') AND deleted_at IS NULL;
COMMIT;
