# Tier-8 Fraud Heatmap — Master Doc

> **Created:** 2026-04-19 (regenerated from git log + fresh codebase audit)
> **Status:** ACTIVE — re-verified against code 2026-06-11 (see §3.5): **44 DONE · 7 PARTIAL · 0 OPEN**
> **Predecessor:** original doc ลบไปก่อนหน้านี้; เอกสารนี้สร้างใหม่จาก git log + parallel Explore audit ของ 4 พื้นที่ (T1+T2, T3+T4, T5, T6+T7)

---

## 1. Purpose

CEO Fraud-Audit Deep Dive ของ BESTCHOICE แบ่งช่องโหว่เป็น **7 tiers × ~12 controls** (T-C format) ตามพื้นที่ธุรกิจ — แต่ละ C-item = concrete gap + fix + acceptance criteria จะนับว่า "ปิด" ก็ต่อเมื่อ:

1. Code landed (PR merged)
2. Tests pass (spec + โค้ด production)
3. Audit trail ปรากฏใน AuditLog หรือ domain-specific log table

เอกสารนี้ใช้เพื่อ:
- Track ความคืบหน้าการปิด fraud gaps ทั้งหมด
- Prioritize งานถัดไปตาม severity
- Reference สำหรับ CEO/นักบัญชี/auditor

---

## 2. Tier Structure

| Tier | Theme | Focus | Primary stakeholders |
|------|-------|-------|----------------------|
| **T1** | Money Flow Integrity | Payments, refunds, recon, bad-debt, cash drawer | FINANCE_MANAGER, OWNER |
| **T2** | Governance / Audit / Immutability | Journal, period lock, audit log, SoD | ACCOUNTANT, OWNER |
| **T3** | Customer & Payment Hygiene | Dedup, slip, credit check, late fee, loyalty | SALES, BRANCH_MANAGER |
| **T4** | Staff Operations & Approval Gates | Overdue escalation, broadcast, commission, handoff | BRANCH_MANAGER, FINANCE_MANAGER |
| **T5** | Contracts / Inventory / CRM Workflow | Contract lifecycle, warranty, stock, trade-in, PO | SALES, BRANCH_MANAGER, OWNER |
| **T6** | External Integrations & AI | PEAK, MDM, PaySolutions, SMS, LINE, Facebook, Claude API | OWNER |
| **T7** | Ops / Security / Resilience | Auth, secrets, backup, monitoring, webhooks, metrics | OWNER, DevOps |

Severity scale: **Critical** (active $ loss), **High** (enables fraud), **Medium** (weak control), **Low** (compliance/hardening)

---

## 3. Completed Items (from git log, 2026-02–04)

