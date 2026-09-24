# ยื่น GFIN — แพ็กเช็คเครดิตจากห้องแชท ส่งเข้ากลุ่มไลน์เป็นข้อความ + ลิงก์

- วันที่: 2026-09-24
- สถานะ: **design เคาะโดยเจ้าของ** (mockup v6 + คำตอบ 5 ข้อ 2026-09-24) — รอเจ้าของทบทวนสเปกนี้ → writing-plans → PR 1
- อ้างอิงโค้ด: **origin/main `147273006`** ณ 2026-09-24
- mockup: artifact "Mockup ยื่น GFIN แผงขวาแชท" https://claude.ai/artifact/U3DMgJ3SWb8whpiiuLYPsa (15 บอร์ด)
- เกี่ยวข้อง: `apps/api/src/modules/gfin-config/` (เรท/ราคา GFIN — ไม่แตะ) · `apps/api/src/modules/credit-check/services/room-credit.service.ts` (หยิบไฟล์จากแชท — ใช้เป็นแม่แบบ) · `apps/api/src/modules/chatbot-finance/` (webhook OA ไฟแนนซ์) · `apps/api/src/modules/storage/` · `apps/web/src/pages/UnifiedInboxPage/components/RoomDossier.tsx` (แผงขวา) · `.claude/CLAUDE.md` ข้อ "GFIN integration — รอ business flow" (สเปกนี้คือ business flow รอบแรก)

---

## 1. ปัญหาและเป้าหมาย

ทุกวันนี้ก่อนกรอกฟอร์มเว็บของ GFIN (`client.gfinn.xyz/shop/loans/request`) พนักงานต้องส่ง "ชุดเช็ค" เข้ากลุ่มไลน์ **GFIN : BESTCHOICE (67301219)** ก่อน คือ

1. ข้อความ 12 ข้อ (ชื่อ อาชีพ รุ่น มือ 1/2 IMEI เบอร์ อายุ + ข้อ 8–12 เรื่องแบต/กล่อง/สายชาร์จ)
2. รูป 15–20 ไฟล์: ลูกค้าถือบัตร · บัตรประชาชน · สลิปเงินเดือน/สเตทเม้นหลายเดือน · หน้าเฟซบุ๊ก · เพื่อนเฟซบุ๊ก · ความเคลื่อนไหวเฟซบุ๊ก 2 รูป · หน้าไลน์ · หน้าจอตั้งค่าเครื่อง (รุ่น/ซีเรียล/แบต) · รูปเครื่อง 6 มุม

เอกสารของลูกค้ามาทางแชทของร้าน (ห้อง Facebook หรือ LINE ไฟแนนซ์) พนักงานต้องดาวน์โหลดแล้วส่งต่อเข้าไลน์ทีละรูป แล้วพิมพ์ข้อความเอง รอ GFIN ตอบในกลุ่ม พอผ่านค่อยไปกรอกเว็บซึ่งต้องพิมพ์ข้อมูลเดิมและอัปโหลดรูปชุดเดิมซ้ำ

**เป้าหมายรอบนี้ (เฟส 1):** เก็บชุดเช็คครั้งเดียวในแท็บ "GFIN" ของห้องแชท แล้วส่งเข้ากลุ่มไลน์เป็น **ข้อความเดียว + ลิงก์หน้าชุดเช็ค** ที่เจ้าหน้าที่ GFIN เปิดดูเอกสารทั้งหมดและกดตอบกลับได้ ผลตอบกลับเข้าใบยื่นในระบบร้านเอง

**ไม่ทำรอบนี้:** เติมฟอร์มเว็บ GFIN (เฟส 2) · สร้างใบขาย/จองเครื่อง · ให้บอทอ่านคำตอบในกลุ่มไลน์ · ลิงก์ลงทะเบียนลูกค้าของ GFIN (รอคำตอบ GFIN)

## 2. คำตัดสินของเจ้าของ (2026-09-24)

| # | เรื่อง | คำตัดสิน |
|---|---|---|
| D1 | วิธีส่งเข้ากลุ่ม | **บอท LINE OA ฝั่งไฟแนนซ์เข้ากลุ่ม GFIN แล้วส่งอัตโนมัติ** (ตัวเลือก ก) |
| D2 | รูปแบบที่ส่ง | **ข้อความ 12 ข้อ + ลิงก์หน้าชุดเช็ค** ไม่ส่งรูปเข้าไลน์ (แก้ปัญหา PDF/ชนิดไฟล์ที่ไลน์ไม่รับ และส่งไม่ครบแล้วซ้ำ) |
| D3 | ตำแหน่งในแผงขวา | **แท็บที่ 4 ชื่อ "GFIN"** ต่อจาก ลูกค้า · เงิน · เครื่อง — ไม่ใช่กลุ่มในแท็บลูกค้า |
| D4 | ข้อ 8–12 ของข้อความ | **ใส่ "-" เสมอ ไม่ต้องตอบ** ไม่มีสวิตช์เรื่องแบต |
| D5 | ห้องแชท LINE | **หยิบรูปจากห้อง LINE ได้ตั้งแต่ PR แรก** (ต้องแก้ webhook ให้เก็บรหัสข้อความ) |
| D6 | อายุไฟล์ | **ลบไฟล์อัตโนมัติ 90 วันหลังใบยื่นปิด** เก็บข้อความ 12 ข้อและผลไว้ตลอด |
| D7 | ปุ่มตอบของ GFIN ในหน้าลิงก์ | **ใส่ตั้งแต่ PR แรก** ใครมีลิงก์ก็กดได้ ไม่ใช่การอนุมัติทางการ พนักงานแก้ทับได้ |
| D8 | ชื่อรุ่นในข้อความ | **ชื่อเต็มตามสต๊อก** เช่น iPhone 13 Pro Max 256GB |
| D9 | ช่องติดต่อท้ายหน้าลิงก์ | **กลุ่มไลน์เท่านั้น** ไม่โชว์เบอร์ |
| D10 | mockup | เคาะ v6 (แท็บ GFIN · 4 ขั้น · หน้าลิงก์มือถือ/เดสก์ท็อป · ยืนยันส่ง · สถานะ · ตั้งค่า · มือถือร้าน) |

