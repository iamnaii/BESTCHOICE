# ตรวจและเปิด local หลังแก้โค้ด

รันจาก checkout ที่เพิ่งแก้:

```bash
npm run local:check
```

คำสั่งจะ generate Prisma clients, ตรวจ TypeScript ของ API/Web, lint โดยไม่แก้ไฟล์อัตโนมัติ, ทดสอบ Web/Shared, build Web แล้วเปิดหรือรีเฟรช preview ของ checkout นี้ ตรวจ Inbox, ลูกค้า และพอร์ตสัญญา FINANCE บน Chromium ที่ 1440px และ 390px รวมถึงการกรองสถานะ รูปแบบข้อมูลรายงาน ผลรวมเมื่อแบ่งหน้า และช่วงวันที่ไม่มีข้อมูลก่อนรายงานว่าผ่าน ตรวจทั้ง console error และ ErrorBoundary เพื่อจับข้อผิดพลาดที่ React จัดการไว้ ถ้ามีขั้นตอนไหนล้มจะคืน exit code ที่ไม่ใช่ศูนย์และไม่อ้างว่าผ่าน

หลังผ่าน เปิด **http://localhost:5195/inbox** ได้ต่อแม้คำสั่งตรวจจบแล้ว ดูผล/ภาพ/บันทึก server ใน `.tmp/local-preview/` ซึ่งไม่เข้า Git:

- `check.json`: เวลา, source fingerprint, ขั้นตอนที่ผ่าน/ล้ม และ URL ที่ตรวจ
- `checks.log`: ผลตรวจฉบับเต็ม รวม lint warnings; หน้าคำสั่งแสดงความคืบหน้าแบบย่อ
- `inbox-1440.png`, `inbox-390.png`, `finance-portfolio-1440.png`, `finance-portfolio-390.png`: ภาพหน้าจอ
- `server.log`: ข้อผิดพลาดเมื่อเปิด preview
- `state.json`: เฉพาะ process และฐานทดสอบของ checkout นี้

ถ้าแก้ source ระหว่างรัน ผลตรวจจะไม่ถูกนับว่าผ่าน ต้องรันใหม่ หลังแก้ API/shared/schema คำสั่งจะรีสตาร์ต backend ของตัวเอง โดยเก็บฐานทดสอบเดิม ถ้าโค้ดไม่เปลี่ยนจะใช้ server เดิม

```bash
npm run local:status   # ตรวจว่า server พร้อมและตรงกับ source ปัจจุบัน
npm run local:preview  # เปิด/รีเฟรชอย่างเดียว ไม่อ้างว่าผ่าน tests
npm run local:stop     # หยุดเฉพาะชุด server ที่คำสั่งนี้สร้าง เก็บข้อมูลทดสอบไว้
```

ถ้าพอร์ตถูกใช้โดย session อื่น คำสั่งจะไม่หยุดโปรแกรมนั้น เลือกพอร์ตว่างครั้งแรกได้ เช่น `LOCAL_PREVIEW_PORT=5196 npm run local:check` แล้วคำสั่งถัดไปจะจำพอร์ตของ checkout นี้ ดู URL ที่รายงานจริงแทนการเดาพอร์ต

ต้องมี dependencies, Chromium ของ Playwright และ PostgreSQL 16 พร้อม pgvector ตั้ง `CREDIT_PG_BIN` ได้ถ้าไม่ได้ติดตั้งในตำแหน่งมาตรฐาน ข้อมูลทดสอบอยู่ `/tmp/bc-chat-credit.*`; หลังระบบล้าง `/tmp` preview จะสร้างข้อมูลตัวอย่างใหม่

### Windows

`npm run local:preview` / `local:status` / `local:stop` ใช้บน Windows ได้ (ทดสอบบน Windows 11 + Node 24) ต้องมี **Docker Desktop ที่เปิดอยู่** และ **Git for Windows** — ไม่ต้องติดตั้ง PostgreSQL เอง

