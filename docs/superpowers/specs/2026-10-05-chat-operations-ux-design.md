# UX/UI: BESTCHOICE Chat Operations

วันที่ 2026-10-05 · Interactive prototype ใช้ข้อมูลสมมติทั้งหมด ไม่เชื่อม API/Meta/ฐานข้อมูล

## หน้าที่หลักและทิศทาง

พนักงานขาย/ฝ่ายเครดิต/หัวหน้าต้องเห็นงานถัดไปและทำต่อได้ในแชทเดิม ใช้โครงรายการแชท–บทสนทนา–ข้อมูลลูกค้าที่มีอยู่ ปรับลำดับข้อมูลและการแสดงสถานะ ไม่เปลี่ยน navigation บริษัทหรือเจ้าของยอดขาย

Tokens: surface `#FFFFFF`, background `#F6F7F8`, ink `#24272B`, emerald primary `#09764F`, amber text `#945F0B`, public-context blue `#285E9A`. ทุก component อ้าง CSS semantic tokens. สีเหลืองใช้กับรอ/นัด ไม่ใช้เป็นตัวอักษรบนพื้นขาวแบบเหลืองสด

Typography: IBM Plex Sans Thai สำหรับหัวเรื่องและเนื้อหา (ตรงกับระบบเดิม); IBM Plex Mono สำหรับเวลา/จำนวนเพื่อเทียบแถวได้ง่าย. หัวเรื่อง 20/17/14px, เนื้อหา 13–14px, metadata 10–12px

Signature: การ์ด “งานถัดไป” ที่หัวแผงขวา แสดง action + owner + due ก่อนรายละเอียดเครดิต/เอกสาร การตัดสินใจนี้ช่วยลดเวลาค้น ไม่ใช่ decoration เพิ่ม

## โครงที่เลือก

```text
Desktop
หมวดงาน | คิวและตัวกรอง | ลูกค้า / ผู้ดูแล / ปิดงาน | งานถัดไป
 SHOP   | แชทรอตอบ      | แชท + โน้ต + งานส่งต่อ    | ขั้นขายจริง
 FINANCE| นัดวันนี้      | ตอบลูกค้า / โน้ตภายใน     | ลูกค้า / บริการ

Mobile
คิวงาน → แชท → ข้อมูลลูกค้า/งานถัดไป
         ↑ กลับได้      ↑ เปิดเป็นหน้าภายใน ไม่ย่อสามคอลัมน์
```

พิจารณา dashboard-first แล้วตัดออก เพราะคนตอบแชทต้องเปิดบทสนทนาเร็ว คิวและรายงานแยกกัน. ไม่เพิ่ม Kanban ของลูกค้าซ้ำกับ Journey เดิม

## Interaction contracts

1. เปิดอ่านไม่ล้าง waiting; ส่งสำเร็จเท่านั้นที่เปลี่ยนเป็นตอบแล้ว; ส่งล้มเก็บข้อความและมี retry
2. นัดติดตามเป็น dialog ที่มี action/date/assignee; บันทึกแล้วปรากฏในงานถัดไปและคิววันนี้
3. ส่งงานมี next action/due/assignee; read notification ไม่เท่ากับรับงาน; รับงานและเสร็จงานต้องเป็น explicit actions; แสดงเจ้าของแชทแยกจากผู้รับงาน
4. Note composer มีสีพื้นและ label “ลูกค้าไม่เห็น”; Mention เลือกบุคคลจริงจากรายการ; เนื้อหาโน้ตไม่กลายเป็นข้อความลูกค้า
5. Public comment มี banner และปุ่ม “ตอบสาธารณะ”; composer ไม่มี template เครดิต; identity ของคอมเมนต์ไม่ถูกเชื่อมกับลูกค้าอัตโนมัติ
6. รับเรื่องหลังการขายก่อนรับฝากเครื่อง; ผูกเคสเดิมแสดงรายการที่ตรวจคน/เครื่องแล้วในระบบจริง; prototype ใช้ตัวอย่างการจับคู่ที่กำหนดไว้เท่านั้น
7. รายงานแยกคน/บอท/ไม่ทราบ; ค้างปัจจุบันแยกจากช่วงรายงาน; ตัวเลขนำกลับไปคิวได้

## สิ่งที่ให้ทดลองในต้นแบบ

- ตอบลูกค้า, จำลองส่งล้มและส่งใหม่, ตั้งนัด, ส่งงาน, เปลี่ยนเป็นผู้รับเพื่อรับ/จบงาน
- สลับตอบลูกค้า/โน้ต เลือก Mention และเปิดศูนย์แจ้งเตือน
- คอมเมนต์สาธารณะ, รับเรื่องหลังการขายและผูกเคสตัวอย่าง, รายงานและกดดูแชทค้าง
- สลับ SHOP/FINANCE, ค้นหาและกรอง, desktop/tablet/mobile, reset ข้อมูลจำลอง

## ขอบเขตและการส่งต่อ implementation

HTML/CSS/JS ใน `docs/prototypes/chat-operations/` เป็น design artifact ที่รันเองได้ ไม่ใช่ React route ใหม่ ไม่เป็น implementation ของ permissions, persistence, credit approval, accounting หรือ Meta. State เก็บใน memory และ reset เมื่อ reload; ไม่มีคำสั่งส่งออกภายนอก

เมื่อทำจริงใช้ shadcn/Radix, lucide-react, React Query, api client และ tokens ของแอปตาม frontend rules; native dialog ในต้นแบบแทน Radix dialog; status region แทนการแจ้งเตือนของระบบจริง. รายละเอียด permissions/transactions และ acceptance ใช้ [แผนหลัก](../plans/2026-10-05-chat-operations-master.md)

Prototype นี้ใช้ light theme เพื่อรีวิวโครงและ flow; dark theme/สิทธิ์จริง/ข้อมูลจำนวนมากต้องตรวจในแอปจริง ไม่อ้างว่าต้นแบบนี้พิสูจน์แล้ว

## Revision: 6 October 2026 — V2 source parity

The user requested `ui-ux-pro-max` and a full comparison with the original Inbox. V2 supersedes the first prototype's navigation and simplified customer panel. Keep the existing three chat views and four dossier tabs; expose daily follow-up work separately. Restored controls and production handoff boundaries are recorded in the [source parity audit](../../reports/2026-10-06-chat-ux-v2-parity.md). Prototype: http://localhost:5286; archived V1: http://localhost:5286/v1/.

Use the existing domain components during integration. The standalone prototype demonstrates interactions and placement; it is not production code or a replacement for GFIN, credit, customer identity, media upload, contract, payment or MDM workflows.
