# SP1 — Sidebar P6 + Zone Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace BESTCHOICE sidebar with P6 (Hybrid 2 Pills + Gear) — เพิ่ม zone-aware navigation (หน้าร้าน/ไฟแนนซ์/ตั้งค่ากลาง) + placeholder pages สำหรับ 10+ หน้าที่ยังไม่มี

**Architecture:** Frontend-only. Add `Zone` type + `RoleZoneConfig` shape to `menu.ts`. Add `currentZone` to LayoutContext with URL/localStorage persistence. Sidebar.tsx renders PillSwitcher + GearButton + filters sections by zone. Cross-zone deep links auto-switch pill or redirect to /403 if role lacks access.

**Tech Stack:** React 18 + TypeScript + Vite + react-router + Zustand-free Context API + Vitest + Playwright + Tailwind CSS + lucide-react icons (NO emoji in code)

**Source spec:** `docs/superpowers/specs/2026-05-17-sidebar-sp1-zone-mapping-design.md`

---

## File Structure

**Files to Create:**
- `apps/web/src/config/menu.test.ts` — vitest for `getSidebarForRole`
- `apps/web/src/components/layout/LayoutContext.test.tsx` — vitest for zone persistence
- `apps/web/src/components/layout/PillSwitcher.tsx` — extracted component (keeps Sidebar.tsx readable)
- `apps/web/src/components/layout/GearButton.tsx` — extracted component
- `apps/web/src/components/ComingSoonPage.tsx` — placeholder page
- `apps/web/src/components/ComingSoonPage.test.tsx` — vitest
- `apps/web/e2e/sidebar-zones.spec.ts` — Playwright E2E

**Files to Modify:**
- `apps/web/src/config/menu.ts` — add Zone types, rewrite 5 role configs
- `apps/web/src/components/layout/LayoutContext.tsx` — add `currentZone` + persistence
- `apps/web/src/components/layout/Sidebar.tsx` — consume zone ctx, render pills/gear
- `apps/web/src/components/layout/MobileBottomNav.tsx` — zone-aware items
- `apps/web/src/components/layout/MainLayout.tsx` — zone auto-sync + cross-zone guard
- `apps/web/src/App.tsx` — register 10+ placeholder routes

**Each PR commit boundary:** after task group completes + tests green + types green.

---

## PR-1 — Schema Foundation (no behavior change)

### Task 1: Add Zone types to menu.ts

**Files:**
- Modify: `apps/web/src/config/menu.ts`

- [ ] **Step 1: Add type exports at top of menu.ts**

Open `apps/web/src/config/menu.ts`, after the `MenuBadgeKey` type definition (line ~55), add:

```ts
/** Logical zone — sidebar splits navigation into these contexts */
export type Zone = 'shop' | 'fin' | 'settings';

/** Hint shown on placeholder pages so users see which SP will deliver it */
export interface PlaceholderInfo {
  trackingSP: 'SP2' | 'SP3' | 'SP4' | 'SP5' | 'SP6';
  trackingIssueUrl?: string;
  eta?: string;
}
```

- [ ] **Step 2: Extend MenuItem with placeholder field**

In the existing `MenuItem` interface, add the optional `placeholder` field:

```ts
export interface MenuItem {
  label: string;
  path: string;
  icon: LucideIcon;
  children?: MenuItem[];
  badgeKey?: MenuBadgeKey;
  placeholder?: PlaceholderInfo;  // ← new
}
```

- [ ] **Step 3: Extend MenuSection with zone field**

```ts
export interface MenuSection {
  key: string;
  label: string;
  icon: LucideIcon;
  zone: Zone;                       // ← new
  items: MenuItem[];
}
```

- [ ] **Step 4: Add RoleZoneConfig interface (alongside existing RoleMenuConfig)**

Keep `RoleMenuConfig` for backwards compat. Add new interface:

```ts
export interface RoleZoneConfig {
  /** Pills visible to this role (1 zone → no pill switcher) */
  zones: Zone[];
  /** Default zone if no URL/localStorage value */
  defaultZone: Zone;
  /** Show gear (Settings) icon? */
  showSettingsGear: boolean;
  /** All sections across all zones — filtered at render */
  sections: MenuSection[];
  /** BottomNav items per zone */
  bottomNav: Record<Zone, BottomNavItem[]>;
}
```

- [ ] **Step 5: Run TypeScript check to verify schema compiles**

Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh web`
Expected: 0 errors (we haven't used the new types yet — just added the shapes)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/config/menu.ts
git commit -m "feat(sidebar): add Zone + RoleZoneConfig types (no behavior change)"
```

---

### Task 2: Add `getSidebarForRole` helper + role config map (still no UI consumption)

**Files:**
- Modify: `apps/web/src/config/menu.ts`

- [ ] **Step 1: Add helper at bottom of menu.ts (above `isChatVisibleForRole`)**

```ts
/** Map of role → new zone-aware config. Built incrementally in Task 8. */
const ZONE_CONFIG: Record<string, RoleZoneConfig> = {};

/**
 * Filter sections for the role's current zone.
 * Returns empty array if role/zone combo invalid (caller handles fallback).
 */
export function getSidebarForRole(role: string, currentZone: Zone): MenuSection[] {
  const config = ZONE_CONFIG[role];
  if (!config) return [];
  if (!config.zones.includes(currentZone) && currentZone !== 'settings') return [];
  if (currentZone === 'settings' && !config.showSettingsGear) return [];
  return config.sections.filter((s) => s.zone === currentZone);
}

/** Returns the RoleZoneConfig for a role (or undefined). Used by Sidebar to check pills/gear visibility. */
export function getZoneConfigForRole(role: string): RoleZoneConfig | undefined {
  return ZONE_CONFIG[role];
}
```

- [ ] **Step 2: Run type check**

Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh web`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/config/menu.ts
git commit -m "feat(sidebar): add getSidebarForRole + getZoneConfigForRole helpers"
```

---

### Task 3: Write Vitest for helpers (with empty ZONE_CONFIG, helpers return empty)

**Files:**
- Create: `apps/web/src/config/menu.test.ts`

- [ ] **Step 1: Write failing test for empty ZONE_CONFIG behavior**

