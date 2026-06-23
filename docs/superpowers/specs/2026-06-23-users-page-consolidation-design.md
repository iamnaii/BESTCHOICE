# Users Page Consolidation — Design Spec

- **Date**: 2026-06-23
- **Status**: Approved (brainstorm) → pending implementation plan
- **Scope owner**: OWNER (พี่นาย)
- **Surfaces**: `/users` (UsersPage), `/settings#users` (SettingsPage UsersTab)

## 1. ปัญหา (Problem)

ตอนนี้มี 2 ที่ที่เกี่ยวกับ "ผู้ใช้" ซึ่งทำให้สับสนว่าทำไมต้องมีแยกกัน:

| | `/users` (เมนู: "ผู้ใช้ / พนักงาน") | `/settings#users` (แท็บ "ผู้ใช้งาน") |
|---|---|---|
| ทำอะไร | จัดการบัญชีผู้ใช้จริง (เพิ่ม/แก้/เชิญ/เปิด-ปิด, โปรไฟล์ HR) | toggle อำนาจ/ความปลอดภัยระดับระบบ |
| มีอะไร | ตาราง + การ์ดสถิติ + แท็บคำเชิญ | Maker-Checker, Test Mode, สิทธิ์กลับรายการ, ผู้ดูแลเงินสดย่อย + **ปุ่มลิงก์ไป `/users`** |

แท็บ settings มีแค่ "สวิตช์ 4 อัน + ปุ่มเด้งไป /users" ทำให้รู้สึกซ้ำซ้อน. ทั้งคู่เป็น **OWNER-only** เหมือนกัน → รวมเป็นที่เดียวได้สะอาด.

## 2. เป้าหมาย & ขอบเขต (Goals / Non-goals)

**Goals**
- รวม `/settings#users` เข้าไปใน `/users` ให้เป็นหน้าเดียวสำหรับทุกเรื่องเกี่ยวกับ "คน"
- เพิ่มความ user-friendly: แท็บผูกกับ URL (bookmark ได้), จัดกลุ่มสวิตช์ให้อ่านง่าย, เน้นรายการอันตราย (Test Mode)
- ไม่ทำลิงก์เก่าพัง — `/settings#users` redirect อัตโนมัติ

**Non-goals (ไม่แตะรอบนี้)**
- ฟอร์มเพิ่ม/แก้ผู้ใช้ (`/users/:id`, `/users/new`) — คงเดิม
- ตารางรายชื่อ + การ์ดสถิติ + แท็บคำเชิญ — คงเดิม (เฉพาะ refactor การคุมแท็บด้วย URL)
- แท็บ settings อื่นๆ (ระบบควบคุม/ระบบควบคุม = ReverseReasonsManagementCard ยังอยู่ที่ settings ไม่ย้าย)

## 3. การตัดสินใจ (Decision)

**Approach A — เพิ่มแท็บที่ 3 ใน `/users`** (เลือกแล้ว — เข้ากับ tab pattern เดิมของโปรเจค, ไม่เกิดเมนูซ้อนเมนูเหมือนแบบ sub-nav).

`/users` มี 3 แท็บ:

| # | แท็บ | เนื้อหา | สถานะ |
|---|---|---|---|
| 1 | **ผู้ใช้งาน** | ตารางรายชื่อ + การ์ดสถิติ | เดิม |
| 2 | **คำเชิญ** | ตารางคำเชิญ | เดิม |
| 3 | **สิทธิ์ & การอนุมัติ** | 4 สวิตช์จาก settings | **ใหม่** |

ชื่อแท็บที่ 3 = **"สิทธิ์ & การอนุมัติ"** (เลี่ยงคำว่า "ควบคุม" กันสับสนกับแท็บ "ระบบควบคุม" ใน settings).

## 4. รายละเอียดดีไซน์ (Detailed Design)

### 4.1 โครงสร้างแท็บ + ผูกกับ URL

ปัจจุบัน `UsersPage` คุมแท็บด้วย `useState<'users'|'invites'>` ล้วน (refresh แล้วหาย, bookmark ไม่ได้).

เปลี่ยนเป็น **hash-driven** ตาม pattern เดียวกับ `SettingsPage/index.tsx` (`readHash()` + `hashchange` listener + `history.replaceState`):

- `/users` หรือ `/users#users` → แท็บ "ผู้ใช้งาน" (default)
- `/users#invites` → แท็บ "คำเชิญ"
- `/users#control` → แท็บ "สิทธิ์ & การอนุมัติ"

hash ที่ไม่รู้จัก → fallback แท็บแรก. แท็บ "คำเชิญ" เดิมแสดงเฉพาะ OWNER อยู่แล้ว (ทั้งหน้าเป็น OWNER-only) — ทั้ง 3 แท็บจึงเห็นได้เฉพาะ OWNER, ไม่ต้อง gate เพิ่ม.

### 4.2 แท็บ "สิทธิ์ & การอนุมัติ" — Layout A (จัดกลุ่ม)

จัด 4 การ์ดเป็น 3 กลุ่มมีหัวข้อ (section label) แทนการเรียงเปล่าๆ:

```
การอนุมัติ & สิทธิ์
  ├─ ระบบอนุมัติ 2 ชั้น (Maker-Checker)      [MakerCheckerToggle]
  └─ สิทธิ์กลับรายการ (Reverse)              [ReversePermissionCard]

เงินสด
  └─ ผู้ดูแลเงินสดย่อย                        [PettyCashCustodianCard]

ความปลอดภัย
  └─ โหมดทดสอบ  ⚠ ระวัง                      [TestModeToggle]  ← เน้นสีแดง (destructive)
```

