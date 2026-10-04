# BESTCHOICE Remaining Work Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. งานหลายระบบในเอกสารนี้เป็นแผนแม่: งานบัญชีและ QR ที่มี decision gate ต้องผ่านด่านและมีแผนย่อยก่อนแก้พฤติกรรมจริง

**Goal:** ปิดงานค้าง BESTCHOICE ที่ตรวจพบ ณ 4 ตุลาคม 2569 ให้พนักงานใช้งานต่อเนื่อง ยอดปิดสัญญาและเอกสารตรงกัน และมีหลักฐานตรวจรับก่อนเปิดใช้จริง

**Architecture:** ต่อยอดบริการบัญชี การรับชำระ การยืนยันตัวตน และชุดทดสอบเดิม แยก PR ตามพฤติกรรมที่ตรวจรับได้ งานปิดยอดทุกช่องทางใช้กติกาชุดเดียวกันและรักษาธุรกรรม/การกันรับซ้ำ ไม่สร้างระบบบัญชีหรือระบบล็อกอินอีกชุด

**Tech Stack:** React/TypeScript, NestJS, Prisma, PostgreSQL แยก SHOP/FINANCE, Jest, Vitest, Playwright, GitHub Actions, Cloud Run/Firebase และ object storage เดิม

**Spec:** ข้อกำหนดและเกณฑ์รับงานจาก issues #1602–#1607, #1571–#1574; PRs #1665, #1667, #1645; `docs/superpowers/specs/2026-09-28-accounting-review-fixes-design.md`; `AGENTS.md`; `docs/guides/local-check.md`. สถานะ GitHub/โค้ดล่าสุดมีน้ำหนักเหนือ checkbox เก่าในเอกสาร

## Execution status — 4 October 2026

Owner authorized implementation with “เริ่มได้เลย”. Current results and remaining decisions are maintained in [the evidence report](../../reports/2026-10-04-remaining-work-evidence.md) and [acceptance packet](../../runbooks/2026-10-04-remaining-work-acceptance.md). Original baseline/acceptance text below remains the planning record; an unchecked release or live-acceptance step must not be inferred complete from a local test.

## Global Constraints

- แผนเดิมจัดทำตาม **วางแผนแก้ทั้งหมด**; ต่อมาเจ้าของอนุญาตเริ่ม implementation แล้ว แต่ยังไม่ใช่คำสั่ง merge/deploy
- “งานหน้าร้าน = SHOP; งานการเงิน = FINANCE” — คงการเลือกงาน/บริษัทใน sidebar จุดเดียวและสิทธิ์เดิม
- “Before handing back code, run `npm run local:check`.” รันจาก checkout ที่แก้จริงและตรวจ flow ที่เปลี่ยนเพิ่มเติม เพราะ preview ไม่ครอบคลุมทั้งแอป
- “For financial/API changes use the existing isolated PostgreSQL test harness; do not run DB-backed tests against an inherited application database.”
- “Preserve other sessions' processes and work. Never kill by port or process name.” เลือกพอร์ตว่างและใช้ฐาน/ไฟล์ผลทดสอบแยกกัน
- “Do not automatically merge, deploy, or send messages as part of local verification.” การ merge main ของ repo นี้เรียก production deployment จึงต้องเสนอผลตรวจพร้อมก่อนขั้นนั้น
- ใช้ Decimal/กติกาปัดเศษเดิม; ไม่แก้รายการบัญชีย้อนหลัง ไม่ล้างข้อมูล production และไม่สร้างธุรกรรมจริงเพื่อทดสอบโดยอนุมานเอง
- ยึดคำตัดสินบัญชีที่มีหลักฐานแล้ว; หัวตาราง “ข้อเสนอของทีมระบบ” ไม่ใช่คำอนุมัติของฝ่ายบัญชี
- เก็บ e-Tax และ QR บนใบเสร็จไว้ในรายการเลื่อนตาม O3/O4 เดิม ไม่เปิดฟีเจอร์นั้นจากคำว่า “ทั้งหมด” โดยไม่มีการเปลี่ยนขอบเขตชัดเจน
- ไม่รื้อฟีเจอร์ที่เจ้าของสั่งถอดออก เช่นเมนูการตลาด/ร้านค้าออนไลน์ และไม่เปิดงาน refactor รอบใหม่ที่ไม่จำเป็นต่อการแก้ข้อบกพร่อง

## Review Focus

1. หลายแท็บ/หลายพนักงานใช้ IP เดียว รวมทั้งช่วงเริ่มแอปที่ยังไม่มี user: 429 ต้องไม่ทำลายฟอร์มหรือทำให้ ProtectedRoute เด้งออก — ทดสอบใน Task 2
2. เงินพักกับเงินชำระเกินมีพร้อมกัน หรือเงินเกินมากกว่าหนี้: หักครั้งเดียว เหลือเงินของลูกค้าเท่าใดต้องตรวจสอบได้ — Task 1, 5, 6
3. QR เก่า ยอดเปลี่ยน callback ซ้ำ และการปิดสัญญาแข่งกับชำระงวด: เงินที่รับจริงไม่สูญหาย ไม่ลงบัญชีซ้ำ ไม่ใช้ยอดส่วนลดเก่าเงียบ ๆ — Task 6
4. ค้นหามี debounce และชื่อหน้าแบบเส้นทางลูก/query/UUID: ข้อความต้องอิงผลที่แสดงจริง และไม่เอาชื่อแม่กลบเมนูลูก — Task 3–4
5. เอกสารผ่าน local แต่ bucket จริง/เครื่องพิมพ์จริงไม่ผ่าน: signed URL, CORS, สิทธิ์, ลายเซ็น และขอบกระดาษต้องมีหลักฐานเฉพาะ environment — Task 8–9

## 1. Baseline และขอบเขตที่ตรวจแล้ว

สถานะอ่านอย่างเดียวเมื่อ 2026-10-04 (Asia/Bangkok):

