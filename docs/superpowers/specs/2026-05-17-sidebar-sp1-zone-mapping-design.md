# SP1 — Sidebar P6 Zone Mapping (Design Spec)

**Sub-project:** SP1 (of 6) — ดู roadmap: `2026-05-17-sidebar-redesign-roadmap.md`
**สถานะ:** Design approved 2026-05-17 (P6 + rule b)
**ETA:** 3-5 PRs / 1-2 weeks
**Tracking issue:** TBD (open after spec sign-off)

---

## 1. Problem Statement

ปัจจุบัน sidebar config (`apps/web/src/config/menu.ts`) จัดเมนูตาม `RoleMenuConfig` แยก 5 roles แต่ละ role มี 7-11 sections flat (รวมเมนูทั้งบริษัทใน sidebar เดียว) — OWNER มี ~47 รายการ navigate ลำบาก หา "บัญชี" ปนกับ "ขาย"

CSV ที่ owner เสนอ (2026-05-17) แบ่งใหม่เป็น **3 zones**:
- 🛒 BESTCHOICE หน้าร้าน (SHOP) — งานขาย + คลัง + ติดตามขาย
- 🟢 BESTCHOICE FINANCE — งานการเงิน + บัญชี + ภาษี + งบ
- ⚙️ ตั้งค่ากลาง — ใช้ร่วม 2 ธุรกิจ (org/users/role/master data)

SP1 = ทำ sidebar paradigm + zone mapping + placeholder ของหน้าที่ยังไม่มี (10+ หน้า) เพื่อให้ navigate ตามโครงสร้างใหม่ได้ทันที — หน้าที่ขาดจะค่อยทำใน SP2-SP6

## 2. Goals / Non-Goals

**Goals:**
- ทุก path เดิมใน app → ถูก map ไปอยู่ใน 1 zone (SHOP / FIN / Settings) ตาม mental model
- OWNER/BM/FM เห็น pill switcher 2 ปุ่ม (SHOP/FIN)
- SALES/ACCOUNTANT ไม่เห็น pill switcher (single-zone)
- เฟือง Settings มุมล่าง — เฉพาะ OWNER เห็น
- คลิก placeholder → ComingSoonPage บอก SP + tracking issue
- Zone selection persist ใน `localStorage` + URL query `?zone=`
- BottomNav (mobile) แสดง items ตาม zone ปัจจุบัน
- ไม่มี emoji ในโค้ดจริง (ใช้ lucide-react)

**Non-Goals:**
- ไม่สร้างหน้าใหม่ (SP2-SP6 จะทำ)
- ไม่ refactor `Sidebar.tsx` structure ใหญ่ (แค่เพิ่ม pill switcher logic)
- ไม่เปลี่ยน color tokens / design system (ใช้ของเดิม)
- ไม่ migrate URL paths (เก็บ /pos, /customers, /payments เหมือนเดิม)

## 3. Zone Mapping (Complete Path → Zone Table)

ทุก path ใน `menu.ts` ปัจจุบัน + path ใหม่ — แต่ละ path ถูก tag `zone` ใน config

### 3.1 SHOP zone

| Section | Path | Status |
|---|---|---|
| ภาพรวม | `/` (Dashboard) | existing |
| ภาพรวม | `/todos` | existing |
| ภาพรวม | `/sales` | existing |
| การขาย | `/crm` (CRM Pipeline) | existing |
| การขาย | `/pos` | existing |
| การขาย | `/customers` | existing |
| การขาย | `/customer-intake` | existing |
| การขาย | `/contracts` | existing |
| การขาย | `/trade-in` | existing |
| การขาย | `/commissions` | existing |
| การขาย | `/quotes` (ใบเสนอราคา) | **PLACEHOLDER → SP5** |
| การซื้อ/รับสินค้า | `/suppliers` | existing |
| การซื้อ/รับสินค้า | `/purchase-orders` | existing |
| การซื้อ/รับสินค้า | `/stickers` | existing |
| คลังสินค้า | `/stock` | existing |
| คลังสินค้า | `/stock/products` | existing |
| คลังสินค้า | `/stock/transfers` | existing |
| ประกัน/รับคืน | `/defect-exchange` | existing |
| ประกัน/รับคืน | `/repossessions` | existing |
| ประกัน/รับคืน | `/insurance` (ลงทะเบียนประกัน) | **PLACEHOLDER → SP5** |
| รายการร่าง | `/drafts` (Drafts hub) | **PLACEHOLDER → SP5** |
| ออนไลน์ | `/online-orders` | existing |
| ออนไลน์ | `/installment-applications` | existing |
| ออนไลน์ | `/saving-plans` | existing |
| ออนไลน์ | `/reviews` | existing |
| การตลาด | `/promotions` | existing |
| การตลาด | `/ads` | existing |
| การตลาด | `/broadcast` | existing |
| เครื่องมือ | `/chat` | existing |
| เครื่องมือ | `/mdm` | existing |
| เครื่องมือ | `/payments` (รับชำระ — visible สำหรับ SALES) | existing, cross-zone alias |

