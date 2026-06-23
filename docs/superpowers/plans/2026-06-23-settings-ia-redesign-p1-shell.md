# Settings IA Redesign — P1 (Shell) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** สร้าง settings panel แบบ C (เมนูย่อยซ้าย + ค้นหา + มือถือ) ที่ขับด้วย registry ชุดเดียว, ย้าย 9 hub tab เดิมเข้าเป็น inline sections ใน 4 หมวด (company/access/accounting/system), redirect hash เก่า, และเลิก SettingsPage hub เดิม — โดยหน้า config อื่น (~22) ยังอยู่ที่ URL เดิม (เป็นลิงก์ใน panel) รอ P2

**Architecture:** `settingsRegistry` (config) นิยาม 8 หมวด × รายการ. `SettingsLayout` อ่าน registry → render เมนูซ้าย (กรองตาม role) + ช่องค้นหา + `CategoryPage` (generic ตัวเดียว render ทุกหมวด). รายการ `kind:'inline'` render component เป็น section; `kind:'external'` เป็นลิงก์ไป path ปัจจุบัน. P1 ไม่ย้าย URL ของหน้า route (นั่นคือ P2) — แค่ทำให้เข้าถึงผ่าน panel ได้

**Tech Stack:** React 18 + TS + Vite + react-router + Tailwind + shadcn/ui + Vitest + @testing-library/react

**Spec:** `docs/superpowers/specs/2026-06-23-settings-ia-redesign-design.md` (อ่าน §4 สถาปัตยกรรม, §5 mapping)

**Branch note:** สาขานี้ (`feat/settings-ia-redesign`) stack อยู่บน users-consolidation — `InternalControlTab` + การ์ดควบคุม 4 ตัวมีอยู่แล้ว. P1 จะ **เลิกใช้ `InternalControlTab`** (อ้างการ์ดตรงๆ จาก registry แทน)

## Global Constraints

- Frontend: design-token semantic classes เท่านั้น (ห้าม hardcoded hex / `text-gray-*` / `bg-white`); functional components + hooks; UI text ไทย; Thai ใช้ `leading-snug`
- Data fetching ใช้ react-query เท่านั้น (component เดิมทำอยู่แล้ว — ไม่แตะ internals)
- **ห้ามแตะ internals ของ tab/card components ที่มีอยู่** (CompanyTab, VatTab, ContactsTab, AttachmentTab, PeriodsTab, PeakMappingTab, OffsiteBackupTab, PdpaTab, MakerCheckerToggle, ReversePermissionCard, ReverseReasonsManagementCard, PettyCashCustodianCard, TestModeToggle) — แค่ import มา render
- **ห้ามย้าย URL ของหน้า route ใน P1** (เป็นงาน P2) — P1 อ้างเป็น `external` ไป path ปัจจุบัน
- role enum: `'OWNER' | 'FINANCE_MANAGER' | 'ACCOUNTANT'` (settings เห็นได้แค่ 3 role นี้)
- Registry คือ **source of truth เดียว** ของการมองเห็น (แก้ dead logic — ห้ามมี role gate ที่ขัดกับ registry)
- Commit ทีละ task; branch `feat/settings-ia-redesign`

---

## File Structure

- **Create** `apps/web/src/config/settings-registry.tsx` — types + registry data (8 categories). `.tsx` เพราะ import component
- **Create** `apps/web/src/config/settings-access.ts` — helper functions (role filter + search) บน registry
- **Create** `apps/web/src/pages/settings/CategoryPage.tsx` — generic หน้าหมวด (render จาก registry)
- **Create** `apps/web/src/pages/settings/SettingsLayout.tsx` — panel: เมนูซ้าย + ค้นหา + มือถือ + active category
- **Create** `apps/web/src/pages/settings/SettingsIndexRedirect.tsx` — `/settings` → หมวดแรก + map hash เก่า
- **Create** tests ข้างไฟล์ใน `__tests__/`
- **Modify** `apps/web/src/App.tsx` — route `/settings` + `/settings/:categoryId` (guard OWNER+FM+ACC), ลบ import `SettingsPage`
- **Delete** `apps/web/src/pages/SettingsPage/index.tsx` (hub เดิม) + `apps/web/src/pages/SettingsPage/__tests__/SettingsPage.test.tsx` + `apps/web/src/pages/SettingsPage/tabs/InternalControlTab.tsx` (+ test) — เนื้อหากระจายเข้า registry แล้ว

> tab component ที่เหลือ (CompanyTab ฯลฯ) **คงไว้** — registry import ไปใช้

---

## Task 1: Settings registry (types + data)

**Files:**
- Create: `apps/web/src/config/settings-registry.tsx`
- Test: `apps/web/src/config/__tests__/settings-registry.test.ts`

**Interfaces:**
- Produces: `type SettingsRole`, `type SettingsItemKind`, `interface SettingsItem`, `interface SettingsCategory`, `const settingsRegistry: SettingsCategory[]`

- [ ] **Step 1: เขียนเทส integrity ที่ fail ก่อน**

สร้าง `apps/web/src/config/__tests__/settings-registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { settingsRegistry } from '../settings-registry';

describe('settingsRegistry', () => {
  it('มี 8 หมวด id ไม่ซ้ำ', () => {
    const ids = settingsRegistry.map((c) => c.id);
    expect(ids).toHaveLength(8);
    expect(new Set(ids).size).toBe(8);
  });

  it('ทุกหมวดมีอย่างน้อย 1 รายการ + item id ไม่ซ้ำในหมวด', () => {
    for (const cat of settingsRegistry) {
      expect(cat.items.length).toBeGreaterThan(0);
      const ids = cat.items.map((i) => i.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('inline ต้องมี component, external ต้องมี path', () => {
    for (const cat of settingsRegistry) {
      for (const item of cat.items) {
        if (item.kind === 'inline') expect(item.component).toBeTruthy();
        if (item.kind === 'external') expect(item.path).toBeTruthy();
      }
    }
  });

  it('ทุก item roles เป็น subset ของ category roles', () => {
    for (const cat of settingsRegistry) {
      for (const item of cat.items) {
        for (const r of item.roles) expect(cat.roles).toContain(r);
      }
    }
  });
});
```

