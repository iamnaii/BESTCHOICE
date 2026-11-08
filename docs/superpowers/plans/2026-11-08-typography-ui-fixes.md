# Typography UI Fixes (owner-approved after the scale audit) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** แก้หน้าตาเฉพาะจุดที่เจ้าของเคาะหลังรายงานตรวจสเกลตัวอักษร (2026-11-08): ป้าย/ชิปคำสั้นไม่ตัดบรรทัด · หัวตารางไม่ตัดบรรทัด + ตารางเลื่อนแนวนอน · หัวข้อ `/landing` และป้าย LIFF 10px · ปุ่มที่เล็กกว่าเกณฑ์แบบบ้าน — แล้ววัดซ้ำด้วยเครื่องมือตรวจชุดเดิมให้เห็นว่าจุดที่แก้หายจริงและไม่มีอะไรพังเพิ่ม

**Architecture:** แก้ที่คอมโพเนนต์ร่วมก่อน (`Badge`, `TableHead`, ปุ่มเรียงใน `DataTable`) แล้วค่อยแก้รายจุดที่เหลือ · ทุก Task มีเทสต์ vitest ที่ปักคลาสสำคัญ · ตรวจผลด้วย harness ตรวจตัวอักษร (`UXUI_TYPOGRAPHY=1`) + `tools/typography-audit/report.mjs` โดยใช้ผล AFTER ของรายงานตรวจเป็น "ก่อน" และผลหลังแก้เป็น "หลัง"

**Tech Stack:** React 19 + Tailwind v4 + shadcn/ui (`apps/web`, `apps/web-shop`) · vitest · harness `apps/api/e2e/documents/uxui-pages.browser.docs-spec.ts` + `npm run docs:check` · `tools/typography-audit/*`

**Spec:** คำตัดสินเจ้าของท้าย `docs/reports/typography-scale-audit-2026-11/summary.md` หัวข้อ "ตรวจด้วยตา" (ข้อ 2, 3, 4, 5) + `findings.json` (`persisting` R5/R7/R3/R4) · สเปคฟอนต์เดิม `docs/superpowers/specs/2026-11-08-typography-noto-sans-thai-design.md` §4 (ไฟล์ห้ามแตะ)

## Global Constraints

- ฐานงาน: branch `chore/typography-ui-fixes` แตกจาก `chore/typography-scale-audit` (ต้องใช้เครื่องมือตรวจในนั้น) · PR เป็น stacked PR (base = `chore/typography-scale-audit`) จนกว่า PR ตรวจจะ merge แล้วค่อยเปลี่ยน base เป็น `main`
- worktree ใหม่ใต้ `.claude/worktrees/` · `git -C <path>` เท่านั้น · ห้ามรันอะไรใน checkout หลัก
- **ห้ามแตะเอกสารถึงลูกค้า** (คำสั่ง 2026-11-08): ไฟล์ใน spec §4 ทั้งหมด และทุกอย่างใต้ `.voucher-sheet, .document-sheet, .bc-document, .document-landscape, .document-print-dialog, .template-paper, .font-sarabun, .mobile-receipt, .sticker, .print-stickers, .tiptap, .parcel-label, .contract-body` — Doc guard ของแผนฟอนต์เดิมต้องได้ `exit=1` ก่อนทุก commit
- ไม่แก้ข้อ 1 (ตัวอักษรเยื้องขึ้น 1–2.5px — เจ้าของเคาะไม่แก้) · ไม่แก้ `--text-*--line-height` ทั้งแอป · ไม่แก้ `--font-*`
- ใช้โทเคนสีเดิม (`frontend.md`) · ข้อความไทยห้าม `leading-none` · ไม่เพิ่ม dependency
- เกณฑ์ปุ่ม (แบบบ้าน, เจ้าของเคาะ): มือถือ (≤ 430px) ≥ 44px · จอใหญ่ (≥ 768px) ≥ 32px · ปุ่มคอมโพเนนต์ `Button` มี `max-lg:min-h-11` อยู่แล้ว — อย่าซ้ำ
- bump `version` ใน `apps/web/package.json` (+1) และถ้าแตะ web-shop ให้ bump `apps/web-shop/package.json` ด้วย (กติกา bump ทุก deploy)
- จบที่เปิด PR · ห้าม merge/deploy เอง

