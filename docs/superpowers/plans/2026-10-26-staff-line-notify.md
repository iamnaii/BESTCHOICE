# LINE แจ้งเตือนภายในถึงพนักงาน (A16) — แผนปฏิบัติ

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ท่อเดียวสำหรับแจ้งพนักงานทาง LINE (Staff OA) เลือกผู้รับตามบทบาท/สาขาจาก `User.lineId` มีสวิตช์กลางให้ OWNER · ย้ายจุดยิงเดิม 5 จุดมาบนท่อนี้ · เพิ่มเหตุการณ์ใหม่ (ใบรายจ่ายรออนุมัติ ขายสด เปิดสัญญา เงินสดหน้าร้าน) · เสียบท่อบิลประจำของก้อน 6

**Architecture:** โมดูลใหม่ `staff-notify` (`@Global()`) มี `StaffEventCatalog` (ค่าเริ่มต้นต่อเหตุการณ์) + `StaffNotifyRulesService` (กติกาใน SystemConfig `staff_notify_rules`) + `StaffNotifyService.notify(event, payload)` (ผู้รับ → dedupe ผ่าน `NotificationLog` → ส่งข้อความล้วนผ่าน `NotificationsService.send` channelKey `line-staff` หรือ Flex ผ่าน `LineOaService.sendFlexMessage` + เขียน log เอง · ไม่ throw) · จุดเกิดเหตุเรียกหลัง commit แบบ fire-and-forget ด้วย dependency `@Optional()` · เว็บเพิ่มแท็บ "แจ้งพนักงาน (LINE)" ในหน้าแจ้งเตือน + ปุ่มทดสอบบนหน้าผู้ใช้

**Tech Stack:** NestJS 10 + Prisma (`apps/api`), jest (unit) + vitest บน Postgres จริง (`tools/test-db-vitest.sh`), React/Vite/shadcn + vitest/RTL (`apps/web`)

**Spec:** `docs/superpowers/specs/2026-10-26-staff-line-notify-design.md` (§4 สถาปัตยกรรม · §5 แคตตาล็อก · §6 ย้ายจุดเดิม · §7 UI · §8 API · §11 คำตัดสิน)

## Global Constraints