ค่าที่กำหนดโดยผู้เขียนสเปก (เจ้าของไม่ได้คัดค้าน): ลิงก์อายุ 7 วัน ต่ออายุได้ครั้งละ 7 วัน ยกเลิกได้ · ผู้สร้าง/ส่งใบยื่น = OWNER, BRANCH_MANAGER, FINANCE_MANAGER, SALES (SALES เฉพาะห้องที่ยังไม่มอบหมายหรือมอบหมายให้ตัวเอง เหมือนตรวจเครดิต) · ตั้งค่ากลุ่มไลน์และแม่แบบข้อความ = OWNER, FINANCE_MANAGER · เลขใบยื่น `BC-YYMMDD-NNN` · แจ้งเตือนคนส่งเมื่อ GFIN ตอบผ่านลิงก์

## 3. ลำดับ PR

| PR | เนื้อหา | ส่งได้ด้วย |
|---|---|---|
| **PR 1** | ตาราง + API + แท็บ GFIN 4 ขั้น + หยิบรูปจากแชท (Facebook และ LINE) + อัปโหลด + รูป 6 มุมจากสต๊อก + ร่างข้อความ + หน้าลิงก์สาธารณะ (ดู/ดาวน์โหลด/ตอบกลับ) + สถานะและไทม์ไลน์ + งานลบไฟล์ 90 วัน + webhook ไฟแนนซ์เก็บรหัสข้อความรูป | ปุ่ม "คัดลอกข้อความ + ลิงก์" พนักงานวางในไลน์เอง |
| **PR 2** | บอทส่งเข้ากลุ่ม: webhook รับเหตุการณ์เข้า/ออกกลุ่ม · ตาราง/หน้าตั้งค่าผูกกลุ่มกับ GFIN · ปุ่ม "ส่งเช็ค GFIN" ยิงข้อความ · ส่งข้อความทดสอบ | บอท (คัดลอกยังอยู่เป็นทางถอย) |

ทั้งสอง PR ขึ้น prod ก่อนบอกทีมใช้งานจริง ระหว่าง PR 1 ทีมทดลองใช้ด้วยปุ่มคัดลอกได้

## 4. โครงข้อมูล (Prisma)

### 4.1 ตารางใหม่

**`ExternalFinanceApplication`** → `external_finance_applications` (ตั้งชื่อกลางเผื่อไฟแนนซ์รายอื่น แต่ UI รอบนี้มีแต่ GFIN)

| คอลัมน์ | ชนิด | หมายเหตุ |
|---|---|---|
| id | uuid | |
| number | String @unique | `BC-YYMMDD-NNN` ลำดับต่อวัน ใช้ unique index + retry เมื่อชน (ไม่ใช้เลขสุ่มแบบ `OnlineInstallmationApplication` ที่ชนได้) |
| financeCompanyId | FK → ExternalFinanceCompany | แถว GFIN (มีอยู่แล้ว ผูกด้วยชื่อ `GFIN` ตอน seed/settings) |
| roomId | FK → ChatRoom | ห้องที่สร้างใบยื่น (required รอบนี้) |
| customerId | FK → Customer (nullable ตอน DRAFT, required ตอนส่ง) | |
| productId | FK → Product (nullable ตอน DRAFT, required ตอนส่ง) | |
| branchId | FK → Branch | จากผู้ใช้ที่สร้าง |
| status | enum `ExternalFinanceApplicationStatus` | ดู §9 |
| resultSource | enum `ExternalFinanceResultSource` {PARTNER_LINK, STAFF} nullable | ผลล่าสุดมาจากไหน |
| summary | Json | snapshot 7 ช่องที่เติมอัตโนมัติ ณ ตอนส่ง (ชื่อ อาชีพ รุ่น มือ IMEI เบอร์ อายุ) + fileCount |
| messageText | Text nullable | ข้อความ 12 ข้อฉบับที่ส่งจริง (รวมบรรทัดลิงก์) |
| occupationOverride | String nullable | กรณีพนักงานพิมพ์อาชีพในใบยื่นโดยไม่แก้บันทึกลูกค้า (ค่าเริ่มต้น: บันทึกลง Customer.occupation ด้วย) |
| sentAt · sentById · sentVia enum {BOT, COPY} · lineRequestId | | ครั้งแรกที่ส่ง |
| shareTokenHash | String @unique | sha256 ของโทเคน 32 ไบต์ (base64url) · **ไม่เก็บโทเคนดิบ** |
| shareExpiresAt · shareRevokedAt · shareViewCount Int · shareLastViewedAt | | |
| lastPartnerEventAt | DateTime nullable | ใช้ทำจุดบนแท็บ |
| closedAt · filesPurgedAt | | ปิด = APPROVED/REJECTED/CANCELLED |
| createdById · createdAt · updatedAt · deletedAt | | soft delete ตามแบบระบบ |

**`ExternalFinanceApplicationFile`** → `external_finance_application_files`

