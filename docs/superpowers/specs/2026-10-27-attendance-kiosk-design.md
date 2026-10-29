# ลงเวลาทำงานผ่านเครื่องประจำสาขา (ก้อน 10 · D3) — Design

**วันที่:** 2026-10-27 · **สถานะ:** ทำแล้ว 2026-10-27 บนสาขา `feat/attendance-kiosk` (web 26.10.61 · รอ merge) · ผ่าน builder check (§15) · mockup canvas `Fb1mrEzhcDssYCDRYLRRe7` (เจ้าของสั่ง "ทำต่อเลย") · **ผู้ตัดสิน:** เจ้าของ (ตอบคำถามเอง 27/10) · **ก้อนก่อนหน้า:** 8 A10 ถังขยะ (#1736) · **ก้อนถัดไป:** 9 D4 เงินเดือน/OT ใช้ข้อมูลจากก้อนนี้

Base: `main` `03528ea0a` (web 26.10.60 — มี epic employee-access #1737 ที่ยังหลับ `accessManaged=false`) · สาขา `feat/attendance-kiosk` · worktree `.claude/worktrees/attendance-kiosk`

---

## 1. เจตนาและเหตุผล

ร้านลงเวลาด้วย**เครื่องสแกนนิ้ว**อยู่ ปัญหาที่เจ้าของยืนยัน (27/10): ข้อมูลค้างอยู่ในเครื่อง ต้องดึงออกมานั่งนับสาย/ขาด/OT เองทุกสิ้นเดือน และเปิดสาขาใหม่ต้องซื้อเครื่องเพิ่ม เจ้าของสั่ง **เลิกเครื่องสแกนแล้วทำในระบบแทน** โดยมีเงื่อนไขเดียวที่เน้นหนัก: **ต้องตอกจากที่อื่นไม่ได้** (GPS อย่างเดียวไม่พอ เพราะหลอกพิกัดได้)

ทางที่เล็กกว่าที่พิจารณาแล้วตัดออก: นำเข้าไฟล์จากเครื่องสแกนเดิม (แก้การนับมือได้ แต่ยังต้องซื้อเครื่องต่อสาขา และเจ้าของสั่งเลิกเครื่อง) · ตอกจากมือถือพนักงาน + QR หมุนรหัสบนจอร้าน (ถ่ายจอส่งไลน์ให้คนนอกสแกนทันได้ ต้องพึ่ง Wi-Fi ร้านเพิ่ม และสุดท้ายก็ต้องมีจอที่ร้านอยู่ดี)

## 2. เป้าหมาย / ไม่ทำ / ห้ามเกิด

**เป้าหมาย**
- G1 พนักงานตอกเข้า-ออกงานได้เฉพาะบน "เครื่องประจำสาขา" ที่เจ้าของลงทะเบียน (แท็บเล็ต/มือถือเก่า 1 เครื่องต่อสาขา)
- G2 ข้อมูลเข้าระบบทันที: วันนี้ใครมา/สาย/ยังไม่มา · สรุปรายเดือนต่อคน (วันทำงาน สาย ขาด ลา ชั่วโมง OT)
- G3 กติกานับสาย/OT ตามที่เจ้าของกำหนด (§5) คำนวณโดยระบบ ไม่ต้องนับมือ
- G4 เปิดสาขาใหม่ = ลงทะเบียนเครื่องใหม่ ไม่ซื้ออุปกรณ์เฉพาะ

**ไม่ทำในก้อนนี้ (non-goals)**
- คิดเงิน OT / หักสาย / รายวัน เข้าบรรทัดเงินเดือน → ก้อน 9 D4 (ก้อนนี้เก็บ**ชั่วโมง OT ตามกติกาเศษนาที**และ**นาทีสาย**ไว้ให้พร้อมใช้)
- กะเช้า/บ่าย ตารางเวลาต่างกันต่อคน (ทุกสาขา 10:00–19:00 ทุกวัน พนักงานเข้า-ออกเวลาเดียวกันทั้งร้าน — เจ้าของยืนยัน)
- ตรวจจับใบหน้าอัตโนมัติ (รูปเป็นหลักฐานย้อนหลัง ไม่ใช่ด่านตอนกด)
- คิวออฟไลน์ (ไม่มีเน็ต = ไม่บันทึก และต้องบอกชัด)
- ส่งแจ้งเตือนทาง LINE พนักงาน (ท่อ #1735 มีแล้ว แต่ก้อนนี้ใช้ **งานใน /todos** ก่อน — ต่อ LINE เป็น follow-up หนึ่งบรรทัดถ้าเจ้าของต้องการ)
- ลางานแบบมีสิทธิ์ลา/โควต้าวันลา — มีแค่ "ผจก.บันทึกให้ว่าวันนี้ลา/ป่วย/หยุด"

**ห้ามเกิด (anti-goals)**
- A1 ตอกจากนอกร้านได้โดยระบบไม่รู้ตัว — token ที่ถูกคัดลอกไปเครื่องอื่นต้องชนกับเครื่องจริงและเจ้าของได้แจ้งเตือน (§4.3)
- A2 เวลาที่ใช้ตัดสินมาจากนาฬิกาของอุปกรณ์ — ต้องเป็นเวลาเซิร์ฟเวอร์เท่านั้น
- A3 รูปพนักงานหลุดไปคนที่ไม่เกี่ยว — เปิดดูได้เฉพาะ OWNER และ ผจก.สาขาตัวเอง และมีอายุเก็บ
- A4 route ใหม่ถูก guard ของ epic ตอบ 403 UNCLASSIFIED — ทุก route ต้องลงทะเบียนใน access manifest (§8)
- A5 ระบบบอกว่า "บันทึกแล้ว" ทั้งที่คำขอไม่ถึงเซิร์ฟเวอร์

## 3. ข้อเท็จจริงของระบบที่ออกแบบจากมัน (ตรวจ 27/10)

- ไม่มีโมเดล/หน้าจอเรื่องลงเวลา กะ ลา วันหยุดร้าน เลย · สิ่งใกล้สุดคือ `StaffAppointmentWindow` (ช่วงนัดลูกค้าต่อพนักงาน — สเปกของมันตัด HR ออกชัดเจน)
- OT ในเงินเดือน = ยอดเงินพิมพ์มือใน `payroll_custom_income` (บัญชี 53-1103 / S52-1202) ไม่มีช่องชั่วโมง · `PayrollLine` ไม่มีวันทำงาน/สาย/ขาด
- พนักงาน: `User` (branchId · employeeId · failedLoginAttempts/lockedUntil มีอยู่แล้วสำหรับรหัสผ่าน · `lineId` ค้นหาเพื่อน · `staffLineUserId` ของ #1735) + `EmployeeProfile` 1:1 (position · employmentType MONTHLY/DAILY/CONTRACT · baseSalary · ssoEligible · bank · resignedDate) — **ไม่มีรหัสตอกบัตร ไม่มีตารางงาน ไม่มีวันหยุดประจำ**
- สาขา: `Branch` ไม่มีเวลาเปิด-ปิด ไม่มีพิกัด · เวลาร้านเป็นค่าคงที่ `shop-hours.util.ts` 10–19 กับ `after-hours.service.ts` 10–20 (ขัดกัน) · prod มี **1 สาขา** (= คลังหลัก) ณ 27/10
- วันหยุดราชการ `apps/api/src/data/thai-holidays.json` (2569–2570 ดูแลมือ ใช้กับกฎทวงหนี้) · ตัวช่วยวันไทย `utils/date.util.ts` (`bangkokStartOfDay` · `bangkokCalendarParts` · `bangkokMidnight`)
- แอปพนักงานเป็น PWA ติดตั้งได้ (`apps/web/public/manifest.json` + `sw.js`) · มีตัวอย่างอ่าน GPS ใน `components/signing/StepSignature.tsx` · ไม่มีตัวอย่างเปิดกล้องในเว็บ (ต้องใช้ `getUserMedia` — HTTPS บน prod ใช้ได้)
- ตัวตนทุกอย่างเป็น JWT ต่อผู้ใช้ (`apps/web/src/lib/api.ts` in-memory + refresh cookie) · **ไม่มีแนวคิด "อุปกรณ์"** · refresh token ใช้ **hash + หมุนทุกครั้ง + ตรวจชนกัน** (`auth.service.ts` `createRefreshToken` / `hashToken` / "Concurrent refresh") = แบบที่จะเลียนสำหรับเครื่องประจำสาขา
- endpoint ที่ไม่มี JWT ต้องเป็น controller แยกแบบ `finance-share-public.controller.ts` (`@SkipCsrf()` · throttle · token ในพาธ) และต้องอยู่ในรายการ "Intentionally Public Endpoints" ของ `.claude/rules/security.md`
- epic #1737: ทุก route อยู่ใน `apps/api/src/modules/employee-access/access-policy.manifest.json` (classification `staff` 1354 · `public` 54 · `self-service` 10 · `integration` 12 · `customer` 31) + catalog key ใน `packages/shared/src/employee-access.ts` (เช่น `'trash.manage': ['กู้คืน…', 'system', 'OWNER']`) · ตรวจด้วย `node tools/check-access-coverage.mjs` = 0 error
- เก็บไฟล์: `StorageService.upload(key, body, contentType)` (S3) · cron ลบข้อมูลตามอายุมีแบบ `audit-retention.cron.ts` / `login-audit-retention.cron.ts`
- งานติดตาม: `TodosService` (cron ใบรับเครื่องคืนสร้าง Todo ต่อใบ) · ตั้งค่า: `apps/web/src/config/settings-registry.tsx` (กลุ่ม `สาขา` · `ผู้ใช้` · `ความปลอดภัย` …)
- AuditLog: เขียน `audit.log` **หลัง commit** (ห้ามใน tx) · ถ้าต้อง atomic ใช้ `tx.auditLog.create` (หลุด Merkle chain โดยตั้งใจ) — `.claude/rules/database.md`

## 4. การตอกบัตร

### 4.1 เครื่องประจำสาขา (`AttendanceDevice`)

- เจ้าของสร้างจากหน้า ตั้งค่า › บริษัท & สาขา › **เครื่องตอกบัตร**: เลือกสาขา ตั้งชื่อ (เช่น "แท็บเล็ตเคาน์เตอร์") → ระบบออก **รหัสลงทะเบียน 8 ตัว อายุ 10 นาที ใช้ครั้งเดียว**
- บนแท็บเล็ต เปิด `/kiosk` (หน้าสาธารณะ ไม่ต้องล็อกอิน) กรอกรหัสลงทะเบียน → เซิร์ฟเวอร์ผูกเครื่องกับสาขา ออก **device token** (สุ่ม 256 บิต · เก็บเฉพาะ hash · แบบ `hashToken` ของ auth) → เบราว์เซอร์เก็บ token ไว้ (IndexedDB/localStorage ของเครื่อง) และแนะนำให้ "ติดตั้งเป็นแอป" (PWA)
- สถานะเครื่อง: `ACTIVE` · `REVOKED` (เจ้าของกดยกเลิก เครื่องหาย/เปลี่ยนเครื่อง) · `LOCKED` (ระบบล็อกเองเมื่อ token ชน §4.3 — เจ้าของกดปลดแล้วต้องลงทะเบียนใหม่)
- หนึ่งสาขามีได้หลายเครื่อง (เผื่อเครื่องสำรอง) แต่ค่าเริ่มต้น 1

### 4.2 หน้าตอกบัตร (`/kiosk`)

- หน้าจอเดียว โหมดเต็มจอ: ชื่อสาขา · นาฬิกา (แสดงเวลาจากเซิร์ฟเวอร์ที่ sync ตอนโหลด ไม่ใช่นาฬิกาเครื่อง) · ปุ่มใหญ่ **เข้างาน** / **ออกงาน** · แป้นตัวเลขกรอก**รหัสตอกบัตร 6 หลัก** · ช่องกล้องถ่ายหน้าอัตโนมัติตอนกดยืนยัน (แสดงภาพตัวอย่างก่อนกด)
- ลำดับ: กดเข้า/ออก → กรอกรหัส → กล้องถ่าย 1 ภาพ (ย่อฝั่งเครื่องให้ ≤ 200 KB JPEG) → ส่ง `POST /kiosk/punch` {deviceToken, pin, kind, photo} → เซิร์ฟเวอร์ตอบ ชื่อเล่น + เวลา + สถานะ (ตรงเวลา/สาย x นาที · OT y ชม.) แสดง 5 วินาทีแล้วกลับหน้าหลัก
- รหัสตอกบัตร = 6 หลัก **ต่อพนักงาน ไม่ซ้ำกันทั้งบริษัท** เก็บเป็น HMAC hash บน `User.attendancePinHash` (§9) · ตั้ง/รีเซ็ตได้โดย OWNER จากหน้าผู้ใช้ (ระบบสุ่มให้แล้วแสดงครั้งเดียว) · **ใครก็ตามที่มีรหัสตอกได้ทุกเครื่อง** (ไปช่วยต่างสาขา) — แถววันตกที่สาขาของเครื่อง · ผจก.เห็นแถวที่ `branchId` = สาขาตัวเอง **หรือ** พนักงานสังกัดสาขาตัวเอง · พนักงานที่ไม่มีรหัส (ส่วนกลาง/FINANCE) ไม่ถูกนับขาด
- รหัสผิด 5 ครั้งใน 15 นาที (นับต่อเครื่อง+ต่อพนักงานที่รหัสตรง? — **ตัดสิน: นับต่อเครื่อง**) → เครื่องนั้นรับรหัสไม่ได้ 15 นาที + แจ้งเตือนเจ้าของ (กันเดารหัส)
- ไม่มีเน็ต/เซิร์ฟเวอร์ไม่ตอบ → แสดง "ยังไม่ได้บันทึก — ลองใหม่" สีแดง ไม่มีปุ่มสำเร็จหลอก (A5)
- ไม่มีปุ่มออกจากโหมดเครื่องตอกบัตร: เครื่องถูกยกเลิก/ล็อกจากเซิร์ฟเวอร์เท่านั้น (คำตอบ 401 `DEVICE_REVOKED` → หน้าจอกลับไปหน้าลงทะเบียน) · **เครื่องนี้ใช้ตอกบัตรอย่างเดียว** (ไม่ใช่เครื่อง POS) · PWA ของเครื่องตอกบัตรต้องมี **manifest แยก** (`/kiosk/manifest.webmanifest` — `id`/`start_url`/`scope` = `/kiosk/`) เพราะ `apps/web/public/manifest.json` ตั้ง scope `/` และติดตั้งซ้อนกันบนเครื่องเดียวไม่ได้ · `sw.js` ต้องปล่อยคำขอใต้ `/kiosk` ผ่านตรง และตอนออฟไลน์ห้ามพาไปหน้า `/` ที่แคชไว้ (`sw.js:71-73`)

### 4.3 กัน "ตอกจากที่อื่น" — token ใช้ครั้งเดียวแล้วหมุน (แก้ตาม builder check — ไม่ลอก grace ของ auth)

- เครื่องถือ token รุ่นปัจจุบัน (`generation` N) · ทุกคำขอ `POST /kiosk/punch` / `heartbeat` ส่ง token + `requestId` (uuid ที่เครื่องสุ่มต่อคำขอ) · เซิร์ฟเวอร์ตรวจ hash ของรุ่นปัจจุบัน → ออก **token รุ่น N+1 ในคำตอบ** (**รีวิวรอบสุดท้าย: หมุนเฉพาะเมื่องานสำเร็จ ใน tx เดียวกับงาน** — รหัสผิด/409/500 ไม่หมุน token เดิมยังใช้ได้) และเก็บ **ประวัติทุกรุ่น** (`AttendanceDeviceToken` {deviceId · generation · tokenHash · issuedAt · usedAt?}) ไม่ใช่แค่รุ่นก่อนหน้า
- **คำตอบหาย/ส่งซ้ำ**: คำขอเดิม (token รุ่นเดิม + `requestId` เดิม ภายใน 5 นาที) ได้**คำตอบเดิมจากแคช** (`AttendanceDeviceRequest` {deviceId · requestId · responseJson = {status, body, consumedGeneration} · createdAt}) ไม่หมุนซ้ำ — คำตอบสำเร็จที่หายได้ token รุ่นถัดไปที่ออกใหม่ (re-key รุ่นที่ยังไม่ถูกใช้ · แคชไม่มี token ดิบ) · ไม่จำกัด 5 นาที · สองคำขอแข่งกันหมุนรุ่นเดียวกัน = ผู้แพ้ได้ 409 `REQUEST_BUSY` ⇒ เครื่องจริงไม่ล็อกตัวเองเมื่อเน็ตสะดุด (auth ใช้ grace 10 วินาที + ออกคู่ใหม่ — แบบนั้นแตกเป็นสองสายและทำเครื่องจริงล็อก จึง**ไม่ลอก**)
- **ชน** = คำขอที่มี token รุ่น ≤ N−1 กับ `requestId` ที่ไม่เคยเห็น (หรือรุ่นที่ไม่มีในประวัติ) ⇒ มีคนถือ token ที่หมุนไปแล้ว → เครื่องเป็น `LOCKED` ทันที · `AttendanceDeviceEvent TOKEN_CONFLICT` (IP/UA ของคำขอที่ชนและของรุ่นปัจจุบัน) · ทุกแถวตอกของเครื่องนี้ตั้งแต่ **จุดแยก = เวลาที่ token รุ่นที่ถูกนำมาใช้ซ้ำถูกใช้ไป** ถึงเวลาชน ติดธง `DEVICE_CONFLICT` (รีวิวรอบสุดท้าย: เดิมเขียนว่า "heartbeat สะอาดครั้งสุดท้าย" ซึ่ง heartbeat ของเครื่องที่คัดลอกเลื่อนไปได้ · แถววันติดธงตาม (คน, วัน) ของทุกการกดที่สงสัย) (รอเจ้าของตรวจ — ไม่ลบ) · Todo HIGH ถึงเจ้าของ "เครื่องตอกบัตร <ชื่อ> ถูกใช้จากสองที่ — ล็อกแล้ว ตรวจรายการที่ติดธงก่อนปลด"
- Heartbeat ทุก 10 นาทีตอนหน้าเปิดอยู่ ⇒ ขณะเครื่องจริงเปิด token ที่ถูกคัดลอกตายภายใน ≤ 10 นาที · **แท็บเล็ตปิดข้ามคืน**: token ที่คัดลอกไปใช้ต่อได้จนเครื่องจริงเปิดอีกครั้ง — ทุกครั้งที่ใช้ถูกบันทึกเป็นรายการตอกปกติ แล้วถูกติดธง `DEVICE_CONFLICT` ย้อนหลังทั้งชุดตอนเครื่องจริงกลับมา (A1 = "เจ้าของเห็นเสมอ" ไม่ใช่ "ตอกไม่ได้เลย")
- สัญญาณประกอบ (ไม่ใช่ด่าน): เก็บ IP + User-Agent ทุกครั้ง · ถ้าเครื่องอนุญาต GPS เก็บพิกัดตอนตอกด้วย · หน้าเจ้าของโชว์ "เครือข่าย/พิกัดเปลี่ยนจากครั้งก่อน" เป็นธง ⚑ บนรายการตอก
- เก็บ device token ไว้ใน IndexedDB ของเครื่อง — **ข้อยกเว้นของกฎ `security.md` "ห้ามเก็บ token ใน localStorage"** (กฎนั้นว่าด้วย JWT ของผู้ใช้ · ตัวนี้เป็นรหัสประจำอุปกรณ์ที่หมุนทุกคำขอและไม่ให้สิทธิ์อะไรนอกจากตอกบัตร) → ต้องเขียนข้อยกเว้นลงกฎพร้อมกันใน PR

### 4.4 รูปถ่าย (หลักฐาน)

- เก็บที่ S3 key `attendance/<yyyy>/<mm>/<punchId>.jpg` ผ่าน `StorageService.upload` · ไม่เก็บ data URI ใน DB (บทเรียนก้อน 2)
- ดูได้ผ่าน `GET /attendance/punches/:id/photo` (OWNER ทุกสาขา · BRANCH_MANAGER เฉพาะสาขาตัวเอง — ขอบเขตสาขาทำใน service ตาม `security.md`) **stream ไบต์ผ่าน API** (prod เก็บบน GCS · backend local ออก signed URL ไม่ได้ — `storage.service.ts:270-275`) · เว็บโหลดเป็น blob แสดงเป็นรูปย่อ
- **อายุเก็บ 1 ปี** (`attendance-photo-retention.cron` ลบไฟล์ + ตั้ง `photoKey = null` แถวตอกคงอยู่) — ตัดสินโดยผู้ช่วย เจ้าของเปลี่ยนได้
- ถ่ายไม่ได้ (กล้องเสีย/ไม่อนุญาต) → ยังตอกได้ แต่แถวติดธง `NO_PHOTO` และโชว์ในรายการผิดปกติ (ไม่บล็อกคนทำงาน แต่เจ้าของเห็น)

## 5. ตารางงานและกติกานับ (คำตัดสินเจ้าของ 27/10)

| เรื่อง | กติกา |
|---|---|
| เวลางาน | ทุกสาขา **10:00–19:00 ทุกวัน** · ค่าเริ่มต้นระดับระบบ ตั้งทับรายสาขาได้ (`Branch.workStart/workEnd` nullable — ค่าว่าง = ค่าระบบ) เผื่อสาขาใหม่ |
| กะ | ไม่มี — ทุกคนเวลาเดียวกับร้าน |
| วันหยุด | หยุด **สัปดาห์ละ 1 วัน สลับกันในทีม** · ผจก.สาขา/เจ้าของกำหนดล่วงหน้าในตารางรายสัปดาห์ (`AttendanceDayOff`: userId · date · kind `DAY_OFF`) · ไม่มีตารางวันหยุด = ระบบถือว่าทุกวันเป็นวันทำงาน (แล้วไม่มา = ขาด) |
| ลา | ผจก.บันทึกให้ (`kind` `LEAVE_SICK` · `LEAVE_PERSONAL` · `LEAVE_OTHER` + หมายเหตุ) — ไม่มีโควต้า ไม่มีขั้นอนุมัติ |
| วันหยุดราชการ/ร้านปิด | ก้อนนี้ **ไม่**นำ `thai-holidays.json` มาใช้ (ร้านเปิดทุกวัน) · ร้านปิดเป็นกรณีพิเศษ = ผจก.ใส่ `kind SHOP_CLOSED` ทั้งสาขาในวันนั้น |
| สาย | เข้าหลัง **10:15** = สาย · `lateMinutes` = นาทีนับจาก **10:00** (10:16 → 16 นาที) — ผ่อนผัน 15 นาทีเป็นค่าที่ผู้ช่วยเลือกให้สมมาตรกับ OT (เจ้าของยังไม่ยืนยันตัวเลข) ตั้งค่าได้ (`attendance.late_grace_minutes`) |
| OT | นับจากเวลาออกหลัง 19:00 **อัตโนมัติ ไม่ต้องมีคนรับรอง** · เศษนาที: < 15 ไม่คิด · 15–44 = 0.5 ชม. · 45–59 = 1 ชม. (⇒ เริ่มนับจริงที่ 19:15 ตามที่เจ้าของบอก) · ตัวอย่าง: ออก 19:14 → 0 · 19:15 → 0.5 · 20:30 → 1.5 · **20:50 → 2** (1 ชม. + เศษ 50 นาทีนับเป็น 1) · เก็บ `otHours` (0, 0.5, 1, 1.5 …) ต่อวัน |
| ออกก่อนเวลา | ออกก่อน 19:00 = `earlyLeaveMinutes` (ข้อมูลประกอบ ไม่หักอะไรในก้อนนี้) |
| ลืมตอกออก | รอบเที่ยงคืน (cron 00:05 เวลาไทย) ปิดแถวที่ยังไม่มีเวลาออก: `clockOut = null` + ธง `MISSING_OUT` · **OT = 0** · ผจก.แก้ได้ (§6) |
| ตอกซ้ำ | ทุกการกดเก็บเป็นเหตุการณ์ใน `AttendancePunch` (append-only พร้อมรูป) · แถววัน (`AttendanceDay`) สรุปจากเหตุการณ์: `clockIn` = IN ครั้งแรก · `clockOut` = OUT ครั้งล่าสุด (OUT ซ้ำ = ทับด้วยเวลาใหม่ + ธง `OUT_UPDATED`) · IN หลัง OUT (ออกไปธุระแล้วกลับมา) = เปิดวันต่อ: `clockOut` ว่างอีกครั้ง + ธง `REOPENED` (เวลาระหว่างนั้นไม่ถูกหักในก้อนนี้) · IN ซ้ำขณะยังไม่ OUT → 409 "ตอกเข้าแล้วเมื่อ 10:02" · OUT โดยไม่เคย IN → 409 |
| มาทำงานวันหยุด/ลา/ร้านปิด | รับการตอกตามปกติ · `dayKind` คงตามตาราง (DAY_OFF/LEAVE_*/SHOP_CLOSED) + ธง `WORKED_ON_OFF_DAY` · เก็บ `workedMinutes` และ `otHours` ตามสูตรเดิม · **เงินค่าทำงานวันหยุด (กฎหมาย: รายเดือน +1 เท่า · OT วันหยุด 3 เท่า) ไปตัดสินที่ D4** — ก้อนนี้ไม่คิดเงินและไม่ปฏิเสธการตอก |
| สายกับ OT | เก็บแยกกัน (`lateMinutes` · `otHours`) ไม่หักกลบ (เข้า 12:00 ออก 20:00 = สาย 120 นาที และ OT 1 ชม.) — ถ้าเจ้าของต้องการหักกลบ ทำที่ D4 ตอนคิดเงิน (คำถามค้างถึงเจ้าของ §15) |
| วัน | ตัดวันตามปฏิทินไทย (`bangkokCalendarParts`) · แถวตอก 1 แถวต่อคนต่อวัน (`@@unique([userId, workDate])`) |
| เวลา | `clockIn/clockOut` = เวลาที่เซิร์ฟเวอร์รับคำขอ (A2) · ไม่รับ timestamp จากเครื่อง |
| เงิน OT (D4) | 1.5 × (เงินเดือน ÷ 30 ÷ 8) — บันทึกไว้ในสเปกนี้เพื่อให้ D4 ใช้: 15,000 → 62.5/ชม. → 1 ชม. = 93.75 · 1.5 = 140.63 · 2 = 187.50 |

## 6. แก้ไขย้อนหลัง

- ผจก.สาขา (สาขาตัวเอง) / OWNER แก้เวลาเข้า-ออก ใส่วันลา/หยุด หรือลบธง `MISSING_OUT` ได้ **พร้อมเหตุผล ≥ 10 ตัวอักษร** · **ผจก.แก้แถว/วันหยุดของตัวเองไม่ได้** (403 "ให้เจ้าของแก้" — คนบันทึกต้องไม่ใช่คนได้ประโยชน์ เพราะ OT คิดอัตโนมัติไม่มีคนรับรอง) · OWNER แก้ได้ทุกคน · ทุกครั้งเขียน `AttendanceCorrection` (ค่าเก่า → ใหม่ · ผู้แก้ · เหตุผล) และ `audit.log('ATTENDANCE_CORRECTED')` หลัง commit · แถวตอกเก็บ `correctedCount`
- ค่าที่คำนวณ (สาย/OT) คำนวณใหม่จากเวลาที่แก้ ด้วยฟังก์ชันบริสุทธิ์ตัวเดียว (`computeDaySummary`) ที่ kiosk · cron · การแก้ ใช้ร่วมกัน (preview = posted)
- พนักงานแก้เองไม่ได้ · เห็นประวัติของตัวเองได้ที่หน้า "เวลาทำงานของฉัน" ในแอป (อ่านอย่างเดียว)

## 7. หน้าจอ (mockup ต้องเคาะก่อนแตะโค้ด — กฎเจ้าของ)

1. **`/kiosk`** (สาธารณะ บนเครื่องประจำสาขา): หน้าลงทะเบียน (กรอกรหัส 8 ตัว) → หน้าตอกบัตร (ปุ่มเข้า/ออก · แป้นรหัส · กล้อง · ผลลัพธ์) · ปุ่มแตะ ≥ 64px (ใช้ยืนกด) · ไม่มีเมนู
2. **เมนู ลงเวลา** (`/attendance`, OWNER/BM — เจ้าของอยู่หมวด "ขาย" · ผจก.อยู่หมวด "ภาพรวม"): แท็บ **วันนี้** (รายสาขา: มา/สาย/ยังไม่มา/ลา/หยุด · รูปเล็กต่อแถว · ธงผิดปกติ) · แท็บ **รายเดือน** (ตารางคน × วัน + สรุป วัน/สาย/ขาด/ลา/OT ชม. · ส่งออก Excel) · แท็บ **ตารางหยุด** (grid สัปดาห์: ติ๊กวันหยุด/ลา ต่อคน) · ปุ่มแก้ไขรายวันเปิด dialog เหตุผล
3. **ตั้งค่า › บริษัท & สาขา › เครื่องตอกบัตร** (OWNER · `/settings/company/attendance-devices`): รายการเครื่อง (สาขา · ชื่อ · สถานะ · ตอกล่าสุด · เครือข่ายล่าสุด) · ปุ่มเพิ่ม (ออกรหัสลงทะเบียน) · ยกเลิก · ปลดล็อก · ตั้งค่า เวลางาน/ผ่อนผันสาย
4. **ผู้ใช้ › รายละเอียด** (OWNER): ปุ่ม "ตั้ง/รีเซ็ตรหัสตอกบัตร" (แสดงรหัสครั้งเดียว)
5. **เวลาทำงานของฉัน** (พนักงานทุกคน): รายการเดือนปัจจุบัน อ่านอย่างเดียว
6. การ์ดบนแดชบอร์ดหน้าหลักหน้าร้าน: "วันนี้มา 4/5 · สาย 1" ลิงก์ไปหน้า 2 — ทำถ้าหน้าหลักมีช่องให้ (ผู้ช่วยตัดสินตอน plan)

โทเคนสีจาก `index.css` เท่านั้น · สถานะต้องมีไอคอน+คำ ไม่ใช่สีอย่างเดียว · ฟอนต์ไทย `leading-snug` · ผ่าน `/ui-ux-pro-max` (`--domain ux`) ก่อนส่ง

## 8. API และความปลอดภัย

**สาธารณะแบบมี token (controller แยก `kiosk-public.controller.ts` · `@SkipCsrf()` · throttle 30/นาทีต่อ IP · **ลงทะเบียน manifest เป็น `public`** · เพิ่มในรายการ Intentionally Public Endpoints ของ `security.md`):**
- `POST /kiosk/register` {code, deviceName?, userAgent} → {deviceToken, branch {id,name}, serverTime}
- `POST /kiosk/punch` {deviceToken, pin, kind: IN|OUT, photo (multipart ≤ 300 KB), geo?} → {nextDeviceToken, result {userNickname, at, status, lateMinutes?, otHours?}} · 401 `DEVICE_REVOKED`/`DEVICE_LOCKED` · 423 `PIN_LOCKED` · 400 รหัสไม่ถูกต้อง (ไม่บอกว่ารหัสของใคร) · 409 ตอกซ้ำ
- `POST /kiosk/heartbeat` {deviceToken, requestId} → {nextDeviceToken, serverTime, device} · error ทุกตัวเป็น `{statusCode, code, message, serverTime}` ผ่าน `KioskExceptionFilter` · 409 `REQUEST_BUSY` = ลองใหม่ด้วยคำขอเดิม

**ภายใน (JWT · RolesGuard · manifest `staff` + catalog key + `ACCESS_BOUNDARIES` — เมื่อ `accessManaged=true` route ของ staff ที่ไม่ใช่ OWNER ต้องมี boundary ไม่งั้น 403 `RESOURCE_BOUNDARY_REQUIRED` (`access-policy.ts:46-50`) · catalog รับได้แค่ `GRANT`/`OWNER`/`STAFF` ⇒ เงื่อนไข "BM สาขาตัวเอง" อยู่ใน boundary + service ไม่ใช่ใน catalog):**
- `attendance.read` [GRANT] (OWNER · BRANCH_MANAGER สาขาตัวเอง — boundary ตาม `branchId`): `GET /attendance/today?branchId` · `GET /attendance/month?branchId&month` (คืน JSON · **Excel ทำฝั่งเว็บ**ด้วย `apps/web/src/utils/excel.util.ts` เหมือนหน้าอื่น — ไม่มี endpoint xlsx) · `GET /attendance/punches/:id/photo`
- `attendance.manage` [GRANT] (OWNER · BRANCH_MANAGER สาขาตัวเอง ยกเว้นแถวตัวเอง): `PATCH /attendance/days/:id` · `PUT /attendance/day-offs`
- `GET /attendance/me?month` = **self-service** (`permission: null` ใน manifest แบบ `AuthController.getMe` — ไม่มี catalog key)
- `attendance.devices` [OWNER]: `GET/POST /attendance/devices` · `POST /attendance/devices/:id/revoke` · `/unlock` (ปลดแล้วต้องลงทะเบียนใหม่) · `PATCH /attendance/settings`
- `users.manage` เดิม: `POST /users/:id/attendance-pin/reset` (OWNER)
- เว็บ: `/kiosk` ต้องอยู่ใน `apps/web/src/lib/public-routes.ts` และใช้ axios client **แยก** ไม่ผ่าน interceptor refresh/redirect ของ `lib/api.ts` (ไม่งั้น 401 `DEVICE_REVOKED` ถูกพาไป `/login`)

ขอบเขตสาขาของ BM บังคับใน service (route `/:id` ไม่มี branchId ให้ `BranchGuard` ตรวจ — กฎ `security.md`) · BM ที่ไม่มี branchId = fail-closed

## 9. ข้อมูล (Prisma — migration ใหม่ 1 ตัว)

- `AttendanceDevice` {id · branchId · name · status ACTIVE|REVOKED|LOCKED · currentGeneration Int · lastSeenAt · lastCleanHeartbeatAt · lastIp · lastUserAgent · pinFailCount · pinLockedUntil? · registeredById · createdAt/updatedAt/deletedAt} `@@map("attendance_devices")`
- `AttendanceDeviceToken` {id · deviceId · generation · tokenHash @unique · issuedAt · usedAt?} append-only (ประวัติทุกรุ่น) · `AttendanceDeviceRequest` {deviceId · requestId · responseJson · createdAt} `@@unique([deviceId, requestId])` ลบเกิน 1 วันด้วย cron
- `AttendancePunch` {id · deviceId · userId · branchId · kind IN|OUT · at · photoKey? · ip · userAgent · geo? · flags String[]} append-only — ทุกการกด · แถววันสรุปจากตารางนี้
- `AttendanceRegistrationCode` {id · branchId · codeHash @unique · expiresAt · usedAt? · createdById} (ใช้ครั้งเดียว 10 นาที)
- `AttendanceDeviceEvent` {id · deviceId · kind REGISTERED|TOKEN_CONFLICT|PIN_LOCKOUT|REVOKED|UNLOCKED · ip · userAgent · detail Json · createdAt} — append-only (ไม่มี updatedAt/deletedAt — ตามข้อยกเว้นใน `database.md` ใส่ `///` อธิบาย)
- `AttendanceDay` {id · userId · branchId (= สาขาของเครื่องที่ตอก IN) · workDate (date ไทย) · clockIn? · clockOut? · workedMinutes Int · lateMinutes Int · earlyLeaveMinutes Int · otHours Decimal(4,1) · flags String[] (MISSING_OUT · NO_PHOTO · NETWORK_CHANGED · CORRECTED · OUT_UPDATED · REOPENED · WORKED_ON_OFF_DAY · DEVICE_CONFLICT) · dayKind WORK|DAY_OFF|LEAVE_SICK|LEAVE_PERSONAL|LEAVE_OTHER|SHOP_CLOSED · note? · correctedCount · createdAt/updatedAt/deletedAt} `@@unique([userId, workDate])` `@@index([branchId, workDate])`
- `AttendanceCorrection` {id · dayId · changedById · reason · before Json · after Json · createdAt} append-only
- `User.attendancePinHash String? @unique` = HMAC-SHA256(pin, `PII_HASH_SALT`) แบบเดียวกับ `hashPII` (ค้นได้ O(1) · ไม่ย้อนกลับ · รหัสไม่ซ้ำกันทั้งบริษัท — ตั้งชนกันระบบสุ่มใหม่) · brute force กันด้วยล็อกต่อเครื่อง 5 ครั้ง/15 นาที · `Branch.workStart String? / workEnd String?` ("10:00"/"19:00") · SystemConfig `attendance.late_grace_minutes` (ค่าเริ่มต้น 15) · `attendance.photo_retention_days` (365)
- ไม่มี enum ใหม่ใน Prisma สำหรับ flags (String[] เพื่อเพิ่มธงโดยไม่ migrate) · `dayKind` เป็น enum

## 10. งานอัตโนมัติ

- `attendance-close-day.cron` 00:05 เวลาไทย: ปิดแถวที่ `clockIn` มีแต่ `clockOut` ว่างของเมื่อวาน → ธง `MISSING_OUT` · สร้างแถว `dayKind WORK` ไม่มีเวลาเลยสำหรับพนักงาน active ที่ไม่มีแถวและไม่มีวันหยุด/ลา (= ขาด) — เฉพาะพนักงานที่ **มีรหัสตอกบัตรแล้ว** · **สาขาที่ไม่มีการตอกเลยทั้งวัน** (เครื่องล็อก/ดับ/ไม่มีเน็ต) → ไม่นับใครขาด แต่ติดธงวันของสาขา `DEVICE_UNAVAILABLE` + Todo ถึงเจ้าของ "สาขา X ไม่มีการตอกบัตรวันที่ …" · Todo ทุกใบสร้างในนามผู้ใช้ระบบ (`Todo.createdById` บังคับ — แบบ `device-return-pending.cron.ts:121`; ไม่มีผู้ใช้ระบบ = log แล้วข้าม เหมือน #1733)
- `attendance-photo-retention.cron` รายวัน: ลบรูปเกินอายุ
- แจ้งเตือน (ผ่าน Todo ถึง OWNER ก่อน · LINE #1735 เป็น follow-up): เครื่องล็อกจาก token ชน · เครื่องไม่ส่ง heartbeat เกิน 24 ชม. (แท็บเล็ตดับ/เน็ตหลุด) · รหัสถูกเดาจนล็อก

## 11. การทดสอบที่ต้องมี

- หน่วย: `computeDaySummary` (ตาราง 15/45 · สาย 10:15/10:16 · ออกก่อน · ลืมออก · ข้ามเที่ยงคืน?) · token rotation + conflict window · PIN lockout · ขอบเขตสาขา BM
- Postgres จริง (vitest · `tools/test-db-vitest.sh` + glob ใน deploy-gcp.yml): ลงทะเบียน → ตอกเข้า → ตอกออก → แถวเดียวต่อวัน · token ชน → LOCKED + event + Todo · cron ปิดวัน
- เว็บ: หน้า kiosk (กรอกรหัส → กล้อง mock → ผล · error เน็ต) · หน้าเดือน · ตารางหยุด
- `node tools/check-access-coverage.mjs` = 0 error · `check-types.sh all` · e2e smoke ของ route ใหม่ตาม pattern เดิม

## 12. ความเสี่ยงที่รับรู้

- iOS Safari ในโหมด PWA: `getUserMedia` ใช้ได้ตั้งแต่ iOS 13.4 แต่บางรุ่นเก่าไม่เสถียร → ถ่ายไม่ได้ = ธง `NO_PHOTO` ไม่บล็อก
- แท็บเล็ตถูกหิ้วออกไปกดข้างนอก: token หมุนไม่ช่วย (เครื่องจริงไปด้วย) — มีแค่ธงเครือข่าย/พิกัดเปลี่ยน + รูป · ถ้าต้องการปิดจริงต้องใช้ MDM ล็อกตำแหน่ง (นอกขอบเขต)
- 1 สาขาบน prod วันนี้ ⇒ ตารางหยุด/หน้ารายเดือนต้องใช้ได้ดีกับทีมเล็ก (ไม่ทำ pagination ซับซ้อน)
- `shop-hours.util.ts` / `after-hours.service.ts` ยังมีเวลาร้านของตัวเอง — ก้อนนี้**ไม่**รวมให้ (คนละความหมาย: บอทตอบลูกค้า) แค่บันทึกไว้

## 13. สิ่งที่ปล่อยให้ผู้สร้างตัดสิน

- โครงไฟล์/ชื่อ service · วิธี mock กล้องในเทส · รูปแบบ Excel (ใช้ util เดิม `excel.util`) · การ์ดแดชบอร์ด (§7 ข้อ 6) · ข้อความไทยบนหน้า kiosk · ตำแหน่งเมนู "ลงเวลา" ในแถบข้าง (ใกล้ "ผู้ใช้"/"สาขา")

## 14. คำตัดสินของผู้ช่วยที่เจ้าของควรทบทวน

1. ผ่อนผันสาย 15 นาที (สายเมื่อเข้าหลัง 10:15 นับจาก 10:00) — ตั้งค่าได้
2. รหัสผิด 5 ครั้ง/15 นาที ล็อก**ทั้งเครื่อง** 15 นาที + แจ้งเจ้าของ
3. รูปเก็บ 1 ปี · ถ่ายไม่ได้ไม่บล็อก แค่ติดธง
4. ลืมตอกออก = OT 0 · ผจก.แก้พร้อมเหตุผล
5. ขาด = ไม่มีแถวและไม่มีวันหยุด/ลา (นับเฉพาะคนที่ตั้งรหัสแล้ว) · ผจก.เป็นคนกำหนดวันหยุดล่วงหน้า
6. แจ้งเตือนผ่าน Todo ก่อน ไม่ต่อ LINE ในก้อนนี้
7. ไม่ทำคิวออฟไลน์ · ไม่ทำกะ · ไม่คิดเงิน (D4)
8. (builder check) มาทำงานวันหยุด/ลา = รับการตอก + ธง `WORKED_ON_OFF_DAY` เงินไป D4 · สายกับ OT เก็บแยกไม่หักกลบ · ผจก.แก้ของตัวเองไม่ได้ · OUT ซ้ำทับเวลา IN หลัง OUT เปิดวันต่อ (ทุกเหตุการณ์เก็บใน `AttendancePunch`) · รหัสไม่ซ้ำทั้งบริษัท ตอกได้ทุกเครื่อง · token เก็บประวัติทุกรุ่น + ส่งซ้ำได้ผลเดิมด้วย `requestId` (ไม่ลอก grace 10 วิ ของ auth) · ชนแล้วติดธงย้อนหลังทั้งช่วง · ปลดล็อก OWNER เท่านั้น · วันที่สาขาไม่มีการตอกเลยไม่นับขาด · เครื่องตอกบัตรอย่างเดียว + manifest แยก

## 15. ผลตรวจ builder check (opus · 2026-10-27) และคำตอบ

คำถาม 6 ข้อ: ข้อ 1(ก) 2 3 4 5 6 ตอบเป็นคำตัดสินผู้ช่วยใน §14 ข้อ 8 และแก้ในเนื้อสเปกแล้ว (§4.2 §4.3 §5 §6 §8 §9 §10) · **ข้อ 1(ข) ส่งถามเจ้าของ**: มาสายแล้วอยู่เกิน 19:00 ให้หักเวลาสายออกจาก OT หรือไม่ — ค่าเริ่มต้น "ไม่หัก เก็บแยก" (D4 หักได้ทีหลัง)

ข้อสมมติที่โค้ดขัดและแก้แล้ว: auth grace 10 วิ + ออกคู่ใหม่ (→ requestId idempotency) · ต้องมี `ACCESS_BOUNDARIES` + self-service = `permission: null` · manifest/sw ของ PWA ชนกับ `/kiosk` · `lib/api.ts` 401 → `/login` (→ public-routes + client แยก) · `excel.util` มีแต่ฝั่งเว็บ (→ export ฝั่งเว็บ) · prod เป็น GCS signed URL local ไม่ได้ (→ stream ผ่าน API) · `Todo.createdById` บังคับ (→ ผู้ใช้ระบบ) · กฎ security.md เรื่อง localStorage (→ เขียนข้อยกเว้น)
