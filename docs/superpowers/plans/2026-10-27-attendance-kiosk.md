# ลงเวลาทำงานผ่านเครื่องประจำสาขา (ก้อน 10 · D3) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** พนักงานตอกเข้า-ออกงานได้เฉพาะบนแท็บเล็ตประจำสาขาที่เจ้าของลงทะเบียน ระบบนับสาย/OT เอง และเจ้าของ/ผจก.เห็นวันนี้+รายเดือน แก้ไขได้พร้อมประวัติ

**Architecture:** โมดูล NestJS ใหม่ `attendance` (controller สาธารณะ `kiosk` แบบ token-gated + controller ภายใน) บนตาราง Prisma ใหม่ 7 ตัว · กติกานับเป็นฟังก์ชันบริสุทธิ์ตัวเดียว (`attendance-rules.ts`) ใช้ร่วมกันทั้ง kiosk/cron/แก้ไข · token อุปกรณ์หมุนทุกคำขอ + requestId idempotency · เว็บ 4 หน้า (kiosk PWA แยก · /attendance · ตั้งค่าเครื่อง · เวลาของฉัน)

**Tech Stack:** NestJS 10 · Prisma/PostgreSQL · jest (หน่วย) + vitest บน Postgres ชั่วคราว (`tools/test-db-vitest.sh`) · React 18 + Vite + shadcn + react-query · vitest/RTL

**Spec:** `docs/superpowers/specs/2026-10-27-attendance-kiosk-design.md` (§4–§10 กติกา · §14–§15 คำตัดสินหลัง builder check)

## Global Constraints

- ทุก route ใหม่ต้องมี entry ใน `apps/api/src/modules/employee-access/access-policy.manifest.json` (key = `ControllerClass.method`) และ `node tools/check-access-coverage.mjs` = 0 error · staff route ที่ไม่ใช่ OWNER ต้องมี boundary ใน `ACCESS_BOUNDARIES` (คลาส `OnModuleInit` ใน `employee-access.module.ts` providers)
- catalog key ใหม่ใน `packages/shared/src/employee-access.ts` กลุ่ม `people`: `'attendance.read': ['ดูเวลาทำงานพนักงาน', 'people', 'GRANT']` · `'attendance.manage': ['แก้ไขเวลาทำงาน/กำหนดวันหยุด', 'people', 'GRANT']` · `'attendance.devices': ['จัดการเครื่องตอกบัตร', 'people', 'OWNER']` + เพิ่ม `attendance.read`/`attendance.manage` ใน `DEFAULT_POSITION_DEFINITIONS` code `BRANCH_MANAGER` (line ~584) · build shared ก่อน type-check (`npm run build` ใน packages/shared)
- เวลาที่ใช้ตัดสินทุกจุด = `new Date()` ฝั่งเซิร์ฟเวอร์ · วันไทยผ่าน `bangkokCalendarParts`/`bangkokMidnight`/`bangkokDateString` (`apps/api/src/utils/date.util.ts`)
- AuditLog: `this.audit.log(...)` **หลัง** `$transaction` เท่านั้น (`.claude/rules/database.md`)
- Soft delete: ทุก query ใส่ `deletedAt: null` · ตารางใหม่ที่เป็น append-only ใส่ `/// Append-only — updatedAt/deletedAt intentionally omitted (event log).`
- ข้อความ UI/validation ภาษาไทย · สีจาก token `index.css` เท่านั้น (`bg-primary`, `text-muted-foreground`, `bg-warning`+`text-warning-foreground`, `text-warning-strong`, `text-destructive`) · ห้าม `text-white`/hex · ไทย `leading-snug` · `<select>` ดิบห้ามใช้นอก `NativeSelect` · สถานะต้องมีไอคอน+คำ
- ปุ่ม/ช่องกดบนหน้า kiosk ≥ 64px · หน้าอื่นบนมือถือ ≥ 44px (`max-lg:min-h-11`)
- เว็บ: `/kiosk` อยู่ใน `PUBLIC_SECTIONS` (`apps/web/src/lib/public-routes.ts`) และใช้ axios client แยก (`withCredentials: false` แบบ `appointmentPublicApi` ใน `lib/api.ts:262`) · ห้ามใช้ `api` หลักบนหน้า kiosk
- bump `apps/web/package.json` version → **26.10.61** (main = 26.10.60)
- รูปพนักงาน = PII: endpoint ดูรูป OWNER/BM สาขาตัวเอง · ห้าม log key รูป
- ห้าม hard-code เวลางาน: ค่าเริ่มต้นจาก SystemConfig `attendance.work_start` (10:00) `attendance.work_end` (19:00) `attendance.late_grace_minutes` (15) `attendance.photo_retention_days` (365) · `Branch.workStart/workEnd` ทับได้
- jest ในเครื่อง: `cd apps/api && npx jest src/modules/attendance` · เทสบน Postgres: `bash tools/test-db-vitest.sh src/modules/attendance/__tests__/attendance.integration.spec.ts` · type: `bash tools/check-types.sh all` · ห้าม `apps/api run lint` (มี --fix)

## Review Focus

1. **คำตอบหายระหว่างทางตอนตอก** — เครื่องส่งซ้ำด้วย token เดิม + requestId เดิม ต้องได้ผลเดิม ไม่ล็อกเครื่อง ไม่สร้างแถวซ้ำ (Task 3 TD6 · Task 8 I2)
2. **token ที่ถูกคัดลอกใช้ตอนแท็บเล็ตปิด** — ทุกแถวตอกตั้งแต่ heartbeat สะอาดครั้งสุดท้ายต้องติดธง `DEVICE_CONFLICT` ตอนเครื่องจริงกลับมา (Task 3 TD8 · Task 8 I3)
3. **ตอกข้ามเที่ยงคืน / ข้ามวันไทย** — IN 23:50 OUT 00:20 ต้องอยู่แถววัน IN และ OT คิดจาก OUT จริง · cron 00:05 ต้องไม่ปิดแถวที่เพิ่ง IN 23:50 (Task 2 R7/R8 · Task 6 C2)
4. **ผจก.แก้แถวตัวเอง / แก้วันที่มีการชน** — 403 และห้ามล้างธง `DEVICE_CONFLICT` ด้วยการแก้เวลา (Task 5 S8/S9)
5. **หน้า kiosk ไม่มีเน็ต/กล้องไม่ได้** — ต้องไม่โชว์สำเร็จหลอก และถ่ายไม่ได้ยังตอกได้พร้อมธง `NO_PHOTO` (Task 4 K6 · Task 9 W5/W6)

---

### Task 1: Prisma schema + migration + ค่าตั้งค่า

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (ท้ายไฟล์ + `model User` ~line 929 + `model Branch` ~line 795)
- Create: `apps/api/prisma/migrations/20261105000000_attendance_kiosk/migration.sql`
- Test: `apps/api/src/modules/attendance/__tests__/attendance-schema.spec.ts`

