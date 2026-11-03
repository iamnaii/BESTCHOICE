-- Task 33 (mockup A2 "ห้อง LINE การเงินที่ยกเลิกผูกแล้ว") — ห้องจำเวลาที่หลุดจากการยืนยัน OTP
-- ตั้งโดย clearFinanceRoomVerification (ยกเลิกผูกทาง LIFF/พนักงาน · LINE ย้ายลูกค้า) · bind ล้างเมื่อยืนยันกลับ
-- nullable ไม่มีค่าเริ่มต้น — ไม่ rewrite ตาราง · ห้องที่หลุดก่อน deploy ใช้วันที่จากแถว customer_line_links ที่ปิดแทน
ALTER TABLE "chat_rooms" ADD COLUMN "finance_line_unlinked_at" TIMESTAMP(3);
