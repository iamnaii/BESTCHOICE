# Typography Scale & Proportion Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ตรวจ "สเกล" (ขนาด/ลำดับชั้นตัวอักษร) และ "ความสมส่วน" (ระยะบรรทัด ปุ่ม/ชิปเทียบตัวอักษร ไอคอน ความยาวบรรทัด การล้น/ตัด/ขึ้นบรรทัด) ของ**ทุกหน้า**ใน bestchoicephone.com (`apps/web-shop`) และ bestchoicephone.app (`apps/web` + LIFF) หลังเปลี่ยนเป็น Noto Sans Thai แบบไม่มีหัว (PR #1776) — เป็น audit ทั่วไปของทั้งสองแอป (เจ้าของเลือก "ทาง 2" 2026-11-08) ที่แยกได้ว่าปัญหาไหน**เกิดจากฟอนต์ใหม่**และปัญหาไหนมีอยู่ก่อน

**Architecture:** วัดด้วยเบราว์เซอร์จริงทุก route × ความกว้าง × ธีม แล้วตัดสินด้วยกฎที่เป็นฟังก์ชันบริสุทธิ์ (เทสต์ได้) วัดสองรอบ: BEFORE = `70eb82556` (Looped) กับ AFTER = ฐานงาน แล้ว diff ด้วย key ที่ไม่ขึ้นกับคลาส
- **ตัวเก็บข้อมูล:** `tools/typography-audit/collect.js` ฉีดเข้าหน้า ใช้ร่วมกันทั้งสองแอป วัดหมึกตัวอักษรจริง (ไม่ใช่กล่อง)
- **หลังบ้าน + LIFF:** ต่อเข้า harness เดิม `apps/api/e2e/documents/uxui-pages.browser.docs-spec.ts` หลัง flag `UXUI_TYPOGRAPHY=1` (DB ชั่วคราวของ `npm run docs:check`) · วัดสอง role
- **หน้าร้าน:** spec ใหม่ใน `apps/web-shop/e2e/` ใช้ API fixture แบบ `catalog-origin.spec.ts` รันบน **build + prerender** (`dist/`) ไม่ใช่ dev server
- **ผลลัพธ์:** รายงาน + contact sheet + design canvas ของข้อเสนอแก้ แล้ว**หยุดให้เจ้าของเคาะ** — แผนนี้ไม่แก้หน้าตาแอป

**Tech Stack:** Node 24 `node:test` · Playwright (`@playwright/test` ใน node_modules) · Jest docs harness (`npm run docs:check`) · Vite build + `scripts/prerender.mjs` · ui-ux-pro-max (`--domain ux|typography` เท่านั้น)

**Spec:** `docs/superpowers/specs/2026-11-08-typography-noto-sans-thai-design.md` (บทบาทฟอนต์ §3, ไฟล์ห้ามแตะ §4, แก้ไขครั้งที่ 2) · เกณฑ์ตรวจของแผนนี้อยู่ใน Global Constraints (ตัวเลขจาก ui-ux-pro-max 2026-11-08 + โทเคนจริงของแอป) · scrutinize 2 รอบ 2026-11-08 (15 ข้อ) แก้ในฉบับนี้แล้ว

## Global Constraints

- **ฐานงาน:** `gh pr view 1776 --json state` — MERGED → แตกจาก `origin/main` · ไม่งั้น → `origin/feat/typography-noto-sans-thai`
  - worktree ใหม่ใต้ `.claude/worktrees/` branch `chore/typography-scale-audit`
  - ใช้ `git -C <path>` ตลอด ห้ามรันอะไรใน checkout หลัก ห้ามสลับ branch ของมัน
