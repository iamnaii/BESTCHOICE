# Deep Review — Design Spec

**Date**: 2026-04-17
**Scope**: Whole codebase (monorepo: apps/web, apps/api, prisma, infra)
**Output mode**: Report + auto-fix (merged directly)
**Severity threshold**: All (Critical + Warning + Info)
**Execution**: Sequential Deep Dive (dimension by dimension)

---

## Purpose

รอบ hardening ต่อจาก ultraplan v1-v4 + audit 21 fixes (2026-04-17) — ไล่ทั้ง codebase ครอบคลุมทุกมิติ เพื่อเตรียม production go-live

## Dimensions & Order

ลำดับ top-down: fix foundation layer ก่อน เพราะ layer สูงขึ้นไปพึ่งพา

| # | Dimension | เหตุผล |
|---|-----------|--------|
| 1 | Database & Schema | Prisma model / FK / index / migration — layer ล่างสุด, service ข้างบนพึ่งพา |
| 2 | Security | Auth, guards, JWT, CSRF, public endpoints, PII log, secrets — blocker ของทุกอย่าง |
| 3 | Correctness (core) | Decimal precision, soft-delete query, race condition, transaction scope |
| 4 | Accounting logic | Journal balance, VAT, chart of accounts, revenue recognition, commission — TFRS for NPAEs compliance |
| 5 | Backend patterns | controller→service→Prisma violation, DTO validation, error handling, pagination |
| 6 | Integrations | LINE, Facebook, PaySolutions, MDM, SMS, GFIN — timeout, retry, webhook idempotency |
| 7 | Frontend core | React Query usage, cache invalidation, Zustand state, QueryBoundary, routing, lazy-load |
| 8 | Frontend polish | Design tokens (no hardcoded gray/hex), Thai `leading-snug`, shadcn/ui compliance |
| 9 | Performance & Ops | N+1 query, bundle size, cron reliability, retention, monitoring, health endpoint |
| 10 | Tests + DX | API test coverage, unit test coverage, type safety, lint |
| 11 | **E2E Coverage Audit** | Audit 35 existing specs, เขียน smoke test ใหม่สำหรับ critical flows ที่ยังไม่ครอบคลุม (POS, payment, contract sign, LIFF) |

## Per-Dimension Workflow

แต่ละ dimension ไหลตาม 6-step cycle:

### 1. AUDIT
- Opus (parent) อ่าน `.claude/rules/<relevant>.md` + context จาก CLAUDE.md
- Opus run Grep/Glob หา pattern หลัก
- Dispatch sonnet subagent (Explore) ทำ deep scan
- subagent prompt ต้องรวม instruction: "อ่าน `git log -20` ก่อน หา finding ที่ซ้ำกับ fix ที่ merge ไปแล้ว — skip"
- subagent return: structured findings list (severity, file:line, root cause, fix proposal)

### 2. TRIAGE
- Opus อ่าน findings, verify 1-2 ตัวอย่างด้วย Read/Grep
- จัดกลุ่ม findings ตาม root cause (กัน duplicate fix)
- ตัด false positive ที่ subagent เข้าใจ context ผิด

### 3. FIX
- Opus แก้ทุก severity (Critical + Warning + Info)
- 1 root cause = 1 edit session
- Mechanical fix — opus แก้เอง (ไม่ dispatch subagent มาแก้)

### 4. VERIFY
- `./tools/check-types.sh all` → 0 errors
- Related unit/integration tests (เฉพาะ test ที่เกี่ยวกับ dimension)
- **E2E: `cd apps/web && npx playwright test`** → ต้องเขียวก่อนไป dim ถัดไป
- Manual spot-check 2-3 files
- **หยุดถ้า verify ไม่ผ่าน** — fix ก่อนไป dim ถัดไป

### 5. COMMIT
- 1 dimension = 1 commit (แยก sub-commit ถ้า domain ภายในต่างกันชัด)
- Message: `fix(<dim>): <summary> (<n> findings)`
- **ไม่ push** จนจบทุก dimension

### 6. REPORT ENTRY
- เพิ่ม section ใน `docs/reports/2026-04-17-deep-review.md` (finding count, fix summary, file touched count, test status)

## Severity Policy