**Interfaces:**
- Produces (Prisma models · ชื่อ field ตรงนี้คือสัญญาของทุก task):
  - `AttendanceDevice` {id · branchId · name · status `AttendanceDeviceStatus` ACTIVE|REVOKED|LOCKED · currentGeneration Int @default(0) · lastSeenAt? · lastCleanHeartbeatAt? · lastIp? · lastUserAgent? · pinFailCount Int @default(0) · pinLockedUntil? · registeredById · createdAt · updatedAt · deletedAt?} `@@map("attendance_devices")` `@@index([branchId, status])`
  - `AttendanceDeviceToken` {id · deviceId · generation Int · tokenHash String @unique · issuedAt · usedAt?} `@@unique([deviceId, generation])` append-only
  - `AttendanceDeviceRequest` {id · deviceId · requestId · responseJson Json · createdAt} `@@unique([deviceId, requestId])` append-only
  - `AttendanceRegistrationCode` {id · branchId · codeHash @unique · expiresAt · usedAt? · createdById · createdAt} append-only
  - `AttendanceDeviceEvent` {id · deviceId · kind `AttendanceDeviceEventKind` REGISTERED|TOKEN_CONFLICT|PIN_LOCKOUT|REVOKED|UNLOCKED|OFFLINE · ip? · userAgent? · detail Json? · createdAt} append-only
  - `AttendancePunch` {id · deviceId · userId · branchId · kind `AttendancePunchKind` IN|OUT · at · photoKey? · ip? · userAgent? · geoLat? Decimal(9,6) · geoLng? Decimal(9,6) · flags String[] @default([]) · createdAt} append-only `@@index([userId, at])` `@@index([deviceId, at])`
  - `AttendanceDay` {id · userId · branchId · workDate DateTime @db.Date · dayKind `AttendanceDayKind` WORK|DAY_OFF|LEAVE_SICK|LEAVE_PERSONAL|LEAVE_OTHER|SHOP_CLOSED @default(WORK) · clockIn? · clockOut? · clockInPunchId? · clockOutPunchId? · workedMinutes Int @default(0) · lateMinutes Int @default(0) · earlyLeaveMinutes Int @default(0) · otHours Decimal(4,1) @default(0) · flags String[] @default([]) · note? · correctedCount Int @default(0) · createdAt · updatedAt · deletedAt?} `@@unique([userId, workDate])` `@@index([branchId, workDate])`
  - `AttendanceCorrection` {id · dayId · changedById · reason · before Json · after Json · createdAt} append-only
  - `User.attendancePinHash String? @unique @map("attendance_pin_hash")` · `Branch.workStart String? @map("work_start")` · `Branch.workEnd String? @map("work_end")`
  - flags ที่ใช้ (String[] ไม่ใช่ enum): `MISSING_OUT` `NO_PHOTO` `NETWORK_CHANGED` `CORRECTED` `OUT_UPDATED` `REOPENED` `WORKED_ON_OFF_DAY` `DEVICE_CONFLICT` `DEVICE_UNAVAILABLE`

- [ ] **Step 1: เขียนเทสว่าสคีมามีโมเดล/ฟิลด์ตามสัญญา**

```ts
// attendance-schema.spec.ts — อ่านจาก Prisma.dmmf แบบเดียวกับ trash-registry.spec R-dmmf
import { Prisma } from '@prisma/client';
const model = (n: string) => Prisma.dmmf.datamodel.models.find((m) => m.name === n)!;
it('S1 attendance models exist with the contract fields', () => {
  expect(model('AttendanceDay').fields.map((f) => f.name)).toEqual(expect.arrayContaining(['userId','branchId','workDate','dayKind','clockIn','clockOut','clockInPunchId','clockOutPunchId','workedMinutes','lateMinutes','earlyLeaveMinutes','otHours','flags','note','correctedCount','deletedAt']));
  expect(model('AttendancePunch').fields.map((f) => f.name)).toEqual(expect.arrayContaining(['deviceId','userId','branchId','kind','at','photoKey','flags']));
  expect(model('AttendanceDevice').fields.map((f) => f.name)).toEqual(expect.arrayContaining(['currentGeneration','lastCleanHeartbeatAt','pinFailCount','pinLockedUntil','status']));
  expect(model('User').fields.some((f) => f.name === 'attendancePinHash' && f.isUnique)).toBe(true);
  expect(model('Branch').fields.map((f) => f.name)).toEqual(expect.arrayContaining(['workStart','workEnd']));
});
it('S2 AttendanceDay is unique per user per Thai date', () => {
  expect(model('AttendanceDay').uniqueFields).toEqual(expect.arrayContaining([['userId','workDate']]));
});
```

- [ ] **Step 2: รันให้แดง** — `cd apps/api && npx jest src/modules/attendance/__tests__/attendance-schema.spec.ts` · Expected: FAIL (model undefined)
- [ ] **Step 3: เพิ่มโมเดล/enum/ฟิลด์ใน schema.prisma** ตาม Interfaces (relations: Device→Branch · Punch→Device/User/Branch · Day→User/Branch · Day.clockInPunch/clockOutPunch → Punch ชื่อ relation `AttendanceDayClockIn`/`AttendanceDayClockOut` · Correction→Day/User) · ใส่ `///` append-only บน 5 โมเดลที่ไม่มี updatedAt/deletedAt
- [ ] **Step 4: สร้าง migration** — `cd apps/api && npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$SHADOW_URL" --script > prisma/migrations/20261105000000_attendance_kiosk/migration.sql` (ไม่มี shadow DB ให้ใช้ Postgres ชั่วคราวจาก `tools/test-db-vitest.sh` แบบ dry: สร้าง PG ด้วยขั้น initdb ของสคริปต์แล้วชี้ URL) · ตรวจว่ามี `CREATE TABLE "attendance_days"` + unique index `(user_id, work_date)` + `ALTER TABLE "users" ADD COLUMN "attendance_pin_hash"` + unique index
- [ ] **Step 5: `npx prisma generate` แล้วรันเทส** · Expected: PASS 2/2
- [ ] **Step 6: Commit** — `git add apps/api/prisma apps/api/src/modules/attendance/__tests__/attendance-schema.spec.ts && git commit -m "feat(attendance): schema + migration for kiosk attendance"`

---

### Task 2: กติกานับ — ฟังก์ชันบริสุทธิ์ `attendance-rules.ts`

**Files:**
- Create: `apps/api/src/modules/attendance/attendance-rules.ts`
- Test: `apps/api/src/modules/attendance/__tests__/attendance-rules.spec.ts`

**Interfaces:**
- Produces:
  - `roundOtMinutes(minutesPastEnd: number): number` → 0 | 0.5 | 1 | 1.5 … (ชั่วโมง) ตามตาราง: เศษ <15 → 0 · 15–44 → 0.5 · 45–59 → 1 (เช่น 110 นาที = 1 ชม. + 50 → 1.5 · 60 → 1 · 74 → 1 · 75 → 1.5)
  - `interface ScheduleRules { workStart: string /* 'HH:mm' */; workEnd: string; lateGraceMinutes: number }`
  - `interface DaySummaryInput { workDate: Date /* bangkokMidnight ของวัน */; dayKind: AttendanceDayKind; clockIn: Date | null; clockOut: Date | null; rules: ScheduleRules }`
  - `interface DaySummary { workedMinutes: number; lateMinutes: number; earlyLeaveMinutes: number; otHours: number; flags: string[] /* WORKED_ON_OFF_DAY เมื่อ dayKind≠WORK และมี clockIn · MISSING_OUT ไม่ใส่ที่นี่ (cron ใส่) */ }`
  - `computeDaySummary(input: DaySummaryInput): DaySummary` — เวลางานของวันนั้น = `workDate` + HH:mm ตามปฏิทินไทย (ใช้ `bangkokMidnight` + offset นาที) · `lateMinutes` = max(0, clockIn − workStart) **เฉพาะเมื่อ** clockIn > workStart + grace (ไม่งั้น 0) · `earlyLeaveMinutes` = max(0, workEnd − clockOut) เมื่อมี clockOut · `otHours` = roundOtMinutes(max(0, clockOut − workEnd)) เมื่อมี clockOut · `workedMinutes` = clockOut − clockIn (0 ถ้าไม่มี clockOut) · dayKind ≠ WORK กับไม่มี clockIn → ทุกค่า 0
  - `workDateOf(at: Date): Date` → `bangkokMidnight(parts)` ของวันไทยที่ `at` อยู่ (IN 23:50 → วันนั้น)
  - `resolveRules(systemDefaults: ScheduleRules, branch: { workStart: string | null; workEnd: string | null }): ScheduleRules`

