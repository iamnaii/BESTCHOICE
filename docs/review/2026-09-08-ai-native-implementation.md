# BESTCHOICE — ผลการปรับหน้าเริ่มงานและส่วนกลาง AI

วันที่: 8 กันยายน 2026

ทำงานใน worktree `BESTCHOICE-ai-native`, branch `codex/ai-native-staff-experience` โดยอิง `main` ที่ `289d0d4a2` แยกจาก session ตรวจเครดิต โค้ดที่กำลังแก้ใน workspace เดิมไม่ได้ถูกนำมารวมในงานนี้

## สิ่งที่ทำแล้ว

### หน้าเริ่มงานสำหรับพนักงานขาย

- หน้าแรก SALES มีปุ่มขายสินค้า ทำสัญญาผ่อน รับชำระค่างวด และตอบแชท พร้อมคำอธิบายสั้น
- มีค้นหาลูกค้าหรือสัญญา คำแนะนำสำหรับคนใหม่ที่เปิดดูซ้ำได้ งานของตนที่ครบกำหนดวันนี้ และสรุปยอดขายเดิม
- หน้า SALES โหลดแยกจาก dashboard ผู้จัดการ จึงไม่เรียกชุดข้อมูล dashboard ของผู้จัดการ
- งานวันนี้ใช้ `assigneeId=me` ที่ API แปลงจากผู้ใช้ที่ล็อกอิน ลิงก์ไปหน้างานคงตัวกรองผู้รับผิดชอบและวันไว้
- แก้ summary ของงานให้ใช้ขอบเขตผู้รับมอบหมาย/ห้อง/สาขา/คำค้นเดียวกับรายการ และหยุดเรียกรายชื่อผู้ใช้เต็มจาก `/users` สำหรับผู้ไม่มีสิทธิ์ OWNER
- เมื่อโหลดงานหรือสรุปยอดล้มเหลว ยังใช้ปุ่มเริ่มงานได้และกดลองใหม่ได้

### เมนูและการโหลดหน้าตั้งค่า

- ชื่อหลักของงานใช้ร่วมกันใน sidebar, ช่องค้นหา และ top bar เช่น “ขายสินค้า”, “คลังสินค้า”, “ติดตามลูกค้า”
- ย้าย quick actions มาเป็น config กลางร่วมกับหน้าเริ่มงาน คงคำเดิมอย่าง POS เป็นคำค้น
- แก้ Command Palette ให้กรองเมนูตามคำค้น โดยยังแสดงผลค้นข้อมูลจาก server ได้ และจำกัดแถบตัวกรองงานให้อยู่ในความกว้างจอมือถือ
- แก้ quick action สร้างสัญญาให้แสดงเฉพาะ OWNER / BRANCH_MANAGER / SALES ตาม route และ API จริง และกำหนด role ของรับชำระให้ชัด
- หน้าตั้งค่าและฟอร์ม 36 ตัวเปลี่ยนเป็น lazy loading โดยคง metadata, route, role และข้อมูลฟอร์มเดิม
- มีสถานะกำลังโหลดเฉพาะส่วน; hash link ไป section รอให้ฟอร์ม lazy โหลดเสร็จก่อนเลื่อน แล้วหยุดติดตามเพื่อไม่ดึงผู้ใช้กลับระหว่างแก้ฟอร์ม

### AI สำหรับข้อความ

- เพิ่ม `AiTextService` ใน global module ที่มีอยู่ รวมการสร้าง client, เรียกโมเดล และบันทึก token usage
- ย้ายการสรุปแชท ปรับน้ำเสียง และแนะนำคำตอบให้ใช้บริการนี้ รักษา prompt, model, token limit, cache และ fallback เดิม
- บันทึก usage หนึ่งครั้งต่อ model call และรอการบันทึก; ความล้มเหลวของ telemetry ไม่ทำให้ผล AI ที่สำเร็จเสียไป
- กำหนด timeout ของ provider 30 วินาทีและปิด retry อัตโนมัติ ระยะเวลาของ endpoint ทั้งหมดยังรวมการอ่านข้อมูลและบันทึก usage จึงไม่ได้รับประกันว่าจบภายใน 30 วินาที
- ไม่เปลี่ยน provider policy ของ SHOP, OCR, เครดิต หรือโครงสร้างฐานข้อมูล

### สูตรค่างวดแหล่งเดียว

- สูตรและ types ที่เคยมีสำเนา 150 + 99 บรรทัดใน API เปลี่ยนเป็น compatibility exports จาก `@installment/shared`
- ไม่เปลี่ยนตัวสูตร ใช้ implementation เดียวกับ frontend และเครื่องมือ AI
- shared สร้าง CommonJS/declarations สำหรับ API ที่รันด้วย Node; Docker ส่ง shared artifacts ไปด้วย
- เพิ่ม shared build ก่อน API build/dev/test/e2e/watch/coverage และ typecheck เพื่อรองรับการใช้ dependency cache
- วิธีพัฒนาและข้อจำกัดของ watch อยู่ใน `packages/shared/README.md`

## หลักฐานการตรวจ

| รายการ | ผล |
| --- | --- |
| Web unit/component suite ทั้งหมด | 230 suites / 1,583 tests ผ่าน |
| API ที่เกี่ยวกับ AI, ค่างวด, preview และงานส่วนตัว | 15 suites / 145 tests ผ่าน |
| ชุด shared calculator | 33 tests ผ่าน |
| API auto-reply regression เพิ่มเติม | ผ่านในชุดตรวจของผู้ทำ AI |
| TypeScript API + web | ผ่าน |
| ESLint เฉพาะ source/test ที่เปลี่ยน | ผ่าน |
| Web production build พร้อม manifest | ผ่าน |
| API production build + Prisma generate + ตรวจ contract template asset | ผ่าน |
| CommonJS runtime บน Node 20.20.2 จากไฟล์ compiled เท่านั้น | ผ่าน รวม layout แบบ Docker workspace symlink |
| Browser บน desktop 1440px / mobile 390px | ปุ่มหลักถูกต้อง, ค้น POS ได้, ตัวกรองงานคงอยู่, ไม่มี horizontal overflow หรือ JavaScript/console errors |