- **Critical** — bug ที่กระทบ production data/security/money (auth bypass, decimal rounding, journal imbalance, race condition)
- **Warning** — pattern violation, tech debt, risk ที่ยังไม่เกิด (missing guard, unbounded query, N+1)
- **Info** — polish, lint, stale comment, design token, A11y nit

ทั้งหมดแก้ในรอบนี้

## Exit Criteria

- ✅ ครบ 11 dimensions ผ่าน audit+triage+fix+verify cycle
- ✅ `./tools/check-types.sh all` → 0 errors
- ✅ API + Web unit tests ไม่มี regression เทียบ baseline (577 API / 129 Web)
- ✅ E2E tests เขียวทั้ง 35+ specs
- ✅ Critical flow E2E specs ครอบคลุม: POS, payment recording, contract sign, LIFF (customer portal)
- ✅ Commits clean — แต่ละตัว build+type+E2E ผ่าน
- ✅ Final report `docs/reports/2026-04-17-deep-review.md` รวม dimension-by-dimension summary

## Not In Scope

- ❌ Feature ใหม่ (GFIN integration, VAT-on-interest decision, PII column encryption)
- ❌ Business logic ที่ต้อง CPA review (N-005 interest upfront, CR-001 VAT on interest)
- ❌ Dependency version bump (เสี่ยง breakage — แยก sprint ต่างหาก)
- ❌ Large refactor (module restructure, schema redesign) — บันทึกใน report ให้ followup

## Risks + Mitigation

| Risk | Mitigation |
|------|------------|
| Fix ใน dimension ต้นๆ (DB/Security) ทำให้ test พัง | Verify (incl. E2E) หลังแต่ละ dim; rollback commit ถ้า block |
| Fix volume ใหญ่เกิน (>50 findings/dim) → context bloat | Dispatch sonnet subagent ทำ audit phase, opus รับแค่ structured findings |
| Subagent เจอ false positive บ่อย | Opus triage ก่อน fix — verify 1-2 ตัวอย่างเอง |
| Commit ยาวเกิน, revert ยาก | 1 dimension = 1 commit (แยกย่อยตาม domain ถ้าจำเป็น) |
| Overlap กับ 21 audit fixes ที่เพิ่งปิด | Audit prompt ให้ subagent อ่าน `git log -20` ก่อน — skip duplicate |
| E2E flaky ทำให้ dim ผ่านไม่ได้ | Retry 2 ครั้ง, ถ้ายัง flaky → mark flaky + note ใน report ไม่ถือว่า block |
| E2E ใช้เวลารัน 10-20 นาที/รอบ × 11 dim | รัน E2E subset ที่เกี่ยวกับ dim นั้น; full suite ปิดท้าย |

## Estimated Effort

- **11 dimensions × 20-40 min/dim = 4-8 ชม.** รวม E2E + fix
- Dimension ที่น่าจะ clean แล้ว (Security, Correctness) เร็วกว่า — เพิ่ง audit ไป
- Dimension ที่น่าจะหนัก: Frontend polish, E2E Coverage Audit (เขียน test ใหม่)

## Tools & Agents

| Phase | Tool/Agent | หมายเหตุ |
|-------|-----------|---------|
| Audit | sonnet subagent (Explore) | 1 subagent ต่อ dimension |
| Triage | Opus (self) | verify + dedupe |
| Fix | Opus (self) | mechanical, no review loop |
| Verify | Bash: `./tools/check-types.sh`, `playwright test` | automated |
| E2E writing | Opus (self) | follow `apps/web/e2e/*.spec.ts` pattern |

## Deliverables

1. Commit chain (11+ commits, ไม่ push จนจบ)
2. `docs/reports/2026-04-17-deep-review.md` — final report
3. E2E smoke tests สำหรับ critical flows ที่ยังไม่ครอบคลุม
4. TypeScript + tests ทั้งหมด green

## Decision Log

| Decision | Chosen | Alternative considered |
|----------|--------|------------------------|
| Scope | Whole codebase | Recent audit fixes only / specific feature |
| Dimensions | All 11 (incl. E2E) | Security+correctness only |
| Output | Report + auto-fix merged | Report only / plan only |
| Severity | All (Crit+Warn+Info) | Critical only |
| Execution | Sequential deep dive | Parallel swarm / hybrid map-then-fix |
| E2E inclusion | Both (per-dim verify + dedicated dim 11) | Verify only / dim 11 only |