| คอลัมน์ | หมายเหตุ |
|---|---|
| id · applicationId | |
| slot | enum `ExternalFinanceDocSlot` {ID_SELFIE, ID_CARD, INCOME, FB_PROFILE, FB_FRIENDS, FB_ACTIVITY, LINE_PROFILE, DEVICE_SCREEN, DEVICE_PHOTO, GUARANTOR_ID, ADDRESS_BILL, PHONE_OPENING, OTHER} |
| storageKey | `external-finance/<applicationId>/<uuid>.<ext>` · nullable หลังลบตาม D6 |
| mimeType · size · originalName | ตรวจชนิดจริงจาก magic bytes: JPEG/PNG/WebP/GIF/PDF · ≤ 10 MB (กติกาเดียวกับ room-credit) |
| source | enum {CHAT_MESSAGE, UPLOAD, PRODUCT_PHOTO} |
| sourceMessageId | FK → ChatMessage nullable · unique ต่อใบยื่น (กันหยิบซ้ำ) |
| sourceAngle | String nullable (front/back/left/right/top/bottom) |
| sortOrder · sentAt (ส่งไปกับรอบไหน) · createdById · createdAt · deletedAt | |

**`ExternalFinanceApplicationEvent`** → `external_finance_application_events` (ไทม์ไลน์ append-only)

| คอลัมน์ | หมายเหตุ |
|---|---|
| id · applicationId · createdAt | |
| kind | enum {CREATED, SENT, RESENT, LINK_VIEWED, LINK_EXTENDED, LINK_REVOKED, PARTNER_ACK, PARTNER_MORE_INFO, PARTNER_APPROVED, PARTNER_REJECTED, STAFF_RESULT, CANCELLED, FILES_PURGED} |
| actorType | enum {STAFF, PARTNER, SYSTEM} |
| actorUserId | FK → User nullable |
| actorName | String nullable — ชื่อที่เจ้าหน้าที่ GFIN พิมพ์ (≤ 80) |
| note | Text nullable — ข้อความจาก GFIN (≤ 500) |
| meta | Json — เช่น `{ipHash, userAgent, viaFileCount}` ไม่เก็บ IP ดิบ |

**`LineGroupMembership`** → `line_group_memberships` (PR 2)

| คอลัมน์ | หมายเหตุ |
|---|---|
| id · channel (`LineChannelType`) · groupId @unique(channel, groupId) · groupName · pictureUrl nullable | ชื่อจาก `GET /v2/bot/group/{groupId}/summary` |
| joinedAt · leftAt nullable · memberCount nullable | |

### 4.2 ตารางเดิมที่แก้

- `ExternalFinanceCompany` เพิ่ม `lineGroupId String?` (อ้าง `LineGroupMembership.groupId`) และ `precheckTemplate String?` (แม่แบบข้อความ ถ้า null ใช้แม่แบบในโค้ด §7) — ทั้งสองคอลัมน์และหน้าตั้งค่าอยู่ใน PR 2 · PR 1 ใช้แม่แบบในโค้ดอย่างเดียว
- `ChatMessage`: ไม่เพิ่มคอลัมน์ แต่ webhook ไฟแนนซ์ต้อง**เขียน `externalMessageId = event.message.id`** สำหรับ IMAGE/FILE (วันนี้ `chatbot-finance.service.ts:353-359` บันทึกแค่ `text: '[image]'`) — unique index บางส่วน `chat_messages_external_message_id_key` มีอยู่แล้ว
- `.claude/mcp/sql/grants.sql`: ตารางใหม่ให้ MCP อ่านได้ **ยกเว้น** `shareTokenHash`, `actorName`, `note`, `meta`, `summary`, `messageText`, `originalName` (มีชื่อ/เบอร์/IMEI)

### 4.3 migration

ไฟล์เดียวต่อ PR ตามแบบ repo (`20261009000000_external_finance_application` สำหรับ PR 1) · ไม่มี backfill

## 5. API

โมดูลใหม่ `apps/api/src/modules/external-finance-application/` (ไม่ยัดเข้า `external-finance` เดิมที่เป็นเรื่องค่าคอม/ลูกหนี้)

### 5.1 ฝั่งพนักงาน (JWT · roles ตาม §11 · SALES ผ่านกติกา `access()` แบบ room-credit)

