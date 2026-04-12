# BESTCHOICE CTO Development Roadmap 2026

> Created: 2026-04-12
> Author: CTO Planning Session
> Status: ACTIVE — updated quarterly

---

## Executive Summary

BESTCHOICE ผ่าน **4 hardening sprints** + **dependency upgrade (Tier 1-3)** เรียบร้อย
ระบบมี 56 API modules, 65+ pages, 577 API tests, 129 web tests, 0 TypeScript errors

**Next priorities**: ปิดช่องว่างทาง business logic → integrations → scale

---

## Current State (2026-04-12)

### What's Done
| Area | Status |
|------|--------|
| Hardening v1-v4 | 4 sprints complete (security, decimal, a11y, health) |
| Dep Upgrades Tier 1-3 | NestJS 11, React 19, Vite 8, Tailwind v4, ESLint 9, Zod 4 |
| DataAudit Module | 12 DB health checks + contract trace engine |
| Test Coverage | 577 API + 129 web tests |
| TypeScript | 0 errors across monorepo |
| DevOps | /health endpoint, x-request-id tracing, structured logging |

### Key Gaps
1. **FINANCE_MANAGER role** — ยังไม่มีในระบบ (blocker สำหรับ FINANCE operations)
2. **Payment structure** — ไม่แยก principal/interest/commission per installment
3. **Tax automation** — ภ.พ.30 / ภ.ง.ด.3 ยังทำ manual
4. **External integrations** — PEAK, MDM, CHATCONE ยังไม่ connect
5. **E2E coverage** — 55% page coverage, critical flows ยังขาด

---

## Roadmap Phases

### Phase 0: Quick Wins (สัปดาห์ที่ 1-2 ของ เม.ย.)
> **Goal**: ปิด low-hanging fruit ที่ค้างจาก audit

| # | Task | Type | Effort |
|---|------|------|--------|
| 0.1 | Fix missing deletedAt checks (4 จุด) | Bug | S |
| 0.2 | Fix soft delete filter in reorder-points | Bug | S |
| 0.3 | Add missing DTO validators | Quality | S |
| 0.4 | Late fee cap check (5%/เดือน ตามกฎหมาย) | Compliance | S |
| 0.5 | PII sanitization in audit logs | Security | S |
| 0.6 | useStatusBadge hook (consistent badges) | UX | S |
| 0.7 | EmptyState component in DataTable | UX | S |

**Deliverable**: PR with all quick fixes, reviewed + tested
**Managed Agent**: Daily code quality scan

---

### Phase 1: FINANCE_MANAGER Role (เม.ย. สัปดาห์ 3-4)
> **Goal**: Unblock ทุก FINANCE feature

| # | Task | Effort |
|---|------|--------|
| 1.1 | Add FINANCE_MANAGER to Prisma UserRole enum + migration | S |
| 1.2 | Update all relevant controllers with @Roles('FINANCE_MANAGER') | M |
| 1.3 | Update Sidebar, TopBar, MobileBottomNav role checks | M |
| 1.4 | Create seed data + test user | S |
| 1.5 | E2E tests for FINANCE_MANAGER flows | M |

**Deliverable**: FINANCE_MANAGER can login, see finance dashboard, approve contracts
**Unlocks**: Phase 2, 3, 4 ทั้งหมด

---

### Phase 2: Payment & Accounting Structure (พ.ค.)
> **Goal**: แก้โครงสร้างบัญชีให้ถูกต้องตาม TFRS for NPAEs

| # | Task | Effort |
|---|------|--------|
| 2.1 | Add monthlyPrincipal/Interest/Commission to Payment model | M |
| 2.2 | Update generatePaymentSchedule() to populate breakdowns | M |
| 2.3 | Separate interest income account (4110) | M |
| 2.4 | VAT input/output tracking per entity | M |
| 2.5 | Fix early payoff to use actual Payment records | M |
| 2.6 | Add Allowance for Doubtful + Credit Balance to Balance Sheet | S |
| 2.7 | Update all journal auto-generation for new structure | L |

**Deliverable**: Payment breakdown visible in UI, journals balanced correctly
**Unlocks**: Tax automation, accurate P&L, PEAK sync

---

### Phase 3: Tax & Compliance Automation (มิ.ย.)
> **Goal**: ระบบทำ tax filing ได้เอง ลด manual work

| # | Task | Effort |
|---|------|--------|
| 3.1 | TaxReport model + monthly VAT aggregation | L |
| 3.2 | ภ.พ.30 report generation (VAT monthly) | M |
| 3.3 | ภ.ง.ด.3/53 report generation (WHT monthly) | M |
| 3.4 | PDPA: DSAR auto-response workflow | M |
| 3.5 | PDPA: data retention enforcement | M |
| 3.6 | PDPA: consent revocation → stop notifications | S |

