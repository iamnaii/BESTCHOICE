# ส่งต่องาน: ตรวจเครดิตจากสเตทเม้นในแผงขวาหน้าแชท (BESTCHOICE)

repo: `/Users/iamnaii/Desktop/App/BESTCHOICE` · เขียนโดย Claude Code 2026-09-07 · **สื่อสารกับเจ้าของเป็นภาษาไทย**

## โจทย์

เจ้าของร้าน (ผ่อนมือถือ) ขอ: ในหน้าแชท `/inbox` ให้แผงขวามีที่แนบไฟล์สเตทเม้นธนาคาร
ให้ AI อ่านแล้วบอกว่า "ผ่อนกับเราไหวไหม" และ **ลากไฟล์จากบับเบิลในแชทตรงกลางมาวางในแผงขวาได้เลย**
โดยไม่ต้อง download แล้ว upload ใหม่

## สถานะ ณ ตอนส่งต่อ

| | สถานะ |
|---|---|
| สำรวจโค้ด + ออกแบบ | ✅ เสร็จ (สรุปอยู่ในเอกสารนี้ทั้งหมด) |
| Mockup 9 บอร์ด | ✅ ส่งให้เจ้าของแล้ว **⏳ ยังไม่เคาะ** |
| PR #1536 (บั๊ก audit_logs) | ✅ เปิดแล้ว รอ merge — https://github.com/iamnaii/BESTCHOICE/pull/1536 |
| โค้ดฟีเจอร์ | ❌ **ยังไม่แตะแม้แต่บรรทัดเดียว** |

**กติกาของเจ้าของ: งาน UI ต้องทำ mockup ให้ดูก่อน เคาะแล้วค่อยแก้โค้ด** — ถ้ายังไม่ได้ยินคำว่า
"เอาแบบนี้/โอเค" จากเจ้าของ **อย่าเพิ่งเขียนโค้ดฟีเจอร์** ให้ถามก่อน

Mockup: https://claude.ai/code/artifact/0dd52066-ead5-481c-8cd3-c078120cd190
(ต้อง login claude.ai — ถ้าเปิดไม่ได้ ซอร์สอยู่ที่ `.claude/handoff-credit-mockup/*.dc.html`
เป็น HTML ธรรมดา เปิดในเบราว์เซอร์/อ่านเป็นข้อความได้ ลบทิ้งได้เมื่อจบงาน ไม่ต้อง commit)

## คำตัดสินเจ้าของ — ห้ามขัด ห้ามเสนอทางเลือกแทน

1. **แผงขวาโชว์ตัวเลขการเงิน + งวดที่ผ่อนไหว** — ห้ามมี "ผ่าน/ไม่ผ่าน" ห้ามมีคะแนน AI
   ห้ามมี % ความมั่นใจ (เจ้าของบอกว่าให้ตัวเลข คนตัดสินเอง)
2. **ทุกคนที่เข้าห้องแชทได้ เห็นเอกสารและผลหมด** — ไม่ทำ permission ใหม่
   (เคยเสนอว่าสเตทเม้นเป็น PII หนัก เจ้าของยืนยันเลือกแบบนี้ — บันทึกไว้แล้ว ไม่ต้องเสนอซ้ำ)
3. **ห้องที่ยังไม่ผูกลูกค้าต้องแนบได้** — ไฟล์เกาะ `roomId` ไว้ก่อน ค่อยย้ายเข้าประวัติลูกค้าตอนกดผูก
4. **ทั้งลากทั้งปุ่ม** — ลากบนจอกว้าง + ปุ่มบนบับเบิลใช้ได้ทุกจอ
5. **PDF ที่ล็อกรหัส แยกเป็น 2 รอบ** — รอบแรกแค่บอกผู้ใช้ว่า "ไฟล์นี้ล็อกรหัส" รอบสองค่อยทำช่องกรอก
6. บั๊ก `audit_logs` แยกเป็น PR เล็กขึ้นก่อน → ทำแล้ว = #1536

