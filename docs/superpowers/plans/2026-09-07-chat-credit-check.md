# ตรวจเครดิตจากสเตทเม้นในแผงแชท — รอบ 1

ผู้ใช้เคาะ mockup ในบทสนทนาวันที่ 2026-09-07 แล้ว อ้างอิง `.claude/HANDOFF-credit-check-chat-panel.md` โดยข้อกำหนดใน handoff มีผลเหนือภาพ mockup ที่ยังมีช่องรหัสรอบ 2

1. เขียนและรัน regression tests ให้ล้มก่อน: PDF ล็อก/ปลอม, OCR upstream 400, affordablePayment และ label fallback
2. เก็บไฟล์เป็น storage key ผูกห้อง และเก็บผลแต่ละรอบพร้อมรายการ file IDs; แนบกับวิเคราะห์แยกกัน รับ PDF/JPEG/PNG/GIF/WebP ไม่เกิน 10MB ต่อไฟล์ สูงสุด 10 ไฟล์ตาม OCR เดิม; HEIC แจ้งให้ใช้ PDF/JPEG/PNG แทน
3. นำไฟล์จากแชทโดยส่ง messageId ให้ server ตรวจสิทธิ์ห้องและ message-room membership, ตรวจ host/redirect/ขนาด/magic bytes และเก็บไฟล์จริง ไม่ fetch Meta จาก browser
4. ขยาย POST /ocr/bank-statement ให้รับ roomId + fileIds จาก storage ได้ คงเส้นทาง filesBase64 เดิม; timeout ฝั่งเว็บ 120000ms และป้องกันวิเคราะห์พร้อมกัน ผล OCR ไม่มีข้อมูลรายเดือนต้องไม่เดาว่าเป็นรายเดือน
5. ผูกผลที่อ่านเสร็จเข้าประวัติลูกค้าและคิว /credit-checks เป็น MANUAL_REVIEW เมื่อห้องมี customerId; ไม่ผ่าน legacy create/auto-score และเก็บผลแต่ละรอบไม่ทับประวัติเดิม
6. เพิ่มการ์ดตาม mockup ด้วย Group เดิมในแท็บข้อมูลลูกค้า, drop ทั้ง aside, ปุ่มบนบับเบิลทุกจอ, toast เปิด Sheet, ref ต่อ instance ไม่มี fixed id, เปลี่ยนป้าย drop ทั้งสองฝั่ง
7. ให้ code-reviewer ตรวจ, แก้ด้วยเทสต์แดงก่อนทุกครั้ง; รัน types ทั้ง api/web, Jest ที่เกี่ยวข้อง --runInBand, Vitest inbox และ browser flow ด้วยข้อมูลสังเคราะห์
8. ตรวจ SQL migration บนฐานทดสอบแยกเท่านั้น ไม่ใช้ API ที่ชี้ production และไม่รัน deploy/merge จากงานนี้

Runtime ที่ผู้ใช้เปิด localhost:5176 มาจาก worktree `fix-po-expected-date`; งานนี้แก้ repo BESTCHOICE หลักตาม handoff และจะทดสอบจาก checkout ที่แก้จริง เพื่อไม่อ้างว่าพอร์ตเดิมสะท้อนงานนี้โดยอัตโนมัติ