| รายการ | หลักฐาน | ผลต่อแผน |
|---|---|---|
| main | `b57646376744f9b979ea678a4b52e497c39aaeb3` / merge #1671 | ใช้เป็นจุดอ้างอิง; ตรวจ SHA ใหม่ก่อนเริ่มลงมือ |
| Deploy ล่าสุด | Actions run `37139147747`: API/Web deploy และ migration success | ไม่เปิดงานแก้ CI/deploy ซ้ำจากรายงานเก่า |
| #1665 | เปิด, base main, CONFLICTING; CI ของ head เดิมผ่าน | ต้องรวม main ใหม่ แก้ conflict และรันตรวจใหม่ |
| #1667 | เปิด, base branch #1665, MERGEABLE, ไม่มี CI checks | ต้องตรวจร่วมกับ #1665; เปลี่ยน base และรอ CI บน main ก่อนส่งขึ้นจริง |
| #1645 | เปิด, MERGEABLE แต่ BLOCKED; เป็นสคริปต์ปรับ persona/KB/ภาพ | merge อย่างเดียวไม่ยืนยันว่า config ใช้จริง; ต้องตรวจสถานะ apply แยก |
| #1604 | โค้ด refresh ยังเป็น 10 ครั้ง/นาที; refresh error ยังพาไป login | เป็นงานแก้โค้ดที่ยืนยันได้ |
| #1605 | ข้อความคิวว่างยังไม่ดูคำค้น | เป็นงานแก้โค้ดที่ยืนยันได้ |
| #1603 | resolvePageTitle ใช้ map แยกจากเมนู | นับหน้าจากเมนูปัจจุบันใหม่ ไม่ยึด 55/66 จากเดือนกันยายน |
| #1602 / #1606 | issue ยังเปิด แต่สถานะ prod ล่าสุดใน issue เป็น 20 ก.ย. | ตรวจอ่านใหม่ก่อนเปลี่ยน config; ไม่อ้างว่าปัจจุบันยังเปิด/ยังมีแถวนั้น |
| #1574 / #1607 | เป็นใบรวม | ไม่ใช่งานใหม่เพิ่มอีกสองชุด; ปิด/ปรับสถานะหลังงานลูกครบ |
| DOC-00…11, DOC-14 | comment #1574 ยืนยัน merge #1576 และปิดงานลูกแล้ว | ไม่ทำชุดทดสอบเอกสารเดิมใหม่ทั้งหมด; เหลือ #1571/#1572 และตรวจข้อสังเกตเก่าก่อนนับเป็น bug |

งานที่เสร็จแล้วและไม่รวมเป็นงานค้าง: #1669 ปรับโครงสร้างโค้ด, #1670 แก้ Jest ESM, #1671 ตัวกรอง POS, PR1/PR2/PR2ข/PR3/PR6/ภ.พ.30 ที่รวมก่อนหน้า ทั้งนี้ regression ยังคงต้องผ่านเมื่อแก้งานใหม่

## 2. ลำดับส่งมอบ

| ช่วง | งาน | ผลที่ต้องส่ง |
|---|---|---|
| A — ลดปัญหาที่กระทบงานประจำ | Task 0–4: เตรียมฐาน, ปิดยอด, session, ค้นหาเครดิต, ชื่อหน้า | PR แยกที่ทดสอบและเปิด preview ได้ |
| B — บัญชีครบเส้นทาง | Task 5–7: PR4/PR7, QR ปิดยอด, บอท | หลักฐานตัวเลข/ธุรกรรม/คำตอบ และแผนใช้จริง |
| C — ตรวจรับสภาพแวดล้อม | Task 8–10: staging/storage, เครื่องพิมพ์, คีย์ config เก่า | ผลผ่านจริงหรือระบุสิ่งที่ยังขาด พร้อมผู้ตรวจ |
| D — เปิดใช้งานและปิดงาน | Task 11–12: OTP/test mode, release และกระทบยอดสถานะ | หลักฐานเปิดใช้จริงและรายการงานที่ปิดได้ |

งาน session/หน้าจอ/เตรียมเอกสารเดินต่อได้ระหว่างรอคำตอบบัญชี ไม่ต้องหยุดทั้งโครงการ

Dependency หลัก: `#1665 → #1667 → PR4 → PR7`; QR ต้องตามกติกาบัญชีที่สรุปแล้ว; ปิด test mode หลัง OTP/credit checks ผ่าน; ตรวจจริงบน prod หลังอนุมัติ release

## Task 0: เตรียมฐานงานและทะเบียนหลักฐาน

**Files:** สร้าง `docs/reports/2026-10-04-remaining-work-evidence.md` เมื่อเริ่มลงมือ; ผลรันอยู่ `.tmp/remaining-work/` (ไม่เข้า Git)

**Interfaces:** รับ current main/PR head SHA; ส่งทะเบียน `task → branch → head SHA → tests → preview → PR → environment → decision → status`

- [x] อ่าน `AGENTS.md`, `.claude/CLAUDE.md`, workflow/rules ของพื้นที่ที่จะเปลี่ยน และตรวจสถานะ worktree ทุกตัวที่จะใช้
- [x] อ่านสถานะ GitHub ใหม่ด้วยคำสั่งด้านล่าง บันทึกวันที่กับ SHA ไม่เขียนทับ branch ที่มีงานค้าง

```bash
git status --short --branch
git worktree list
gh api repos/iamnaii/BESTCHOICE/commits/main --jq .sha
gh pr list --state open --json number,headRefName,baseRefName,url
gh issue list --state open --limit 100 --json number,title,url
```