## ข้อเท็จจริงที่วัดจาก prod แล้ว — อย่าสำรวจซ้ำ

**ระบบตรวจเครดิตมีอยู่แล้ว ไม่ต้องสร้างใหม่**
- `CreditCheck` model — `apps/api/prisma/schema.prisma:2853` · หน้า `/credit-checks` ใช้งานอยู่จริง
- ฟิลด์ที่โชว์ได้: `statementBankName` `statementAvgIncome` `statementAvgExpense`
  `statementAvgBalance` `debtToIncomeRatio` · ใน `aiAnalysis` JSON มี `monthlyIncome`
  `averageBalance` `affordabilityRatio` `incomeConsistency` `positiveFactors` `riskFactors`
- 🔴 **ไม่มีฟิลด์ "งวดที่ผ่อนไหว"** ต้องเพิ่มคีย์ `affordablePayment` ในพรอมป์ตที่
  `apps/api/src/modules/credit-check/services/credit-check-ai-analysis.service.ts:196-207`
  · เกณฑ์ที่ระบบใช้ให้คะแนนอยู่แล้ว (บรรทัด 277-285): ≤20% ดีมาก / ≤30% ดี / ≤40% พอไหว
  ⇒ **ใช้เกณฑ์เดิม อย่าคิดเกณฑ์ใหม่ให้ขัดกัน**
- 🔴 `aiAnalysis.monthlyPayment` **ไม่ใช่** "ค่างวดที่ผ่อนไหว" — บรรทัด 201 echo ค่างวดของสัญญา
  ที่มีอยู่กลับมา และไม่มีสัญญา = 0 ⇒ **ห้ามผูกตัวเลขเด่นกับคีย์นี้เด็ดขาด**

**AI มีสองเส้นทางแยกกัน — ต้องใช้ให้ถูกตัว**
- `performClaudeAnalysis` (เส้นที่ credit-check ใช้อยู่) `credit-check-ai-analysis.service.ts:170-177`
  รับเฉพาะ `image/jpeg|png|gif|webp` → **PDF ถูก `continue` ข้ามเงียบ ไม่มี error**
- `analyzeBankStatement` `apps/api/src/modules/ocr/services/ocr-extractors.service.ts:597`
  **รับ PDF ได้** (ผ่าน `validateFileBase64` ที่ยอม `application/pdf`) และคืน
  `totalIncome / totalExpense / balance / transactionCount / dateRange / accountName / bankName`
  ซึ่งตรงโจทย์กว่า — **แต่ทั้งโมดูล credit-check ไม่เคยเรียกมันเลย** (ผู้เรียกมีแค่ `ocr.controller.ts:62`)
- ⇒ **ทางที่เลือก: ยิง `POST /ocr/bank-statement`** เพราะ (ก) รับ PDF (ข) **ไม่ต้องมี `customerId`**
  จึงเป็นทางเดียวที่ทำงานได้กับห้องที่ยังไม่ผูกลูกค้า (99.99% ของ prod)
  (ค) ฝั่งเว็บมีท่าเรียกอยู่แล้วที่ `useCreditCheckCreate.ts:184-188` พร้อม `{ timeout: 120000 }`
  — **ต้องคัดลอก timeout นี้มาด้วย** axios instance default คือ 15 วิ (`apps/web/src/lib/api.ts:30`)

**ไฟล์ในแชทเป็นของ Meta ไม่ใช่ของเรา**
- นับจาก prod: media ที่ไม่ใช่ TEXT 23,575 แถว — `https://` 21,026 · storage key `staff-chat/` **0 แถว**
  (แปลว่า `signMessageMedia` ที่ `room-manager.service.ts:621` ไม่เคยทำงานจริงสักครั้ง)