## Review Focus

1. **ป้ายที่ตั้งใจให้ยาว/ตัดด้วย "…"** (เช่น ป้ายชื่อสินค้าในการ์ด) — `whitespace-nowrap` ที่ `Badge` ต้องไม่ทำให้ป้ายยาวดันการ์ดล้นแนวนอน: ป้ายที่มี `truncate`/`max-w-*` อยู่แล้วต้องยังตัดด้วย "…" (เทสต์ใน Task 1)
2. **ตารางในกล่องแคบบนมือถือ 320px** — หัวตารางไม่ตัดบรรทัดแล้วต้องเลื่อนในกรอบตาราง ไม่ใช่ทั้งหน้าเลื่อนแนวนอน (`document.documentElement.scrollWidth <= innerWidth + 1` ที่ 320 บนหน้าที่แก้ — ตรวจใน Task 5)
3. **ตารางสิทธิ์ `/settings/access` (หัวคอลัมน์ยาว 7 หน้า)** — หลังห้ามตัดบรรทัด ต้องอ่านได้ด้วยการเลื่อนในกรอบ ไม่ล้นทับเมนู (ภาพตรวจ Task 5)
4. **ปุ่มลิงก์ "กลับ…" บนมือถือ** — เพิ่มพื้นที่กดให้ ≥ 44px โดยไม่ขยับข้อความ/ไอคอนจนเลย์เอาต์หัวหน้าเพี้ยน (ภาพตรวจ Task 4)
5. **ธีมมืด** — ทุกจุดที่แก้ต้องตรวจทั้งสว่าง/มืด (harness วัดทั้งสองธีมอยู่แล้ว)

---

### Task 1: ป้าย/ชิปคำสั้นไม่ตัดบรรทัด

**Files:**
- Modify: `apps/web/src/components/ui/badge.tsx` (`badgeVariants` base classes)
- Modify (web-shop, ป้าย "ประกันร้าน N วัน" ตัดบรรทัดบน `/`, `/products`, `/products/:id`): หาคอมโพเนนต์ป้ายที่ render ข้อความนี้ใน `apps/web-shop/src/components/` (ผู้ต้องสงสัย: `catalog/*`) แล้วใส่ `whitespace-nowrap`
- Modify: ป้ายที่ไม่ได้ใช้ `Badge` แต่ถูกฟ้องในรายงาน — "เปิดใช้งาน" (`/suppliers/:id` ที่ 320) และ "ใช้งาน"/"ไม่ใช้งาน" (`/branches`, `/settings/access/account-roles`, `/settings/accounting/chart`) ถ้าไม่ได้มาจาก `Badge`
- Test: `apps/web/src/components/ui/__tests__/badge.test.tsx` (สร้างถ้ายังไม่มี) · web-shop ข้างไฟล์คอมโพเนนต์

- [ ] **Step 1: เทสต์ที่ล้ม** — `renders a Badge whose class list includes whitespace-nowrap` (ทุก size) · `keeps truncate when the caller passes truncate` (`<Badge className="truncate max-w-24">` ยังมีทั้ง `truncate` และ `max-w-24`)
- [ ] **Step 2: รันให้ล้ม** — `npm --prefix apps/web run test -- badge` · Expected: FAIL
- [ ] **Step 3: แก้** — เพิ่ม `whitespace-nowrap` ใน base ของ `badgeVariants` · ป้ายนอก `Badge` ที่ถูกฟ้อง ใส่ `whitespace-nowrap` ตรงจุด
- [ ] **Step 4: รันให้ผ่าน** + Doc guard `exit=1`
- [ ] **Step 5: Commit** — `fix(web): short badges and chips never wrap (typography audit item 2)`

### Task 2: หัวตารางไม่ตัดบรรทัด + ตารางเลื่อนแนวนอน