- [ ] **Step 1: เขียนเทสตารางทอง (RED)**

```ts
const RULES = { workStart: '10:00', workEnd: '19:00', lateGraceMinutes: 15 };
const day = bangkokMidnight(2026, 9, 27); // 27 ต.ค. 2569
const t = (h: number, m: number, d = day) => new Date(d.getTime() + (h * 60 + m) * 60_000);
it('R1 roundOtMinutes follows the 15/45 table', () => {
  expect([0, 14, 15, 44, 45, 59, 60, 74, 75, 110].map(roundOtMinutes)).toEqual([0, 0, 0.5, 0.5, 1, 1, 1, 1, 1.5, 1.5]);
});
it('R2 on time: in 10:02 out 19:10 → no late, OT 0', () => {
  expect(computeDaySummary({ workDate: day, dayKind: 'WORK', clockIn: t(10, 2), clockOut: t(19, 10), rules: RULES })).toEqual({ workedMinutes: 548, lateMinutes: 0, earlyLeaveMinutes: 0, otHours: 0, flags: [] });
});
it('R3 late counts from 10:00 once past grace: 10:15 → 0, 10:16 → 16', () => {
  expect(computeDaySummary({ ...base, clockIn: t(10, 15) }).lateMinutes).toBe(0);
  expect(computeDaySummary({ ...base, clockIn: t(10, 16) }).lateMinutes).toBe(16);
});
it('R4 OT: out 19:14 → 0 · 19:15 → 0.5 · 19:45 → 1 · 20:50 → 1.5', ...);
it('R5 late and OT are kept separately (in 12:00 out 20:00 → late 120, OT 1)', ...);
it('R6 early leave: out 18:30 → earlyLeaveMinutes 30, OT 0', ...);
it('R7 clock-out after Thai midnight still belongs to the IN day: in 23:50 out 00:20 next day → worked 30, OT by 19:00 of IN day = 5h20 → 5.5', ...);
it('R8 workDateOf: 00:20 BKK on 28 Oct → 28 Oct; 23:59 on 27 → 27 (uses Bangkok calendar not UTC)', ...);
it('R9 worked on a DAY_OFF → flags WORKED_ON_OFF_DAY and OT still computed', ...);
it('R10 missing clock-out → workedMinutes 0, otHours 0, earlyLeave 0', ...);
it('R11 resolveRules: branch override wins, null falls back', ...);
```

- [ ] **Step 2: รัน** `npx jest src/modules/attendance/__tests__/attendance-rules.spec.ts` · Expected: FAIL (module not found)
- [ ] **Step 3: เขียน `attendance-rules.ts`** ตามสัญญา (ไม่มี Prisma import ยกเว้น type `AttendanceDayKind` จาก `@prisma/client`)
- [ ] **Step 4: รัน** · Expected: PASS 11/11
- [ ] **Step 5: Commit** — `feat(attendance): pure day-summary rules (late/OT table)`

---

### Task 3: อุปกรณ์ — ลงทะเบียน · token หมุน · idempotency · ชน · ล็อกรหัส (`AttendanceDeviceService`)

**Files:**
- Create: `apps/api/src/modules/attendance/attendance-device.service.ts` · `apps/api/src/modules/attendance/attendance-token.util.ts`
- Test: `apps/api/src/modules/attendance/__tests__/attendance-device.service.spec.ts` · `__tests__/attendance-token.util.spec.ts`

**Interfaces:**
- Produces (`attendance-token.util.ts`): `newRawToken(): string` (32 bytes base64url) · `hashToken(raw: string): string` (sha256 hex) · `newRegistrationCode(): string` (8 ตัวจาก `ABCDEFGHJKMNPQRSTUVWXYZ23456789`) · `REGISTRATION_TTL_MS = 10 * 60_000` · `REQUEST_CACHE_TTL_MS = 5 * 60_000` · `PIN_LOCK_THRESHOLD = 5` · `PIN_LOCK_MS = 15 * 60_000`
- Produces (`AttendanceDeviceService(prisma, audit)`):
  - `issueRegistrationCode(branchId, actorId): Promise<{ code: string; expiresAt: Date }>` (เก็บ hash)
  - `register(input: { code: string; deviceName: string; ip?: string; userAgent?: string }): Promise<{ deviceToken: string; device: { id; branchId; branchName } }>` — code ไม่พบ/หมดอายุ/ใช้แล้ว → `BadRequestException('รหัสลงทะเบียนไม่ถูกต้องหรือหมดอายุ')` · สร้าง device ACTIVE generation 1 + token + event REGISTERED
  - `authenticate(input: { deviceToken: string; requestId: string; ip?: string; userAgent?: string }, now?: Date): Promise<AuthenticatedDevice>` — คืน `{ device, cached?: unknown /* responseJson เดิมเมื่อ requestId ซ้ำ */, nextToken?: string }` : ถ้า `(deviceId, requestId)` มีใน `AttendanceDeviceRequest` → `cached` (ไม่หมุน) · token hash ไม่ตรงรุ่นปัจจุบัน แต่พบในประวัติ → **conflict**: device→LOCKED · event TOKEN_CONFLICT {ip, userAgent, generationUsed} · `markConflictWindow(deviceId, since = device.lastCleanHeartbeatAt ?? device.createdAt, now)` (ติดธง `DEVICE_CONFLICT` ให้ทุก `AttendancePunch` ของเครื่องในช่วง + `AttendanceDay` ที่อ้างถึง) · Todo HIGH ถึงผู้ใช้ระบบ (`createOwnerTodo` — ไม่มีผู้ใช้ระบบ = log + Sentry warning ข้าม) · throw `UnauthorizedException({ code: 'DEVICE_LOCKED' })` · token ไม่พบเลย → `UnauthorizedException({ code: 'DEVICE_REVOKED' })` · device REVOKED/LOCKED → 401 code เดียวกัน · ตรงรุ่นปัจจุบัน → หมุน: สร้าง token รุ่น N+1 (ใน `$transaction` เดียวกับ update `currentGeneration`, `usedAt` ของรุ่น N, `lastSeenAt`, `lastIp/lastUserAgent`) → `nextToken`
  - `remember(deviceId, requestId, responseJson): Promise<void>` (เขียนหลัง handler สำเร็จ)
  - `touchCleanHeartbeat(deviceId, now)`: set `lastCleanHeartbeatAt`
  - `checkPin(deviceId, pin, now): Promise<{ userId: string } | 'LOCKED' | 'INVALID'>` — device.pinLockedUntil > now → 'LOCKED' · hash = `hashPII(pin, process.env.PII_HASH_SALT)` → `user.findFirst({ where: { attendancePinHash, deletedAt: null, isActive: true } })` · ไม่พบ → `pinFailCount++`; ครบ `PIN_LOCK_THRESHOLD` → `pinLockedUntil = now + PIN_LOCK_MS`, `pinFailCount = 0`, event PIN_LOCKOUT, Todo MEDIUM · พบ → reset `pinFailCount = 0`
  - `revoke(deviceId, actorId)`: status REVOKED + event REVOKED · `unlock(deviceId, actorId)` (เฉพาะ LOCKED): status REVOKED + event UNLOCKED (= เจ้าของตรวจแล้วปิดเคส — เครื่องจริงได้ 401 DEVICE_REVOKED แล้วกลับหน้าลงทะเบียน · เจ้าของออกรหัสใหม่ → ได้แถว device ใหม่) · ทั้งคู่ audit `ATTENDANCE_DEVICE_REVOKED`/`ATTENDANCE_DEVICE_UNLOCKED` หลัง commit
  - `listDevices(): Promise<DeviceRow[]>`