- 🔴 URL ของ Meta มี `oe=` (วันหมดอายุ) 20,975 แถว — **หมดอายุแล้ว 15,703 แถว**
  แยกเดือน: ก.ย. 1,159 (ใช้ได้ 1,096) · ส.ค. 6,389 (4,176) · **มิ.ย./พ.ค./เม.ย. ใช้ได้ 0 ทั้งหมด**
  ⇒ **ลากได้เฉพาะไฟล์อายุไม่เกิน ~1 เดือน — "ลากไม่สำเร็จเพราะไฟล์หมดอายุ" คือสถานะปกติที่ต้องมีข้อความบอก**
- 🔴 **fetch จากเบราว์เซอร์ไม่ได้** — `scontent.xx.fbcdn.net` ไม่เปิด CORS ให้ origin เรา
  (โหลดผ่าน `<img>` ได้ แต่ `fetch().blob()` ตาย) ⇒ **payload ของการลากต้องเป็น `message.id`
  ให้เซิร์ฟเวอร์ไปดึงเอง** ห้ามส่ง URL
- FB ไม่เคยเซ็ต `mediaType` (`facebook-webhook.controller.ts:466-500` ไม่คืนฟิลด์นี้)
  ⇒ ทุกแถวมี `mediaType = null` ฝั่ง server ต้องอ่าน Content-Type จาก response + sniff magic bytes เอง

**ห้องแชท**
- 8,516 ห้องบน prod เป็น FACEBOOK ล้วน · **ผูกลูกค้าแค่ 1 ห้อง** · customers 39 ราย
- `CreditCheck.customerId` เป็น **required** (`schema.prisma`) ⇒ เส้นทาง `/customers/:id/credit-check`
  ใช้กับห้องแชททั่วไปไม่ได้ (นี่คือเหตุผลที่เลือก `/ocr/bank-statement`)
- ไม่มี endpoint unlink ลูกค้าออกจากห้อง (มีแต่คอมเมนต์ที่ `room-manager.service.ts:655`)

**PDF ที่ล็อกรหัส**
- `validateFileBase64` (`apps/api/src/modules/ocr/services/ocr-parsing.util.ts:66-85`)
  ตรวจแค่ prefix + ชุดอักขระ base64 — **ไม่ตรวจว่าไฟล์เข้ารหัส** ส่งต่อให้ AI เลย
- `apps/api` **ไม่มี PDF library สักตัว** · `apps/web` มี `pdf-lib@^1.17.1` ซึ่ง
  **ตรวจจับได้ว่าไฟล์ล็อก (โยน `EncryptedPDFError`) แต่ถอดรหัสไม่ได้** (ไม่มีพารามิเตอร์ password)
- ผลวันนี้: ผู้ใช้เห็น "เกิดข้อผิดพลาดภายในระบบ" ลอย ๆ เพราะ `analyzeBankStatement` catch ตัวสุดท้าย
  (`ocr-extractors.service.ts:639-642`) โยน `InternalServerErrorException` แล้ว
  `sentry-exception.filter.ts:54-56` ทับข้อความ 5xx ทุกตัวบน prod
  ⇒ **ข้อความใหม่ที่อยากให้ผู้ใช้เห็นต้องเป็น `BadRequestException` (4xx) เท่านั้น**

## กับดักที่ต้องปิดตอนเขียนโค้ด

1. 🚨 **ลากไฟล์ลงกลางแชท = ส่งให้ลูกค้าทันทีไม่มีถามยืนยัน**
   (`apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx:321-334` `onDrop` → `onSendFile`)
   และป้าย overlay เขียนแค่ "วางไฟล์เพื่อส่ง" (บรรทัด ~614)
   ⇒ **ข้อบังคับ ไม่ใช่ทางเลือก: ต้องแก้ป้ายทั้งสองฝั่งให้บอกผลลัพธ์**
   - สายแชท: "วางที่นี่ = ส่งให้ลูกค้า" + "ลูกค้าเห็นทันที"
   - แผงขวา: "วางที่นี่ = ให้ AI ตรวจเครดิต" + "ลูกค้าไม่เห็น"
   เหตุผล: พลาดปล่อยเลยไป 40px = สเตทเม้นธนาคารเด้งเข้าห้องแชท ถอนไม่ได้
   นี่คือความเสียหายเดียวในงานนี้ที่กู้ไม่ได้ ต้นทุนแก้ = ข้อความบรรทัดเดียว
