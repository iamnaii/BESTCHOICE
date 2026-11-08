# Typography Scale & Proportion Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ตรวจ "สเกล" (ขนาด/ลำดับชั้นตัวอักษร) และ "ความสมส่วน" (ระยะบรรทัด ปุ่ม/ชิปเทียบตัวอักษร ไอคอน ความยาวบรรทัด การล้น/ตัด/ขึ้นบรรทัด) ของ**ทุกหน้า**ใน bestchoicephone.com (`apps/web-shop`) และ bestchoicephone.app (`apps/web` + LIFF) หลังเปลี่ยนเป็น Noto Sans Thai แบบไม่มีหัว (PR #1776) แล้วแยกให้ได้ว่าปัญหาไหน**เกิดจากฟอนต์ใหม่**และปัญหาไหนมีอยู่ก่อน

**Architecture:** วัดด้วยเบราว์เซอร์จริงทุก route × ความกว้าง แล้วตัดสินด้วยกฎที่เป็นฟังก์ชันบริสุทธิ์ (เทสต์ได้) และวัดสองรอบ: BEFORE = `70eb82556` (Looped) กับ AFTER = branch ฐาน เพื่อแยกปัญหาใหม่ออกจากของเดิม
- **ตัวเก็บข้อมูล:** `tools/typography-audit/collect.js` ฉีดเข้าหน้า ใช้ร่วมกันทั้งสองแอป
- **หลังบ้าน + LIFF:** ต่อเข้า harness เดิม `apps/api/e2e/documents/uxui-pages.browser.docs-spec.ts` หลัง flag `UXUI_TYPOGRAPHY=1` (DB ชั่วคราวของ `npm run docs:check`)
- **หน้าร้าน:** spec ใหม่ใน `apps/web-shop/e2e/` ใช้ API fixture แบบ `catalog-origin.spec.ts`
- **ผลลัพธ์:** รายงาน + contact sheet + design canvas ของข้อเสนอแก้ แล้ว**หยุดให้เจ้าของเคาะ** — แผนนี้ไม่แก้หน้าตาแอป

**Tech Stack:** Node 24 `node:test` · Playwright (`@playwright/test` ใน node_modules) · Jest docs harness (`npm run docs:check`) · Vite preview · ui-ux-pro-max (`--domain ux|typography` เท่านั้น)

**Spec:** `docs/superpowers/specs/2026-11-08-typography-noto-sans-thai-design.md` (บทบาทฟอนต์ §3, คำตัดสินแก้ไขครั้งที่ 2) · เกณฑ์ตรวจของแผนนี้อยู่ใน Global Constraints (ตัวเลขจาก ui-ux-pro-max 2026-11-08 + โทเคนจริงของแอป)

## Global Constraints

- **ฐานงาน:** ถ้า PR #1776 merge แล้ว แตกจาก `origin/main` · ถ้ายังไม่ merge แตกจาก `origin/feat/typography-noto-sans-thai`
  - worktree ใหม่ใต้ `.claude/worktrees/` branch `chore/typography-scale-audit`
  - ใช้ `git -C <path>` ตลอด ห้ามรันอะไรใน checkout หลัก ห้ามสลับ branch ของมัน