- Consumes: Task 1 models · `hashPII` (`utils/pii.util`) · Todo pattern จาก `device-return-pending.cron.ts:78-122`

- [ ] **Step 1: เทส util (RED)** — `TU1 newRawToken 43 ตัว base64url ไม่ซ้ำ` · `TU2 hashToken deterministic sha256 hex 64` · `TU3 newRegistrationCode 8 ตัว ไม่มี 0/O/1/I/L`
- [ ] **Step 2: เทส service ด้วย prisma mock (RED)** — harness แบบ `users-update-full.spec.ts` (`$transaction: jest.fn(async (cb) => cb(tx))`)

```ts
it('TD1 register with a valid unused code creates ACTIVE device gen 1 + token + REGISTERED event, marks code used', ...);
it('TD2 register with expired/used/unknown code → 400 ไทย and nothing written', ...);
it('TD3 authenticate with the current-generation token rotates: token gen N usedAt set, gen N+1 created, device.currentGeneration N+1, nextToken returned', ...);
it('TD4 authenticate with an unknown token → 401 { code: DEVICE_REVOKED }', ...);
it('TD5 authenticate on a REVOKED or LOCKED device → 401 with that code, no rotation', ...);
it('TD6 same requestId replay with the old token → returns cached responseJson, no rotation, no conflict', ...);
it('TD7 old-generation token with a new requestId → device LOCKED + TOKEN_CONFLICT event + 401 DEVICE_LOCKED', ...);
it('TD8 conflict flags every punch and day since lastCleanHeartbeatAt with DEVICE_CONFLICT and creates an owner Todo (HIGH) via the system user', ...);
it('TD9 checkPin: 4 wrong → INVALID with pinFailCount 4; 5th wrong → LOCKED until now+15min, PIN_LOCKOUT event, count reset', ...);
it('TD10 checkPin: correct pin resets pinFailCount and returns userId; inactive/deleted users never match', ...);
it('TD11 checkPin while pinLockedUntil in the future → LOCKED without touching counters', ...);
it('TD12 no system user → Todo skipped with Sentry warning, conflict still locks the device', ...);
```

- [ ] **Step 3: รัน** `npx jest src/modules/attendance/__tests__/attendance-device` · Expected: FAIL (modules missing)
- [ ] **Step 4: เขียน util + service** ตามสัญญา (Sentry ผ่าน `@sentry/nestjs` mock ได้)
- [ ] **Step 5: รัน** · Expected: PASS 15/15
- [ ] **Step 6: Commit** — `feat(attendance): device registration, rotating token with requestId idempotency, conflict lock, PIN lockout`

---

### Task 4: ตอกบัตร — `KioskPunchService` + `KioskPublicController` + manifest public + security.md

**Files:**
- Create: `apps/api/src/modules/attendance/kiosk-punch.service.ts` · `apps/api/src/modules/attendance/kiosk-public.controller.ts` · `apps/api/src/modules/attendance/dto/kiosk.dto.ts` · `apps/api/src/modules/attendance/attendance-settings.service.ts` · `apps/api/src/modules/attendance/attendance.module.ts`
- Modify: `apps/api/src/app.module.ts` (import `AttendanceModule` ต่อจาก `TrashModule`) · `apps/api/src/modules/employee-access/access-policy.manifest.json` (3 entries `public`) · `.claude/rules/security.md` (รายการ Intentionally Public Endpoints + ข้อยกเว้น localStorage)
- Test: `__tests__/kiosk-punch.service.spec.ts` · `__tests__/kiosk-public.controller.spec.ts`

**Interfaces:**
- Produces (`AttendanceSettingsService(prisma)`): `getRules(branchId): Promise<ScheduleRules>` (SystemConfig keys ตาม Global Constraints + `Branch.workStart/workEnd` ผ่าน `resolveRules`) · `getPhotoRetentionDays()`
- Produces (`KioskPunchService(prisma, devices: AttendanceDeviceService, settings, storage: StorageService)`):
  - `punch(input: { device: AttendanceDevice; userId: string; kind: 'IN'|'OUT'; photo?: { buffer: Buffer; mimeType: string }; ip?; userAgent?; geo?: { lat: number; lng: number } }, now = new Date()): Promise<PunchResult>` โดย `PunchResult = { nickname: string; kind; at: Date; status: 'ON_TIME'|'LATE'|'OUT'|'OUT_OT'; lateMinutes: number; otHours: number; flags: string[] }`
    - อัปโหลดรูป (ถ้ามี) key `attendance/<yyyy>/<mm>/<punchId>.jpg` ก่อน tx (ล้มเหลว → ไม่มีรูป + ธง NO_PHOTO · ไม่โยน)
    - ใน `$transaction`: `workDate = workDateOf(now)` · หา `AttendanceDay` ของ (userId, workDate) — ไม่มี → สร้าง `dayKind` จากแถวที่ ผจก.ตั้งไว้ (ถ้ามีแถว dayKind≠WORK อยู่แล้วก็ใช้แถวนั้น) · สร้าง `AttendancePunch` · กติกา: IN ขณะ `clockIn` มีและ `clockOut` ว่าง → `ConflictException('ตอกเข้าแล้วเมื่อ HH:mm')` · OUT ขณะไม่มี `clockIn` → `ConflictException('ยังไม่ได้ตอกเข้างานวันนี้')` · IN หลังมี clockOut → `clockOut = null`, `clockOutPunchId = null`, flag `REOPENED` · OUT ซ้ำ → แทน `clockOut` + flag `OUT_UPDATED` · คำนวณ `computeDaySummary` ด้วย `getRules(device.branchId)` → เขียน workedMinutes/late/early/otHours/flags (รวม `WORKED_ON_OFF_DAY`, `NO_PHOTO`) · `branchId` ของแถววัน = `device.branchId` ตอน IN แรก
    - `NETWORK_CHANGED`: ถ้า `device.lastIp` มีและต่างจาก ip ปัจจุบัน → ใส่ธงบน punch
  - ข้อความ status: ON_TIME/LATE จาก lateMinutes ตอน IN · OUT/OUT_OT จาก otHours ตอน OUT
- Produces (`KioskPublicController` `@Controller('kiosk')` ไม่มี `@UseGuards` · ทุก route `@Throttle({ short: { limit: 30, ttl: 60_000 } })` · POST ทุกตัว `@SkipCsrf()`):
  - `POST /kiosk/register` body `RegisterKioskDto { code: string (8) ; deviceName: string (1–60) }` → `{ deviceToken, branch: { id, name }, serverTime }`
  - `POST /kiosk/heartbeat` body `{ deviceToken; requestId }` → `{ nextDeviceToken, serverTime, device: { status, branchName, name } }` (+ `touchCleanHeartbeat`)
  - `POST /kiosk/punch` multipart (`FileInterceptor('photo', { limits: { fileSize: 300 * 1024, files: 1 } })`) fields `PunchKioskDto { deviceToken; requestId; pin (6 digits); kind IN|OUT; geoLat?; geoLng? }` → `{ nextDeviceToken, serverTime, result: PunchResult }` · ลำดับ: `devices.authenticate` (cached → คืนเลย) → `checkPin` ('LOCKED' → `423 PIN_LOCKED` ด้วย `HttpException({ code: 'PIN_LOCKED', message: 'เครื่องนี้พักรับรหัส 15 นาที' }, 423)` · 'INVALID' → `BadRequestException('รหัสไม่ถูกต้อง')` **ไม่บอกชื่อใคร**) → `punch` → `remember(requestId, response)` → ตอบ
  - ip จาก `clientIp(req)` (`utils/client-ip.util.ts`) · userAgent จาก header