- [x] สร้าง worktree ของแต่ละชุดจากฐานที่ถูกต้องตาม using-git-worktrees; ใช้ branch เดิม #1665/#1667 เป็นแหล่งงาน ไม่สร้าง implementation แข่งอีกชุด
- [ ] ตรวจว่ารายการ “ค้างเคาะ” เก่าใน comment #1574 (petty cash allow-list, สติกเกอร์, credit-payment-flow flake) ยังทำซ้ำได้บน main หรือถูกแก้/ถอดแล้ว; บันทึกหลักฐาน และสร้างงานย่อยเฉพาะ defect ที่ยืนยันได้
- [x] จัดสถานะให้แยก `planned`, `implemented`, `verified-local`, `released`, `accepted-live`, `waiting-decision`, `deferred`; ห้ามเรียกโค้ดที่เขียนแล้วแต่ยังไม่ใช้จริงว่าเสร็จทั้งงาน

**Done:** ทุกงานมีแหล่งอ้างอิงและ dependency ไม่มีการนับงานแม่/งานที่ merge แล้วซ้ำ

## Task 1: ส่งมอบปิดยอดก่อนกำหนด #1665 และ #1667

**Files:** ใช้แผนเดิมใน worktree `BESTCHOICE-acct-review-pr1`: `docs/superpowers/plans/2026-10-01-acct-review-pr5-early-payoff-per-ledger.md` และ `2026-10-01-acct-review-pr5b-payoff-deducts-general-advance.md`; ตรวจ diff จริงของทั้ง PR ก่อนแก้

จุดหลัก: `apps/api/src/modules/contracts/compute-payoff-quote.ts`, `contract-payment.service.ts`, `apps/api/src/modules/journal/compute-early-payoff-je.ts`, `cpa-templates/early-payoff-jp4.template.ts` และหน้าปิดยอด/ยึดคืน/LIFF ที่ PR เปลี่ยนแล้ว

**Interfaces:** คง `computePayoffQuote` และบริการปิดยอดจาก PR เดิม; ช่องทางผู้ใช้ทั้งหมดต้องใช้ผลเดียวกัน; เอกสารรับเงินผูก JE ที่ commit แล้ว

- [x] นำ main ล่าสุดเข้าฐานทำงาน #1665 โดยรักษาประวัติงานเดิม; ตรวจ conflict ทีละจุดกับทั้งสองเวอร์ชัน ห้ามเลือกทั้งไฟล์ด้านเดียว
- [x] รักษาการแก้ Jest ESM และงานที่เจ้าของสั่งถอด; ตรวจ version เว็บใหม่ ไม่ใช้ 26.10.4/26.10.5 แบบตายตัวจาก PR เก่า
- [x] นำ #1667 มาทดสอบร่วมบนฐานใหม่และทำ review diff รวม โดยไม่แก้กติกาส่วนลดที่ตกลงแล้ว
- [x] รันชุดตัวอย่างในแผนเดิม: ไม่มีเงินพัก, มีเครดิตอย่างเดียว, มีเงินเกินอย่างเดียว, มีทั้งสอง, จ่ายบางส่วน, งวดเลยกำหนด, ยอดปิดศูนย์, เงินเหลือหลังปิด, ยึดคืน, ยกเลิก/กลับรายการ และ approval quote เก่าได้ 409
- [x] ยืนยันเงินสด JE = รับจริง, Debit = Credit, เงินพักหักครั้งเดียว และไม่มีเงินของลูกค้าหาย; ใช้ fixture ตัวเลขจากคำตัดสินเดิมเป็น expected value อิสระจากฟังก์ชันที่กำลังทดสอบ
- [x] ตรวจทั้งหน้า admin และ LIFF ด้วยข้อมูลสังเคราะห์; รัน isolated API regression และ `npm run local:check` จาก checkout นี้
- [ ] ส่งผล review/CI/preview พร้อมลำดับ release: #1665 ก่อน จากนั้น retarget #1667 ไป main และรอ checks จริง; การที่ #1667 ไม่มี CI ไม่ถือว่าผ่าน

**Done:** สอง PR เข้ากับ main ล่าสุด มีหลักฐานตรวจรวม และพร้อมให้ตัดสินใจ merge; หลัง release ตรวจเวอร์ชัน/flow ซ้ำจึงนับว่าขึ้นใช้จริง

## Task 2: แก้ refresh session และ 429 (#1604)

**Files:** แก้ `apps/api/src/modules/auth/auth.controller.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/contexts/AuthContext.tsx` และ route guard ที่อ่าน auth state เมื่อจำเป็น; เพิ่ม `apps/api/src/modules/auth/auth.refresh-rate-limit.spec.ts`, `apps/web/src/lib/api.refresh.test.ts`; ต่อเทส AuthContext/ProtectedRoute เดิม

**Interfaces:** คง `POST /auth/refresh` แบบ cookie-only, `{ accessToken }`, token rotation/reuse detection เดิม และ refresh promise เดียวสำหรับคำขอที่ชนกัน

**แนวทางที่เลือก:** เพิ่มเพดานเฉพาะ refresh เป็น **600 ครั้ง/นาที/IP** (20 คน × 3 แท็บ = 60; เผื่อ reload/retry 10 เท่า) และแก้การรับมือ 429 ในเว็บ วิธีนี้ยังนับต่อ IP ไม่อ้างว่าแยกต่อ session; ไม่ใช้ hash ของ token ที่หมุนทุกครั้งเป็นตัวนับซึ่งหลบเพดานได้

- [x] เพิ่มเทส HTTP จริงบน API ทดสอบ: 3 session จาก IP เดียว refresh รวม 30 ครั้งสำเร็จ; session เดียวยิงเกิน 600 ครั้งยังถูกจำกัด; login คง 10/นาที และ reset-password คง 5/นาที
- [x] ยืนยัน regression ล้มเพราะเพดานเดิม แล้วแก้เฉพาะ decorator ของ refresh:

```ts
@Post('refresh')
@Throttle({ short: { ttl: 60000, limit: 600 } })
```

