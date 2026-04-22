-- Backfill customers.line_id from customer_line_links (FINANCE channel)
-- Reason: verification.service.ts:bind() เดิม sync แค่ CustomerLineLink +
-- chatRoom.customerId แต่ไม่ update customer.line_id ทำให้ LIFF หน้า
-- /liff/contract หาสัญญาไม่เจอ (ขึ้น "ไม่มีสัญญา") แม้ customer ผูก LINE
-- ผ่าน chatbot Finance แล้ว
--
-- ตั้งแต่ commit นี้เป็นต้นไป bind() จะ sync customers.line_id ด้วย —
-- migration นี้ sync ย้อนหลังสำหรับ links ที่มีอยู่

UPDATE customers c
SET line_id = l.line_user_id
FROM customer_line_links l
WHERE l.customer_id = c.id
  AND l.channel = 'FINANCE'
  AND l.unlinked_at IS NULL
  AND (c.line_id IS NULL OR c.line_id = '');
