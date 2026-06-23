# Settings IA Redesign — P2b (Remaining Category Migrations) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ย้ายหน้า config ที่เหลือทั้งหมด (20 หน้า ใน 7 หมวด) เข้า settings panel เป็น `/settings/<หมวด>/<รายการ>` ตาม pattern ที่ P2a พิสูจน์กับ finance — โดยหน้าที่มีแท็บในตัว (DocumentConfig, RichMenu) คงเป็น external เต็มจอ

**Architecture:** P2a สร้าง infra ครบแล้ว — `SettingsItemRoute` render `item.component` ของ route-item ใดๆ แบบ generic, `SettingsCategoryRoute` เป็น index, nested routes ใต้ `/settings/:categoryId`. P2b จึง **ไม่ต้องแก้ infra** — แค่: (1) เปลี่ยน registry item จาก `kind:'external'`→`'route'` + ใส่ `component` + path ใหม่; (2) เพิ่ม redirect path เก่า→ใหม่ + ลบ route เดิมใน App.tsx; (3) แก้ internal links. ทุกหมวดใช้ **Migration Recipe เดียวกัน** (ด้านล่าง) ต่างกันแค่ข้อมูลในตารางของแต่ละหมวด

**Tech Stack:** React 18 + TS + Vite + react-router v7 + Tailwind + Vitest

**Spec:** `docs/superpowers/specs/2026-06-23-settings-ia-redesign-design.md` · **Builds on:** P2a (Outlet foundation + finance)

**Sequencing note:** ทุก task แก้ไฟล์ร่วมกัน 2 ไฟล์ (`settings-registry.tsx` + `App.tsx`) → **ต้องทำเรียงลำดับ (sequential)** ห้ามขนาน (จะ conflict). subagent-driven ทีละ task เหมาะสุด

## Global Constraints

- Design-token classes only; functional components + hooks; Thai `leading-snug`
- Registry = single source of truth; role guard จาก `item.roles` (มีอยู่แล้วใน SettingsItemRoute)
- **ห้ามแตะ internals** ของหน้าที่ย้าย — แค่ import + ผูก route + redirect
- หน้าที่มี **แท็บ/sub-nav ของตัวเอง คง `kind:'external'`** (path เดิม): DocumentConfigPage, RichMenuPage — ห้ามเปลี่ยนเป็น route
- หน้า operational คง external path เดิม (ไม่อยู่ใน P2b): promotions, contract-templates, branches, users, audit-logs, system-status
- redirect ใช้ react-router `<Navigate replace>`; แก้ internal links (ไม่พึ่ง redirect อย่างเดียว)
- `ETaxConfigPage` เป็น **named export** — registry ต้อง `import { ETaxConfigPage }` (ไม่ใช่ default)
- Commit ทีละ task (= ทีละหมวด); branch stack ต่อจาก P2a

---

## Migration Recipe (ใช้กับทุกหมวด — แทนค่าจากตารางของหมวดนั้น)

สำหรับหมวด `<cat>` ที่มี route-items ชุดหนึ่ง (แต่ละตัวมี: `id`, `Component`, `import`, `oldPath`, `newPath = /settings/<cat>/<id>`):

**R1. registry** (`apps/web/src/config/settings-registry.tsx`): เพิ่ม import ของแต่ละ Component (default: `import X from '@/pages/X'`; named: `import { X } from '@/pages/X'`). เปลี่ยนแต่ละ item ในหมวดจาก
`{ id, label, roles, kind: 'external', path: '<oldPath>' }`
เป็น
`{ id, label, roles, kind: 'route', component: <Component>, path: '<newPath>' }`
(รายการที่ระบุว่า **คง external** → ไม่แตะ)

**R2. App.tsx redirects**: แทน `<Route path="<oldPath>" element={<ProtectedRoute roles={...}><Component/></ProtectedRoute>}/>` ด้วย
`<Route path="<oldPath>" element={<Navigate to="<newPath>" replace />} />`
แล้วลบ lazy import ของ Component นั้นใน App.tsx ถ้าไม่มีที่อื่นอ้าง (verify ด้วย grep) — เพราะ registry import เองแล้ว