- ฐานข้อมูลทดสอบรันในคอนเทนเนอร์ `pgvector/pgvector:pg16` ชื่อ `bc-chat-credit-<รหัส>` เปิดเฉพาะ `127.0.0.1` พอร์ตสุ่ม รหัสผ่านสุ่มเก็บใน `%TEMP%\bc-chat-credit.<รหัส>\pg-password` (Prisma ใช้ Unix socket บน Windows ไม่ได้ และ PostgreSQL ที่ลงในเครื่องไม่มี pgvector)
- ข้อมูลทดสอบอยู่ใน Docker volume ชื่อเดียวกับคอนเทนเนอร์ — `local:stop` หยุดคอนเทนเนอร์แต่เก็บ volume ไว้ เปิดครั้งถัดไปได้ข้อมูลเดิม · `<รหัส>` คือส่วนท้ายของ `dataDir` ใน `.tmp\local-preview\state.json` (เช่น `bc-chat-credit.rSlMkI` → `rSlMkI`) · อยากเริ่มข้อมูลใหม่: `npm run local:stop` แล้ว `docker volume rm bc-chat-credit-<รหัส>` (เปิดครั้งถัดไปสร้างฐานใหม่เอง ไม่ต้องลบไฟล์อื่น) · ถ้า Windows ล้างโฟลเดอร์ `%TEMP%` ไป preview จะสร้างโฟลเดอร์และ volume ชุดใหม่ ส่วน volume เก่าค้างอยู่ — ดูด้วย `docker volume ls -q --filter name=bc-chat-credit-` แล้วลบตัวที่ไม่ใช้
- **ถ้าตัวรันถูกปิดกะทันหัน** (ปิดจาก Task Manager, ปิด VS Code ระหว่างเปิดครั้งแรก ฯลฯ) หน้าเว็บ/ฐานข้อมูลอาจยังรันค้าง — รัน `npm run local:stop` หรือ `npm run local:preview` อีกครั้ง คำสั่งจะหยุดของที่ค้างของ checkout นี้เอง (ตรวจจากรหัสรอบการรันและชื่อ/ป้ายของคอนเทนเนอร์ ไม่แตะของ checkout อื่น) · ถ้ายังไม่หาย: `docker stop bc-chat-credit-<รหัส>` แล้วรันใหม่
- ฐานข้อมูลสร้างแบบเดียวกับฝั่ง Linux/Mac (`--no-locale`, โซนเวลาของเครื่อง) — มีผลกับ volume ที่สร้างใหม่เท่านั้น
- ตัวรันคือ `tools/preview-chat-credit-win.mjs` (คู่กับ `tools/preview-chat-credit.sh` ของ Linux/Mac — แก้ฝั่งหนึ่งต้องดูอีกฝั่ง) · Windows ไม่มี SIGTERM จึงสั่งหยุดด้วยไฟล์ `stop.request` ในโฟลเดอร์ข้อมูล
- กฎ "ฐานทดสอบเท่านั้น" ของ fixture ทุกตัวอยู่ที่ `apps/api/e2e/support/preview-database.ts` ที่เดียว (เทส: `apps/api/src/utils/preview-database-guard.spec.ts`) · บน Windows ฐานต้องเป็นของโฟลเดอร์ preview นั้นจริง — รหัสผ่านใน URL ต้องตรงกับไฟล์ `pg-password` ของโฟลเดอร์
- เปิดครั้งแรกนานกว่าปกติ (ดึง image + migrate) จึงรอได้ถึง 7 นาที (`LOCAL_PREVIEW_START_TIMEOUT_MS`) · หลังเปิด หน้าแรกอาจหมุนสักครู่ระหว่าง Vite คอมไพล์ครั้งแรก
- **`npm run local:check` ยังไม่รองรับ Windows** — หยุดตั้งแต่ขั้นแรก "Local tooling": `tools/local-preview.test.mjs` และ `tools/preview-chat-credit.test.mjs` ใช้ `/tmp`, SIGTERM และตัวรัน bash · ใช้ `local:preview` เพื่อเปิดดูหน้าจอ แล้วรันขั้นตรวจที่ต้องการแยกเอง

## ขอบเขตของผลตรวจ

ตรวจรับซื้อด้วยบริการจริงบนฐานตัวอย่าง: Quick Buy เงินสด/โอน → ลายเซ็น → ส่งต่อสินค้า → ตั้งราคา → รูป 6 มุม → เข้าคลัง และพิมพ์ PDF บนจอใหญ่ ภาพ `trade-in-payment-*.png`, `trade-in-handoff-*.png`, `trade-in-stock-*.png` อยู่ใน `.tmp/local-preview/` การตรวจแต่ละรอบเพิ่มรายการรับซื้อและสินค้าใหม่เฉพาะฐานตัวอย่าง

ตรวจการเลือกหมวดงานที่แถบข้างด้วย: งานหน้าร้านส่ง request scope เป็น SHOP งานการเงินเป็น FINANCE ไม่มีตัวเลือกบริษัทซ้ำที่ TopBar ตรวจการรีเฟรช ย้อนกลับ/ไปข้างหน้า และบริษัทที่จำไว้ในหน้าตั้งค่า ภาพอยู่ที่ `work-company-1440.png` และ `work-company-390.png` หน้า Dashboard เรียกบริการอ่านจริงบนฐานตัวอย่าง โดยไม่ใช้ cache facade; ผลนี้ไม่รับรองการแยกข้อมูลบริษัทในทุก endpoint

Preview นี้ใช้ข้อมูลและ AI จำลองสำหรับ Inbox, ลูกค้า, ตรวจเครดิต, เตรียมข้อเสนอ, ส่งต่อไปทำสัญญา และพอร์ตสัญญา FINANCE โดยรายงานเรียกบริการอ่านข้อมูลเดียวกับ API จริงบนฐานทดสอบ มีสัญญาตัวอย่างปกติ/ค้างชำระและไม่เขียนทับเมื่อรีสตาร์ต ไม่ส่งแชทจริงหรืออ่านข้อมูล production และไม่ใช่ backend เต็มของทุกเมนู Endpoint ที่ไม่รองรับจะตอบ 501 แทนการส่ง array ว่างที่ทำให้หน้าแสดงยอดศูนย์ผิดหรือพัง

Basic checks ไม่แทนการทดสอบ feature ที่แก้ หากแก้การเงิน/API ให้ใช้ชุด PostgreSQL แยกที่มีอยู่ เช่น `bash tools/test-chat-credit.sh`; เลือก `CREDIT_RUN_API_REGRESSION=1` เมื่อต้องตรวจ API เต็มชุด ฟีเจอร์นอกขอบเขต preview ต้องเปิด app/API ที่รองรับจาก checkout เดียวกันและตรวจ flow นั้นเพิ่มเติม ห้ามรายงานว่าทุกฟีเจอร์ผ่านจาก Inbox smoke เพียงหน้าเดียว

ขั้นตอนส่งงานถาวรอยู่ใน `AGENTS.md`: ตรวจโค้ด เปิด local ล่าสุด ลอง flow ที่แก้ แล้วส่งลิงก์ให้ผู้ใช้ทุกครั้ง การตรวจ local ไม่ได้สั่ง merge/deploy
