# Typography UI Fixes — Round 4 (6 follow-ups from the UI-fix report) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ปิดงานต่อ 6 ข้อท้าย `docs/reports/typography-ui-fixes-2026-11/summary.md` หัวข้อ "งานต่อที่เสนอ" (ปุ่ม "ขึ้นเว็บ" · หัวตารางใบส่วนของเจ้าของ · ป้าย "ดูอย่างเดียว" · กรอบโฟกัสแถบแท็บ · ชิปนัดแชท · แท็บลิงก์ตรงหน้าสัญญา) แล้ววัดซ้ำทั้งระบบให้เห็นว่าจุดที่แก้หายจริงและไม่มีอะไรพังเพิ่ม

**Architecture:** แก้รายจุดในหน้าที่เกี่ยวข้อง (ไม่มีคอมโพเนนต์ร่วมตัวใหม่) · ยกเว้นข้อ 4 ที่แก้ทั้งแท็บร่วม `tabs.tsx` และแถบแท็บที่วาดเอง 6 แห่งให้ใช้กรอบโฟกัสด้านในชุดเดียวกัน · ทุก Task มีเทสต์ vitest แบบอ่าน source text ตามแบบ `apps/web/src/pages/__tests__/tabsButtonRowsNowrap.test.ts` (helper `classBefore`) · วัดผลด้วย harness `UXUI_TYPOGRAPHY=1` ทั้งระบบรอบเดียวที่ HEAD แล้วเทียบกับชุดวัดรอบ 3 ด้วย `tools/typography-audit/report.mjs`

**Tech Stack:** React + Tailwind v4 + shadcn/ui (`apps/web`) · vitest · harness `apps/api/e2e/documents/uxui-pages.browser.docs-spec.ts` + `npm run docs:check` · `tools/typography-audit/*`

**Spec:** `docs/reports/typography-ui-fixes-2026-11/summary.md` หัวข้อ "งานต่อที่เสนอ (ยังไม่ทำ — รอเจ้าของสั่ง)" ข้อ 1–6 · ไฟล์ห้ามแตะตาม `docs/superpowers/specs/2026-11-08-typography-noto-sans-thai-design.md` §4

## Global Constraints

- ฐานงาน: branch ใหม่ `chore/typography-ui-fixes-round4` จาก `origin/main` หลัง PR #1778 merge · worktree ใหม่ใต้ `.claude/worktrees/` · `git -C <path>` เท่านั้น · ห้ามรันอะไรใน checkout หลัก
- **ห้ามแตะเอกสารถึงลูกค้า** (คำสั่ง 2026-11-08): ไฟล์ใน spec §4 และทุกอย่างใต้ `.voucher-sheet, .document-sheet, .bc-document, .document-landscape, .document-print-dialog, .template-paper, .font-sarabun, .mobile-receipt, .sticker, .print-stickers, .tiptap, .parcel-label, .contract-body` — Doc guard ต้องได้ `exit=1` ก่อนทุก commit:
  `FILES=$(git diff --name-only origin/main...HEAD; git diff --name-only; git diff --name-only --cached); echo "$FILES" | grep -E "receipt-pdf|hire-purchase-contract|document-rendering|generated-document-effects|letter-pdf|after-sales-doc-html|after-sales-pdf|voucher-html|voucher-pdf|sale-receipt-pdf|asset-receipt-pdf|expense-voucher-pdf|e-tax\.service|pdf-report|finance-share-page|rich-menu|flex-messages|\.flex\.ts|apps/api/src/assets/fonts|document-style\.ts|lib/document-fonts|pdfGenerator|DocumentStyles|DocumentPreview|StickerCard|parcelLabel|MobileReceipt|THSarabunPSK|design-preview|modules/mdm"; echo "exit=$?"`
