# ช่องสาขาหน้านัดหมาย — ทวนหลังผู้ใช้แจ้ง 17 ตุลาคม 2026

ช่อง `สาขาที่ดู` และ `สาขา` ยังเป็น native select เดิมจริง ก่อนแก้ computed appearance=auto,
padding-right=12px และไม่มี SVG ลูกศรที่กำหนดระยะ ตรวจรอบก่อนวัดความสูง/ฟอนต์/viewport
แต่ไม่ได้ยืนยันลูกศรใน control นี้ จึงพลาด defect ไม่ใช่หลักฐานว่าปัญหาเกิดจาก cache หรือ zoom

## การแก้

- StoreAppointmentsPage: สาขาที่ดู + พนักงานรับแทน
- SlotPicker: สาขา (ใช้ร่วมกับหน้าลูกค้า `/visit`)
- Schedule: พนักงานรับนัด
- ทั้ง 4 ช่องใช้ NativeSelect: 2.75rem, icon 1rem, inset .75rem ภายใน border,
  padding-right 2.5rem แยกข้อความกับลูกศร; handlers/value/validation เดิม
- พบเพิ่มใน WebKit 320px/root20: ชื่อสาขายาวทำให้ anonymous content ของ select
  ดัน scrollWidth หน้าเป็น 365px แม้กรอบ field อยู่ในจอ 320px. ทดลอง overflow:hidden
  ที่ select แล้วหาย จึงเพิ่ม overflow-hidden ใน NativeSelect; ไม่ clip wrapper/focus ring

## ผลที่ผ่านแล้ว

- [Chromium 42 states](chromium.json), [WebKit 42 states](webkit.json): 3 แท็บ × 7 viewport/root configs × 2 themes;
  ความสูง/ฟอนต์/แนว toolbar, ลูกศร inset/center, ระยะข้อความ, label gap, visible focus
  แบบเทียบก่อน–หลัง, no horizontal overflow, exact controls และ rendered theme
- 320px/root20 ใช้ชื่อสาขา/พนักงานยาวที่แทนเฉพาะ display-name ใน response สำหรับทดสอบ
- [API จริง ฐานแยก 6 cases](actual-api.json): 1440,390,320/root20 ต่อ engine,
  เลือกสาขาด้านบนแล้วฟอร์มเปลี่ยนตาม และย้อนกลับจากฟอร์ม, ตรวจ request branchId/URL,
  เลือกพนักงาน, คงสาขาในปฏิทิน, focus/Tab จากสาขาไปวันที่
- [พนักงานรับแทน 4 cases](reassignment-ui.json): 1440/root16 และ320/root20 ต่อengine,
  ใช้ UI fixture ชื่อยาว, เลือกค่าแล้วปุ่มยืนยัน enabled, กลับแล้วปิดฟอร์ม, ไม่มี POST
- ภาพ [ก่อน](before.png), [หลัง desktop](after-desktop.png), [หลัง mobile/root20](after-mobile.png)
- [review](review.md): ผ่านหลังแก้ข้อบกพร่องในตัวตรวจ

## ขอบเขต/ข้อจำกัด

ใช้ข้อมูลทดสอบและฐานแยก ไม่มีการเขียนข้อมูล production. การเลือก option ใช้ Playwright
selectOption; keyboard ตรวจ focus/Tab. ไม่อ้าง native OS popup ลูกศรขึ้น/ลงครบทุกอุปกรณ์:
headless บน macOS ไม่เปลี่ยนค่าด้วย ArrowDown/Enter แม้ใน HTML select เปล่า

การตรวจรอบนี้ไม่ใช่การยืนยันทุกหน้า/ทุกปุ่มของระบบ. ยังไม่มีเครื่อง iPhone/Android จริงหรือ
LINE provider จริงตามข้อจำกัดเดิม. local:check รอบสุดท้ายผ่าน 39 checks เวลา 06:26:11 UTC
ดู [ผล local:check](local-check.json) และ [fields บน preview ที่รีสตาร์ต](fresh-preview.json).
Fingerprint: `01811cbcb7590c2d6343cbd5c692d69a9d425503ef871000637a921ed8419ee6`.
ผลนี้แยกจากหลักฐาน baseline เดิมของระบบ

ภาพช่องสาขาจาก preview ล่าสุด: [ฟอร์มนัดหมาย](after-form.png).

[ทวน flow นัดหมายหลัง restart — PASS](acceptance-final.json): เพิ่มช่วงรับนัด, จองโดยพนักงาน,
เปิดลิงก์ส่วนตัว, มือถือเลื่อน/ยกเลิก, ลูกค้าจองเอง, slot conflict/recovery,
check-in/service/complete, revoke link และข้อความยืนยันในแชทจำลอง. ใช้ controller/service/DB
ของ preview แยก ไม่มีข้อความถูกส่งออกหา LINE จริง