- [ ] เพิ่มเทสเว็บสำหรับ 429 → success, 429 ซ้ำจนหยุด retry, 401, network/5xx และคำขอที่เกิดพร้อมกัน 5 รายการ; ตรวจทั้ง URL, user state, form value และจำนวน refresh
- [ ] แก้ promise เดิมให้ retry เฉพาะ 429 ได้ไม่เกิน 2 ครั้ง: ใช้ `Retry-After` ทั้งจำนวนวินาทีและ HTTP-date; ถ้าไม่มีให้รอ 1 และ 2 วินาที; ถ้าระบุรอนานกว่า 60 วินาทีให้คงหน้าและแสดงเวลารอโดยไม่ retry ก่อนเวลา
- [x] หลังหมด retry ให้คืนข้อผิดพลาดชั่วคราวโดยไม่ล้าง session/redirect; 401 จึงออกจากระบบ; network/5xx ต้องไม่ถูกตีความเป็น session หมดอายุ
- [x] ช่วง bootstrap ที่ยังไม่มี user ให้มีสถานะ “กำลังเชื่อมต่อ/ลองใหม่” เมื่อ transient error แทนตีความเป็น unauthenticated; อย่าแสดงหน้าหรือข้อมูลที่ยังไม่ได้ตรวจสิทธิ์
- [x] เทส logout ระหว่างรอ retry ต้องไม่ฟื้น session กลับมา และ single-flight ต้องไม่ปล่อย retry หลายสาย
- [ ] เปิดหลายแท็บบน API จริงในเครื่อง พร้อมกรอกฟอร์มค้าง แล้วจำลอง 429; รัน auth regression, web tests และ local:check

**Done:** #1604 ผ่าน acceptance เดิม รวมถึงไม่มีการเด้ง/ข้อมูลฟอร์มหายจาก 429 และยังมีเพดานกันคำขอรัว

## Task 3: แยกค้นหาไม่เจอออกจากคิวว่าง (#1605)

**Files:** `apps/web/src/pages/CreditChecksPage.tsx`, `CreditChecksPage.test.tsx`

**Interfaces:** เปลี่ยนข้อความ `emptyMessage` เท่านั้น ใช้คำค้นหลัง debounce ตัวเดียวกับ query; ไม่เปลี่ยน API/สูตรการ์ดสรุป

- [x] เพิ่ม case ใน fixture ของเทสเดิม: rows ว่าง + พิมพ์ชื่อที่ไม่มี + รอ debounce → ไม่พบคำค้น; ล้างคำค้น → กลับเป็นข้อความคิวตาม pendingCount
- [x] ทำเทสให้ล้มกับโค้ดเดิมก่อน เปรียบเทียบข้อความโดยไม่คำนวณ expected จาก helper เดียวกับแอป
- [x] ให้เงื่อนไขคำค้นมาก่อนเงื่อนไขคิว: `ไม่พบรายการที่ตรงกับ “คำค้น”`; คำค้นว่างรักษา `เคลียร์หมดแล้ว` หรือ `อีก N รายการยังรอผลวิเคราะห์` ตามเดิม
- [ ] ทดสอบทุก status filter, คำค้นยาว/อักขระไทย/เครื่องหมายคำพูด และผลเก่าระหว่าง debounce; แสดงข้อความเป็น React text ไม่ใช้ HTML interpolation
- [ ] ตรวจหน้าจอ 390/1440px และรัน:

```bash
npm run test --workspace=apps/web -- src/pages/CreditChecksPage.test.tsx
npm run local:check
```

**Done:** ค้นหาไม่เจอไม่บอกว่าคิวเคลียร์ และคิวว่างจริงยังสื่อสารถูกต้อง

## Task 4: ชื่อหน้าจากเมนูภาษาไทย (#1603)

**Files:** `apps/web/src/components/layout/resolvePageTitle.ts`, `components/layout/__tests__/resolvePageTitle.test.ts`; อ่าน `config/menu.ts`, `config/work-navigation.ts`, `components/layout/TopBar.tsx`

**Interfaces:** คง `resolvePageTitle(pathname: string): string`; ใช้ label จาก config เมนูปัจจุบันทุก role/zone

- [x] สร้าง expected menu-path inventory จาก config ปัจจุบัน โดย normalize query/trailing slash และบันทึก path ที่มีหลาย label
- [x] เลือก label ซ้ำแบบ deterministic: OWNER ก่อน ตามด้วย FINANCE_MANAGER, BRANCH_MANAGER, ACCOUNTANT, SALES; ห้ามเปลี่ยน label ในเมนูเพื่อให้เทสผ่าน
- [x] ลด `PAGE_TITLE_MAP` ให้เหลือ detail/custom override ที่จำเป็น; custom override ชนะเมื่อ path เท่ากัน; การหา prefix ต้องเรียงยาวไปสั้นและมีขอบเขต `/` เพื่อไม่จับ `/salesman` เป็น `/sales`
- [x] menu exact match ต้องชนะ prefix ของหน้าแม่; รวม candidates แล้วเลือก longest prefix เมื่อไม่มี exact match; `/products/:id` และหน้าแจ้งหลังการขายคงข้อความที่ตั้งใจไว้
- [x] เพิ่มเทสวนรายการเมนูทุก role พร้อม expected override ที่ประกาศชัดเจน และ regression ต่อไปนี้:

```ts
expect(resolvePageTitle('/purchase-orders/qc')).toBe('รอถ่ายรูป');
expect(resolvePageTitle('/products/example-id')).toBe(NAV_LABELS.stock);
expect(resolvePageTitle('/some/unknown-page')).toBe('unknown page');
```

- [x] ทดสอบ query path, prefix ซ้อน, UUID และ unknown path; ปรับเทสเก่าที่คาดชื่อหน้าแม่เฉพาะเมื่อเมนูปัจจุบันมีหน้าลูกของตัวเองจริง
- [x] ตรวจ import cycle และ build; เปิดจริงอย่างน้อย 5 หน้าที่ยังมีในเมนู พร้อม local:check

**Done:** เพิ่มเมนูใหม่แล้วชื่อแถบบนตาม label โดยไม่ต้องเพิ่ม map ซ้ำ และไม่เปลี่ยนสิทธิ์/navigation

## Task 5: ปิดกติกา PR4 และสร้างหลักฐาน PR7