2. 🚨 **idempotency 30 วินาที** ที่ `credit-check-crud.service.ts:154-175` เทียบแค่
   `customerId + bankName + statementMonths` **ไม่ดูไฟล์** แล้วคืนใบเดิม
   ⇒ ถ้ายิง POST ต่อการลาก 1 ไฟล์ ไฟล์ที่ 2 ภายใน 30 วิ จะได้ 200 แต่ **ไฟล์หายเงียบ**
   ⇒ **ต้องแยก "แนบ" ออกจาก "วิเคราะห์" เป็นสองการกระทำ** ลากกี่ไฟล์ก็ได้ แล้วกดปุ่มวิเคราะห์ครั้งเดียว
3. **`RoomDossier` ถูก mount 2 ชุดพร้อมกัน** (`index.tsx:648` จอ xl+ กับ `:658` Sheet จอเล็ก)
   ⇒ **ห้ามใส่ `id=` ตายตัวในการ์ดใหม่** (`id="room-appointments"` ที่บรรทัด 495 คือบั๊ก id ซ้ำที่มีอยู่แล้ว
   อย่าลอก) ใช้ `useRef` ทั้งตอน `scrollIntoView` และตอน flash · `dragDepth` ต้องเป็น `useRef` ไม่ใช่ตัวแปร module
4. **จอเล็กกว่า 1280px ลากไม่ได้เลย** — แผงขวาเป็น Sheet ทับจอ ⇒ ปุ่มบนบับเบิลคือทางเดียว
   และปุ่มต้อง `[@media(hover:none)]:opacity-100` (จอสัมผัสเห็นตลอด ไม่มี hover)
5. **ทั้ง apps/web ไม่มี `dataTransfer.setData/getData` เลยสักที่** — ยังไม่มี drag source ในระบบ
   ต้องเขียนเองที่ `MessageBubble.tsx` · ข่าวดี: `ChatPanel` กรอง `types.includes('Files')`
   ทุก handler (บรรทัด 303/309/314) การลากภายในหน้าจึงไม่ไปปลุก overlay เดิม
   แต่ drop zone ใหม่ต้องเช็ค custom MIME เอง เพราะ `e.dataTransfer.files` จะว่าง
6. **ชนิดไฟล์ไม่ตรงกัน 3 ชั้น**: input ในแชท `accept="image/*,.pdf,.doc,.docx"` (`ChatPanel.tsx:1033`)
   · `upload-accept.ts:7-9` · backend รับ jpeg/png/webp/pdf/doc/docx ≤10MB (`staff-chat.controller.ts:588-597`)
   ⇒ **HEIC จากไอโฟนโดน 400 อยู่แล้ววันนี้** ซึ่งเป็นท่ามาตรฐานของการถ่ายรูปสเตทเม้น — ต้องเคาะ allow-list ตั้งแต่แรก
7. **ชื่อไฟล์ภาษาไทยเพี้ยน** — staff upload เก็บ `file.originalname` ดิบ (`room-manager.service.ts:1158`)
   ไม่ decode latin1→utf8 แบบที่ `todos.controller.ts:83-87` ทำ ⇒ อย่าเอาชื่อไฟล์จาก `message.text` มาโชว์
8. **`GET /staff-chat/rooms/:id/messages` (`staff-chat.controller.ts:162-173`) ไม่มีด่านกัน SALES**
   แบบที่ `rooms/:id` มี (`:142-160`) ⇒ endpoint ใหม่ที่รับ `messageId` **ต้องเช็คสิทธิ์ห้องเอง**
   ไม่งั้นกลายเป็นช่องดูดไฟล์ข้ามห้องด้วยการเดา id
