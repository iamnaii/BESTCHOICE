# ECL Per-Installment + JP5 จัดเต็ม + Workbook v4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เปลี่ยน ECL เป็นแยกงวด (per-installment aging, floor dormant) + JP5 GL-based legs + release residual + workbook v4 — spec: `docs/superpowers/specs/2026-07-26-ecl-per-installment-design.md` (ฉบับหลัง scrutinize 59c9ea3c — BINDING ทุก §)

**Architecture:** engine กลาง `computeInstallmentOutstanding` (ต่อยอด compute-cn-breakdown ที่ fee-netted แล้ว) → calculateProvisions/reverseStageOnPayment/CN ใช้ร่วมกัน; JP5/write-off เพิ่ม release residual; workbook สร้างท้ายสุดจาก goldens

**Tech Stack:** ตามชุดเดิม (NestJS/Prisma/Decimal, jest unit, vitest DB ใน cpa-templates/, xlsx skill สำหรับ workbook)

## Global Constraints

- ทุกข้อใน spec §2 ผูกพัน — โดยเฉพาะ: selection DUE (ECL) / ACCRUED (CN); aging จาก `Payment.dueDate`; fee-netted outstanding (สูตร computeCnBreakdown เดิม — ห้ามเขียนใหม่); **floor dormant**: `consecutive_missed_bucket_map` ไม่มี row หรือ JSON ว่าง = ไม่มี floor (semantics ใหม่ — เดิม fallback code default; ลบ DEFAULT_STREAK_BUCKET_MAP fallback), มี row explicit = floor ต่องวดแบบ max-rate
- Goldens วิธีแยกงวด (17k/12, aging ล้วน): งวดเดียว 30d → 30.32; ชุด {60,30} → 257.69; {90,60,30} → 1,015.61; {120,90,60,30} → 2,152.48; CN goldens เดิมห้ามขยับ (33.75/38.71/232.09/297.51)
- JP5/write-off GL-based: Cr/Dr จาก glBalance จริง; consume = min(loss, GL 11-2102); **release = GL 11-2102 − consume เสมอ** (รวม gain branch = release ทั้งก้อน); JE เดียว balance; ระบบ canonical เรื่องสตางค์ (workbook ตามระบบ)
- BadDebtProvision: `bucketBreakdown Json?` ใหม่; agingBucket = bucket งวดเก่าสุด; provisionRate = blended 4dp; rows mark REVERSED ตอน JP5/write-off
- กลไกที่**ห้ามแตะ**: delta-vs-GL + runDate idempotency + daily cron + dry-run โครง + release cap GL + CN document/delivery layer (ใช้ผ่าน computeCnBreakdown interface เดิมเท่านั้น)
- เลขระบบ = canonical: goldens JE ระดับสตางค์ปักตอน implement จากสมการ balance ใน test (ห้าม hardcode จาก workbook count-based)
- Branch `feat/ecl-per-installment`; commit ลงท้าย Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>; **MERGE GATE: รอ CPA ยืนยัน 2 บรรทัดผ่าน owner (spec §4)**

---

### Task 1: Engine `computeInstallmentOutstanding` + refactor CN บนมัน
**Files:** Modify `apps/api/src/modules/journal/compute-cn-breakdown.ts` (เพิ่ม export ใหม่ + refactor ภายใน; ไฟล์เดียวกัน — cohesive) + spec file เดิม
- `computeInstallmentOutstanding(client, contract, { selection, asOf?, preloaded? })` → rows ตาม spec §2.1; DUE = Payment rows `status != 'PAID'` + `dueDate < asOf` (ครอบ PENDING/PARTIALLY_PAID/OVERDUE — เท่าพฤติกรรม calculateProvisions ปัจจุบัน); ACCRUED = ตามนิยาม CN เดิม; daysOverdue = floor((asOf − payment.dueDate)/86400s) (DUE) / สำหรับ ACCRUED ไม่ต้องมี daysOverdue ก็ได้ (CN ไม่ใช้) แต่ให้คืนถ้ามี Payment row
- `computeCnBreakdown` = wrapper บน ACCRUED rows — assert ทุก golden test เดิมผ่านโดยไม่แก้ expectation แม้แต่ตัวเดียว
- Tests เพิ่ม: DUE vs ACCRUED แตกต่างเมื่องวดเลย dueDate แต่ 2A ยังไม่ run (DUE เห็น, ACCRUED ไม่เห็น); fee-netting ใน DUE path; preloaded ไม่ query
- Gate: jest compute-cn-breakdown (เดิม 14 + ใหม่) + vitest CN specs (unchanged) + types

