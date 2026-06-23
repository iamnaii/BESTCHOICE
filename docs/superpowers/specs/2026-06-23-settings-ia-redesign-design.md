# Settings IA Redesign — Design Spec

- **Date**: 2026-06-23
- **Status**: Brainstorm-approved → pending user spec review → writing-plans (phased)
- **Scope owner**: OWNER (พี่นาย)
- **Surface**: ทั้งหมดของ `/settings*` + เมนู settings zone + หน้า config ที่กระจายอยู่นอก /settings

## 1. ปัญหา (จาก inventory)

settings ปัจจุบันกระจัดกระจาย ~30 surface โดยไม่มีกฎ:
- บางอย่างเป็น **แท็บใน `/settings` hub** (VAT, company, periods, attachment, internal-control, backup, peak-mapping, pdpa, contacts) บางอย่างเป็น **หน้า `/settings/*` แยก** (~28 หน้า เช่น dunning, pricing, chart-of-accounts, ai-*) — ไม่มีหลักว่าอะไรควรเป็นแบบไหน
- **dead logic**: `/settings` route เป็น OWNER-only แต่ tab array ประกาศ role FM/ACC → ลิงก์ "สมุดผู้ติดต่อ → /settings#contacts" ของ FM/ACC จะ 403
- **PDPA ซ้ำ 2 ที่**: `/settings#pdpa` (encryption/strict) กับ `/pdpa` (consent) — label เดียวกัน
- **route ซ้ำ**: `/settings/document-config` ลงทะเบียน 2 ครั้ง (หน้าจริง + ComingSoon) → ตัวหลังเป็น dead code, ACC ลิงก์ไปหน้า OWNER-only
- **sidebar "ตั้งค่า"** ปนของจริง (settings) กับ operational (/users, /branches, /promotions, /contract-templates)
- **AI config แยก namespace**: `/settings/ai-*` กับ `/chatbot-finance/*`
- ตัวอย่างที่เห็นชัด: แท็บ "ระบบควบคุม & สิทธิ์" เอา dev/security toggle (โหมดทดสอบ) ไปปนกับ control บัญชี

## 2. เป้าหมาย (พี่เลือกครบ 4)

1. **รวมศูนย์/ลดซ้ำซ้อน** — ยุบ 30+ ที่ + ลบ dead/dup
2. **จัดกลุ่มสื่อความหมาย + หาง่าย**
3. **แยกตาม role ให้ชัด** (แก้ dead logic)
4. **ไม่พัง** (กัน URL/ลิงก์เก่า)

## 3. การตัดสินใจ (Decisions — ทั้งหมด user-approved)

| เรื่อง | เลือก |
|---|---|
| Navigation model | **C — settings panel: เมนูย่อยแนวตั้งซ้าย + เนื้อหาขวา** |
| Feature เพิ่ม | **ค้นหา settings** + **รองรับมือถือ** (sub-nav → dropdown) |
| โครงสร้าง | **8 หมวด** (taxonomy ด้านล่าง) |
| สถาปัตยกรรม | **Settings Registry** ขับ sub-nav/search/role-filter จากข้อมูลชุดเดียว |
| URL | **ใหม่ตามหมวด** `/settings/<categoryId>[/<itemId>]` + redirect ของเก่า (ยกเว้น operational — §5) |
| Sidebar | **ยุบ config เข้า panel เหลือ "ตั้งค่าระบบ" 1 entry** + **คง operational เป็นกลุ่ม "จัดการ" (quick links)** |

> **Post-scrutinize decision (2026-06-23)**: ทำ **เต็มทั้ง 4 เฟส** แต่บังคับแก้ 2 จุด structural ที่ scrutinize เจอ:
> 1. **หน้า config ที่มีแท็บ/sub-nav ของตัวเอง** (เช่น DocumentConfig 9 แท็บ) → render **เต็มจอ (kind=external)** ไม่ฝังใน panel — กัน navigation 3 ชั้น (sidebar → panel sub-nav → แท็บในหน้า)
> 2. **operational pages ไม่ฝังใน panel** — คงเป็น sidebar quick-links กลุ่ม "จัดการ" (งานประจำต้องเข้าถึงไว ไม่ใช่ขุดลึกใน settings)
>
> และ budget เพิ่ม: **แก้ internal links** ที่ชี้ path เก่า (ไม่ใช่พึ่ง redirect อย่างเดียว — §6) + **relax /settings route guard** (§4.3). Trade-off ของ scope เต็ม (churn ~28 URL) เจ้าของรับทราบและเลือกแล้ว.

