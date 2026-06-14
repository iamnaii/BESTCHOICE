# รวมการจัดการ "ผู้ใช้" + "พนักงาน" เข้าเป็นหน้าเดียวที่ /users

วันที่: 2026-06-14
สถานะ: รอ implement

## เป้าหมาย

รวม 2 จุดที่จัดการ "คนในระบบ" ให้เหลือที่เดียว:

- **`/users`** (UsersPage) — บัญชีล็อกอิน (`User`): email, password, role, สาขา, เปิด/ปิดใช้งาน + คำเชิญ
- **`/settings#employees`** (EmployeesTab) + standalone **`/employees`** (EmployeesPage) — โปรไฟล์ HR/เงินเดือน (`EmployeeProfile`): ตำแหน่ง, ประเภทจ้าง, เงินเดือน, ปกส., ธนาคาร, วันลาออก

ทั้งสองจัดการ "คนคนเดียวกัน" คนละมุม (`EmployeeProfile` ผูก 1:optional กับ `User` ผ่าน `userId`) ปัจจุบันฟิลด์ส่วนตัวบางส่วน (ชื่อ, เลขบัตร) แก้ได้ทั้งสองที่ → เสี่ยงข้อมูลขัดกัน การรวมทำให้มีแหล่งข้อมูลเดียว ลดที่ที่ต้องดูแล

## ความสัมพันธ์กับ spec ก่อนหน้า

เมื่อ 2026-06-13 (`2026-06-13-master-data-into-settings-tabs-design.md`) เพิ่งย้าย **ผู้ติดต่อ + พนักงาน** เข้าเป็นแท็บใน `/settings` งานนี้คือ **ดึง "พนักงาน" ออกจาก settings มารวมกับ /users** (ผู้ติดต่อ/contacts คงอยู่ใน settings ตามเดิม ไม่แตะ) — เป็นการปรับเฉพาะส่วน employees ไม่ย้อน contacts

## บริบทปัจจุบัน (verified 2026-06-14)