**Files:** อัปเดต decision record ใน `docs/superpowers/specs/2026-09-28-accounting-review-fixes-design.md`; สร้างแผนย่อย `docs/superpowers/plans/2026-10-04-acct-review-pr4-pr7.md` เมื่อด่านผ่าน

พื้นที่ตรวจ: `apps/api/src/modules/payments/services/reschedule-collect.service.ts`/`.spec.ts`, `modules/journal/cpa-templates/reschedule-collect-lifecycle.integration.spec.ts`, `modules/contracts/contract-payment.service.ts`, บริการใบเสร็จและใบลดหนี้, `apps/api/src/cli/seed-test-contracts.cli.ts`

**Interfaces:** รับกติกาที่บัญชียืนยันและ PR5/PR5ข ที่ตรวจแล้ว; ส่งยอด VAT/เงินพัก/JE/ใบเสร็จ/ใบลดหนี้ที่กระทบยอดกันได้

- [ ] ค้นคำตอบล่าสุดใน PR/เอกสารก่อนถามซ้ำ: Q7 เลือก gross/net, Q8 เงินรับเกินทั่วไป/ออนไลน์, Q9 เงินพักเกินงวดสุดท้าย; บันทึกข้อความคำตอบ วันที่ และผู้ยืนยัน
- [ ] ถ้ายังไม่มีคำตอบ หยุดเฉพาะ implementation ส่วนที่พึ่งกติกานั้น; เตรียมตัวอย่างเงินและรายการบัญชีให้บัญชีตัดสิน โดยไม่ส่งข้อความภายนอกเอง
- [ ] เมื่อกติกาครบ เขียนแผน PR4 ระบุ exact postings ณ วันรับ, วันใช้เงินพัก, ปิดยอด, ยึดคืน, ตัดหนี้สูญ, คืน/กลับรายการ และการปัดเศษ แล้วตรวจรับแผนย่อยก่อนลงมือ ตามข้อกำหนด spec เดิม
- [ ] ทำ golden fixtures จากคำตอบบัญชี: เงินพักปกติ/หลายครั้ง/เกินหนี้, partial advance, ยกเลิกบางใบ/ทั้งหมด และรายการข้ามงวด; expected VAT ต้องไม่คำนวณโดยฟังก์ชันเดียวกับ production
- [ ] เพิ่ม regression แล้วแก้ทุก entry point ของเงินประเภทเดียวกันใน PR4; ทดสอบเงินคงเหลือและ VAT ไม่ถูกนับซ้ำเมื่อเงินพักถูกใช้ภายหลัง
- [ ] PR7 สร้าง scenario เหตุการณ์ครบตั้งแต่ 1A → รับชำระ → ปรับดิว → ใช้เงินพัก → ปิดยอดหรือยึดคืน; กระทบยอด subledger, GL, เอกสาร, รายงานภาษี และยอดเงินสดทุกขั้น
- [ ] เคส TEST-…-017 ให้ใช้ตัวเลข 7,053.02 / 1,683.51 เฉพาะเมื่อคำตอบล่าสุดยังรับรอง fixture เดิม; หากนโยบายเปลี่ยนให้บัญชียืนยัน expected ชุดใหม่ ไม่แก้ snapshot เพื่อกลบผลล้ม
- [ ] รันบน SHOP/FINANCE PostgreSQL ชั่วคราว; ส่งรายงานพร้อม PDF/CSV สังเคราะห์ให้เจ้าของตรวจ รายงานบน prod เป็นขั้นตรวจรับต่างหาก ไม่ใช้ seed prod อัตโนมัติ

**Done:** ฝ่ายบัญชีมีหลักฐานตรวจรับและตัวเลขทุกชั้นตรงกัน; ไม่มี Q7–Q9 ที่ถูกตีความเอง

## Task 6: ปิดยอดผ่าน QR ใน LINE (X4)

**Files:** อ่าน/แก้ตามแผนย่อย: `apps/api/src/modules/line-oa/liff-api.controller.ts`, `apps/api/src/modules/paysolutions/services/paysolutions-intent.service.ts`, `paysolutions-webhook.service.ts`, `paysolutions-confirmation.service.ts`, `apps/api/src/modules/contracts/contract-payment.service.ts`, `apps/web/src/pages/liff/LiffEarlyPayoff.tsx`; เพิ่ม regression ใกล้ `apps/api/src/modules/paysolutions/paysolutions.webhook-receipts.spec.ts`

**Interfaces:** QR ปิดยอดต้องอ้าง quote/payment intent ที่ server รับรองและใช้บัญชีปิดยอดชุดเดียวกับ admin; การชำระงวดปกติรักษาพฤติกรรมเดิม

- [ ] ทำ failing integration จาก LIFF quote → สร้างลิงก์ → webhook ปัจจุบัน เพื่อพิสูจน์ว่าปิดยอดถูกกระจายเป็นงวดและส่วนลด/เงินพักไม่ตรงอย่างไร
- [ ] Trace บริการสร้าง payment link จริงจาก DI; บันทึก type/schema ของ intent ที่มีอยู่ก่อนเพิ่ม field ไม่เดาชื่อ service หรือแยกประเภทจากยอดเงินอย่างเดียว
- [ ] เขียนแผนย่อย `docs/superpowers/plans/2026-10-04-liff-early-payoff-qr.md` หลัง PR4: การแยก intent, quote expiry/version, สิทธิ์ลูกค้า, approval policy และรายการเงินที่เข้ามาหลัง quote หมดอายุ/เปลี่ยนยอด
- [ ] จุดที่ต้องมีคำตัดสินก่อนเขียน posting: QR ปิดยอดต้องรออนุมัติเหมือนช่องทางใด และเงินที่ provider รับแล้วแต่ปิดไม่ได้จะพัก/คืนผ่านขั้นตอนไหน; ห้ามตอบ failure แล้วปล่อยเงินหายจากทะเบียน
- [ ] ใช้ transaction-safe core ของการปิดยอดเดิม; ตรวจลายเซ็น webhook ยอดเงิน สกุลเงิน contract และ payment intent จาก server; claim/idempotency กับ JE/receipt ต้อง atomic ตามโครงสร้างที่ทบทวนแล้ว
- [ ] ทดสอบ callback ซ้ำ/สลับลำดับ, สอง callbacks แข่งกัน, QR เก่า, ยอดสั้น/เกิน, quote เปลี่ยนเพราะจ่ายผ่านหน้าร้าน, closed contract, closed accounting period และ no-owner/system-user
- [ ] ยืนยัน receipt ออกหลัง commit และผูก JE เดียว; notifications ใช้ transport จำลองในเครื่อง; ทดสอบ provider sandbox หลังมี environment และผู้รับทดสอบที่อนุญาต

