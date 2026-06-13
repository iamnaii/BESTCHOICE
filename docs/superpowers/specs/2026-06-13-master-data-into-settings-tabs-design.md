# ย้าย "ข้อมูลหลัก" (สมุดผู้ติดต่อ + พนักงาน) เข้าเป็นแท็บในหน้าตั้งค่ากลาง /settings

วันที่: 2026-06-13
สถานะ: รอ implement

## เป้าหมาย

ย้ายการเข้าถึง master data — **สมุดผู้ติดต่อ** (`/contacts`) และ **พนักงาน** (`/employees`) — จากกลุ่มเมนู
"ข้อมูลหลัก" ใน sidebar ให้ไปอยู่เป็น **แท็บภายในหน้า /settings** (SettingsPage) ซึ่งเป็นฮับตั้งค่ากลางแบบแท็บอยู่แล้ว
โดยไม่ตัดสิทธิ์ฝ่ายการเงิน/ฝ่ายบัญชีที่ใช้งานหน้าเหล่านี้อยู่

## บริบทปัจจุบัน

- `apps/web/src/pages/SettingsPage/index.tsx` — ฮับแท็บแบบ hash (`#company`, `#vat`, …) มี 9 แท็บ config
  และ **การ์ดเปิดเฉพาะ OWNER** (`if (user.role !== 'OWNER') return <Navigate to="/" />`)
- กลุ่มเมนู "ข้อมูลหลัก" อยู่ใน `apps/web/src/config/menu.ts` 3 ที่:
  - `owner-fin-master` (OWNER): สมุดผู้ติดต่อ, พนักงาน
  - `acc-fin-master` (ACCOUNTANT): สมุดผู้ติดต่อ, พนักงาน
  - `fm-fin-master` (FINANCE_MANAGER): **สมุดผู้ติดต่อ เท่านั้น** (ไม่มีพนักงาน)
- `ContactsPage` (`/contacts`) และ `EmployeesPage` (`/employees`) ต่างมี `PageHeader` + `useDocumentTitle` ของตัวเอง
- `ContactDetailPage` (`/contacts/:id`) มีปุ่มกลับ `navigate('/contacts')` — route `/contacts` ต้องยังทำงาน
- `EmployeesPage` ไม่มีหน้า detail (ใช้ dialog) — self-contained; การจัดการจำกัด OWNER/ACCOUNTANT (`canManage`)

## การตัดสินใจที่ตกลงแล้ว

1. **รูปแบบ:** ทำเป็นแท็บภายในหน้า /settings (ไม่ใช่แค่ย้ายลิงก์เมนู)
2. **สิทธิ์:** เปิดหน้า /settings ให้ OWNER/FM/ACC เข้าได้ แล้ว gate การมองเห็นเป็นรายแท็บ
3. **เมนู sidebar "ข้อมูลหลัก":** คงกลุ่มไว้ แต่เปลี่ยนลิงก์ไปชี้แท็บใน /settings
4. **route เดิม `/contacts`, `/employees`:** คงไว้ (back-compat + ปุ่ม back ของหน้า detail)

## ดีไซน์

### 1. การมองเห็นแท็บตาม role

| แท็บ (id) | OWNER | FINANCE_MANAGER | ACCOUNTANT |
|---|:--:|:--:|:--:|
| `contacts` (ผู้ติดต่อ) | ✓ | ✓ | ✓ |
| `employees` (พนักงาน) | ✓ | ✗ | ✓ |
| config 9 แท็บเดิม (`company`,`vat`,`periods`,`attachment`,`users`,`internal-control`,`offsite-backup`,`peak-mapping`,`pdpa`) | ✓ | ✗ | ✗ |

หมายเหตุ: FM ไม่เห็น `employees` ให้สอดคล้องกับเมนูเดิม (FM มีแค่สมุดผู้ติดต่อ) — capability ของ FM/ACC
เท่าเดิมหรือดีขึ้น ไม่มีการลดสิทธิ์

### 2. การ์ดสิทธิ์ + แท็บเริ่มต้น (SettingsPage)

- เปลี่ยนการ์ดจาก OWNER-only → อนุญาต `['OWNER','FINANCE_MANAGER','ACCOUNTANT']` (role อื่น redirect `/` เหมือนเดิม)
- นิยาม tab registry พร้อม `roles` ต่อแท็บ → คำนวณ `visibleTabs` ตาม `user.role`
- แท็บเริ่มต้น = แท็บแรกใน `visibleTabs` (OWNER = `company` ตามเดิม, FM/ACC = `contacts`)
- ถ้า hash ที่ร้องขอไม่อยู่ใน `visibleTabs` (เช่น FM เปิด `#vat`) → ตั้ง activeTab เป็นแท็บแรกที่เห็นได้ + แก้ hash ให้ตรง
- TabsList render เฉพาะ `visibleTabs`; เรียงลำดับ master-data (`contacts`,`employees`) ขึ้นก่อน แล้วตามด้วย config
  (config โผล่เฉพาะ OWNER) — ปรับ `grid-cols-*` ให้พอดีจำนวนแท็บที่เห็นจริง

