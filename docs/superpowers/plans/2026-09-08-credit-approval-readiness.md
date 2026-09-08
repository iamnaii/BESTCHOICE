# ตรวจปุ่มอนุมัติและความพร้อมใช้งานจริง — 8 กันยายน 2026

ผู้ใช้อนุญาตให้ทำขั้นก่อนใช้งานจริงต่อ และให้ตรวจปุ่มอนุมัติหน้า localhost:5187/credit-checks โดยใช้ mockup ที่เคาะแล้ว ไม่เปลี่ยนเกณฑ์หรือสิทธิ์เอกสาร

1. เปิด Chromium ตรวจ modal และ API จริงใน preview แยก ตรวจข้อมูลไม่ครบ/เพดาน 0/ยอดเกิน/เปลี่ยนตัวเลข/บันทึกซ้ำ/สถานะและสิทธิ์/มือถือ
2. Red-first tests แล้วแก้ปุ่มที่ส่ง transition ไม่ได้ แสดงยอดอนุมัติจริง เปิดหลักฐาน/ประวัติได้ตรงแท็บ กันปิดหรือแก้ระหว่างบันทึก และอธิบายเพดาน 0
3. อ่านตำแหน่ง provider/storage จาก config deploy เดิม ทดสอบบริการจริงด้วยเอกสารสังเคราะห์ก่อน ไม่ดึงเอกสารลูกค้าจาก prod และไม่แสดงหรือบันทึกค่า key
4. เพิ่ม isolated PostgreSQL integration ตั้งแต่อนุมัติถึงลงนาม/ACTIVE/รับชำระ โดยใช้ journal services จริงและตรวจยอดบัญชี ไม่แทนสูตรด้วย stub หรือ charges=0
5. ปิด CI incompatibility ของ isolated tests ให้รันได้บน Ubuntu โดยยังป้องกันฐานจริง เตรียม feature branch/PR แยกจาก PR audit และไม่รวมไฟล์งานอื่น
6. รัน review, tests, types/build และ browser อีกครั้ง บันทึกผลที่เห็นจริง จึงดำเนินขั้น release ที่ผ่าน prerequisites

ฐานทดสอบ local เดิม: /tmp/bc-chat-credit.8jw94a47; ห้ามฆ่าตามชื่อหรือพอร์ต ใช้เฉพาะ PID ของ runner ที่เราสร้าง. รอที่มาของ config จากผู้ใช้ไม่พบข้อมูล; ผู้ใช้ตอบไม่แน่ใจ จึงตรวจ config deploy เดิมต่อได้. ห้ามอ้างว่าเชื่อมบริการจริงผ่านจนกว่าจะได้ผลรันจริง

ผล: ขั้น 1–5 และการตรวจ local ในขั้น 6 ผ่านแล้ว ดูรายงาน docs/review/2026-09-07-chat-credit-verification.md. เตรียม release บน feat/chat-credit-approval จาก origin/main แยก worktree; production ยังรอ CI/review/คำสั่ง merge ตาม handoff.