| Method · path | ทำอะไร |
|---|---|
| `POST /staff-chat/rooms/:roomId/finance-applications` | สร้าง DRAFT (ถ้ามี DRAFT ค้างในห้อง คืนใบเดิม) · บันทึก event CREATED |
| `GET /staff-chat/rooms/:roomId/finance-applications` | ใบปัจจุบัน (สถานะยังไม่ปิด) + ประวัติ: ถ้าห้องผูกลูกค้าแล้วดึงทุกใบของ `customerId` นั้น (ทุกห้อง) ถ้ายังไม่ผูกดึงเฉพาะของห้องนี้ |
| `GET /finance-applications/:id` | รายละเอียด + ไฟล์ + ไทม์ไลน์ + ข้อมูลลิงก์ |
| `PATCH /finance-applications/:id` | ตั้ง `productId`, `customerId`, `occupationOverride` (DRAFT/MORE_INFO เท่านั้น) |
| `POST /finance-applications/:id/files/from-message` `{messageId, slot}` | หยิบจากแชท: <br>• ข้อความมี `mediaUrl` เป็นคีย์ `staff-chat/` → อ่านจาก storage <br>• `mediaUrl` เป็น URL → `fetchMedia` (allowlist fbcdn/fbsbx/line-scdn ตาม room-credit.service.ts:57-67) <br>• ห้อง LINE ไม่มี `mediaUrl` แต่มี `externalMessageId` → `LineApiClientService.downloadContent(id, 'line-finance' หรือ 'line-shop' ตาม channel)` <br>คัดลอกเก็บที่ `external-finance/…` ทันที · ล้มเหลว → 400 "ไฟล์หมดอายุ ขอลูกค้าส่งใหม่" |
| `POST /finance-applications/:id/files` (multipart `file`, `slot`) | อัปโหลดจากคอม/มือถือ (`FileInterceptor` 10 MB) |
| `POST /finance-applications/:id/files/from-product` | คัดลอกรูป 6 มุมจาก `ProductPhoto` (base64 ใน DB) → storage ตามแบบ `promotePhoto` (`products-online-listing.service.ts:63-100`) · ใช้ได้เมื่อ `category = PHONE_USED` และ `isCompleted` · slot DEVICE_PHOTO |
| `DELETE /finance-applications/:id/files/:fileId` | ลบก่อนส่ง (หลังส่งแล้วลบไม่ได้ ต้องยกเลิกใบ) |
| `GET /finance-applications/:id/files/:fileId` | สตรีมไฟล์ (JWT) `Cache-Control: private, no-store` |
| `GET /finance-applications/:id/message-preview` | ข้อความ 12 ข้อที่จะส่ง + รายการช่องที่ขาด |
| `POST /finance-applications/:id/send` `{via: 'BOT' \| 'COPY'}` | ตรวจความพร้อม (§8) → ออกโทเคนลิงก์ (7 วัน) → สร้าง `messageText` → ถ้า BOT push เข้ากลุ่ม (PR 2) → สถานะ SENT · event SENT · คืน `{messageText, shareUrl}` · ถ้า push ล้มเหลว **ไม่เปลี่ยนสถานะ** คืน 502 พร้อมข้อความและให้ใช้ COPY |
| `POST /finance-applications/:id/resend` | ส่งเพิ่มเฉพาะไฟล์ที่ `sentAt` ว่าง: ข้อความสั้น "ส่งเอกสารเพิ่ม N ไฟล์ ลิงก์เดิม <link>" · ต่ออายุลิงก์ให้ครบ 7 วันนับจากวันนี้ · สถานะ MORE_INFO → SENT · event RESENT |
| `POST /finance-applications/:id/share/extend` · `/share/revoke` | +7 วัน / ยกเลิกทันที (event) |
| `POST /finance-applications/:id/result` `{result: APPROVED \| REJECTED \| MORE_INFO, note?}` | พนักงานบันทึกผลเอง (`resultSource = STAFF`) ทับผลจากลิงก์ได้ |
| `POST /finance-applications/:id/cancel` | ยกเลิกใบ (ทุกสถานะที่ยังไม่ปิด) · ลิงก์ถูกยกเลิกด้วย |
| `POST /ocr/id-card/from-message` `{roomId, messageId}` | ดึงรูปจากแชท (กติกาเดียวกับ from-message) แล้วเรียก `extractIdCard` เดิม คืน `OcrIdCardResult` · ฝั่งเว็บเอาไปเปิด `CustomerCreateDialog` ที่เติมค่าแล้ว → `POST /customers` → `POST /staff-chat/rooms/:id/link-customer` (ของเดิม `staff-chat.controller.ts:283`) |

### 5.2 หน้าลิงก์สาธารณะ (`@Public()` · ไม่มี JWT · throttle ต่อโทเคน+IP)

| Method · path | ทำอะไร |
|---|---|
| `GET /g/:token` | คืน **HTML ที่ API เรนเดอร์เอง** (ไม่ใช่ SPA) ตามบอร์ด 11/14 · มี OG tags ทั่วไป ("ชุดเช็คเครดิต · BESTCHOICE" + วันหมดอายุ **ไม่มีชื่อ/รูปลูกค้า**) · `X-Robots-Tag: noindex` · `Cache-Control: no-store` · `Referrer-Policy: no-referrer` · CSP อนุญาตเฉพาะ self · โทเคนไม่ถูกต้อง/หมดอายุ/ยกเลิก → 410 หน้า "ลิงก์นี้ใช้ไม่ได้แล้ว" (บอร์ด 13) ไม่มีข้อมูลใด ๆ · การเปิดสำเร็จบันทึก event LINK_VIEWED (เว้นซ้ำภายใน 5 นาทีต่อ ipHash) และเพิ่ม `shareViewCount` |
| `GET /g/:token/files/:fileId` | สตรีมไฟล์ผ่าน API (ไม่แจก URL ของ bucket) · `Content-Disposition: inline` · PDF เปิดในเบราว์เซอร์ |
| `GET /g/:token/zip` | zip ทั้งชุด (ไลบรารีใหม่ `archiver`) ชื่อไฟล์ `01-ลูกค้าถือบัตร.jpg` … · สตรีม ไม่สร้างไฟล์ชั่วคราว · throttle 5 ครั้ง/นาที |
| `POST /g/:token/reply` `{action: ACK \| MORE_INFO \| APPROVED \| REJECTED, name (≤80, required), note (≤500)}` | บันทึก event PARTNER_* + เปลี่ยนสถานะ (§9) + `lastPartnerEventAt` + แจ้งเตือนคนส่ง · throttle 10 ครั้ง/นาที · โทเคนต้องยังใช้ได้และใบยังไม่ปิด (ปิดแล้วรับ ACK/MORE_INFO ไม่ได้ คืน 409 พร้อมข้อความ) |

URL จริงคือ `https://bestchoicephone.app/api/g/<token>` — อยู่ใต้ prefix `/api` ที่ hosting rewrite ไป Cloud Run อยู่แล้ว (`firebase.json` target admin) ตามแบบหน้าแชร์สินค้า `/api/shop/share/:id` ที่บอทขายส่งให้ลูกค้าอยู่ทุกวัน ไม่ต้องแตะ hosting · ในเอกสารนี้เขียนย่อว่า `/g/:token` · ลิงก์สั้นแบบไม่มี `/api` (rewrite `/g/**`) เป็นของแถมทำทีหลังได้