### 3.2 FIN zone

| Section | Path | Status |
|---|---|---|
| ภาพรวม | `/finance-portfolio` (Dashboard FIN) | existing |
| รายรับ | `/payments` | existing |
| รายรับ | `/overdue` หรือ `/collections` (flag) | existing |
| รายรับ | `/other-income` | existing |
| รายรับ | `/repossessions` (cross-link from SHOP) | existing |
| รายจ่าย | `/expenses` | existing |
| รายจ่าย | `/assets` (บันทึกซื้อ) | existing |
| รายจ่าย | `/assets/register` | existing |
| รายจ่าย | `/depreciation` | existing |
| รายจ่าย | `/assets/audit` | existing |
| ภาษี | `/finance/vat` (ภ.พ.30 dedicated) | **PLACEHOLDER → SP3** |
| ภาษี | `/finance/wht` (ภ.ง.ด. 1/3/53 dedicated) | **PLACEHOLDER → SP3** |
| ภาษี | `/finance/e-tax` (e-Tax Invoice) | **PLACEHOLDER → SP3** |
| ภาษี | `/tax-reports` (legacy — keep until SP3) | existing |
| งบการเงิน | `/profit-loss` | existing |
| งบการเงิน | `/finance/balance-sheet` | partial — exists via `/accounting` |
| งบการเงิน | `/finance/cash-flow` | **PLACEHOLDER → SP2** |
| งบการเงิน | `/finance/equity-statement` | **PLACEHOLDER → SP2** |
| รายงานบัญชี | `/finance/journal` (สมุดรายวันรวม) | partial — exists scattered, **needs unified → SP2** |
| รายงานบัญชี | `/finance/general-ledger` (สมุดแยกประเภท) | **PLACEHOLDER → SP2** |
| รายงานบัญชี | `/accounting/intercompany` | existing |
| รายงานบัญชี | `/reports` (รวมทั่วไป) | existing |
| รายงานบัญชี | `/financial-audit` | existing |
| ปิดบัญชี | `/monthly-close` | existing |
| ปิดบัญชี | `/accounting/periods` → redirect `/settings#periods` | existing |
| ผังบัญชี + ธนาคาร | `/settings/chart-of-accounts` | existing |
| ผังบัญชี + ธนาคาร | `/finance/bank-accounts` | **PLACEHOLDER → SP6** |
| ตั้งค่าเอกสาร | `/settings/document-config` | **PLACEHOLDER → SP4** |
| เชื่อมต่อ | `/settings/integrations` | existing |
| เชื่อมต่อ | `/settings/peak-sync` | existing |
| เชื่อมต่อ | `/settings/rich-menu` (LINE OA) | existing |
| เชื่อมต่อ | `/settings/dunning` | existing |
| AI | `/settings/ai-admin` | existing |
| AI | `/settings/ai-chat` | existing |

### 3.3 Settings zone (gear — OWNER only)

| Section | Path | Status |
|---|---|---|
| ข้อมูลองค์กร | `/settings` (root) | existing |
| ข้อมูลองค์กร | `/settings/companies` | existing |
| ข้อมูลองค์กร | `/branches` | existing |
| สิทธิ์ผู้ใช้งาน | `/users` | existing |
| สิทธิ์ผู้ใช้งาน | `/settings/account-roles` | existing |
| สิทธิ์ผู้ใช้งาน | `/audit-logs` | existing |
| ข้อมูลพื้นฐาน | `/settings/brands` (แบรนด์) | **PLACEHOLDER → SP5 (จัด master data)** |
| ข้อมูลพื้นฐาน | `/settings/pricing-templates` | existing |
| ข้อมูลพื้นฐาน | `/contract-templates` | existing |
| ความปลอดภัย+ข้อมูล | `/pdpa` | existing |
| ความปลอดภัย+ข้อมูล | `/settings/backup` (runbook) | **PLACEHOLDER → SP6 (เผยรายงาน backup)** |