9. **`Customer.documents` พังอยู่** — DTO บังคับ `^https://` (`customers/dto/document.dto.ts:11-13`)
   แต่หน้าเว็บส่ง data URL (`CustomerDetailPage.tsx:341-357`) ⇒ ปุ่มอัปโหลดเอกสารในหน้าลูกค้าโดน 400 ทุกครั้ง
   **ห้ามเลือกที่นี่เป็นที่เก็บไฟล์เครดิตโดยไม่รู้ว่ามันเสียอยู่**
10. **`kyc.service.ts:264-270` ไม่เก็บไฟล์จริง** — สร้างสตริง path แล้ว update DB โดยไม่เคยเรียก
    `storage.upload` ⇒ **อย่าลอกแพตเทิร์นนี้**

## สถาปัตยกรรมที่เลือกไว้ (ยังไม่ลงมือ)

- **การ์ด "ตรวจเครดิต" = ใบที่ 2 ในแท็บ "ข้อมูลลูกค้า"** ของ
  `apps/web/src/pages/UnifiedInboxPage/components/RoomDossier.tsx`
  แทรกระหว่าง `</Group>` ปิด "ข้อมูลลูกค้า" (บรรทัด 491) กับ `<AdGroup />` (บรรทัด 493)
  **ไม่เพิ่มแท็บที่ 4** เพราะแท็บ 1 คือแท็บที่เด้งกลับมาเองทุกครั้งที่เปลี่ยนห้อง (บรรทัด 335-340)
  ⇒ เปิดห้องมาเห็นทันที 0 คลิก · และกล่องเตือนเหลือง "ยังไม่ได้ผูกกับลูกค้า" ต้องคงเป็นสิ่งแรกที่ตาเห็น
- ใช้ primitive `Group` เดิม (export ที่ `RoomDossier.tsx:84-107`) **ห้าม fork**
- **เป้ารับการลาก = ทั้ง `<aside>`** (บรรทัด 400 เติม `relative`) ไม่ใช่การ์ดใบเดียว
  ⇒ ปล่อยตรงไหนก็เข้า ไม่ต้องเล็ง และปัญหา auto-scroll ระหว่างลากหายไปทั้งคลาส
  ยกท่า `dragDepth` useRef จาก `ChatPanel.tsx:299-334` มาทั้งดุ้น (child element ทำให้ `dragleave`
  ยิงพร่ำเพรื่อจนกรอบกะพริบ ต้องนับ depth)
- **ที่เก็บไฟล์: storage key บน GCS + โปรกซี same-origin** ท่าเดียวกับ `Todo.attachments`
  (`apps/api/src/modules/todos/todos.controller.ts:63-115` — มี `POST /todos/upload-attachment`
  10MB + MIME allow-list + `GET /todos/attachments/*` ที่ stream ออกมาเอง)
  **ไม่ใช้ base64** (ของเดิมจำกัด 5 ไฟล์ × 8MB และทำ DB บวม)
  เหตุผลที่เข้ากันได้ดี: การลากต้องให้เซิร์ฟเวอร์ไปดึงไฟล์เองอยู่แล้ว ดึงมาแล้วเขียนลง GCS ตรง ๆ
  เป็นเรื่องธรรมชาติกว่าการแปลงเป็น base64 ยัดลงฐาน · และท่านี้ผูกกับ `roomId` ได้ตามคำตัดสินข้อ 3
- **ตัวเลขเด่นใช้บันไดลดระดับ** (สำคัญที่สุดในสเปก UI):
  1. `affordablePayment` (คีย์ใหม่ที่ต้องเพิ่มในพรอมป์ต) → ป้าย "ผ่อนไหวเดือนละ"
  2. ไม่มี → `statementAvgIncome − statementAvgExpense` → **เปลี่ยนป้ายเป็น "เงินเหลือต่อเดือน"**
  3. ไม่มี → `ocr.totalIncome − ocr.totalExpense` → ป้าย **"เงินเหลือช่วง {dateRange}"** (พูดตรงว่าไม่ใช่ต่อเดือน)
  4. ไม่มีอะไรเลย → **ตัดกล่องทิ้งทั้งกล่อง ห้ามโชว์ "—" ตัวโต**
  ช่องในตารางที่ไม่มีค่าจริงให้ **หายไปทั้งช่อง** ไม่ใช่โชว์ขีด