หน้าลิงก์เป็น HTML + CSS ในตัว + JS ขนาดเล็ก (lightbox เลื่อนซ้ายขวา, ฟอร์มตอบกลับ) ไม่พึ่ง React/Tailwind ของแอป ใช้ฟอนต์ IBM Plex Sans Thai จาก Google Fonts และสีตามโทเคนของแอป (เขียว `#0B7A55` พื้น `#F9F8F6`) ตามบอร์ด 11–14 · รูปย่อ = รูปจริง `loading="lazy"` (ยังไม่ทำ thumbnail ด้วย sharp รอบนี้)

## 6. หน้าจอฝั่งพนักงาน (apps/web)

### 6.1 แท็บ GFIN ใน `RoomDossier`
- `TabKey` เพิ่ม `'gfin'` ป้าย "GFIN" ต่อท้าย (บอร์ด 1) · จุดสีเหลืองบนแท็บเมื่อ `lastPartnerEventAt` ใหม่กว่าที่ผู้ใช้เคยเปิด
- เนื้อหา 3 กลุ่ม: **ใบยื่นปัจจุบัน** (ใบยื่นใหม่ / ใบยื่น (ร่าง) ขั้น n/4 / ใบยื่น BC-… + ป้ายสถานะ) · **ประวัติใบยื่น** ของลูกค้าคนนี้ (ทุกห้องที่ผูกลูกค้าเดียวกัน) · **กลุ่มไลน์ปลายทาง** (PR 2: ชื่อกลุ่ม + พร้อมส่ง/บอทไม่อยู่ในกลุ่ม)
- แสดงในโหมด drawer บนจอแคบเหมือนแท็บอื่น (บอร์ด 10)

### 6.2 ใบยื่น 4 ขั้น (บอร์ด 2–5)
1. **ลูกค้า** — ห้องผูกลูกค้าแล้วและมีชื่อ อาชีพ วันเกิด เบอร์ครบ → ข้ามอัตโนมัติ · ห้องยังไม่ผูก → หยิบรูปบัตรจากแชท (ปุ่มบนบับเบิลหรือลาก) → `POST /ocr/id-card/from-message` → เปิด `CustomerCreateDialog` เดิมพร้อมค่าที่อ่านได้ → สร้างและผูกห้อง · รูปบัตรใบนั้นเข้าช่อง ID_CARD ให้เอง · ช่องที่บัตรไม่มี: อาชีพ (required) และเบอร์ — บันทึกลง Customer
2. **เครื่อง** — ค้นสต๊อกด้วย IMEI ท้าย 4 ตัวหรือชื่อรุ่น (API ค้นสินค้าเดิม จำกัดสถานะพร้อมขาย/จอง) → แสดง IMEI ซีเรียล แบต (QC) รูป 6 มุม · ไม่มีคำถามให้ตอบ (D4)
3. **รูป** — ช่อง 9 ประเภทหลัก + 3 ช่อง "ถ้ามี" · แต่ละช่องเติมได้ 3 ทาง: หยิบจากแชท (ปุ่ม GFIN บนบับเบิล / ลากมาวางแล้วเลือกช่อง บอร์ด 4b) · อัปโหลด (มือถือใช้ `<input capture="environment">`) · DEVICE_PHOTO จากสต๊อกอัตโนมัติเมื่อครบ 6 ใบ ไม่ครบ = ช่องถ่ายเพิ่ม · แสดง "ครบ n/9 · ไฟล์รวม" · PDF รับได้
4. **ข้อความ** — preview ข้อความ 12 ข้อ (§7) + คำเตือนช่องที่ขาด + ปุ่ม **ส่งเช็ค GFIN** (PR 1 = COPY: คัดลอกข้อความ+ลิงก์ลงคลิปบอร์ดแล้วบันทึกว่าส่งแล้ว · PR 2 = BOT) + ปุ่ม "คัดลอกข้อความ + ลิงก์" (ทางถอยเสมอ) · กล่องยืนยันก่อนส่ง (บอร์ด 6) มีเช็กบ็อกซ์ "ตรวจแล้วว่าไฟล์ทุกใบเป็นของลูกค้าคนนี้"

### 6.3 หลังส่ง (บอร์ด 7)
- การ์ดสรุป + ป้ายสถานะ · กล่องลิงก์: เปิดดูกี่ครั้ง ล่าสุดเมื่อไร หมดอายุเมื่อไร ปุ่ม ต่ออายุ / ยกเลิก / เปิดหน้าลิงก์ · ไทม์ไลน์จาก events · ปุ่ม "เพิ่มรูปแล้วส่งเพิ่ม" (เปิดขั้นรูปเฉพาะเพิ่ม แล้ว resend) · ปุ่มบันทึกผลเอง ผ่าน/ไม่ผ่าน/ขอเพิ่ม · ขั้นต่อไปเมื่อผ่าน: ลิงก์ไปฟอร์มเว็บ GFIN (เปิดแท็บใหม่ `client.gfinn.xyz/shop/loans/request`) และลิงก์ไป POS

### 6.4 บับเบิลในแชท (`MessageBubble`)
- ปุ่ม "ใส่ในใบยื่น GFIN" (ไอคอน file-check) แสดงเมื่อห้องมีใบยื่น DRAFT/MORE_INFO และข้อความเป็น IMAGE/FILE ที่ `mediaUrl` หรือ `externalMessageId` มีค่า (ขยายจากเงื่อนไข `canCredit` ที่ `MessageBubble.tsx:139` ซึ่งดูแค่ `mediaUrl`) · กดแล้วเปิด popover เลือกช่อง (บอร์ด 4b) · ลากใช้ MIME ใหม่ `application/x-bestchoice-gfin-message` ไปวางที่แผงขวา → popover เดียวกัน
- ไฟล์ที่หยิบแล้วแสดงเครื่องหมายบนบับเบิล · หยิบซ้ำ = เอาออก (เหมือนตรวจเครดิต)