Create `apps/web/src/config/menu.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getSidebarForRole, getZoneConfigForRole } from './menu';

describe('getSidebarForRole — empty ZONE_CONFIG fallback', () => {
  it('returns empty array for unknown role', () => {
    expect(getSidebarForRole('UNKNOWN_ROLE', 'shop')).toEqual([]);
  });

  it('returns undefined zone config for unknown role', () => {
    expect(getZoneConfigForRole('UNKNOWN_ROLE')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it passes (config is empty so no-config branch fires)**

Run: `cd apps/web && npx vitest run src/config/menu.test.ts`
Expected: PASS (2/2)

- [ ] **Step 3: Commit + open PR-1**

```bash
git add apps/web/src/config/menu.test.ts
git commit -m "test(sidebar): cover empty ZONE_CONFIG fallback"
git push -u origin <branch>
gh pr create --title "feat(sidebar): SP1 PR-1 — Zone schema foundation" --body "$(cat <<'EOF'
## Summary
- Add \`Zone\`, \`PlaceholderInfo\`, \`RoleZoneConfig\` types
- Add \`getSidebarForRole\` + \`getZoneConfigForRole\` helpers
- Empty \`ZONE_CONFIG\` map (populated in PR-3)
- Schema-only — no UI consumes new types yet, no behavior change

## Test plan
- [x] \`./tools/check-types.sh web\` → 0 errors
- [x] \`npx vitest run src/config/menu.test.ts\` → 2/2 pass

Part of SP1 (5 PRs). See: docs/superpowers/specs/2026-05-17-sidebar-sp1-zone-mapping-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## PR-2 — LayoutContext Zone State

### Task 4: Add `currentZone` state to LayoutContext

**Files:**
- Modify: `apps/web/src/components/layout/LayoutContext.tsx`

- [ ] **Step 1: Import Zone type at top of file**

```ts
import { createContext, ReactNode, useContext, useState, useCallback, useEffect } from 'react';
import type { Zone } from '@/config/menu';
```

- [ ] **Step 2: Extend LayoutState interface**

```ts
interface LayoutState {
  sidebarCollapse: boolean;
  setSidebarCollapse: (collapse: boolean) => void;
  mobileSidebarOpen: boolean;
  setMobileSidebarOpen: (open: boolean) => void;
  currentZone: Zone;                            // ← new
  setCurrentZone: (zone: Zone) => void;         // ← new
}
```

- [ ] **Step 3: Add zone state with persistence logic in LayoutProvider**

Add inside `LayoutProvider` body, before the existing `setSidebarCollapse` definition:

```ts
const [currentZone, setCurrentZoneState] = useState<Zone>(() => {
  try {
    // Priority 1: URL ?zone=
    const url = new URL(window.location.href);
    const urlZone = url.searchParams.get('zone');
    if (urlZone === 'shop' || urlZone === 'fin' || urlZone === 'settings') {
      return urlZone;
    }
    // Priority 2: localStorage
    const saved = localStorage.getItem('bc.sidebar.lastZone');
    if (saved === 'shop' || saved === 'fin' || saved === 'settings') {
      return saved;
    }
  } catch { /* ignore */ }
  // Priority 3: default (Sidebar overrides via role default on first render)
  return 'shop';
});

const setCurrentZone = useCallback((zone: Zone) => {
  setCurrentZoneState(zone);
  try {
    localStorage.setItem('bc.sidebar.lastZone', zone);
    const url = new URL(window.location.href);
    url.searchParams.set('zone', zone);
    window.history.replaceState({}, '', url.toString());
  } catch { /* ignore */ }
}, []);
```

- [ ] **Step 4: Wire into provider value**

Update the Provider `value={{...}}` block to include the new fields:

```tsx
value={{
  sidebarCollapse,
  setSidebarCollapse,
  mobileSidebarOpen,
  setMobileSidebarOpen,
  currentZone,
  setCurrentZone,
}}
```

- [ ] **Step 5: Run TypeScript check**

Run: `cd /Users/iamnaii/Desktop/App/BESTCHOICE && ./tools/check-types.sh web`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/layout/LayoutContext.tsx
git commit -m "feat(sidebar): add currentZone state with URL/localStorage persistence"
```

---

### Task 5: Test zone persistence priority

**Files:**
- Create: `apps/web/src/components/layout/LayoutContext.test.tsx`

- [ ] **Step 1: Write failing tests for persistence priority**

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { LayoutProvider, useLayout } from './LayoutContext';
import type { ReactNode } from 'react';

const wrapper = ({ children }: { children: ReactNode }) => (
  <LayoutProvider>{children}</LayoutProvider>
);