**Done:** ยอด QR/admin/LIFF ตรงกัน ปิดสถานะ/บัญชี/เอกสารถูกต้อง และ webhook ซ้ำไม่รับเงินซ้ำ

## Task 7: ใช้ข้อมูลบอทฟรีดาวน์ #1645 ให้ครบ

**Files:** ใช้ branch `feat/bot-free-down-thai-in-store` ใน `BESTCHOICE-gfin-parts`; `scripts/ops/apply-bot-free-down-thai-2026-09-27.sh`/`.sql`, `rollback-bot-free-down-thai-2026-09-27.sh`/`.sql` และ fixtures bot-eval ใน diff PR

**Interfaces:** persona + KB + image setting เป็นชุดข้อมูลเดียวกัน; apply ต้องตรวจ version/hash และมี rollback ที่ไม่ทับข้อมูลใหม่

- [x] อ่าน production persona/KB/image แบบ read-only เพื่อแยกว่าใช้แล้วหรือยัง; อย่าตัดสินจาก PR เปิดอย่างเดียว
- [ ] รวม main ล่าสุดและทดสอบสคริปต์กับฐานสำเนาสังเคราะห์: apply, apply ซ้ำ, rollback, data drift, missing image และ error กลางทาง
- [ ] หากข้อมูลปัจจุบันไม่ตรง hash เดิม ให้เปรียบเทียบและจัด patch ใหม่ที่รักษาการแก้ระหว่างทาง ห้าม bypass precondition
- [ ] ตรวจเนื้อหา: ฟรีดาวน์มีเครื่องไทยบางรุ่น, ไม่เดาค่างวด/รุ่น, เอกสารไม่ใช่บัตรใบเดียว, ทุกเคสมาทำสัญญาและรับเครื่องที่ร้าน และตาราง 16/16 Pro ตามกติกาใน PR
- [ ] รัน dry evaluation และ real-model evaluation เฉพาะฉากที่เปลี่ยนให้ครบ; หากเครดิตโมเดลไม่พอให้คงสถานะตรวจจริงไม่ครบ ไม่ใช้ dry-run แทน
- [ ] เตรียมผล diff/config snapshot/วิธี apply+rollback ให้ตรวจได้ก่อนขั้นเขียน prod; ทดสอบภายในโดยไม่ส่งแชทถึงลูกค้าจริง

**Done:** ข้อมูลที่ใช้งานจริงตรงชุดที่ตรวจแล้ว และมีผลทดสอบโมเดลจริงครบขอบเขต

## Task 8: ตรวจ staging และ storage จริง (#1572)

**Files:** ใช้ `docs/guides/docs-integration.md`, `tools/docs-integration.sh`, runbook ใน comment #1572; บันทึกผลใน evidence report

**Interfaces:** รับ environment แยก/บัญชีทดสอบ/real object storage; ส่งเอกสารและผลเข้าถึงจาก browser จริงโดยไม่มีข้อมูลลูกค้าจริง

- [ ] ตรวจว่ามี staging แล้วหรือไม่ และระบุผู้ดูแล/URL/ชนิด storage; ถ้าไม่มี เตรียมรายการทรัพยากรกับขอบเขตค่าใช้จ่ายให้เจ้าของตัดสินใจก่อนสร้าง
- [ ] ฐาน SHOP/FINANCE, bucket และ credentials ต้องแยก prod; ปิด cron/ผู้รับภายนอกที่อาจยิงข้อความจริง ใช้ seed สังเคราะห์ที่ได้รับอนุญาต
- [ ] รัน `npm run docs:check` เป็น baseline บนเครื่อง; แล้วใช้ชุดประเภทเอกสารเดิมตรวจ staging: render → persist → download, bytes/hash, เก็บไฟล์อยู่หลัง restart/deploy
- [ ] ตรวจ signed URL หมดอายุ, CORS browser, ไม่มี staff Authorization ไปหา bucket, ผู้ใช้คนละบริษัท/สาขา, deleted document, signature replacement และ version ของไฟล์
- [ ] จำลอง storage outage ใน staging เท่านั้น; UI ต้องแจ้งข้อผิดพลาด/ลองใหม่ได้ ไม่ regenerate เงียบหรือแสดง success ทั้งที่เก็บไฟล์ไม่สำเร็จ
- [ ] บันทึก retention/lifecycle policy และผลแต่ละรายการที่ทดสอบจริง; OTP/LINE/email ที่ยังไม่ส่งต้องระบุว่าไม่ได้ตรวจ ไม่รวมเป็น pass

**Done:** #1572 มีหลักฐาน environment จริงครบ criteria; local fixture อย่างเดียวไม่ปิด issue นี้

## Task 9: ตรวจพิมพ์จริง (#1571)

**Files:** ใช้ manifest จาก docs integration และ runbook #1571; evidence report เก็บชื่อไฟล์สังเคราะห์/ผล ไม่ใส่ข้อมูลลูกค้า

**Interfaces:** เอกสารจาก ref สุดท้ายหลัง PR4/PR7 และเครื่องพิมพ์ที่ร้านใช้; ผลรับรองโดยผู้ตรวจจริง

