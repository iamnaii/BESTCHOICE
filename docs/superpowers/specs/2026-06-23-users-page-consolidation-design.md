# Users / Settings Consolidation — Design Spec (Direction B)

- **Date**: 2026-06-23
- **Status**: Approved (brainstorm, post-scrutinize pivot A→B) → pending implementation plan
- **Scope owner**: OWNER (พี่นาย)
- **Branch**: `feat/users-page-consolidation`
- **Surfaces**: `/settings` (SettingsPage — UsersTab + InternalControlTab). `/users` **ไม่แตะ**.

## 1. ปัญหา (Problem)

มี 2 ที่ที่ดูเหมือน "เรื่อง user" ทำให้สับสนว่าทำไมต้องมีแยกกัน:

| | `/users` (เมนู: "ผู้ใช้ / พนักงาน") | `/settings#users` (แท็บ "ผู้ใช้งาน") |
|---|---|---|
| ทำอะไร | จัดการบัญชีผู้ใช้จริง (เพิ่ม/แก้/เชิญ/เปิด-ปิด, โปรไฟล์ HR) | toggle นโยบายระดับระบบ 4 อัน |
| มีอะไร | ตาราง + การ์ดสถิติ + แท็บคำเชิญ | Maker-Checker, Test Mode, สิทธิ์กลับรายการ, ผู้ดูแลเงินสดย่อย + **ปุ่มลิงก์ไป `/users`** |

## 2. การวิเคราะห์ (จาก scrutinize)

สวิตช์ 4 อันในแท็บ "ผู้ใช้งาน" **ไม่ใช่เรื่องการจัดการผู้ใช้จริงๆ** — 3 ใน 4 เป็น system/accounting policy:

- `MakerCheckerToggle` → SystemConfig (workflow อนุมัติทั้งระบบ)
- `TestModeToggle` → SystemConfig (ปิด credit check / OTP / 2FA ทั้งระบบ)
- `ReversePermissionCard` → **"Setting 1"** ของ internal-control: ใครกลับรายการเอกสารบัญชีได้ (ใช้โดย `InternalControlActionBar` ใน 3 โมดูลบัญชี: Expense / OtherIncome / Asset)
- `PettyCashCustodianCard` → มอบหมายผู้ดูแลเงินสดย่อย (segregation of duties)

สำคัญ: `ReversePermissionCard` (Setting 1) เป็น**คู่**กับ `ReverseReasonsManagementCard` (**Setting 2** — dropdown เหตุผลกลับรายการ) ซึ่งอยู่ในแท็บ **"ระบบควบคุม" (`InternalControlTab`, `/settings#internal-control`)** อยู่แล้ว. การยัด 4 การ์ดเข้า `/users` (ทิศทาง A เดิม) จะหั่นคู่นี้แยกคนละหน้า → สับสนกว่าเดิม.

## 3. การตัดสินใจ (Decision) — Direction B

**`/users` = จัดการ "คน" ล้วนๆ. นโยบายระบบกลับไปอยู่ใน settings ที่มันควรอยู่.**

- ลบแท็บ "ผู้ใช้งาน" (`UsersTab`, `/settings#users`) ทิ้ง → กำจัด "ที่สองที่ดูเหมือน user"
- ย้าย 4 การ์ดเข้าแท็บ **"ระบบควบคุม" (`InternalControlTab`) ที่มีอยู่แล้ว** → คู่ reverse (Setting 1 + Setting 2) กลับมาอยู่ด้วยกัน
- **ไม่แตะ `/users`** เลย (UsersPage คงเดิมทุกอย่าง)
- **ไม่ย้ายไฟล์** — 4 การ์ดอยู่ใน `SettingsPage/components/` อยู่แล้ว แค่เปลี่ยนคนที่ import จาก `UsersTab` → `InternalControlTab`

เทียบกับ A: เปลี่ยนน้อยกว่ามาก (ไม่แตะ UsersPage, ไม่ทำ hash-routing ใหม่, ไม่ย้ายไฟล์, redirect ง่ายกว่า), separation สะอาดกว่า, และคู่ internal-control ไม่ถูกหั่น.

## 4. รายละเอียดดีไซน์ (Detailed Design)