### 6.5 ตั้งค่า › ไฟแนนซ์ › GFIN (บอร์ด 9 · PR 2)
- ส่วน "กลุ่มไลน์ที่รับชุดเช็ค": 3 ขั้นตอน + รายการกลุ่มจาก `LineGroupMembership` (channel FINANCE) เลือกผูกกับ GFIN + ปุ่มส่งข้อความทดสอบ · ถ้าบอทถูกเตะออก (leftAt) แสดงเตือนและปุ่มส่งในแชทขึ้นข้อความเตือน
- ส่วน "ข้อความ 12 ข้อ (แม่แบบ)": textarea แก้ถ้อยคำได้ ใช้ placeholder ตาม §7 · ปุ่ม "ใช้ค่าเริ่มต้น"

## 7. ข้อความ 12 ข้อ (builder ใน `packages/shared`)

แม่แบบเริ่มต้น (ถ้อยคำเดียวกับที่ทีมส่งอยู่ ไม่แก้):

```
รายละเอียดที่ต้องแจ้งเช็คค่ะ
1.ชื่อลูกค้า : {{customerName}}
2.ทำอาชีพ : {{occupation}}
3.สนใจโทรศัพท์รุ่น : {{model}}
4.มือ1/2 : {{hand}}
5.เลขอีมี่ : {{imei}}
6.เบอร์ลูกค้า : {{phone}}
7.อายุ : {{age}} ปี
8.แบตเปลี่ยนมาหรือไม่? : -
9.แบตแท้หรือไม่แท้? : -
10.ลูกค้าทราบเรื่องแบตแล้วใช่ไหม? : -
11.มีกล่องหรือไม่? : -
12.มีสายชาร์จหรือไม่? : -
ส่งโดย {{staffName}} · BESTCHOICE
เอกสารทั้งหมด {{fileCount}} ไฟล์: {{link}}
```

- `customerName` = `Customer.name` (ถอดรหัสผ่าน `CustomerPiiService`) ไม่ใส่คำนำหน้า · `occupation` = `occupationOverride ?? Customer.occupation` · `model` = ชื่อสินค้าเต็มจากสต๊อก (`Product.name` + `storage` ถ้าชื่อไม่มีความจุ) · `hand` = 2 เมื่อ `category = PHONE_USED` นอกนั้น 1 (PHONE_NEW, TABLET) · `imei` = `Product.imeiSerial` · `phone` = จัดรูป `0XX XXX XXXX` · `age` = ปีเต็มจาก `Customer.birthDate` ณ วันส่ง · `staffName` = ชื่อผู้กดส่ง · `link` = URL เต็ม
- พนักงานกด "แก้ข้อความ" ในขั้น 4 เพื่อแก้ถ้อยคำเฉพาะใบนี้ได้ก่อนส่ง (เช่น TABLET มือสอง) — ฉบับที่แก้ถูกเก็บเป็น `messageText` · บรรทัดลิงก์แก้ไม่ได้
- ข้อ 8–12 เป็นค่าคงที่ "-" ในแม่แบบ (D4) — ผู้ตั้งค่าแก้ถ้อยคำได้ แต่ระบบไม่มีข้อมูลเติมให้
- ฟังก์ชัน pure: `buildPrecheckMessage(template, values)` ทดสอบด้วย golden text · แม่แบบต้องมี `{{link}}` เสมอ (validate ตอนบันทึกตั้งค่า)

## 8. ความพร้อมก่อนส่ง (validation)

ส่งได้เมื่อ: มี `customerId` และ `productId` · ค่าทั้ง 7 ช่องของข้อความไม่ว่าง (อาชีพ เบอร์ วันเกิด ต้องมี) · ช่องบังคับมีไฟล์: ID_SELFIE ≥ 1, ID_CARD ≥ 1, INCOME ≥ 1 · สินค้ายังอยู่ในสถานะพร้อมขายหรือจอง
ช่องอื่นขาดได้แต่แสดงคำเตือนสีเหลือง "GFIN อาจขอเพิ่ม" (บอร์ด 5) · ถ้าเครื่องเป็น PHONE_USED ที่รูป 6 มุมครบ ระบบเติม DEVICE_PHOTO ให้ตอนเลือกเครื่อง (ลบออกได้)

## 9. สถานะและกติกา

```
DRAFT ──send──▶ SENT ──PARTNER_ACK──▶ ACKNOWLEDGED
  │               │  └─PARTNER_MORE_INFO / STAFF ขอเพิ่ม──▶ MORE_INFO ──resend──▶ SENT
  │               └─PARTNER_APPROVED / STAFF ผ่าน──▶ APPROVED (ปิด)
  │               └─PARTNER_REJECTED / STAFF ไม่ผ่าน──▶ REJECTED (ปิด)
  └─cancel (ทุกสถานะที่ยังไม่ปิด) ──▶ CANCELLED (ปิด)
```

- ACKNOWLEDGED ไปต่อได้เหมือน SENT · ปิดแล้วรับคำตอบจากลิงก์ไม่ได้ (409) แต่พนักงานแก้ผลได้จนกว่าจะทำใบขาย
- ห้องหนึ่งมีใบยื่นที่ยังไม่ปิดได้ครั้งละ 1 ใบ · ลูกค้าคนเดียวยื่นหลายครั้งได้ (ประวัติ)
- ลิงก์: หมดอายุ 7 วันนับจากส่ง · resend/extend ต่ออายุเป็น 7 วันนับจากตอนนั้น · revoke/cancel ทำให้ 410 ทันที · ปิดใบแล้วลิงก์ยังใช้ได้จนหมดอายุ (GFIN อาจกลับมาดู)
- ลบไฟล์ (D6): cron รายวัน (โมดูล retention ที่มีอยู่) หา `closedAt < now - 90d AND filesPurgedAt IS NULL` → ลบ object ใน bucket, `storageKey = null`, `filesPurgedAt = now`, event FILES_PURGED · แถวและข้อความ 12 ข้อคงอยู่
- ไม่แตะสต๊อก ไม่จองเครื่อง (สินค้าอาจถูกขายให้คนอื่นระหว่างรอ — แสดงคำเตือนในใบยื่นถ้าสถานะสินค้าเปลี่ยนไปจากตอนส่ง)