- [ ] **Step 2: รันให้ fail**

Run: `cd apps/web && npx vitest run src/config/__tests__/settings-registry.test.ts`
Expected: FAIL — `Cannot find module '../settings-registry'`

- [ ] **Step 3: สร้าง registry**

สร้าง `apps/web/src/config/settings-registry.tsx`:

```tsx
import type { LucideIcon } from 'lucide-react';
import { Building2, Users, BarChart3, Wallet, Smartphone, MessageSquare, Sparkles, ShieldCheck } from 'lucide-react';
// inline components (อยู่ที่เดิม — แค่ import มา render)
import { CompanyTab } from '@/pages/SettingsPage/tabs/CompanyTab';
import { ContactsTab } from '@/pages/SettingsPage/tabs/ContactsTab';
import { VatTab } from '@/pages/SettingsPage/tabs/VatTab';
import { PeriodsTab } from '@/pages/SettingsPage/tabs/PeriodsTab';
import { AttachmentTab } from '@/pages/SettingsPage/tabs/AttachmentTab';
import { PeakMappingTab } from '@/pages/SettingsPage/tabs/PeakMappingTab';
import { OffsiteBackupTab } from '@/pages/SettingsPage/tabs/OffsiteBackupTab';
import { PdpaTab } from '@/pages/SettingsPage/tabs/PdpaTab';
import { MakerCheckerToggle } from '@/pages/SettingsPage/components/MakerCheckerToggle';
import { ReversePermissionCard } from '@/pages/SettingsPage/components/ReversePermissionCard';
import { ReverseReasonsManagementCard } from '@/pages/SettingsPage/components/ReverseReasonsManagementCard';
import { PettyCashCustodianCard } from '@/pages/SettingsPage/components/PettyCashCustodianCard';
import { TestModeToggle } from '@/pages/SettingsPage/components/TestModeToggle';

export type SettingsRole = 'OWNER' | 'FINANCE_MANAGER' | 'ACCOUNTANT';
export type SettingsItemKind = 'inline' | 'route' | 'external';

export interface SettingsItem {
  id: string;
  label: string;
  keywords?: string[];
  roles: SettingsRole[];
  kind: SettingsItemKind;
  group?: string;                 // หัวข้อกลุ่มในหน้าหมวด
  component?: React.ComponentType; // kind=inline
  path?: string;                   // kind=external (path ปัจจุบัน) | kind=route (path ใหม่, P2)
}
export interface SettingsCategory {
  id: string;
  label: string;
  icon: LucideIcon;
  roles: SettingsRole[];
  items: SettingsItem[];
}

const ALL: SettingsRole[] = ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'];

export const settingsRegistry: SettingsCategory[] = [
  {
    id: 'company', label: 'บริษัท & สาขา', icon: Building2, roles: ALL,
    items: [
      { id: 'company-info', label: 'ข้อมูลบริษัท', group: 'บริษัท', roles: ['OWNER'], kind: 'inline', component: CompanyTab, keywords: ['ที่อยู่', 'โลโก้', 'ผู้เซ็น', 'tax id'] },
      { id: 'contacts', label: 'สมุดผู้ติดต่อ', group: 'บริษัท', roles: ALL, kind: 'inline', component: ContactsTab, keywords: ['ลูกค้า', 'ผู้ขาย', 'supplier'] },
      { id: 'entities', label: 'บริษัทในเครือ', group: 'บริษัท', roles: ['OWNER'], kind: 'external', path: '/settings/companies' },
      { id: 'branches', label: 'สาขา', group: 'สาขา', roles: ['OWNER'], kind: 'external', path: '/branches' },
    ],
  },
  {
    id: 'access', label: 'ผู้ใช้ & สิทธิ์', icon: Users, roles: ['OWNER'],
    items: [
      { id: 'users', label: 'ผู้ใช้ / พนักงาน', group: 'ผู้ใช้', roles: ['OWNER'], kind: 'external', path: '/users' },
      { id: 'account-roles', label: 'บัญชีตาม Role', group: 'ผู้ใช้', roles: ['OWNER'], kind: 'external', path: '/settings/account-roles' },
      { id: 'maker-checker', label: 'ระบบอนุมัติ 2 ชั้น (Maker-Checker)', group: 'การอนุมัติ & สิทธิ์', roles: ['OWNER'], kind: 'inline', component: MakerCheckerToggle, keywords: ['อนุมัติ', 'maker', 'checker'] },
      { id: 'reverse-permission', label: 'สิทธิ์กลับรายการ', group: 'การอนุมัติ & สิทธิ์', roles: ['OWNER'], kind: 'inline', component: ReversePermissionCard, keywords: ['reverse', 'กลับรายการ', 'void'] },
      { id: 'reverse-reasons', label: 'เหตุผลกลับรายการ', group: 'การอนุมัติ & สิทธิ์', roles: ['OWNER'], kind: 'inline', component: ReverseReasonsManagementCard },
      { id: 'petty-cash', label: 'ผู้ดูแลเงินสดย่อย', group: 'เงินสด', roles: ['OWNER'], kind: 'inline', component: PettyCashCustodianCard, keywords: ['petty cash', 'เงินสดย่อย'] },
      { id: 'attachment', label: 'นโยบายเอกสารแนบ', group: 'เอกสาร', roles: ['OWNER'], kind: 'inline', component: AttachmentTab, keywords: ['แนบไฟล์', 'attachment'] },
    ],
  },
  {
    id: 'accounting', label: 'บัญชี & ภาษี', icon: BarChart3, roles: ALL,
    items: [
      { id: 'vat', label: 'VAT', group: 'ภาษี', roles: ['OWNER'], kind: 'inline', component: VatTab, keywords: ['ภาษี', '7%', 'มูลค่าเพิ่ม'] },
      { id: 'periods', label: 'งวดบัญชี', group: 'บัญชี', roles: ['OWNER'], kind: 'inline', component: PeriodsTab, keywords: ['ปิดงวด', 'period'] },
      { id: 'peak-mapping', label: 'PEAK mapping', group: 'บัญชี', roles: ALL, kind: 'inline', component: PeakMappingTab, keywords: ['peak'] },
      { id: 'chart', label: 'ผังบัญชี', group: 'บัญชี', roles: ALL, kind: 'external', path: '/settings/chart-of-accounts' },
      { id: 'peak-sync', label: 'PEAK sync', group: 'บัญชี', roles: ['OWNER', 'ACCOUNTANT'], kind: 'external', path: '/settings/peak-sync' },
      { id: 'e-tax', label: 'e-Tax', group: 'ภาษี', roles: ['OWNER'], kind: 'external', path: '/settings/e-tax-config' },
      { id: 'documents', label: 'เลขที่/รูปแบบเอกสาร', group: 'บัญชี', roles: ['OWNER'], kind: 'external', path: '/settings/document-config' },
    ],
  },
  {
    id: 'finance', label: 'การเงิน & สินเชื่อ', icon: Wallet, roles: ['OWNER', 'FINANCE_MANAGER'],
    items: [
      { id: 'interest', label: 'ดอกเบี้ย', roles: ['OWNER'], kind: 'external', path: '/settings/interest-config' },
      { id: 'gfin', label: 'GFIN', roles: ['OWNER'], kind: 'external', path: '/settings/gfin-rates' },
      { id: 'payment-methods', label: 'ช่องทางชำระเงิน', roles: ['OWNER', 'FINANCE_MANAGER'], kind: 'external', path: '/settings/payment-methods' },
    ],
  },
  {
    id: 'products', label: 'สินค้า & การขาย', icon: Smartphone, roles: ['OWNER'],
    items: [
      { id: 'pricing', label: 'ตั้งราคา', roles: ['OWNER'], kind: 'external', path: '/settings/pricing-templates' },
      { id: 'stickers', label: 'สติกเกอร์ฉลาก', roles: ['OWNER'], kind: 'external', path: '/settings/stickers' },
      { id: 'promotions', label: 'โปรโมชัน', roles: ['OWNER'], kind: 'external', path: '/promotions' },
      { id: 'contract-templates', label: 'แบบสัญญา', roles: ['OWNER'], kind: 'external', path: '/contract-templates' },
    ],
  },
  {
    id: 'comms', label: 'สื่อสารลูกค้า', icon: MessageSquare, roles: ['OWNER', 'FINANCE_MANAGER'],
    items: [
      { id: 'line-oa', label: 'LINE OA', roles: ['OWNER'], kind: 'external', path: '/settings/line-oa' },
      { id: 'rich-menu', label: 'Rich Menu', roles: ['OWNER'], kind: 'external', path: '/settings/rich-menu' },
      { id: 'greeting', label: 'ข้อความทักทาย', roles: ['OWNER'], kind: 'external', path: '/settings/line-greeting' },
      { id: 'sms', label: 'SMS templates', roles: ['OWNER', 'FINANCE_MANAGER'], kind: 'external', path: '/settings/sms-templates' },
      { id: 'channels', label: 'ช่องทาง', roles: ['OWNER'], kind: 'external', path: '/settings/channels' },
      { id: 'dunning', label: 'Dunning', roles: ['OWNER'], kind: 'external', path: '/settings/dunning' },
      { id: 'collections', label: 'ตั้งค่า collections', roles: ['OWNER'], kind: 'external', path: '/settings/collections' },
    ],
  },
  {
    id: 'ai', label: 'AI', icon: Sparkles, roles: ['OWNER'],
    items: [
      { id: 'ai-admin', label: 'AI Admin', roles: ['OWNER'], kind: 'external', path: '/settings/ai-admin' },
      { id: 'ai-persona', label: 'AI Persona', roles: ['OWNER'], kind: 'external', path: '/settings/ai-persona' },
      { id: 'ai-assistant', label: 'AI Assistant', roles: ['OWNER'], kind: 'external', path: '/settings/ai-chat' },
      { id: 'ai-training', label: 'AI Training', roles: ['OWNER'], kind: 'external', path: '/settings/ai-training' },
      { id: 'ai-performance', label: 'AI Performance', roles: ['OWNER'], kind: 'external', path: '/settings/ai-performance' },
    ],
  },
  {
    id: 'system', label: 'ระบบ & ความปลอดภัย', icon: ShieldCheck, roles: ['OWNER', 'ACCOUNTANT'],
    items: [
      { id: 'test-mode', label: 'โหมดทดสอบ', group: 'ความปลอดภัย', roles: ['OWNER'], kind: 'inline', component: TestModeToggle, keywords: ['test', 'otp', '2fa', 'เครดิต'] },
      { id: 'pdpa', label: 'PDPA', group: 'ความปลอดภัย', roles: ['OWNER'], kind: 'inline', component: PdpaTab, keywords: ['pdpa', 'ข้อมูลส่วนบุคคล', 'encryption'] },
      { id: 'backup', label: 'สำรองข้อมูล', group: 'ข้อมูล', roles: ['OWNER'], kind: 'inline', component: OffsiteBackupTab, keywords: ['backup', 'สำรอง'] },
      { id: 'integrations', label: 'การเชื่อมต่อ', group: 'เชื่อมต่อ', roles: ['OWNER', 'ACCOUNTANT'], kind: 'external', path: '/settings/integrations' },
      { id: 'mdm', label: 'MDM', group: 'เชื่อมต่อ', roles: ['OWNER'], kind: 'external', path: '/settings/mdm-test' },
      { id: 'audit-log', label: 'Audit Log', group: 'ข้อมูล', roles: ['OWNER'], kind: 'external', path: '/audit-logs' },
      { id: 'system-status', label: 'System Status', group: 'ข้อมูล', roles: ['OWNER'], kind: 'external', path: '/system-status' },
    ],
  },
];
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `cd apps/web && npx vitest run src/config/__tests__/settings-registry.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/config/settings-registry.tsx apps/web/src/config/__tests__/settings-registry.test.ts
git commit -m "feat(settings): add settings registry (8 categories, source of truth)"
```

---

## Task 2: Registry access helpers (role filter + search)

**Files:**
- Create: `apps/web/src/config/settings-access.ts`
- Test: `apps/web/src/config/__tests__/settings-access.test.ts`

**Interfaces:**
- Consumes: `settingsRegistry`, `SettingsRole`, `SettingsCategory`, `SettingsItem` (Task 1)
- Produces:
  - `visibleCategories(role: SettingsRole): SettingsCategory[]`
  - `categoryById(id: string): SettingsCategory | undefined`
  - `visibleItems(cat: SettingsCategory, role: SettingsRole): SettingsItem[]`
  - `firstVisibleCategoryId(role: SettingsRole): string | undefined`
  - `searchSettings(query: string, role: SettingsRole): { category: SettingsCategory; item: SettingsItem }[]`

- [ ] **Step 1: เขียนเทสที่ fail ก่อน**

สร้าง `apps/web/src/config/__tests__/settings-access.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  visibleCategories, categoryById, visibleItems, firstVisibleCategoryId, searchSettings,
} from '../settings-access';