### 4.1 `SettingsPage/index.tsx` — ถอดแท็บ + hash alias

- ลบ entry `{ id: 'users', label: 'ผู้ใช้งาน', roles: ['OWNER'], render: () => <UsersTab /> }` ออกจาก `TABS`
- **Redirect แบบ in-page alias** (ไม่ข้าม route, ไม่ใช้ `window.location.replace`): เพิ่ม map `const TAB_ALIASES: Record<string,string> = { users: 'internal-control' };` แล้ว resolve hash ผ่าน alias **ก่อน**เช็ค `visibleIds` ทั้งใน initial `useState` และใน `hashchange` handler. เมื่อ resolve แล้ว ใช้ `history.replaceState` เขียน hash canonical (`#internal-control`).
  - ผล: `/settings#users` (bookmark เก่า) → เปิดแท็บ "ระบบควบคุม" ทันที ไม่มี full reload
  - แก้ Finding 3 (rules-of-hooks) โดยสมบูรณ์ — ไม่มี early-return/redirect ใน render phase, ใช้ logic เลือกแท็บเดิมที่เป็น hook-safe อยู่แล้ว
- (ปรับได้) เปลี่ยน label แท็บ `internal-control` จาก "ระบบควบคุม" → **"ระบบควบคุม & สิทธิ์"** ให้ครอบ maker-checker / reverse / petty-cash / test-mode

### 4.2 `SettingsPage/tabs/InternalControlTab.tsx` — ขยายเป็น grouped layout

ปัจจุบันมีแค่ `ReverseReasonsManagementCard`. ขยายเป็น 3 กลุ่มมีหัวข้อ (section label เล็ก, uppercase, `text-muted-foreground` — ใช้ design tokens, ไม่ hardcode สี):

```
การอนุมัติ & สิทธิ์
  ├─ ระบบอนุมัติ 2 ชั้น (Maker-Checker)        [MakerCheckerToggle]
  ├─ สิทธิ์กลับรายการ — ใครกลับได้ (Setting 1)  [ReversePermissionCard]
  └─ เหตุผลกลับรายการ (Setting 2)              [ReverseReasonsManagementCard]  ← มีอยู่แล้ว, คู่กลับมารวม

เงินสด
  └─ ผู้ดูแลเงินสดย่อย                          [PettyCashCustodianCard]

ความปลอดภัย
  └─ โหมดทดสอบ  ⚠ ระวัง                        [TestModeToggle]  ← เน้นสี destructive
```

- เนื้อหา/ฟังก์ชันของแต่ละการ์ด **ไม่เปลี่ยน** — แค่ import เพิ่ม + ห่อด้วย group + heading
- `TestModeToggle` เด่นเป็น destructive/warning (ปิด credit check/OTP/2FA = เสี่ยงสูง)

### 4.3 ลบ `SettingsPage/tabs/UsersTab.tsx`

- ลบทั้งไฟล์ (เนื้อหาย้ายไป InternalControlTab; การ์ด "จัดการผู้ใช้งาน → ปุ่มไป /users" ตัดทิ้ง — ไม่จำเป็นแล้ว เพราะมีเมนู "ผู้ใช้ / พนักงาน" → /users อยู่แล้ว)
- ลบ import `UsersTab` ใน `index.tsx`
- การ์ดทั้ง 4 (`MakerCheckerToggle`, `TestModeToggle`, `ReversePermissionCard`, `PettyCashCustodianCard`) **อยู่ที่เดิม** ใน `SettingsPage/components/` — ไม่ย้าย (verify จาก grep: ใช้เฉพาะ UsersTab ซึ่งกำลังถูกแทนด้วย InternalControlTab)

### 4.4 `/users` (UsersPage) — ไม่แตะ

ไม่มี hash-routing ใหม่, ไม่มีแท็บที่ 3. คงเดิมทุกอย่าง.

### 4.5 เมนู — ไม่แตะ

`menu.ts` มี "ผู้ใช้ / พนักงาน" → /users เป็นทางเข้าเดียวอยู่แล้ว. ไม่มีเมนูไหนชี้ตรงไป `/settings#users` (ยืนยันจาก grep — มีแต่ `#contacts`, `#peak-mapping` เป็น deep-link) → alias ใน 4.1 ครอบ bookmark เก่าพอ.