## 10. LINE (PR 2)

- ใช้ **OA ฝั่งไฟแนนซ์** (`line-finance`) เท่านั้น · ห้ามใช้ OA ร้าน เพราะ webhook ร้าน (`line-oa-chatbot.controller.ts:106-160`) ไม่เช็ก `source.type` จะเอาข้อความกลุ่มไปยัดห้อง 1:1 ของสมาชิก
- webhook ไฟแนนซ์ (`chatbot-finance.service.ts`) เพิ่ม: `join` → upsert `LineGroupMembership` + ดึงชื่อกลุ่มจาก `GET /v2/bot/group/{groupId}/summary` · `leave` → `leftAt` · ข้อความในกลุ่มยังทิ้งเหมือนเดิม (`handleMessage` ข้ามที่ไม่ใช่ `user` อยู่แล้ว) · PR 1: IMAGE/FILE จากผู้ใช้เก็บ `externalMessageId`
- ส่ง: `LineApiClientService.pushMessage(groupId, [{type:'text', text}], 'line-finance')` ข้อความเดียว ≤ 5,000 ตัวอักษร · เก็บ `x-line-request-id` ใน `lineRequestId` · ล้มเหลว → 502 ไม่เปลี่ยนสถานะ
- ฝั่ง LINE Official Account Manager (เจ้าของทำเอง): เปิด "อนุญาตให้เข้าร่วมกลุ่มและแชทหลายคน" · ปิดข้อความทักทายเมื่อเข้ากลุ่ม · เชิญ OA เข้ากลุ่ม GFIN : BESTCHOICE
- ไม่มีการอ่านคำตอบในกลุ่มด้วยบอท (นอกขอบเขต)

## 11. สิทธิ์

| การกระทำ | OWNER | BRANCH_MANAGER | FINANCE_MANAGER | SALES |
|---|---|---|---|---|
| สร้าง/แก้/หยิบไฟล์/ส่ง/ส่งเพิ่ม/บันทึกผล/ยกเลิก/ต่ออายุ/ยกเลิกลิงก์ | ✓ | ✓ | ✓ | ✓ เฉพาะห้องที่ยังไม่มอบหมายหรือมอบหมายให้ตัวเอง (กติกาเดียวกับ room-credit.service.ts:92-98) |
| ดูใบยื่นและประวัติ | ✓ | ✓ | ✓ | ✓ (ห้องที่เข้าถึงได้) |
| ตั้งค่ากลุ่มไลน์ / แม่แบบข้อความ / ส่งข้อความทดสอบ | ✓ | – | ✓ | – |
| หน้าลิงก์ | ใครก็ได้ที่มีโทเคน (ไม่ต้องล็อกอิน) | | | |

## 12. ความปลอดภัยและข้อมูลส่วนบุคคล

- โทเคน 32 ไบต์สุ่ม (base64url 43 ตัว) เก็บเฉพาะ sha256 · เทียบแบบ constant-time · URL ไม่มีเลขใบยื่นหรือรหัสลูกค้า
- ทุก response ของ `/g/*`: `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`, `Content-Security-Policy` เฉพาะ self + fonts.googleapis/gstatic · ไม่มี URL ของ bucket หลุดออกไป (สตรีมผ่าน API เท่านั้น)
- OG preview ไม่มีชื่อ รูป หรือข้อมูลลูกค้า (D9 + บอร์ด 8)
- throttle: หน้า 60/นาที · ไฟล์ 120/นาที · zip 5/นาที · reply 10/นาที ต่อโทเคน+IP (ใช้ `ThrottlerModule` ที่มีใน `app.module.ts:175`)
- บันทึกการเปิดดูและการตอบ: ipHash (sha256 + salt ประจำระบบ) + user agent · ไม่เก็บ IP ดิบ
- ข้อความ 12 ข้อและไฟล์คือข้อมูลส่วนบุคคล: ส่งให้ GFIN ตามความยินยอมที่ลูกค้าให้กับ GFIN ในกระบวนการขอสินเชื่อ (กระบวนการเดิมที่ทำด้วยมืออยู่แล้ว ไม่เพิ่มผู้รับข้อมูลใหม่) · เก็บไฟล์ 90 วันหลังปิด (D6) · **ให้เจ้าของตรวจว่านโยบายความเป็นส่วนตัวหน้า `/privacy` กล่าวถึงการส่งข้อมูลให้บริษัทไฟแนนซ์คู่ค้าแล้วหรือยัง** (นอกขอบเขตโค้ด)
- `AuditInterceptor` เดิมมาสก์ `data:` ใน body อยู่แล้ว · การอัปโหลดใช้ multipart ไม่ใช่ base64 จึงไม่ลง audit_logs ทั้งไฟล์
- ปุ่มตอบในหน้าลิงก์ไม่ใช่การอนุมัติทางการ (D7) แสดงคำนี้ในหน้าลิงก์และในแท็บ

## 13. การแจ้งเตือน

- GFIN ตอบผ่านลิงก์ → แจ้งเตือนในระบบถึงผู้ส่งใบยื่น (โมดูล notifications เดิม + realtime ผ่าน `events.gateway`) · จุดเหลืองบนแท็บ GFIN ของห้องนั้น · ไม่ส่ง LINE ถึงพนักงาน (ยังไม่มี LINE staff webhook)
- บอทถูกเตะออกจากกลุ่ม (PR 2) → แจ้งเตือน OWNER/FM