## 4. Schema Changes

### 4.1 `apps/web/src/config/menu.ts`

```ts
// เพิ่ม Zone enum
export type Zone = 'shop' | 'fin' | 'settings';

// เพิ่ม placeholder hint
export interface PlaceholderInfo {
  trackingSP: 'SP2' | 'SP3' | 'SP4' | 'SP5' | 'SP6';
  trackingIssueUrl?: string;
  eta?: string;
}

// MenuItem เพิ่ม placeholder optional
export interface MenuItem {
  label: string;
  path: string;
  icon: LucideIcon;
  children?: MenuItem[];
  badgeKey?: MenuBadgeKey;
  placeholder?: PlaceholderInfo;  // ← new
}

// MenuSection เพิ่ม zone tag
export interface MenuSection {
  key: string;
  label: string;
  icon: LucideIcon;
  zone: Zone;                       // ← new
  items: MenuItem[];
}

// New: zone-aware role config
export interface RoleZoneConfig {
  /** Pills shown — if 1 zone only, no pill switcher */
  zones: Zone[];
  /** Default zone (used if no localStorage value yet) */
  defaultZone: Zone;
  /** Show gear icon to Settings zone? */
  showSettingsGear: boolean;
  /** All sections across all zones — filtered at render time */
  sections: MenuSection[];
  /** BottomNav (mobile) per zone */
  bottomNav: Record<Zone, BottomNavItem[]>;
}

// New: filter for current zone
export function getSidebarForRole(role: string, currentZone: Zone): MenuSection[] {
  const config = MENU_CONFIG[role] ?? OWNER_CONFIG;
  return config.sections.filter(s => s.zone === currentZone);
}
```

### 4.2 Zone state management (`apps/web/src/components/layout/LayoutContext.tsx`)

```ts
// เพิ่ม currentZone + setCurrentZone
type LayoutContextValue = {
  sidebarCollapse: boolean;
  setSidebarCollapse: (v: boolean) => void;
  currentZone: Zone;                            // ← new
  setCurrentZone: (z: Zone) => void;            // ← new (persist to localStorage + URL)
};

// Persistence:
//   - Read order: URL ?zone=, then localStorage[bc.sidebar.lastZone], then role default
//   - Write: setCurrentZone updates state + localStorage + URL replace
```

### 4.3 ComingSoonPage component (`apps/web/src/components/ComingSoonPage.tsx`)

```ts
interface ComingSoonPageProps {
  feature: string;
  trackingSP: 'SP2' | 'SP3' | 'SP4' | 'SP5' | 'SP6';
  trackingIssueUrl?: string;
  eta?: string;
  description?: string;
}

// Render: card with feature name, SP badge, ETA, link to issue, "ย้อนกลับ" button
// Uses design tokens (bg-card, text-foreground, text-muted-foreground)
// Renders Construction icon (lucide-react) as visual cue
```

### 4.4 Route registration (`apps/web/src/App.tsx` or route config)

All placeholder paths register with `<ComingSoonPage>` wrapped in lazy import + `<ProtectedRoute>`:

```tsx
<Route path="/quotes" element={
  <Suspense fallback={<PageLoader />}>
    <ProtectedRoute><MainLayout>
      <ComingSoonPage feature="ใบเสนอราคา" trackingSP="SP5" eta="ภายในไตรมาส 3/2026" />
    </MainLayout></ProtectedRoute>
  </Suspense>
} />
```

## 5. UI Behavior Spec

### 5.1 Pill switcher (P6 layout)

- ตำแหน่ง: ใต้ `<sb-user>` block, padding `10px 12px`
- 2 pills: **"หน้าร้าน"** (zone=`shop`) / **"ไฟแนนซ์"** (zone=`fin`) — width equal (`flex: 1`)
- Active pill: `bg-primary text-primary-foreground`, inactive: `bg-card text-muted-foreground border border-border`
- Icon prefix: `ShoppingCart` (หน้าร้าน), `CircleDollarSign` (ไฟแนนซ์)
- Transition: `transition-colors duration-150`
- Click → call `setCurrentZone(zone)` → sidebar content swap

### 5.2 Gear (Settings access)

- ตำแหน่ง: bottom of nav, above existing `<sb-foot>` (collapse + logout)
- Visible: OWNER only
- Click → `setCurrentZone('settings')` → sidebar swap to Settings sections
- Icon: `Settings` lucide-react

### 5.3 Cross-zone deep linking

