# ผู้สนใจจากแชท — ทุกคนที่ทักเข้ามามีประวัติเป็น "ผู้สนใจ" ในระบบ

วันที่: 2026-09-13 · สถานะ: **ร่างรอเจ้าของรีวิว** · branch: `feat/chat-prospects`

## 0. คำตัดสินของเจ้าของที่สเปคนี้ยึด

| วันที่ | คำตัดสิน |
|---|---|
| 2026-09-12 | "ลูกค้า" = คนที่ซื้อกับเราแล้ว (เงินสด/ผ่อน/ไฟแนนซ์นอก) · ที่เหลือคือ "ผู้สนใจ" (ไม่ใช้คำว่า Lead ในหน้าจอ; ในโค้ด/URL ใช้ `prospect`) |
| 2026-09-13 | **"ต้องเก็บข้อมูลไว้ — ลูกค้าที่ทักเข้ามา = ผู้สนใจ"** (กลับคำตัดสิน 12 ก.ย. ที่ให้แค่ดึงจากแชทมาแสดง) |
| 2026-09-13 | ย้อนหลังห้องแชทเดิม **ทั้งหมด 8,866 ห้อง** (ตั้งแต่ 12 พ.ค. 69) |
| 2026-09-13 | เป้าหมายของเจ้าของ: เอาผู้สนใจไว้วิเคราะห์ lead + ทำการตลาดให้ถูกทาง |

## 1. เป้าหมาย (ประโยคเดียว)