## 14. การทดสอบ

- **API (jest, `--runInBand`)**: builder ข้อความ (golden) · state machine ทุกทางเดินรวม 409 · โทเคน hash/หมดอายุ/ยกเลิก → 410 · reply + throttle + event + แจ้งเตือน · หยิบไฟล์ 3 ทาง (mock fetch fbcdn · mock `downloadContent` · base64 → storage) + ปฏิเสธชนิดไฟล์/ขนาด · from-product เฉพาะ PHONE_USED ครบ 6 · สิทธิ์ SALES ตามห้อง · cron ลบไฟล์ 90 วัน · webhook เก็บ `externalMessageId` · (PR 2) join/leave + push payload + push ล้มเหลวไม่เปลี่ยนสถานะ
- **Web (vitest)**: แท็บ GFIN 3 สถานะ (ว่าง/ร่าง/ส่งแล้ว) · 4 ขั้น · popover เลือกช่อง · เงื่อนไขปุ่มบนบับเบิล (`mediaUrl || externalMessageId`) · กล่องยืนยัน · ไทม์ไลน์ · จุดบนแท็บ
- **หน้าลิงก์**: snapshot HTML (ไม่มีชื่อลูกค้าใน `<head>`) · 410 page · lightbox/zip ทดสอบด้วย e2e
- **E2E (playwright, ชุดที่มีอยู่)**: สร้างร่าง → หยิบรูปจากแชท (fixture ห้อง Facebook) → เลือกเครื่อง → ส่งแบบ COPY → เปิด `/g/<token>` → กด "ขอเอกสารเพิ่ม" → แท็บแสดงสถานะ
- **ทดสอบจริงก่อนบอกทีม**: ส่งข้อความทดสอบเข้ากลุ่ม GFIN จริง (PR 2) · เปิดลิงก์จากไลน์บน iPhone และ Android · ลองไฟล์ PDF จริง

## 15. ไม่ทำในรอบนี้ (ตัดสินแล้ว)

เติมฟอร์มเว็บ GFIN ด้วยส่วนขยาย Chrome (เฟส 2 — state ของฟอร์มเขาอยู่ใน localStorage `loan-store` ดูบันทึกผลสำรวจ) · สร้างใบขาย/จองเครื่องจากใบยื่น · บอทอ่านคำตอบในกลุ่ม · ลายน้ำบนรูป · รูปย่อด้วย sharp · เชื่อมลิงก์ลงทะเบียนลูกค้าของ GFIN (รอคำตอบ GFIN) · ไฟแนนซ์รายอื่นใน UI · เก็บรูปจาก LINE ถาวรตั้งแต่ตอนรับ (ยังดึงตอนหยิบ)

## 16. งานที่เจ้าของทำเอง

1. ถาม GFIN: ลูกค้าลงทะเบียนผ่านลิงก์ QR ของร้านแล้ว GFIN เช็คจากคิวในระบบแทนไลน์ได้ไหม · มี API สำหรับพาร์ทเนอร์ไหม (กำหนดขนาดเฟส 2)
2. LINE OA Manager ของ OA ไฟแนนซ์: เปิดอนุญาตเข้ากลุ่ม · ปิดทักทายในกลุ่ม · เชิญเข้ากลุ่ม GFIN : BESTCHOICE (ก่อน PR 2 ขึ้น)
3. บอกเจ้าหน้าที่ GFIN ว่าต่อไปจะได้ข้อความ + ลิงก์ และกดตอบในลิงก์ได้
4. ตรวจถ้อยคำนโยบายความเป็นส่วนตัว (§12)

## 17. ความเสี่ยงและทางรับมือ

| ความเสี่ยง | รับมือ |
|---|---|
| รูปใน LINE หมดอายุฝั่ง LINE ก่อนหยิบ / ลิงก์ Facebook หมดอายุ | ข้อความบอกชัด "ขอลูกค้าส่งใหม่" · หยิบทันทีที่ลูกค้าส่งจะไม่เจอ |
| GFIN ไม่เปิดลิงก์ อยากได้รูปในไลน์เหมือนเดิม | ยังได้ข้อความ 12 ข้อครบ · ปุ่มดาวน์โหลด zip ให้พนักงานส่งรูปเองได้ใน 1 นาที · เก็บสถิติเปิดลิงก์ไว้คุยกับ GFIN |
| โทเคนหลุด | อายุ 7 วัน · ยกเลิกได้ · ไม่มี PII ใน preview · จดการเปิดทุกครั้ง |
| ยิง `/g/*` ถล่ม | throttle + 410 เร็วสำหรับโทเคนผิด · ไม่มี query ฐานหนักก่อนตรวจ hash |
| zip ใหญ่ | สตรีม · จำกัด 10 MB/ไฟล์ · ≤ 40 ไฟล์ต่อใบ |
| แม่แบบข้อความถูกแก้จนไม่มี `{{link}}` | validate ตอนบันทึก |
| ห้องเดียวยื่นซ้ำ | 1 ใบที่ยังไม่ปิดต่อห้อง · ปุ่มเริ่มใบใหม่ปิดจนกว่าใบเดิมจะปิด |

## 18. คำถามค้าง (ไม่ขวางการเขียนแผน)

- GFIN ตอบเรื่องคิว QR/API อย่างไร (§16 ข้อ 1) — กระทบเฟส 2 เท่านั้น
- TABLET/PHONE_NEW ใช้ค่า "มือ 1/2" แบบไหน — แผนใช้ PHONE_NEW/TABLET ใหม่ = 1, มือสอง = 2 ถ้าเจ้าของไม่แย้ง