- **BEFORE:** commit `70eb82556` (origin/main ก่อน #1776 · Noto Sans Thai Looped)
  - รันใน worktree ชั่วคราวที่ copy เฉพาะไฟล์ตรวจของแผนนี้ทับ (ไม่ commit) แล้วลบทิ้ง
- **ความกว้างที่วัด:** 1440 · 390 · 320 ธีมสว่าง (ธีมมืดไม่อยู่ในขอบเขต) · "ทุกหน้า" ต้องครบ 3 ชุด:
  1. หลังบ้าน: inventory `docs/reports/uxui-2026-10-14/acceptance-routes.json` รวมกับ route ที่ขาด (ตรวจใน Task 3 — ณ 2026-11-08 ขาด `/attendance`, `/attendance/me`, `/expenses/recurring-bills`, `/kiosk`, `/r/:token`, `/sales/:id/parcel-label` และ nested `:itemId`)
  2. LIFF 12 route `/liff*`
  3. หน้าร้าน 40 `path=` ใน `apps/web-shop/src/App.tsx` (ยกเว้น `*` และ `/auth/line-callback`)
- **ส่วนเอกสารไม่วัด ไม่แก้** — selector ยกเว้นชุดเดียวกับ guard (copy ตามนี้): `.voucher-sheet, .document-sheet, .bc-document, .document-landscape, .document-print-dialog, .template-paper, .font-sarabun, .mobile-receipt, .sticker, .print-stickers, .tiptap, iframe, svg`
- **สเกลที่อนุญาต (px, ±0.5):**
  - web = `12 13 14 16 18 20 22 24 30 36` (โทเคน `@theme` ของ `apps/web/src/index.css` · 11px ถูก guard ยกเป็น 12 · 22 = `#main h1` จอ <1024)
  - shop = `12 14 16 18 20 24 30 36 48` (โทเคน `apps/web-shop/src/styles/tokens.css`)
- **น้ำหนักที่ส่งจริง:** web 300 400 500 600 700 · shop 400 500 600 700
- **ฟอนต์ที่ถูกต้อง:**
  - UI ขึ้นต้นด้วย `Noto Sans Thai` (ตรวจด้วย `/^["']?Noto Sans Thai["']?,/`)
  - Sarabun มีได้เฉพาะใน `.reading-block` ของ shop · ใน web ห้ามมี
- **ระดับปัญหา:** P1 = ต้องแก้ · P2 = ควรแก้ · P3 = ขัดเกลา · กฎทั้งหมดอยู่ในตารางนี้:
  | กฎ | ตรวจอะไร | ระดับ |
  |---|---|---|
  | R1 | font-size ไม่อยู่ในสเกลของแอป | P3 |
  | R2 | ในหน้าเดียวกัน มี h2/h3 ที่ font-size ใหญ่กว่า h1 | P2 |
  | R3 | line-height ÷ font-size: <20px ต้อง 1.4–1.8 · ≥20px ต้อง 1.2–1.6 · **ข้อความไทย <1.2 = P1** (เสี่ยงตัดสระ) | P2 (ไทย <1.2 = P1) |
  | R4 | ข้อความไทยที่ `overflow-y` hidden/clip และ `scrollHeight > clientHeight + 1` (ถูกตัดแนวตั้ง) | P1 |
  | R5 | ปุ่ม/ชิป/หัวตาราง/เมนู/แท็บ ขึ้น ≥2 บรรทัด (`lines ≥ 2`) | P1 ที่ 1440 · P2 ที่ 390/320 |
  | R6 | ปุ่ม/ชิป/หัวตาราง/เมนู/แท็บ/label ถูกตัดแนวนอน (`scrollWidth > clientWidth + 1` และ overflow hidden) | P2 |
  | R7 | ปุ่ม/ช่องกรอกสูงไม่ถึงเกณฑ์: ≤430px ต้อง ≥44 · ≥768px ต้อง ≥36 | P2 |
  | R7b | ช่องกรอกที่ ≤430px ตัวอักษร <16px (iOS ซูม) | P2 |
  | R8 | ฟอนต์ผิด: UI ไม่ใช่ Noto Sans Thai หรือ Sarabun อยู่นอกที่อนุญาต | P1 |
  | R9 | font-weight ไม่อยู่ในชุดที่ส่งจริง | P3 |
  | R10 | ตัวเลขล้วน (`/^[\d,.\s฿%+\-–/]+$/`) ใน `td` หรือ font-size ≥20 ไม่มี `tabular-nums` | P3 |
  | R11 | ไอคอน svg ข้างข้อความ ขนาด ÷ font-size นอกช่วง 0.85–1.6 | P3 |
  | R12 | ย่อหน้า ≥2 บรรทัดที่ ≥1280 กว้างเกิน 45em (ui-ux: 65–75 ตัวอักษร/บรรทัด) | P3 |
- **ข้อห้าม:**
  - ไม่แก้หน้าตาแอปในแผนนี้ — ข้อเสนอแก้ต้องผ่าน design canvas และเจ้าของเคาะก่อน (คำสั่ง 2026-09-06)
  - ห้ามแตะไฟล์เอกสารตาม spec §4
  - ห้ามใช้ `--design-system` ของ ui-ux-pro-max
  - ไม่เพิ่ม dependency
- **ข้อมูลในรายงาน:** ใช้ข้อมูลสังเคราะห์ของ harness/fixture เท่านั้น (repo public)
  - commit เฉพาะ `summary.md` + `findings.json` ใต้ `docs/reports/typography-scale-audit-2026-11/`
  - ภาพและ contact sheet อยู่ใน `.tmp/` ไม่ commit
- **ไม่รบกวน CI:** spec/flag ใหม่ทั้งหมดปิดอยู่โดยปริยาย (`UXUI_TYPOGRAPHY`, `TYPOGRAPHY_AUDIT`)
- **จบงาน:** เปิด PR (เครื่องมือ + รายงาน) แล้วหยุด ห้าม merge/deploy เอง

## Review Focus

1. **หน้าที่ render ไม่สำเร็จ (error/loading ค้าง/redirect ไป login) ถูกนับว่า "ผ่าน" เพราะไม่มีข้อความให้วัด** — รายงานต้องแยกสถานะ `rendered | empty | error | redirected` ต่อ route×width และไม่นับ route ที่ไม่ rendered เป็นผ่าน (Task 6 เทสต์ `summarize` ปักไว้)
2. **key ของ finding ไม่เสถียรระหว่าง BEFORE/AFTER** (ข้อความยาวต่างกัน ลำดับ class ต่างกัน) ทำให้ปัญหาเดิมดูเหมือน "ใหม่" — key ใช้ tag + 2 class แรกที่เรียงแล้ว + ข้อความ 24 ตัวแรกที่ตัดช่องว่าง (Task 1 เทสต์ `findingKey stable…`)
3. **ส่วนเอกสารหลุดเข้าการวัด** (portal ของ dialog พิมพ์ · iframe) แล้วถูกเสนอให้แก้ — collector ข้าม subtree ที่ match selector ยกเว้น (Task 2 เทสต์ `excludes document subtrees`)
4. **LIFF ขึ้นหน้า error เพราะไม่มี LINE session** แล้วถูกรายงานว่าผ่าน — ใส่ session ใน `sessionStorage['bcp_liff_session_v1']` + fixture `/line-oa/liff/*` และนับ status ตามข้อ 1 (Task 4)
5. **route ใหม่ที่ไม่อยู่ใน inventory** — Task 3 เทสต์ `adminRouteGaps` และ `shopRoutes covers App.tsx` ปักว่าทุก `path=` ถูกวัด

---

### Task 1: กฎตรวจแบบฟังก์ชันบริสุทธิ์

**Files:**
- Create: `tools/typography-audit/rules.mjs`
- Test: `tools/typography-audit/rules.test.mjs`

**Interfaces:**
- Consumes: รูป `Fact` จาก Task 2 (ประกาศที่นี่ ใช้ทั้งแผน):
  `{ key, tag, kind: 'heading'|'button'|'badge'|'th'|'nav'|'tab'|'input'|'label'|'paragraph'|'text', text, fontSize, lineHeight, fontWeight, fontFamily, numeric, x, y, w, h, lines, clipY, truncated, hasThai, numericOnly, inReadingBlock, iconRatios: number[], headingLevel: number|null }`
- Produces:
  - `PROFILES: { web, shop }` — สเกล/น้ำหนัก/กติกาฟอนต์ตาม Global Constraints
  - `evaluateTypography(facts: Fact[], ctx: { app: 'web'|'shop', width: number, route: string }): Finding[]`
  - `Finding = { rule, severity: 'P1'|'P2'|'P3', route, width, key, text, detail }`
  - `findingKey(f: Finding): string` = `${route}|${width}|${rule}|${key}`
  - `diffFindings(before: Finding[], after: Finding[]): { added, resolved, persisting }`

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** — `node:test` อย่างน้อยกรณีละหนึ่ง (fact ตั้งเองให้เกิด/ไม่เกิดกฎ):
  - `R1 off-scale` — web 15px → P3 · 14px → ไม่มี
  - `R3 Thai cramped` — ไทย 14px lh 15.4 (1.1) → P1 · อังกฤษ lh 1.1 → P2
  - `R4 clipped Thai` — `clipY: true, hasThai: true` → P1
  - `R5 wrapped button` — `kind:'button', lines:2` ที่ 1440 → P1 · ที่ 390 → P2
  - `R7 touch` — ปุ่มสูง 40 ที่ 390 → P2 · ที่ 1440 → ไม่มี
  - `R8 wrong family` — `"Noto Sans Thai Looped", …` → P1 · `"Sarabun", …` ใน web → P1 · ใน shop และ `inReadingBlock` → ไม่มี
  - `R9` — weight 800 ใน shop → P3
  - `R10` — `numericOnly` ใน `td` ไม่มี tnum → P3
  - `R11` — `iconRatios: [2]` → P3
  - `R12` — paragraph w 800 fontSize 16 lines 3 ที่ 1440 → P3 (50em)
  - `diffFindings splits added/resolved/persisting`
  - `findingKey stable across text length and class order` (key สร้างใน collector แต่ปักรูปแบบที่ rules คาดหวัง)
- [ ] **Step 2: รันให้ล้ม** — `node --test tools/typography-audit/rules.test.mjs` · Expected: FAIL (module not found)
- [ ] **Step 3: เขียน `rules.mjs`** ตาม Interfaces และตารางกฎใน Global Constraints (ค่า threshold เป็นค่าคงที่ชื่อชัด ไม่ฝังในเงื่อนไข)
- [ ] **Step 4: รันให้ผ่าน** — คำสั่งเดิม · Expected: PASS ทั้งหมด
- [ ] **Step 5: Commit** — `git -C <wt> add tools/typography-audit/rules.* && git -C <wt> commit -m "chore(tools): typography audit rules (scale, rhythm, clipping, touch, family)"`

### Task 2: ตัวเก็บข้อมูลในเบราว์เซอร์

**Files:**
- Create: `tools/typography-audit/collect.js` (สคริปต์ธรรมดา ไม่มี import — ฉีดด้วย `page.addScriptTag({ path })`)
- Test: `tools/typography-audit/collect.test.mjs`

**Interfaces:**
- Produces: `window.__collectTypography({ exclude: string, root?: string }): Fact[]`
  - ใช้กับเฉพาะ element ที่มองเห็นและมี text node ตรง ใน `root` (ค่าเริ่ม `body`)
  - ข้าม subtree ที่ `closest(exclude)`
  - วิธีคำนวณแต่ละช่อง:
    - `lines` = `Math.round(h / lineHeightPx)`
    - `clipY` = overflow-y hidden/clip และ `scrollHeight > clientHeight + 1`
    - `truncated` = overflow-x hidden/clip และ `scrollWidth > clientWidth + 1`
    - `hasThai` = `/[฀-๿]/`
    - `kind` จาก tag/role/data-slot: `button`/`[role=button]` · `[data-slot=badge]` หรือ class `rounded-full` + font ≤13px · `th` · `nav a` · `[role=tab]` · `input/select/textarea/[role=combobox]` · `label` · `p` · `h1–h6`
    - `iconRatios` = ขนาด svg ลูกตรง ÷ fontSize
    - `headingLevel` = เลขจาก tag `h1`–`h6` (อื่น ๆ = `null`)
    - `key` = tag + 2 class แรก (เรียงตามตัวอักษร) + ข้อความ 24 ตัวแรก (ตัดช่องว่างซ้ำ)
  - ข้อความใช้ได้แค่ 60 ตัวแรก และไม่เก็บค่า input

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** — เปิด chromium จาก `@playwright/test` · `page.setContent()` HTML ทดสอบที่โหลด `apps/web/public/fonts/noto-sans-thai/fonts.css` ผ่าน `file://` · `addScriptTag(collect.js)` แล้ว assert:
  - `wrapped button` — ปุ่มกว้าง 60px ข้อความไทยยาว → `lines ≥ 2`, `kind:'button'`
  - `clipped Thai` — div `overflow:hidden; height:14px; line-height:14px; font-size:16px` ข้อความ "ปุ่ม" → `clipY:true, hasThai:true`
  - `excludes document subtrees` — ข้อความใน `.template-paper` และ `.sticker` ไม่อยู่ในผล
  - `family and weight captured` — `fontFamily` ขึ้นต้น `"Noto Sans Thai"` · `fontWeight` 600
  - `reading block flag` — ลูกของ `.reading-block` → `inReadingBlock:true`
  - `numeric only` — `<td>1,234.50</td>` → `numericOnly:true`
- [ ] **Step 2: รันให้ล้ม** — `node --test tools/typography-audit/collect.test.mjs` · Expected: FAIL
- [ ] **Step 3: เขียน `collect.js`** ตาม Interfaces
- [ ] **Step 4: รันให้ผ่าน** · Expected: PASS
- [ ] **Step 5: Commit** — `chore(tools): typography audit in-page collector`

### Task 3: ความครบของ route

**Files:**
- Create: `tools/typography-audit/routes.mjs`
- Test: `tools/typography-audit/routes.test.mjs`
- Create (ผลจาก CLI): `docs/reports/typography-scale-audit-2026-11/admin-inventory.json`

**Interfaces:**
- Produces:
  - `appPaths(appTsxSource: string): string[]` — ทุก `path="…"` (เก็บ nested relative ด้วย)
  - `adminRouteGaps(inventoryRows, paths): string[]`
  - `shopRoutes(): Array<{ path, sample }>` — 40 route ของหน้าร้าน พร้อมค่า param ตัวอย่างที่ fixture ของ Task 5 รองรับ (เช่น `/products/:id` → `/products/phone-1`)
  - CLI `node tools/typography-audit/routes.mjs --write-admin-inventory <out>` → `{ rows }` ในรูปที่ `UXUI_INVENTORY` อ่าน (`app:'admin'`, `id`, `path`, `type:'page'`, `component`)
    - รวม October inventory + แถวที่ขาด (id ขึ้นต้น `T`) · nested `:itemId` resolve เป็น path เต็มตาม parent ใน `App.tsx`

- [ ] **Step 1: เทสต์ที่ล้ม**
  - `appPaths reads App.tsx` — นับได้ ≥ 223 สำหรับ apps/web และมี `/kiosk`
  - `adminRouteGaps` — ต้องคืน 7 รายการตาม Global Constraints จากไฟล์จริง ณ ฐานงาน
  - `shopRoutes covers App.tsx` — ทุก `path=` ของ web-shop (ยกเว้น `*`, `/auth/line-callback`) อยู่ใน `shopRoutes()`
- [ ] **Step 2: รันให้ล้ม** · Expected: FAIL
- [ ] **Step 3: เขียน `routes.mjs`** แล้วรัน CLI สร้าง `admin-inventory.json`
- [ ] **Step 4: รันให้ผ่าน** · Expected: PASS
- [ ] **Step 5: Commit** — `chore(tools): typography audit route coverage + admin inventory`

### Task 4: หลังบ้าน + LIFF — เก็บข้อมูลผ่าน harness เดิม

**Files:**
- Modify: `apps/api/e2e/documents/uxui-pages.browser.docs-spec.ts`
  - flag `UXUI_TYPOGRAPHY=1`: หลัง `readyMetrics` ของธีม `light` ให้ `addScriptTag` collector → `saveArtifact` เป็น `typography/route-<no>-<width>.json` รูป `{ route, width, status, facts }` โดย `status` ∈ `rendered|empty|error|redirected`
  - regex ฟอนต์ UI สร้างจาก `UXUI_UI_FONT` (ค่าเริ่ม `Noto Sans Thai`)
- Create: `apps/api/e2e/documents/support/liff-fixtures.ts` — `seedLiffSession(page)` (รูป session อ่านจาก `apps/web/src/hooks/useLiffInit.ts`) + `routeLiffApi(page)` ตอบ `/api/line-oa/liff/{consent,contracts,history,early-payoff-quote,…}` ด้วยข้อมูลสังเคราะห์ · ใช้เฉพาะเมื่อ flag เปิดและ path ขึ้นต้น `/liff`
- ห้ามเปลี่ยนพฤติกรรมเมื่อ flag ปิด (CI)

**Interfaces:**
- Consumes: `collect.js` (Task 2) · `admin-inventory.json` (Task 3) ผ่าน `UXUI_INVENTORY`
- Produces: `<DOCS_QA_OUTPUT>/typography/*.json` + ภาพ `uxui-pages/route-<no>-<width>-light.png` (ของเดิม)

- [ ] **Step 1: รัน spec เดิมแบบ flag ปิดกับแถวตัวอย่าง** — `UXUI_ROWS=1,2 UXUI_WIDTHS=390 npm run docs:check -- uxui-pages.browser.docs-spec` · Expected: PASS (ฐานเดิมยังเขียว)
- [ ] **Step 2: ใส่ hook + LIFF fixture** ตาม Files
- [ ] **Step 3: รันแบบ flag เปิดกับแถวตัวอย่าง** — `UXUI_TYPOGRAPHY=1 UXUI_INVENTORY=<admin-inventory.json> UXUI_ROWS=<no ของ /customers>,<no ของ /liff/contract> UXUI_WIDTHS=390 npm run docs:check -- uxui-pages.browser.docs-spec`
  - Expected: มีไฟล์ `typography/*.json` สองไฟล์ `status:"rendered"` · LIFF มี facts > 0 และไม่ใช่หน้า error
- [ ] **Step 4: รัน AFTER เต็ม** — `UXUI_TYPOGRAPHY=1 UXUI_POPULATED=1 UXUI_INVENTORY=… UXUI_WIDTHS=1440,390,320 DOCS_QA_OUTPUT=$PWD/.tmp/typo-audit/admin-after npm run docs:check -- uxui-pages.browser.docs-spec` · Expected: json ครบทุกแถว × 3 ความกว้าง
- [ ] **Step 5: รัน BEFORE**
  1. `git -C <repo> worktree add <tmp> 70eb82556`
  2. copy `tools/typography-audit/`, `support/liff-fixtures.ts`, `admin-inventory.json` และ spec ที่แก้แล้วทับ
  3. `npm ci` แล้วรันคำสั่งเดียวกันโดยตั้ง `UXUI_UI_FONT='Noto Sans Thai Looped'` และ `DOCS_QA_OUTPUT=…/admin-before`
  4. ลบ worktree
  - Expected: json ครบเหมือน AFTER
- [ ] **Step 6: Commit** — spec + fixture (ไม่รวม .tmp) — `test(e2e): opt-in typography facts for admin + LIFF routes`

### Task 5: หน้าร้าน — spec วัดทุก route

**Files:**
- Create: `apps/web-shop/e2e/typography-audit.spec.ts` (`test.skip` ถ้าไม่มี `TYPOGRAPHY_AUDIT=1`)
- Create: `apps/web-shop/e2e/fixtures/shop-api.ts` — `routeShopApi(page)` ตอบ `/api/**` ด้วยข้อมูลสังเคราะห์ (สินค้า รายละเอียด รุ่น โปรโมชัน รีวิว รับซื้อ/เทิร์น ใบสมัครผ่อน คำสั่งซื้อ)
  - path ที่ไม่รู้จัก → `{}` และจดลง `unmatched` ในผล
  - ต่อยอดรูปแบบ `e2e/catalog-origin.spec.ts`

**Interfaces:**
- Consumes: `shopRoutes()` (Task 3) · `collect.js` (Task 2)
- Produces: `<TYPOGRAPHY_OUT>/shop/route-<slug>-<width>.json` รูปเดียวกับ Task 4 + ภาพ full-page `…-<width>.png`

- [ ] **Step 1: รันกับ route เดียว** — `cd apps/web-shop && TYPOGRAPHY_AUDIT=1 TYPOGRAPHY_ONLY=/how-it-works TYPOGRAPHY_OUT=$PWD/../../.tmp/typo-audit/shop-after npx playwright test e2e/typography-audit.spec.ts`
  - Expected: json 3 ไฟล์ `status:"rendered"` · facts มี Sarabun เฉพาะ `inReadingBlock`
- [ ] **Step 2: รัน AFTER ครบทุก route** (ไม่ตั้ง `TYPOGRAPHY_ONLY`)
  - Expected: json = จำนวน route × 3 · `unmatched` ว่างหรือมีแต่ endpoint ที่หน้านั้นไม่ใช้แสดงผล (จดใน report)
- [ ] **Step 3: รัน BEFORE** — worktree ชั่วคราว `70eb82556` + copy ไฟล์ของ Task 2/3/5 ทับ → `…/shop-before` → ลบ worktree
- [ ] **Step 4: Commit** — `test(web-shop): opt-in typography audit over every storefront route`

### Task 6: รายงาน BEFORE/AFTER

**Files:**
- Create: `tools/typography-audit/report.mjs` · Test: `tools/typography-audit/report.test.mjs`
- Create (ผล): `docs/reports/typography-scale-audit-2026-11/summary.md`, `findings.json` · `.tmp/typo-audit/contact-sheet.html` (ไม่ commit)

**Interfaces:**
- Consumes: `evaluateTypography`, `diffFindings` (Task 1) · โฟลเดอร์ json ของ Task 4–5
- Produces:
  - `summarize(runs): { routes: Array<{ app, route, width, status, counts }>, totals }`
  - CLI `node tools/typography-audit/report.mjs --admin-before … --admin-after … --shop-before … --shop-after … --out docs/reports/typography-scale-audit-2026-11 --sheet .tmp/typo-audit/contact-sheet.html`

- [ ] **Step 1: เทสต์ที่ล้ม**
  - `summarize counts non-rendered separately` — route `status:'error'` ไม่ถูกนับว่าผ่าน และอยู่ในหัวข้อ "ตรวจไม่ได้"
  - `summary lists added P1 first` — ลำดับ: P1 ใหม่ → P2 ใหม่ → P3 ใหม่ → ของเดิม
- [ ] **Step 2: รันให้ล้ม** · Expected: FAIL
- [ ] **Step 3: เขียน `report.mjs`**
  - `summary.md` (ภาษาไทย) มี:
    - จำนวน route×width ต่อแอป แยกตามสถานะ
    - ตาราง "เกิดจากฟอนต์ใหม่" (`added`) แยก P1/P2/P3
    - ตาราง "มีอยู่ก่อน" (`persisting`) สรุปต่อกฎ
    - "หายไปหลังเปลี่ยน" (`resolved`)
    - top 30 จุดพร้อม route/width/ข้อความย่อ/ชื่อภาพ
  - `contact-sheet.html` วางภาพ BEFORE|AFTER คู่กันเฉพาะ route ที่มี added P1/P2
- [ ] **Step 4: รันให้ผ่าน + รัน CLI จริง** · Expected: PASS · ไฟล์ทั้งสามถูกสร้าง
- [ ] **Step 5: Commit** — `docs(report): typography scale & proportion audit 2026-11`

### Task 7: ตรวจด้วยตา + ข้อเสนอแก้ — ด่านเจ้าของ (ทำใน session หลัก ไม่ส่ง subagent)

**Files:**
- Create: design canvas (Artifact type Design canvas) ใต้ scratchpad — ไม่อยู่ใน repo

- [ ] **Step 1: เปิด `contact-sheet.html` ดูทุกคู่ภาพที่มี added P1/P2**
  - ยืนยันหรือปัดตกทีละจุด (ตัวเลขผิดเพราะ fixture/animation = ปัดตก พร้อมเหตุผล)
  - จดผลลงท้าย `summary.md` หัวข้อ "ตรวจด้วยตา"
- [ ] **Step 2: ui-ux-pro-max** — `python3 ~/.claude/skills/ui-ux-pro-max/scripts/search.py "<คำค้นตามชนิดปัญหาที่เจอ>" --domain ux` (และ `--domain typography` ถ้าเรื่องสเกล) 3–5 คำค้น · ห้าม `--design-system`
- [ ] **Step 3: canvas "ปัญหา → ข้อเสนอ"**
  - กระดานละกลุ่มปัญหา เช่น ปุ่มขึ้นบรรทัด หัวตารางล้น ระยะบรรทัดหัวข้อ ไอคอนไม่สมส่วน
  - ลอกโทเคนจริงจากทั้งสองแอป
  - มีภาพเดิม + ข้อเสนอ + sticky บอกไฟล์/คลาสที่จะแก้ และผล ui-ux-pro-max
- [ ] **Step 4: หยุดรอเจ้าของเคาะ** — ส่งลิงก์ canvas + สรุป 3 บรรทัด (เกิดจากฟอนต์กี่จุด / มีอยู่ก่อนกี่จุด / เสนอแก้อะไร)
  - ห้ามแก้หน้าตาแอปก่อนได้คำตอบ
  - การแก้ที่เคาะแล้วเขียนเป็นแผนใหม่ด้วย superpowers:writing-plans

### Task 8: PR เครื่องมือ + รายงาน

- [ ] **Step 1: ตรวจรวม**
  - `node --test tools/typography-audit/` · `npm --prefix apps/web-shop run test` · `npm --prefix apps/web run test`
  - Doc guard ตามแผนเดิม (`docs/superpowers/plans/2026-11-08-typography-noto-sans-thai.md` Global Constraints) ต้องได้ `exit=1`
  - Expected: PASS ทั้งหมด
- [ ] **Step 2: push branch + `gh pr create --base main`**
  - body: สรุปตัวเลขจาก `summary.md` + ลิงก์ canvas + บรรทัด "flag ปิดโดยปริยาย ไม่กระทบ CI"
  - เก็บผล `gh pr checks` ลงตัวแปรก่อนตรวจ (กับดัก pipefail)
  - **ห้าม merge/deploy เอง**