describe('settings-access', () => {
  it('OWNER เห็นครบ 8 หมวด', () => {
    expect(visibleCategories('OWNER').map((c) => c.id)).toHaveLength(8);
  });

  it('FINANCE_MANAGER เห็น subset ที่มี item เห็นได้ (เช่น company, accounting, finance, comms) ไม่เห็น access/ai', () => {
    const ids = visibleCategories('FINANCE_MANAGER').map((c) => c.id);
    expect(ids).toContain('company');     // contacts
    expect(ids).toContain('accounting');  // chart, peak-mapping
    expect(ids).toContain('finance');     // payment-methods
    expect(ids).not.toContain('access');  // OWNER-only items
    expect(ids).not.toContain('ai');
  });

  it('visibleItems กรองตาม role', () => {
    const acc = categoryById('accounting')!;
    const fmItems = visibleItems(acc, 'FINANCE_MANAGER').map((i) => i.id);
    expect(fmItems).toContain('chart');
    expect(fmItems).not.toContain('vat'); // OWNER-only
  });

  it('firstVisibleCategoryId คืนหมวดแรกที่ role เห็น', () => {
    expect(firstVisibleCategoryId('OWNER')).toBe('company');
    expect(firstVisibleCategoryId('FINANCE_MANAGER')).toBe('company');
  });

  it('searchSettings match label + keywords และกรอง role', () => {
    const owner = searchSettings('โหมดทดสอบ', 'OWNER');
    expect(owner.some((r) => r.item.id === 'test-mode')).toBe(true);
    // FM ไม่เห็น test-mode (OWNER-only) → ไม่อยู่ในผล
    const fm = searchSettings('โหมดทดสอบ', 'FINANCE_MANAGER');
    expect(fm.some((r) => r.item.id === 'test-mode')).toBe(false);
    // keyword match
    expect(searchSettings('otp', 'OWNER').some((r) => r.item.id === 'test-mode')).toBe(true);
  });

  it('searchSettings query ว่าง → []', () => {
    expect(searchSettings('', 'OWNER')).toEqual([]);
  });
});
```

- [ ] **Step 2: รันให้ fail**

Run: `cd apps/web && npx vitest run src/config/__tests__/settings-access.test.ts`
Expected: FAIL — `Cannot find module '../settings-access'`

- [ ] **Step 3: เขียน helpers**

สร้าง `apps/web/src/config/settings-access.ts`:

```ts
import { settingsRegistry, type SettingsRole, type SettingsCategory, type SettingsItem } from './settings-registry';

