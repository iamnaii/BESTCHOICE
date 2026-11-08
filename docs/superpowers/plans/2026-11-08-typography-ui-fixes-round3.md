# Typography UI Fixes — Round 3 (owner items from the UI-fix report) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ทำตามข้อแนะนำของ "เรื่องที่รอเจ้าของตัดสิน" 5 ข้อในรายงาน `docs/reports/typography-ui-fixes-2026-11/summary.md` (เจ้าของสั่ง 2026-11-08 "ทำตามที่แนะนำได้เลย") — แก้ปุ่ม/แท็บ/ป้าย/หัวตารางที่ยังขึ้นสองบรรทัดนอกรายการเดิมด้วยรูปแบบเดียวกับรอบ 2 แล้ววัดซ้ำทั้งระบบ

**ข้อแนะนำที่ทำ (ตัดสินแล้ว):**

| ข้อในรายงาน | ทำอะไร |
|---|---|
| 1 ชิป "ยังไม่มีผู้ดูแล" (หัวห้องแชท) | **ไม่ขยายชิป** — ปุ่ม "ตัวเลือกเพิ่มเติม" 32px (`ChatPanel.tsx` ~970) ในหัวห้องเดียวกันเปิดเมนูมอบหมายเดียวกันอยู่แล้ว · แก้เฉพาะ `leading-none` บนข้อความไทยของชิป → `leading-snug` (กติกา `frontend.md`) |
| 2 จุดที่สูงขึ้นจนเห็นได้ | รับไว้ — ไม่แก้ |
| 3 ปุ่ม/แท็บ/ป้าย/หัวตารางที่ยังขึ้นสองบรรทัด (114 ครั้ง) | แก้แบบเดียวกันทั้งหมด (Task 1–2) **ยกเว้น** ข้อความเตือนยาวที่ตั้งใจ `/finance/cash-flow` และลิงก์รหัสทรัพย์สินทดสอบ `/assets` (ข้อมูลจำลอง) |
| 4 ป้าย "ประกันร้าน 60 …" หน้าร้านจอ 320 | ปล่อยไว้ — ไม่แก้ (จอ 390 ขึ้นไปเห็นครบ · มี `title`) |
| 5 ตาราง 5 หน้าเป็นการ์ดที่จอ 390 | รับไว้ — ไม่แก้ (พฤติกรรมออกแบบของ `ScreenTable` เหมือนจอ 320) |

**Architecture:** รูปแบบเดียวกับรอบ 2 — ข้อความบนแท็บ/ปุ่ม/ป้าย/หัวตาราง `whitespace-nowrap` · แถบแท็บที่ยาวเกินจอให้**เลื่อนแนวนอนในแถบของมันเอง** · แถวปุ่มที่ยาวเกินให้**ปุ่มลงบรรทัดใหม่** (`flex-wrap`) แทนข้อความในปุ่มตัดบรรทัด · ตารางอยู่ในกรอบ `overflow-x-auto` · ข้อความยาวที่มาจากข้อมูลใช้เพดานความกว้าง + "…" + `title` (แนวทาง ui-ux-pro-max: ทั้งหน้าห้ามเลื่อนแนวนอน · ตารางเลื่อนในกรอบ · ข้อความผู้ใช้ห้ามดันจนล้น)

**Tech Stack:** React + Tailwind v4 + shadcn/ui (`apps/web`) · vitest (source-text tests แบบ `apps/web/src/pages/__tests__/headerNowrap.test.ts`) · harness `UXUI_TYPOGRAPHY=1` + `tools/typography-audit/report.mjs`

**Spec:** `docs/reports/typography-ui-fixes-2026-11/summary.md` หัวข้อ "เรื่องที่รอเจ้าของตัดสิน" ข้อ 1–5 + `findings.json` (`persisting` R5) · ไฟล์ห้ามแตะตามสเปคฟอนต์ `docs/superpowers/specs/2026-11-08-typography-noto-sans-thai-design.md` §4

## Global Constraints