- สาขา `feat/staff-line-notify` ต่อยอดจาก `feat/recurring-bill-reminders` (PR #1733) — ห้าม rebase/force-push · worktree `.claude/worktrees/staff-line-notify` ใช้ absolute path เสมอ
- `StaffNotifyService.notify` **ห้าม throw** ออกไปหาผู้เรียกในทุกกรณี (ล้ม → Sentry + log + ผลลัพธ์ `failed`)
- ข้อความ: `📣 BESTCHOICE · <title>` + บรรทัดละข้อ + `🔗 <FRONTEND_URL><link>` (base = `process.env.FRONTEND_URL` ตัด `/` ท้าย · ว่าง = ไม่ใส่ลิงก์) · ภาษาไทยทั้งหมด · ห้ามใส่เลขบัตร/เลขบัญชีลูกค้า
- ผู้รับ = `prisma.user.findMany({ where: { isActive: true, deletedAt: null, isSystemUser: false, lineId: { not: null }, role: { in: roles } } })` ไม่มี cache
- `relatedId` ของ log = `staff:<eventKey>:<dedupeKey>` · dedupe = `NotificationLog` `{ channelKey: 'line-staff', recipient: lineId, relatedId, status: 'SENT', createdAt ≥ now − dedupeWindowHours }`
- ทุกการส่ง `category: NotificationCategory.STAFF` · ข้อความล้วนผ่าน `NotificationsService.send({ channel: 'LINE', channelKey: 'line-staff', recipient, message, relatedId, category })` · Flex ผ่าน `LineOaService.sendFlexMessage(lineId, flex, 'line-staff')` แล้ว `prisma.notificationLog.create` เอง (`channel: 'LINE'`, `status: 'SENT'|'FAILED'`, `message: altText`, `sentAt`)
- SystemConfig key `staff_notify_rules` เก็บ JSON `{ [eventKey]: { enabled, roles, branchScoped, includeGroup } }` · บทบาทที่ยอมรับ = `OWNER | FINANCE_MANAGER | ACCOUNTANT | BRANCH_MANAGER | SALES` (ไม่มี VIEWER)
- จุดเกิดเหตุเรียก `notify` **หลัง commit** นอก `$transaction` แบบ `void …notify(...).catch(() => {})` หรือ `await` ใน try/catch ที่ไม่ rethrow · inject เป็น `@Optional() private readonly staffNotify?: StaffNotifyService` (ต่อท้าย constructor) — spec เดิมที่ `new Service(...)` ไม่ต้องเพิ่ม arg
- เว็บ: โทเคนจาก `index.css` เท่านั้น · control จริง (`<input type="checkbox">` + `<label>`, `Switch` มี `aria-label`) ห้าม span คลิกได้ · ตารางใน `overflow-x-auto` · บันทึกแล้ว toast สำเร็จ/ล้ม · `data-ui-control="button"` บนปุ่ม native · `<select>` ดิบห้าม — ใช้ `NativeSelect`
- เวอร์ชันเว็บ **26.10.55** (ต่อจาก #1733 = .54) · bump ใน Task 12
- ห้าม `apps/api run lint` · เทส API ใช้ jest · เทส DB ใช้ `bash tools/test-db-vitest.sh <spec>` · type-check `bash tools/check-types.sh api|web|all` ดูข้อความ "TypeScript check passed" ไม่ใช่ exit code ของ pipe

## Review Focus

1. Staff OA ยังไม่ตั้งค่า (token ว่าง — สภาพ prod ตอนนี้): ทุกจุดเรียกจบเร็ว ไม่ throw ไม่ spam log (เตือนไม่เกินวันละครั้ง) และงานหลัก (ขาย/เปิดสัญญา/cron) เดินต่อ → เทส Task 2 (`not_configured`) + Task 8
2. ผู้ใช้ถูกปิดใช้/ลบ `lineId` ระหว่างวัน → ไม่ได้รับทันที (ไม่มี cache) · ผู้ใช้ระบบไม่เคยได้รับ → เทส Task 2
3. JSON กติกาใน SystemConfig เสียหาย/ไม่ครบ/บทบาทแปลก → ใช้ค่าเริ่มต้นต่อเหตุการณ์ + Sentry · `PUT rules` ปฏิเสธ 400 ไม่เขียนทับ → เทส Task 1
4. cron ซ้ำ (Cloud Run หลาย instance นาทีเดียวกัน) หรือ cron รันซ้ำวันเดียวกัน → ข้อความเดียวต่อคนต่อวัน ด้วย dedupe บน log จริง → เทส Task 10 (Postgres)
5. ผจก.สาขา/พนักงานขายของสาขาอื่นห้ามได้รับเหตุการณ์ที่ `branchScoped` · OWNER/ผจก.การเงิน/บัญชีได้ทุกสาขา · `extraRecipientUserIds` ยังถูกกรอง active/lineId → เทส Task 2

---

### Task 1: แคตตาล็อกเหตุการณ์ + กติกาใน SystemConfig

**Files:**
- Create: `apps/api/src/modules/staff-notify/staff-event-catalog.ts`, `apps/api/src/modules/staff-notify/staff-notify-rules.service.ts`, `apps/api/src/modules/staff-notify/__tests__/staff-notify-rules.service.spec.ts`

**Interfaces:**
- Produces (catalog): `type StaffEventKey = 'recurring_bill' | 'expense.pending_approval' | 'ap.due' | 'petty_cash.replenish' | 'chat.handoff' | 'chat.slip_review' | 'chat.slip_sla' | 'stock.low' | 'cash_close.missed' | 'cash_close.awaiting' | 'sale.completed' | 'contract.activated' | 'report.owner_daily' | 'collections.daily_summary' | 'sms.credit_low'` · `type StaffRole = 'OWNER' | 'FINANCE_MANAGER' | 'ACCOUNTANT' | 'BRANCH_MANAGER' | 'SALES'` · `STAFF_ROLES: readonly StaffRole[]` · `interface StaffNotifyRule { enabled: boolean; roles: StaffRole[]; branchScoped: boolean; includeGroup: boolean }` · `interface StaffEventPayload { title: string; lines: string[]; link?: string; branchId?: string | null; dedupeKey?: string; extraRecipientUserIds?: string[]; flex?: { altText: string; contents: unknown } }` · `interface StaffEventCatalogItem { key; group: string; label: string; description: string; defaults: StaffNotifyRule; dedupeWindowHours: number; sample: StaffEventPayload }` · `STAFF_EVENT_CATALOG: readonly StaffEventCatalogItem[]` (15 รายการ ค่าเริ่มต้นตาม spec §5: `recurring_bill` OWNER+ACCOUNTANT · `expense.pending_approval` OWNER (branchScoped) · `ap.due` ACCOUNTANT+OWNER · `petty_cash.replenish` OWNER+ACCOUNTANT · `chat.handoff` OWNER+FINANCE_MANAGER includeGroup · `chat.slip_review`/`chat.slip_sla` OWNER+FINANCE_MANAGER+ACCOUNTANT includeGroup · `stock.low` OWNER+BRANCH_MANAGER branchScoped · `cash_close.missed` OWNER+BRANCH_MANAGER branchScoped · `cash_close.awaiting` OWNER+ACCOUNTANT · `sale.completed` OWNER branchScoped · `contract.activated` OWNER branchScoped · `report.owner_daily` OWNER · `collections.daily_summary` OWNER+FINANCE_MANAGER · `sms.credit_low` OWNER · dedupeWindowHours 20 ทุกตัว ยกเว้น `chat.handoff` 1) · `catalogItem(key): StaffEventCatalogItem` (throw เมื่อไม่รู้จัก) · `STAFF_NOTIFY_RULES_KEY = 'staff_notify_rules'`
- Produces (rules): `class StaffNotifyRulesService(prisma)` · `getEffectiveRules(): Promise<Record<StaffEventKey, StaffNotifyRule>>` (อ่าน SystemConfig → JSON.parse → ทับค่าเริ่มต้นเฉพาะคีย์ที่ถูกต้อง · parse ล้ม/ไม่ใช่ object → ค่าเริ่มต้นทั้งหมด + `Sentry.captureMessage`) · `getRule(key): Promise<StaffNotifyRule>` · `validateRules(input: unknown): Record<StaffEventKey, StaffNotifyRule>` (throw `BadRequestException` ข้อความไทย เมื่อคีย์ไม่อยู่ในแคตตาล็อก / บทบาทไม่อยู่ใน `STAFF_ROLES` / ชนิดผิด) · `saveRules(input: unknown, actorId: string): Promise<Record<StaffEventKey, StaffNotifyRule>>` (validate → `systemConfig.upsert({ where: { key }, create: { key, value, label: 'กติกาแจ้งพนักงานทาง LINE' }, update: { value, deletedAt: null } })` → `auditLog.create({ action: 'STAFF_NOTIFY_RULES_UPDATED', entity: 'system_config', entityId: key, userId: actorId, oldValue, newValue })`)

- [ ] **Step 1: เทสล้มก่อน** — `staff-notify-rules.service.spec.ts` (jest, prisma mock `{ systemConfig: { findFirst, upsert }, auditLog: { create } }`):
  - R1 ไม่มีแถว → ทุกคีย์ = defaults ของแคตตาล็อก (15 คีย์) · `getRule('stock.low')` = `{ enabled: true, roles: ['OWNER','BRANCH_MANAGER'], branchScoped: true, includeGroup: false }`
  - R2 แถวมี `{ "stock.low": { "enabled": false, "roles": ["OWNER"] } }` → merge: `enabled false`, `roles ['OWNER']`, `branchScoped` ยัง true (ค่าเริ่มต้น) · คีย์อื่นไม่กระทบ
  - R3 value = `'not json'` → defaults ทั้งหมด + `Sentry.captureMessage` ถูกเรียก · คีย์ที่ไม่รู้จัก `"foo.bar"` ถูกข้ามเงียบ · `roles: ['VIEWER','OWNER']` ในแถว → เหลือ `['OWNER']`
  - R4 `saveRules({ 'stock.low': { enabled: true, roles: ['OWNER','SALES'], branchScoped: false, includeGroup: false } }, 'u1')` → upsert value เป็น JSON ของกติกา **ครบ 15 คีย์** (คีย์ที่ไม่ส่ง = ค่าเริ่มต้น) + audit action `STAFF_NOTIFY_RULES_UPDATED`
  - R5 `saveRules({ 'nope': {...} })` → 400 /ไม่รู้จักเหตุการณ์/ · `roles: ['VIEWER']` → 400 /บทบาท/ · `enabled: 'yes'` → 400
- [ ] **Step 2: รันให้ล้ม** — `cd apps/api && npx jest src/modules/staff-notify` → FAIL (module not found)
- [ ] **Step 3: เขียน** catalog + rules service ตาม Interfaces
- [ ] **Step 4: PASS** — คำสั่งเดิม → 5 เทสผ่าน
- [ ] **Step 5: Commit** — `git add apps/api/src/modules/staff-notify && git commit -m "feat(api): staff notify event catalog + rules in SystemConfig"`

### Task 2: StaffNotifyService + โมดูล (@Global)

**Files:**
- Create: `apps/api/src/modules/staff-notify/staff-line-config.service.ts`, `staff-notify.service.ts`, `staff-notify.module.ts`, `__tests__/staff-notify.service.spec.ts`
- Modify: `apps/api/src/app.module.ts` (import `StaffNotifyModule`)

**Interfaces:**
- Consumes: Task 1 · `NotificationsService.send` · `LineOaService.sendFlexMessage(to, flex, 'line-staff')` (`LineOaModule` export) · `IntegrationConfigService.getValue('line-staff', 'channelToken' | 'notifyTargets')`
- Produces: `class StaffLineConfigService(integrationConfig)` · `isConfigured(): Promise<boolean>` (token ไม่ว่าง) · `groupTargets(): Promise<string[]>` (`notifyTargets` แยก comma trim กรองว่าง) · `class StaffNotifyService(prisma, rules: StaffNotifyRulesService, lineConfig: StaffLineConfigService, notifications: NotificationsService, lineOa: LineOaService)` · `interface StaffRecipient { userId: string | null; lineId: string; name: string }` · `resolveRecipients(event, payload, rule): Promise<StaffRecipient[]>` (users ตาม roles + branchScoped + extra + group · unique ตาม lineId) · `buildMessage(payload): string` · `notify(event: StaffEventKey, payload: StaffEventPayload, now = new Date()): Promise<StaffNotifyResult>` โดย `interface StaffNotifyResult { skipped?: 'disabled' | 'not_configured' | 'no_recipients'; recipients: number; sent: number; deduped: number; failed: number }` · `testToUser(userId: string, byName: string): Promise<{ ok: true }>` (ไม่มี lineId → `BadRequestException('ผู้ใช้นี้ยังไม่ได้กรอก LINE ID')` · ไม่ตั้งค่า → `ConflictException('ไลน์พนักงานยังไม่ได้ตั้งค่า — ไปที่ Integration Hub')` · ส่ง `🔧 ทดสอบการเชื่อมต่อ LINE พนักงาน\nถ้าได้รับข้อความนี้ แปลว่า LINE ID ของ "<ชื่อ>" ผูกถูกคนแล้ว\nส่งโดย <byName> · <วันเวลาไทย>` ผ่าน `notifications.send` relatedId `staff:test:<userId>`) · `sendSample(event, toUserId): Promise<StaffNotifyResult>` (ส่ง `catalogItem(event).sample` ถึงผู้ใช้คนเดียว ข้าม rule/dedupe · ไม่มี lineId → 400) · `StaffNotifyModule` `@Global()` imports `NotificationsModule`, `LineOaModule`, `IntegrationsModule`(ตามที่ `IntegrationConfigService` อยู่) providers 3 ตัว exports `StaffNotifyService`, `StaffLineConfigService`, `StaffNotifyRulesService`
- กติกาภายใน `notify`: rule.enabled เท็จ → `{ skipped: 'disabled' }` · `!isConfigured()` → warn ครั้งเดียวต่อ 24 ชม. (field `lastNotConfiguredWarnAt`) → `{ skipped: 'not_configured' }` · ผู้รับว่าง → `no_recipients` · ต่อผู้รับ: dedupe (ถ้ามี `dedupeKey`) → ส่ง (flex หรือ text) → นับ · ทุก throw ภายใน → `Sentry.captureException` + `failed++` · ฟังก์ชันไม่ reject

- [ ] **Step 1: เทสล้มก่อน** — `staff-notify.service.spec.ts` (mock prisma `{ user: { findMany }, notificationLog: { findFirst, create } }`, rules `{ getRule }`, lineConfig `{ isConfigured, groupTargets }`, notifications `{ send }`, lineOa `{ sendFlexMessage }`; `jest.mock('@sentry/nestjs')`):
  - S1 ผู้รับตามบทบาท: users [OWNER A (lineId U1), ACCOUNTANT B (U2), SALES C (U3), OWNER D (lineId null), OWNER E isActive false] rule roles OWNER+ACCOUNTANT → `findMany` where ตรง Global Constraints · ส่งถึง U1, U2 เท่านั้น · `send` ถูกเรียกด้วย `{ channel: 'LINE', channelKey: 'line-staff', recipient: 'U1', message: '📣 BESTCHOICE · หัวข้อ\nบรรทัด 1\n🔗 https://app.test/x', relatedId: 'staff:stock.low:rp-1', category: 'STAFF' }` (ตั้ง `process.env.FRONTEND_URL = 'https://app.test/'`)
  - S2 branchScoped: rule roles OWNER+BRANCH_MANAGER branchScoped · users [OWNER U1 branch null, BM U2 branch br-1, BM U3 branch br-2] payload branchId br-1 → U1, U2 · payload ไม่มี branchId → ทั้งสาม
  - S3 extra + group: `extraRecipientUserIds: ['acc-1']` (ACCOUNTANT นอก roles) + `includeGroup` → groupTargets ['G1'] → ผู้รับ = roles ∪ acc-1 ∪ G1 · extra ที่ `lineId` null ถูกกรอง · lineId ซ้ำกันส่งครั้งเดียว
  - S4 disabled → `{ skipped: 'disabled', sent: 0 }` ไม่แตะ prisma/send · not configured → `skipped: 'not_configured'` + `logger.warn` ครั้งเดียวเมื่อเรียก 3 ครั้งติด
  - S5 dedupe: `notificationLog.findFirst` คืนแถว → `deduped 1 sent 0` · where ตรง Global Constraints (`createdAt: { gte: now − 20h }`) · ไม่มี dedupeKey → ไม่ query log
  - S6 ล้มรายคน: `send` reject สำหรับ U1, สำเร็จ U2 → `{ sent: 1, failed: 1 }` + `Sentry.captureException` 1 ครั้ง · `notify` ไม่ reject แม้ `user.findMany` throw (→ `failed` ≥ 1 ไม่ throw)
  - S7 flex: payload.flex → `lineOa.sendFlexMessage('U1', { type: 'flex', altText, contents }, 'line-staff')` + `notificationLog.create` data `{ channel: 'LINE', channelKey: 'line-staff', recipient: 'U1', message: altText, status: 'SENT', relatedId, category: 'STAFF', sentAt: expect.any(Date) }` · ล้ม → `status: 'FAILED', errorMsg`
  - S8 `testToUser`: ไม่มี lineId → 400 · ไม่ตั้งค่า → 409 · ปกติ → `send` relatedId `staff:test:<id>` · `sendSample('stock.low', 'u1')` → ส่ง sample 1 ข้อความไม่ดู rule
- [ ] **Step 2: รันให้ล้ม** — `cd apps/api && npx jest src/modules/staff-notify` → FAIL
- [ ] **Step 3: เขียน** services + module + register ใน `app.module.ts`
- [ ] **Step 4: PASS** + `bash tools/check-types.sh api` → "API: OK"
- [ ] **Step 5: Commit** — `git commit -m "feat(api): StaffNotifyService — role/branch routing, dedupe, text+flex via Staff OA"`

### Task 3: Controller `/staff-notify`

**Files:**
- Create: `apps/api/src/modules/staff-notify/staff-notify.controller.ts`, `dto/save-rules.dto.ts`, `__tests__/staff-notify.controller.spec.ts`
- Modify: `staff-notify.module.ts` (controllers)

**Interfaces:**
- Produces: `@Controller('staff-notify') @UseGuards(JwtAuthGuard, RolesGuard) @Roles('OWNER')` · `GET rules` → `{ configured: boolean; groupTargets: number; catalog: Array<Pick<StaffEventCatalogItem,'key'|'group'|'label'|'description'>>; rules: Record<StaffEventKey, StaffNotifyRule>; unlinkedUsers: Array<{ id; name; role; branchName: string | null }> }` (unlinked = users active ไม่ลบ ไม่ใช่ระบบ `lineId` null ที่บทบาทปรากฏในกติกาที่ `enabled` ใดก็ได้) · `PUT rules` body `{ rules: Record<string, unknown> }` → `rulesService.saveRules(body.rules, user.id)` → คืน rules ใหม่ · `POST test` body `{ eventKey: string }` → `service.sendSample(eventKey, user.id)` (คีย์ไม่รู้จัก → 400) · `POST users/:id/test` → `service.testToUser(id, user.name)` → `{ ok: true }`

- [ ] **Step 1: เทสล้มก่อน** — controller spec (รูปแบบเดียวกับ `recurring-bills.controller.spec.ts`): C1 `GET rules` รวม catalog 15 + unlinkedUsers จาก prisma mock (OWNER ไม่มี lineId ติด · SALES ไม่มี lineId ไม่ติดเมื่อไม่มีกติกาไหนใส่ SALES) · C2 `PUT rules` ส่งต่อ `saveRules` ด้วย `user.id` · C3 `POST test` คีย์ผิด → 400 · C4 `POST users/:id/test` ส่งต่อ `testToUser(id, user.name)` · C5 `Reflect.getMetadata('roles', …)` ของทุก handler = ['OWNER']
- [ ] **Step 2: รันให้ล้ม** → **Step 3: เขียน** → **Step 4: PASS** + types api
- [ ] **Step 5: Commit** — `git commit -m "feat(api): staff-notify rules/test endpoints (OWNER)"`

### Task 4: ย้ายแชท (handoff / สลิป / SLA) ขึ้นท่อ

**Files:**
- Modify: `apps/api/src/modules/chatbot-finance/services/staff-notification.service.ts` (ใช้ `StaffNotifyService` แทน `LineStaffClientService.broadcastText`), `chatbot-finance/services/line-staff-client.service.ts` (คง class · `isConfigured`/`getRecipients` ใช้ `StaffLineConfigService` ภายใน — ไม่ลบเพื่อไม่กระทบผู้เรียกอื่น), `chatbot-finance/chatbot-finance.module.ts` (ไม่ต้อง import — โมดูล global), specs: `handoff.service.spec.ts`, `slip-processing.service.spec.ts`, `slip-sla.cron.spec.ts` (ถ้า mock `StaffNotificationService` ทั้งก้อนไม่ต้องแก้) + สร้าง `__tests__/staff-notification.service.spec.ts`

**Interfaces:**
- Consumes: `StaffNotifyService.notify` · ข้อความเดิมแยกเป็น `title` (บรรทัดแรกเดิม) + `lines` (ที่เหลือ) · `link`: handoff `/inbox?room=<roomId>` · slip `/slip-review` · dedupeKey: handoff `roomId` · slip_review `evidenceId` · slip_sla `sla:<วันที่ไทย>:<ชั่วโมง>`
- Produces: `StaffNotificationService(prisma, staffNotify: StaffNotifyService)` — ลบ `lineStaff` dep · `notifyHandoff/notifySlipReview/notifySlipSlaBreached` คืน `Promise<void>` เหมือนเดิม ไม่ throw

- [ ] **Step 1: เทสล้มก่อน** — `staff-notification.service.spec.ts`: H1 handoff → `notify('chat.handoff', { title: '🔴 ลูกค้ารอคุย [ด่วน]', lines: [ '👤 …', '📞 0812***678', '📌 เรื่อง: …', '📝 …', '📜 บทสนทนาล่าสุด:', '👤 [10:00] …' ], link: '/inbox?room=room-1', dedupeKey: 'room-1' })` · H2 slip review ตรงโครงเดิม dedupeKey evidenceId · H3 SLA count 0 → ไม่เรียก · H4 room ไม่พบ → ไม่เรียก ไม่ throw
- [ ] **Step 2: รันให้ล้ม** — `cd apps/api && npx jest src/modules/chatbot-finance` → FAIL ตัวใหม่ (ตัวเดิมอาจแดงเพราะ ctor เปลี่ยน — แก้ใน Step 3)
- [ ] **Step 3: เขียน** + ปรับ spec เดิมที่ประกอบ `StaffNotificationService` เอง
- [ ] **Step 4: PASS** ทั้ง `src/modules/chatbot-finance` + types api
- [ ] **Step 5: Commit** — `git commit -m "refactor(chatbot-finance): staff notifications via StaffNotifyService"`

### Task 5: ย้าย SMS credit · ของใกล้หมด · เงินสดย่อย · เจ้าหนี้ครบกำหนด

**Files:**
- Modify: `apps/api/src/modules/notifications/scheduler.service.ts` (`handleSmsCreditAlert` → `staffNotify.notify('sms.credit_low', { title: 'SMS credit ใกล้หมด', lines: [`เหลือ ${credit} เครดิต`], link: '/notifications', dedupeKey: <วันที่ไทย> })` · เพิ่ม `@Optional() staffNotify?: StaffNotifyService` ต่อท้าย ctor), `inventory/reorder-points.service.ts` (ลบ loop LINE ที่ส่งด้วยอีเมล · คง IN_APP · เพิ่ม `notify('stock.low', { title: `ของต่ำกว่าจุดสั่งซื้อซ้ำ: ${productDesc}`, lines: [`สาขา ${rp.branch.name}`, `เหลือ ${onHand} (จุดสั่งซื้อ ${rp.reorderLevel})`], link: '/stock/reorder-points', branchId: rp.branchId, dedupeKey: rp.id })`), `expense-documents/crons/petty-cash-replenish-alert.cron.ts` (เพิ่ม notify `petty_cash.replenish` title `เงินสดย่อยต่ำกว่าเกณฑ์เติม` lines ยอดคงเหลือ/เกณฑ์ link `/expenses?type=PETTY_CASH_REIMBURSEMENT` dedupeKey วันที่), `expense-documents/crons/ap-due-alerts.cron.ts` (เพิ่ม notify `ap.due` ต่อใบ: title `เจ้าหนี้ครบกำหนดจ่าย ${doc.documentNumber}` lines ผู้ขาย/ยอด/วันที่ link `/expenses/${doc.id}` dedupeKey `${doc.id}:<วันที่>` `extraRecipientUserIds: [approver ?? creator id]`), specs ที่เกี่ยว: `inventory/reorder-points.service.spec.ts`, `expense-documents/crons/__tests__/petty-cash-replenish-alert.cron.spec.ts`, `expense-documents/__tests__/ap-due-alerts.cron.spec.ts`, `notifications/scheduler.service.spec.ts` (ถ้ามี)

- [ ] **Step 1: เทสล้มก่อน** — เพิ่มเคสในแต่ละ spec: มี `staffNotify` mock → ถูกเรียกด้วย event/payload ตามข้างบน · ไม่มี (undefined) → งานเดิมทำงานปกติ · reorder: `notificationsService.send` **ไม่ถูกเรียกด้วย `channel: 'LINE'` อีก**
- [ ] **Step 2: รันให้ล้ม** → **Step 3: เขียน** → **Step 4: PASS** `npx jest src/modules/inventory src/modules/expense-documents/crons src/modules/expense-documents/__tests__/ap-due-alerts.cron.spec.ts src/modules/notifications` + types api
- [ ] **Step 5: Commit** — `git commit -m "refactor(api): sms credit, low stock, petty cash, AP due alerts via StaffNotifyService"`

### Task 6: ย้ายรายงานรายวันเจ้าของ (Flex) + สรุปติดตามหนี้

**Files:**
- Modify: `apps/api/src/modules/notifications/services/owner-report-notifier.service.ts` (`sendDailyLineReport` → สร้าง flex เดิม → `staffNotify.notify('report.owner_daily', { title: `รายงานประจำวัน ${dateLabel}`, lines: [], flex: { altText: `รายงานประจำวัน ${dateLabel}`, contents: flex.contents }, dedupeKey: <วันที่ไทย> })` · ลบ query OWNER เอง · ctor เพิ่ม `@Optional() staffNotify?` — ไม่มี → ทำแบบเดิม (เก็บเส้นทางเก่าไว้เป็น fallback เฉพาะ unit test เก่า)), `collections-session/collections-summary.service.ts` (loop OWNER → `notify('collections.daily_summary', { title: `สรุปติดตามหนี้ ${dateOnly}`, lines: <บรรทัดของ formatMessage ตัดหัว>, link: '/collections', dedupeKey: dateOnly })`), specs: `collections-summary.service.spec.ts`, `owner-report-notifier.service.spec.ts` (สร้างถ้าไม่มี)
- หมายเหตุ: `flex` ใน `buildDailyReportFlex` คืน `{ type: 'flex', altText, contents }` — ส่ง `contents` ตามนั้น

- [ ] **Step 1: เทสล้มก่อน** — O1 daily report → `notify('report.owner_daily', objectContaining({ flex: objectContaining({ altText }) , dedupeKey }))` และไม่เรียก `lineOaService.sendFlexMessage` ตรง · K1 collections → `notify('collections.daily_summary', …)` ไม่เรียก `line.pushMessage`
- [ ] **Step 2: รันให้ล้ม** → **Step 3: เขียน** → **Step 4: PASS** `npx jest src/modules/notifications src/modules/collections-session` + types
- [ ] **Step 5: Commit** — `git commit -m "refactor(api): owner daily report + collections summary via StaffNotifyService"`

### Task 7: ใบรายจ่ายรออนุมัติ + เสียบท่อบิลประจำ

**Files:**
- Modify: `apps/api/src/modules/expense-documents/services/expense-document-lifecycle.service.ts` (`notifyApprovers`: หลัง IN_APP → `staffNotify?.notify('expense.pending_approval', { title: `ใบรายจ่ายรออนุมัติ ${doc.documentNumber}`, lines: [`${vendorName ?? '—'}`, `ยอด ${totalStr} บาท · สาขา ${branchName}`, `โดย ${createdByName}`], link: `/expenses/${doc.id}`, branchId: document.branchId, dedupeKey: `${doc.id}:PENDING_APPROVAL`, extraRecipientUserIds: recipients })` — query เพิ่ม `vendorName`, `branch.name`, `createdBy.name` ใน `findUnique` เดิม · ctor เพิ่ม `@Optional() staffNotify?` ต่อท้าย), `expense-documents/recurring-bills/recurring-bill-notifier.ts` (เพิ่ม `class StaffNotifyRecurringBillNotifier implements RecurringBillNotifier` — `notify(e)` → `staffNotify.notify('recurring_bill', { title: <บรรทัดแรกของ buildRecurringBillMessage>, lines: <บรรทัดที่เหลือ ตัดบรรทัดลิงก์>, link: `/expenses/recurring-bills?month=${e.periodKey.slice(0,7)}`, branchId: e.branchId, dedupeKey: `${e.occurrenceId}:${e.kind}:${วันที่ไทยของ e.now ?? now}` })` · `resolveRecipients` เดิมไม่ใช้แล้ว (กติกาอยู่ใน catalog) — คง `LoggingRecurringBillNotifier` ไว้สำหรับเทส), `expense-documents/expense-documents.module.ts` (`{ provide: RECURRING_BILL_NOTIFIER, useClass: StaffNotifyRecurringBillNotifier }`), specs: `__tests__/expense-document-lifecycle.service.spec.ts` (เคส approvers), `recurring-bills/__tests__/recurring-bills.service.spec.ts` N-tests (ไม่กระทบ — ใช้ mock notifier) + เคสใหม่ของ `StaffNotifyRecurringBillNotifier` ใน spec ของ notifier (สร้าง `recurring-bill-notifier.spec.ts` ถ้าไม่มี)

- [ ] **Step 1: เทสล้มก่อน** — A1 `notifyApprovers` เรียก `notify('expense.pending_approval', …)` ด้วย `extraRecipientUserIds` = ผู้อนุมัติที่กรองแล้ว · ไม่มี `staffNotify` → IN_APP อย่างเดียวเหมือนเดิม · N3 `StaffNotifyRecurringBillNotifier.notify({ kind: 'OVERDUE', occurrenceId: 'occ-1', periodKey: '2026-10', dueDate, daysOverdue: 2, templateName, branchName, branchId, documentNumber, amount })` → `staffNotify.notify('recurring_bill', objectContaining({ link: '/expenses/recurring-bills?month=2026-10', dedupeKey: 'occ-1:OVERDUE:2026-10-26', branchId }))`
- [ ] **Step 2: รันให้ล้ม** → **Step 3: เขียน** → **Step 4: PASS** `npx jest src/modules/expense-documents` + types
- [ ] **Step 5: Commit** — `git commit -m "feat(api): LINE for pending-approval expenses; recurring bills notifier on StaffNotifyService"`

### Task 8: เหตุการณ์ใหม่ ขายสดสำเร็จ + สัญญาผ่อนเปิดใช้

**Files:**
- Modify: `apps/api/src/modules/sales/services/sale-creation.service.ts` (หลัง warranty notifier: `void this.staffNotify?.notify('sale.completed', { title: `ขายสดสำเร็จ ${sale.saleNumber}`, lines: [`สาขา ${branchName}`, `${itemSummary} · ${total} บาท`, `โดย ${salespersonName}`], link: `/sales/${sale.id}`, branchId: sale.branchId, dedupeKey: sale.id }).catch(() => undefined)` เฉพาะ `CASH`/`EXTERNAL_FINANCE` · ctor เพิ่ม `@Optional() staffNotify?` ต่อท้าย · ข้อมูลชื่อสาขา/พนักงาน/รายการ: ใช้ที่มีใน `sale` ที่คืนจาก writer (ตรวจ include) ไม่ query เพิ่มถ้าไม่จำเป็น), `contracts/contract-workflow.service.ts` (ท้าย `activate` ก่อน `return`: `const staffNotify = this.moduleRef?.get(StaffNotifyService, { strict: false })` ใน try/catch → `void staffNotify?.notify('contract.activated', { title: `สัญญาผ่อนเปิดใช้ ${contract.contractNumber}`, lines: [`ลูกค้า ${customerName}`, `${productLabel} · ยอดจัด ${financedAmount} บาท · ${installmentCount} งวด`, `สาขา ${branchName}`], link: `/contracts/${id}`, branchId: contract.branchId, dedupeKey: id })` — รูปแบบเดียวกับ `resolveCreditApplier`), specs: `sales/services/sale-creation.service.spec.ts`, `contracts/contract-workflow.service.spec.ts`

- [ ] **Step 1: เทสล้มก่อน** — SL1 create CASH → `notify('sale.completed', objectContaining({ branchId, dedupeKey: sale.id }))` ถูกเรียก **หลัง** `warrantyNotifier.notify` · INSTALLMENT → ไม่เรียก · `notify` reject → `create` ยังคืน sale · CT1 activate สำเร็จ → `notify('contract.activated', objectContaining({ dedupeKey: id, branchId }))` · `moduleRef.get` throw → ไม่กระทบผลลัพธ์
- [ ] **Step 2: รันให้ล้ม** → **Step 3: เขียน** → **Step 4: PASS** `npx jest src/modules/sales src/modules/contracts/contract-workflow.service.spec.ts` + types
- [ ] **Step 5: Commit** — `git commit -m "feat(api): LINE staff notice on cash sale and contract activation"`

### Task 9: cron เงินสดหน้าร้าน 10:00

**Files:**
- Create: `apps/api/src/modules/shop-tenders/crons/cash-close-alerts.cron.ts`, `__tests__/cash-close-alerts.cron.spec.ts`
- Modify: `shop-tenders/shop-tenders.module.ts` (provider) · ตรวจว่า `ScheduleModule` ใช้ได้ในโมดูลนี้ (ตาม cron อื่น)

**Interfaces:**
- Consumes: `findUnclosedYesterday(prisma, now)` → `{ branchId, branchName, date, cashIn }[]` · `staleAwaitingConfirmWhere(now)` · `StaffNotifyService`
- Produces: `class CashCloseAlertsCron(prisma, staffNotify)` · `@Cron('0 10 * * *', { timeZone: 'Asia/Bangkok' }) handle()` → `tick(now = new Date()): Promise<{ missed: number; awaiting: number }>` — ต่อสาขาที่ไม่ปิด: `notify('cash_close.missed', { title: `${branchName} ยังไม่ปิดยอดเงินสดของเมื่อวาน`, lines: [`${date} เงินสดเข้า ${cashIn.toLocaleString('th-TH', {minimumFractionDigits: 2})} บาท แต่ไม่มีใบปิดยอด`], link: `/shop/daily-cash?branch=${branchId}`, branchId, dedupeKey: `${branchId}:${date}` })` · รอยืนยัน: นับ `shopCashClose.count(staleAwaitingConfirmWhere)` > 0 → `notify('cash_close.awaiting', { title: `มี ${n} ยอดเงินสดที่นับแล้ว รอยืนยันรับเงินเกิน 1 วัน`, lines: [], link: '/shop/daily-cash', dedupeKey: <วันที่ไทย> })` · ทั้งหมดใน try/catch + Sentry ไม่ throw

- [ ] **Step 1: เทสล้มก่อน** — CC1 สองสาขาไม่ปิด → notify 2 ครั้ง branchId ต่างกัน dedupeKey `br-1:2026-10-25` · CC2 ไม่มี → ไม่เรียก · CC3 stale 3 → notify awaiting 1 ครั้ง · CC4 helper throw → ไม่ throw + Sentry
- [ ] **Step 2: รันให้ล้ม** → **Step 3: เขียน** → **Step 4: PASS** `npx jest src/modules/shop-tenders` + types
- [ ] **Step 5: Commit** — `git commit -m "feat(api): daily cash-close LINE alerts to owner/branch managers"`

### Task 10: integration บน Postgres จริง

**Files:**
- Create: `apps/api/src/modules/staff-notify/__tests__/staff-notify.integration.spec.ts` (vitest · ประกอบ `StaffNotifyRulesService(prisma)`, `StaffLineConfigService({ getValue })` stub (token 'x', targets 'G1'), `NotificationsService` stub ที่เขียน `notificationLog` จริงด้วย `prisma.notificationLog.create` แล้วคืน SENT, `lineOa` stub)
- Modify: `.github/workflows/deploy-gcp.yml` (เพิ่ม `STAFF_NOTIFY_FILES=$(ls src/modules/staff-notify/__tests__/*.integration.spec.ts)` ในขั้น vitest ข้าง `EXPDOC_FILES`)

- [ ] **Step 1: เทสล้มก่อน** — I1 users จริง 4 คน (OWNER มี lineId · ACCOUNTANT มี · BM สาขา A มี · SALES ไม่มี) rule `stock.low` → ส่ง OWNER + BM-A เมื่อ branchId A · BM-B ไม่ได้ · I2 เรียก `notify` ซ้ำสองครั้ง dedupeKey เดียว → log 2 แถวแรก SENT · ครั้งสอง `deduped = 2` ไม่มีแถวใหม่ · I3 `saveRules` เขียน SystemConfig จริง → `getEffectiveRules` อ่านกลับตรง · value เสียหาย (update ตรงเป็น 'oops') → defaults
- [ ] **Step 2: รันให้ล้ม** — `bash tools/test-db-vitest.sh src/modules/staff-notify/__tests__/staff-notify.integration.spec.ts` → **Step 3: เขียน/แก้** → **Step 4: PASS** 3/3
- [ ] **Step 5: Commit** — `git commit -m "test(api): staff-notify integration on Postgres (routing, dedupe, rules)"`

### Task 11: เว็บ — แท็บ "แจ้งพนักงาน (LINE)"

**Files:**
- Create: `apps/web/src/hooks/useStaffNotify.ts`, `apps/web/src/pages/NotificationsPage/components/StaffNotifyTab.tsx`, `StaffNotifyTab.test.tsx`
- Modify: `apps/web/src/pages/NotificationsPage/index.tsx` (`activeTab` union + ปุ่มแท็บ (OWNER เท่านั้น) + render)

**Interfaces:**
- Consumes: `GET/PUT /staff-notify/rules`, `POST /staff-notify/test` (Task 3) · `useAuth().user.role`
- Produces: `useStaffNotifyRules()` = `useQuery(['staff-notify','rules'])` · `useSaveStaffNotifyRules()` mutation PUT invalidate key · `useStaffNotifyTest()` mutation POST test · `StaffNotifyTab` ตาม mockup กระดาน 1: แถบสถานะ 2 กล่อง (Staff OA เชื่อมต่อ/ยังไม่ตั้งค่า + ลิงก์ `/integrations` · พนักงานยังไม่ผูก N คน รายชื่อ + ลิงก์ `/users/<id>`) · ตาราง (`overflow-x-auto`) จัดกลุ่มตาม `group` · แถวละ: `Switch aria-label={`เปิด ${label}`}` · checkbox บทบาท 5 ช่อง (`<input type="checkbox" id=…>` + `<label>` ข้อความซ่อนจอ `sr-only` "${label} — ${roleLabel}") · checkbox กลุ่ม LINE · checkbox เฉพาะสาขาที่เกี่ยว · ปุ่ม "ส่งทดสอบถึงฉัน" (`data-ui-control="button"`) · แถบล่าง "มีการแก้ไขที่ยังไม่ได้บันทึก (N รายการ)" + ปุ่ม "คืนค่าเริ่มต้น" (รีเซ็ต state เป็น defaults จาก catalog — ต้องให้ GET ส่ง `defaults` ต่อคีย์ด้วย → เพิ่มใน Task 3 response `catalog[].defaults`) + "บันทึกกติกา" (disabled เมื่อไม่มีการแก้ · pending → spinner · สำเร็จ toast "บันทึกกติกาแล้ว")
- roleLabels: OWNER เจ้าของ · FINANCE_MANAGER ผจก.การเงิน · ACCOUNTANT บัญชี · BRANCH_MANAGER ผจก.สาขา · SALES พนักงานขาย

- [ ] **Step 1: เทสล้มก่อน** (vitest+RTL mock api/useAuth): T1 render 15 แถว + สถานะ "เชื่อมต่อแล้ว" + ยังไม่ผูก 2 คน (ชื่อ) · T2 ติ๊ก "บัญชี" ของ `stock.low` → แถบ "ยังไม่ได้บันทึก (1 รายการ)" · กดบันทึก → `PUT /staff-notify/rules` body rules ครบ 15 คีย์ และ `stock.low.roles` มี ACCOUNTANT → toast · T3 "ส่งทดสอบถึงฉัน" แถว `chat.handoff` → `POST /staff-notify/test` `{ eventKey: 'chat.handoff' }` · T4 `configured: false` → กล่องเตือน + ลิงก์ Integration Hub + ปุ่มทดสอบ disabled · T5 ผู้ใช้ไม่ใช่ OWNER → ไม่มีแท็บ (เทสที่ `index.tsx` ระดับ page ด้วย mock)
- [ ] **Step 2: รันให้ล้ม** — `cd apps/web && npx vitest run src/pages/NotificationsPage` → **Step 3: เขียน** → **Step 4: PASS** + `bash tools/check-types.sh web`
- [ ] **Step 5: Commit** — `git add apps/web && git commit -m "feat(web): staff LINE notification rules tab"`

### Task 12: ปุ่มทดสอบหน้าผู้ใช้ + เวอร์ชัน + เอกสาร + รันครบ

**Files:**
- Modify: `apps/web/src/pages/UsersPage/components/PersonalFields.tsx` (prop ใหม่ `onTestLine?: () => void` + `testLineState?: 'idle'|'pending'|'sent'` → ปุ่ม "ส่งข้อความทดสอบ" ข้างช่อง LINE ID (แสดงเมื่อมี prop) + คำใบ้ `aria-describedby` "รหัสผู้ใช้ LINE (ขึ้นต้นด้วย U) ของพนักงานในไลน์พนักงาน — ไม่ใช่ LINE ID ที่ใช้ค้นหาเพื่อน"), `apps/web/src/pages/UsersPage/UserDetailPage.tsx` (OWNER + มี id + `lineId` บันทึกแล้ว → mutation `POST /staff-notify/users/:id/test` toast) + เทสใน `UserDetailPage.test.tsx` (สร้างถ้าไม่มี: กดปุ่ม → POST ถูก id · ไม่ใช่ OWNER → ไม่มีปุ่ม), `apps/web/package.json` (`26.10.55`), `.claude/CLAUDE.md` (Important Notes 1 bullet: แจ้งพนักงาน LINE — โมดูล `staff-notify` · กติกา `staff_notify_rules` · ผู้รับจาก `User.lineId` · เพิ่มเหตุการณ์ = เพิ่มใน catalog + เรียก `notify` หลัง commit), `docs/superpowers/specs/2026-10-26-staff-line-notify-design.md` (สถานะ "ทำแล้ว")
- [ ] **Step 1: เทส** ปุ่มทดสอบ → ล้ม → เขียน → ผ่าน
- [ ] **Step 2: รันครบ** — `bash tools/check-types.sh all` · `cd apps/api && npx jest src/modules/staff-notify src/modules/chatbot-finance src/modules/notifications src/modules/inventory src/modules/collections-session src/modules/sales src/modules/contracts/contract-workflow.service.spec.ts src/modules/expense-documents src/modules/shop-tenders` · `cd apps/web && npx vitest run src/pages/NotificationsPage src/pages/UsersPage src/config` · `bash tools/test-db-vitest.sh src/modules/staff-notify/__tests__/staff-notify.integration.spec.ts` · ก่อน deploy: Staff OA token บน prod + กรอก lineId + เปิดสวิตช์
- [ ] **Step 3: Commit** — `git commit -am "chore: bump web 26.10.55, docs for staff LINE notifications"`

---

## ส่วนแก้ตาม §13 ของสเปก (ทับ Interfaces/Steps ข้างบนเมื่อขัดกัน)

**ทุก Task:** ผู้รับใช้ `User.lineStaffUserId` (ไม่ใช่ `lineId`) · `StaffEventKey` มี 18 คีย์: ตัด `recurring_bill.*` เหลือ `recurring_bill` · เพิ่ม `overdue.owner_alert` (OWNER · dedupeWindow 20) · `chat.web_inquiry` (OWNER · includeGroup) · `auth.new_device_login` (OWNER · dedupeWindow 0 = ไม่ dedupe) · ค่าเริ่มต้น `enabled: false` สำหรับ `sale.completed`, `contract.activated` · `StaffEventPayload` เพิ่ม `smsFallback?: boolean` (→ `fallbackPhone: user.phone` ต่อผู้รับที่เป็น user) · `FRONTEND_URL` = `process.env.FRONTEND_URL?.split(',')[0]?.trim()` · `StaffNotifyResult.skipped` เพิ่ม `'quota'` และ `quotaSkipped: number`

**Task 1 เพิ่ม:** `STAFF_NOTIFY_MONTHLY_CAP_KEY = 'staff_notify_monthly_cap'` (default 280) · `StaffNotifyRulesService.getMonthlyCap(): Promise<number>` · `saveMonthlyCap(n, actorId)` (1–100000) · เทส R6 cap อ่าน/เขียน/validate

**Task 2 เพิ่ม:** ใน `notify` ก่อนส่ง: `used = notificationLog.count({ where: { channelKey: 'line-staff', status: 'SENT', createdAt: { gte: bkkMonthStart(now) } } })` · ผู้รับที่ `used + sentSoFar ≥ cap` → `quotaSkipped++` ไม่ส่ง + warn วันละครั้ง · `usage(now): Promise<{ used: number; cap: number; monthKey: string }>` · เทส S9 quota: cap 3 used 2 ผู้รับ 3 คน → ส่ง 1 quotaSkipped 2 · `isConfigured()` = token เท่านั้น (เทส S4 เพิ่มกรณีไม่มี notifyTargets แต่มี token → ส่งตามบทบาทได้)

**Task 3 เพิ่ม:** `GET rules` คืน `usage` + `monthlyCap` + `catalog[].defaults` + `webhookUrl` · `PUT monthly-cap` `{ cap }` · `POST users/:id/link-code` → `{ code, expiresAt }` (สุ่ม 6 หลัก `crypto.randomInt(0, 1_000_000)` pad 6 · หมดอายุ now+15 นาที · เขียน `lineLinkCode`/`lineLinkCodeExpiresAt`) · `DELETE users/:id/link` (ล้าง `lineStaffUserId` + audit `STAFF_LINE_UNLINKED`) · เทส C6–C8

### Task 13: สคีมา + webhook ผูก LINE (= "Task 2.5" ทำก่อน Task 3 · ส่วนสคีมา/migration ทำไปแล้วใน Task 2)
- Files: `apps/api/prisma/schema.prisma` (User + 3 คอลัมน์ §13.1) · migration `20261104000000_staff_line_link/migration.sql` (เพิ่มคอลัมน์ + unique + backfill `UPDATE users SET line_staff_user_id = line_id WHERE line_id ~ '^U[0-9a-f]{32}$' AND line_staff_user_id IS NULL`) · `apps/api/src/modules/staff-notify/staff-line-link.service.ts` (`issueCode(userId, actorId)`, `unlink(userId, actorId)`, `handleWebhookEvents(events)` — follow → reply คำแนะนำ · message 6 หลัก → ผูก/ตอบ · อื่น → เงียบ · ตอบด้วย `LineOaService.replyMessage(replyToken, [...], 'line-staff')` ถ้ามี ไม่มีใช้ `pushMessage(userId, …, 'line-staff')`) · `staff-line-webhook.controller.ts` (`@Controller('webhooks/line-staff')` `@Post()` `@UseGuards(LineStaffWebhookGuard)` → `service.handleWebhookEvents(body.events)` ตอบ 200 เสมอ) · `integrations/integration-registry.ts` (`line-staff` เพิ่ม `webhookUrl`/`webhookNote`) · spec `__tests__/staff-line-link.service.spec.ts` (L1 issueCode เขียนรหัส 6 หลัก+หมดอายุ 15 นาที · L2 message รหัสถูก → ตั้ง `lineStaffUserId` ล้างรหัส ตอบ "ผูกสำเร็จ" + audit · L3 รหัสหมดอายุ/ไม่ตรง → ตอบ "รหัสไม่ถูกต้องหรือหมดอายุ…" ไม่แตะ user · L4 userId เคยผูกคนอื่น → ย้าย (updateMany ล้างคนเก่าก่อน) · L5 follow → reply คำแนะนำ · L6 ข้อความอื่น → ไม่ตอบ) + controller spec (guard ถูกใส่ · body ไม่มี events → 200 เฉย ๆ)
- Commit: `feat(api): link staff LINE accounts via 6-digit code on the Staff OA webhook`

**Task 4 เพิ่ม:** `chat.slip_sla` dedupeKey = วันที่ไทย · `chat.web_inquiry`: `shop-line-chat.service.ts` ส่งผ่าน `notify('chat.web_inquiry', { title: 'ข้อความสอบถามจากเว็บ', lines: [ชื่อ, เบอร์(mask), ข้อความ], link: '/inbox', dedupeKey: inquiryId })` แทน env · `auth.new_device_login`: `login-audit.service.ts` → `notify('auth.new_device_login', { title: 'ล็อกอินจากอุปกรณ์ใหม่', lines: [ผู้ใช้, อุปกรณ์, IP prefix, เวลา, 'หากไม่ใช่คุณ กรุณาติดต่อผู้ดูแลระบบทันที'] })` (ไม่ dedupe) · spec ทั้งสอง

**Task 6 เพิ่ม:** `overdue/owner-alert.helper.ts` `sendToAllOwners(message, relatedId)` → `notify('overdue.owner_alert', { title: <บรรทัดแรก>, lines: <ที่เหลือ>, dedupeKey: relatedId, smsFallback: true })` · spec เดิมของ helper (ถ้ามี) + ผู้เรียก 3 จุดไม่ต้องแก้

**Task 7 เพิ่ม:** `RecurringBillEvent.branchId: string | null` (เติมที่ `safeNotify` ใน `recurring-bills.service.ts`) · `StaffNotifyRecurringBillNotifier` dedupeKey `${occurrenceId}:${kind}:${วันที่ไทย}` · ไม่มี MISSED

**Task 8 เพิ่ม:** จุดที่สอง `bookings.service.ts` แปลงใบจองเป็นใบขาย (~1163) ยิง `sale.completed` เดียวกันหลัง commit · spec bookings เพิ่มเคส

**Task 11 เพิ่ม:** แถบสถานะเพิ่ม "ใช้ไป N / cap เดือนนี้" + ช่องแก้ cap (บันทึกแยก `PUT monthly-cap`) + ข้อความ "OA แพ็กเกจฟรีส่งได้ ~300 ข้อความ/เดือน นับต่อผู้รับ" · รายชื่อยังไม่ผูกใช้ `lineStaffUserId`

**Task 12 เพิ่ม (แทนปุ่มทดสอบอย่างเดียว):** หน้าผู้ใช้บล็อก "ไลน์พนักงาน (แจ้งเตือนภายใน)" ตาม §13.1: ยังไม่ผูก → "สร้างรหัสผูก LINE" → กล่องรหัส + ขั้นตอน + หมดอายุ · ผูกแล้ว → "ส่งข้อความทดสอบ" + "ยกเลิกการผูก" (ConfirmDialog) · ป้ายช่องเดิม "LINE ID (สำหรับค้นหาเพื่อน)" · เทส 4 เคส · เวอร์ชัน 26.10.55

**ลำดับทำ:** 1 → 2 → 13 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12