export function visibleItems(cat: SettingsCategory, role: SettingsRole): SettingsItem[] {
  return cat.items.filter((i) => i.roles.includes(role));
}

export function visibleCategories(role: SettingsRole): SettingsCategory[] {
  return settingsRegistry.filter((c) => visibleItems(c, role).length > 0);
}

export function categoryById(id: string): SettingsCategory | undefined {
  return settingsRegistry.find((c) => c.id === id);
}

export function firstVisibleCategoryId(role: SettingsRole): string | undefined {
  return visibleCategories(role)[0]?.id;
}

export function searchSettings(
  query: string,
  role: SettingsRole,
): { category: SettingsCategory; item: SettingsItem }[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: { category: SettingsCategory; item: SettingsItem }[] = [];
  for (const cat of visibleCategories(role)) {
    for (const item of visibleItems(cat, role)) {
      const hay = [item.label, ...(item.keywords ?? []), cat.label].join(' ').toLowerCase();
      if (hay.includes(q)) out.push({ category: cat, item });
    }
  }
  return out;
}
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `cd apps/web && npx vitest run src/config/__tests__/settings-access.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/config/settings-access.ts apps/web/src/config/__tests__/settings-access.test.ts
git commit -m "feat(settings): registry access helpers (role filter + search)"
```

