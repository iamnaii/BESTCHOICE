# BESTCHOICE — ผลการปรับหน้าเริ่มงานและส่วนกลาง AI

วันที่: 8 กันยายน 2026

ทำงานใน worktree `BESTCHOICE-ai-native`, branch `codex/ai-native-staff-experience` แยกจาก session ตรวจเครดิต โค้ดที่กำลังแก้ใน workspace เดิมไม่ได้ถูกนำมารวมในงานนี้

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
| Web unit/component suite ทั้งหมด | 229 suites / 1,575 tests ผ่าน |
| API ที่เกี่ยวกับ AI, ค่างวด, preview และงานส่วนตัว | 15 suites / 145 tests ผ่าน |
| ชุด shared calculator | 33 tests ผ่าน |
| API auto-reply regression เพิ่มเติม | ผ่านในชุดตรวจของผู้ทำ AI |
| TypeScript API + web | ผ่าน |
| ESLint เฉพาะ source/test ที่เปลี่ยน | ผ่าน |
| Web production build พร้อม manifest | ผ่าน |
| API production build + Prisma generate + ตรวจ contract template asset | ผ่าน |
| CommonJS runtime จากไฟล์ compiled เท่านั้น | ผ่าน รวม layout แบบ Docker workspace symlink |

ไม่ได้รัน migration หรือเปลี่ยนข้อมูลจริง การทดสอบ AI ใช้ mock provider; ยังไม่ได้ประเมินคุณภาพคำตอบหรือค่าใช้จ่ายกับโมเดลจริง

เครื่องนี้ไม่มี Docker CLI / Node 20 จึงยังไม่ได้ build และ boot container จริง การตรวจ CommonJS ใช้ Node 24 โดยปิด TypeScript stripping และ require(ESM) พร้อมจัดไฟล์เหมือน runtime image

## ผลเรื่องความหนักของโค้ด

จาก manifest ของ production build เปรียบเทียบ static imports ของ entry เดียวกัน:

| JavaScript เริ่มต้น | ก่อน | หลัง |
| --- | ---: | ---: |
| จำนวนไฟล์ | 143 | 68 |
| ขนาดก่อนบีบอัด | 2,259,302 bytes | 1,776,774 bytes |
| ผลรวมขนาด gzip ของแต่ละไฟล์ | 659,193 bytes | 536,508 bytes |

gzip ลดประมาณ **18.6%** ตัวเลขนี้วัด dependency graph จาก build ไม่ใช่เวลาโหลดของผู้ใช้จริง และไม่รวม dynamic imports หลังเลือก route

นับไฟล์ source ที่เปลี่ยนใต้ apps/packages (ไม่รวม tests/config JSON/docs/tools) พบจำนวนบรรทัดกายภาพสุทธิเพิ่ม **103 บรรทัด** เนื่องจากเพิ่มหน้าเริ่มงานและการจัดการสถานะ ไม่ได้อ้างว่าจำนวนบรรทัดทั้งระบบลดลง ประโยชน์ด้านการดูแลคือเลิกมีสูตรคำนวณสองชุดและส่วนเรียก AI ที่ต้องแก้ซ้ำ พร้อมลด JavaScript ที่โหลดตั้งแต่เริ่ม

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
```

การทดสอบ browser ใช้ `tools/verify-staff-experience.mjs` กับข้อมูลจำลองทั้งหมด ไม่ต้องล็อกอินหรือเชื่อม API จริง ดูวิธีเรียกและตำแหน่ง evidence ในตัวสคริปต์
