-- Task 39 — ลิงก์ชำระรู้ตัวว่า "ผูกงวด" หรือไม่ (หน้า /pay/:token ตัดสินจากข้อมูลแทนการเดาจากยอด)
-- true  = ยอดของลิงก์คือยอดคงค้างของงวดที่ผูก → หน้าเว็บส่งเลขงวด และ intent เทียบยอดกับงวดนั้น (พฤติกรรมเดิม)
-- false = ยอดไม่ใช่ยอดของงวดเดียว (ปิดยอด · ยอดค้างรวมแจ้งล็อก · ยอดนัด) → intent ใช้ยอดของลิงก์ที่เก็บไว้ · webhook กระจาย FIFO
-- แถวเดิมได้ false: ลิงก์มีอายุ 24 ชม. — ลิงก์ที่ค้างตอน deploy จ่ายผ่านทางไม่ผูกงวด (ยอด = ยอดของลิงก์ · webhook FIFO เริ่มที่งวดค้างแรก)
-- additive · NOT NULL DEFAULT ไม่ rewrite ตาราง
ALTER TABLE "payment_links" ADD COLUMN "installment_bound" BOOLEAN NOT NULL DEFAULT false;