**Deliverable**: One-click monthly tax reports, PDPA compliance dashboard
**Unlocks**: ปิดบัญชีรายเดือนได้เอง

---

### Phase 4: External Integrations (ก.ค. — ส.ค.)
> **Goal**: Connect ระบบภายนอกที่ใช้งานจริง

| # | Task | Priority | Effort |
|---|------|----------|--------|
| 4.1 | **PEAK Sync** — auto-export journal entries | P0 | L |
| 4.2 | **MDM PJ-Soft** — auto-lock overdue phones | P0 | L |
| 4.3 | **Smart Dunning** — auto SMS/LINE before due date | P1 | M |
| 4.4 | **CHATCONE** — unified chat (LINE/FB/TikTok) | P1 | L |
| 4.5 | **GFIN** — external finance partner integration | P2 | L |

**Deliverable**: PEAK journals sync daily, overdue phones auto-lock
**Unlocks**: ลดงาน manual ทั้งบัญชีและติดตามหนี้

---

### Phase 5: Revenue & Operations (ส.ค. — ก.ย.)
> **Goal**: เพิ่มรายได้ ลด cost ผ่าน automation

| # | Task | Effort |
|---|------|--------|
| 5.1 | Sales Commission System (rules, tracking, auto-payout) | M |
| 5.2 | Collections Workflow (lane tracking, auto-escalation) | M |
| 5.3 | Dashboard แยกตาม role (OWNER/SALES/FINANCE) | M |
| 5.4 | Loyalty Points & Referral Program | M |
| 5.5 | Trade-In Valuation (ตารางตีราคากลาง) | M |
| 5.6 | Promotional Campaigns engine | M |

**Deliverable**: Commission auto-calculated, collection pipeline visible
**Unlocks**: Sales motivation, better debt recovery

---

### Phase 6: Scale & Polish (ต.ค. — ธ.ค.)
> **Goal**: Scale ระบบรองรับ multi-branch growth

| # | Task | Effort |
|---|------|--------|
| 6.1 | Multi-Entity separation (แยก 2 นิติบุคคลจริง) | XL |
| 6.2 | Advanced BI Dashboard (cohort, forecast, heatmap) | M |
| 6.3 | PWA (offline, install prompt, push) | L |
| 6.4 | UI Redesign (Metronic v9 full polish) | XL |
| 6.5 | PII column-level encryption (PDPA strict) | L |
| 6.6 | Off-site backup replication (GCS sync) | M |

**Deliverable**: Production-grade system ready for multi-branch scale

---

## Cross-Cutting: E2E Tests (ทำควบคู่ทุก Phase)

| Phase | Tests to Add |
|-------|-------------|
| After Phase 1 | FINANCE_MANAGER flows, POS checkout, contract signing |
| After Phase 2 | Payment breakdown verification, journal balance checks |
| After Phase 3 | Tax report generation, PDPA workflows |
| After Phase 4 | PEAK sync verification, MDM lock/unlock |
| After Phase 5 | Commission calculation, collection escalation |

---

## Managed Agent Strategy

### Daily Agent: `cto-watchdog`
- **Schedule**: ทุกวัน 06:00 UTC (13:00 เวลาไทย)
- **Tasks**:
  - TypeScript error check (both apps)
  - Scan for security anti-patterns (missing guards, raw SQL)
  - Check for Decimal violations (Number() on money fields)
  - Verify soft-delete compliance
  - Report any broken imports or circular dependencies
  - Check test count hasn't regressed

### Weekly Agent: `cto-progress`
- **Schedule**: ทุกวันจันทร์ 07:00 UTC (14:00 เวลาไทย)
- **Tasks**:
  - Git activity summary (commits, PRs, authors)
  - Phase progress tracking (which tasks done/remaining)
  - Dependency vulnerability scan
  - Bundle size check (track regression)
  - Generate weekly status report

---

## Success Metrics

| Metric | Current | Target (Q4 2026) |
|--------|---------|-------------------|
| API Tests | 577 | 800+ |
| Web Tests | 129 | 250+ |
| E2E Coverage | 55% pages | 90% pages |
| TypeScript Errors | 0 | 0 (maintained) |
| Manual Tax Work | 10+ hrs/mo | < 1 hr/mo |
| Collection Rate | Unknown | > 95% |
| PEAK Sync | Manual | Auto-daily |
| MDM Lock | Manual | Auto on overdue |

---

## Decision Log

| Date | Decision | Reason |
|------|----------|--------|
| 2026-04-12 | Defer Prisma 7 upgrade | Wait for 7.9+ stability |
| 2026-04-12 | CR-001 VAT on interest | รอปรึกษานักบัญชี |
| 2026-04-12 | GFIN = Phase 4 P2 | รอ API spec จาก partner |
| 2026-04-12 | UI Redesign = Phase 6 | ทำหลัง features เสร็จ |