ไม่ได้รัน migration หรือเปลี่ยนข้อมูลจริง การทดสอบ AI ใช้ mock provider; ยังไม่ได้ประเมินคุณภาพคำตอบหรือค่าใช้จ่ายกับโมเดลจริง

เครื่องนี้ไม่มี Docker CLI จึงยังไม่ได้ build และ boot container จริง การตรวจ CommonJS ใช้ Node 20.20.2 ผ่าน npm cache โดยจัดไฟล์เหมือน runtime image ไม่มี shared source หรือ TypeScript runtime hooks และยืนยันว่า API กับ shared ส่งออก function ตัวเดียวกันทั้ง 4 ตัว

## ผลเรื่องความหนักของโค้ด

วัดไฟล์ JavaScript ที่ browser ร้องขอจริงก่อนเริ่มคลิก ใน production build ของหน้า SALES โดยใช้ข้อมูลจำลองเดียวกัน ทั้งสอง build ใช้ Vite 8.0.12 / TypeScript 5.9.3 และ dependencies จาก worktree เดียวกัน ข้อมูลฐานคือ `main` ที่ `289d0d4a2`

| JavaScript เริ่มต้น | ก่อน | หลัง |
| --- | ---: | ---: |
| จำนวนไฟล์ที่ร้องขอ | 157 | 82 |
| ผลรวมขนาด gzip ของแต่ละไฟล์ | 680,916 bytes | 549,242 bytes |

gzip ลด **19.34%** (131,674 bytes) ตัวเลขนี้คำนวณโดย gzip ไฟล์ที่ร้องขอ ไม่ใช่จำนวน bytes บนสาย network หรือเวลาโหลดของผู้ใช้จริง ไม่รวมไฟล์ที่โหลดเพิ่มหลังเลือกงาน หน้า SALES ไม่โหลด ManagementDashboard แต่ shared chunks ของกราฟ/PDF ยังถูกโหลดจาก entry

หลักฐาน: [ผล browser แบบ JSON](assets/2026-09-08-staff-experience/browser-verification.json), [ภาพ desktop](assets/2026-09-08-staff-experience/final-sales-desktop.png), [ภาพมือถือ](assets/2026-09-08-staff-experience/final-sales-mobile.png) ภาพใช้ข้อมูลจำลองและ system font เพราะปิดการเชื่อมต่อ font ภายนอกในทั้งสอง build

นับไฟล์ source ที่เปลี่ยนใต้ apps/packages (ไม่รวม tests/config JSON/docs/tools) พบจำนวนบรรทัดกายภาพสุทธิเพิ่ม **109 บรรทัด** เนื่องจากเพิ่มหน้าเริ่มงานและการจัดการสถานะ ไม่ได้อ้างว่าจำนวนบรรทัดทั้งระบบลดลง ประโยชน์ด้านการดูแลคือเลิกมีสูตรคำนวณสองชุดและส่วนเรียก AI ที่ต้องแก้ซ้ำ พร้อมลด JavaScript ที่โหลดตั้งแต่เริ่ม

## ส่วนที่ยังรอการรวมกับงานตรวจเครดิต

ตามขอบเขตที่ตกลงให้ทำคู่ขนาน ยังไม่แก้ flow ตรวจเครดิต, OCR, สร้างสัญญา, Inbox หรือไฟล์ schema ที่อีก session กำลังทำอยู่:

- การพาลูกค้าไปตรวจเครดิตแล้วกลับมาทำสัญญาต่อ
- การขยาย AI กลางไปงานภาพ/PDF/เครดิต และการส่งบริบทผู้เรียกเพิ่มผ่าน controller ของแชท
- การเพิ่ม workflow AI ใหม่และจัดองค์ประกอบภายใน Inbox / หน้าชำระเงินขนาดใหญ่

หลัง session เครดิตเสร็จ ต้องรวม branch แล้วทดสอบ flow เครดิต → สัญญา → รับชำระ และปุ่ม AI ในแชทร่วมกันก่อนปล่อยใช้งาน

การทดสอบพนักงานใหม่ 3–5 คนยังต้องทำกับคนจริง ภาพและ browser smoke ใช้ตรวจการแสดงผล/เส้นทางเท่านั้น ไม่ใช่หลักฐานว่าพนักงานทุกคนเข้าใจระบบแล้ว

## วิธีตรวจซ้ำ

```bash
./tools/check-types.sh all
npm run test --workspace @installment/web
npm run test --workspace @installment/shared
npm run test --workspace @installment/api -- --testPathPattern='installment-calc|calculate-installment|installment-preview|installment-parity|todos.*(summary|room)|ai-(text|assistant|suggest|usage)|staff-chat.controller|shop-ai-flow'
npm run build --workspace @installment/web -- --manifest
npm run build --workspace @installment/api
npm exec --yes --package=node@20 -- node tools/verify-shared-runtime.cjs .
```

การทดสอบ browser ใช้ `tools/verify-staff-experience.mjs` กับข้อมูลจำลองทั้งหมด ไม่ต้องล็อกอินหรือเชื่อม API จริง ดูวิธีเรียกและตำแหน่ง evidence ในตัวสคริปต์