### T1 — Money Flow Integrity
| ID | Title | PR | Date |
|----|-------|----|------|
| T1-C1 | Refund endpoint + 2-person approval + bank reversal tracking | [#541](https://github.com/iamnaii/BESTCHOICE/pull/541) | 2026-04 |
| T1-C2 | waiveLateFee 4-eyes (approver ≠ requester, manager-tier) | [#525](https://github.com/iamnaii/BESTCHOICE/pull/525) | 2026-04 |
| T1-C3 | Bank reconciliation matching engine (MATCHED/UNMATCHED/AMBIGUOUS/AMOUNT_MISMATCH/DUPLICATE) | [#527](https://github.com/iamnaii/BESTCHOICE/pull/527) | 2026-04 |
| T1-C4 | Per-branch daily receivable recon + breach alert | [#543](https://github.com/iamnaii/BESTCHOICE/pull/543) | 2026-04 |
| T1-C5 | Remove BRANCH_MANAGER from contract approve/reject (prevent peer-approval) | [#523](https://github.com/iamnaii/BESTCHOICE/pull/523) | 2026-04 |

### T2 — Governance / Audit / Immutability
| ID | Title | PR |
|----|-------|----|
| T2-C1 | Manual journal period lock (block backdate to CLOSED/SYNCED) | [#523](https://github.com/iamnaii/BESTCHOICE/pull/523) |
| T2-C2 | SoD enforcement on journal post | [#544](https://github.com/iamnaii/BESTCHOICE/pull/544) |
| T2-C3 | Commission SoD guard (salesperson ≠ approver) | [#522](https://github.com/iamnaii/BESTCHOICE/pull/522) |
| T2-C4 | AuditLog immutability + 7-yr retention + Postgres BEFORE DELETE trigger + Merkle chain + nightly verify | [#524](https://github.com/iamnaii/BESTCHOICE/pull/524), [#562](https://github.com/iamnaii/BESTCHOICE/pull/562) |
| T2-C5 | Block CommissionRule rate change while PENDING exist | [#523](https://github.com/iamnaii/BESTCHOICE/pull/523) |
| T2-C6 | Commission clawback schema + 5-tier policy | [#523](https://github.com/iamnaii/BESTCHOICE/pull/523) |
| T2-C7 | DataAudit acknowledgement workflow + 24h SLA escalation | [#545](https://github.com/iamnaii/BESTCHOICE/pull/545) |
| T2-C8 | LoginAuditLog + 90d retention cron | [#542](https://github.com/iamnaii/BESTCHOICE/pull/542) |

### T3 — Customer & Payment Hygiene
| ID | Title | PR |
|----|-------|----|
| T3-C1 | Remove DEV OTP bypass in kyc.service | [#522](https://github.com/iamnaii/BESTCHOICE/pull/522) |
| T3-C6 | Bad debt write-off amount-tier approval (0–10k BM / 10–30k FM / 30k+ OWNER) | [#526](https://github.com/iamnaii/BESTCHOICE/pull/526) |
| T3-C8 | Normalize national ID before dedup check | [#551](https://github.com/iamnaii/BESTCHOICE/pull/551) |
| T3-C10 | Late-fee waiver audit fields | [#552](https://github.com/iamnaii/BESTCHOICE/pull/552) |
| T3-W9 | credit-check model ID fix (Claude 4 → 4.5) | [#522](https://github.com/iamnaii/BESTCHOICE/pull/522) |

### T4 — Staff Operations & Approval Gates
| ID | Title | PR |
|----|-------|----|
| T4-C2 | FINAL_WARNING + LEGAL_ACTION manual approval gate in overdue | [#553](https://github.com/iamnaii/BESTCHOICE/pull/553) |
| T4-C3 | Staff-chat test coverage (6 batches, +79 tests) | [#570](https://github.com/iamnaii/BESTCHOICE/pull/570)–[#575](https://github.com/iamnaii/BESTCHOICE/pull/575) |
| T4-C5 | LIFF dunningStage + daysOverdue badge | [#525](https://github.com/iamnaii/BESTCHOICE/pull/525) |
| T4-C7 | LIFF enhanced multi-contract tabs + product + status dot | [#561](https://github.com/iamnaii/BESTCHOICE/pull/561) |
| T4-C8 | Audit log rich menu mutations | [#563](https://github.com/iamnaii/BESTCHOICE/pull/563) |

### T5 — Contracts / Inventory / CRM
| ID | Title | PR |
|----|-------|----|
| T5-C1 | POS discount role cap + cost floor + secondApproverId (SALES 5% / BM 15% / FM 25% / OWNER ∞) | [#525](https://github.com/iamnaii/BESTCHOICE/pull/525) |
| T5-C3 | Stock adjustment 4-eyes (approver ≠ adjuster + manager-tier) | [#526](https://github.com/iamnaii/BESTCHOICE/pull/526) |
| T5-C5 | Ghost sale + rapid-void detection cron | [#546](https://github.com/iamnaii/BESTCHOICE/pull/546) |
| T5-C6 | Warranty audit log + backward-adjust OWNER gate | [#547](https://github.com/iamnaii/BESTCHOICE/pull/547) |
| T5-C7 | CRM lead assignment history + changedBy audit | [#548](https://github.com/iamnaii/BESTCHOICE/pull/548) |
| T5-C8 | Damage → resale fraud block (DAMAGED→FOUND OWNER-only + wasPreviouslyDamaged flag) | [#560](https://github.com/iamnaii/BESTCHOICE/pull/560) |
| T5-C9 | Commission audit log on rule update + pass userId | [#549](https://github.com/iamnaii/BESTCHOICE/pull/549) |
| T5-C10 | Exchange frequency cap + DEFECT photo requirement | [#550](https://github.com/iamnaii/BESTCHOICE/pull/550) |
| T5-C11 | Inventory test coverage (Forecast/StockCount/Reorder, +45 tests) | [#567](https://github.com/iamnaii/BESTCHOICE/pull/567)–[#569](https://github.com/iamnaii/BESTCHOICE/pull/569) |

### T6 — External Integrations & AI
| ID | Title | PR |
|----|-------|----|
| T6-C1 | Loyalty points redemption at POS | [#559](https://github.com/iamnaii/BESTCHOICE/pull/559) |
| T6-C2 | Customer referral atomic idempotency + Serializable tx | [#522](https://github.com/iamnaii/BESTCHOICE/pull/522) |
| T6-C3 | AI admin panel (cost/budget/trend/logs dashboard) | [#576](https://github.com/iamnaii/BESTCHOICE/pull/576) |
| T6-C6 | MDM required reason + audit log on unlock/lock | [#564](https://github.com/iamnaii/BESTCHOICE/pull/564) |
| T6-C7 | Webhook anomaly log wired to LINE Shop + Facebook | [#556](https://github.com/iamnaii/BESTCHOICE/pull/556) |
| T6-C8 | PEAK daily sync cron at 23:30 Asia/Bangkok | [#557](https://github.com/iamnaii/BESTCHOICE/pull/557) |
| T6-C11 | Dashboard class-level @Roles (SALES cutoff for need-to-know) | [#522](https://github.com/iamnaii/BESTCHOICE/pull/522) |
| T6-W28 | Verified MDM unlock already OWNER+FM (no change) | [#522](https://github.com/iamnaii/BESTCHOICE/pull/522) |

### T7 — Ops / Security / Resilience
| ID | Title | PR |
|----|-------|----|
| T7-C1 | Multi-OWNER invite — deferred (backend works via POST /users; admin UI future) | [#524](https://github.com/iamnaii/BESTCHOICE/pull/524) |
| T7-C4 | Quarterly backup drill procedure runbook | [#554](https://github.com/iamnaii/BESTCHOICE/pull/554) |
| T7-C6 | Invite second-channel OTP + validity reduce to 24h | [#555](https://github.com/iamnaii/BESTCHOICE/pull/555) |
| T7-C7 | Revoke all refresh tokens on user deactivation | [#524](https://github.com/iamnaii/BESTCHOICE/pull/524) |
| T7-C8 | Cloud Armor WAF runbook | [#554](https://github.com/iamnaii/BESTCHOICE/pull/554) |
| T7-C10 | ChartOfAccounts service tests +18 | [#577](https://github.com/iamnaii/BESTCHOICE/pull/577) |
| T7-C11 | /health public minimal + /health/detailed OWNER/FM only | [#522](https://github.com/iamnaii/BESTCHOICE/pull/522) |
| T7-C12 | Prometheus /metrics endpoint + SLO runbook | [#566](https://github.com/iamnaii/BESTCHOICE/pull/566) |
| T7-W9 | Deactivate legacy-import@bestchoice.com service account | [#522](https://github.com/iamnaii/BESTCHOICE/pull/522) |

### Cross-Cutting (Sprint series — pre-tier numbering)
| Topic | PR |
|-------|-----|
| Slip auto-approve + 4hr SLA cron (P2Q10) | [#531](https://github.com/iamnaii/BESTCHOICE/pull/531) |
| Promise-to-pay SLA validation + broken-promise cron | [#534](https://github.com/iamnaii/BESTCHOICE/pull/534) |
| Credit-check override audit trail + role guard | [#535](https://github.com/iamnaii/BESTCHOICE/pull/535) |
| Trade-in ±15% price ceiling vs valuation table | [#536](https://github.com/iamnaii/BESTCHOICE/pull/536) |
| SystemConfig audit trail + secret redaction | [#537](https://github.com/iamnaii/BESTCHOICE/pull/537) |
| Broadcast two-person approval + SoD | [#538](https://github.com/iamnaii/BESTCHOICE/pull/538) |
| Webhook anomaly log + spike cron | [#539](https://github.com/iamnaii/BESTCHOICE/pull/539) |
| AI per-call cost tracking + daily budget alert | [#540](https://github.com/iamnaii/BESTCHOICE/pull/540) |
| LIFF payment polling recovery + offline banner | [#533](https://github.com/iamnaii/BESTCHOICE/pull/533) |
| Dashboard cache graceful degrade (Redis down) | [#532](https://github.com/iamnaii/BESTCHOICE/pull/532) |

**Completed total: ~45 T-C items across 7 tiers**

---

## 3.5 Re-verification 2026-06-11 (code-grounded)

> A 7-agent parallel audit re-checked **all 51** "Remaining" items below against the **current** `apps/api` code on `main` (HEAD `b7677e89`). Result: **44 DONE · 7 PARTIAL · 0 OPEN** — most of the 2026-04-19 backlog shipped during the hardening + decompose campaigns. Every verdict is backed by a concrete `file:line`. Only the **7 PARTIAL** items (section 4) carry real residual work, and each needs an owner / ops / design decision rather than a quick code patch.
>
> **Correction vs. earlier handoff notes:** `T5-C13` was assumed DONE (its `$transaction` atomicity is in fact correct) but is **PARTIAL** — `adjustShopWarranty()` has no controller/cron/service caller, so the audited path is unreachable dead code. `T2-C12` (expense amount-lock) and `T6-C4` (PEAK HMAC) are confirmed DONE.

### Verified DONE (44) — evidence (paths relative to `apps/api/src/modules/` unless marked (prisma))

| ID | Sev | Evidence (file:line) |
|----|-----|----------------------|
| T1-C6 | High | commission/commission-clawback.cron.ts:33 |
| T1-C7 | High | (prisma) schema.prisma:5821 BadDebtWriteOffAuditLog + bad-debt.service.ts:496 |
| T1-C8 | Med | refunds/refunds.service.ts:210 (bankReversalLockedAt) |
| T1-C9 | Med | payments/services/late-fee-waiver.service.ts:141 (Sentry >5k) |
| T2-C9 | High | journal/journal.service.ts:283 (void → reversal entry) |
| T2-C10 | High | accounting/monthly-close.service.ts:368 (90d board guard) |
| T2-C11 | High | inventory/stock-adjustments.service.ts:103 (>500k OWNER) |
| T2-C12 | Med | expense-documents/services/status-transition.service.ts:64 (DRAFT-only edit) + regression spec PR #1251 |
| T2-C13 | Med | audit/audit-retention.cron.ts:97 |
| T2-C14 | Med | journal/journal.service.ts:248 (JournalPostAuditLog in-tx) |
| T2-C15 | Low | audit/audit.interceptor.ts:27 (SENSITIVE_FIELDS) |
| T2-C16 | Low | commission/commission.service.ts:419 (retro rate guard) |
| T3-C2 | High | chatbot-finance/services/slip-processing.service.ts:116 (SlipFingerprint) |
| T3-C3 | High | loyalty/loyalty.service.ts:189 (cap + posTxn + OWNER) |
| T3-C4 | High | payments/services/late-fee-waiver.service.ts:109 (FeeWaiverApproval) |
| T3-C7 | Med | chatbot-finance/services/slip-processing.service.ts:342 (OCR hash) |
| T3-C9 | Med | customers/services/customer-write.service.ts:157 (phone dedup) |
| T3-C11 | Med | overdue/services/overdue-lifecycle-cron.service.ts:104 |
| T4-C1 | High | contracts/services/contract-lifecycle.service.ts:609-645 |
| T4-C4 | High | credit-check/dto/credit-check.dto.ts:54-64 |
| T4-C6 | Med | broadcast/broadcast.service.ts:159-191 |
| T4-C10 | Med | sales/services/sale-writer.service.ts:354 |
| T4-C11 | Med | chat-engine/services/assignment.service.ts:84-128 |
| T5-C2 | High | contracts/services/contract-lifecycle.service.ts:467 |
| T5-C4 | High | contracts/services/contract-lifecycle.service.ts:388 |
| T5-C12 | High | (prisma) migrations/20260525200000_product_imei_partial_unique/migration.sql:24 |
| T5-C14 | High | inventory/stock-adjustments.service.ts:47 |
| T5-C15 | Med | crm/services/crm-pipeline.service.ts:144 |
| T5-C16 | Med | purchase-orders/services/po-receiving.service.ts:119 |
| T5-C17 | Med | trade-in/services/trade-in-lifecycle.service.ts:229 |
| T5-C18 | Med | suppliers/suppliers.service.ts:124 |
| T5-C19 | Med | commission/commission.service.ts:223 |
| T5-C20 | Low | contracts/contract-workflow.service.ts:106 |
| T5-C21 | Low | (prisma) migrations/20260528300000_inter_company_not_null/migration.sql:1 |
| T6-C4 | Crit | peak/peak.service.ts:175 (HMAC uses secretKey) |
| T6-C10 | High | notifications/sms-webhook.controller.ts:59 |
| T6-C12 | High | paysolutions/paysolutions.controller.ts:115 |
| T6-C14 | High | chat-adapters/facebook-webhook.controller.ts:115 |
| T6-C15 | Med | line-oa/guards/liff-token.guard.ts:117 |
| T6-C16 | Med | chatbot-finance/tools/tool-executor.ts:47 |
| T6-C17 | Med | webhook-security/webhook-anomaly.service.ts:93 |
| T7-C2 | High | auth/auth.service.ts:370 |
| T7-C3 | High | health/health.controller.ts:185 |
| T7-C5 | Med | auth/auth.controller.ts:87 |

---

## 4. Remaining Items — 7 PARTIAL (re-verified 2026-06-11)

> The 44 items previously listed here are DONE (see §3.5). Only these 7 carry residual work — each is "core control present but a specified piece missing", and **none is a quick code patch** (all need an owner / ops / design decision). The original 2026-04-19 Gap/Fix prose for every item lives in this file's git history.

### T3 — Customer & Payment Hygiene (1 PARTIAL)

#### **T3-C5 [High] — PARTIAL** — Payment reversal path missing
- **Done:** Preventive immutability is in place — `payments.service.updatePayment()` throws `ForbiddenException` on any `amountPaid`/`amountDue`/`status` patch (FORBIDDEN_FIELDS, `payments.service.ts` L327-349); no prod caller mutates a posted payment.
- **Still missing:** the corrective half — an OWNER-only "reverse + new entry with `REVERSAL` audit action". `reversePayment()` appears only in error strings; no method/endpoint exists.
- **Gate:** feature/design — confirm a dedicated reversal flow is wanted (journal void→reversal T2-C9 may already cover the use case).

### T4 — Staff Operations & Approval Gates (1 PARTIAL)

#### **T4-C9 [Medium] — PARTIAL** — LIFF rate limit not multi-node-correct
- **Done:** Per-`lineUserId` 3-fail / 30-min lockout is implemented + wired into `requestOtp()` (`chatbot-finance/services/verification.service.ts` L45-97).
- **Still missing:** the counter is an in-memory `Map` (code comment admits "TODO Redis"); prod Cloud Run runs `--max-instances=10`, so failures spread across instances bypass the lockout. The doc also asked for email-OTP confirmation (failures are only `logger.warn`'d).
- **Gate:** infra — needs a Redis-backed (shared) counter before it holds under horizontal scale.

### T5 — Contracts / Inventory / CRM (1 PARTIAL)

#### **T5-C13 [High] — PARTIAL** — Warranty adjust path is dead code
- **Done:** `warranty.service.adjustShopWarranty()` correctly wraps the contract update + `warrantyAuditLog` write in ONE `$transaction` (atomic), OWNER-only backward, 2nd-approver gate for backward >7d (`warranty/warranty.service.ts` L210-244) + 12 passing specs.
- **Still missing:** the method has **no caller** — no controller endpoint, no cron, no other service (grep across `apps/api/src` + `apps/web/src` finds only the method + its own spec); `WarrantyModule` declares no controller. So the audited path is unreachable, while `repair-warranty.service.ts:209` can null `shopWarrantyEndDate` outside it.
- **Gate:** owner/feature — decide if/where warranty end-date adjustment is exposed (endpoint + roles + UI), then route it through `adjustShopWarranty` and close any bypass.

### T6 — External Integrations & AI (3 PARTIAL)

#### **T6-C5 [Critical] — PARTIAL** — PEAK partial-sync not transactional
- **Done:** Idempotent per-entry mark (`updateMany WHERE peakSyncedAt=null`) + Sentry on duplicate/exception (`peak/peak.service.ts:107`) — an already-synced entry won't double-count.
- **Still missing:** each POST-then-mark is independent; no `$transaction` wrap and no retry on transient HTTP failure → a mid-batch timeout still leaves partial state.
- **Gate:** money-path — touches PEAK export integrity; needs accountant/owner sign-off (same gated zone as the `PAYSOLUTIONS_I2_FIX_DESIGN.md` JE work).

#### **T6-C9 [Critical] — PARTIAL** — PEAK credential access not audited
- **Done:** Quarterly/weekly stale-credential cron (Mon 06:00 BKK, 90d threshold, Sentry warn) + `docs/guides/PEAK-CREDENTIALS-RUNBOOK.md` + encrypted-at-rest storage (`integration-config.service.ts` encryptPII) — `integrations/credential-rotation.cron.ts:36`.
- **Still missing:** credential **reads** (`getValue`/`getConfig`) are not logged; no `IntegrationAccessLog` table; no actual rotation (monitor-only).
- **Gate:** ops/design — rotation cadence + Vault-style storage + access-log schema are an ops decision.

#### **T6-C13 [High] — PARTIAL** — MDM key versioning not wired
- **Done:** `apiKeyPrevious` grace-period field declared in `integrations/integration-registry.ts:327`; the generic weekly rotation cron covers MDM's sensitive fields.
- **Still missing:** `mdm.service.ts:120` reads only `getValue('mdm','apiKey')` — `apiKeyPrevious`/`MDM_API_KEY_PREVIOUS` is referenced nowhere in service code; no real key-versioning / deprecation-window behaviour; no dedicated MDM rotation cron.
- **Gate:** ops/design — same credential-rotation decision as T6-C9.

### T7 — Ops / Security / Resilience (1 PARTIAL)

#### **T7-C9 [Medium] — PARTIAL** — Metrics token still a shared secret
- **Done:** `METRICS_SCRAPE_TOKEN` gated by `timingSafeEqual` + manual zero-downtime dual-token rotation (`METRICS_SCRAPE_TOKEN_PREVIOUS`) — `metrics/metrics.controller.ts:40`.
- **Still missing:** the specified fix (mTLS or OAuth + auto-rotation cron) is not implemented; rotation is a manual env-var swap.
- **Gate:** ops/design — needs scraper-side config (mTLS/OAuth) decision.

---

## 5. Priority Matrix — 7 PARTIAL only (2026-06-11)

> 0 fully-open items. All 7 residuals need an owner / ops / design decision, not a quick code patch.

### 🔴 Critical — PEAK integrity (gated on accountant/ops)
- **T6-C5** — PEAK partial-sync `$transaction` + retry (money-path; needs accountant sign-off)
- **T6-C9** — PEAK credential rotation + access-audit log (ops/design)

### 🟠 High
- **T5-C13** — wire `adjustShopWarranty` to an endpoint + close the bypass (owner/feature)
- **T3-C5** — OWNER-only payment reversal path (feature/design; may be covered by journal reversal T2-C9)
- **T6-C13** — MDM key versioning/rotation wiring (ops/design — pairs with T6-C9)

### 🟡 Medium
- **T4-C9** — Redis-backed LIFF lockout (infra — current in-memory Map bypassed across instances)
- **T7-C9** — metrics mTLS/OAuth + auto-rotation (ops/design)

---

## 6. Meta / Process Notes

### Numbering convention
- T# = Tier (1–7)
- C# = Control item (sequential per tier)
- W# = Warning-level issue (lower severity than C)
- เว้นเลขที่ completed — item ใหม่ใช้เลขต่อจาก highest used (เช่น T1 completed ถึง C5 → ใหม่เริ่ม C6)

### Definition of Done (DoD) ต่อ C-item
1. ✅ Code landed (PR merged to main)
2. ✅ Unit tests pass + new cases covering the fix
3. ✅ Audit trail visible (AuditLog หรือ dedicated log table)
4. ✅ Thai error messages ถ้ามี user-facing exception
5. ✅ Run `./tools/check-types.sh all` → 0 errors
6. ✅ Entry updated ในเอกสารนี้ (move จาก "Remaining" ไป "Completed")

### How to pick next task
1. อ่าน Priority Matrix (section 5)
2. Pick batch of 2–4 items ที่ related (e.g., all T6 PEAK items together)
3. Dispatch subagents parallel ถ้างาน mechanical (test writing, audit log addition)
4. Commit per tier per PR — keep PRs reviewable (<500 LOC)

### Regeneration process (กรณี master doc หายอีก)
1. `git log --oneline | grep -E "T[0-9]-C[0-9]+"` → completed items
2. `gh pr view <#> --json body` → extract C-IDs + context
3. Dispatch 4 Explore agents: (T1+T2), (T3+T4), (T5), (T6+T7) — audit remaining gaps
4. Compile into this doc structure

---

**Last audit date:** 2026-06-11 (code-grounded re-verification — see §3.5)
**Total DONE:** 89 of 96 T-C items (45 pre-2026-04 completed + 44 of the 51 "remaining" verified shipped)
**Total PARTIAL:** 7 · **Total OPEN:** 0
**Est. effort to close all remaining:** 12–16 developer-weeks