- **Route guard:** `/users` และ `/settings` = `ProtectedRoute roles={['OWNER']}` (App.tsx:754, 762). `/employees` (App.tsx:487) **ไม่มี route guard** — พึ่ง backend + `canManage` ในตัว body
- **`/settings` เข้าถึงได้จริงแค่ OWNER** (route guard) แม้ SettingsPage ภายในจะ allow OWNER/FM/ACC และแท็บ employees ตั้ง roles `['OWNER','ACCOUNTANT']` → role filter ภายในเป็น **dead config สำหรับ FM/ACC** (เด้งที่ route ก่อน) — ดังนั้นการกำหนด /users เป็น OWNER-only ไม่ได้ตัดสิทธิ์ที่ใช้งานได้จริงของใคร
- **`GET /users/:id` ไม่มี** ใน users.controller (มีแค่ `GET /` list, `POST`, `PATCH :id`, + me/* routes) → ต้องเพิ่ม
- **`employeesApi` ยังถูกใช้โดย `EmployeeCombobox`** (dropdown ในฟอร์ม payroll/expense ผ่าน endpoint `pickable`) → `lib/api/employees.ts` + `/employees/pickable` **ต้องคงไว้**
- **standalone `/employees` ไม่มีใคร `navigate()` ไป** → ลบ route + EmployeesPage ได้ปลอดภัย
- **ProvisionEmployeeDialog / EditEmployeeDialog** ถูกใช้โดย EmployeesTab เท่านั้น → กลายเป็น orphan เมื่อถอด employees, ย้าย field logic เข้าหน้า detail ใหม่ แล้วลบ

## การตัดสินใจที่ตกลงแล้ว (จาก Q&A 2026-06-14)

1. **รูปแบบ:** รวมเข้า `/users` (route เดิม), **OWNER-only ทั้งหมด**
2. **สิทธิ์ HR:** **OWNER เท่านั้น** (ตัด ACCOUNTANT) → ปรับ backend `/employees` (management) ให้เหลือ OWNER, คง `pickable` broad
3. **คนที่ยังไม่มีโปรไฟล์ HR:** แสดง section HR เสมอ + empty state "เพิ่มข้อมูล HR/เงินเดือน" → provision inline
4. **หน้ารายละเอียด:** หน้าแยก `/users/:id` (+ `/users/new` สำหรับสร้าง) เต็มหน้า มี 3 แท็บ
5. **บันทึก:** ปุ่มเดียว save ทั้ง 3 ส่วนแบบ atomic ผ่าน backend endpoint เดียวที่ wrap ใน `$transaction`

## ดีไซน์

### 1. data model — ไม่เปลี่ยน

ไม่ทำ migration, ไม่ยุบ `EmployeeProfile`, คง concept provision (`User` 1:optional `EmployeeProfile`) แค่ย้าย UI + เพิ่ม endpoint ที่ทำงานข้ามสองตาราง

### 2. Backend (apps/api)

| งาน | รายละเอียด |
|---|---|
| **เพิ่ม** `GET /users/:id` (OWNER) | คืน `User` เต็ม (nationalId ไม่ mask — OWNER) + `employeeProfile` (หรือ `null`). รองรับ deep-link/refresh ของหน้า detail |
| **แก้** `GET /users` (OWNER) | join สรุป HR ต่อ user: `{ employeeProfile: { position, employmentType, resignedDate } \| null }` สำหรับคอลัมน์ใหม่ในตาราง (ไม่ส่ง baseSalary ลง list) |
| **เพิ่ม** `PUT /users/:id/profile` (OWNER) | endpoint รวมสำหรับหน้า detail (edit). body `{ user: {...}, employee: {...} \| null }` → `UsersService.updateFull()` ใน **1 `$transaction`**:<br>1) update `User`<br>2) `employee != null` → upsert `EmployeeProfile` (create=provision ถ้ายังไม่มี / update ถ้ามี)<br>3) `employee == null` → ไม่แตะ profile (การลบทำผ่านปุ่ม "นำออก" → `DELETE /employees/:id` แยก)<br>4) `isActive` true→false → revoke refresh tokens (คง T7-C7)<br>5) เขียน audit ทั้งสองฝั่งใน tx เดียว |
| **แก้** `POST /users` (OWNER) | รับ optional `employee` block → tx เดียว: create User + (ถ้ามี) create EmployeeProfile. รองรับ `/users/new` ที่กรอก HR พร้อมตอนสร้าง |
| **ปรับสิทธิ์** `/employees` controller | `list`, `findOne`, `provisionable`, `provision`, `update`, `remove` → **`@Roles('OWNER')`**. **คง** `pickable` = `OWNER, ACCOUNTANT, FINANCE_MANAGER` (EmployeeCombobox ใช้) |
| **คง** `PATCH /users/:id` | ใช้โดย toggle เปิด/ปิด + bulk deactivate ใน list ตามเดิม (ไม่แตะ) |

**ความซับซ้อนหลักฝั่ง backend:** ให้ `UsersService` เรียก upsert ของ `EmployeeProfile` ภายใน transaction เดียวกัน — ทำได้โดย inject `EmployeesService` แล้วทำ method ที่รับ tx client (เช่น `upsertProfile(tx, userId, dto, actor)`) เพื่อคง validation + audit convention เดิม (รายละเอียดอยู่ในแผน implementation)

### 3. Frontend (apps/web)

**เพิ่ม `UserDetailPage`** ที่ `/users/:id` และ `/users/new` (lazy-load, `ProtectedRoute roles={['OWNER']}`) — 3 แท็บ:

| แท็บ | ฟิลด์ | ที่มาเดิม |
|---|---|---|
| **บัญชี / สิทธิ์** | email (read-only ตอน edit), เปลี่ยนรหัสผ่าน, role (`roleLabels` + VIEWER flag เดิม), สาขา, toggle เปิด/ปิดใช้งาน | UserForm |
| **ข้อมูลบุคคล** | avatar (compressImage), อ่านบัตร ปชช. (cardReader), ชื่อ, ชื่อเล่น, รหัสพนง., วันเริ่มงาน (ThaiDateInput), เลขบัตร, วันเกิด, เบอร์, LINE, ที่อยู่ | UserForm |
| **HR / เงินเดือน** | ตำแหน่ง, ประเภทจ้าง, ฐานเงินเดือน, ปกส., ธนาคาร, เลขบัญชี, วันลาออก + ปุ่ม "นำออกจากระบบจ่าย" (`DELETE /employees/:id`) | EditEmployeeDialog / ProvisionEmployeeDialog |

- **HR empty state:** ถ้าไม่มี `employeeProfile` → แสดง "ยังไม่ได้ตั้งเป็นพนักงาน [+ เพิ่มข้อมูล HR/เงินเดือน]"; กดแล้วเผยฟอร์ม → กรอก + กดบันทึกหน้า = provision
- **ปุ่มบันทึกเดียว** (sticky bar) → `PUT /users/:id/profile` (edit) หรือ `POST /users` (create) ส่ง user+employee ก้อนเดียว
- **mode create** (`/users/new`): email + password บังคับ; แท็บ HR กรอกได้เลย (จะ create ทั้งคู่ใน tx); บันทึกสำเร็จ → navigate `/users/:id`

**แก้ `UsersPage` (list)** ([index.tsx](apps/web/src/pages/UsersPage/index.tsx)):
- row click → `navigate('/users/:id')` (เลิกเปิด UserForm modal)
- "เพิ่มผู้ใช้" → `navigate('/users/new')`
- เพิ่มคอลัมน์ **"ตำแหน่งงาน"** (HR position) + badge **พนักงาน/ลาออก/ไม่ใช่พนักงาน** (จาก `employeeProfile` สรุปใน `GET /users`); คอลัมน์ role เดิมเปลี่ยน label เป็น "บทบาท (สิทธิ์)" เพื่อไม่สับสนกับตำแหน่งงาน
- **ไม่โชว์เงินเดือน**ใน list (privacy)
- คง Invites tab + summary cards (เพิ่มการ์ด "พนักงาน N คน" จากจำนวนที่มี profile)
- เลิกใช้ `UserForm` modal: port markup ฟิลด์ (avatar, card reader, ฟิลด์บัญชี+บุคคล) ไปเป็นแท็บใน UserDetailPage แล้วลบ modal เดิม

**ถอดออก:**
- แท็บ `employees` จาก `SettingsPage/index.tsx` TABS (+ ลบ import `EmployeesTab`)
- route `/employees` ใน App.tsx + ไฟล์ `pages/EmployeesPage.tsx`
- ไฟล์ `pages/SettingsPage/tabs/EmployeesTab.tsx`
- ไฟล์ `components/employees/ProvisionEmployeeDialog.tsx`, `components/employees/EditEmployeeDialog.tsx` (ย้าย logic เข้า UserDetailPage แล้วลบ)
- menu.ts: ลบ "พนักงาน → /settings#employees" ของ OWNER (owner-fin-master) + ACCOUNTANT (acc-fin-master + bottomNav). ของ OWNER ถ้าต้องการ rename "ผู้ใช้" → "ผู้ใช้ / พนักงาน" (`/users`)

**คงไว้:** `lib/api/employees.ts` (EmployeeCombobox ใช้ + reuse types `Employee`/`EmploymentType` ในแท็บ HR), `components/employees/EmployeeCombobox.tsx`, แท็บ `contacts` ใน settings

### 4. ตารางสิทธิ์ (หลังรวม)

| ความสามารถ | OWNER | ACCOUNTANT | FM | อื่น ๆ |
|---|:--:|:--:|:--:|:--:|
| `/users` (บัญชี+บุคคล+HR) | ✓ | ✗ | ✗ | ✗ |
| `/employees/pickable` (dropdown) | ✓ | ✓ | ✓ | ✗ |

### 5. การคงพฤติกรรมเดิม (สำคัญ)

- **isActive ↔ resignedDate แยกกัน:** ลาออก (`resignedDate`) ไม่ปิดล็อกอินอัตโนมัติ; ปิดใช้งาน (`isActive`) ไม่ตั้งวันลาออก — แสดงทั้งคู่ ไม่ผูกกัน (คงเดิม)
- **revoke refresh tokens** เมื่อ deactivate ต้องทำใน combined endpoint (T7-C7)
- **audit logs** ทั้ง User update + Employee provision/update เขียนครบใน tx เดียว
- **nationalId** mask ใน list, เต็มในหน้า detail (OWNER) — เหมือน convention เดิม
- **soft delete** "นำออกจากระบบจ่าย" = `DELETE /employees/:id` (เก็บประวัติ payroll) ตามเดิม

## ไฟล์ที่กระทบ

| ไฟล์ | การเปลี่ยนแปลง |
|---|---|
| `apps/api/src/modules/users/users.controller.ts` | + `GET :id`, + `PUT :id/profile`, แก้ `POST` รับ employee block |
| `apps/api/src/modules/users/users.service.ts` | + `findOneFull`, + `updateFull` (tx), แก้ list ให้ join employeeProfile, create รับ employee |
| `apps/api/src/modules/users/dto/*` | DTO รวม user+employee (create/update-full) |
| `apps/api/src/modules/employees/employees.controller.ts` | management endpoints → `@Roles('OWNER')`, คง `pickable` |
| `apps/api/src/modules/employees/employees.service.ts` | method upsert ที่รับ tx client (เรียกจาก UsersService) |
| `apps/web/src/pages/UsersPage/...` | list: row→detail, +คอลัมน์ HR, ปุ่ม→/users/new; + `UserDetailPage` |
| `apps/web/src/App.tsx` | + route `/users/:id`, `/users/new`; − route `/employees` |
| `apps/web/src/pages/SettingsPage/index.tsx` | − แท็บ/ import employees |
| `apps/web/src/config/menu.ts` | − "พนักงาน" (OWNER+ACC), อาจ rename "ผู้ใช้"→"ผู้ใช้ / พนักงาน" |
| ลบ | `EmployeesPage.tsx`, `SettingsPage/tabs/EmployeesTab.tsx`, `ProvisionEmployeeDialog.tsx`, `EditEmployeeDialog.tsx` |
| `lib/api/employees.ts` | **คงไว้** (EmployeeCombobox ใช้); อาจ + helper สำหรับแท็บ HR |

## การทดสอบ

- **API (jest):**
  - `GET /users/:id` คืน user + employeeProfile|null; non-OWNER 403
  - `PUT /users/:id/profile` — update user + provision/update employee ใน tx เดียว; employee=null ไม่แตะ profile
  - tx rollback: บังคับ employee upsert fail → user ต้องไม่ถูกแก้
  - deactivate ผ่าน combined endpoint → refresh tokens ถูก revoke
  - `/employees` management → ACCOUNTANT ได้ 403 (ยกเว้น pickable)
  - `pickable` → ACCOUNTANT/FM ยังเข้าได้
- **Web (vitest):**
  - UserDetailPage: render 3 แท็บ, HR empty state, ปุ่มบันทึกเดียวยิง endpoint รวม
  - UsersPage list: row click → /users/:id, คอลัมน์ HR + badge
  - SettingsPage: ไม่มีแท็บ employees แล้ว (OWNER เห็น 10 แท็บ)
  - ลบ/แก้ test เดิม: `EmployeesPage.test.tsx`, `SettingsPage.test.tsx` (employees assertions)
- **Regression:** EmployeeCombobox (payroll/expense dropdown) ยังทำงาน (pickable)
- **tsc:** `./tools/check-types.sh all` = 0

## นอกขอบเขต (YAGNI)

- ไม่ทำ migration / ไม่ยุบ EmployeeProfile / ไม่ทำ EmployeeProfile auto-1:1
- ไม่แตะ contacts (คงใน settings), KYC ลูกค้า, LIFF
- ไม่เพิ่มฟิลด์ `taxIdOverride` / `note` (ฟอร์มเดิมก็ไม่มี — คงพาริตี้)
- ไม่ทำ redirect `/employees` → `/users` (ลบ route ไปเลย เพราะไม่มีใคร link)
- ไม่เปลี่ยน data ที่มีอยู่
