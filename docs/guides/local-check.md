# ตรวจและเปิด local หลังแก้โค้ด

รันจาก checkout ที่เพิ่งแก้:

```bash
npm run local:check
```

คำสั่งจะ generate Prisma clients, ตรวจ TypeScript ของ API/Web, lint โดยไม่แก้ไฟล์อัตโนมัติ, ทดสอบ Web/Shared, build Web แล้วเปิดหรือรีเฟรช preview ของ checkout นี้ ตรวจ Inbox บน Chromium ที่ 1440px และ 390px ก่อนรายงานว่าผ่าน ถ้ามีขั้นตอนไหนล้มจะคืน exit code ที่ไม่ใช่ศูนย์และไม่อ้างว่าผ่าน

หลังผ่าน เปิด **http://localhost:5195/inbox** ได้ต่อแม้คำสั่งตรวจจบแล้ว ดูผล/ภาพ/บันทึก server ใน `.tmp/local-preview/` ซึ่งไม่เข้า Git:

- `check.json`: เวลา, source fingerprint, ขั้นตอนที่ผ่าน/ล้ม และ URL ที่ตรวจ
- `checks.log`: ผลตรวจฉบับเต็ม รวม lint warnings; หน้าคำสั่งแสดงความคืบหน้าแบบย่อ
- `inbox-1440.png`, `inbox-390.png`: ภาพหน้าจอ
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

## ขอบเขตของผลตรวจ

Preview นี้ใช้ข้อมูลและ AI จำลองสำหรับ Inbox, ตรวจเครดิต, เตรียมข้อเสนอ และส่งต่อไปทำสัญญา ไม่ส่งแชทจริงหรืออ่านข้อมูล production และไม่ใช่ backend เต็มของทุกเมนู

Basic checks ไม่แทนการทดสอบ feature ที่แก้ หากแก้การเงิน/API ให้ใช้ชุด PostgreSQL แยกที่มีอยู่ เช่น `bash tools/test-chat-credit.sh`; เลือก `CREDIT_RUN_API_REGRESSION=1` เมื่อต้องตรวจ API เต็มชุด ฟีเจอร์นอกขอบเขต preview ต้องเปิด app/API ที่รองรับจาก checkout เดียวกันและตรวจ flow นั้นเพิ่มเติม ห้ามรายงานว่าทุกฟีเจอร์ผ่านจาก Inbox smoke เพียงหน้าเดียว

ขั้นตอนส่งงานถาวรอยู่ใน `AGENTS.md`: ตรวจโค้ด เปิด local ล่าสุด ลอง flow ที่แก้ แล้วส่งลิงก์ให้ผู้ใช้ทุกครั้ง การตรวจ local ไม่ได้สั่ง merge/deploy