---

## Task 3: CategoryPage (generic หน้าหมวด)

**Files:**
- Create: `apps/web/src/pages/settings/CategoryPage.tsx`
- Test: `apps/web/src/pages/settings/__tests__/CategoryPage.test.tsx`

**Interfaces:**
- Consumes: `categoryById`, `visibleItems` (Task 2); `useAuth` (`@/contexts/AuthContext`)
- Produces: `CategoryPage({ categoryId }: { categoryId: string })` — render inline items เป็น section (มี `id={item.id}` สำหรับ anchor) จัดกลุ่มตาม `group`; external items เป็นการ์ดลิงก์ (`<Link to={item.path}>`)

- [ ] **Step 1: เขียนเทสที่ fail ก่อน**

สร้าง `apps/web/src/pages/settings/__tests__/CategoryPage.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { CategoryPage } from '../CategoryPage';

let role = 'OWNER';
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role } }) }));
// mock inline components ของหมวด system ให้เบา
vi.mock('@/pages/SettingsPage/components/TestModeToggle', () => ({ TestModeToggle: () => <div>test-mode-body</div> }));
vi.mock('@/pages/SettingsPage/tabs/PdpaTab', () => ({ PdpaTab: () => <div>pdpa-body</div> }));
vi.mock('@/pages/SettingsPage/tabs/OffsiteBackupTab', () => ({ OffsiteBackupTab: () => <div>backup-body</div> }));

function renderCat(id: string) {
  return render(<MemoryRouter><CategoryPage categoryId={id} /></MemoryRouter>);
}

describe('CategoryPage', () => {
  it('render inline component sections ของหมวด (system)', () => {
    role = 'OWNER';
    renderCat('system');
    expect(screen.getByText('test-mode-body')).toBeTruthy();
    expect(screen.getByText('pdpa-body')).toBeTruthy();
    expect(screen.getByText('backup-body')).toBeTruthy();
  });

  it('render external item เป็นลิงก์', () => {
    role = 'OWNER';
    renderCat('system');
    const link = screen.getByRole('link', { name: /Audit Log/ });
    expect(link.getAttribute('href')).toBe('/audit-logs');
  });

  it('หมวดไม่รู้จัก → ข้อความว่าง ไม่ crash', () => {
    role = 'OWNER';
    renderCat('nope');
    expect(screen.getByText('ไม่พบหมวดนี้')).toBeTruthy();
  });
});
```

- [ ] **Step 2: รันให้ fail**

Run: `cd apps/web && npx vitest run src/pages/settings/__tests__/CategoryPage.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: เขียน CategoryPage**

สร้าง `apps/web/src/pages/settings/CategoryPage.tsx`:

```tsx
import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { categoryById, visibleItems } from '@/config/settings-access';
import type { SettingsItem, SettingsRole } from '@/config/settings-registry';

const groupLabelClass = 'text-xs font-semibold uppercase tracking-wide text-muted-foreground leading-snug';

function ItemSection({ item }: { item: SettingsItem }) {
  if (item.kind === 'inline' && item.component) {
    const C = item.component;
    return (
      <div id={item.id} className="scroll-mt-20">
        <C />
      </div>
    );
  }
  // external / route(P1=ลิงก์)
  return (
    <Link
      to={item.path ?? '#'}
      className="flex items-center justify-between rounded-xl border border-border/60 bg-card p-4 hover:bg-accent transition-colors"
    >
      <span className="text-sm font-medium text-foreground leading-snug">{item.label}</span>
      <ChevronRight className="size-4 text-muted-foreground" />
    </Link>
  );
}