- **PDF ล็อกรหัส รอบ 2**: ปลดล็อกใน **เบราว์เซอร์** ด้วย `pdfjs-dist` (ต้องเป็น v4.x —
  v5/v6 ประกาศ `engines: node>=22.13` แต่โปรเจกต์เป็น Node 20) แล้วประกอบกลับเป็น PDF ใหม่ด้วย
  `pdf-lib` ที่มีอยู่แล้ว → เข้าท่อเดิม **รหัสไม่เคยข้ามเน็ต ไม่บันทึกที่ไหน**
  🚫 **ห้ามส่งรหัสขึ้น API** — `AuditInterceptor` เป็น global (`app.module.ts:423`) และ redact
  เฉพาะคีย์ที่ชื่อตรงลิสต์ ⇒ ชื่อ `pdfPassword` รอดทุกด่านแล้วลง `audit_logs` ที่ลบไม่ได้
  🚫 **ห้ามลองรหัสอัตโนมัติจากเลขบัตร/วันเกิดในฐาน** — ปลดสำเร็จ = ยืนยันว่าเลขบัตรใบนั้นเป็นของ
  บัญชีนี้ ล้ม masking ของ role SALES ที่ `apps/api/src/utils/pii.util.ts:60-64` ตั้งใจปิดไว้

## งานที่ต้องทำ เรียงลำดับ

**0. ถามเจ้าของก่อนว่าเคาะ mockup แล้วหรือยัง** (ถ้ายัง อย่าเขียนโค้ดฟีเจอร์)

**รอบ 1 — ทำให้ใช้งานได้จริง**
1. เพิ่มคีย์ `affordablePayment` ในพรอมป์ต `credit-check-ai-analysis.service.ts:196-207`
   ใช้เกณฑ์เดิม (รายได้ × 40% เป็นเพดาน)
2. Endpoint ใหม่รับ `{ roomId, messageId }` → เซิร์ฟเวอร์ดึง `message.mediaUrl` เอง →
   เขียนลง GCS เป็น storage key → คืน key/URL ผ่านโปรกซี same-origin
   **ต้องเช็คสิทธิ์ห้องเอง** (ดูกับดักข้อ 8) · จัดการเคสไฟล์หมดอายุให้เป็น 4xx พร้อมข้อความไทย
3. ที่เก็บผูก `roomId` (ตาราง/คอลัมน์ใหม่ ท่า `Todo.roomId + attachments`)
   + เส้นทางย้ายเข้าประวัติลูกค้าตอนกดผูก
4. การ์ด "ตรวจเครดิต" ใน `RoomDossier.tsx` ตาม mockup (สถานะ: ว่าง/แนบแล้ว/กำลังวิเคราะห์/ผลย่อ/ผลกาง/เคสพัง)
5. drag source ที่ `MessageBubble.tsx` + drop target ที่ `<aside>` + **แก้ป้าย overlay ทั้งสองฝั่ง**
   (กับดักข้อ 1 — ข้อบังคับ)
6. ปุ่มบนบับเบิล (ทุกจอ) + toast พร้อมปุ่ม "เปิดแผง" เฉพาะจอเล็ก
7. ตรวจไฟล์ล็อกรหัสด้วย `pdf-lib` ฝั่งเว็บ (จับ `EncryptedPDFError`) → ขึ้นข้อความ "เปิดไฟล์นี้ไม่ได้"
   พร้อมทางออก **ไม่ต้องมีช่องกรอกรหัส** (คำตัดสินข้อ 5)
8. ฝั่ง API: ตรวจ `%PDF-` + `/Encrypt` ใน `validateFileBase64` และเปลี่ยน catch
   `ocr-extractors.service.ts:639-642` ให้ `err.status === 400` เป็น `BadRequestException`
   (ไม่งั้นข้อความถูก filter ทับ)