### Task 2: Schema `bucketBreakdown`
**Files:** schema.prisma (model BadDebtProvision) + migration `add_bucket_breakdown_to_bad_debt_provisions` — คอลัมน์เดียว Json? — migrate diff + deploy pattern เดิม (Task 1 ของ phase 3 ทำไว้เป็นตัวอย่าง)

### Task 3: `calculateProvisions` แยกงวด + floor dormant
**Files:** `bad-debt.service.ts` + `bad-debt.service.spec.ts` + streak integration specs 3 ไฟล์
- ต่อสัญญา: rows จาก engine (DUE, preloaded payments ที่ query รวมแล้ว — no N+1); bucket_i จาก daysOverdue_i; floor: โหลด `consecutive_missed_bucket_map` — **ไม่มี/parse ว่าง = ไม่มี floor** (ลบ fallback DEFAULT_STREAK_BUCKET_MAP; corrupt JSON ยัง Sentry เตือน); มี map = getStreaks + bucket_i = max-rate(aging_i, floorBucket)
- provision = Σ rows; เก็บ bucketBreakdown/blended rate/oldest bucket; ลบ `terminatedCarryingAmount` + contractStatus override (unified)
- Unit goldens: scenario series 30.32/257.69/1,015.61/2,152.48 (mock payment rows อายุ 30/60/90/120) + partial row ใช้ fee-netted outstanding + TERMINATED เหมือน ACTIVE + floor-enabled case (config set → 454.74 สำหรับ {60,30} streak 2 — พิสูจน์ dormant path ยังทำงานเมื่อเปิด)
- Streak integration specs (vitest): เดิม assert floor โดยไม่ seed config (พึ่ง code default) → **แก้ให้ seed config explicit ใน beforeAll** (ทดสอบ dormant-enabled path) + เพิ่ม 1 spec ว่า no-config = aging ล้วน
- Update dry-run deltas shape ถ้าจำเป็น (bucket ต่อสัญญา → oldest)

### Task 4: `reverseStageOnPayment` engine-based
**Files:** `bad-debt.service.ts` + specs
- target = Σ engine rows (DUE, asOf now); release = min(row.provisionAmount − target, GL 11-2102) ถ้า > 0; target 0 → full reverse (release = min(row, GL)); ลบ branch TERMINATED + rate-compare logic; อัปเดต row (amount/bucketBreakdown/blended/oldest)
- ลบ `ecl-terminated-base.spec.ts` goldens เก่า → เขียนใหม่: TERMINATED 3 งวด accrued อายุ 100/70/40 → per-installment = 1,515.83×(0.75+0.50+0.15) = **2,122.16** (ตรวจเลขตอน implement: 1,136.87+757.92+227.37 = 2,122.16) — DB spec ใน cpa-templates
- Unit: จ่ายงวดเก่าสุด → target ลด → release ถูก cap GL; TERMINATED behaves same