- Manifest entries (classification `public`, permission null, resource none, company not-applicable, resolution none, transport ตามจริง, `surface` คำนวณด้วยสูตรใน `tools/lib/access-entrypoints.mjs` — รัน `node tools/check-access-coverage.mjs` แล้วคัด surface จาก error message ถ้ามี): `KioskPublicController.register` · `.heartbeat` · `.punch`

- [ ] **Step 1: เทส service (RED)**

```ts
it('K1 first IN creates the day row with clockIn, branchId = device branch, status ON_TIME, photo key stored', ...);
it('K2 IN at 10:16 → LATE with lateMinutes 16', ...);
it('K3 IN twice while open → 409 "ตอกเข้าแล้วเมื่อ 10:02"', ...);
it('K4 OUT without IN → 409', ...);
it('K5 OUT at 20:50 → OUT_OT otHours 1.5 and workedMinutes computed; second OUT at 21:00 replaces clockOut and adds OUT_UPDATED', ...);
it('K6 upload failure or no photo → punch stored with NO_PHOTO flag, no exception', ...);
it('K7 IN after OUT reopens the day: clockOut cleared, REOPENED flag', ...);
it('K8 punch on a DAY_OFF row keeps dayKind and adds WORKED_ON_OFF_DAY', ...);
it('K9 IN at 23:50 and OUT at 00:20 next day land on the same day row (workDateOf)', ...);
it('K10 ip differs from device.lastIp → NETWORK_CHANGED on the punch', ...);
```

- [ ] **Step 2: เทส controller (RED)** — ประกอบ controller ด้วย service mocks (แบบ `trash.controller.spec.ts`): `KC1 punch: authenticate → checkPin → punch → remember order, response carries nextDeviceToken` · `KC2 cached requestId → returns cached body, punch not called` · `KC3 PIN LOCKED → 423 code PIN_LOCKED` · `KC4 INVALID pin → 400 generic message without names` · `KC5 register validation: code must be 8 chars, deviceName ≤ 60` · `KC6 manifest has the three KioskPublicController entries as public` (อ่าน JSON ตรง ๆ)
- [ ] **Step 3: รัน** `npx jest src/modules/attendance` · Expected: FAIL เฉพาะไฟล์ใหม่
- [ ] **Step 4: เขียน settings service · punch service · dto · controller · module** (module imports `AuditModule`, `StorageModule`; providers ทั้งหมด; export services ให้ Task 5/6) · ลงทะเบียน `AttendanceModule` ใน app.module · เพิ่ม manifest 3 entries · security.md: บรรทัดใน Intentionally Public Endpoints: "`kiosk` (`POST kiosk/register|heartbeat|punch`) — เครื่องตอกบัตรประจำสาขา token-gated (token หมุนทุกคำขอ + requestId idempotency) · throttle 30/นาที/IP · ไม่มี session · `@SkipCsrf()` · PIN ล็อกเครื่อง 5 ครั้ง/15 นาที (spec `2026-10-27-attendance-kiosk-design.md` §4, §8)" + ใต้ข้อ JWT: "ข้อยกเว้น: device token ของเครื่องตอกบัตรเก็บใน localStorage ของเครื่องนั้น — ไม่ใช่ JWT ผู้ใช้ หมุนทุกคำขอ ให้สิทธิ์เฉพาะตอกบัตร"
- [ ] **Step 5: รัน** `npx jest src/modules/attendance` + `node tools/check-access-coverage.mjs` · Expected: PASS ทั้งหมด · coverage 0 error (ถ้า surface ไม่ตรง ให้แก้ตามค่าที่เครื่องมือรายงาน)
- [ ] **Step 6: Commit** — `feat(attendance): kiosk public endpoints (register/heartbeat/punch) + punch rules`

---

### Task 5: หน้าหลังบ้าน API — วันนี้ · รายเดือน · รูป · แก้ไข · ตารางหยุด · เครื่อง · ตั้งค่า (+ manifest staff + catalog + boundary)

**Files:**
- Create: `apps/api/src/modules/attendance/attendance.service.ts` · `attendance.controller.ts` · `attendance-devices.controller.ts` · `dto/attendance.dto.ts` · `apps/api/src/modules/employee-access/access-attendance-boundary.ts`
- Modify: `access-policy.manifest.json` (staff entries) · `packages/shared/src/employee-access.ts` (3 keys + BM template) · `employee-access.module.ts` providers · `apps/api/src/modules/users/users.controller.ts` + `users.service.ts` (`POST /users/:id/attendance-pin/reset` OWNER → `{ pin }` สุ่ม 6 หลักไม่ชน unique · audit `ATTENDANCE_PIN_RESET` ไม่เก็บ pin)
- Test: `__tests__/attendance.service.spec.ts` · `__tests__/attendance.controller.spec.ts` · `apps/api/src/modules/users/__tests__/users-attendance-pin.spec.ts`

**Interfaces:**
- `type Actor = { id: string; role: string; branchId?: string | null }` · `assertBranchScope(actor, branchId)`: OWNER ผ่าน · BRANCH_MANAGER ต้อง `actor.branchId === branchId` (ไม่มี branchId = ForbiddenException) · role อื่น 403
- `AttendanceService(prisma, audit, settings, storage)`:
  - `today(actor, branchId, date?: Date): Promise<{ date: string; rules: ScheduleRules; rows: TodayRow[]; kpi: { staff; present; onTime; late; absentSoFar; off; leave; flagged } }>` — TodayRow = {userId, nickname, name, role, dayKind, status 'ON_TIME'|'LATE'|'NOT_IN'|'DAY_OFF'|'LEAVE'|'SHOP_CLOSED'|'MISSING_OUT', clockIn, clockOut, otHours, lateMinutes, flags, clockInPunchId, clockOutPunchId, dayId?} · พนักงาน = users active ที่ `branchId` = สาขา **หรือ** มีแถววันของสาขานั้น · เรียง: ผิดปกติก่อน แล้วชื่อ
  - `month(actor, branchId, month: 'YYYY-MM'): Promise<{ days: string[]; rows: MonthRow[] }>` — MonthRow = {userId, nickname, cells: Record<date, { dayKind; status; lateMinutes; otHours; flags; dayId }>, summary: { workDays; lateCount; lateMinutes; absent; leave; otHours }}
  - `me(userId, month)`: แถวของตัวเอง (ไม่มี kpi สาขา)
  - `photoStream(actor, punchId): Promise<{ stream: Readable; contentType: 'image/jpeg' }>` (ตรวจ scope จาก punch.branchId)
  - `correctDay(actor, dayId, dto: { clockIn?: string ISO; clockOut?: string | null; dayKind?; reason: string (≥10) }): Promise<AttendanceDay>` — `assertBranchScope` · **`day.userId === actor.id && actor.role !== 'OWNER'` → 403 'แก้เวลาของตัวเองไม่ได้ ให้เจ้าของแก้'** · tx: อ่านแถว · คำนวณใหม่ด้วย `computeDaySummary` · flags: ลบ `MISSING_OUT` เมื่อ clockOut ถูกตั้ง · เพิ่ม `CORRECTED` · **ห้ามลบ `DEVICE_CONFLICT`** · `correctedCount++` · สร้าง `AttendanceCorrection {before, after, reason}` · หลัง commit `audit.log({ action: 'ATTENDANCE_CORRECTED', entity: 'attendance_day', entityId, oldValue: before, newValue: { ...after, reason } })`
  - `setDayKinds(actor, dto: { branchId; entries: { userId; date: 'YYYY-MM-DD'; dayKind }[] })` — scope · ผจก.ตั้งของตัวเองไม่ได้ (403) · upsert แถว (unique userId+workDate) โดยไม่แตะเวลา/ธงที่มี · audit `ATTENDANCE_DAY_KINDS_SET` หลัง commit
  - `clearConflictFlag(actor OWNER, dayId)` — เจ้าของ "ตรวจแล้ว" → ลบ `DEVICE_CONFLICT` + audit