**Files:**
- Modify: `apps/web/src/components/ui/table.tsx` (`TableHead` classes) — wrapper มี `overflow-auto` อยู่แล้ว (บรรทัด 7) ห้ามลบ
- Modify: `apps/web/src/components/ui/DataTable.tsx` (ปุ่มเรียงในหัวตาราง — ข้อความ "สาขา" "สถานะ" "ราคาเต็มจำนวน" ฯลฯ ขึ้นหลายบรรทัด และสูง 24px)
- Modify: ตารางที่ไม่ได้ใช้ `TableHead` แต่ถูกฟ้อง R5 `th` — ตารางสิทธิ์ใน `/settings/access` (หัว "รายจ่าย: บันทึก & POST" ฯลฯ · หาไฟล์ด้วย `grep -rn "อนุโลมยอดชำระ" apps/web/src`), `/finance/wht`, `/finance/vat-auto-journal`, `/expenses/:id`
- Test: `apps/web/src/components/ui/__tests__/table.test.tsx`, `DataTable` test ข้างไฟล์

- [ ] **Step 1: เทสต์ที่ล้ม** — `TableHead has whitespace-nowrap` · `DataTable sort button has whitespace-nowrap and min height 32px on desktop` (คลาส `lg:min-h-8` หรือ `h-8` — เลือกหนึ่งและปักในเทสต์) · `Table wrapper keeps overflow-auto`
- [ ] **Step 2: รันให้ล้ม** · Expected: FAIL
- [ ] **Step 3: แก้** `TableHead` + ปุ่มเรียง + ตารางนอกคอมโพเนนต์ที่ระบุ
- [ ] **Step 4: รันให้ผ่าน** + Doc guard `exit=1`
- [ ] **Step 5: Commit** — `fix(web): table headers never wrap; tables scroll horizontally (typography audit item 3)`

### Task 3: หัวข้อ `/landing` และป้าย LIFF 10px

**Files:**
- Modify: `apps/web/src/pages/LandingPage.tsx` (หัวข้อ `text-4xl` ที่บรรทัด ~269 และหัวข้อส่วนอื่นที่ระยะ ×1.11: "สินค้า" "แนะนำ" "บริการ" "ของเรา" "ช่องทาง" "ติดต่อ")
- Modify: `apps/web/src/pages/liff/LiffHistory.tsx:387` (ป้าย/ปุ่ม "ใบเสร็จ" 10px ระยะ ×1.0)
- Test: vitest ข้างหน้าที่แก้ (render แล้วตรวจคลาส)

- [ ] **Step 1: เทสต์ที่ล้ม** — `landing section headings use leading-[1.3]` · `LIFF receipt pill uses text-xs and no leading-none`
- [ ] **Step 2: รันให้ล้ม**
- [ ] **Step 3: แก้** — หัวข้อ landing: `leading-[1.3]` (เฉพาะหน้า ไม่แก้โทเคน) · ป้าย LIFF: `text-xs` (12px) ระยะ `leading-normal` · ปุ่มสูงขึ้นตามได้
- [ ] **Step 4: รันให้ผ่าน** + Doc guard
- [ ] **Step 5: Commit** — `fix(web): roomier landing headings and 12px LIFF receipt pill (typography audit item 4)`

### Task 4: ปุ่มที่เล็กกว่าเกณฑ์แบบบ้าน

**Files (จาก `findings.json` → `persisting` R7 · รายการเต็มเรียงตามจำนวนหน้า):**
- มือถือ < 44px: ปุ่ม "แก้ไข" 26px บนหน้าตั้งค่า (9 หน้า `/settings/*` — หาไฟล์จากข้อความ) · ลิงก์ "กลับ" / "กลับไปหน้ารายการ" / "กลับไปรายการผู้ใช้" 18–21px (`apps/web/src/pages/assets/AssetEntryPage.tsx`, `apps/web/src/pages/other-income/OtherIncomeEntryPage.tsx`, หน้า `/users/new` `/users/:id`, `/inspections/:id`, `/expenses/favorites`, ใบรับสินค้า print) · LIFF "แสดงอีก N งวด" 17px (`apps/web/src/pages/liff/LiffContract.tsx:710`) · LIFF "← กลับไปดูสัญญา" 19px (`/liff/branches`, `/liff/receipts`) · ปุ่มสลับ "ตามรุ่น"/"ตามหมวด" 36px บนแดชบอร์ด
- จอใหญ่ < 32px: ปุ่มเรียงหัวตาราง 24px (แก้แล้วใน Task 2) · ลิงก์ "กลับ…" ชุดเดียวกับข้างบน · ปุ่มข้อความใน `/assets/new` `/assets/:id/edit` `/settings/finance/interest` `/settings/products/pricing` `/settings/comms/dunning` `/products/create` `/products/:id`
- ปุ่มที่เป็นข้อมูลทดสอบ (`TEST-UI-DOCS-…`) — เป็นลิงก์รหัสในตาราง ใช้ร่วมกับ R5 ข้อความยาว · ไม่แก้ (ข้อมูลสังเคราะห์)
- Test: vitest ข้างแต่ละคอมโพเนนต์ที่แก้