- ทำต่อบน branch `chore/typography-ui-fixes` (PR #1778 ยังไม่ merge) — commit เพิ่มใน PR เดิม · ไม่ bump version เพิ่ม (26.11.7 ยังไม่เคย deploy)
- worktree `.claude/worktrees/typography-ui-fixes` · `git -C <path>` เท่านั้น · ห้ามรันอะไรใน checkout หลัก
- **ห้ามแตะเอกสารถึงลูกค้า** (คำสั่ง 2026-11-08): ไฟล์ใน spec §4 และทุกอย่างใต้ `.voucher-sheet, .document-sheet, .bc-document, .document-landscape, .document-print-dialog, .template-paper, .font-sarabun, .mobile-receipt, .sticker, .print-stickers, .tiptap, .parcel-label, .contract-body` — Doc guard ต้องได้ `exit=1` ก่อนทุก commit
- ห้ามแตะ `modules/mdm` · ใช้โทเคนสีเดิม · ข้อความไทยห้าม `leading-none` · ไม่เพิ่ม dependency
- ไม่เปลี่ยนสี/ขนาดตัวอักษร/ระยะขอบของแท็บ ปุ่ม ป้าย (เพิ่มเฉพาะคลาสห้ามตัดบรรทัด/เลื่อน/ลงบรรทัด) · ไม่แปลง `<button>` ดิบเป็น `Button`
- ทั้งหน้าห้ามเลื่อนแนวนอนที่ 320/390 บนหน้าที่แก้ (`document.documentElement.scrollWidth <= innerWidth + 1`)
- จบที่อัปเดต PR #1778 · ห้าม merge/deploy เอง

## Review Focus

1. **แถบแท็บเลื่อนได้แต่ทั้งหน้าไม่เลื่อน** — แถบต้องมี `min-w-0`/`max-w-full` ในพ่อที่เป็น flex ไม่งั้นแถบจะดันหน้าให้กว้าง
2. **แท็บที่ถูกเลือกต้องมองเห็น** — ถ้าแท็บที่เลือกอยู่ท้ายแถบบนจอ 320 ต้องยังกดถึงได้ด้วยการเลื่อน (ไม่ถูกตัดทิ้ง)
3. **แถวปุ่มที่ลงบรรทัดใหม่** — ปุ่มที่ลงบรรทัดต้องไม่ทับข้อความ/หัวหน้าอื่น และระยะห่างแนวตั้งพอ (`gap-y-*`)
4. **ธีมมืด** — ตรวจทั้งสองธีม

---

### Task 1: แท็บและแถวปุ่มไม่ตัดบรรทัด

**Files:** (หาไฟล์จากข้อความ — ตรวจ `Tabs`/`TabsList`/`TabsTrigger` ร่วมใน `apps/web/src/components/ui/` ก่อน ถ้าหลายหน้าใช้ตัวร่วมให้แก้ที่ตัวร่วมจุดเดียว)
- แท็บ: `/notifications` ("ส่งเตือนก่อนครบกำหนด" "ส่งทวงหนี้ค้างชำระ" "ประวัติการส่ง" "แม่แบบข้อความ" "แจ้งพนักงาน (LINE)") · `/commissions` ("รายการคอมมิชชัน" "ใบจ่ายรายเดือน") · `/contracts` ("สัญญาของฉัน" "รอตรวจสอบ") · `/purchase-orders` ("รายการ PO" "ยอดค้างชำระ (ผู้จัดจำหน่าย)") · `/settings/accounting/chart` ("FINANCE (การเงิน) · N" "SHOP (หน้าร้าน) · N") · `/products/:id` แท็บ "ขึ้นเว็บ"
- แถวปุ่ม: `/settings/products/pricing` ("ดาวน์โหลดแบบฟอร์ม" "นำเข้า Excel" "+ เพิ่มราคาตั้งต้น") · `/other-income/:id` ("คัดลอก" "แก้ไขและ ลงบัญชี") · `/imported-sales` ("ก่อนหน้า" "ถัดไป") · `/expenses/new` ("เพิ่มแบบ ด้วยตนเอง") · `/other-income/new` และ `/other-income/:id/edit` ("ใช้แม่แบบ")
- Test: `apps/web/src/pages/__tests__/` (source-text) และ/หรือ `apps/web/src/components/ui/__tests__/` ถ้าแก้ตัวร่วม

- [ ] **Step 1: เทสต์ก่อน (RED)** — ปักว่าแท็บ/ปุ่มแต่ละจุดมี `whitespace-nowrap` และแถบแท็บมี `overflow-x-auto` (+ `max-w-full`/`min-w-0` ตามบริบท) · แถวปุ่มมี `flex-wrap`
- [ ] **Step 2: แก้** — แท็บ: `whitespace-nowrap` + แถบเลื่อนแนวนอน (`overflow-x-auto`, ไม่โชว์ scrollbar ใหญ่ถ้ามีคลาสร่วมอยู่แล้ว) · แถวปุ่ม: ปุ่ม `whitespace-nowrap` + แถว `flex-wrap gap-y-2` (หรือ gap ที่เข้ากับของเดิม) · คำที่เว้นวรรคกลางคำ ("เพิ่มแบบ ด้วยตนเอง" "แก้ไขและ ลงบัญชี") ห้ามแก้ข้อความ — nowrap พอ
- [ ] **Step 3: ตรวจ** — `npm --prefix apps/web run test` · `tsc` · eslint ไฟล์ที่แก้ · Doc guard `exit=1` · commit

### Task 2: ป้าย หัวตาราง และชิปแชทที่เหลือ

**Files:**
- ป้าย: `/contracts/create` "มือ 1" · `/commissions` "ดูอย่างเดียว" · `/liff/contract` "ถึงกำหนด" — `whitespace-nowrap` (ข้อความคงที่สั้น)
- หัวตาราง: `/finance/equity-statement` ("ยอดต้นงวด" "+ เพิ่ม" "ยอดปลายงวด") · `/finance/equity/:id` ("ส่วนเกิน" "ชำระจริง") · `/assets/:id/edit` ("CR (฿)") · `/settings/system/trash` ("สถานะการกู้") — `whitespace-nowrap` + ตารางต้องอยู่ในกรอบ `overflow-x-auto` (`/settings/system/trash` ล้นทั้งหน้าที่ 320/390 อยู่ก่อนแล้ว 941px — ใส่กรอบเลื่อนให้ตารางจึงแก้ไปด้วย)
- ชิปแชท: `apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx` ~800 ชิปผู้ดูแล `leading-none` → `leading-snug` (ไม่เปลี่ยนความสูง `h-5`)
- **ไม่แก้:** `/finance/cash-flow` ข้อความเตือนยาว (ตั้งใจให้ยาว) · `/assets` ลิงก์รหัส `TEST-…` (ข้อมูลจำลอง)
- Test: ขยาย `apps/web/src/pages/__tests__/headerNowrap.test.ts` (หัวตาราง + กรอบเลื่อนแบบ anchored ที่มีอยู่) + เทสต์ป้าย/ชิป

- [ ] **Step 1: เทสต์ก่อน (RED)** แล้ว **Step 2: แก้** แล้ว **Step 3: ตรวจ** (เหมือน Task 1)

### Task 3: วัดซ้ำทั้งระบบ + อัปเดตรายงาน + PR (ผู้คุมงาน)

- [ ] **Step 1** — วัดทั้งระบบรอบเดียวที่ HEAD: owner + salesA (`UXUI_TYPOGRAPHY=1 UXUI_POPULATED=1 UXUI_INVENTORY=<abs>/docs/reports/typography-scale-audit-2026-11/admin-inventory.json NODE_OPTIONS=--max-old-space-size=6144 npm run docs:check -- uxui-pages.browser.docs-spec`) — **ห้ามประกบผลวัดแยกบางหน้า**
- [ ] **Step 2** — `report.mjs` ก่อน = AFTER ของรายงานตรวจ · หลัง = ชุดใหม่ · Expected: R5 ลดตามจุดที่แก้ · added P1/P2 ไม่เพิ่มจากรอบ 2 (P2 3 = ป้ายหน้าร้าน) · ความกว้างหน้าเท่าเดิมทุกชุด ยกเว้น `/settings/system/trash` ที่ต้องหายล้น
- [ ] **Step 3** — ภาพก่อน|หลังของแท็บ/แถวปุ่มที่จอ 320 ทั้งสองธีม · อัปเดต `summary.md` + `findings.json` · push · อัปเดตเนื้อหา PR #1778 · เก็บผล `gh pr checks` ลงตัวแปรก่อนตรวจ · ห้าม merge/deploy