describe('LayoutContext currentZone persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('defaults to "shop" when no URL and no localStorage', () => {
    const { result } = renderHook(() => useLayout(), { wrapper });
    expect(result.current.currentZone).toBe('shop');
  });

  it('reads from URL ?zone= first (priority 1)', () => {
    window.history.replaceState({}, '', '/?zone=fin');
    localStorage.setItem('bc.sidebar.lastZone', 'shop');
    const { result } = renderHook(() => useLayout(), { wrapper });
    expect(result.current.currentZone).toBe('fin');
  });

  it('falls back to localStorage when URL has no ?zone= (priority 2)', () => {
    localStorage.setItem('bc.sidebar.lastZone', 'fin');
    const { result } = renderHook(() => useLayout(), { wrapper });
    expect(result.current.currentZone).toBe('fin');
  });

  it('setCurrentZone updates state + localStorage + URL', () => {
    const { result } = renderHook(() => useLayout(), { wrapper });
    act(() => result.current.setCurrentZone('fin'));
    expect(result.current.currentZone).toBe('fin');
    expect(localStorage.getItem('bc.sidebar.lastZone')).toBe('fin');
    expect(new URL(window.location.href).searchParams.get('zone')).toBe('fin');
  });

  it('ignores invalid zone in URL', () => {
    window.history.replaceState({}, '', '/?zone=invalid');
    const { result } = renderHook(() => useLayout(), { wrapper });
    expect(result.current.currentZone).toBe('shop');
  });
});
```

- [ ] **Step 2: Run test — expect FAIL on first run if any logic missed**

Run: `cd apps/web && npx vitest run src/components/layout/LayoutContext.test.tsx`
Expected: PASS (5/5) — implementation from Task 4 should make them green

- [ ] **Step 3: Commit + open PR-2**

```bash
git add apps/web/src/components/layout/LayoutContext.test.tsx
git commit -m "test(sidebar): cover currentZone persistence priority"
git push
gh pr create --title "feat(sidebar): SP1 PR-2 — LayoutContext zone state + persistence" --body "$(cat <<'EOF'
## Summary
- Add \`currentZone\` + \`setCurrentZone\` to LayoutContext
- Priority: URL ?zone= > localStorage[bc.sidebar.lastZone] > default 'shop'
- setCurrentZone updates state + localStorage + URL (replaceState, no history pollution)
- No UI consumes ctx yet — Sidebar wiring in PR-3

## Test plan
- [x] 5 vitest cases pass (priorities + setter + invalid zone)
- [x] Type check 0 errors

Part of SP1 (5 PRs). Stack on top of PR-1.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## PR-3 — Sidebar Rewrite + PillSwitcher + GearButton

### Task 6: Build the full ZONE_CONFIG map (all 5 roles)

**Files:**
- Modify: `apps/web/src/config/menu.ts`

- [ ] **Step 1: Add zone tag to every existing MenuSection**

For each existing const (`SALES_CONFIG`, `BRANCH_MANAGER_CONFIG`, etc.), add `zone: 'shop'` or `zone: 'fin'` to each section per spec §3. Example for SALES_CONFIG:

```ts
const SALES_CONFIG: RoleMenuConfig = {
  sidebar: [
    {
      key: 'sales-work',
      label: 'ขาย',
      icon: ShoppingCart,
      zone: 'shop',                  // ← add
      items: [/* ...existing... */],
    },
    {
      key: 'sales-contracts',
      label: 'สัญญา & ชำระ',
      icon: FileCheck,
      zone: 'shop',                  // ← add (payments shows in SHOP for SALES)
      items: [/* ...existing... */],
    },
    {
      key: 'sales-tools',
      label: 'เครื่องมือ',
      icon: Warehouse,
      zone: 'shop',                  // ← add
      items: [/* ...existing... */],
    },
  ],
  bottomNav: [/* ...existing... */],
};
```

Apply the same to BRANCH_MANAGER_CONFIG (mark sections per spec §3), FINANCE_MANAGER_CONFIG (some `'shop'`, some `'fin'`), ACCOUNTANT_CONFIG (all `'fin'`), OWNER_CONFIG (mix shop/fin/settings).

Reference for OWNER zone tagging per spec §3:
- `owner-overview` → `'shop'`
- `owner-inventory` → `'shop'`
- `owner-sales` → `'shop'`
- `owner-collection` → `'shop'`  (ติดตามหนี้ is shared, default to SHOP for OWNER per spec preference)
- `owner-accounting` → `'fin'`
- `assetMenuSection` (in OWNER) → `'fin'` (assets are FIN per spec §3.2)
- `owner-online-shop` → `'shop'`
- `owner-marketing` → `'shop'`
- `owner-settings` → `'settings'`
- `owner-tools` → split — `/chat` and `/audit-logs` → `'shop'`/`'settings'` per item. Move chat+MDM out into separate SHOP section; keep AI+integrations+LINE OA+Dunning under `'fin'` zone (per spec §3.2 it's FIN tools); audit-logs → `'settings'`. **Reorganize OWNER tools section into two sections** (one zone=fin, one zone=settings).

- [ ] **Step 2: Build placeholder MenuSection rows for missing pages (per spec §3)**

Add new section blocks for placeholder items. Example for OWNER FIN zone:

```ts
{
  key: 'owner-tax',
  label: 'ภาษี',
  icon: Calculator,
  zone: 'fin',
  items: [
    {
      label: 'VAT (ภ.พ.30)',
      path: '/finance/vat',
      icon: Receipt,
      placeholder: { trackingSP: 'SP3', eta: 'ภายในไตรมาส 3/2026' },
    },
    {
      label: 'WHT (ภ.ง.ด. 1/3/53)',
      path: '/finance/wht',
      icon: Receipt,
      placeholder: { trackingSP: 'SP3', eta: 'ภายในไตรมาส 3/2026' },
    },
    {
      label: 'e-Tax Invoice',
      path: '/finance/e-tax',
      icon: FileText,
      placeholder: { trackingSP: 'SP3', eta: 'ภายในไตรมาส 3/2026' },
    },
    { label: 'รายงานภาษี (legacy)', path: '/tax-reports', icon: Calculator },
  ],
}
```

Repeat for: `owner-statements` (Cash Flow + Equity placeholders, SP2), `owner-bank` (Bank Accounts placeholder, SP6), `owner-doc-config` (placeholder, SP4). Reuse same placeholder structure across BM/FM/OWNER as appropriate (not for SALES/ACC unless they have access).

- [ ] **Step 3: Build ZONE_CONFIG entries for all 5 roles**

Replace the empty `const ZONE_CONFIG: Record<string, RoleZoneConfig> = {};` with full entries:

```ts
const ZONE_CONFIG: Record<string, RoleZoneConfig> = {
  OWNER: {
    zones: ['shop', 'fin'],
    defaultZone: 'shop',
    showSettingsGear: true,
    sections: OWNER_CONFIG.sidebar,    // already zone-tagged in Step 1
    bottomNav: {
      shop: OWNER_CONFIG.bottomNav,                 // existing
      fin: [
        { label: 'Dashboard', path: '/finance-portfolio', icon: CircleDollarSign },
        { label: 'ค้างชำระ', path: '/overdue', icon: AlertTriangle },
        { label: 'ชำระ', path: '/payments', icon: HandCoins },
        { label: 'แชท', path: '/inbox', icon: MessageSquareMore, badgeKey: 'chat-unread' },
        { label: 'เพิ่มเติม', path: '#more', icon: MoreHorizontal, action: 'sidebar' },
      ],
      settings: [
        { label: 'ผู้ใช้', path: '/users', icon: UserCog },
        { label: 'บริษัท', path: '/settings/companies', icon: Building2 },
        { label: 'สาขา', path: '/branches', icon: Building2 },
        { label: 'ตั้งค่า', path: '/settings', icon: Settings },
        { label: 'เพิ่มเติม', path: '#more', icon: MoreHorizontal, action: 'sidebar' },
      ],
    },
  },
  BRANCH_MANAGER: {
    zones: ['shop', 'fin'],
    defaultZone: 'shop',
    showSettingsGear: false,
    sections: BRANCH_MANAGER_CONFIG.sidebar,
    bottomNav: {
      shop: BRANCH_MANAGER_CONFIG.bottomNav,
      fin: [
        { label: 'ค้างชำระ', path: '/overdue', icon: AlertTriangle },
        { label: 'รายงาน', path: '/reports', icon: BarChart3 },
        { label: 'แชท', path: '/inbox', icon: MessageSquareMore, badgeKey: 'chat-unread' },
        { label: 'เพิ่มเติม', path: '#more', icon: MoreHorizontal, action: 'sidebar' },
      ],
      settings: [],   // never accessed
    },
  },
  FINANCE_MANAGER: {
    zones: ['shop', 'fin'],
    defaultZone: 'fin',
    showSettingsGear: false,
    sections: FINANCE_MANAGER_CONFIG.sidebar,
    bottomNav: {
      shop: [
        { label: 'สัญญา', path: '/contracts', icon: FileCheck },
        { label: 'ชำระ', path: '/payments', icon: HandCoins },
        { label: 'MDM', path: '/mdm', icon: Smartphone },
        { label: 'แชท', path: '/inbox', icon: MessageSquareMore, badgeKey: 'chat-unread' },
        { label: 'เพิ่มเติม', path: '#more', icon: MoreHorizontal, action: 'sidebar' },
      ],
      fin: FINANCE_MANAGER_CONFIG.bottomNav,
      settings: [],
    },
  },
  SALES: {
    zones: ['shop'],
    defaultZone: 'shop',
    showSettingsGear: false,
    sections: SALES_CONFIG.sidebar,
    bottomNav: {
      shop: SALES_CONFIG.bottomNav,
      fin: [],
      settings: [],
    },
  },
  ACCOUNTANT: {
    zones: ['fin'],
    defaultZone: 'fin',
    showSettingsGear: false,
    sections: ACCOUNTANT_CONFIG.sidebar,
    bottomNav: {
      shop: [],
      fin: ACCOUNTANT_CONFIG.bottomNav,
      settings: [],
    },
  },
};
```

- [ ] **Step 4: Add vitest cases for `getSidebarForRole` returning correct sections per role/zone**

Append to `apps/web/src/config/menu.test.ts`:

```ts
describe('getSidebarForRole — populated ZONE_CONFIG', () => {
  it('OWNER + shop returns at least 4 sections all tagged shop', () => {
    const sections = getSidebarForRole('OWNER', 'shop');
    expect(sections.length).toBeGreaterThan(3);
    expect(sections.every(s => s.zone === 'shop')).toBe(true);
  });

  it('OWNER + fin returns sections all tagged fin', () => {
    const sections = getSidebarForRole('OWNER', 'fin');
    expect(sections.length).toBeGreaterThan(0);
    expect(sections.every(s => s.zone === 'fin')).toBe(true);
  });

  it('OWNER + settings returns settings sections', () => {
    const sections = getSidebarForRole('OWNER', 'settings');
    expect(sections.every(s => s.zone === 'settings')).toBe(true);
  });

  it('SALES + shop returns sales sections', () => {
    const sections = getSidebarForRole('SALES', 'shop');
    expect(sections.length).toBeGreaterThan(0);
  });

  it('SALES + fin returns empty (no access)', () => {
    expect(getSidebarForRole('SALES', 'fin')).toEqual([]);
  });

  it('SALES + settings returns empty (no gear)', () => {
    expect(getSidebarForRole('SALES', 'settings')).toEqual([]);
  });

  it('ACCOUNTANT + shop returns empty', () => {
    expect(getSidebarForRole('ACCOUNTANT', 'shop')).toEqual([]);
  });

  it('ACCOUNTANT + fin returns accounting sections', () => {
    const sections = getSidebarForRole('ACCOUNTANT', 'fin');
    expect(sections.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 5: Run vitest + type check**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE
./tools/check-types.sh web
cd apps/web && npx vitest run src/config/menu.test.ts
```
Expected: 0 type errors, all menu tests pass (10/10)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/config/menu.ts apps/web/src/config/menu.test.ts
git commit -m "feat(sidebar): populate ZONE_CONFIG for 5 roles + placeholders"
```

---

### Task 7: Create PillSwitcher component

**Files:**
- Create: `apps/web/src/components/layout/PillSwitcher.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { ShoppingCart, CircleDollarSign } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Zone } from '@/config/menu';

interface PillSwitcherProps {
  zones: Zone[];
  current: Zone;
  onSwitch: (zone: Zone) => void;
}

const ZONE_META: Record<Zone, { label: string; icon: typeof ShoppingCart }> = {
  shop: { label: 'หน้าร้าน', icon: ShoppingCart },
  fin: { label: 'ไฟแนนซ์', icon: CircleDollarSign },
  settings: { label: 'ตั้งค่า', icon: ShoppingCart },  // not used in pills
};

export function PillSwitcher({ zones, current, onSwitch }: PillSwitcherProps) {
  const pillZones = zones.filter((z) => z === 'shop' || z === 'fin');
  if (pillZones.length < 2) return null;

  return (
    <div
      role="tablist"
      aria-label="สลับโหมดหน้าร้าน/ไฟแนนซ์"
      className="flex gap-1.5 px-3 py-2.5 border-b border-sidebar-border bg-card"
    >
      {pillZones.map((zone) => {
        const meta = ZONE_META[zone];
        const Icon = meta.icon;
        const active = current === zone;
        return (
          <button
            key={zone}
            role="tab"
            aria-selected={active}
            onClick={() => onSwitch(zone)}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[12px] font-semibold leading-snug transition-colors duration-150',
              active
                ? 'bg-primary text-primary-foreground'
                : 'bg-background text-muted-foreground border border-border hover:text-foreground'
            )}
          >
            <Icon className="size-3.5" />
            <span>{meta.label}</span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Type check**

Run: `./tools/check-types.sh web`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/layout/PillSwitcher.tsx
git commit -m "feat(sidebar): add PillSwitcher component (หน้าร้าน/ไฟแนนซ์)"
```

---

### Task 8: Create GearButton component

**Files:**
- Create: `apps/web/src/components/layout/GearButton.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

interface GearButtonProps {
  active: boolean;
  onClick: () => void;
}

export function GearButton({ active, onClick }: GearButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="ตั้งค่ากลาง"
      className={cn(
        'flex items-center gap-2.5 w-full px-4 py-2.5 border-t border-sidebar-border text-[13px] font-semibold leading-snug transition-colors duration-150',
        active
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:text-foreground hover:bg-sidebar-hover'
      )}
    >
      <Settings className="size-4 shrink-0" />
      <span>ตั้งค่ากลาง</span>
    </button>
  );
}
```

- [ ] **Step 2: Type check + commit**

```bash
./tools/check-types.sh web
git add apps/web/src/components/layout/GearButton.tsx
git commit -m "feat(sidebar): add GearButton component (settings access)"
```

---

### Task 9: Rewire Sidebar.tsx to use zones

**Files:**
- Modify: `apps/web/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Update imports**

Replace existing import:

```ts
import { getMenuConfig } from '@/config/menu';
import type { MenuSection, MenuBadgeKey } from '@/config/menu';
```

with:

```ts
import { getSidebarForRole, getZoneConfigForRole } from '@/config/menu';
import type { MenuSection, MenuBadgeKey, Zone } from '@/config/menu';
import { PillSwitcher } from './PillSwitcher';
import { GearButton } from './GearButton';
```

- [ ] **Step 2: Update `useRoleMenu` to be zone-aware**

Replace existing `useRoleMenu`:

```ts
function useRoleMenu(role: string, zone: Zone): MenuSection[] {
  const { enabled: collectionsEnabled } = useCollectionsFlag();
  return useMemo(() => {
    const sections = getSidebarForRole(role, zone);
    if (!collectionsEnabled) return sections;
    return sections.map((section) => ({
      ...section,
      items: section.items.map((item) =>
        item.path === '/overdue' ? { ...item, path: '/collections' } : item,
      ),
    }));
  }, [role, zone, collectionsEnabled]);
}
```

- [ ] **Step 3: Update ExpandedSidebar to use zone + render pills + gear**

In `ExpandedSidebar`:

```tsx
function ExpandedSidebar({ onToggle }: { onToggle: () => void }) {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const { currentZone, setCurrentZone } = useLayout();   // ← from ctx

  const role = user?.role ?? '';
  const zoneConfig = getZoneConfigForRole(role);
  const sections = useRoleMenu(role, currentZone);

  // ... existing matchPath callback ...
  // ... existing role badge logic ...

  return (
    <div className="sidebar ...">
      {/* existing Header */}
      {/* existing User info */}

      {/* PillSwitcher — only if role has 2+ zones */}
      {zoneConfig && zoneConfig.zones.length >= 2 && (
        <PillSwitcher
          zones={zoneConfig.zones}
          current={currentZone}
          onSwitch={setCurrentZone}
        />
      )}

      <ScrollArea className="flex-1 pb-4 px-3">
        {/* existing AccordionMenu rendering — feeds sections */}
      </ScrollArea>

      {/* GearButton — only if role.showSettingsGear */}
      {zoneConfig?.showSettingsGear && (
        <GearButton
          active={currentZone === 'settings'}
          onClick={() => setCurrentZone('settings')}
        />
      )}

      {/* existing Footer (collapse/version/logout) */}
    </div>
  );
}
```

- [ ] **Step 4: Apply same zone-aware logic to CollapsedSidebar + MobileSidebarContent**

Both also call `useRoleMenu(role, currentZone)` and render PillSwitcher/GearButton inline (or use icon-only variants in collapsed mode). For `CollapsedSidebar`, pills become 2 stacked icons at top of rail (use `ShoppingCart` and `CircleDollarSign`); gear becomes the existing bottom icon-row slot. Reuse `PillSwitcher` is not appropriate for icon rail — inline 2-button vertical render in CollapsedSidebar.

- [ ] **Step 5: Validate role default zone on first mount**

In ExpandedSidebar, after `zoneConfig` is read, if `currentZone` isn't in `zoneConfig.zones` AND isn't `'settings'`, call `setCurrentZone(zoneConfig.defaultZone)` once:

```ts
useEffect(() => {
  if (zoneConfig && !zoneConfig.zones.includes(currentZone) && currentZone !== 'settings') {
    setCurrentZone(zoneConfig.defaultZone);
  }
  // If currentZone is 'settings' but role lacks gear, fall back
  if (currentZone === 'settings' && !zoneConfig?.showSettingsGear) {
    setCurrentZone(zoneConfig?.defaultZone ?? 'shop');
  }
}, [zoneConfig, currentZone, setCurrentZone]);
```

- [ ] **Step 6: Run type check + sidebar rendering smoke**

```bash
./tools/check-types.sh web
cd apps/web && npm run dev
```

Open browser to localhost:5173, login as OWNER → expect pills + gear visible. Login as SALES → expect no pills, no gear. Stop dev server.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/layout/Sidebar.tsx
git commit -m "feat(sidebar): wire Sidebar to zone-aware config + PillSwitcher + GearButton"
```

---

### Task 10: PR-3 — open

- [ ] **Step 1: Push + open PR-3**

```bash
git push
gh pr create --title "feat(sidebar): SP1 PR-3 — Sidebar zone rendering + PillSwitcher + GearButton" --body "$(cat <<'EOF'
## Summary
- ZONE_CONFIG map for all 5 roles (sections tagged with zone)
- New \`PillSwitcher\` + \`GearButton\` components (Thai labels: หน้าร้าน/ไฟแนนซ์)
- Sidebar.tsx + CollapsedSidebar + MobileSidebar consume \`currentZone\` from ctx
- Role default zone enforced on mount if currentZone invalid for role
- Placeholder items in menu (will render via PR-4 ComingSoonPage)

## Test plan
- [x] 10/10 vitest pass (\`menu.test.ts\` zone filter cases)
- [x] Type check 0 errors
- [x] Manual: OWNER sees pills + gear, SALES no pills, ACCOUNTANT no pills

Part of SP1 (5 PRs). Stack on PR-1, PR-2.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## PR-4 — ComingSoonPage + Placeholder Routes

### Task 11: Create ComingSoonPage component

**Files:**
- Create: `apps/web/src/components/ComingSoonPage.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { Construction, ArrowLeft, ExternalLink } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export interface ComingSoonPageProps {
  feature: string;
  trackingSP: 'SP2' | 'SP3' | 'SP4' | 'SP5' | 'SP6';
  trackingIssueUrl?: string;
  eta?: string;
  description?: string;
}

const SP_DESCRIPTIONS: Record<ComingSoonPageProps['trackingSP'], string> = {
  SP2: 'Sub-project 2: งบการเงิน + รายงานบัญชี',
  SP3: 'Sub-project 3: ปรับโครงสร้างภาษี (VAT/WHT/e-Tax)',
  SP4: 'Sub-project 4: ตั้งค่ารูปแบบ + เลขที่เอกสาร',
  SP5: 'Sub-project 5: ฟีเจอร์หน้าร้านเพิ่มเติม',
  SP6: 'Sub-project 6: บัญชีธนาคาร dedicated',
};

export function ComingSoonPage({
  feature,
  trackingSP,
  trackingIssueUrl,
  eta,
  description,
}: ComingSoonPageProps) {
  return (
    <div className="container mx-auto max-w-2xl py-12">
      <Card>
        <CardContent className="p-8 text-center">
          <div className="mx-auto mb-6 size-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Construction className="size-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">{feature}</h1>
          <p className="text-muted-foreground leading-snug mb-6">
            หน้านี้กำลังพัฒนา — อยู่ใน {trackingSP}
          </p>
          <div className="bg-muted/40 rounded-lg p-4 text-left mb-6">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              อยู่ในแผน
            </div>
            <div className="text-sm font-medium text-foreground leading-snug">
              {SP_DESCRIPTIONS[trackingSP]}
            </div>
            {eta && (
              <>
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-3 mb-1">
                  คาดว่าจะเสร็จ
                </div>
                <div className="text-sm font-medium text-foreground leading-snug">{eta}</div>
              </>
            )}
            {description && (
              <>
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-3 mb-1">
                  รายละเอียด
                </div>
                <div className="text-sm text-foreground leading-snug">{description}</div>
              </>
            )}
          </div>
          <div className="flex gap-2 justify-center">
            <Button asChild variant="outline">
              <Link to="/">
                <ArrowLeft className="size-4 mr-1.5" />
                ย้อนกลับหน้าหลัก
              </Link>
            </Button>
            {trackingIssueUrl && (
              <Button asChild variant="default">
                <a href={trackingIssueUrl} target="_blank" rel="noopener noreferrer">
                  ติดตามความคืบหน้า
                  <ExternalLink className="size-4 ml-1.5" />
                </a>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Type check + commit**

```bash
./tools/check-types.sh web
git add apps/web/src/components/ComingSoonPage.tsx
git commit -m "feat(sidebar): add ComingSoonPage for placeholder routes"
```

---

### Task 12: Test ComingSoonPage rendering

**Files:**
- Create: `apps/web/src/components/ComingSoonPage.test.tsx`

- [ ] **Step 1: Write tests**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ComingSoonPage } from './ComingSoonPage';

const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('ComingSoonPage', () => {
  it('renders feature name and SP badge', () => {
    wrap(<ComingSoonPage feature="ใบเสนอราคา" trackingSP="SP5" />);
    expect(screen.getByText('ใบเสนอราคา')).toBeInTheDocument();
    expect(screen.getByText(/SP5/)).toBeInTheDocument();
    expect(screen.getByText(/ฟีเจอร์หน้าร้านเพิ่มเติม/)).toBeInTheDocument();
  });

  it('shows ETA when provided', () => {
    wrap(<ComingSoonPage feature="X" trackingSP="SP2" eta="ภายในไตรมาส 3/2026" />);
    expect(screen.getByText('ภายในไตรมาส 3/2026')).toBeInTheDocument();
  });

  it('renders tracking link when provided', () => {
    wrap(
      <ComingSoonPage
        feature="X"
        trackingSP="SP3"
        trackingIssueUrl="https://github.com/test/repo/issues/100"
      />
    );
    const link = screen.getByText(/ติดตามความคืบหน้า/).closest('a');
    expect(link).toHaveAttribute('href', 'https://github.com/test/repo/issues/100');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('always shows back-to-home button', () => {
    wrap(<ComingSoonPage feature="X" trackingSP="SP4" />);
    const back = screen.getByText(/ย้อนกลับหน้าหลัก/).closest('a');
    expect(back).toHaveAttribute('href', '/');
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd apps/web && npx vitest run src/components/ComingSoonPage.test.tsx`
Expected: PASS (4/4)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ComingSoonPage.test.tsx
git commit -m "test(sidebar): cover ComingSoonPage rendering"
```

---

### Task 13: Register placeholder routes in App.tsx

**Files:**
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Add lazy import for ComingSoonPage near other lazy imports**

```tsx
const ComingSoonPage = lazy(() =>
  import('@/components/ComingSoonPage').then((m) => ({ default: m.ComingSoonPage }))
);
```

- [ ] **Step 2: Add helper to reduce route boilerplate**

Just above the `<Routes>` block in `App.tsx`:

```tsx
const placeholderRoute = (path: string, props: ComingSoonPageProps) => (
  <Route
    key={path}
    path={path}
    element={
      <ProtectedRoute>
        <MainLayout>
          <Suspense fallback={<PageLoader />}>
            <ComingSoonPage {...props} />
          </Suspense>
        </MainLayout>
      </ProtectedRoute>
    }
  />
);
```

(adjust import if `ComingSoonPageProps` not exported — change spec/types accordingly)

- [ ] **Step 3: Register all 10+ placeholder routes**

Inside `<Routes>`, after existing protected routes, add:

```tsx
{placeholderRoute('/quotes', {
  feature: 'ใบเสนอราคา',
  trackingSP: 'SP5',
  eta: 'ภายในไตรมาส 3/2026',
})}
{placeholderRoute('/insurance', {
  feature: 'ลงทะเบียนประกัน + รับเครื่องคืน',
  trackingSP: 'SP5',
  eta: 'ภายในไตรมาส 3/2026',
})}
{placeholderRoute('/drafts', {
  feature: 'เอกสารร่างทั้งหมด',
  trackingSP: 'SP5',
  eta: 'ภายในไตรมาส 3/2026',
})}
{placeholderRoute('/finance/vat', {
  feature: 'VAT (ภ.พ.30)',
  trackingSP: 'SP3',
  eta: 'ภายในไตรมาส 3/2026',
})}
{placeholderRoute('/finance/wht', {
  feature: 'ภาษีหัก ณ ที่จ่าย (ภ.ง.ด. 1/3/53)',
  trackingSP: 'SP3',
  eta: 'ภายในไตรมาส 3/2026',
})}
{placeholderRoute('/finance/e-tax', {
  feature: 'e-Tax Invoice',
  trackingSP: 'SP3',
  eta: 'ภายในไตรมาส 3/2026',
})}
{placeholderRoute('/finance/cash-flow', {
  feature: 'งบกระแสเงินสด',
  trackingSP: 'SP2',
  eta: 'ภายในไตรมาส 2/2026',
})}
{placeholderRoute('/finance/equity-statement', {
  feature: 'งบแสดงการเปลี่ยนแปลงในส่วนของผู้ถือหุ้น',
  trackingSP: 'SP2',
  eta: 'ภายในไตรมาส 2/2026',
})}
{placeholderRoute('/finance/general-ledger', {
  feature: 'สมุดแยกประเภท',
  trackingSP: 'SP2',
  eta: 'ภายในไตรมาส 2/2026',
})}
{placeholderRoute('/finance/bank-accounts', {
  feature: 'บัญชีธนาคาร',
  trackingSP: 'SP6',
  eta: 'ภายในไตรมาส 4/2026',
})}
{placeholderRoute('/settings/document-config', {
  feature: 'ตั้งค่าเลขที่/รูปแบบเอกสาร',
  trackingSP: 'SP4',
  eta: 'ภายในไตรมาส 3/2026',
})}
{placeholderRoute('/settings/brands', {
  feature: 'จัดการแบรนด์สินค้า',
  trackingSP: 'SP5',
  eta: 'ภายในไตรมาส 3/2026',
})}
{placeholderRoute('/settings/backup', {
  feature: 'รายงาน Backup',
  trackingSP: 'SP6',
  eta: 'ภายในไตรมาส 4/2026',
})}
```

- [ ] **Step 4: Manual smoke test**

```bash
cd apps/web && npm run dev
# Browser to /quotes — expect ComingSoonPage with "ใบเสนอราคา"
# Browser to /finance/cash-flow — expect "งบกระแสเงินสด"
```

- [ ] **Step 5: Commit + open PR-4**

```bash
git add apps/web/src/App.tsx
git commit -m "feat(sidebar): register 13 placeholder routes via ComingSoonPage"
git push
gh pr create --title "feat(sidebar): SP1 PR-4 — ComingSoonPage + 13 placeholder routes" --body "$(cat <<'EOF'
## Summary
- New \`ComingSoonPage\` component (Thai-localized, SP badge, ETA, tracking link)
- Register 13 placeholder routes via lazy import + Protected/MainLayout wrap
- Routes cover all missing pages tracked in SP2-SP6
- 4/4 vitest cases for ComingSoonPage

## Test plan
- [x] Vitest pass
- [x] Manual: click each placeholder path → ComingSoonPage renders correctly
- [x] No 404 on any sidebar item

Part of SP1 (5 PRs). Stack on PR-3.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## PR-5 — BottomNav Zone-aware + MainLayout Zone Sync + E2E

### Task 14: Make MobileBottomNav zone-aware

**Files:**
- Modify: `apps/web/src/components/layout/MobileBottomNav.tsx`

- [ ] **Step 1: Read the current MobileBottomNav to understand structure**

Run: `cat apps/web/src/components/layout/MobileBottomNav.tsx | head -50`
(check shape — confirms it currently reads `getMenuConfig(role).bottomNav`)

- [ ] **Step 2: Replace bottomNav lookup with zone-aware version**

Change the import:

```ts
import { getZoneConfigForRole } from '@/config/menu';
import type { BottomNavItem } from '@/config/menu';
```

Inside the component (replace existing `getMenuConfig(role).bottomNav` lookup):

```ts
const { currentZone } = useLayout();
const zoneConfig = getZoneConfigForRole(role);
const items: BottomNavItem[] = zoneConfig?.bottomNav[currentZone] ?? [];
```

- [ ] **Step 3: Type check**

Run: `./tools/check-types.sh web`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/layout/MobileBottomNav.tsx
git commit -m "feat(sidebar): make MobileBottomNav zone-aware"
```

---

### Task 15: MainLayout zone auto-sync + cross-zone deep link guard

**Files:**
- Modify: `apps/web/src/components/layout/MainLayout.tsx`

- [ ] **Step 1: Import dependencies at top**

```ts
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useLayout } from './LayoutContext';
import { getSidebarForRole, getZoneConfigForRole } from '@/config/menu';
import type { Zone } from '@/config/menu';
```

- [ ] **Step 2: Add resolver to find which zone a path belongs to (top of file, outside component)**

```ts
const ZONE_LOOKUP_ORDER: Zone[] = ['shop', 'fin', 'settings'];

/** Find the zone where a path lives (across all roles). Falls back to null. */
function resolveZoneForPath(role: string, path: string): Zone | null {
  for (const z of ZONE_LOOKUP_ORDER) {
    const sections = getSidebarForRole(role, z);
    const found = sections.some((s) =>
      s.items.some(
        (item) =>
          item.path === path ||
          (item.children ?? []).some((c) => c.path === path)
      )
    );
    if (found) return z;
  }
  return null;
}
```

- [ ] **Step 3: Add zone auto-sync useEffect inside MainLayout component**

```ts
const { user } = useAuth();
const { currentZone, setCurrentZone } = useLayout();
const { pathname } = useLocation();
const navigate = useNavigate();

useEffect(() => {
  const role = user?.role ?? '';
  if (!role) return;
  const targetZone = resolveZoneForPath(role, pathname);

  // Path not in any of role's zones → role lacks access → /403 redirect
  if (targetZone === null) {
    const zoneConfig = getZoneConfigForRole(role);
    if (zoneConfig) {
      toast.error('คุณไม่มีสิทธิ์เข้าถึงหน้านี้');
      navigate('/', { replace: true });
    }
    return;
  }

  // Auto-switch zone if pathname implies a different zone
  if (targetZone !== currentZone) {
    setCurrentZone(targetZone);
  }
}, [pathname, user?.role, currentZone, setCurrentZone, navigate]);
```

- [ ] **Step 4: Type check + smoke**

```bash
./tools/check-types.sh web
cd apps/web && npm run dev
# Login SALES, navigate to /overdue manually → expect toast "คุณไม่มีสิทธิ์เข้าถึงหน้านี้" + redirect to /
# Login OWNER on SHOP zone, navigate to /payments (FIN path) → expect pill auto-switches to ไฟแนนซ์
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/layout/MainLayout.tsx
git commit -m "feat(sidebar): zone auto-sync on pathname + cross-zone deep link guard"
```

---

### Task 16: Playwright E2E for SP1

**Files:**
- Create: `apps/web/e2e/sidebar-zones.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test';

const OWNER = { email: 'admin@bestchoice.com', password: 'admin1234' };
const SALES = { email: 'sales1@bestchoice.com', password: 'admin1234' };
const ACC = { email: 'accountant@bestchoice.com', password: 'admin1234' };

async function login(page, creds: { email: string; password: string }) {
  await page.goto('/login');
  await page.fill('input[name="email"]', creds.email);
  await page.fill('input[name="password"]', creds.password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
}

test.describe('SP1 — Sidebar zones', () => {
  test('OWNER sees both pills + gear, can switch zones', async ({ page }) => {
    await login(page, OWNER);
    await expect(page.getByRole('tab', { name: 'หน้าร้าน' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'ไฟแนนซ์' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'ตั้งค่ากลาง' })).toBeVisible();

    // Click ไฟแนนซ์ pill
    await page.getByRole('tab', { name: 'ไฟแนนซ์' }).click();
    await expect(page).toHaveURL(/zone=fin/);
    // Expect a FIN-zone item to be visible (e.g. รับชำระค่างวด)
    await expect(page.getByText('รับชำระค่างวด').first()).toBeVisible();
  });

  test('SALES sees no pill switcher, no gear', async ({ page }) => {
    await login(page, SALES);
    await expect(page.getByRole('tab', { name: 'หน้าร้าน' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'ไฟแนนซ์' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'ตั้งค่ากลาง' })).toHaveCount(0);
  });

  test('ACCOUNTANT sees no pills, sees FIN sections only', async ({ page }) => {
    await login(page, ACC);
    await expect(page.getByRole('tab', { name: 'หน้าร้าน' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'ไฟแนนซ์' })).toHaveCount(0);
    // Expect FIN-specific item visible
    await expect(page.getByText('รับชำระค่างวด').first()).toBeVisible();
  });

  test('OWNER zone selection persists across refresh', async ({ page }) => {
    await login(page, OWNER);
    await page.getByRole('tab', { name: 'ไฟแนนซ์' }).click();
    await expect(page).toHaveURL(/zone=fin/);
    await page.reload();
    await expect(page.getByRole('tab', { name: 'ไฟแนนซ์' })).toHaveAttribute('aria-selected', 'true');
  });

  test('OWNER cross-zone link auto-switches pill', async ({ page }) => {
    await login(page, OWNER);
    // Make sure starting in SHOP zone
    await page.getByRole('tab', { name: 'หน้าร้าน' }).click();
    // Navigate to FIN path directly via URL
    await page.goto('/payments');
    // Pill should auto-switch to ไฟแนนซ์
    await expect(page.getByRole('tab', { name: 'ไฟแนนซ์' })).toHaveAttribute('aria-selected', 'true');
  });

  test('SALES navigating to FIN-only path gets redirect + toast', async ({ page }) => {
    await login(page, SALES);
    await page.goto('/overdue');
    // Expect redirect away from /overdue (back to /)
    await expect(page).toHaveURL(/\/(?!overdue)/);
    // Toast appears (sonner uses [data-sonner-toast])
    await expect(page.getByText('คุณไม่มีสิทธิ์เข้าถึงหน้านี้')).toBeVisible({ timeout: 3000 });
  });

  test('Placeholder route renders ComingSoonPage', async ({ page }) => {
    await login(page, OWNER);
    await page.goto('/quotes');
    await expect(page.getByText('ใบเสนอราคา')).toBeVisible();
    await expect(page.getByText(/SP5/)).toBeVisible();
  });
});
```

- [ ] **Step 2: Run E2E locally**

Ensure local API + web dev servers are running, then:

```bash
cd apps/web && npx playwright test e2e/sidebar-zones.spec.ts
```
Expected: 7/7 pass. Fix any flakes by adjusting selectors before commit.

- [ ] **Step 3: Commit + open PR-5**

```bash
git add apps/web/e2e/sidebar-zones.spec.ts apps/web/src/components/layout/MobileBottomNav.tsx apps/web/src/components/layout/MainLayout.tsx
git commit -m "feat(sidebar): MobileBottomNav zone-aware + zone auto-sync + 7 E2E cases"
git push
gh pr create --title "feat(sidebar): SP1 PR-5 — Mobile zone-aware + cross-zone sync + E2E" --body "$(cat <<'EOF'
## Summary
- MobileBottomNav consumes \`currentZone\` (swaps items per zone)
- MainLayout auto-syncs zone on pathname change (cross-zone link → pill switch)
- Role lacks access → toast + redirect to /
- 7 Playwright E2E cases cover all roles + persistence + cross-zone

## Test plan
- [x] Playwright 7/7 pass
- [x] Type check 0 errors
- [x] Manual: OWNER navigates SHOP→FIN, refresh keeps zone, SALES blocked from FIN paths

Closes SP1 of sidebar redesign roadmap.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Final Verification (after PR-5 merged)

- [ ] **Step 1: Verify all 5 PRs merged**

```bash
git checkout main && git pull
gh pr list --state merged --search "SP1" --limit 5
```

- [ ] **Step 2: Run full test suite**

```bash
./tools/check-types.sh all
cd apps/web && npx vitest run
cd apps/web && npx playwright test e2e/sidebar-zones.spec.ts
```

Expected: 0 type errors, all vitest pass, 7/7 E2E pass

- [ ] **Step 3: Grep for emoji leakage in source code**

```bash
cd /Users/iamnaii/Desktop/App/BESTCHOICE
LC_ALL=en_US.UTF-8 grep -RnP '[\x{1F300}-\x{1FAFF}]' apps/web/src --include='*.ts' --include='*.tsx' || echo "No emoji found — OK"
```

Expected: "No emoji found — OK" (emoji must only exist in `.superpowers/brainstorm/` mockups, not in source)

- [ ] **Step 4: Update roadmap doc — mark SP1 complete**

Edit `docs/superpowers/specs/2026-05-17-sidebar-redesign-roadmap.md` table row for SP1 from "TBD" to merged PR list. Commit:

```bash
git add docs/superpowers/specs/2026-05-17-sidebar-redesign-roadmap.md
git commit -m "docs(sidebar): mark SP1 complete in roadmap"
git push
```

- [ ] **Step 5: Open SP2 spec** (next sub-project, separate brainstorming cycle)

Per roadmap, brainstorm SP2 (Accounting Reports Gap — Cash Flow, Equity, GL detail). Invoke brainstorming skill.

---

## Self-Review Checklist

- [x] **Spec coverage:** Every spec §4 schema change has a task. Every §5 UI behavior covered. §6 per-role matrix covered. §10 PR breakdown maps 1:1 to PRs in this plan.
- [x] **Placeholder scan:** No TBD/TODO/fill-in. All code blocks complete.
- [x] **Type consistency:** `getSidebarForRole(role, zone)` signature consistent across Task 2/Task 6/Task 9/Task 15. `RoleZoneConfig` shape stable. Zone strings `'shop'|'fin'|'settings'` consistent.
- [x] **PR boundaries match spec §10:** PR-1 schema, PR-2 ctx, PR-3 sidebar+pills+gear, PR-4 ComingSoonPage+routes, PR-5 mobile+sync+E2E.
- [x] **No emoji in source:** All emoji confined to mockup HTML or doc strings (Thai labels only in code).