- [ ] **Step 1: เทสต์ที่ล้ม** — แต่ละปุ่มที่แก้มีคลาสพื้นที่กด `max-lg:min-h-11` (มือถือ) และ `lg:min-h-8` (จอใหญ่) หรือใช้ `Button` size ที่มีอยู่แล้ว
- [ ] **Step 2: รันให้ล้ม**
- [ ] **Step 3: แก้** — ลิงก์/ปุ่มข้อความ: `inline-flex items-center max-lg:min-h-11 lg:min-h-8` (เพิ่มพื้นที่กด ไม่เพิ่มขนาดตัวอักษร) · ปุ่มที่ใช้ `<button>` ดิบให้เปลี่ยนเป็น `Button` ถ้าทำได้โดยหน้าตาไม่เปลี่ยน
- [ ] **Step 4: รันให้ผ่าน** + Doc guard
- [ ] **Step 5: Commit** — `fix(web): touch targets meet the house minimum (44px mobile, 32px desktop) (typography audit item 5)`

### Task 5: วัดซ้ำ + รายงานก่อน/หลังการแก้ + PR

**Files:**
- Create: `docs/reports/typography-ui-fixes-2026-11/summary.md`, `findings.json` (ผลจาก `report.mjs`)
- Modify: `apps/web/package.json` (+1 version) · `apps/web-shop/package.json` (+1 ถ้า Task 1 แตะ web-shop)

- [ ] **Step 1: ชุดเล็ก** — `UXUI_TYPOGRAPHY=1 UXUI_POPULATED=1 UXUI_INVENTORY=$PWD/docs/reports/typography-scale-audit-2026-11/admin-inventory.json UXUI_ROWS=<ids ของ /users,/after-sales,/settings/access,/landing,/liff/contract> UXUI_WIDTHS=390 NODE_OPTIONS=--max-old-space-size=6144 npm run docs:check -- uxui-pages.browser.docs-spec` · Expected: PASS, 0 error
- [ ] **Step 2: เต็ม** — owner + salesA × 1440/390/320 × 2 ธีม (คำสั่งเดียวกับรายงานตรวจ) + หน้าร้าน (build:prerender ด้วย `PRERENDER_API_BASE=http://127.0.0.1:9` แล้ว `TYPOGRAPHY_AUDIT=1 npx playwright test -c e2e/typography-audit.config.ts`)
- [ ] **Step 3: รายงาน** — `node tools/typography-audit/report.mjs` โดย "ก่อน" = โฟลเดอร์ AFTER ของรายงานตรวจ (`.tmp/typo-audit/admin-after-*`, `shop-after`) และ "หลัง" = ผลวัดใหม่ · Expected: R5 ของป้าย/หัวตารางที่แก้อยู่ใน "หายไปหลังเปลี่ยน" · R7 ที่แก้หาย · **added P1/P2 = 0** · หน้าไม่ล้นแนวนอน (`overflow` ของ harness = false) บนหน้าที่แก้ที่ 320
- [ ] **Step 4: ภาพตรวจ** — ตัดภาพก่อน|หลังของทุกจุดใน Task 1–4 ทั้งสองธีม (สคริปต์ตัดภาพเดียวกับรายงานตรวจ) แนบสรุปท้าย `summary.md`
- [ ] **Step 5: ตรวจรวม + PR** — `npm --prefix apps/web run test` · `npm --prefix apps/web-shop run test` · `node --test 'tools/typography-audit/*.test.mjs'` · Doc guard `exit=1` · push · `gh pr create --base chore/typography-scale-audit` (stacked) · เก็บผล `gh pr checks` ลงตัวแปรก่อนตรวจ · **ห้าม merge/deploy เอง**