- [x] เตรียม print pack ตาม manifest ทุกกลุ่ม ครอบ short/long, ต้นฉบับ/สำเนา, payroll ต่อพนักงาน, ใบเสร็จงวดสุดท้าย และสติกเกอร์ 50×30
- [ ] ผู้ตรวจบันทึก printer, OS, browser/driver, กระดาษ, scale/margins; พิมพ์ด้วยการตั้งค่าที่ใช้งานจริง
- [ ] ตรวจตัวอักษรไทย ขอบกระดาษ จำนวนหน้า บรรทัดยอดรวม พื้นที่กรอก/ลายเซ็น และชื่อรุ่นบนสติกเกอร์; รักษาขนาดฟอนต์ที่ตกลง ไม่ลดฟอนต์เพื่อให้ผ่าน
- [ ] ตรวจ native PDF viewer/print/download และกลับมาหน้าเดิม; defect ที่พบส่งกลับ task เจ้าของ renderer พร้อมไฟล์สังเคราะห์และค่าพิมพ์ที่ทำซ้ำได้
- [ ] หากแก้ renderer ให้ทดสอบ PDF regression และพิมพ์เฉพาะประเภทที่กระทบซ้ำ; ไม่มีเครื่องพิมพ์/ผู้ตรวจให้คงสถานะรอตรวจจริง

**Done:** ผลพิมพ์ลงนามรับรองตามประเภท ไม่ใช้ screenshot แทนกระดาษจริง

## Task 10: เก็บคีย์ตั้งค่าเก่า (#1606)

**Files:** อ่านตัวเรียกใน repo และ runbook config; ถ้าจำเป็นสร้าง `docs/runbooks/2026-10-04-credit-precheck-config-cleanup.md`

- [x] ค้น `credit_precheck_ai_enabled` ทั้ง source/scripts/docs และอ่านแถวปัจจุบันแบบ read-only
- [ ] ถ้าไม่มีผู้ใช้และเจ้าของยังยืนยันถอด automatic pre-check ให้เตรียม soft-delete แบบ conditional ตามค่าที่ตรวจ พร้อม snapshot และขั้น restore เฉพาะแถวนั้น
- [ ] ถ้าถูกลบแล้ว บันทึกหลักฐานและปิดรายการโดยไม่เขียนซ้ำ; ถ้าต้องการ automatic pre-check กลับมา ให้เป็น requirement ใหม่ ไม่คืน feature จากคีย์เก่าเพียงตัวเดียว
- [ ] ถ้าไม่แตะ prod เพราะเป็นคีย์ไร้ผล ให้เสนอปิดเป็น wontfix ตาม issue พร้อมเหตุผล ไม่ใช้คำว่าแก้แล้ว

**Done:** สถานะคีย์กับความตั้งใจตรงกัน ไม่มีคู่มือแนะนำสวิตช์ที่ไม่มีผล

## Task 11: ตรวจ OTP/credit gate และปิด test mode (#1602)

**Files:** อ่าน `apps/api/src/modules/test-mode/test-mode.service.ts`, `.controller.ts`, `modules/contracts/services/contract-lifecycle.service.ts` และเทสเดิม; ใช้ `docs/runbooks/go-live-checklist.md`

**Interfaces:** `TEST_MODE_BYPASS` ปัจจุบัน + ช่องทาง OTP/credit/KYC ที่ใช้งานจริง; OWNER เป็นผู้ตัดสินวันเริ่มใช้

- [x] อ่านค่าปัจจุบันและ active environment ใหม่; ถ้าปิดอยู่แล้วให้ตรวจ acceptance เดิม ไม่ toggle เพื่อให้ดูเหมือนมีงานทำ
- [ ] ตรวจบริการ OTP/credit/KYC ใน staging และเตรียมผู้รับทดสอบจริง; ขั้นส่ง OTP ต้องมีเบอร์ทดสอบและคำอนุญาตส่ง ไม่ใช้เบอร์ลูกค้าที่พบในฐาน
- [ ] เมื่อพร้อม เปิดเผย release/ref, ผลบัญชี/สิทธิ์/OTP และวิธีหยุด rollout ให้เจ้าของตัดสิน go-live; จัดการข้อมูลทดสอบค้างเป็นรายการแยก ไม่ล้าง prod โดยอัตโนมัติ
- [ ] OWNER ปิดที่ตั้งค่า › ความปลอดภัย › โหมดทดสอบ หรือใช้ขั้นตอนที่อนุญาตเฉพาะเจาะจง; ตรวจค่ากลับหลังเขียนและแถบแดงหาย
- [ ] ทดสอบสัญญาสังเคราะห์ที่ยังไม่ผ่านเครดิตต้องส่งตรวจไม่ได้ และสัญญาที่ผ่านขั้นตอนจริงเดินต่อได้; ทดสอบ expired/wrong OTP และสิทธิ์ non-owner
- [ ] ถ้า flow ใช้จริงล้ม ให้หยุดรับสัญญาใหม่/แก้สาเหตุ ไม่เปิด bypass เพื่อรับลูกค้าจริงเป็นทางถอยอัตโนมัติ

**Done:** ผล OTP ถึงผู้รับทดสอบจริง, credit gate ทำงาน, bypass=false และมีผู้รับรองวันเริ่มใช้งาน

## Task 12: Release และปิดทะเบียนงาน

**Files:** evidence report, แผนฉบับนี้, runbook ที่กระทบ และรายการ GitHub เดิมเมื่อได้รับขอบเขตให้ปรับสถานะภายนอก