- คลิก link ภายในแอป (notification, breadcrumb) ที่ point ไปหน้า zone อื่น → auto-switch pill
- Implementation: ใน `MainLayout`, watch `pathname` → resolve zone → `setCurrentZone` ถ้าไม่ตรง
- กรณี role ไม่มี zone นั้น (SALES คลิก link FIN) → redirect `/403` พร้อม toast "เมนูนี้สำหรับฝ่ายการเงิน"

### 5.4 BottomNav (mobile) zone-aware

- BottomNav แสดง 4 hot links + 1 "เพิ่มเติม"
- Per-zone:
  - SHOP: POS / ลูกค้า / สัญญา / แชท / เพิ่มเติม
  - FIN: Dashboard FIN / ค้างชำระ / ชำระ / แชท / เพิ่มเติม
- ถ้า role single-zone → BottomNav fixed ตาม zone นั้น
- ถ้า role multi-zone → BottomNav swap ตาม currentZone
- **Exception ACCOUNTANT (FIN single-zone, no chat per `CHAT_VISIBLE_ROLES`)**: BottomNav = Dashboard FIN / ค้างชำระ / ชำระ / รายงาน / เพิ่มเติม (no chat slot)

### 5.5 Mode persistence

- URL query: `?zone=shop|fin|settings` — สิทธิ์สูงสุด (deep link wins)
- localStorage: `bc.sidebar.lastZone` — ใช้ถ้าไม่มี URL
- Default per role: ใช้ถ้าไม่มีทั้ง 2
- เปลี่ยน pill → push URL + update localStorage

## 6. Per-role Filter Logic

แต่ละ role มี `RoleZoneConfig` ระบุ `zones[]` ที่เห็น:

| Role | zones | defaultZone | showSettingsGear |
|---|---|---|---|
| OWNER | `['shop', 'fin']` (+ settings via gear) | `'shop'` | `true` |
| BRANCH_MANAGER | `['shop', 'fin']` | `'shop'` | `false` |
| FINANCE_MANAGER | `['shop', 'fin']` | `'fin'` | `false` |
| SALES | `['shop']` | `'shop'` | `false` |
| ACCOUNTANT | `['fin']` | `'fin'` | `false` |

แต่ละ role ยังคงมี items filter ของตัวเองภายใน zone (เช่น BM ใน FIN เห็นแค่ reports + ติดตามหนี้ ไม่เห็น expense entry)

## 7. Component Diff Summary

| File | Type | Change |
|---|---|---|
| `apps/web/src/config/menu.ts` | Modify | Add `Zone`, `PlaceholderInfo`, `RoleZoneConfig`, `getSidebarForRole`; rewrite 5 role configs |
| `apps/web/src/components/layout/Sidebar.tsx` | Modify | Add `PillSwitcher`, `GearButton`, consume `currentZone` from context |
| `apps/web/src/components/layout/LayoutContext.tsx` | Modify | Add `currentZone` + `setCurrentZone` with persistence |
| `apps/web/src/components/layout/MobileBottomNav.tsx` | Modify | Consume `currentZone`, swap items per zone |
| `apps/web/src/components/ComingSoonPage.tsx` | New | Placeholder page component |
| `apps/web/src/App.tsx` (or route config) | Modify | Register 10+ placeholder routes |
| `apps/web/src/components/MainLayout.tsx` | Modify | Add zone auto-sync on pathname change |
| `apps/web/src/contexts/AuthContext.tsx` | No change | Reuse `user.role` |

**Estimate:** ~600-800 LOC across 6-7 files

## 8. Test Plan

### 8.1 Vitest unit tests
- `getSidebarForRole(role, zone)` returns correct sections per matrix in §6
- Zone persistence: URL > localStorage > role default
- ComingSoonPage renders feature name, SP badge, tracking link

### 8.2 Playwright E2E
- Login OWNER → see 2 pills + gear → click FIN pill → see FIN sections
- Login SALES → no pills, no gear → see SHOP sections only
- Login ACCOUNTANT → no pills → see FIN sections only
- Cross-zone link: SALES clicks notification link to `/overdue` → 403
- Refresh after FIN selected → still on FIN (localStorage persistence)
- Mobile (Playwright viewport mobile): BottomNav swaps per zone

### 8.3 Accessibility
- Pill switcher: `role="tablist"`, each pill `role="tab"`, `aria-selected`
- Gear button: `aria-label="ตั้งค่ากลาง"`
- Keyboard: Tab through pills, Enter to switch zone