- หัวข้อกลุ่มใช้ section label เล็ก (uppercase, `text-muted-foreground`) ตาม design tokens เดิม — ไม่ hardcode สี
- Test Mode เด่นเป็น destructive/warning เพราะปิด credit check / OTP / 2FA (ความเสี่ยงสูง ต้องเห็นชัด)
- เนื้อหา/ฟังก์ชันของแต่ละการ์ด **ไม่เปลี่ยน** — แค่ห่อด้วย group + heading

### 4.3 ย้าย component (relocation)

การ์ดทั้ง 4 ปัจจุบันอยู่ `apps/web/src/pages/SettingsPage/components/` และถูกใช้ **เฉพาะ** `SettingsPage/tabs/UsersTab.tsx` (ยืนยันด้วย grep) ซึ่งจะถูกลบ.

- ย้าย `MakerCheckerToggle`, `TestModeToggle`, `ReversePermissionCard`, `PettyCashCustodianCard` (+ dependency ส่วนตัวที่ใช้เฉพาะการ์ดเหล่านี้ เช่น `MakerCheckerConfirmDialog`) ไป `apps/web/src/pages/UsersPage/components/controls/`
- **เงื่อนไข**: ก่อนย้าย dependency แต่ละตัว ให้ verify ว่าไม่ถูก import จากที่อื่น — ถ้า shared ให้คงไว้ที่เดิม/ย้ายเป็น shared แทน (ตรวจตอนทำ plan)
- สร้าง `UsersPage/components/ControlTab.tsx` ประกอบ 4 การ์ด + group heading (Layout A)
- ลบ `SettingsPage/tabs/UsersTab.tsx`
- ผลลัพธ์: ไม่มี cross-page import (UsersPage ไม่ดึงจาก SettingsPage)

### 4.4 SettingsPage — ถอดแท็บ + redirect

ใน `apps/web/src/pages/SettingsPage/index.tsx`:
- ลบ entry `{ id: 'users', label: 'ผู้ใช้งาน', ... }` ออกจาก `TABS`
- เพิ่ม redirect: ถ้า `readHash() === 'users'` → `window.location.replace('/users#control')` **ก่อน** logic เลือกแท็บปกติ เพื่อกัน bookmark/ลิงก์เก่าพัง. ใช้ `window.location.replace` (ไม่ใช่ react-router `<Navigate>`) เพราะ `<Navigate>` ตั้ง hash fragment ไม่ได้ — เหตุผลเดียวกับ redirect `/accounting/periods → /settings#periods` ที่มีอยู่แล้ว
- ตัดการ์ด "จัดการผู้ใช้งาน → ปุ่มไปยังหน้าผู้ใช้งาน" ทิ้ง (ติดมากับ UsersTab ที่ลบอยู่แล้ว)

### 4.5 เมนู (ไม่เปลี่ยน)

`apps/web/src/config/menu.ts` มี `{ label: 'ผู้ใช้ / พนักงาน', path: '/users', icon: UserCog }` อยู่แล้ว (2 ที่: line 742, 910) → เป็นทางเข้าเดียว ไม่ต้องแก้. ไม่มีเมนูชี้ตรงไป `/settings#users` (เข้าผ่านแท็บใน settings เท่านั้น) — redirect ใน 4.4 ครอบคลุมแล้ว.

## 5. Backward compatibility / Edge cases

- `/settings#users` (bookmark เก่า) → redirect ไป `/users#control` อัตโนมัติ
- `/users` (ไม่มี hash) → แท็บแรกเหมือนเดิม (ไม่กระทบ flow ปัจจุบัน)
- back/forward ของ browser ทำงานกับแท็บได้ (hashchange)
- ทั้งหมด OWNER-only เหมือนเดิม — ไม่มีการขยาย/ลดสิทธิ์

## 6. ผลกระทบต่อเทส (Testing impact)

- `apps/web/src/pages/SettingsPage/__tests__/SettingsPage.test.tsx` — อัปเดต: ไม่มีแท็บ "ผู้ใช้งาน" แล้ว + เพิ่มเทส redirect `#users → /users#control`
- `apps/web/src/config/menu.test.ts` — ตรวจว่ายังมี "ผู้ใช้ / พนักงาน" → /users (ไม่ควรพัง)
- เทสใหม่: `UsersPage` แสดง 3 แท็บ + อ่าน hash ถูกต้อง (`#control` เปิดแท็บที่ 3)
- เทสใหม่: `ControlTab` render 4 การ์ดครบ + group headings
- `UserTable.test.tsx` — ไม่กระทบ (ไม่แตะตาราง)

## 7. ไฟล์ที่เกี่ยวข้อง (สรุป)

**แก้ไข**
- `apps/web/src/pages/UsersPage/index.tsx` — เพิ่มแท็บ 3 + hash-driven tabs
- `apps/web/src/pages/SettingsPage/index.tsx` — ถอดแท็บ users + redirect

**สร้างใหม่**
- `apps/web/src/pages/UsersPage/components/ControlTab.tsx`
- `apps/web/src/pages/UsersPage/components/controls/` (ย้าย 4 การ์ด + private deps มาที่นี่)

**ลบ**
- `apps/web/src/pages/SettingsPage/tabs/UsersTab.tsx`

## 8. Out of scope (อนาคต)

- ปรับความหนาแน่นของตารางรายชื่อ (11+ คอลัมน์)
- ยกเครื่องฟอร์มเพิ่ม/แก้ผู้ใช้ (3 แท็บ account/personal/HR)
- รวม/จัดระเบียบแท็บ settings อื่นๆ