ทุกคนที่ทักเข้ามาทางแชท (Facebook / LINE / TikTok / เว็บ) ต้องมีแถวใน `customers` เป็น "ผู้สนใจ" ทันที เพื่อให้แท็บผู้สนใจในหน้า `/customers` (PR #1590) ทำงานได้เต็ม — ที่มา · ติดต่อล่าสุด · ผู้ดูแล · ปุ่มเปิดแชท · KPI · ส่งออก Excel — และเป็นจุดยึดตอนเติมเบอร์/เลขบัตร หรือรวมเข้ากับลูกค้าเดิม โดย **คนหนึ่งคนต้องมีแถวเดียว**

สิ่งที่ *ไม่* ทำในรอบนี้: ไม่ทำ pipeline/CRM stage · ไม่ทำ journal รายคน · ไม่แก้ตัวเลือกลูกค้าหน้าจอง/สัญญา/เช็คเครดิตนอกจากคำใบ้ · ไม่ทำ Web Push

## 2. สภาพปัจจุบัน (ตรวจจากโค้ด `origin/main` `ac2399645` + prod 2026-09-13)

- ข้อความขาเข้าเขียนแค่ `chat_rooms` + `chat_messages` ชื่อ/รูป Facebook อยู่บน `ChatRoom.displayName/pictureUrl` · แท็บผู้สนใจอ่านจาก `customers` เท่านั้น (`customer-query.service.ts:51` `PROSPECT_WHERE`) ⇒ คนที่มีแค่ห้องแชทไม่โผล่
- prod: ห้องแชท 8,866 (Facebook ทั้งหมด · ไม่มี LINE สักห้อง) · ผูกลูกค้าแค่ **1 ห้อง** · ไม่มีชื่อ Facebook 24 ห้อง · คุยใน 90 วัน 7,102 · ลูกค้า 40 (ผู้สนใจ 30)
- `Customer.phone` เป็น `String` **NOT NULL** (`apps/api/prisma/schema.prisma:905`) แต่คนทักแชทไม่มีเบอร์
- `CrmLead` ไม่มีช่องชื่อ/เบอร์ของตัวเอง ต้องแขวนกับ `Customer` ⇒ ใช้แทนไม่ได้
- ระบบยังไม่มีฟังก์ชัน "รวมลูกค้าซ้ำ" — เบอร์ซ้ำ = `ConflictException` พร้อม `existingCustomer` (`customer-write.service.ts:174`)
- ห้อง Facebook **ไม่มี unique constraint** (`@@unique([lineUserId, channel])` ครอบเฉพาะ LINE) และหาห้องเดิมด้วย `findFirst` ไม่มี lock (`room-manager.service.ts:141-147`) ⇒ คนเดียวมีหลายห้องได้ (`findByExternalUser` ที่เลือก "ห้องล่าสุดของคนนั้น" ยืนยันว่าโค้ดคาดไว้แล้ว) — นับจริงบน prod ผ่าน MCP ไม่ได้ (PSID เป็นคอลัมน์ต้องห้าม) ต้องนับผ่าน cloud-sql-proxy ก่อน backfill
- จุดสร้างห้องมี 2 บริการ: `RoomManagerService.getOrCreateRoom` (`room-manager.service.ts:118` — เรียกจาก `message-router` ขาเข้า/mirror ขาเข้า/mirror ขาออก, web-widget, overdue-chat) และ `chatbot-finance/services/chat-room.service.ts:58` (LINE การเงิน)
- **`mirrorOutbound` สร้างห้องได้โดยไม่ดึงโปรไฟล์** (`message-router.service.ts:658`) ⇒ ห้องอาจเกิดก่อนรู้ชื่อ

### ผล spike (2026-09-13, worktree นี้): `phone String?`

`npx tsc --noEmit -p apps/api/tsconfig.json` — baseline **0 error** → หลังเปลี่ยนเป็น nullable **20 error ใน 11 ไฟล์**:

| ไฟล์ | จำนวน | ความหมาย |
|---|---|---|
| `chatbot-finance/services/verification.service.ts` | 6 | จับคู่เบอร์ตอนยืนยันตัวตน |
| `chatbot-finance/services/slip-processing.service.ts` | 3 | ส่งผลสลิปกลับตามเบอร์ |
| `overdue/dunning-engine.service.ts` | 2 | ส่ง SMS/แจ้งเตือนตามเบอร์ |
| `bookings/bookings.service.ts` | 2 | ใบจองคัดลอกเบอร์ |
| `contracts/contract-snapshot.service.ts` · `contract-lifecycle.service.ts` · `contract-exchange/contract-exchange.service.ts` | 1+1+1 | snapshot ข้อมูลลูกค้าลงสัญญา |
| `sales/services/sale-writer.service.ts` · `sale-creation.service.ts` | 1+1 | snapshot ลงใบขาย |
| `trade-in/services/trade-in-lifecycle.service.ts` · `defect-exchange/defect-exchange.service.ts` | 1+1 | เอกสารรับซื้อ/เปลี่ยนเครื่อง |

ฝั่งเว็บไม่ import type จาก Prisma (type เขียนมือ) ⇒ ไม่มี error จากการเปลี่ยน schema; ต้องแก้ type + จุดแสดงผลเอง

**ข้อสรุป:** 20 จุดคือรายการ "โค้ดที่สมมติว่ามีเบอร์เสมอ" พอดี — เปลี่ยนเป็น nullable แล้วให้คอมไพเลอร์บังคับใส่ด่านทุกจุด ดีกว่าเก็บค่าว่าง `''` ซึ่งคอมไพล์ผ่านแต่ทำงานผิดเงียบ ๆ (ส่ง SMS ไปเบอร์ว่าง, snapshot เบอร์ว่างลงสัญญา) และต้องมี special case ใน DTO/ฟอร์ม/นิยามตลอดไป

## 3. แบบ

### 3.1 ข้อมูล

**Migration เดียว:** `ALTER TABLE customers ALTER COLUMN phone DROP NOT NULL` (+ `phone String?` ใน `schema.prisma`) — ไม่เพิ่มตาราง ไม่เพิ่มคอลัมน์

**ผู้สนใจอัตโนมัติ (placeholder)** = แถว `customers` ที่:

| ฟิลด์ | ค่า |
|---|---|
| `name` | ชื่อจากห้องแชท (`displayName`) · ไม่มี → `"Facebook #" + รหัสผู้ใช้ของช่องทาง 4 ตัวท้าย` (รหัส = `lineUserId ?? externalUserId` ตาม externalKey ใน 3.2; LINE → `"LINE #…"`, TikTok → `"TikTok #…"`, เว็บ → `"เว็บ #…"`) |
| `phone` | `null` |
| `acquisitionSource` | `CHAT_FACEBOOK` / `CHAT_LINE` / `CHAT_TIKTOK` / `CHAT_WEB` (ตาม `chatLogoOf(channel)` ใน `packages/shared/customer-sort.ts` — LINE_FINANCE/LINE_SHOP ยุบเป็น LINE) — เก็บที่มาติดตัวไว้แม้ห้องถูกลบ |
| `facebookUserId` / `facebookName` | PSID / ชื่อ (เฉพาะ Facebook — คอลัมน์มีอยู่แล้ว) |
| `createdAt` | `room.createdAt` (วันทักครั้งแรก — ทั้งห้องใหม่และ backfill) |
| `status` / `creditCheckStatus` / `chatConsent` | default (`ACTIVE` / `NONE` / `false`) |

ห้องแชท: `customerId` = แถวนี้ · **`verifiedAt` ไม่แตะ** (ยังไม่ยืนยันตัวตน — `canned-response-sender.service.ts:113` ใช้ `verifiedAt` คุมเทมเพลตที่ส่งได้เฉพาะคนยืนยันแล้ว จึงยังปลอดภัย)

**นิยามในโค้ด (helper เดียว ใช้ทั้ง API):**
```ts
isChatPlaceholder(c) = c.acquisitionSource?.startsWith('CHAT_') && c.phone == null && c.nationalId == null
```
เติมเบอร์หรือเลขบัตรเมื่อไหร่ = ผู้สนใจธรรมดา (ที่มายังเป็น `CHAT_*` เพื่อการตลาด) · ซื้อเมื่อไหร่ = ลูกค้า (นิยามเดิม `BOUGHT_WHERE`) — แท็บผู้สนใจ/ลูกค้า KPI ตัวกรอง ส่งออก **ไม่ต้องแก้ตัวกรองเลย**: `PROSPECT_WHERE` รับแถวนี้อยู่แล้ว, `NOT_BOT_WHERE` ตรวจแค่ `AI_CHAT`, `deriveSource` (`customer-query.service.ts:184`) ใช้ช่องทางห้องล่าสุด — เพิ่มกิ่ง `CHAT_*` → ช่องทางจาก suffix สำหรับกรณีห้องถูกลบ

API ส่งฟิลด์ใหม่ให้เว็บ: `chatPlaceholder: boolean` ในแถวผู้สนใจ (`GET /customers?view=prospects`), รายละเอียดลูกค้า (`GET /customers/:id`) และห้องแชท (`GET /staff-chat/rooms/:id` → `customer.chatPlaceholder`)

### 3.2 หน่วยนับ = คน ไม่ใช่ห้อง (แก้ Blocker 1 จากผลตรวจ)

บริการใหม่ `ChatProspectService` (โมดูล `customers`, ไฟล์เดียว หน้าที่เดียว):

```
ensureForRoom(roomId):
  1. room.customerId มีแล้ว → คืนเลย
  2. ล็อกต่อคน: pg_advisory_xact_lock(hashtext(channel + ':' + externalKey))   // externalKey = lineUserId ?? externalUserId
  3. หาห้องอื่นที่ยังไม่ถูกลบของ (channel, externalKey) ที่มี customerId → ใช้คนนั้น (ไม่สร้างใหม่)
  4. ไม่มี → สร้าง placeholder ตาม 3.1 (createdAt = room.createdAt)
  5. อัปเดต room.customerId (verifiedAt คงเดิม)
```
- ทำใน `$transaction` เดียว (ล็อก + หา + สร้าง + ผูก) — ล็อกแบบ advisory ตามแบบ `lockCreditRoom` / `lockCreditCustomer` ที่ repo ใช้อยู่ ⇒ ข้อความแรก 2 ชิ้นที่มาพร้อมกันได้ลูกค้าคนเดียวแม้จะเผลอได้ 2 ห้อง (ห้องซ้ำเป็นบั๊กเดิม ไม่แก้ในรอบนี้ — บันทึกเป็น follow-up: partial unique index `chat_rooms(external_user_id, channel) WHERE deleted_at IS NULL`)
- **จุดเรียก (ครบทุกทางที่ห้องเกิด):**
  1. `RoomManagerService.getOrCreateRoom` — หลังสร้างห้อง และในกิ่ง `existing` เมื่อ `customerId` ยังว่าง (self-heal ห้องที่ backfill ไม่ทัน)
  2. `chatbot-finance ChatRoomService.getOrCreateRoom` (LINE การเงิน) — หลัง `chatRoom.create` เมื่อไม่มี `CustomerLineLink`
  3. CLI backfill (3.5)
- การเรียกเป็น best-effort หลังห้องเกิด (ห้องต้องไม่ล้มเพราะสร้างผู้สนใจไม่ได้ — log + Sentry แล้วปล่อยผ่าน; self-heal ในข้อ 1 เก็บตกตอนคนทักกลับ) — ตอบข้อ 8 ของผลตรวจ: **ไม่ห่อการสร้างห้องกับผู้สนใจในทรานแซกชันเดียว** เพราะ `getOrCreateRoom` เดิมไม่ได้อยู่ในทรานแซกชัน (`room-manager.service.ts:198`) และ webhook ต้องตอบ Meta เร็ว

**ซิงก์ชื่อ:** ตอน `getOrCreateRoom` เติม `displayName` ให้ห้องเก่า (`room-manager.service.ts:164-166`) ถ้าลูกค้าของห้องเป็น placeholder และ `name` ยังเป็นชื่อ fallback → อัปเดต `name` + `facebookName` ตาม (ครอบกรณี `mirrorOutbound` สร้างห้องก่อนรู้ชื่อ)

### 3.3 รวมเข้ากับลูกค้าเดิม — ขอบเขตแคบ (แก้ Major 4)

`CustomerMergeService.absorbPlaceholder(placeholderId, targetId, actor)` — **รวมได้ทางเดียว: placeholder → คนจริง** ไม่ใช่ merge ลูกค้าทั่วไป

เงื่อนไขก่อนรวม (ไม่ผ่านข้อใด → 409 บอกเหตุผลเป็นชื่อรายการ):
- `isChatPlaceholder(placeholder)` เป็นจริง
- placeholder มีข้อมูลพ่วงได้เฉพาะ: `chatRooms`, `creditChecks` (ที่ import จากผลวิเคราะห์ห้อง), `tags`, `crmLeads`, `adsAttributions`, `chatAutoTriggers` — relation อื่นของ `Customer` (contracts, sales, bookings, reservations, tradeIns, onlineOrders, savingPlans, onlineApplications, loyalty*, promotionUsages, repairTickets, otherIncomes, partialPaymentLinks, kyc/pdpa/dsar, lineLinks, referrals, reviews, website*) ต้องว่าง (ตรวจด้วย `_count`)
- target ไม่ถูกลบ และไม่ใช่ placeholder เอง (placeholder ↔ placeholder ไม่รวม — ให้ใช้ "รวมห้อง" แทน)

สิ่งที่ทำ (ทรานแซกชันเดียว, `lockCreditCustomer` ทั้งสองฝั่ง):
1. `chatRooms.updateMany(customerId → target)` (verifiedAt ของห้องคงเดิม)
2. `creditChecks.updateMany(customerId → target)` — **ไม่ใช้ `linkRoomCreditHistory`** เพราะมันย้ายเฉพาะผลที่ `creditCheckId: null` (`room-credit-history.ts:28-31`); ผลที่ import แล้วต้องย้ายตรง ๆ
3. `creditCheckStatus`: ถ้า target เป็น `NONE` และ placeholder ไม่ใช่ → คัดลอกของ placeholder; นอกนั้นคงของ target
4. `tags`: เพิ่มเฉพาะที่ target ยังไม่มี · `crmLeads` / `adsAttributions` / `chatAutoTriggers`: ย้าย `customerId`
5. placeholder → soft delete (`deletedAt`) · audit `CUSTOMER_PLACEHOLDER_MERGED` `{from, to, roomIds, by}`

ทางเข้า 4 ทาง (ทั้งหมดเรียกบริการเดียวกัน):
- (ก) `PATCH /staff-chat/rooms/:id/customer` (`linkCustomer` `room-manager.service.ts:672`): ถ้า `room.customerId` เป็น placeholder และต่างจากเป้าหมาย → รวม แทนที่จะโยน "ห้องแชทนี้ผูกกับลูกค้ารายอื่นอยู่แล้ว" (กรณีลูกค้าจริง ↔ ลูกค้าจริง ยังโยนเหมือนเดิม)
- (ข) `PATCH /customers/:id` เติมเบอร์แล้วซ้ำ → 409 เดิม (`existingCustomer` อยู่ใน payload แล้ว) → เว็บเสนอ "รวมกับ [ชื่อ]" → `POST /customers/:id/absorb-into/:targetId` (roles เดียวกับผูกห้อง: OWNER/BRANCH_MANAGER/FINANCE_MANAGER/SALES)
- (ค) `SessionOpsService.mergeRooms` (`session-ops.service.ts:77`): ถ้าฝั่งใดเป็น placeholder → absorb เข้าลูกค้าอีกฝั่งก่อน แล้วรวมห้องตามเดิม; placeholder ทั้งคู่ → ย้ายห้องรองมาหาลูกค้าของห้องหลัก แล้วลบ placeholder ที่ว่าง (กติกาเดิม "ลูกค้าคนละคน" ใช้เฉพาะคนจริงทั้งคู่)
- (ง) **LINE การเงินยืนยันตัวตน (แก้ Blocker 2):** `chatbot-finance.service.ts:218` เปลี่ยนเงื่อนไขเป็น `session.customerId !== linkStatus.customerId` และ `ChatRoomService.linkRoomToCustomer` (`chat-room.service.ts:142`) เมื่อห้องมี placeholder → absorb เข้า `linkStatus.customerId` ก่อนตั้ง `verifiedAt`

### 3.4 โค้ดที่เคยถือว่า "ผูกแล้ว = ลูกค้าตัวจริง"

| จุด | เดิม | ใหม่ |
|---|---|---|
| `prepare-offer.service.ts:116-132` | มี `customerId` → ให้ลิงก์สร้างสัญญา | placeholder → `contractPath: null` + `nextStep: 'เติมเบอร์และเลขบัตรของผู้สนใจก่อนทำสัญญา'` |
| `chat-commerce.service.ts:80` | ไม่มีลูกค้า → บอกให้ผูกก่อน | placeholder → ข้อความเดียวกับไม่มีลูกค้า (ไม่ให้ไปตกที่ "ไม่พบสัญญา") |
| `capture-lead.tool.ts:123-145` (บอทขาย ปิดอยู่แต่สวิตช์ DB เปิดรอ) | ห้องมีลูกค้า → ตั้ง `acquisitionSource: 'AI_CHAT_RETURN'` เสมอ, เขียนเบอร์หลักเฉพาะ `AI_CHAT*` | placeholder → เขียน `name` + `phone` ได้ · **ไม่แตะ `acquisitionSource`** (ที่มายังเป็นช่องทาง ไม่ใช่บอท — แก้ Major 6) · audit เดิมคงไว้ |
| `assignment.service.ts:129` (กันโอนห้องเมื่อมีสัญญา) | ถามสัญญาของ `customerId` | ไม่แก้ — placeholder ไม่มีสัญญา |
| `report-generator.service.ts:45` "ลูกค้าใหม่" | นับ `customers.createdAt` วันนี้ | **ไม่แก้** — ผลตรวจพบว่าค่านี้แค่ log ไม่มีใครแสดง (`scheduler.service.ts:279-284`) |
| `crm/services/customer-scoring.service.ts:29` cron 03:00 | วนลูกค้าที่มีสัญญา | ไม่กระทบ (กรอง `contracts: some`) |
| `PROSPECT_SORT_KEYS`/KPI/ตัวกรองแท็บผู้สนใจ | — | ไม่แก้ (3.1) |

### 3.5 ย้อนหลัง 8,866 ห้อง — `apps/api/src/cli/backfill-chat-prospects.cli.ts`

ตามแบบ `backfill-payment-receipts.cli.ts` / `backfill-contacts.cli.ts`: **dry-run เป็นค่าตั้งต้น** · ต้อง `CONFIRM_BACKFILL=YES_I_AM_SURE` + `EXPECTED_DB_NAME` (+ `ALLOW_PROD_BACKFILL` บน prod) · สคริปต์ npm `backfill:chat-prospects`
1. อ่านห้อง `deleted_at IS NULL AND customer_id IS NULL` เรียง `created_at`
2. จัดกลุ่มตาม `(channel, lineUserId ?? externalUserId)` — กลุ่มละ 1 คน
3. กลุ่มที่มีห้องใดผูกลูกค้าอยู่แล้ว → ผูกห้องที่เหลือกับคนนั้น · ไม่มี → สร้าง placeholder (`createdAt` = ห้องแรกสุดของกลุ่ม, ชื่อจากห้องที่มี `displayName` ล่าสุด)
4. ทำเป็นชุดละ 500 ห้อง ผ่าน `ChatProspectService.ensureForRoom` ตัวเดียวกับ runtime (ไม่มีสำเนาตรรกะที่สอง) · รันซ้ำได้ (ห้องที่ผูกแล้วถูกข้าม)
5. รายงานท้ายรัน: ห้องที่ผูก / คนที่สร้าง / กลุ่มที่มีหลายห้อง / ห้องที่ไม่มีชื่อ
- รันบน prod ผ่าน Cloud Run job แบบเดียวกับ `apps/api/scripts/seed-gfin-cloudrun.js` (PR #1591) · ก่อนรัน: นับ PSID ซ้ำผ่าน cloud-sql-proxy เพื่อรู้ตัวเลขคาดหวัง

### 3.6 หน้าจอ (ทำ mockup ให้เจ้าของเคาะก่อนแตะโค้ด — กติกา 2026-09-06)

- **อินบ็อกซ์ แผงขวา (`RoomDossier.tsx:499-534`)**: กล่องเหลือง "ยังไม่ได้ผูกกับลูกค้า" หายไปเพราะทุกห้องมีเจ้าของ → การ์ดผู้สนใจ: ชื่อ · ป้าย "ผู้สนใจจากแชท · ยังไม่มีเบอร์" · ปุ่ม **เพิ่มเบอร์/ข้อมูล** (เปิด `CustomerCreateDialog` โหมดแก้ไข → `PATCH /customers/:id` ไม่ใช่ `POST`) · ปุ่ม **ผูกกับลูกค้าเดิม** (`LinkCustomerDialog` เดิม; คำอธิบายบอกว่าจะรวมข้อมูลแชทเข้าคนนั้น)
- **เบอร์ซ้ำตอนเติม** → ใช้กลไก `onUseExisting` ที่ `CustomerCreateDialog` มีอยู่แล้ว (409 → ปุ่ม "ใช้ลูกค้าเดิมคนนี้แทน") เปลี่ยนป้ายเป็น "รวมกับ [ชื่อ]" แล้วเรียก absorb
- **หน้ารายชื่อ/รายละเอียดลูกค้า**: `PhoneCell` แสดง "—" เมื่อ `null` · ป้าย "ผู้สนใจจากแชท" ในหน้ารายละเอียด · ฟอร์มแก้ไข: เบอร์ว่างได้เฉพาะ `chatPlaceholder` (ส่ง `undefined` ไม่ใช่ `''` — DTO update ปฏิเสธ `''` ที่ `customer.dto.ts:143`) · เซิร์ฟเวอร์: ห้ามล้างเบอร์ของคนที่มีเบอร์แล้ว
- **ตัวเลือกลูกค้า** (`CustomerSelectStep.tsx:83`, `BookingsPage.tsx:423`, `useCreditCheckCreate.ts:80`): แสดง "จากแชท · ยังไม่มีเบอร์" แทนบรรทัดเบอร์ว่าง — ไม่ซ่อน (ค้นชื่อ Facebook เจอได้เป็นฟีเจอร์)
- **ส่งออก Excel (แก้ Major 3)**: เพดาน 10,000 คงเดิม (`export-snapshot.ts:8` + ฝั่งเว็บ `fetch-export-pages.ts:22`) · ปุ่มส่งออกแท็บผู้สนใจตรวจ `viewCounts.prospects` ก่อนยิง: เกิน 10,000 → บอกให้กรอง "ติดต่อล่าสุด" ก่อน (ไม่ยิงแล้วรอ error) — ผู้สนใจจะแตะ 10,000 ราว 2 สัปดาห์หลัง backfill

### 3.7 ฝั่ง API ที่แตะ (สรุปไฟล์)

| ส่วน | ไฟล์ |
|---|---|
| schema + migration | `apps/api/prisma/schema.prisma`, `prisma/migrations/<ts>_customer_phone_nullable/` |
| helper | `packages/shared/src/customer-sort.ts` (เพิ่ม `CHAT_SOURCES`, `chatSourceOf(channel)`) · `apps/api/src/modules/customers/chat-placeholder.ts` (`isChatPlaceholder`) |
| สร้าง | `customers/services/chat-prospect.service.ts` (ใหม่) · `chat-engine/services/room-manager.service.ts` · `chatbot-finance/services/chat-room.service.ts` |
| รวม | `customers/services/customer-merge.service.ts` (ใหม่) · `customers/customers.controller.ts` (`POST :id/absorb-into/:targetId`) · `room-manager.service.ts` (`linkCustomer`) · `staff-chat/services/session-ops.service.ts` · `chatbot-finance.service.ts` |
| อ่าน | `customer-query.service.ts` (`chatPlaceholder`, `deriveSource` กิ่ง `CHAT_*`) · `staff-chat` room detail |
| กติกา | `prepare-offer.service.ts` · `chat-commerce.service.ts` · `sales-bot/tools/capture-lead.tool.ts` |
| nullable phone | 11 ไฟล์จาก spike (§2) — ทุกจุดใส่ด่านชัดเจน: snapshot สัญญา/ใบขาย/ใบจอง/รับซื้อ → `BadRequestException('ลูกค้ายังไม่มีเบอร์โทร กรุณาเติมก่อน')` · dunning/slip → ข้ามพร้อม log · verification → จับคู่เฉพาะเบอร์ที่ไม่ว่าง |
| CLI | `apps/api/src/cli/backfill-chat-prospects.cli.ts` + npm script |

### 3.8 เทส (ต้องมีก่อนโค้ด — TDD)

**jest (API)**
- `chat-prospect.service.spec`: สร้างจากชื่อ / fallback ชื่อ / `createdAt` = ห้อง / LINE ที่มี `CustomerLineLink` ไม่สร้าง / ห้องที่สองของคนเดิมใช้คนเดิม / ซิงก์ชื่อเมื่อชื่อมาทีหลัง
- `chat-prospect.integration.spec` (DB จริง, `--runInBand`): ยิง `ensureForRoom` 2 ห้องของ PSID เดียว **พร้อมกัน** → ลูกค้า 1 คน (พิสูจน์ advisory lock — ตอบข้อ 10 ของผลตรวจ)
- `customer-merge.service.spec`: ย้ายครบ 6 relation / ปฏิเสธเมื่อมีสัญญา/ใบจอง (บอกชื่อรายการ) / `creditCheckStatus` ตามกติกา / audit
- `room-manager.linkCustomer`: placeholder → รวม · คนจริง ↔ คนจริง → 409 เดิม
- `session-ops.mergeRooms`: 3 กรณี (placeholder ข้างเดียว / สองข้าง / คนจริงคนละคน)
- `chatbot-finance`: ยืนยัน LIFF แล้วห้องย้ายไปคนจริง placeholder ถูกดูด
- `prepare-offer` / `chat-commerce` / `capture-lead`: กรณี placeholder
- 11 ไฟล์ nullable phone: เทสเดิมต้องเขียว + เพิ่มเคส `phone: null` ที่ด่านใหม่
- `backfill-chat-prospects.cli`: dry-run ไม่เขียน / จัดกลุ่มหลายห้อง / รันซ้ำไม่สร้างซ้ำ

**vitest (web)**: การ์ดผู้สนใจในแผงขวา (ปุ่ม 2 ปุ่ม, ไม่มีกล่องเหลือง) · `PhoneCell(null)` = "—" · ฟอร์มแก้ไขส่ง `undefined` · 409 → "รวมกับ …" · ปุ่มส่งออกเมื่อเกิน 10,000 · คำใบ้ในตัวเลือกลูกค้า

**playwright**: ห้องใหม่ → แท็บผู้สนใจมีชื่อ Facebook + โลโก้แชทเปิดห้องได้ (ต่อจาก e2e ของ #1590)

### 3.9 ลำดับขึ้น prod

1. PR → merge → deploy (migration nullable + โค้ด) — ห้องใหม่เริ่มมีผู้สนใจทันที
2. นับ PSID ซ้ำผ่าน cloud-sql-proxy (ตัวเลขคาดหวังของ backfill)
3. รัน backfill แบบ dry-run บน prod → ดูรายงาน → รันจริง (Cloud Run job)
4. ตรวจ: `chat_rooms` ที่ `customer_id IS NULL AND deleted_at IS NULL` = 0 · `customers` ≈ 40 + จำนวนคนที่ไม่ซ้ำ · แท็บผู้สนใจนับตรง · เปิดห้องในอินบ็อกซ์เห็นการ์ดผู้สนใจ
5. บันทึก memory + ปิด issue

### 3.10 ความเสี่ยงที่รับไว้ / ไม่ทำ

- **PDPA**: ชื่อ/PSID อยู่ใน `chat_rooms` อยู่แล้ว แถวใหม่ไม่เก็บอะไรเพิ่ม แต่ทำให้ค้นหา/ส่งออกจากหน้าลูกค้าได้ — `chatConsent=false` คงไว้ · DSAR ครอบคลุมโดยอัตโนมัติ
- **ห้องซ้ำของคนเดียว** ไม่แก้ที่ต้นเหตุในรอบนี้ (follow-up: partial unique index) — แบบนี้แค่ทำให้ "คน" ไม่ซ้ำ
- **LINE shop link ที่เกิดหลังห้อง** (`line-customer-link.service` ไม่แตะห้อง — บั๊กเดิม) ห้องจะยังผูก placeholder จนกว่าพนักงานกด "ผูกกับลูกค้าเดิม" — บันทึกเป็น follow-up
- แถวอัตโนมัติจากห้องเก่าที่เงียบไปแล้ว 1,764 ห้อง (ไม่คุยใน 90 วัน) จะอยู่ในแท็บผู้สนใจตลอด — เป็นความตั้งใจของเจ้าของ (KPI "เงียบเกิน 30 วัน" มีไว้กรอง)

## 4. สิ่งที่เจ้าของต้องเคาะเพิ่ม (ถ้าไม่ทัก = ใช้ค่าตั้งต้น)

1. ส่งออก Excel เกิน 10,000: **ค่าตั้งต้น = บังคับกรองก่อน** (ทางเลือก: ยกเพดานเฉพาะแท็บผู้สนใจ)
2. ชื่อ fallback ห้องที่ไม่มีชื่อ Facebook (24 ห้อง): **ค่าตั้งต้น = "Facebook #xxxx"**
3. ตัวเลือกลูกค้าหน้าจอง/สัญญา: **ค่าตั้งต้น = โชว์ผู้สนใจจากแชทพร้อมคำใบ้** (ทางเลือก: ซ่อนจนกว่าจะมีเบอร์)