## 5. Backward compatibility / Edge cases

- `/settings#users` (bookmark เก่า) → เปิดแท็บ "ระบบควบคุม" ผ่าน alias (ไม่พัง, ไม่ reload)
- FM/ACC ไม่เคยเห็นแท็บ "ผู้ใช้งาน" หรือ "ระบบควบคุม" (ทั้งคู่ OWNER-only) → ไม่กระทบ. ถ้า FM เปิด `/settings#users` → alias เป็น internal-control แต่ internal-control เป็น OWNER-only → ตกไปแท็บแรกที่เห็น (ผู้ติดต่อ) ตาม logic เดิม. ถูกต้อง.
- `/users` ไม่เปลี่ยน → ไม่มี regression ฝั่งผู้ใช้

## 6. ผลกระทบต่อเทส (Testing impact)

- `apps/web/src/pages/SettingsPage/__tests__/SettingsPage.test.tsx` — **ไม่มี assertion เดิมพัง** (ไม่เคยเช็คว่าแท็บ "ผู้ใช้งาน" มีอยู่). **เพิ่ม**: เทส alias `#users` → แท็บ internal-control (mock role OWNER, render แล้วเช็คว่าเนื้อหา internal-control โผล่)
- `apps/web/e2e/settings-tabs.spec.ts` — อัปเดต `TAB_IDS` (เอา `'users'` ออก) + คอมเมนต์ "5-tab hub" (stale อยู่แล้ว). assertion `count >= 5` ไม่พัง. เพิ่มเคส alias ได้ (optional)
- InternalControlTab — เพิ่มเทส render ครบ 5 การ์ด + group headings (สร้างไฟล์เทสถ้ายังไม่มี)
- `apps/web/src/config/menu.test.ts` — ไม่กระทบ (ไม่แตะเมนู)
- ไม่กระทบเทสของ 4 การ์ด/`MakerCheckerConfirmDialog` (อยู่ที่เดิม ไม่ย้าย)

## 7. เอกสารที่ต้องอัปเดต (Docs)

- `.claude/rules/accounting.md` — section "Settings UI consolidation" ระบุ "`#users` — MakerCheckerToggle + link to /users" → เปลี่ยนเป็น internal-control hosts these. (ตัวเลข "5-tab hub" stale อยู่แล้ว — ไม่ใช่ขอบเขตเรา แต่แก้ส่วน #users ให้ถูก)
- `.claude/CLAUDE.md` — Key Routes: `/settings(...)` ลบ reference `#users` ถ้ามี
- คอมเมนต์ stale: `PettyCashCustodianCard.tsx:31` ("Lives on the /settings#users page") → internal-control. ตรวจคอมเมนต์อื่นในการ์ดที่อ้าง `#users` ด้วย

## 8. ไฟล์ที่เกี่ยวข้อง (สรุป)

**แก้ไข**
- `apps/web/src/pages/SettingsPage/index.tsx` — ถอดแท็บ users + hash alias + (ปรับ) label
- `apps/web/src/pages/SettingsPage/tabs/InternalControlTab.tsx` — เพิ่ม 4 การ์ด + grouped layout
- `apps/web/e2e/settings-tabs.spec.ts`, `SettingsPage.test.tsx` (+ test InternalControlTab)
- docs (ข้อ 7)

**ลบ**
- `apps/web/src/pages/SettingsPage/tabs/UsersTab.tsx`

**ไม่แตะ**
- `apps/web/src/pages/UsersPage/**` ทั้งหมด
- `apps/web/src/config/menu.ts`
- 4 การ์ดใน `SettingsPage/components/` (อยู่ที่เดิม)

## 9. Out of scope (อนาคต)

- ปรับความหนาแน่นตารางรายชื่อ `/users` (11+ คอลัมน์)
- ยกเครื่องฟอร์มเพิ่ม/แก้ผู้ใช้ (`/users/:id` — 3 แท็บ account/personal/HR)
- จัดระเบียบแท็บ settings อื่นๆ / ปรับ "5-tab hub" docs ให้ตรงจริง (มี 10 แท็บ)
