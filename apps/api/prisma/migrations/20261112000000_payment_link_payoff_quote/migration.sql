-- Task 41 — ลูกค้าปิดยอดเองผ่าน QR ในไลน์ลงเป็นปิดยอดก่อนกำหนด (JP4) จริง (คำตัดสินเจ้าของ #43)
-- payoff_quote = ยอดปิดที่ server คำนวณตอนสร้าง intent ปิดยอด (แถวติดตาม PAYOFF ของ create-intent) — ยอด · % ส่วนลด · วันที่ของ quote
--   (ปฏิทินไทย) · webhook คำนวณยอดปิดใหม่ ณ เวลาที่เงินเข้าด้วย % เดียวกัน แล้วลง JP4 เมื่อยอดตรง ±0.01 (ไม่ตรง = FIFO เดิม + งานแจ้งพนักงาน)
-- null = ไม่ใช่ intent ปิดยอด หรือแถวก่อน migration (เงินเข้าแบบ FIFO เดิม) · additive nullable · ไม่ rewrite ตาราง · ไม่มี backfill
ALTER TABLE "payment_links" ADD COLUMN "payoff_quote" JSONB;