- `AttendanceController` `@Controller('attendance') @UseGuards(JwtAuthGuard, RolesGuard)`: `GET today?branchId&date` · `GET month?branchId&month` · `GET me?month` (ทุก role) · `GET punches/:id/photo` (stream · headers แบบ `shop-petty-cash.controller.ts:72-83`) · `PATCH days/:id` · `PUT day-kinds` · `POST days/:id/clear-conflict` (OWNER) — `@Roles('OWNER','BRANCH_MANAGER')` ยกเว้น `me`
- `AttendanceDevicesController` `@Controller('attendance/devices') @Roles('OWNER')`: `GET` · `POST registration-code { branchId }` → `{ code, expiresAt }` · `POST :id/revoke` · `POST :id/unlock` · `GET events?deviceId` · `GET /attendance/settings` + `PATCH /attendance/settings { workStart, workEnd, lateGraceMinutes, photoRetentionDays, branches?: [{branchId, workStart|null, workEnd|null}] }`
- Manifest: ทุก method ของ 2 controllers + users PIN reset เป็น `staff` กับ permission: `attendance.read` (today/month/photo) · `attendance.manage` (days/day-kinds) · `attendance.devices` (devices/settings/clear-conflict) · `users.manage` (pin reset) · `me` = `self-service` permission null · `resource: 'domain'`, `company: 'SHOP-source'`, `resolution: 'collection'` สำหรับ read/manage · boundary class `AccessAttendanceBoundary implements OnModuleInit` ลงทะเบียน `ACCESS_BOUNDARIES` ให้ read/manage routes คืน `{ kind: 'collection', company: 'SHOP', execute: (scope) => scope /* ส่ง tuples ให้ service กรอง branchIds */ }` (แบบ `access-shop-settlement-boundary.ts`) — ภายใต้ `accessManaged=false` วันนี้ boundary ไม่ถูกเรียก แต่ต้องมีเพื่อไม่ 403 ตอนเปิด

- [ ] **Step 1: เทส service (RED)** — `S1 today: present/late/not-in/day-off/leave/missing-out statuses + kpi counts` · `S2 today includes a visiting employee (day row at this branch, home branch elsewhere)` · `S3 month summary sums otHours, late minutes, absent = WORK rows without clockIn in the past` · `S4 BM of another branch → 403; BM without branchId → 403; SALES → 403` · `S5 correctDay recomputes with the rules and strips MISSING_OUT, adds CORRECTED, writes AttendanceCorrection, audit after commit (order check)` · `S6 correctDay reason < 10 chars → 400` · `S7 setDayKinds upserts without touching existing clockIn` · `S8 BM correcting own row → 403; OWNER allowed` · `S9 correctDay never removes DEVICE_CONFLICT; clearConflictFlag (OWNER) does` · `S10 photoStream checks branch scope via the punch` 
- [ ] **Step 2: เทส controller + manifest/catalog (RED)** — `C1 roles per route` · `C2 manifest has every AttendanceController/AttendanceDevicesController method; read/manage are staff with GRANT keys, devices OWNER, me self-service` · `C3 PERMISSION_DEFINITIONS has the 3 keys in group people and BM template lists read+manage` · users: `U1 reset returns a 6-digit pin, stores hashPII hash, audits without the pin, retries on unique clash`
- [ ] **Step 3: รัน** · Expected: FAIL เฉพาะไฟล์ใหม่
- [ ] **Step 4: เขียนทุกไฟล์** · `npm run build` ใน `packages/shared` · เพิ่ม boundary provider
- [ ] **Step 5: รัน** `npx jest src/modules/attendance src/modules/users` + `node tools/check-access-coverage.mjs` · Expected: PASS · 0 error
- [ ] **Step 6: Commit** — `feat(attendance): back-office API (today/month/corrections/day-kinds/devices/settings) + access registration`

---

### Task 6: งานอัตโนมัติ — ปิดวัน · วันไม่มีการตอก · เก็บรูป · ล้างแคชคำขอ

**Files:**
- Create: `apps/api/src/modules/attendance/crons/attendance-close-day.cron.ts` · `crons/attendance-retention.cron.ts`
- Test: `__tests__/attendance-close-day.cron.spec.ts` · `__tests__/attendance-retention.cron.spec.ts`

**Interfaces:**
- `AttendanceCloseDayCron(prisma, settings)`: `@Cron('5 0 * * *', { timeZone: 'Asia/Bangkok' })` → `run(now = new Date()): Promise<{ closed: number; absent: number; unavailableBranches: string[] }>` — วันเป้าหมาย = วันไทยของ `now − 1 วัน` · (1) แถว `clockIn` มี `clockOut` ว่าง ของวันเป้าหมาย → flag `MISSING_OUT` · otHours 0 · (2) ต่อสาขา: ถ้า **ไม่มี `AttendancePunch` ของสาขาในวันเป้าหมาย** → ไม่นับขาด · สร้างแถว `AttendanceDay` ให้พนักงานทุกคนของสาขาที่ไม่มีแถว ด้วย flag `DEVICE_UNAVAILABLE` (dayKind WORK ไม่มีเวลา) · Todo MEDIUM "สาขา <ชื่อ> ไม่มีการตอกบัตรวันที่ …" (dedupe ด้วย title) · ไม่งั้น (3) พนักงาน active ที่ **มี `attendancePinHash`** สังกัดสาขา ไม่มีแถววันเป้าหมาย → สร้างแถว WORK ไม่มีเวลา (= ขาด) · ไม่แตะแถวที่ dayKind ≠ WORK · ทั้งหมด idempotent (รันซ้ำไม่สร้างซ้ำ) · try/catch + Sentry แบบ `device-return-pending.cron.ts`
- `AttendanceRetentionCron(prisma, storage, settings)`: `@Cron('30 3 * * *', { timeZone: 'Asia/Bangkok' })` → ลบรูปของ punch ที่ `at < now − photoRetentionDays` และ `photoKey` ไม่ว่าง (`storage.delete(key)` แล้ว `photoKey = null`, ทีละ ≤ 500) · ลบ `AttendanceDeviceRequest` เก่ากว่า 1 วัน · ประกาศ `OFFLINE` event + Todo ถึงเจ้าของสำหรับ device ACTIVE ที่ `lastSeenAt < now − 24h` (ครั้งเดียวต่อวัน dedupe title)