### Taxonomy — 8 หมวด (approved)
1. 🏢 บริษัท & สาขา · 2. 👥 ผู้ใช้ & สิทธิ์ · 3. 📊 บัญชี & ภาษี · 4. 💰 การเงิน & สินเชื่อ · 5. 📱 สินค้า & การขาย · 6. 💬 สื่อสารลูกค้า · 7. 🤖 AI · 8. ⚙️ ระบบ & ความปลอดภัย

## 4. สถาปัตยกรรม

### 4.1 Settings Registry (source of truth)
ไฟล์เดียว เช่น `apps/web/src/config/settings-registry.ts`:

```ts
type SettingsRole = 'OWNER' | 'FINANCE_MANAGER' | 'ACCOUNTANT';
interface SettingsItem {
  id: string;              // unique within category (เช่น 'vat', 'pricing')
  label: string;           // Thai label
  keywords?: string[];     // ช่วยค้นหา (เช่น ['ภาษี','vat','7%'])
  roles: SettingsRole[];   // ใครเห็น
  kind: 'inline' | 'route' | 'external';
  // inline: component เป็น section ในหน้าหมวด | route: หน้า "เรียบง่าย" (ไม่มีแท็บของตัวเอง) render ใต้ layout, sub-nav คงอยู่ | external: ลิงก์ออก path เดิม — ใช้กับ (ก) operational pages (ข) หน้า config ที่มีแท็บ/sub-nav ของตัวเอง (กัน nav 3 ชั้น)
  component?: React.ComponentType;  // สำหรับ inline
  path?: string;           // สำหรับ external (path เดิมที่คงไว้)
}
interface SettingsCategory {
  id: string;              // 'company' | 'access' | 'accounting' | ...
  label: string; icon: LucideIcon;
  roles: SettingsRole[];   // หมวดโชว์ถ้า role มี item ที่เห็น ≥1 (derive ได้ แต่เก็บไว้ชัด)
  items: SettingsItem[];
}
export const settingsRegistry: SettingsCategory[] = [ ... ];
```

`roles` ที่นี่คือ **source of truth เดียว** ของการมองเห็น — แก้ dead logic เดิม (ไม่มี role ประกาศไว้แต่ route gate ขัดกันอีก).

### 4.2 SettingsLayout (panel)
`apps/web/src/pages/settings/SettingsLayout.tsx`:
- หัวเรื่อง "ตั้งค่าระบบ" + **ช่องค้นหา** (client-side filter บน registry: label+keywords, กรองตาม role; ผลลัพธ์ = jump list ข้ามหมวด)
- **เมนูย่อยซ้าย** = หมวดที่ role เห็น (จาก registry) + ตัวนับรายการ
- **เนื้อหาขวา** = หน้าหมวดที่เลือก (Outlet)
- **มือถือ**: เมนูซ้าย → dropdown/Select บนสุด, เนื้อหาเต็มจอ (`useIsMobile` hook มีอยู่แล้ว)
- **แก้ปัญหาเมนูซ้อน sidebar หลัก**: เมื่ออยู่ใน `/settings/*` ให้ sidebar หลัก collapse (หรือ panel sub-nav อยู่คนละ visual zone ชัดเจน) — รายละเอียด UX ตอน plan
- **กฎกัน nav 3 ชั้น (จาก scrutinize)**: หน้า route ที่ **มีแท็บ/sub-nav ของตัวเอง** (DocumentConfig 9 แท็บ — ยืนยันแล้ว; ตรวจ GFIN, AI-training/performance ตอน plan) → ตั้ง `kind=external` เปิดเต็มจอออกจาก panel. เฉพาะหน้า route "เรียบง่าย" (ฟอร์ม/ตารางเดี่ยว) เท่านั้นที่ render ใน Outlet ของ panel