- [ ] แยก release ตาม PR และ dependency พร้อมผล CI ของ head ที่จะ merge จริง; ตั้งค่า prod/บอทแยกจาก deploy โค้ด
- [ ] ก่อนแต่ละ release เสนอ diff, ผลตรวจ, migration ถ้ามี, ผลกระทบคำขอค้าง และวิธีถอยที่ผ่านการทดสอบแล้ว; ขอคำตัดสินเมื่อผลพร้อมตรวจได้
- [ ] หลัง release ตรวจ SHA/version/API health และ smoke เฉพาะ flow ที่เปลี่ยนโดยไม่สร้างธุรกรรมลูกค้าจริง; บันทึกผล local/staging/prod คนละช่อง
- [ ] อัปเดตงานลูกเมื่อมีหลักฐานครบ; #1607 ปิดเมื่อรายการลูกแก้/ตัดสิน disposition แล้ว; #1574 ปิดเมื่อ #1571/#1572 และข้อสังเกตที่ยืนยันได้มีผลครบ
- [ ] ส่งลิงก์ preview ที่ยังทำงาน, PR/release, ผลทดสอบ และรายการเลื่อนอย่างชัดเจน; ไม่อ้างว่าครบจาก CI สีเขียวอย่างเดียว

**Done:** รายการที่อยู่ในขอบเขตมีผลรับรองครบหรือมีคำตัดสินเลื่อนชัดเจน และไม่มีงานที่แสดงว่าเสร็จแต่ยังขาดการตรวจจริง

## 3. คำสั่งตรวจมาตรฐานระหว่างลงมือ

รันเฉพาะจาก checkout ของงานและตรวจพอร์ตว่างก่อน ใช้ runner ปัจจุบัน; ไม่ใช้ `npm run lint` ฝั่ง API โดยไม่อ่าน script เพราะมี `--fix`:

```bash
# แต่ละชุดโค้ด: basic checks + refresh preview
npm run local:check
npm run local:status

# ชุดบัญชี/API: runner สร้างและทำลายฐานทดสอบของตัวเอง
CREDIT_RUN_API_REGRESSION=1 bash tools/test-chat-credit.sh

# เอกสาร: disposable DB + manifest/PDF evidence
npm run docs:check

# ตรวจ patch เอกสาร/โค้ดโดยไม่แก้ไฟล์
git diff --check
```

`tools/test-chat-credit.sh` ปัจจุบันใช้ Vite 5189 แบบ strictPort; ถ้าถูกใช้อยู่ห้าม kill ผู้ใช้งานเดิม ให้ปรับ runner ให้รับพอร์ตว่างในงานของตนก่อนรัน พร้อมตรวจการเปลี่ยนนั้น ชุด integration/CI อื่นให้ใช้คำสั่งจาก workflow ปัจจุบัน ไม่สมมติว่า runner เดียวครอบทุก module

หลักฐานแต่ละ task: head SHA, เวลา Bangkok, command, exit code, passed/failed/skipped, synthetic/external services, browser URL และขอบเขตที่ยังไม่ตรวจ; เมื่อแก้ source หลังตรวจต้องรันชุดที่ได้รับผลกระทบใหม่

## 4. สิ่งที่ต้องได้จากเจ้าของ/ฝ่ายที่เกี่ยวข้อง

| ข้อมูล/คำตัดสิน | ใช้เมื่อ | ระหว่างรอยังทำอะไรต่อได้ |
|---|---|---|
| คำตอบบัญชี Q7–Q9 ที่ยังไม่มีหลักฐาน | ก่อนเขียน posting ของ PR4 | #1665/#1667, session, UI และชุด scenario |
| นโยบายอนุมัติ/เงินรับแล้วแต่ quote เปลี่ยนใน QR | ก่อน implementation X4 | reproduce + แผนย่อย + fixture |
| staging/สิทธิ์/ขอบเขตทรัพยากร | ก่อนตรวจ #1572 จริง | local docs suite + runbook |
| ผู้ตรวจและเครื่องพิมพ์ร้าน | ก่อนปิด #1571 | print pack/manifest |
| เบอร์และการอนุญาตส่ง OTP, วันใช้จริง | ก่อนส่งจริง/ปิด bypass | fake-provider/credit gate tests |
| ขอบเขต apply bot/soft-delete config/merge prod | หลังเตรียม diff และผลตรวจครบ | dry-run/PR/rollback evidence |

## 5. รายการเลื่อนตามคำตัดสินเดิม

- **X6 e-Tax:** ยังไม่เปิดใช้ตาม O3; เมื่อจะใช้จริงต้องตรวจ VAT ให้ตรงใบกำกับ/บัญชี และแยกการส่งเอกสารออกภายนอก
- **X7 QR บนใบเสร็จ:** ยังไม่ทำตาม O4; ไม่สร้าง route `/r/:number` หรือเปิดสิทธิ์ public เพิ่มในรอบนี้
- งาน refactor ใหญ่/เพิ่มฟีเจอร์ใหม่ที่ไม่เกี่ยวกับ defect ไม่ใช่เงื่อนไขปิดแผนนี้

## 6. เกณฑ์จบโครงการรอบนี้

- [ ] โค้ดค้าง #1665/#1667 และข้อบกพร่อง #1603–#1605 ตรวจและส่งขึ้นตามลำดับแล้ว
- [ ] PR4/PR7 และ X4 ผ่านคำตัดสินบัญชี/ธุรกรรมที่จำเป็น และยอดทุกช่องทางตรงกัน
- [ ] บอทใช้ข้อมูลที่ตรวจแล้ว, คีย์เก่ามี disposition และไม่มีการเปิดฟีเจอร์ที่เลื่อนไว้เอง
- [ ] เอกสารผ่าน staging/storage และเครื่องพิมพ์จริง หรือเจ้าของมีคำตัดสินเลื่อนที่ระบุขอบเขตชัดเจน โดยไม่เรียกว่าผ่าน
- [ ] OTP/credit gate พร้อมและ bypass=false ก่อนรับสัญญาลูกค้าจริง
- [ ] ทะเบียนงาน/PR/ผล release ตรงกับหลักฐาน และผู้ใช้ได้รับ preview กับข้อจำกัดที่ตรวจจริง

**สถานะเมื่อเขียนแผน:** ตรวจแหล่งอ้างอิงและโค้ดแบบ read-only; ยังไม่ได้แก้ product code, รันทดสอบรอบใหม่, merge, deploy หรือส่งข้อความภายนอก