- [ ] **Step 1: เทส (RED)** — `C1 open row of yesterday → MISSING_OUT, otHours 0` · `C2 a row with clockIn 23:50 yesterday (Bangkok) and no clockOut IS closed; a row of today is not touched` · `C3 branch with zero punches yesterday → no absences, DEVICE_UNAVAILABLE rows + one Todo` · `C4 branch with punches → employees with PIN and no row get a WORK row with no times; employees without PIN are skipped; DAY_OFF rows untouched` · `C5 second run is a no-op` · `R1 retention deletes old photos (storage.delete called) and nulls photoKey, keeps recent` · `R2 request cache older than 1 day deleted` · `R3 device silent > 24h → OFFLINE event + Todo once`
- [ ] **Step 2: รัน** · Expected: FAIL
- [ ] **Step 3: เขียน cron ทั้งสอง** + ใส่ใน `AttendanceModule.providers`
- [ ] **Step 4: รัน** · Expected: PASS
- [ ] **Step 5: Commit** — `feat(attendance): close-day and retention crons`

---

### Task 7: เทสบน Postgres จริง + CI glob

**Files:**
- Create: `apps/api/src/modules/attendance/__tests__/attendance.integration.spec.ts`
- Modify: `.github/workflows/deploy-gcp.yml` (หลัง `TRASH_FILES` ~line 308: `ATTENDANCE_FILES=$(ls src/modules/attendance/__tests__/*.integration.spec.ts)` + `$ATTENDANCE_FILES` ในบรรทัด vitest ~334 ระวัง `\` ท้ายบรรทัด)

- [ ] **Step 1: เขียน spec (header แบบ `trash.integration.spec.ts:1-25` · `process.env.PII_HASH_SALT ||= '...'`)**

```ts
it('I1 register → punch IN → punch OUT: one AttendanceDay, token rotated 3 times, photo key set', ...);
it('I2 replaying the punch request (same token + requestId) returns the cached result and creates no second punch', ...);
it('I3 using the previous-generation token with a new requestId locks the device, flags the earlier punch DEVICE_CONFLICT and creates an owner Todo', ...);
it('I4 correctDay by OWNER writes AttendanceCorrection and an AuditLog row with rowHash (Merkle chain)', ...);
it('I5 close-day cron marks MISSING_OUT and creates an absence row for a PIN-holder with no punches', ...);
it('I6 attendancePinHash unique: resetting two users to the same pin fails at the DB', ...);
```

- [ ] **Step 2: รัน** `bash tools/test-db-vitest.sh src/modules/attendance/__tests__/attendance.integration.spec.ts` · Expected: FAIL จนกว่า Task 1–6 ครบ → แล้ว PASS 6/6
- [ ] **Step 3: แก้ workflow glob** · ตรวจ `grep -n ATTENDANCE_FILES .github/workflows/deploy-gcp.yml` = 2 บรรทัด
- [ ] **Step 4: Commit** — `test(attendance): Postgres integration + CI glob`

---

### Task 8: เว็บ — หน้า `/kiosk` (PWA แยก)

**Files:**
- Create: `apps/web/src/lib/kiosk-api.ts` · `apps/web/src/lib/kiosk-store.ts` · `apps/web/src/pages/kiosk/KioskPage.tsx` · `pages/kiosk/components/RegisterScreen.tsx` · `PunchScreen.tsx` · `PinPad.tsx` · `CameraPreview.tsx` · `ResultScreen.tsx` · `DeviceBlockedScreen.tsx` · `pages/kiosk/useServerClock.ts` · `apps/web/public/kiosk/manifest.webmanifest`
- Modify: `apps/web/src/App.tsx` (lazy `KioskPage` · `<Route path="/kiosk" element={<KioskPage />} />` ก่อน block protected ~line 316) · `apps/web/src/lib/public-routes.ts` (`'/kiosk'` ใน `PUBLIC_SECTIONS`) · `apps/web/public/sw.js` (ใน fetch handler ก่อน `/api/` branch: `if (new URL(request.url).pathname.startsWith('/kiosk')) return;`) 
- Test: `apps/web/src/pages/kiosk/__tests__/KioskPage.test.tsx` · `apps/web/src/lib/__tests__/kiosk-store.test.ts`

**Interfaces:**
- `kiosk-store.ts`: `loadDevice(): { token: string; branchName: string; deviceName: string } | null` · `saveDevice(d)` · `clearDevice()` (localStorage key `bc.kiosk.device` · try/catch ทุกครั้ง)
- `kiosk-api.ts`: `kioskApi = axios.create({ ...sharedConfig, withCredentials: false })` + `register(code, deviceName)` · `heartbeat(token)` · `punch({ token, pin, kind, photo?: Blob, geo? })` (FormData · `requestId = crypto.randomUUID()` · retry 1 ครั้งด้วย requestId เดิมเมื่อ network error) · ทุกตัวอัปเดต token ใน store จาก `nextDeviceToken` · error shape `{ code?: 'DEVICE_REVOKED'|'DEVICE_LOCKED'|'PIN_LOCKED'; message }`
- `KioskPage` state machine: `unregistered` → `ready` (idle · kind chosen · pin typing) → `submitting` → `result (5s)` → `ready` · `blocked (revoked|locked)` · heartbeat `setInterval` 10 นาที + ตอน mount · `useServerClock` = offset จาก `serverTime` ล่าสุด · บน mount สลับ `<link rel="manifest">` เป็น `/kiosk/manifest.webmanifest` และคืนค่าเดิมตอน unmount · `CameraPreview` ใช้ `navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })` วาดลง `<canvas>` → `canvas.toBlob('image/jpeg', 0.7)` ย่อด้านยาว ≤ 640px · ไม่มีกล้อง/ปฏิเสธ → ส่งโดยไม่มีรูป + ข้อความ "ถ่ายรูปไม่ได้ — บันทึกโดยไม่มีรูป"
- `manifest.webmanifest`: `{ "id": "/kiosk/", "name": "เครื่องตอกบัตร BESTCHOICE", "short_name": "ตอกบัตร", "start_url": "/kiosk", "scope": "/kiosk/", "display": "fullscreen", "orientation": "any", "theme_color": "#0b7a55", "background_color": "#f9f8f6", "lang": "th", "icons": [เหมือน manifest.json] }`

- [ ] **Step 1: เทส store (RED)** — `KS1 save/load round trip` · `KS2 load returns null on garbage/exception`
- [ ] **Step 2: เทส page (RED)** (mock `@/lib/kiosk-api` ด้วย `vi.hoisted` · mock `navigator.mediaDevices`)

```ts
it('W1 unregistered → shows the registration screen; valid code → saves device and shows the punch screen with branch name', ...);
it('W2 choosing เข้างาน + 6 digits + ยืนยัน → calls punch with kind IN and shows the result for the returned nickname/status', ...);
it('W3 LATE result shows "สาย 16 นาที"; OUT_OT shows "OT 1.5 ชั่วโมง"', ...);
it('W4 400 รหัสไม่ถูกต้อง → inline error, pin cleared, screen stays', ...);
it('W5 network error → red "ยังไม่ได้บันทึก" with retry, never a success state', ...);
it('W6 camera denied → punch still sent without photo and the notice is shown', ...);
it('W7 401 DEVICE_LOCKED/DEVICE_REVOKED → blocked screen and device cleared from store on REVOKED', ...);
it('W8 keys ≥ 64px and buttons are real <button>s with labels', ...);
```

- [ ] **Step 3: รัน** `cd apps/web && npx vitest run src/pages/kiosk src/lib/__tests__/kiosk-store.test.ts` · Expected: FAIL
- [ ] **Step 4: เขียนทุกไฟล์** ตาม mockup บอร์ด 1–2 (`Fb1mrEzhcDssYCDRYLRRe7`) · ฟอนต์/สี token ของแอป
- [ ] **Step 5: รัน** · Expected: PASS · `npx vitest run src/config` (route-reachability ไม่พัง เพราะ `/kiosk` เป็น public)
- [ ] **Step 6: Commit** — `feat(web): kiosk attendance page as its own PWA`

---

### Task 9: เว็บ — หน้า `/attendance` (วันนี้ · รายเดือน · ตารางหยุด/ลา · แก้ไข)

**Files:**
- Create: `apps/web/src/hooks/useAttendance.ts` · `apps/web/src/pages/attendance/AttendancePage/index.tsx` · `components/TodayTab.tsx` · `MonthTab.tsx` · `ScheduleTab.tsx` · `CorrectDayDialog.tsx` · `PhotoThumb.tsx` · `attendance.util.ts` (ป้ายสถานะ+ไอคอน · ฟอร์แมตเวลาไทย · excel columns)
- Modify: `apps/web/src/App.tsx` (`/attendance` ProtectedRoute roles OWNER, BRANCH_MANAGER) · `apps/web/src/config/menu.ts` (OWNER_CONFIG + BRANCH_MANAGER_CONFIG: `{ label: 'ลงเวลา', path: '/attendance', icon: Clock }` ในส่วนทีม/งาน)
- Test: `apps/web/src/pages/attendance/AttendancePage/AttendancePage.test.tsx`

**Interfaces:**
- hooks: `useAttendanceToday(branchId, date)` · `useAttendanceMonth(branchId, month)` · `useCorrectDay()` · `useSetDayKinds()` · `useClearConflict()` · `ATTENDANCE_KEY = ['attendance']`
- Excel: `exportToExcel({ data: rows, columns: [{header:'พนักงาน',key:'name'}, {header:'วันทำงาน',key:'workDays'}, {header:'สาย (ครั้ง)',key:'lateCount'}, {header:'สาย (นาที)',key:'lateMinutes'}, {header:'ขาด',key:'absent'}, {header:'ลา',key:'leave'}, {header:'OT (ชม.)',key:'otHours'}], sheetName: 'ลงเวลา', filename: 'attendance-<branch>-<month>.xlsx' })`

- [ ] **Step 1: เทส (RED)** — `A1 today tab renders kpi + rows with status chips (icon+label) from mocked GET /attendance/today` · `A2 month tab renders per-day cells and summary columns` · `A3 correction dialog requires reason ≥ 10 and PATCHes /attendance/days/:id` · `A4 schedule tab cycles a cell ทำงาน→หยุด→ลาป่วย→ลากิจ→ร้านปิด and PUTs /attendance/day-kinds on save` · `A5 export button calls exportToExcel with the summary columns` · `A6 BM sees only own branch (select disabled)`
- [ ] **Step 2: รัน** · Expected: FAIL
- [ ] **Step 3: เขียน** ตาม mockup บอร์ด 3–4 · `PageHeader`/`QueryBoundary`/`DataTable` หรือ table ธรรมดาใน `overflow-x-auto` · `NativeSelect` สำหรับสาขา · ConfirmDialog/Dialog ตาม shadcn
- [ ] **Step 4: รัน** page test + `npx vitest run src/config` (route-reachability: `/attendance` ต้องอยู่ในเมนูทั้งสอง role)
- [ ] **Step 5: Commit** — `feat(web): attendance page (today/month/schedule/corrections)`

---

### Task 10: เว็บ — ตั้งค่าเครื่องตอกบัตร + เวลางาน · รีเซ็ตรหัสที่หน้าผู้ใช้ · เวลาทำงานของฉัน

**Files:**
- Create: `apps/web/src/pages/settings/AttendanceDevicesPage/index.tsx` (+ `components/RegistrationCodeDialog.tsx`, `DeviceEventsSheet.tsx`) · `apps/web/src/pages/UsersPage/components/AttendancePinCard.tsx` · `apps/web/src/pages/attendance/MyTimePage.tsx`
- Modify: `apps/web/src/config/settings-registry.tsx` (`{ id: 'attendance-devices', label: 'เครื่องตอกบัตร', group: 'สาขา', roles: ['OWNER'], kind: 'route', component: AttendanceDevicesPage, path: '/settings/branches/attendance-devices', keywords: ['ลงเวลา','ตอกบัตร','kiosk','OT'] }`) · `apps/web/src/pages/UsersPage/UserDetailPage.tsx` (~line 258: วาง `AttendancePinCard` ข้าง `StaffLineLinkCard`) · `apps/web/src/lib/api/users.ts` (`resetAttendancePin(id) → { pin }`) · `App.tsx` (`/attendance/me` ProtectedRoute ทุก role) · `config/menu.ts` (ทุก role config: `{ label: 'เวลาทำงานของฉัน', path: '/attendance/me', icon: Clock }`)
- Test: `AttendanceDevicesPage.test.tsx` · `AttendancePinCard.test.tsx` · `MyTimePage.test.tsx`

- [ ] **Step 1: เทส (RED)** — `D1 device list with status chips; เพิ่มเครื่อง opens dialog showing the 8-char code and expiry; ยกเลิก/ปลดล็อก confirm then POST` · `D2 settings form PATCHes work hours + grace` · `P1 pin card: reset → shows the pin once with "แสดงครั้งเดียว" and never refetches users.detail` · `M1 my time page lists month rows with status chips and the 4 kpis`
- [ ] **Step 2: รัน** · Expected: FAIL
- [ ] **Step 3: เขียน** ตาม mockup บอร์ด 4–5
- [ ] **Step 4: รัน** + `npx vitest run src/config` · Expected: PASS
- [ ] **Step 5: Commit** — `feat(web): attendance devices settings, PIN reset card, my-time page`

---

### Task 11: เอกสาร · เวอร์ชัน · ด่านรวม

**Files:**
- Modify: `apps/web/package.json` (version 26.10.61) · `.claude/CLAUDE.md` (Important Notes bullet "ลงเวลาทำงาน (2026-10-27 · ก้อน 10 D3)": เครื่องประจำสาขา token หมุน · กติกาสาย/OT · ตาราง · cron · route/permission ใหม่ · ชี้ spec) · `docs/superpowers/specs/2026-10-27-attendance-kiosk-design.md` (สถานะ "ทำแล้ว") · `.claude/rules/database.md` (หัวข้อสั้น: ตาราง attendance_* append-only + unique userId+workDate + PIN hash unique)

- [ ] **Step 1: bump version + เอกสาร**
- [ ] **Step 2: ด่านรวม** — `bash tools/check-types.sh all` · `cd apps/api && npx eslint src/modules/attendance src/modules/employee-access/access-attendance-boundary.ts` · `cd apps/web && npx eslint src/pages/kiosk src/pages/attendance src/pages/settings/AttendanceDevicesPage src/hooks/useAttendance.ts src/lib/kiosk-api.ts src/lib/kiosk-store.ts` · `node tools/check-access-coverage.mjs` · `cd apps/api && NODE_OPTIONS=--max-old-space-size=6144 npx jest src/modules/attendance src/modules/users src/modules/employee-access src/app.module --maxWorkers=2 --testPathIgnorePatterns db.spec integration.spec` · `bash tools/test-db-vitest.sh src/modules/attendance/__tests__/attendance.integration.spec.ts` · `cd apps/web && npx vitest run` · Expected: ทุกอย่างเขียว
- [ ] **Step 3: Commit** — `chore: bump web 26.10.61, docs for attendance kiosk`