- **BEFORE:** commit `70eb82556` (origin/main ก่อน #1776 · Noto Sans Thai Looped)
  - รันใน worktree ชั่วคราวที่ copy เฉพาะไฟล์ตรวจของแผนนี้ทับ (ไม่ commit) แล้วลบทิ้ง
  - **ก่อน copy ต้องยืนยันว่า `git diff 70eb82556..<ฐานงาน> --stat -- apps/api/e2e/documents/support apps/web/src/hooks/useLiffInit.ts apps/web-shop/e2e apps/web-shop/scripts` ว่าง** (ไฟล์ที่ spec ใหม่พึ่ง) — ไม่ว่าง = หยุด รายงาน
- **ความกว้าง/ธีม:** 1440 · 390 · 320 × ธีม `light` และ `dark` (harness วัดทั้งสองอยู่แล้ว ไม่เพิ่มต้นทุน · หน้าร้านมีแต่ light) · "ทุกหน้า" ต้องครบ 3 ชุด:
  1. หลังบ้าน: inventory `docs/reports/uxui-2026-10-14/acceptance-routes.json` รวมกับ route ที่ขาด (CLI ใน Task 3 รายงานรายการจริง ณ ฐานงาน — ณ 2026-11-08 คาดว่า `/attendance`, `/attendance/me`, `/expenses/recurring-bills`, `/kiosk`) · **วัดสอง role:** `owner` (เดิม) และ `salesA` (เมนู/การ์ดต่างกันตาม role — เห็นใน `work-navigation.ts`) · role อื่น (FM, ACCOUNTANT) ไม่วัด ระบุในรายงาน
  2. LIFF 12 route `/liff*` (role ไม่เกี่ยว — ใช้ session ลูกค้าจำลอง)
  3. หน้าร้าน 40 `path=` ใน `apps/web-shop/src/App.tsx` (ยกเว้น `*` และ `/auth/line-callback`) — `/account*` ต้องมี fixture `AuthContext` (mock endpoint ที่ `apps/web-shop/src/contexts/AuthContext.tsx` เรียก); ถ้าทำไม่ได้ใน Task 5 รายงานเป็น `status:'blocked'` พร้อมเหตุผล ไม่นับผ่าน
- **route เอกสาร — ไม่วัด:** `/r/:token` (ใบเสร็จขายสด) · `/sales/:id/parcel-label` (ป้ายพัสดุ) · `/stickers` · `/verify/*` · `/receipts/verify/*` · `/contract-templates/*` preview — บันทึกเป็น `status:'document'` ในรายงาน
- **ส่วนเอกสารในหน้าอื่นไม่วัด ไม่แก้** — selector ยกเว้น = ชุด guard + `.parcel-label` + `.contract-body`:
  `.voucher-sheet, .document-sheet, .bc-document, .document-landscape, .document-print-dialog, .template-paper, .font-sarabun, .mobile-receipt, .sticker, .print-stickers, .tiptap, .parcel-label, .contract-body, iframe, svg`
- **สเกลที่อนุญาต (px, ±0.5):**
  - web = `12 13 14 16 18 20 22 24 30 36` (โทเคน `@theme` ของ `apps/web/src/index.css` · 11px ถูก guard ยกเป็น 12 · 22 = `#main h1` จอ <1024)
  - shop = `12 14 16 18 20 24 30 36 48` (โทเคน `apps/web-shop/src/styles/tokens.css`)
- **น้ำหนักที่ส่งจริง:** web 300 400 500 600 700 · shop 400 500 600 700
- **ฟอนต์ที่ถูกต้อง:** UI ขึ้นต้นด้วย `Noto Sans Thai` (`/^["']?Noto Sans Thai["']?,/`) · Sarabun มีได้เฉพาะใน `.reading-block` ของ shop · ใน web ห้ามมี
- **การวัดบรรทัด/หมึก (ใช้ทุกกฎที่เกี่ยว):** `lines` = จำนวนค่า `top` ที่ไม่ซ้ำ (±1px) ของ `Range.getClientRects()` ครอบ text node ของ element — **ไม่ใช่** `h ÷ line-height` (ปุ่มมี padding ทำให้สูงกว่าหนึ่งบรรทัด) · `inkHeight`/`inkWidth` = `canvas.measureText(text)` ด้วย font ของ element: `actualBoundingBoxAscent + actualBoundingBoxDescent` / `width`
- **ระดับปัญหา:** P1 = ต้องแก้ · P2 = ควรแก้ · P3 = ขัดเกลา · กฎทั้งหมด:
  | กฎ | ตรวจอะไร | ระดับ | diff ก่อน/หลัง |
  |---|---|---|---|
  | R1 | font-size ไม่อยู่ในสเกลของแอป | P3 | ใช่ |
  | R2 | ในหน้าเดียวกัน มี h2/h3 ที่ font-size ใหญ่กว่า h1 | P2 | ใช่ |
  | R3 | line-height ÷ font-size: <20px ต้อง 1.4–1.8 · ≥20px ต้อง 1.2–1.6 · **ข้อความไทย <1.2 = P1** | P2 (ไทย <1.2 = P1) | ใช่ |
  | R4 | ข้อความไทยถูกตัด: element หรือบรรพบุรุษใกล้สุดที่ `overflow` ไม่ใช่ visible และ `inkHeight > lineHeightPx + 1` (สระ/วรรณยุกต์ล้นบรรทัด) **หรือ** `scrollHeight > clientHeight + 1` | P1 | ใช่ |
  | R5 | ปุ่ม/ชิป/หัวตาราง/เมนู/แท็บ `lines ≥ 2` | P1 ที่ 1440 · P2 ที่ 390/320 | ใช่ |
  | R6 | ปุ่ม/ชิป/หัวตาราง/เมนู/แท็บ/label ถูกตัดแนวนอน (`scrollWidth > clientWidth + 1` และ overflow-x hidden/clip, หรือ `text-overflow: ellipsis` ทำงาน) | P2 | ใช่ |
  | R7 | ปุ่ม/ช่องกรอกสูงไม่ถึงเกณฑ์: ≤430px ต้อง ≥44 · ≥768px ต้อง ≥36 | P2 | ใช่ |
  | R7b | ช่องกรอกที่ ≤430px ตัวอักษร <16px (iOS ซูม) | P2 | ใช่ |
  | R8 | ฟอนต์ผิด: UI ไม่ใช่ Noto Sans Thai หรือ Sarabun อยู่นอกที่อนุญาต | P1 | **ไม่** (ตรวจเฉพาะ AFTER — BEFORE ใช้ Looped โดยนิยาม) |
  | R9 | font-weight ไม่อยู่ในชุดที่ส่งจริง | P3 | ใช่ |
  | R10 | ตัวเลขล้วน (`/^[\d,.\s฿%+\-–/]+$/`) ใน `td` หรือ font-size ≥20 ไม่มี `tabular-nums` | P3 | ใช่ |
  | R11 | ไอคอน svg ข้างข้อความ ขนาด ÷ font-size นอกช่วง 0.85–1.6 | P3 | ใช่ |
  | R12 | ย่อหน้า `lines ≥ 2` ที่ ≥1280 กว้างเกิน 45em (ui-ux: 65–75 ตัวอักษร/บรรทัด) | P3 | ใช่ |
  | **D1** | **(เทียบก่อน/หลังเท่านั้น)** `inkWidth` ของข้อความเดียวกันเปลี่ยน >8% | รายการ "ดูด้วยตา" ไม่ใช่ P | — |
  | **D2** | **(เทียบก่อน/หลังเท่านั้น)** ใน control สูงคงที่ (ปุ่ม/ชิป/input) จุดกึ่งกลางหมึกแนวตั้ง (`y + h/2` ของ text rect) เยื้องจากกึ่งกลางกล่อง >1.5px | รายการ "ดูด้วยตา" | — |
- **key ของ finding (ต้องเสถียรข้ามคลาสที่ #1776 เปลี่ยน):** `route|width|theme|role|rule|kind|<ข้อความ normalize>|<ลำดับซ้ำ>` โดยข้อความ normalize = ตัดช่องว่างซ้ำ แทนตัวเลขทุกตัวด้วย `#` เอา 40 ตัวแรก · **ไม่ใช้ชื่อคลาส** (#1776 เปลี่ยน `text-sm…leading-snug`→`reading-block` และ `font-extrabold`→`font-bold`)
- **งบเวลา/ลำดับรัน:** รันชุดเล็กก่อนเสมอ (`UXUI_ROWS`/`TYPOGRAPHY_ONLY`) · รันเต็มใช้ `UXUI_CONCURRENCY=3` · หนึ่งรอบ admin ≈ 270 route × 3 × 2 ธีม × 2 role ≈ 60–90 นาที → รัน AFTER ก่อน ถ้าเขียวค่อยรัน BEFORE
- **ข้อห้าม:**
  - ไม่แก้หน้าตาแอปในแผนนี้ — ข้อเสนอแก้ต้องผ่าน design canvas และเจ้าของเคาะก่อน (คำสั่ง 2026-09-06)
  - ห้ามแตะไฟล์เอกสารตาม spec §4
  - ห้ามใช้ `--design-system` ของ ui-ux-pro-max
  - ไม่เพิ่ม dependency
- **ข้อมูลในรายงาน:** ข้อมูลสังเคราะห์ของ harness/fixture เท่านั้น (repo public) · commit เฉพาะ `summary.md` + `findings.json` ใต้ `docs/reports/typography-scale-audit-2026-11/` · ภาพและ contact sheet อยู่ใน `.tmp/` ไม่ commit
- **ไม่รบกวน CI:** spec/flag ใหม่ทั้งหมดปิดอยู่โดยปริยาย (`UXUI_TYPOGRAPHY`, `TYPOGRAPHY_AUDIT`)
- **จบงาน:** เปิด PR (เครื่องมือ + รายงาน) แล้วหยุด ห้าม merge/deploy เอง

## Review Focus

1. **หน้าที่ render ไม่สำเร็จถูกนับว่าผ่าน** — รายงานแยกสถานะ `rendered | empty | error | redirected | blocked | document` ต่อ route×width×theme×role และไม่นับสถานะอื่นนอกจาก `rendered` เป็นผ่าน (Task 6 เทสต์ `summarize`)
2. **key เปลี่ยนเพราะคลาสเปลี่ยน** ทำให้ได้คู่ added+resolved ปลอม — key ไม่ใช้คลาส (Task 1 เทสต์ `findingKey ignores class changes`)
3. **ส่วนเอกสารหลุดเข้าการวัด** (portal ของ dialog พิมพ์ · ป้ายพัสดุ · iframe) — collector ข้าม subtree ตาม selector ยกเว้นรวม `.parcel-label` (Task 2 เทสต์ `excludes document subtrees`)
4. **LIFF ขึ้นหน้า error เพราะไม่มี session** — harness เปลี่ยนหน้าด้วย `history.pushState` ดังนั้น `addInitScript` ไม่ทำงาน ต้องตั้ง `sessionStorage['bcp_liff_session_v1']` ด้วย `page.evaluate` ก่อน pushState และลงทะเบียน route mock หลัง catch-all (Task 4 Step 3 ปัก)
5. **ปุ่มทุกปุ่มถูกฟ้อง R5** ถ้านับบรรทัดจากความสูงกล่อง — นับจาก text rect (Task 2 เทสต์ `single-line 40px button → lines 1`)

---

### Task 1: กฎตรวจแบบฟังก์ชันบริสุทธิ์

**Files:**
- Create: `tools/typography-audit/rules.mjs`
- Test: `tools/typography-audit/rules.test.mjs`

**Interfaces:**
- Consumes: รูป `Fact` จาก Task 2 (ประกาศที่นี่ ใช้ทั้งแผน):
  `{ key, tag, kind: 'heading'|'button'|'badge'|'th'|'nav'|'tab'|'input'|'label'|'paragraph'|'text', text, fontSize, lineHeight, fontWeight, fontFamily, numeric, x, y, w, h, lines, textTop, textHeight, inkWidth, inkHeight, overflowClip: 'none'|'x'|'y'|'both', scrollOverflowX, scrollOverflowY, hasThai, numericOnly, inReadingBlock, iconRatios: number[], headingLevel: number|null }`
- Produces:
  - `PROFILES: { web, shop }` — สเกล/น้ำหนัก/กติกาฟอนต์ตาม Global Constraints
  - `evaluateTypography(facts: Fact[], ctx: { app: 'web'|'shop', width: number, theme: string, role: string, route: string }): Finding[]`
  - `Finding = { rule, severity: 'P1'|'P2'|'P3', route, width, theme, role, key, text, detail }`
  - `findingKey(f: Finding): string` ตามสูตรใน Global Constraints
  - `diffFindings(before, after, { excludeRules: ['R8'] }): { added, resolved, persisting }`
  - `compareFacts(beforeFacts, afterFacts): DeltaFinding[]` — D1/D2 จับคู่ด้วย key เดียวกัน

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** — `node:test` อย่างน้อยกรณีละหนึ่ง (fact ตั้งเอง):
  - `R1 off-scale` — web 15px → P3 · 14px → ไม่มี
  - `R3 Thai cramped` — ไทย 14px lh 15.4 → P1 · อังกฤษ lh 1.1 → P2
  - `R4 ink overflow` — `overflowClip:'y', inkHeight: 19, lineHeight: 16, hasThai:true` → P1 · `overflowClip:'none'` → ไม่มี
  - `R5 wrapped button` — `kind:'button', lines:2` ที่ 1440 → P1 · ที่ 390 → P2 · `lines:1` → ไม่มี
  - `R6 truncated` — `kind:'th', overflowClip:'x', scrollOverflowX:true` → P2
  - `R7 touch` — ปุ่มสูง 40 ที่ 390 → P2 · ที่ 1440 → ไม่มี
  - `R8 wrong family` — `"Noto Sans Thai Looped", …` → P1 · `"Sarabun", …` ใน web → P1 · ใน shop และ `inReadingBlock` → ไม่มี
  - `R9` — weight 800 ใน shop → P3 · `R10` — `numericOnly` ใน `td` ไม่มี tnum → P3 · `R11` — `iconRatios: [2]` → P3 · `R12` — paragraph w 800 fontSize 16 lines 3 ที่ 1440 → P3
  - `findingKey ignores class changes` — สอง finding ข้อความเดียวกัน คลาสต่างกัน → key เท่ากัน · ตัวเลขต่างกัน (`ยอด 1,200` vs `ยอด 1,300`) → key เท่ากัน
  - `diffFindings excludes R8 and splits added/resolved/persisting`
  - `compareFacts flags D1 width change >8% and D2 vertical offset >1.5px`
- [ ] **Step 2: รันให้ล้ม** — `node --test tools/typography-audit/rules.test.mjs` · Expected: FAIL (module not found)
- [ ] **Step 3: เขียน `rules.mjs`** ตาม Interfaces (threshold เป็นค่าคงที่ชื่อชัด)
- [ ] **Step 4: รันให้ผ่าน** · Expected: PASS ทั้งหมด
- [ ] **Step 5: Commit** — `chore(tools): typography audit rules (scale, rhythm, ink clipping, touch, family, before/after deltas)`

### Task 2: ตัวเก็บข้อมูลในเบราว์เซอร์

**Files:**
- Create: `tools/typography-audit/collect.js` (สคริปต์ธรรมดา ไม่มี import — ฉีดด้วย `page.addScriptTag({ path })`)
- Test: `tools/typography-audit/collect.test.mjs`

**Interfaces:**
- Produces: `window.__collectTypography({ exclude: string, root?: string }): Fact[]`
  - เฉพาะ element ที่มองเห็นและมี text node ตรง ใน `root` (ค่าเริ่ม `body`) · ข้าม subtree ที่ `closest(exclude)`
  - `lines`, `textTop`, `textHeight` จาก `Range.getClientRects()` ของ text node ทั้งหมดใน element (ค่า top ไม่ซ้ำ ±1px)
  - `inkWidth`/`inkHeight` จาก `OffscreenCanvas`/`canvas.measureText` ด้วย `font` ของ element (`font-weight font-size/line-height family`)
  - `overflowClip` จาก element เองหรือบรรพบุรุษใกล้สุดที่ `overflow-x/y` เป็น hidden/clip (ไม่นับ `auto/scroll`)
  - `scrollOverflowX/Y` = `scrollWidth > clientWidth + 1` / `scrollHeight > clientHeight + 1` ของ element นั้น
  - `hasThai` = `/[฀-๿]/`
  - `kind` จาก tag/role/data-slot: `button`/`[role=button]` · `[data-slot=badge]` หรือ class `rounded-full` + font ≤13px · `th` · `nav a` · `[role=tab]` · `input/select/textarea/[role=combobox]` · `label` · `p` · `h1–h6`
  - `iconRatios` = ขนาด svg ลูกตรง ÷ fontSize · `headingLevel` = เลขจาก `h1`–`h6`
  - `key` ตามสูตร Global Constraints (ไม่มีคลาส · ลำดับซ้ำนับต่อ `kind+ข้อความ` ในหน้า)
  - ข้อความเก็บ 60 ตัวแรก ไม่เก็บค่า input

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** — chromium จาก `@playwright/test` · `page.setContent()` HTML ทดสอบที่โหลด `apps/web/public/fonts/noto-sans-thai/fonts.css` ผ่าน `file://` · `addScriptTag(collect.js)` แล้ว assert:
  - `single-line 40px button → lines 1` — `<button style="height:40px;padding:0 16px;line-height:21px;font-size:14px">บันทึก</button>` → `lines:1`
  - `wrapped button` — ปุ่มกว้าง 60px ข้อความไทยยาว (ไม่มี nowrap) → `lines ≥ 2`, `kind:'button'`
  - `ink overflow Thai` — div `overflow:hidden; height:16px; line-height:16px; font-size:16px` ข้อความ "ปุ่ม" → `overflowClip:'y'`, `inkHeight > 16`
  - `excludes document subtrees` — ข้อความใน `.template-paper`, `.sticker`, `.parcel-label` ไม่อยู่ในผล
  - `family and weight captured` — `fontFamily` ขึ้นต้น `"Noto Sans Thai"` · `fontWeight` 600
  - `reading block flag` · `numeric only` (`<td>1,234.50</td>`)
  - `key has no class and masks digits`
- [ ] **Step 2: รันให้ล้ม** — `node --test tools/typography-audit/collect.test.mjs` · Expected: FAIL
- [ ] **Step 3: เขียน `collect.js`** ตาม Interfaces
- [ ] **Step 4: รันให้ผ่าน** · Expected: PASS
- [ ] **Step 5: Commit** — `chore(tools): typography audit in-page collector (text rects + ink metrics)`

### Task 3: ความครบของ route

**Files:**
- Create: `tools/typography-audit/routes.mjs` · Test: `tools/typography-audit/routes.test.mjs`
- Create (ผลจาก CLI): `docs/reports/typography-scale-audit-2026-11/admin-inventory.json`

**Interfaces:**
- Produces:
  - `appPaths(appTsxSource: string): string[]` — ทุก `path="…"` รวม nested ที่ resolve เป็น path เต็มตาม parent `<Route>`
  - `adminRouteGaps(inventoryRows, paths): string[]` — path ที่อยู่ใน App แต่ไม่อยู่ใน inventory (เทียบหลังตัด `#…` และ normalize `:param`)
  - `DOCUMENT_ROUTES: RegExp[]` — route เอกสารตาม Global Constraints
  - `shopRoutes(): Array<{ path, sample, auth: boolean }>` — 40 route พร้อม sample param ที่ fixture ของ Task 5 รองรับ (เช่น `/products/:id` → `/products/phone-1`) · `auth:true` สำหรับ `/account*`
  - CLI `node tools/typography-audit/routes.mjs --write-admin-inventory <out>` → `{ rows }` รูปที่ `UXUI_INVENTORY` อ่าน (`app:'admin'`, `id`, `path`, `type`, `component`) = October inventory + แถวที่ขาด (id ขึ้นต้น `T`) · route ที่ match `DOCUMENT_ROUTES` ได้ `type:'document'` · พิมพ์รายการที่ขาดออก stdout

- [ ] **Step 1: เทสต์ที่ล้ม** (ใช้ fixture string ไม่พึ่งไฟล์จริง ยกเว้นข้อสุดท้าย)
  - `appPaths resolves nested routes` — `<Route path="/settings/:categoryId"><Route path=":itemId"/></Route>` → มี `/settings/:categoryId/:itemId`
  - `adminRouteGaps returns only missing` — inventory `[/a, /b]` paths `[/a, /b, /c]` → `[/c]`
  - `document routes classified` — `/r/:token`, `/sales/:id/parcel-label` match `DOCUMENT_ROUTES`
  - `shopRoutes covers App.tsx` — ทุก `path=` ของ web-shop จริง (ยกเว้น `*`, `/auth/line-callback`) อยู่ใน `shopRoutes()` และ `/account` มี `auth:true`
- [ ] **Step 2: รันให้ล้ม** · Expected: FAIL
- [ ] **Step 3: เขียน `routes.mjs`** แล้วรัน CLI สร้าง `admin-inventory.json` · จดรายการที่ขาดจริงลงรายงาน Task 6
- [ ] **Step 4: รันให้ผ่าน** · Expected: PASS
- [ ] **Step 5: Commit** — `chore(tools): typography audit route coverage + admin inventory`

### Task 4: หลังบ้าน + LIFF — เก็บข้อมูลผ่าน harness เดิม (สอง role สองธีม)

**Files:**
- Modify: `apps/api/e2e/documents/uxui-pages.browser.docs-spec.ts`
  - flag `UXUI_TYPOGRAPHY=1`: หลัง `readyMetrics` ของ**ทุกธีม** ให้ `addScriptTag` collector → `saveArtifact('typography', 'route-<no>-<width>-<theme>-<role>.json', …)` รูป `{ route, width, theme, role, status, facts }` โดย `status` ∈ `rendered|empty|error|redirected|document` (แถว `type:'document'` ข้ามการวัด บันทึก status `document`)
  - `UXUI_ROLE` (`owner` ค่าเริ่ม | `salesA`) เลือก user ที่ login (`world.users[...]`)
  - regex ฟอนต์ UI สร้างจาก `UXUI_UI_FONT` (ค่าเริ่ม `Noto Sans Thai`)
- Create: `apps/api/e2e/documents/support/liff-fixtures.ts` — `seedLiffSession(page)` ใช้ `page.evaluate` ตั้ง `sessionStorage['bcp_liff_session_v1']` (รูปจาก `apps/web/src/hooks/useLiffInit.ts`) **ก่อน pushState ทุกครั้งที่ path ขึ้นต้น `/liff`** + `routeLiffApi(page)` ตอบ `/api/line-oa/liff/*` ด้วยข้อมูลสังเคราะห์ **ลงทะเบียนหลัง** catch-all `page.route('**/*')` ที่มีอยู่
- ห้ามเปลี่ยนพฤติกรรมเมื่อ flag ปิด (CI)

**Interfaces:**
- Consumes: `collect.js` (Task 2) · `admin-inventory.json` (Task 3) ผ่าน `UXUI_INVENTORY`
- Produces: `<DOCS_QA_OUTPUT>/typography/*.json` + ภาพ `uxui-pages/route-<no>-<width>-<theme>.png` (ของเดิม)

- [ ] **Step 1: ฐานเดิมยังเขียว** — `UXUI_ROWS=1,2 UXUI_WIDTHS=390 npm run docs:check -- uxui-pages.browser.docs-spec` · Expected: PASS
- [ ] **Step 2: ใส่ hook + role + LIFF fixture** ตาม Files
- [ ] **Step 3: ชุดเล็ก flag เปิด** — `UXUI_TYPOGRAPHY=1 UXUI_INVENTORY=<admin-inventory.json> UXUI_ROWS=<no ของ /customers>,<no ของ /liff/contract>,<no ของ /r/:token> UXUI_WIDTHS=390 npm run docs:check -- uxui-pages.browser.docs-spec`
  - Expected: `/customers` → json 2 ไฟล์ (light/dark) `status:"rendered"` · `/liff/contract` → `rendered` facts > 0 ไม่ใช่หน้า error · `/r/:token` → `status:"document"` ไม่มี facts
- [ ] **Step 4: AFTER เต็ม สอง role** — รัน 2 ครั้ง (`UXUI_ROLE=owner`, `UXUI_ROLE=salesA`): `UXUI_TYPOGRAPHY=1 UXUI_POPULATED=1 UXUI_CONCURRENCY=3 UXUI_INVENTORY=… UXUI_WIDTHS=1440,390,320 DOCS_QA_OUTPUT=$PWD/.tmp/typo-audit/admin-after-<role> npm run docs:check -- uxui-pages.browser.docs-spec` · Expected: json = แถว × 3 × 2 ธีม ต่อ role
- [ ] **Step 5: BEFORE** — ตรวจ `git diff --stat` ตาม Global Constraints ว่าง → worktree ชั่วคราว `70eb82556` → copy `tools/typography-audit/`, `support/liff-fixtures.ts`, `admin-inventory.json`, spec ที่แก้แล้ว → `npm ci` → รันคำสั่ง Step 4 ทั้งสอง role ด้วย `UXUI_UI_FONT='Noto Sans Thai Looped'` → `DOCS_QA_OUTPUT=…/admin-before-<role>` → ลบ worktree · Expected: จำนวน json เท่า AFTER
- [ ] **Step 6: Commit** — spec + fixture (ไม่รวม .tmp) — `test(e2e): opt-in typography facts for admin (owner/sales) + LIFF routes`

### Task 5: หน้าร้าน — spec วัดทุก route บน build + prerender

**Files:**
- Create: `apps/web-shop/e2e/typography-audit.spec.ts` (`test.skip` ถ้าไม่มี `TYPOGRAPHY_AUDIT=1`)
- Create: `apps/web-shop/e2e/fixtures/shop-api.ts` — `routeShopApi(page)` ตอบ `/api/**` ด้วยข้อมูลสังเคราะห์ (สินค้า รายละเอียด รุ่น โปรโมชัน รีวิว รับซื้อ/เทิร์น ใบสมัครผ่อน คำสั่งซื้อ **และ endpoint ที่ `AuthContext.tsx` ใช้คืน session ลูกค้า** สำหรับ route `auth:true`) · path ที่ไม่รู้จัก → `{}` และจดลง `unmatched`
- Create: `apps/web-shop/e2e/fixtures/static-server.mjs` — เสิร์ฟ `dist/` ตามกติกา `firebase.json` (ไฟล์ตรง → prerender HTML → `spa-shell.html`) พอร์ต 5281

**Interfaces:**
- Consumes: `shopRoutes()` (Task 3) · `collect.js` (Task 2)
- Produces: `<TYPOGRAPHY_OUT>/shop/route-<slug>-<width>.json` รูปเดียวกับ Task 4 (`theme:'light'`, `role:'guest'|'customer'`) + ภาพ full-page `…-<width>.png` ถ่ายหลัง `document.fonts.ready`

- [ ] **Step 1: build + prerender** — `npm --prefix apps/web-shop run build` (รัน prerender ใน postbuild — ตรวจ `package.json`; ถ้าไม่ ให้รัน `node scripts/prerender.mjs` ตามคู่มือหัวไฟล์) · Expected: `dist/` มี HTML ของ route marketing + `spa-shell.html`
- [ ] **Step 2: route เดียว** — `cd apps/web-shop && TYPOGRAPHY_AUDIT=1 TYPOGRAPHY_ONLY=/how-it-works TYPOGRAPHY_OUT=$PWD/../../.tmp/typo-audit/shop-after npx playwright test e2e/typography-audit.spec.ts` · Expected: json 3 ไฟล์ `rendered` · Sarabun เฉพาะ `inReadingBlock`
- [ ] **Step 3: AFTER ครบ** — Expected: json = route × 3 · `/account*` เป็น `rendered` (fixture session) หรือ `blocked` พร้อมเหตุผล · `unmatched` จดใน report
- [ ] **Step 4: BEFORE** — worktree ชั่วคราว `70eb82556` + copy ไฟล์ Task 2/3/5 → build → `…/shop-before` → ลบ worktree
- [ ] **Step 5: Commit** — `test(web-shop): opt-in typography audit over every storefront route (built + prerendered)`

### Task 6: รายงาน BEFORE/AFTER

**Files:**
- Create: `tools/typography-audit/report.mjs` · Test: `tools/typography-audit/report.test.mjs`
- Create (ผล): `docs/reports/typography-scale-audit-2026-11/summary.md`, `findings.json` · `.tmp/typo-audit/contact-sheet.html` (ไม่ commit)

**Interfaces:**
- Consumes: `evaluateTypography`, `diffFindings`, `compareFacts` (Task 1) · โฟลเดอร์ json ของ Task 4–5
- Produces:
  - `summarize(runs): { routes: Array<{ app, route, width, theme, role, status, counts }>, totals, uncovered: { roles: string[], documentRoutes: string[], blocked: [...] } }`
  - CLI `node tools/typography-audit/report.mjs --admin-before-owner … --admin-after-owner … --admin-before-sales … --admin-after-sales … --shop-before … --shop-after … --out docs/reports/typography-scale-audit-2026-11 --sheet .tmp/typo-audit/contact-sheet.html`

- [ ] **Step 1: เทสต์ที่ล้ม**
  - `summarize counts non-rendered separately` — `error`/`blocked`/`document` ไม่นับผ่าน อยู่หัวข้อ "ตรวจไม่ได้/ไม่วัด"
  - `summary lists added P1 first` — P1 ใหม่ → P2 ใหม่ → P3 ใหม่ → D1/D2 → ของเดิม
  - `R8 never appears in diff sections` — มีเฉพาะหัวข้อ "AFTER เท่านั้น"
- [ ] **Step 2: รันให้ล้ม** · Expected: FAIL
- [ ] **Step 3: เขียน `report.mjs`** — `summary.md` (ไทย): จำนวน route×width×theme×role ต่อแอปแยกสถานะ · ขอบเขตที่ไม่ครอบ (role FM/ACCOUNTANT, route เอกสาร, blocked) · "เกิดจากฟอนต์ใหม่" (added) แยก P · "ควรดูด้วยตา" (D1/D2) · "มีอยู่ก่อน" (persisting) สรุปต่อกฎ · "หายไปหลังเปลี่ยน" · R8 ของ AFTER · top 30 จุดพร้อม route/width/theme/role/ข้อความย่อ/ชื่อภาพ · `contact-sheet.html` คู่ภาพ BEFORE|AFTER เฉพาะ route ที่มี added P1/P2 หรือ D1/D2 (ธีมมืดด้วย)
- [ ] **Step 4: รันให้ผ่าน + รัน CLI จริง** · Expected: PASS · ไฟล์ทั้งสามถูกสร้าง
- [ ] **Step 5: Commit** — `docs(report): typography scale & proportion audit 2026-11`

### Task 7: ตรวจด้วยตา + ข้อเสนอแก้ — ด่านเจ้าของ (ทำใน session หลัก ไม่ส่ง subagent)

- [ ] **Step 1: เปิด `contact-sheet.html` ดูทุกคู่ภาพที่มี added P1/P2 และ D1/D2 ทั้งสองธีม** — ยืนยัน/ปัดตกทีละจุด (fixture/animation = ปัดตกพร้อมเหตุผล) · จดลงท้าย `summary.md` หัวข้อ "ตรวจด้วยตา"
- [ ] **Step 2: ui-ux-pro-max** — `python3 ~/.claude/skills/ui-ux-pro-max/scripts/search.py "<คำค้นตามชนิดปัญหา>" --domain ux` (และ `--domain typography` ถ้าเรื่องสเกล) 3–5 คำค้น · ห้าม `--design-system`
- [ ] **Step 3: design canvas "ปัญหา → ข้อเสนอ"** — กระดานละกลุ่มปัญหา · ลอกโทเคนจริงจากทั้งสองแอป · ภาพเดิม + ข้อเสนอ + sticky บอกไฟล์/คลาสที่จะแก้ และผล ui-ux-pro-max
- [ ] **Step 4: หยุดรอเจ้าของเคาะ** — ส่งลิงก์ canvas + สรุป 3 บรรทัด (เกิดจากฟอนต์กี่จุด / มีอยู่ก่อนกี่จุด / เสนอแก้อะไร) · ห้ามแก้หน้าตาแอปก่อนได้คำตอบ · การแก้ที่เคาะแล้วเขียนเป็นแผนใหม่ด้วย superpowers:writing-plans

### Task 8: PR เครื่องมือ + รายงาน

- [ ] **Step 1: ตรวจรวม** — `node --test tools/typography-audit/` · `npm --prefix apps/web-shop run test` · `npm --prefix apps/web run test` · Doc guard ตามแผนเดิม (`docs/superpowers/plans/2026-11-08-typography-noto-sans-thai.md` Global Constraints) ต้องได้ `exit=1` · Expected: PASS ทั้งหมด
- [ ] **Step 2: push branch + `gh pr create --base main`** — body: ตัวเลขจาก `summary.md` + ขอบเขตที่ไม่ครอบ + ลิงก์ canvas + "flag ปิดโดยปริยาย ไม่กระทบ CI" · เก็บผล `gh pr checks` ลงตัวแปรก่อนตรวจ (กับดัก pipefail) · **ห้าม merge/deploy เอง**