## 9. Migration / Rollout

- **No DB migration** — pure frontend change
- **No backend change** — existing routes + guards unchanged
- **Feature flag:** `SIDEBAR_V2_ENABLED` env (default `false` in dev for safety) — toggle to roll back fast if regression found
- **Rollout:**
  - Phase 1: Dev/staging — enable flag, internal QA
  - Phase 2: Single test user (owner's account) — enable in prod via user-specific flag
  - Phase 3: All users — flag default `true`
  - Phase 4: Remove flag + dead code

## 10. PR Breakdown (Anti-pattern #3 — 1 PR per item)

| PR | Scope | LOC est. |
|---|---|---|
| PR-1 | Schema only: add `Zone`, `PlaceholderInfo`, `RoleZoneConfig` types + `getSidebarForRole` helper to `menu.ts`. Keep existing `RoleMenuConfig` intact for backwards compat — no UI consumes new types yet. Vitest covers `getSidebarForRole` shape. | ~150 |
| PR-2 | LayoutContext: `currentZone` state + localStorage + URL `?zone=` persistence helpers (no UI render yet — Sidebar.tsx untouched). Vitest covers persistence priority (URL > localStorage > default). | ~100 |
| PR-3 | Rewrite 5 role configs in `menu.ts` to new `RoleZoneConfig` shape + update Sidebar.tsx to render PillSwitcher + GearButton + consume `currentZone` ctx + filter sections by zone. Existing items keep working. | ~250 |
| PR-4 | ComingSoonPage component + register 10+ placeholder routes in App.tsx | ~200 |
| PR-5 | MobileBottomNav zone-aware + MainLayout zone auto-sync on pathname change + Playwright E2E (all roles + persistence + cross-zone redirect) | ~150 |

**ห้าม collapse PR** — แม้ PR-1 จะ "ดูเล็ก" ก็ตาม เพราะ subagent ทำขนานกันได้เร็วขึ้น + reviewable

## 11. Acceptance Criteria

- [ ] OWNER เห็น pills [SHOP] [FIN] + gear, สลับได้, items เปลี่ยนถูกต้อง
- [ ] BRANCH_MANAGER, FINANCE_MANAGER เห็น pills (ไม่มี gear)
- [ ] SALES, ACCOUNTANT ไม่เห็น pills
- [ ] Default zone ตรงตาม table §6
- [ ] Pill click → URL `?zone=` update + localStorage บันทึก
- [ ] Refresh → ยังอยู่ zone เดิม (URL > localStorage > default)
- [ ] คลิก placeholder item → ComingSoonPage แสดง feature + SP + ETA + tracking link
- [ ] SALES คลิก deep link ไป FIN-only path → 403
- [ ] BottomNav mobile แสดง items ตาม zone ปัจจุบัน
- [ ] ไม่มี emoji ในโค้ดจริง (verified by grep `[\u{1F300}-\u{1FAFF}]` excludes brainstorm/.superpowers/)
- [ ] Vitest pass, Playwright pass, TypeScript 0 errors
- [ ] Code-review subagent → 0 Critical

## 12. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| User คลิกเข้า placeholder เยอะ → frustration | M | Placeholder ต้องสวย + บอก ETA + link tracking issue ให้กดติดตามได้ |
| Zone switcher confusing สำหรับ user เก่า | M | Onboarding tooltip ตอน login ครั้งแรกหลัง deploy + release note ใน notif center |
| URL `?zone=` ขัด queryparams เดิม | L | ใช้ namespace `zone=`, ไม่ใช่ generic key |
| `localStorage` quota exceeded (unlikely) | L | กัน try-catch + fallback role default |
| Cross-zone auto-switch logic break breadcrumb | M | E2E test cover: navigate cross-zone path → breadcrumb still correct |
| `feature flag` removal forgotten | M | Add to roadmap "Phase 4" + reminder in PR-5 description |

## 13. Open Questions — RESOLVED

- [x] **Zone label**: ไทย — **"หน้าร้าน"** / **"ไฟแนนซ์"** (lock 2026-05-17)
- [x] **Default zone for OWNER**: **SHOP** (sales mindset) — confirmed
- [x] **BottomNav for FM SHOP pill**: swaps with currentZone — confirmed yes
- [x] **Cross-zone deep link rule**: redirect to `/403` + toast "เมนูนี้สำหรับฝ่ายการเงิน" (or "ฝ่ายขาย" reverse) — confirmed yes