> Edge case ที่บันทึกไว้ (ไม่แก้ในงานนี้): เมนู FM "งวดบัญชี" → `/accounting/periods` → redirect `/settings#periods`
> เดิม FM ถูกเด้งออก `/`; หลังแก้ FM จะเด้งไปแท็บแรกที่เห็น (`contacts`) แทน — ไม่ใช่ regression
> (FM เข้าถึง periods ไม่ได้ทั้งก่อนและหลัง) เป็น quirk เดิมของเมนู FM นอกขอบเขตงานนี้

### 3. แยก body ออกจาก header (กันโค้ดซ้ำ)

ปัญหา: ฝัง ContactsPage/EmployeesPage เป็นแท็บตรงๆ จะได้ PageHeader ซ้อนกับหัวข้อ "ตั้งค่าระบบ" ของ SettingsPage

แนวทาง: แตก "เนื้อหา" (ตาราง/ค้นหา/dialog/modal) ออกเป็น component ใช้ร่วม:

- `ContactsTab` = body ของ ContactsPage (ไม่มี `PageHeader`/`useDocumentTitle`)
- `EmployeesTab` = body ของ EmployeesPage (ไม่มี header)
- `ContactsPage` / `EmployeesPage` (route เดิม) → เหลือ wrapper บางๆ: `useDocumentTitle` + `PageHeader` + เรนเดอร์ tab component เดิม
- ปุ่ม "เพิ่ม…" / actions ที่เดิมอยู่ใน PageHeader ของหน้า standalone → ย้ายไปอยู่ในแถบ action ภายใน body
  (ให้แสดงทั้งใน standalone และในแท็บได้เหมือนกัน)

ผลลัพธ์: standalone page กับ settings tab ใช้โค้ดชุดเดียวกัน ไม่ divergent

### 4. แท็บใหม่ใน SettingsPage

- เพิ่ม `<TabsTrigger value="contacts">ผู้ติดต่อ</TabsTrigger>` และ `value="employees">พนักงาน` (เฉพาะที่ role เห็น)
- `<TabsContent value="contacts"><ContactsTab/></TabsContent>` + employees เช่นกัน
- เพิ่ม `'contacts'`, `'employees'` ใน `TAB_IDS` (deep-link `#contacts` / `#employees` ใช้ได้)

### 5. เมนู sidebar (menu.ts)

- 3 กลุ่ม "ข้อมูลหลัก" คงไว้ แต่เปลี่ยน `path`:
  - สมุดผู้ติดต่อ → `/settings#contacts`
  - พนักงาน → `/settings#employees`
- ตรวจว่า active-state ของ sidebar ยัง highlight ถูกเมื่อ path มี hash (ถ้า matcher ใช้ exact path อาจต้องรองรับ hash)

### 6. route เดิม

- คง `/contacts`, `/contacts/:id`, `/employees` ตามเดิม
- ปุ่ม back ของ `ContactDetailPage` (`navigate('/contacts')`) คงเดิม — ยังพากลับหน้า standalone ได้
  (ถ้าต้องการให้กลับเข้าแท็บ settings ค่อยปรับภายหลัง — ไม่อยู่ในขอบเขตงานนี้)

## ไฟล์ที่กระทบ

| ไฟล์ | การเปลี่ยนแปลง |
|---|---|
| `apps/web/src/pages/SettingsPage/index.tsx` | guard 3 role, tab registry + roles, visibleTabs, default/redirect tab, เพิ่ม 2 แท็บ |
| `apps/web/src/pages/SettingsPage/tabs/ContactsTab.tsx` | ใหม่ — body ของ contacts |
| `apps/web/src/pages/SettingsPage/tabs/EmployeesTab.tsx` | ใหม่ — body ของ employees |
| `apps/web/src/pages/ContactsPage.tsx` | เหลือ wrapper (header) + `<ContactsTab/>` |
| `apps/web/src/pages/EmployeesPage.tsx` | เหลือ wrapper (header) + `<EmployeesTab/>` |
| `apps/web/src/config/menu.ts` | 3 กลุ่ม "ข้อมูลหลัก" เปลี่ยน path เป็น `/settings#...` |

## การทดสอบ

- **Unit (vitest):**
  - SettingsPage: OWNER เห็นครบ 11 แท็บ; FM เห็น `[contacts]`; ACC เห็น `[contacts, employees]`
  - SettingsPage: non-OWNER เปิด hash config (`#vat`) → activeTab ถูกบังคับเป็นแท็บแรกที่เห็น
  - SettingsPage: role นอกสาม (เช่น SALES) → redirect `/`
  - ContactsTab/EmployeesTab render ได้โดยไม่มี PageHeader ซ้อน
- **Regression:** รัน web suite เดิมทั้งหมด (เดิม 649 ผ่าน) — ContactsPage/EmployeesPage standalone + ContactDetailPage back ยังทำงาน
- **tsc:** `npx tsc --noEmit` = 0
- **Manual:** เข้า /settings ด้วย OWNER/FM/ACC, คลิกเมนู "ข้อมูลหลัก" → เด้งเข้าแท็บถูกต้อง

## นอกขอบเขต (YAGNI)

- ไม่ทำ /contacts redirect → /settings (คง route เดิม)
- ไม่ยุ่งสิทธิ์ config tabs (ยัง OWNER-only)
- ไม่แก้ quirk เมนู FM "งวดบัญชี"
- ไม่เปลี่ยนปุ่ม back ของหน้า detail ให้เข้าแท็บ settings