### 4.3 Routes
- `/settings` → redirect ไปหมวดแรกที่ role เห็น (เช่น `/settings/company`)
- `/settings/:categoryId` → SettingsLayout + หน้าหมวด (inline items = sections; route items = ลิงก์/การ์ด)
- `/settings/:categoryId/:itemId` → SettingsLayout + หน้า route-item ใน Outlet (sub-nav คงอยู่)
- ทุก route ใต้ `/settings` ใช้ role guard จาก registry (resolve จาก categoryId/itemId)
- **เปลี่ยน guard ของ `/settings`** จาก OWNER-only (ปัจจุบัน) → อนุญาต OWNER+FM+ACC แล้วกรองหมวด/รายการตาม registry (กัน FM/ACC โดน 403 ตอนเข้า #contacts เดิม — dead logic ที่ inventory เจอ)

### 4.4 ค้นหา (search)
- Client-side เท่านั้น (registry เล็กพอ) — ไม่ยิง API
- Match: `label`, `keywords`, ชื่อหมวด — กรองตาม role ก่อนเสมอ
- ผลลัพธ์คลิก → ไป `/settings/<cat>/<item>` หรือ scroll ไป section (inline)

### 4.5 Role filtering
- หมวดแสดงเฉพาะถ้า role มี item เห็น ≥1
- item แสดงตาม `roles`
- แก้ dead logic: FM/ACC ที่เคยเห็น "สมุดผู้ติดต่อ" ลิงก์ไป hub OWNER-only → ตอนนี้ contacts เป็น item ใน registry ที่ roles รวม FM/ACC และ guard ตรงกัน

## 5. Category → Item mapping (full)

`kind`: **I**=inline section · **R**=route page "เรียบง่าย" ใต้ /settings (sub-nav คงอยู่) · **X**=external เปิดเต็มจอ — operational **หรือ** หน้า config ที่มีแท็บ/sub-nav ของตัวเอง (กัน nav 3 ชั้น)

| หมวด | รายการ | kind | path ใหม่ (หรือคงเดิม) | redirect จากของเก่า |
|---|---|---|---|---|
| 1 company | ข้อมูลบริษัท | I | /settings/company | #company |
| 1 company | บริษัทในเครือ | R | /settings/company/entities | /settings/companies |
| 1 company | สมุดผู้ติดต่อ | I | /settings/company/contacts | #contacts |
| 1 company | สาขา | X | /branches (คงเดิม) | — |
| 2 access | ผู้ใช้ / พนักงาน | X | /users (คงเดิม) | — |
| 2 access | บัญชีตาม Role | R | /settings/access/account-roles | /settings/account-roles |
| 2 access | ควบคุมภายใน (maker-checker/reverse ×2/petty cash) | I | /settings/access | #internal-control, #users |
| 2 access | นโยบายเอกสารแนบ | I | /settings/access | #attachment |
| 3 accounting | VAT | I | /settings/accounting | #vat |
| 3 accounting | งวดบัญชี | R | /settings/accounting/periods | #periods, /accounting/periods |
| 3 accounting | ผังบัญชี | R | /settings/accounting/chart | /settings/chart-of-accounts |
| 3 accounting | เลขที่/รูปแบบเอกสาร | **X** (9 แท็บในตัว) | /settings/document-config (คงเดิม + ลบ dup route) | — (เข้าจาก panel เป็นลิงก์) |
| 3 accounting | PEAK mapping | I | /settings/accounting | #peak-mapping |
| 3 accounting | PEAK sync | R | /settings/accounting/peak-sync | /settings/peak-sync |
| 3 accounting | e-Tax | R | /settings/accounting/e-tax | /settings/e-tax-config |
| 4 finance | ดอกเบี้ย | R | /settings/finance/interest | /settings/interest-config |
| 4 finance | GFIN | R | /settings/finance/gfin | /settings/gfin-rates |
| 4 finance | ช่องทางชำระเงิน | R | /settings/finance/payment-methods | /settings/payment-methods |
| 5 products | ตั้งราคา | R | /settings/products/pricing | /settings/pricing-templates |
| 5 products | สติกเกอร์ฉลาก | R | /settings/products/stickers | /settings/stickers |
| 5 products | โปรโมชัน | X | /promotions (คงเดิม) | — |
| 5 products | แบบสัญญา | X | /contract-templates (คงเดิม) | — |
| 6 comms | LINE OA | R | /settings/comms/line-oa | /settings/line-oa |
| 6 comms | Rich Menu | R | /settings/comms/rich-menu | /settings/rich-menu |
| 6 comms | ข้อความทักทาย | R | /settings/comms/greeting | /settings/line-greeting |
| 6 comms | SMS templates | R | /settings/comms/sms | /settings/sms-templates |
| 6 comms | ช่องทาง (channels) | R | /settings/comms/channels | /settings/channels |
| 6 comms | Dunning | R | /settings/comms/dunning | /settings/dunning |
| 6 comms | ตั้งค่า collections | R | /settings/comms/collections | /settings/collections |
| 7 ai | AI Admin/Persona/Assistant/Training/Performance | R/X* | /settings/ai/{admin,persona,assistant,training,performance} (X→คง path เดิมถ้ามีแท็บในตัว) | /settings/ai-* |
| | *ตรวจแต่ละหน้า AI ตอน plan: ถ้ามีแท็บ/sub-nav ของตัวเอง → X เปิดเต็มจอ* | | | |
| 8 system | โหมดทดสอบ | I | /settings/system | (เดิมใน #internal-control) |
| 8 system | PDPA (รวม consent+encryption) | R | /settings/system/pdpa | #pdpa, /pdpa |
| 8 system | สำรองข้อมูล | I/R | /settings/system/backup | #offsite-backup |
| 8 system | การเชื่อมต่อ (integrations) | R | /settings/system/integrations | /settings/integrations |
| 8 system | MDM | R | /settings/system/mdm | /settings/mdm-test |
| 8 system | System Status | X | /system-status (คงเดิม) | — |
| 8 system | Audit Log | X | /audit-logs (คงเดิม) | — |

> **⚠️ การตัดสินใจที่ต้องรีวิว (config vs operational URL)**: หน้า "operational" ที่ถูกลิงก์จากที่อื่นเยอะมาก (`/users`, `/branches`, `/promotions`, `/contract-templates`, `/audit-logs`, `/system-status`) — **คง path เดิม** (kind=X) เพราะการย้าย canonical URL ของหน้าพวกนี้ = แก้ `navigate()`/ลิงก์/เทสนับร้อยจุด เสี่ยงสูงเกินคุ้ม. มันยังโผล่ใน panel (เป็นลิงก์ออก) และหายจาก sidebar (ตามข้อ "ยุบเหลืออันเดียว") แต่ URL ไม่ย้าย. ถ้าพี่ยืนยันอยากย้าย /users-class ด้วยจริงๆ บอกได้ — แต่ผมแนะนำคงไว้. (`PDPA` ย้ายได้เพราะ cross-link น้อย + ต้อง dedup อยู่แล้ว)

> **General settings (`/settings/general`)**: เนื้อหาเป็นถังรวม (banking/penalty/payment-link) — ตอน plan จะกระจายแต่ละ field เข้าหมวดที่ถูก (finance/system) แล้วเลิกหน้า general. ถ้าเสี่ยง/ใหญ่ ค่อยทำเฟสท้าย.

## 6. Backward-compat
- ทุก path เดิมในตาราง (คอลัมน์ "redirect") → redirect ไป path ใหม่ ด้วย `window.location.replace` หรือ react-router `<Navigate>` (ตามว่ามี hash หรือไม่ — hash ใช้ replace, path ล้วนใช้ Navigate)
- hash tabs เดิม (#vat ฯลฯ) → ไปหมวด+section ใหม่
- เก็บ alias `#users → /settings/access` ที่เพิ่งทำใน PR ก่อน (ยังใช้ได้/ปรับปลายทาง)
- **แก้ internal links/`navigate()` ที่ชี้ path เก่า** (ไม่พึ่ง redirect อย่างเดียว — กัน flash/redirect-chain): เช่น PeakExportPage → `/settings#peak-mapping`, menu.ts → `/settings/document-config?tab=`, deep-links อื่นจาก inventory §2/§3. ทำทีละหมวดใน P2 พร้อมการย้าย route (เป็นงานที่ scrutinize เตือนว่า spec แรกประเมินต่ำไป)

## 7. Fixes ที่ถือโอกาสแก้
- ลบ route ซ้ำ `/settings/document-config` (ComingSoon dead) → เหลือหน้าจริงที่ /settings/accounting/documents
- PDPA dedup → /settings/system/pdpa เดียว (รวม consent + encryption/strict)
- dead role logic → registry เป็น source of truth เดียว
- AI namespace → รวมใต้ /settings/ai/* (chatbot-finance config ลิงก์เข้ามาจากหมวด AI ถ้าเหมาะ)

## 8. Sidebar (zone settings)
- ยุบ **config** ทั้งหมด (section "ตั้งค่า" + "AI") เหลือ **"ตั้งค่าระบบ" → /settings** 1 entry
- **คง operational เป็นกลุ่ม "จัดการ" ใน sidebar** (ผู้ใช้/พนักงาน, สาขา, โปรโมชัน, แบบสัญญา) — งานประจำต้องเข้าถึงไว (แก้ตาม scrutinize: ห้ามฝังลึกใน panel). operational เหล่านี้ยังโผล่ใน panel หมวดที่เกี่ยวเป็นลิงก์ด้วย → เข้าได้ 2 ทาง
- เสริม: index settings เข้า **CommandPalette** (มีอยู่แล้ว) เป็นทางลัดค้นหา/กระโดด
- `#contacts` ของ FM/ACC ใน sidebar → ชี้ /settings/company/contacts (role ตรง)

## 9. Testing
- registry: unit test ว่าแต่ละ role เห็นหมวด/รายการถูก (กัน dead logic regress)
- SettingsLayout: render sub-nav ตาม role, search filter, mobile dropdown
- redirects: เทสว่า path เก่า → ใหม่ (อย่างน้อย sample ต่อหมวด)
- guard: role ที่ไม่มีสิทธิ์เข้า /settings/<cat>/<item> → เด้ง
- ทุกหน้า route-item ที่ย้าย: smoke ว่า render ใน layout ได้

## 10. Phasing (ตอน writing-plans จะซอยละเอียด)
งานใหญ่เกิน 1 PR — เสนอเฟส:
- **P1 — Shell**: registry + SettingsLayout (sub-nav+search+mobile) + route `/settings/:cat`; ย้าย **inline items + hub tabs** เข้า panel (company/access/accounting/system sections) + redirect hash tabs. /settings ใช้งานได้จริงด้วยหมวดที่ inline ก่อน
- **P2 — Route items migration**: ย้าย ~22 route page เข้า `/settings/<cat>/<item>` + redirects (ทำทีละหมวด: accounting → finance → products → comms → ai → system)
- **P3 — Sidebar**: ยุบ config เหลือ "ตั้งค่าระบบ" 1 entry + เพิ่มกลุ่ม "จัดการ" (operational quick-links) + index settings เข้า CommandPalette
- **P4 — Cleanup**: ลบ dup route, dedup PDPA, เลิกหน้า general (กระจาย field), ลบ dead code

แต่ละเฟส = PR แยก, ทดสอบผ่านก่อนไปต่อ

## 11. Out of scope / ความเสี่ยง
- ย้าย canonical URL ของ operational pages (/users ฯลฯ) — คงไว้ (ดูข้อ 5)
- เปลี่ยน backend/permission model — ไม่แตะ (ใช้ role เดิม)
- รวม `/chatbot-finance/*` (operational chat) เข้า settings — แค่ลิงก์ ไม่ย้าย
- ความเสี่ยงหลัก: P2 แตะ ~22 หน้า + redirects + internal-link เยอะ → ต้องทำทีละหมวด + เทส redirect ทุกตัว
- scrutinize เตือน ROI ของ P2/P3 ต่ำกว่า P1/P4 — เจ้าของเลือกทำเต็ม รับ trade-off churn แล้ว