- ห้ามแตะ `modules/mdm` · ใช้โทเคนสีเดิม (`frontend.md`) · ข้อความไทยห้าม `leading-none` · ไม่เพิ่ม dependency · ไม่แปลง `<button>` ดิบเป็น `Button`
- ไม่เปลี่ยนสี/ขนาดตัวอักษร/ความสูงของแท็บ ปุ่ม ชิป — ยกเว้น Task 2 ที่เพิ่มระยะขอบซ้ายขวาของเซลล์ตารางใบส่วนของเจ้าของ (ข้อ 2 ของ spec ระบุไว้ว่าหน้าตาบนจอใหญ่จะเปลี่ยนเล็กน้อย)
- เกณฑ์ปุ่ม: มือถือ ≥ 44px (`max-lg:min-h-11`) · จอใหญ่ ≥ 32px (`lg:min-h-8`) — ไม่เปลี่ยนในรอบนี้
- ทั้งหน้าห้ามเลื่อนแนวนอนที่ 320/390 บนหน้าที่แก้ (`document.documentElement.scrollWidth <= innerWidth + 1`)
- bump `version` ใน `apps/web/package.json` 26.11.7 → 26.11.8 (กติกา bump ทุก deploy · ไม่แตะ `package-lock.json` ตามแบบ #1777/#1778) · ไม่แตะ `apps/web-shop`
- harness: `NODE_OPTIONS=--max-old-space-size=6144` + `UXUI_INVENTORY` เป็น path เต็ม · **วัดทั้งระบบรอบเดียวที่ HEAD — ห้ามเอาผลวัดแยกบางหน้ามาประกบกับชุดเต็ม** (เมนูซ้ายแสดงต่างกัน ตัวเลข D1/R1 เพี้ยน — บทเรียนรอบ 2)
- จบที่เปิด PR (base `main`) · ห้าม merge/deploy เอง

## Review Focus

1. **กรอบโฟกัสด้านใน (Task 4) ต้องมองเห็นบนแท็บที่เลือกทั้งสองธีม** — แท็บที่เลือกมีเส้นใต้ 2px สี primary ชิดขอบล่าง กรอบ `ring-inset` 2px จะทับเส้นนั้นพอดี ⇒ ยอมรับได้เพราะอีก 3 ด้านยังเห็น · harness ไม่ได้ focus แท็บ จึงปักด้วยเทสต์คลาสและเขียนเหตุผลใน PR
2. **`scrollIntoView` (Task 5) ต้องไม่เลื่อนทั้งหน้าแนวตั้ง** ตอนเปิดหน้า — ใช้ `block: 'nearest', inline: 'nearest'` เท่านั้น และเรียกเฉพาะเมื่อแถบเลื่อนได้จริง (`scrollWidth > clientWidth`)
3. **ระยะขอบเซลล์ (Task 2) ต้องไม่ทำให้ตารางกว้างเกินจน ScreenTable เปลี่ยนเป็นการ์ดที่จอ 390** ทั้งที่รอบ 3 ยังเป็นตาราง — ถ้าเปลี่ยน ต้องรายงานใน Task 6
4. **ป้าย "ดูอย่างเดียว" ที่ย้ายออกจากแท็บ (Task 3) ต้องยังเห็นได้ตอนอยู่แท็บใบจ่าย** — อยู่ในหัวแผงของแท็บนั้น ไม่หายไป
5. **ธีมมืด** — harness วัดทั้งสองธีมอยู่แล้ว ภาพตรวจ Task 6 ดูทั้งสองธีม

---

### Task 1: แก้คำเดียว 2 จุด — ปุ่ม "ขึ้นเว็บ" ไม่ตัดบรรทัด + ชิปนัดในแชทเลิก `leading-none`

**Files:**
- Modify: `apps/web/src/pages/ProductDetailPage/components/SellingPriceCard.tsx` (ปุ่ม `onGoOnline` ~บรรทัด 122–131)
- Modify: `apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx` (ชิปนัด className ~บรรทัด 841 — ตัวที่มี `roomApptState.tone`)
- Test: `apps/web/src/pages/__tests__/tabsButtonRowsNowrap.test.ts` (เพิ่ม describe) · `apps/web/src/pages/__tests__/headerNowrap.test.ts` (ขยายเทสต์ชิปแชทที่มีอยู่)

**Interfaces:** ไม่มี — คลาสอย่างเดียว

- [ ] **Step 1: เทสต์ล้มก่อน**

```ts
// tabsButtonRowsNowrap.test.ts
describe('SellingPriceCard "ขึ้นเว็บ" readiness button', () => {
  it('never wraps', () => {
    const cls = classBefore(read('pages/ProductDetailPage/components/SellingPriceCard.tsx'), '>\n                ขึ้นเว็บ', '<button');
    expect(cls).toContain('whitespace-nowrap');
  });
});
// headerNowrap.test.ts — ในเทสต์ชิปแชทเดิม เพิ่ม:
it('appointment chip uses leading-snug (Thai text rule)', () => {
  const src = read('UnifiedInboxPage/components/ChatPanel.tsx');
  const before = src.slice(0, src.indexOf("roomApptState.tone === 'danger'"));
  const cls = before.slice(before.lastIndexOf("'inline-flex h-5")); // the chip's own base-class string inside cn()
  expect(cls).toContain('leading-snug');
  expect(cls).not.toContain('leading-none');
});
```
(ถ้า anchor ของปุ่ม "ขึ้นเว็บ" ไม่ตรงตัวอักษร ให้ใช้ regex `/>\s*ขึ้นเว็บ\s*</` แบบ `touchTargets.test.ts:55`)

- [ ] **Step 2: รัน `npm --prefix apps/web run test -- tabsButtonRowsNowrap headerNowrap`** → Expected: 2 เทสต์ใหม่ FAIL
- [ ] **Step 3: แก้** — เพิ่ม `whitespace-nowrap` ใน className ของปุ่ม "ขึ้นเว็บ" · เปลี่ยน `leading-none` → `leading-snug` ในชิปนัด (คง `h-5`, `text-[11.5px]`, สีเดิม)
- [ ] **Step 4: รันเทสต์ซ้ำ** → PASS · `npx --prefix apps/web tsc --noEmit -p apps/web` → 0 error · Doc guard `exit=1`
- [ ] **Step 5: Commit** `fix(web): "ขึ้นเว็บ" readiness button never wraps; appointment chip leading-snug (typography round 4 items 1, 5)`

### Task 2: หัวตารางใบส่วนของเจ้าของ — เพิ่มระยะขอบเซลล์

**Files:**
- Modify: `apps/web/src/pages/equity/EquityViewPage.tsx` (~บรรทัด 183–215 ตาราง `doc.lines`)
- Test: `apps/web/src/pages/__tests__/headerNowrap.test.ts` (เพิ่ม describe)

**Interfaces:** ไม่มี

- [ ] **Step 1: เทสต์ล้มก่อน** — ทุก `<th>` และ `<td>` ของตารางนี้มี `px-2` (คอลัมน์แรกยังชิดซ้ายกรอบ: `pl-0 pr-2` ได้) และ `<th>` ยังมี `whitespace-nowrap`

```ts
describe('EquityViewPage lines table — cells have horizontal padding', () => {
  const src = read('equity/EquityViewPage.tsx');
  const table = src.slice(src.indexOf('doc.lines.map') - 900, src.indexOf('doc.lines.map') + 900);
  it.each([...table.matchAll(/<(th|td) className="([^"]*)"/g)].map((m) => [m[1], m[2]]))('%s %s has px-2 or pr-2', (_tag, cls) => {
    expect(/\b(px-2|pr-2)\b/.test(cls)).toBe(true);
  });
  it('th still nowrap', () => {
    for (const m of table.matchAll(/<th className="([^"]*)"/g)) expect(m[1]).toContain('whitespace-nowrap');
  });
});
```

- [ ] **Step 2: รัน** `npm --prefix apps/web run test -- headerNowrap` → FAIL
- [ ] **Step 3: แก้** — `<th>`/`<td>` คอลัมน์แรก `pr-2` · คอลัมน์อื่น `px-2` (ไม่เปลี่ยน `text-right font-mono py-2`)
- [ ] **Step 4: รันเทสต์ซ้ำ** → PASS · tsc 0 · Doc guard `exit=1`
- [ ] **Step 5: Commit** `fix(web): equity view table cells get horizontal padding so nowrap headers read apart (round 4 item 2)`

### Task 3: ป้าย "ดูอย่างเดียว" ย้ายออกจากแท็บไปหัวแผงใบจ่าย

**Files:**
- Modify: `apps/web/src/pages/CommissionsPage.tsx` — ลบ `<span … ดูอย่างเดียว</span>` ออกจากปุ่มแท็บ `ใบจ่ายรายเดือน` (~บรรทัด 500–503) และใส่ป้ายเดียวกัน (คลาสเดิมทุกตัว) เป็นลูกตัวแรกของ `<div className="flex gap-3 mb-4 flex-wrap items-center">` ในส่วน PAYOUTS TAB (~บรรทัด 595)
- Test: `apps/web/src/pages/__tests__/tabsButtonRowsNowrap.test.ts` (แก้ describe ของ Commissions ที่มีอยู่)

**Interfaces:** ไม่มี

- [ ] **Step 1: เทสต์ล้มก่อน**

```ts
it('"ดูอย่างเดียว" badge lives in the payouts panel header, not inside the tab button', () => {
  const src = read('pages/CommissionsPage.tsx');
  const tabIdx = src.indexOf('ใบจ่ายรายเดือน\n'); // label text inside the tab button
  const badgeIdx = src.indexOf('ดูอย่างเดียว\n');
  const payoutsIdx = src.indexOf("activeTab === 'payouts' && (");
  expect(badgeIdx).toBeGreaterThan(payoutsIdx);
  expect(src.slice(tabIdx, tabIdx + 400)).not.toContain('ดูอย่างเดียว');
  expect(classBefore(src, 'ดูอย่างเดียว\n', '<span')).toContain('whitespace-nowrap');
});
```
(ข้อความ `ดูอย่างเดียว` ใน comment ไม่ลงท้ายด้วย `\n` ทันที — ถ้าชน ให้ anchor ด้วย `<Eye className="size-3 shrink-0"`)

- [ ] **Step 2: รัน** `npm --prefix apps/web run test -- tabsButtonRowsNowrap` → FAIL
- [ ] **Step 3: แก้** ตาม Files
- [ ] **Step 4: รันเทสต์ซ้ำ** → PASS · tsc 0 · Doc guard `exit=1`
- [ ] **Step 5: Commit** `fix(web): commissions read-only badge moves from the tab to the payouts panel header (round 4 item 3)`

### Task 4: กรอบโฟกัสด้านในบนแท็บทุกแบบ

**Files:**
- Modify: `apps/web/src/components/ui/tabs.tsx` — trigger base (~บรรทัด 82): แทน `focus-visible:ring-offset-2` ด้วย `focus-visible:ring-inset focus-visible:ring-offset-0` **เฉพาะ variant `line`** (compound variant); variant `default` คงเดิม
- Modify: ปุ่มแท็บที่วาดเองใน 6 แถบ: `NotificationsPage/index.tsx` · `CommissionsPage.tsx` · `ContractsPage.tsx` · `PurchaseOrdersPage/index.tsx` · `ProductDetailPage/index.tsx` · `ChartOfAccountsPage.tsx` (กลุ่ม FINANCE/SHOP) — เพิ่ม `focus-visible:ring-inset focus-visible:ring-offset-0` ให้ทุกปุ่มในแถบที่มี `overflow-x-auto`
- Test: `apps/web/src/components/ui/__tests__/tabs.test.tsx` (สร้างถ้ายังไม่มี — render test) · `tabsButtonRowsNowrap.test.ts` (ขยายทุก describe ของแถบแท็บ)

**Interfaces:** ไม่มี

- [ ] **Step 1: เทสต์ล้มก่อน** — (ก) render `<Tabs variant="line">` แล้ว trigger มี `ring-inset` และไม่มี `ring-offset-2`; `variant="default"` ยังมี `ring-offset-2` · (ข) source-text: ทุกปุ่มแท็บใน 6 แถบมี `focus-visible:ring-inset`
- [ ] **Step 2: รัน** `npm --prefix apps/web run test -- tabs tabsButtonRowsNowrap` → FAIL
- [ ] **Step 3: แก้** ตาม Files (ห้ามแตะสี/ขนาด/padding)
- [ ] **Step 4: รันเทสต์ซ้ำ** → PASS · tsc 0 · eslint ไฟล์ที่แก้ · Doc guard `exit=1`
- [ ] **Step 5: Commit** `fix(web): inset focus ring on scrollable tab bars so keyboard focus is not clipped (round 4 item 4)`

### Task 5: แท็บที่เลือกเลื่อนเข้าจอเองตอนเปิดหน้า (`/contracts`)

**Files:**
- Modify: `apps/web/src/pages/ContractsPage.tsx` — แถบแท็บ ~บรรทัด 346; เพิ่ม `ref` บนแถบ + `useEffect` ที่ทำงานเมื่อ `viewTab` เปลี่ยน
- Test: `apps/web/src/pages/__tests__/tabsButtonRowsNowrap.test.ts` (เพิ่ม describe)

**Interfaces:** ไม่มี

- [ ] **Step 1: เทสต์ล้มก่อน**

```ts
describe('ContractsPage keeps the selected tab in view', () => {
  const src = read('pages/ContractsPage.tsx');
  it('scrolls the active tab into view with nearest/nearest only when the bar overflows', () => {
    expect(src).toMatch(/scrollIntoView\(\{\s*block:\s*'nearest',\s*inline:\s*'nearest'\s*\}\)/);
    expect(src).toMatch(/scrollWidth\s*>\s*\w+\.clientWidth/);
    expect(src).toMatch(/\[data-state="active"\]|aria-selected="true"|aria-pressed/);
  });
});
```

- [ ] **Step 2: รัน** → FAIL
- [ ] **Step 3: แก้** — `const tabBarRef = useRef<HTMLDivElement>(null)`; `useEffect(() => { const bar = tabBarRef.current; if (!bar || bar.scrollWidth <= bar.clientWidth) return; bar.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [viewTab]);` — ปุ่มแท็บต้องมี `aria-pressed={viewTab === tab.key}` (เพิ่มถ้ายังไม่มี) · ห้ามใช้ `behavior: 'smooth'` (ตอนเปิดหน้า)
- [ ] **Step 4: รันเทสต์ซ้ำ** → PASS · tsc 0 · Doc guard `exit=1`
- [ ] **Step 5: Commit** `fix(web): contracts tab bar scrolls the deep-linked tab into view (round 4 item 6)`

### Task 6: วัดซ้ำทั้งระบบ + รายงาน + bump version + PR

**Files:**
- Create: `docs/reports/typography-ui-fixes-2026-11/round4.md` (ไทย, เขียนด้วยมือ) · อัปเดต `findings.json` ในโฟลเดอร์เดียวกันจาก CLI
- Modify: `apps/web/package.json` (26.11.7 → 26.11.8)

- [ ] **Step 1: วัดทั้งระบบที่ HEAD** — owner + salesA: `NODE_OPTIONS=--max-old-space-size=6144 UXUI_TYPOGRAPHY=1 UXUI_POPULATED=1 UXUI_INVENTORY=<abs>/docs/reports/typography-scale-audit-2026-11/admin-inventory.json UXUI_ROLE=<owner|salesA> DOCS_QA_OUTPUT=.tmp/typo-r4/admin-after-<role> npm run docs:check -- uxui-pages.browser.docs-spec` · Expected: `Tests: 3 passed` ทั้งสอง role · สถานะหน้า owner `rendered 1314 / document 42 / redirected 318`, salesA `726 / 42 / 906` (เท่ารอบ 3)
- [ ] **Step 2: report.mjs** — "ก่อน" = ชุดวัดรอบ 3 (`.tmp/typo-r3/admin-after-*` ใน worktree `typography-ui-fixes` ถ้ายังอยู่ ไม่งั้นใช้ชุด AFTER ของรายงานตรวจ `typography-scale-audit/.tmp/typo-audit/admin-after-*` แล้วระบุในรายงาน) · "หลัง" = `.tmp/typo-r4/*` · หน้าร้านใช้ `.tmp/typo-final/shop-after` ทั้งสองฝั่ง (รอบนี้ไม่แตะหน้าร้าน) · Expected: R5 บน `/products/:id` "ขึ้นเว็บ" หาย 4 ครั้ง · added P1/P2 ไม่เพิ่มจากรอบ 3 (P2 3 = ป้ายหน้าร้านเดิม) · `inventory-results.json` ความกว้างหน้าเท่ารอบ 3 ทุกชุด
- [ ] **Step 3: ภาพตรวจ** — ตัดภาพก่อน|หลัง ที่ 320/390 ทั้งสองธีม: ปุ่ม "ขึ้นเว็บ" · ตารางใบส่วนของเจ้าของ (ยังเป็นตารางหรือกลายเป็นการ์ด — Review Focus 3) · หัวแผงใบจ่าย `/commissions` แท็บ payouts (harness เก็บเฉพาะแท็บแรก ⇒ ถ้าไม่เห็น ให้ระบุว่าตรวจจากโค้ด) · เก็บใน `.tmp/` ไม่ commit
- [ ] **Step 4: เขียน `round4.md`** — ทำอะไร 6 ข้อ · ตัวเลขก่อน/หลัง · ภาพตรวจเป็นคำ · สิ่งที่ตรวจไม่ได้ด้วยเครื่อง (กรอบโฟกัส · scrollIntoView) ระบุว่าปักด้วยเทสต์ · bump version
- [ ] **Step 5: ตรวจรวม** — `npm --prefix apps/web run test` · tsc · `node --test 'tools/typography-audit/*.test.mjs'` · Doc guard `exit=1` · commit · push · `gh pr create --base main` · เก็บผล `gh pr checks` ลงตัวแปรก่อนตรวจ (`OUT=$(gh pr checks N)`) · **ห้าม merge/deploy เอง**