**รอบ 2 (หลังรอบ 1 ขึ้น)** — ช่องกรอกรหัส + `pdfjs-dist`
เงื่อนไขก่อนเริ่ม: ขอไฟล์สเตทเม้นตัวอย่างจริง 3-5 ใบจากธนาคารต่างกัน **จากเจ้าของ/พนักงาน
ไม่ใช่ดึงจาก prod** (prod มี PDF 736 ใบแต่เป็น PII ของลูกค้าจริง)

## วิธีทดสอบ (ตาม CLAUDE.md ของโปรเจกต์)

```bash
./tools/check-types.sh all              # ต้องผ่านทั้ง api และ web
cd apps/api && npx jest src/modules/<module>/
cd apps/web && npx vitest run src/pages/UnifiedInboxPage/
```
- DB specs ของ api ต้องรัน `--runInBand` (parallel แล้ว flaky)
- CLAUDE.md กำหนด Build Workflow: Write → Review (`code-reviewer` agent) → Test → Fix → Ship
- 🚨 **API ที่พอร์ต 3003 ใน worktree เคยชี้ prod ผ่าน cloud-sql-proxy 15432** —
  เช็ค `DATABASE_URL` ของ process ก่อนใช้เสมอ
- 🚨 **ห้ามฆ่า process ด้วย pattern (พอร์ต/ชื่อไฟล์)** — เคยปิด Chrome และ MCP ของเจ้าของ
  ใช้ PID ที่ตัวเอง spawn เท่านั้น
- `main` บังคับรีวิว 1 คน — merge เองไม่ได้ ต้องให้เจ้าของสั่ง
- ทุก deploy ต้อง bump `version` ใน `apps/web/package.json` (รูปแบบ YY.M.ลำดับ)

## suggested skills

ถ้า agent ปลายทางมีชุด skill เหล่านี้:
- `superpowers:brainstorming` — **ถ้าเจ้าของยังไม่เคาะ mockup** หรือมีคำถามใหม่โผล่มา
  (เส้นทาง architectural: ถาม → เสนอแนวทาง → เคาะ → ค่อยลงมือ)
- `superpowers:test-driven-development` — ทุกงานที่แตะโค้ด เขียนเทสต์ให้เห็นล้มก่อนแก้
- `superpowers:writing-plans` — ถ้าเคาะ mockup แล้ว ให้เขียนแผนลงมือก่อนแตะโค้ด
- `superpowers:verification-before-completion` — ก่อนบอกว่าเสร็จ ต้องมีผลรันจริงแปะ
- `frontend-design` / `ui-ux-pro-max` — ตอนทำการ์ดในแผงขวา
ถ้าไม่มี skill พวกนี้: ทำตามลำดับงานข้างบนตรง ๆ และยึด "เขียนเทสต์ก่อน + ไม่อ้างว่าเสร็จถ้าไม่ได้รัน"

## สิ่งที่ห้ามทำ

- ❌ เขียนโค้ดฟีเจอร์ก่อนเจ้าของเคาะ mockup
- ❌ ใส่ "ผ่าน/ไม่ผ่าน" คะแนน AI หรือ % ความมั่นใจ ลงในแผงขวา
- ❌ ส่งรหัส PDF ขึ้นเซิร์ฟเวอร์ / เก็บรหัส / ลองรหัสจากเลขบัตรในฐาน
- ❌ ทำ permission ใหม่สำหรับเอกสารเครดิต (เจ้าของเลือกให้ทุกคนในห้องเห็น)
- ❌ ยิงวิเคราะห์อัตโนมัติทุกครั้งที่ปล่อยไฟล์ (ชน idempotency 30 วิ ไฟล์หายเงียบ)
- ❌ ใช้ `Customer.documents` หรือลอกแพตเทิร์น `kyc.service.ts` (ทั้งคู่พังอยู่)
- ❌ ใส่ `id=` ตายตัวในการ์ดใหม่ (แผงถูก mount 2 ชุด)