**R3. internal links**: แก้ทุกลิงก์ภายในที่ชี้ `<oldPath>` → `<newPath>` (จากตาราง "internal links" ของหมวด). ใช้ `<Link to>`/`<a href>`/`navigate()` ตามของเดิม

**R4. test** (`apps/web/src/pages/settings/__tests__/<cat>-migration.test.tsx`): ตาม template นี้ (แทน page mocks + assertions ตามตาราง):

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Navigate } from 'react-router';
import { SettingsLayout } from '../SettingsLayout';
import { SettingsCategoryRoute } from '../SettingsCategoryRoute';
import { SettingsItemRoute } from '../SettingsItemRoute';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'OWNER' } }) }));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));
// --- mock each migrated page of this category (one line each):
// vi.mock('@/pages/<Component path>', () => ({ default: () => <div><id>-page</div> }));
//   (named export → mock { <Name>: () => ... } instead of { default })

function App({ entry }: { entry: string }) {
  return (
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        {/* one redirect <Route> per migrated item: */}
        {/* <Route path="<oldPath>" element={<Navigate to="<newPath>" replace />} /> */}
        <Route path="/settings/:categoryId" element={<SettingsLayout />}>
          <Route index element={<SettingsCategoryRoute />} />
          <Route path=":itemId" element={<SettingsItemRoute />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('<cat> migration', () => {
  it('render <firstItem> ใน panel', () => {
    render(<App entry="/settings/<cat>/<firstId>" />);
    expect(screen.getByText('<firstId>-page')).toBeTruthy();
    expect(screen.getByRole('link', { name: /<categoryThaiLabel>/ })).toBeTruthy(); // nav ยังอยู่
  });
  // one redirect test per migrated item:
  it('old <oldPath> → redirect', async () => {
    render(<App entry="<oldPath>" />);
    await waitFor(() => expect(screen.getByText('<id>-page')).toBeTruthy());
  });
});
```

**R5. verify**: `cd apps/web && npx vitest run src/pages/settings src/config` (เขียว) + `./tools/check-types.sh web` (0 errors) + grep ยืนยันไม่มี internal link ค้างที่ `<oldPath>` (นอก redirect/comment)

**R6. commit**: `git commit -m "feat(settings): P2b migrate <cat> category to /settings/<cat>/*"`

> **กฎสำคัญ**: รายการ kind:'external' ที่ระบุ "คง" — **ห้าม**เปลี่ยน. ตรวจ export style (default vs named) ให้ตรงก่อน import.

---

## Task 1: หมวด accounting (chart, peak-sync, e-tax → route; document-config คง external)

**Files:** `settings-registry.tsx`, `App.tsx`, `apps/web/src/pages/ETaxInvoicePage.tsx`, test `__tests__/accounting-migration.test.tsx`

**ตารางหมวด accounting:**

| id | Component (export) | import | oldPath | newPath | roles | kind |
|---|---|---|---|---|---|---|
| chart | ChartOfAccountsPage (default) | `import ChartOfAccountsPage from '@/pages/ChartOfAccountsPage'` | /settings/chart-of-accounts | /settings/accounting/chart | OWNER,FM,ACC | route |
| peak-sync | PeakSyncPage (default) | `import PeakSyncPage from '@/pages/PeakSyncPage'` | /settings/peak-sync | /settings/accounting/peak-sync | OWNER,ACC | route |
| e-tax | **ETaxConfigPage (named)** | `import { ETaxConfigPage } from '@/pages/ETaxConfigPage'` | /settings/e-tax-config | /settings/accounting/e-tax | OWNER | route |
| documents | — | — | — | — | OWNER | **คง external** (9 แท็บ) |

**internal links:** `apps/web/src/pages/ETaxInvoicePage.tsx:212` `<Link to="/settings/e-tax-config">` → `/settings/accounting/e-tax`

- [ ] **Step 1:** ใช้ Recipe R4 เขียน `accounting-migration.test.tsx` ก่อน (mock 3 หน้า: ChartOfAccountsPage/PeakSyncPage default, ETaxConfigPage named → `vi.mock('@/pages/ETaxConfigPage', () => ({ ETaxConfigPage: () => <div>e-tax-page</div> }))`; firstItem=chart; 3 redirect tests). รัน → FAIL (path ยังเก่า/หน้ายังไม่ใช่ route)
- [ ] **Step 2:** Recipe R1 — registry: import 3 หน้า (e-tax แบบ named) + เปลี่ยน chart/peak-sync/e-tax เป็น kind:'route'. **อย่าแตะ documents** (คง external)
- [ ] **Step 3:** Recipe R2 — App.tsx: redirect 3 path เก่า (chart-of-accounts, peak-sync, e-tax-config) + ลบ lazy import 3 ตัว (verify ไม่มีที่อื่นอ้าง). **อย่าแตะ document-config route**
- [ ] **Step 4:** Recipe R3 — แก้ ETaxInvoicePage.tsx:212 → `/settings/accounting/e-tax`
- [ ] **Step 5:** Recipe R5 verify (vitest settings+config เขียว, check-types 0, grep clean) → Recipe R6 commit

---

## Task 2: หมวด comms (line-oa, greeting, sms, channels, dunning, collections → route; rich-menu คง external)

**Files:** `settings-registry.tsx`, `App.tsx`, `apps/web/src/pages/DunningSettingsPage.tsx`, test `__tests__/comms-migration.test.tsx`

| id | Component (export) | import | oldPath | newPath | roles | kind |
|---|---|---|---|---|---|---|
| line-oa | LineOaSettingsPage (default) | `import LineOaSettingsPage from '@/pages/LineOaSettingsPage'` | /settings/line-oa | /settings/comms/line-oa | OWNER | route |
| greeting | LineGreetingPage (default) | `import LineGreetingPage from '@/pages/LineGreetingPage'` | /settings/line-greeting | /settings/comms/greeting | OWNER | route |
| sms | SmsTemplatesPage (default) | `import SmsTemplatesPage from '@/pages/SmsTemplatesPage'` | /settings/sms-templates | /settings/comms/sms | OWNER,FM | route |
| channels | ChannelSettingsPage (default) | `import ChannelSettingsPage from '@/pages/ChannelSettingsPage'` | /settings/channels | /settings/comms/channels | OWNER | route |
| dunning | DunningSettingsPage (default) | `import DunningSettingsPage from '@/pages/DunningSettingsPage'` | /settings/dunning | /settings/comms/dunning | OWNER | route |
| collections | CollectionsSettingsPage = `CollectionsPage` (default) | `import CollectionsSettingsPage from '@/pages/SettingsPage/CollectionsPage'` | /settings/collections | /settings/comms/collections | OWNER | route |
| rich-menu | — | — | — | — | OWNER | **คง external** (2-axis tabs) |

**internal links:** `apps/web/src/pages/DunningSettingsPage.tsx:369` `<a href="/settings/sms-templates">` → `/settings/comms/sms`

- [ ] **Step 1:** R4 test `comms-migration.test.tsx` (mock 6 หน้า default; firstItem=line-oa; 6 redirect tests). รัน → FAIL
- [ ] **Step 2:** R1 registry — import 6 หน้า + เปลี่ยนเป็น route. **อย่าแตะ rich-menu**
- [ ] **Step 3:** R2 App.tsx — redirect 6 path เก่า + ลบ lazy imports (verify). **อย่าแตะ rich-menu route**
- [ ] **Step 4:** R3 — DunningSettingsPage.tsx:369 → `/settings/comms/sms`
- [ ] **Step 5:** R5 verify → R6 commit

---

## Task 3: หมวด ai (ทั้ง 5 หน้า → route; rename id ตัด prefix "ai-")

**Files:** `settings-registry.tsx`, `App.tsx`, `apps/web/src/pages/AiAdminPage.tsx`, test `__tests__/ai-migration.test.tsx`

> ปรับ id ให้ URL สะอาด: `ai-admin`→`admin`, `ai-persona`→`persona`, `ai-assistant`→`assistant`, `ai-training`→`training`, `ai-performance`→`performance` (id ใช้แค่ภายใน registry+search — ปลอดภัย). newPath = `/settings/ai/<newId>`

| newId | Component (default) | import | oldPath | newPath | roles |
|---|---|---|---|---|---|
| admin | AiAdminPage | `import AiAdminPage from '@/pages/AiAdminPage'` | /settings/ai-admin | /settings/ai/admin | OWNER |
| persona | AiPersonaPage | `import AiPersonaPage from '@/pages/AiPersonaPage'` | /settings/ai-persona | /settings/ai/persona | OWNER |
| assistant | AiSettingsPage | `import AiSettingsPage from '@/pages/AiSettingsPage'` | /settings/ai-chat | /settings/ai/assistant | OWNER |
| training | AiTrainingPage | `import AiTrainingPage from '@/pages/AiTrainingPage'` | /settings/ai-training | /settings/ai/training | OWNER |
| performance | AiPerformancePage | `import AiPerformancePage from '@/pages/AiPerformancePage'` | /settings/ai-performance | /settings/ai/performance | OWNER |

**internal links (ใน AiAdminPage.tsx):** `:203` → `/settings/ai/performance` · `:216` → `/settings/ai/training` · `:229` → `/settings/ai/assistant`

- [ ] **Step 1:** R4 test `ai-migration.test.tsx` (mock 5 หน้า; firstItem=admin → entry `/settings/ai/admin`; 5 redirect tests จาก oldPath). รัน → FAIL
- [ ] **Step 2:** R1 registry — import 5 หน้า + เปลี่ยน 5 item เป็น kind:'route' + **เปลี่ยน id** ตามตาราง (อัปเดต keywords ถ้ามี)
- [ ] **Step 3:** R2 App.tsx — redirect 5 path เก่า + ลบ lazy imports 5 ตัว (verify)
- [ ] **Step 4:** R3 — AiAdminPage.tsx 3 ลิงก์ (:203/:216/:229) → path ใหม่
- [ ] **Step 5:** R5 verify → R6 commit

---

## Task 4: หมวด products (pricing, stickers → route; promotions, contract-templates คง external operational)

**Files:** `settings-registry.tsx`, `App.tsx`, test `__tests__/products-migration.test.tsx`

| id | Component (default) | import | oldPath | newPath | roles |
|---|---|---|---|---|---|
| pricing | PricingTemplatesPage | `import PricingTemplatesPage from '@/pages/PricingTemplatesPage'` | /settings/pricing-templates | /settings/products/pricing | OWNER |
| stickers | StickersSettingsPage = `StickersPage` (default) | `import StickersSettingsPage from '@/pages/SettingsPage/StickersPage'` | /settings/stickers | /settings/products/stickers | OWNER |

> **คง external:** promotions (/promotions), contract-templates (/contract-templates) — operational, ห้ามแตะ

**internal links:** ไม่มี (registry only ตาม Explore)

- [ ] **Step 1:** R4 test `products-migration.test.tsx` (mock 2 หน้า; firstItem=pricing; 2 redirect tests). รัน → FAIL
- [ ] **Step 2:** R1 registry — import 2 หน้า + route. **อย่าแตะ promotions/contract-templates**
- [ ] **Step 3:** R2 App.tsx — redirect 2 path เก่า (pricing-templates, stickers) + ลบ lazy imports
- [ ] **Step 4:** R5 verify → R6 commit (ไม่มี R3 internal links)

---

## Task 5: หมวด company + access + system (รวม task เดียว — รายการน้อย, ไม่มี external ปน)

**Files:** `settings-registry.tsx`, `App.tsx`, test `__tests__/company-access-system-migration.test.tsx`

| หมวด | id | Component (default) | import | oldPath | newPath | roles |
|---|---|---|---|---|---|---|
| company | entities | CompanySettingsPage | `import CompanySettingsPage from '@/pages/CompanySettingsPage'` | /settings/companies | /settings/company/entities | OWNER |
| access | account-roles | AccountRolesPage | `import AccountRolesPage from '@/pages/AccountRolesPage'` | /settings/account-roles | /settings/access/account-roles | OWNER |
| system | integrations | IntegrationHubPage | `import IntegrationHubPage from '@/pages/IntegrationHubPage'` | /settings/integrations | /settings/system/integrations | OWNER,ACC |
| system | mdm | MdmTestPage | `import MdmTestPage from '@/pages/MdmTestPage'` | /settings/mdm-test | /settings/system/mdm | OWNER |

> **คง external (system):** audit-log (/audit-logs), system-status (/system-status) — operational. **คง external (company):** branches (/branches). **คง external (access):** users (/users).

**internal links:** ไม่มี (registry only ตาม Explore)

- [ ] **Step 1:** R4 test `company-access-system-migration.test.tsx` (mock 4 หน้า; 1 in-panel test ต่อหมวด เช่น entry `/settings/company/entities`→company-entities-page + nav "บริษัท & สาขา"; 4 redirect tests). รัน → FAIL
- [ ] **Step 2:** R1 registry — import 4 หน้า + เปลี่ยน 4 item (entities/account-roles/integrations/mdm) เป็น route. **อย่าแตะ** branches/users/audit-log/system-status
- [ ] **Step 3:** R2 App.tsx — redirect 4 path เก่า (companies, account-roles, integrations, mdm-test) + ลบ lazy imports
- [ ] **Step 4:** R5 verify → R6 commit

---

## Task 6: Verification รวม P2b

**Files:** ไม่มี (รันตรวจ)

- [ ] **Step 1:** `./tools/check-types.sh web` → 0 errors
- [ ] **Step 2:** `cd apps/web && npx vitest run src/pages/settings src/config` → เขียวทั้งหมด
- [ ] **Step 3:** grep ยืนยันไม่มี internal link ค้างที่ path เก่า (นอก redirect/comment):
  Run: `cd "/d/BESTCHOICE APP/BESTCHOICE" && grep -rn "settings/chart-of-accounts\|settings/peak-sync\|settings/e-tax-config\|settings/line-oa\|settings/line-greeting\|settings/sms-templates\|settings/channels\|settings/dunning\|settings/collections\|settings/ai-\|settings/pricing-templates\|settings/stickers\|settings/companies\|settings/account-roles\|settings/integrations\|settings/mdm-test" apps/web/src --include=*.tsx --include=*.ts | grep -v "Navigate to" | grep -v "\.test\." | grep -vE "/\*|\*/|//"`
  Expected: ไม่มี (หรือมีแต่ comment — รายงาน)
- [ ] **Step 4:** smoke ด้วยตา (ถ้ารัน dev ได้): สุ่ม 3 หน้าต่างหมวด (เช่น `/settings/accounting/chart`, `/settings/comms/sms`, `/settings/ai/admin`) → render ในpanel มี nav ซ้าย. `/settings/accounting/documents` + `/settings/comms` rich-menu → ยังเป็นลิงก์ออกเต็มจอ. bookmark เก่า (เช่น `/settings/ai-admin`) → เด้งไปใหม่

---

## Self-Review (ผู้เขียนแผนตรวจเอง)

**Spec coverage:** §5 mapping — route candidates 20 หน้า → route (Task 1-5); external 2 หน้า (document-config, rich-menu) คงไว้ ✓; operational external คงไว้ ✓. §10 P2 "ย้ายทีละหมวด + redirects + internal links" ✓. structural fix (หน้ามีแท็บ→external) → document-config + rich-menu external ✓

**Placeholder scan:** Recipe เป็น procedure ที่ใช้ร่วม (DRY) ไม่ใช่ "see Task N"; แต่ละ task มีข้อมูลครบ (id/component/export/path/roles/links) + test template + verify/commit. ไม่มี TBD. "ลบ lazy import ถ้าไม่มีที่อื่นอ้าง (verify grep)" เป็น verify-step มีคำสั่งชัด ✓

**Type consistency:** ใช้ infra P2a (`SettingsItemRoute`/`SettingsCategoryRoute`/`SettingsLayout` Outlet) ตามจริง; `kind:'route'`+`component`+`path` ตรง schema P1; ETaxConfigPage named-import ระบุชัด; ai id rename สอดคล้องทั้ง registry+links+test ✓

## Out of scope (P3, P4)
- **P3:** ยุบ sidebar settings zone เหลือ "ตั้งค่าระบบ" + กลุ่ม "จัดการ" (operational) + index settings เข้า CommandPalette + wire scroll-to-section (carry จาก P1)
- **P4:** dedup PDPA (/pdpa + #pdpa), ลบ route ซ้ำ document-config (App.tsx ComingSoon dead), ลบ SystemSettings.tsx dead code, เลิกหน้า general (กระจาย field), อัปเดต docs (accounting.md/CLAUDE.md)
- bundle optimization (registry static-imports หน้า config — ทำ dynamic ทีหลังถ้าจำเป็น)