### Task 5: JP5 GL-based legs + release residual
**Files:** `repossession-jp5.template.ts` + `jp5-vat-split.spec.ts` (+ repossessions.service.spec ถ้า return shape เพิ่ม)
- แทน count-based legs: bal2103/bal2101/bal2106/bal2105/bal21_2102 จาก glBal (ยก pattern จาก bad-debt-writeoff.template.ts:77-104 — พิจารณา extract shared helper `journal/gl-contract-balance.ts` ใช้ 3 ที่: JP5/write-off/bad-debt.service — DRY ตอนนี้เหมาะเพราะแตะทั้งสามอยู่แล้ว); CN VAT pro-rated (คงจาก util); consume = min(loss, GL) → **release = GL − consume (บรรทัดใหม่ Dr 11-2102 / Cr 51-1103)**; gain branch: consume 0 + release ทั้งก้อน + Cr 41-1102 เดิม; loss plug จากสมการ balance
- mark BadDebtProvision rows REVERSED ใน repossessions.service (tx เดิม หลัง JP5)
- Goldens: (ก) เคสเดิมทั้งหมดต้อง re-derive เป็น GL-based (เลขขยับสตางค์ — comment สมการในทุก assertion); (ข) scenario A จำลองเต็ม (1A+2A×4+2B×3+PROV 30.32+JP5 sp5,000): expected legs จาก GL + release 0 (provision 30.32 < loss → consume หมด) — Net loss ≈ 8,513.02 ปักจากสมการ; (ค) partial-paid case: Cr 11-2103 = GL หลังรับเงินจริง (ปิด backlog over-credit — assert 11-2103 เหลือ 0 หลัง JP5); (ง) provision > loss (ตั้ง provision ใหญ่ก่อน) → release > 0 + 11-2102 = 0
- **หมายเหตุ interplay:** loss ตอนนี้ = GL-based → jp5-vat-split เดิมที่คำนวณ loss จาก count จะแก้ทั้งไฟล์ — ห้ามลด coverage (ทุก scenario เดิมคงอยู่ในรูป GL-based)

### Task 6: write-off release residual
**Files:** `bad-debt-writeoff.template.ts` + spec — บรรทัด release หลัง consume (สมมาตร JP5); goldens: เคส provision > loss สร้างได้โดยตั้ง provision เกิน (template test มีตัวอย่าง consume แล้ว) → assert release + 11-2102 = 0; เคสเดิม (provision < loss) release = 0 ไม่มีบรรทัด

### Task 7: Reports + docs
- `getProvisionSummary`: byBucket จาก Σ bucketBreakdown (สัญญากระจายหลาย bucket); details คง shape + เพิ่ม breakdown
- `.claude/rules/accounting.md`: rewrite ส่วน ECL v3 → v4 per-installment (วิธีคิด, floor dormant + semantics เปลี่ยน, TERMINATED unified, JP5 release + GL legs, ตาราง goldens ใหม่) — ระวังอย่าลบส่วน CN/pro-rate ที่ยังจริง
- dry-run CLI: deltas เพิ่ม bucketBreakdown summary

### Task 8: Gates + final review
- types all / jest full (baseline depreciation triage) / vitest CI-equivalent / code-reviewer per-task ครบแล้ว → final whole-branch (fable) + fix waves ตาม pattern

### Task 9: Workbook v4 (หลัง T8 ผ่าน)
- xlsx skill: 8 sheets โครงตามรูปเดิม + ตัวเลขจาก goldens ระบบ (แยกงวด GL-based) + แก้ 3 จุดผิด + labels + แถว pro-rate + คอลัมน์/แถว release + CPA note box (4 ข้อ: แยกงวดยืนยัน / floor dormant ยืนยัน / deferred ไม่ตั้งสำรอง / นโยบายสตางค์ GL) → commit `docs/accounting/ECL-workbook-v4-per-installment.xlsx` + สรุปให้ owner ส่ง CPA
- Owner review → **PR เปิดได้เลย แต่ merge รอ CPA confirm** (spec §4)

## Out of scope
- CN document/LINE layer, letters, token hygiene, NET_PI
- เปิด floor กลับ (ถ้า CPA สั่ง — spec addendum แยก)