export function CategoryPage({ categoryId }: { categoryId: string }) {
  const { user } = useAuth();
  const role = (user?.role ?? '') as SettingsRole;
  const cat = categoryById(categoryId);
  if (!cat) return <p className="text-sm text-muted-foreground">ไม่พบหมวดนี้</p>;

  const items = visibleItems(cat, role);
  // จัดกลุ่มตาม group (รักษาลำดับการประกาศ)
  const groups: { name: string | undefined; items: SettingsItem[] }[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.name === item.group) last.items.push(item);
    else groups.push({ name: item.group, items: [item] });
  }

  return (
    <div className="space-y-6">
      {groups.map((g, gi) => (
        <section key={g.name ?? gi} className="space-y-4">
          {g.name && <h3 className={groupLabelClass}>{g.name}</h3>}
          {g.items.map((item) => (
            <ItemSection key={item.id} item={item} />
          ))}
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `cd apps/web && npx vitest run src/pages/settings/__tests__/CategoryPage.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/settings/CategoryPage.tsx apps/web/src/pages/settings/__tests__/CategoryPage.test.tsx
git commit -m "feat(settings): generic registry-driven CategoryPage"
```

---

## Task 4: SettingsLayout (เมนูซ้าย + ค้นหา + มือถือ)

**Files:**
- Create: `apps/web/src/pages/settings/SettingsLayout.tsx`
- Test: `apps/web/src/pages/settings/__tests__/SettingsLayout.test.tsx`

**Interfaces:**
- Consumes: `visibleCategories`, `visibleItems`, `searchSettings`, `categoryById` (Task 2); `CategoryPage` (Task 3); `useAuth`; `useIsMobile` (`@/hooks/useIsMobile`); `useParams`, `useNavigate` (react-router)
- Produces: `SettingsLayout()` — อ่าน `:categoryId` จาก params; desktop = sidebar nav (หมวด + count) + CategoryPage; mobile = `<select>` หมวด + CategoryPage; ช่องค้นหาด้านบน

- [ ] **Step 1: เขียนเทสที่ fail ก่อน**

สร้าง `apps/web/src/pages/settings/__tests__/SettingsLayout.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { SettingsLayout } from '../SettingsLayout';

let role = 'OWNER';
let mobile = false;
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role } }) }));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => mobile }));
// CategoryPage ตัวจริงจะ render inline components — mock ให้เบา
vi.mock('../CategoryPage', () => ({ CategoryPage: ({ categoryId }: { categoryId: string }) => <div>cat:{categoryId}</div> }));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/settings/:categoryId" element={<SettingsLayout />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SettingsLayout', () => {
  beforeEach(() => { role = 'OWNER'; mobile = false; });

  it('desktop: เมนูซ้ายแสดงหมวดที่ role เห็น + render หมวดที่ active', () => {
    renderAt('/settings/system');
    expect(screen.getByRole('link', { name: /ระบบ & ความปลอดภัย/ })).toBeTruthy();
    expect(screen.getByText('cat:system')).toBeTruthy();
  });

  it('FM เห็นเฉพาะหมวดของตัวเอง (ไม่มี AI)', () => {
    role = 'FINANCE_MANAGER';
    renderAt('/settings/company');
    expect(screen.queryByRole('link', { name: /^AI$/ })).toBeNull();
  });

  it('mobile: render <select> หมวดแทน sidebar', () => {
    mobile = true;
    renderAt('/settings/company');
    expect(screen.getByRole('combobox')).toBeTruthy();
  });

  it('มีช่องค้นหา', () => {
    renderAt('/settings/company');
    expect(screen.getByPlaceholderText(/ค้นหา/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: รันให้ fail**

Run: `cd apps/web && npx vitest run src/pages/settings/__tests__/SettingsLayout.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: เขียน SettingsLayout**

สร้าง `apps/web/src/pages/settings/SettingsLayout.tsx`:

```tsx
import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import { Search } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import PageHeader from '@/components/ui/PageHeader';
import { visibleCategories, visibleItems, searchSettings } from '@/config/settings-access';
import type { SettingsRole } from '@/config/settings-registry';
import { CategoryPage } from './CategoryPage';

export function SettingsLayout() {
  useDocumentTitle('ตั้งค่าระบบ');
  const { user } = useAuth();
  const role = (user?.role ?? '') as SettingsRole;
  const { categoryId = '' } = useParams<{ categoryId: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [query, setQuery] = useState('');

  const cats = visibleCategories(role);
  const results = searchSettings(query, role);

  return (
    <div>
      <PageHeader title="ตั้งค่าระบบ" subtitle="กำหนดพารามิเตอร์การทำงานของระบบ" />

      {/* search */}
      <div className="relative mb-4 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ค้นหาการตั้งค่า…"
          className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm"
        />
        {results.length > 0 && (
          <div className="absolute z-20 mt-1 w-full rounded-lg border border-border bg-popover shadow-md">
            {results.slice(0, 8).map(({ category, item }) => (
              <button
                key={`${category.id}/${item.id}`}
                onClick={() => { setQuery(''); navigate(`/settings/${category.id}#${item.id}`); }}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
              >
                <span className="text-foreground">{item.label}</span>
                <span className="text-xs text-muted-foreground">{category.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {isMobile ? (
        <div className="space-y-4">
          <select
            value={categoryId}
            onChange={(e) => navigate(`/settings/${e.target.value}`)}
            className="w-full rounded-lg border border-border bg-background py-2 px-3 text-sm"
            aria-label="เลือกหมวดตั้งค่า"
          >
            {cats.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
          <CategoryPage categoryId={categoryId} />
        </div>
      ) : (
        <div className="flex gap-6">
          <nav className="w-60 shrink-0 space-y-1">
            {cats.map((c) => {
              const active = c.id === categoryId;
              const Icon = c.icon;
              return (
                <Link
                  key={c.id}
                  to={`/settings/${c.id}`}
                  className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
                    active ? 'bg-accent font-semibold text-foreground' : 'text-muted-foreground hover:bg-accent/60'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Icon className="size-4" />
                    {c.label}
                  </span>
                  <span className="text-xs text-muted-foreground">{visibleItems(c, role).length}</span>
                </Link>
              );
            })}
          </nav>
          <div className="min-w-0 flex-1">
            <CategoryPage categoryId={categoryId} />
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `cd apps/web && npx vitest run src/pages/settings/__tests__/SettingsLayout.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/settings/SettingsLayout.tsx apps/web/src/pages/settings/__tests__/SettingsLayout.test.tsx
git commit -m "feat(settings): SettingsLayout panel (sub-nav + search + mobile)"
```

---

## Task 5: SettingsIndexRedirect (`/settings` → หมวดแรก + map hash เก่า)

**Files:**
- Create: `apps/web/src/pages/settings/SettingsIndexRedirect.tsx`
- Test: `apps/web/src/pages/settings/__tests__/SettingsIndexRedirect.test.tsx`

**Interfaces:**
- Consumes: `firstVisibleCategoryId` (Task 2); `useAuth`
- Produces: `SettingsIndexRedirect()` — render null; effect: ถ้ามี hash เก่า → `replace` ไป `/settings/<mapped>#<hash>`; ไม่งั้น → `/settings/<firstVisibleCategoryId>`. ใช้ `HASH_TO_CATEGORY` map (export ด้วยเพื่อเทส)

- [ ] **Step 1: เขียนเทสที่ fail ก่อน**

สร้าง `apps/web/src/pages/settings/__tests__/SettingsIndexRedirect.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { HASH_TO_CATEGORY } from '../SettingsIndexRedirect';

describe('HASH_TO_CATEGORY', () => {
  it('map hash tab เก่าครบทุกตัว → หมวดใหม่', () => {
    expect(HASH_TO_CATEGORY).toMatchObject({
      contacts: 'company',
      company: 'company',
      vat: 'accounting',
      periods: 'accounting',
      'peak-mapping': 'accounting',
      attachment: 'access',
      'internal-control': 'access',
      users: 'access',
      'offsite-backup': 'system',
      pdpa: 'system',
    });
  });
});
```

> หมายเหตุ: เทส redirect navigation จริงทำใน Task 7 (ต้องมี router). Task นี้เทสแค่ map.

- [ ] **Step 2: รันให้ fail**

Run: `cd apps/web && npx vitest run src/pages/settings/__tests__/SettingsIndexRedirect.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: เขียน SettingsIndexRedirect**

สร้าง `apps/web/src/pages/settings/SettingsIndexRedirect.tsx`:

```tsx
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '@/contexts/AuthContext';
import { firstVisibleCategoryId } from '@/config/settings-access';
import type { SettingsRole } from '@/config/settings-registry';

// hash tab เดิม (#vat ฯลฯ) → หมวดใหม่. item id ที่ตรงกับ hash จะถูกใช้ anchor ต่อ
export const HASH_TO_CATEGORY: Record<string, string> = {
  contacts: 'company',
  company: 'company',
  vat: 'accounting',
  periods: 'accounting',
  'peak-mapping': 'accounting',
  attachment: 'access',
  'internal-control': 'access',
  users: 'access',
  'offsite-backup': 'system',
  pdpa: 'system',
};

export function SettingsIndexRedirect() {
  const { user } = useAuth();
  const role = (user?.role ?? '') as SettingsRole;
  const navigate = useNavigate();

  useEffect(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash.slice(1) : '';
    const mapped = HASH_TO_CATEGORY[hash];
    if (mapped) {
      // คง hash เป็น anchor ไปยัง section (item id ที่ตรงกับ hash ถ้ามี)
      navigate(`/settings/${mapped}#${hash}`, { replace: true });
      return;
    }
    const first = firstVisibleCategoryId(role);
    if (first) navigate(`/settings/${first}`, { replace: true });
  }, [role, navigate]);

  return null;
}
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `cd apps/web && npx vitest run src/pages/settings/__tests__/SettingsIndexRedirect.test.tsx`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/settings/SettingsIndexRedirect.tsx apps/web/src/pages/settings/__tests__/SettingsIndexRedirect.test.tsx
git commit -m "feat(settings): /settings index redirect + old-hash mapping"
```

---

## Task 6: Routing + guard + decommission old hub

**Files:**
- Modify: `apps/web/src/App.tsx` (route `/settings` + `/settings/:categoryId`)
- Delete: `apps/web/src/pages/SettingsPage/index.tsx`, `apps/web/src/pages/SettingsPage/__tests__/SettingsPage.test.tsx`, `apps/web/src/pages/SettingsPage/tabs/InternalControlTab.tsx`, `apps/web/src/pages/SettingsPage/tabs/__tests__/InternalControlTab.test.tsx`

**Interfaces:**
- Consumes: `SettingsLayout` (Task 4), `SettingsIndexRedirect` (Task 5)
- Produces: routes `/settings` (index redirect) + `/settings/:categoryId` (panel), guard `['OWNER','FINANCE_MANAGER','ACCOUNTANT']`

- [ ] **Step 1: หา import + route เดิมใน App.tsx**

หาบรรทัด lazy import ของ `SettingsPage` (เช่น `const SettingsPage = lazy(() => import('./pages/SettingsPage'))`) และ route block ที่ App.tsx:762-769 (path `/settings`, roles OWNER, element `<SettingsPage />`).

- [ ] **Step 2: เพิ่ม lazy import ของ panel + ลบ import เดิม**

ลบบรรทัด import `SettingsPage` เดิม. เพิ่ม:

```tsx
const SettingsLayout = lazy(() =>
  import('./pages/settings/SettingsLayout').then((m) => ({ default: m.SettingsLayout })),
);
const SettingsIndexRedirect = lazy(() =>
  import('./pages/settings/SettingsIndexRedirect').then((m) => ({ default: m.SettingsIndexRedirect })),
);
```

- [ ] **Step 3: แทน route `/settings` block (App.tsx:762-769)**

แทนด้วย:

```tsx
          <Route
            path="/settings"
            element={
              <ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
                <SettingsIndexRedirect />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings/:categoryId"
            element={
              <ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}>
                <SettingsLayout />
              </ProtectedRoute>
            }
          />
```

> หมายเหตุ: route `/settings/:categoryId` ต้องอยู่ **หลัง** route `/settings/*` ที่เจาะจง (เช่น `/settings/interest-config`, `/settings/companies`) ใน App.tsx มิฉะนั้น `:categoryId` จะดักจับ path เจาะจงพวกนั้น. react-router v6+ จัดลำดับ specificity ให้เอง (static segment ชนะ dynamic) แต่ให้ verify ว่า `/settings/interest-config` ยังเข้าหน้าเดิมได้หลังแก้ (Step 6).

- [ ] **Step 4: ลบไฟล์ hub เดิม**

```bash
git rm apps/web/src/pages/SettingsPage/index.tsx \
       apps/web/src/pages/SettingsPage/__tests__/SettingsPage.test.tsx \
       apps/web/src/pages/SettingsPage/tabs/InternalControlTab.tsx \
       apps/web/src/pages/SettingsPage/tabs/__tests__/InternalControlTab.test.tsx
```

- [ ] **Step 5: เขียนเทส routing (guard + redirect + category render)**

สร้าง `apps/web/src/pages/settings/__tests__/settings-routing.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { SettingsIndexRedirect } from '../SettingsIndexRedirect';
import { SettingsLayout } from '../SettingsLayout';

let role = 'OWNER';
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role } }) }));
vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('../CategoryPage', () => ({ CategoryPage: ({ categoryId }: { categoryId: string }) => <div>cat:{categoryId}</div> }));

function App({ entry }: { entry: string }) {
  return (
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/settings" element={<SettingsIndexRedirect />} />
        <Route path="/settings/:categoryId" element={<SettingsLayout />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('settings routing', () => {
  beforeEach(() => { role = 'OWNER'; window.location.hash = ''; });

  it('/settings → redirect ไปหมวดแรก (company)', async () => {
    render(<App entry="/settings" />);
    await waitFor(() => expect(screen.getByText('cat:company')).toBeTruthy());
  });

  it('/settings/system → render หมวด system', () => {
    render(<App entry="/settings/system" />);
    expect(screen.getByText('cat:system')).toBeTruthy();
  });
});
```

- [ ] **Step 6: รันเทส + type-check + verify path เจาะจงไม่พัง**

Run: `cd apps/web && npx vitest run src/pages/settings`
Expected: PASS ทุกไฟล์ใน settings

Run: `./tools/check-types.sh web`
Expected: 0 errors (ไม่มี reference `SettingsPage`/`InternalControlTab` ค้าง)

ตรวจด้วยตา (ถ้ารัน dev ได้): `/settings/interest-config` ยังเข้าหน้าเดิม (ไม่ถูก `:categoryId` ดัก), `/settings` เด้งไป `/settings/company`, `/settings#vat` เด้งไป `/settings/accounting`

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/App.tsx
git commit -m "feat(settings): wire panel routes + relax guard (OWNER/FM/ACC), remove old hub"
```

---

## Task 7: Verification รวม

**Files:** ไม่มี (รันตรวจ)

- [ ] **Step 1: type-check ทั้ง web**

Run: `./tools/check-types.sh web`
Expected: 0 errors

- [ ] **Step 2: รันเทส settings + registry/config ทั้งหมด**

Run: `cd apps/web && npx vitest run src/pages/settings src/config`
Expected: PASS ทั้งหมด

- [ ] **Step 3: grep หา reference ค้างของ hub เดิม**

Run: `cd "/d/BESTCHOICE APP/BESTCHOICE" && grep -rn "pages/SettingsPage/index\|tabs/InternalControlTab\|from '@/pages/SettingsPage'" apps/web/src || echo "clean"`
Expected: `clean` (ไม่มี import ค้าง — tab components ที่เหลือ import เป็นไฟล์ย่อย ไม่ผ่าน index)

- [ ] **Step 4: smoke ด้วยตา (ถ้ารัน dev ได้)**

OWNER: `/settings` → company; เมนูซ้าย 8 หมวด; คลิก system → เห็นโหมดทดสอบ/PDPA/backup; ค้นหา "vat" → กระโดดไป accounting; ลองมือถือ (จอแคบ) → เมนูเป็น dropdown.
FM: เข้า `/settings` ได้ (ไม่ 403), เห็นเฉพาะหมวดของตัวเอง.
`/settings#internal-control` (bookmark เก่า) → /settings/access.

---

## Self-Review (ผู้เขียนแผนตรวจเอง)

**Spec coverage (P1 ส่วน):**
- §4.1 registry → Task 1 ✓ · §4.5 role filter (แก้ dead logic) → Task 2 ✓
- §4.2 SettingsLayout (sub-nav+search+mobile) → Task 4 ✓ · §4.4 search → Task 2+4 ✓
- §4.3 routes + guard relax (OWNER+FM+ACC) → Task 6 ✓
- §5 inline items (company/access/accounting/system) เข้า panel → Task 1+3 ✓; route items = external link (P1) ✓
- §6 hash redirect → Task 5+6 ✓
- §10 P1 scope (shell + inline + hash redirect, เลิก hub เดิม) → ครบ ✓
- (P2 route migration / P3 sidebar / P4 cleanup = แผนแยกภายหลัง — นอก P1)

**Placeholder scan:** ไม่มี TBD/โค้ดลอย — ทุก step มีโค้ด/คำสั่งจริง ✓

**Type consistency:** `SettingsRole/SettingsItem/SettingsCategory` (Task 1) ใช้ตรงกันทุก task; helper signatures (Task 2) ตรงกับที่ Task 3/4/5 เรียก (`visibleCategories`, `visibleItems`, `searchSettings`, `firstVisibleCategoryId`, `categoryById`); `CategoryPage({categoryId})` (Task 3) เรียกตรงกันใน Task 4; `HASH_TO_CATEGORY` (Task 5) ✓

## Out of scope (เฟสถัดไป — แผนแยก)
- **P2**: ย้าย ~22 route page → `/settings/<cat>/<item>` + redirects + แก้ internal links (ทำทีละหมวด); หน้าที่มีแท็บในตัว (document-config ฯลฯ) → external เต็มจอ
- **P3**: ยุบ sidebar เหลือ "ตั้งค่าระบบ" + กลุ่ม "จัดการ" (operational) + index settings เข้า CommandPalette
- **P4**: dedup PDPA (`/pdpa` + `#pdpa`), ลบ route ซ้ำ document-config, เลิกหน้า general, ลบ dead code
