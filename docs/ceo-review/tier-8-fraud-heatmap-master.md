# Tier-8 Fraud Heatmap — Master Doc

> **Created:** 2026-04-19 (regenerated from git log + fresh codebase audit)
> **Status:** ACTIVE — source of truth for remaining fraud/governance work
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

## 4. Remaining Items (from 2026-04-19 audit)

> **Note:** Numbering continues from completed set; gaps in sequences มีเพราะไม่มี item ที่ audit รอบใหม่นี้หา

### T1 — Money Flow Integrity (4 items)

#### **T1-C6 [High]** — Commission clawback cron ยังไม่ถูกเรียก
- **Gap:** `commission.service.applyClawbackForContract()` มีอยู่ (T2-C6) แต่ถูกเรียกแค่ใน test เท่านั้น — ไม่มี controller endpoint หรือ cron ที่ทริกเกอร์เมื่อ contract default
- **Attack:** Salesperson เก็บ commission เต็มแม้ contract default ภายใน FPD
- **Fix:** สร้าง `commission-clawback.cron.ts` daily — scan contracts ที่ status=DEFAULT + `clawbackAppliedAt IS NULL` → call service + Sentry capture
- **Effort:** S (1–2 hr)

#### **T1-C7 [High]** — BadDebtWriteOff ไม่มี immutable audit table
- **Gap:** Global AuditInterceptor logs request แต่ถ้า AuditLog ถูกลบ (แม้ trigger block DELETE ที่ DB) ยังไม่มี dedicated write-off log
- **Fix:** เพิ่ม `BadDebtWriteOffAuditLog` table (immutable — createdAt only, no updatedAt/deletedAt) — `writtenOffBy`, `approverId`, `contractId`, `amount`, `reason`, `createdAt`
- **File:** `apps/api/prisma/schema.prisma` + `apps/api/src/modules/bad-debt/`
- **Effort:** M (3–4 hr)

#### **T1-C8 [Medium]** — Refund bank reversal timestamp แก้ได้หลังล็อก
- **Gap:** `refunds.controller.mark-reversed` + `mark-failed` ไม่มี immutability check บน `bankReversalRef` / `bankReversalAt` — FM เขียนทับเวลาที่ bank กลับเงินจริงได้
- **Fix:** เพิ่ม `bankReversalLockedAt` flag (set เมื่อ `bankReversalRef` ถูกเขียนครั้งแรก) — reject update ถ้า locked
- **Effort:** S

#### **T1-C9 [Medium]** — Large late-fee waiver ไม่มี Sentry alert
- **Gap:** `payments.service.waiveLateFee()` guard ด้วย role เท่านั้น — FM waive 100K/วันได้โดยไม่ alert ops
- **Fix:** ถ้า `waivedAmount > 5000` call `Sentry.captureMessage(level:'warning')` with waivedBy, contract, amount
- **Effort:** S (<1 hr)

### T2 — Governance / Audit / Immutability (8 items)

#### **T2-C9 [High]** — Journal void ไม่สร้าง reversal entry
- **Gap:** `journal.service.void()` set status=VOIDED แต่ไม่ auto-create reversal journal (debit/credit flipped) — user void expense journal ได้โดยไม่ทิ้งร่องรอย
- **Fix:** On void, auto-create reversal entry (`referenceType=REVERSAL`, `referenceId=original-entry-id`) posted immediately
- **Effort:** M

#### **T2-C10 [High]** — Closed AccountingPeriod reopen โดยไม่มี board guard
- **Gap:** `POST /accounting/periods/reopen` OWNER-only แต่ไม่มี time-lock — CLOSED period > 90d ยัง reopen ได้ → ลบหลักฐาน audit
- **Fix:** ใน `monthly-close.service.reopenPeriod()` — ถ้า `status=CLOSED && closedAt < now-90d` → `ForbiddenException('Period is locked; requires Board approval')` + OWNER override via explicit `boardResolutionId` field
- **Effort:** S–M

#### **T2-C11 [High]** — Stock adjustment role escalation gap
- **Gap:** Schema บังคับ `approvedBy ≠ adjustedBy` (T5-C3) แต่ controller อนุญาต BM ทั้ง create + approve — BM approve adjustment ของ BM คนอื่นได้
- **Fix:** ถ้า adjustment amount > 500K ต้อง approvedById = OWNER เท่านั้น (ไม่ใช่ BM)
- **Effort:** S

#### **T2-C12 [Medium]** — Expense amount แก้ได้ระหว่าง PENDING_APPROVAL
- **Gap:** `accounting.service.updateExpense()` block edit เมื่อ APPROVED/PAID แต่ PENDING_APPROVAL ยัง patchable — requester submit → ลดยอด → approver approve ยอดใหม่โดยไม่รู้
- **Fix:** Lock `amount`, `vatAmount`, `withholdingTax` เมื่อ `status >= PENDING_APPROVAL` — ให้ edit ได้แค่ description/notes/reference
- **Effort:** S

#### **T2-C13 [Medium]** — Main AuditLog retention cron ยังไม่มี
- **Gap:** LoginAuditLog มี 90d cron (T2-C8) แต่ main AuditLog ไม่มี retention cron — PDPA data minimization risk
- **Fix:** `audit/audit-retention.cron.ts` — archive AuditLog > configurable TTL (default 180d) ไปที่ cold storage หรือ soft-archive, log purge counts ไป Sentry
- **Note:** ต้องประสานงานกับ Merkle chain (T2-C4 ext) — archive แต่ keep hash for verification
- **Effort:** M

#### **T2-C14 [Medium]** — Journal post audit ไม่แยกจาก global interceptor
- **Gap:** `journal.service.post()` มี `postedById/postedAt` + interceptor log แต่ถ้า interceptor log ถูกลบ ไม่มี forensic หลักฐานว่าใคร approve
- **Fix:** สร้าง `JournalPostAuditLog` immutable (`journalEntryId`, `postedById`, `postedAt`, `ipAddress`, `userAgent`) — เขียน synchronously ใน same tx
- **Effort:** M

#### **T2-C15 [Low]** — SystemConfig sensitive field redaction ไม่ครอบคลุม
- **Gap:** #537 เพิ่ม audit trail แต่ต้องตรวจว่า `SENSITIVE_FIELDS` ครอบคลุม `bankApiKey`, `paymentGateway*`, `peakSecretKey`, `mdmApiKey` หรือไม่ — ถ้าไม่ครบ AuditLog.newValue จะมี plaintext secrets
- **Fix:** Extend `audit.interceptor.ts` sanitizeBody() sensitive keys list + regex match + unit test
- **Effort:** S

#### **T2-C16 [Low]** — CommissionRule retroactive recompute
- **Gap:** T5-C9 log rule update แต่ไม่ block การ recompute commission ที่ค้าง pending ใน period เดียวกันด้วย rate ใหม่
- **Fix:** ใน `commission.service.updateRule()` — block ถ้ามี unpaid commission ใน period เดียวกัน เว้นแต่มี `retroactiveApproval` header + signer = OWNER
- **Effort:** S

### T3 — Customer & Payment Hygiene (7 items)

#### **T3-C2 [High]** — Slip cross-contract reuse (same image across contracts)
- **Gap:** Customer upload slip เดียวกันสำหรับ contract A งวด 1 แล้ว reuse สำหรับ contract B งวด 1 — imageUrl ไม่ถูก hash/fingerprint
- **Fix:** สร้าง `SlipFingerprint` table (md5 hash จาก OCR ref+amount+bank) — reject ถ้า hash ตรงกับ slip ใน 30 วันล่าสุด across contracts
- **File:** `apps/api/src/modules/slip-processing/`
- **Effort:** M

#### **T3-C3 [High]** — Loyalty redemption ไม่มี per-transaction cap
- **Gap:** `loyalty.service.redeemPoints()` ให้ SALES redeem จนหมด balance ได้ — ไม่มี daily cap, ไม่ link กับ POS receipt จริง
- **Fix:** Daily cap 5,000 pts/customer/day + require `posTransactionId` + OWNER approval gate ถ้า amount > 10K
- **Effort:** M

#### **T3-C4 [High]** — Late-fee waiver approver signature หาย
- **Gap:** `waiveLateFee` มี SoD (T1-C2) แต่ approver's approval ไม่ถูก log แยกเป็น event — ถ้า manager approve ทางวาจา ไม่มีหลักฐาน
- **Fix:** สร้าง `FeeWaiverApproval` table + require FM กด "confirm waiver" หลัง review; log timestamp แยก + ip/userAgent
- **Effort:** M

#### **T3-C5 [High]** — Payment amount mutability ยังไม่ถูกบล็อกระดับ code
- **Gap:** Schema อนุญาต arbitrary update — ถ้าอนาคตมี PATCH/PUT endpoint (ยังไม่มี) จะเกิดปัญหา
- **Fix:** Immutability rule: payment.amountPaid update = reject; reverse+new entry with `REVERSAL` audit action only via OWNER
- **Effort:** S (preventive)

#### **T3-C7 [Medium]** — Slip OCR duplicate detection
- **Gap:** `slip-processing.service.createEvidence()` ไม่ hash ก่อน create — customer upload slip เดิมหลายรอบเพื่อ contracts คนละอัน
- **Fix:** OCR hash (MD5/SHA256 ของ ref+amount+bank+date) — reject ถ้า exists ใน 7 วันล่าสุด
- **Note:** overlap กับ T3-C2 แต่ fingerprint ต่าง scope: T3-C2 = image URL, T3-C7 = OCR content
- **Effort:** M

#### **T3-C9 [Medium]** — Phone/email dedup ยังไม่มี
- **Gap:** Dedup check มีแค่ nationalId (T3-C8 done) — phone/email ซ้ำได้ (หลากหลาย format: "081-234-5678" vs "0812345678")
- **Fix:** Normalize phone (strip dashes/spaces) + add `@unique` on phone; application-level check email
- **Effort:** S

#### **T3-C11 [Medium]** — Auto-escalation OVERDUE→DEFAULT ไม่มี manual hold
- **Gap:** `overdue.service.updateContractStatuses()` cron hourly escalate อัตโนมัติ — ไม่เคารพ "promise-to-pay" flag ที่พนักงานใส่
- **Fix:** `Contract.blockAutoEscalation` flag (24–48hr window) + respect recent `CallLog.result='PROMISED'` ภายใน 24 ชม.
- **Effort:** M

### T4 — Staff Operations & Approval Gates (6 items)

#### **T4-C1 [High]** — Salesperson reassign หลัง signature
- **Gap:** `contracts.service.create()` capture `salespersonId` แต่ไม่มี code block การเปลี่ยน salesperson หลังเซ็น — ถ้าเพิ่ม endpoint ต่อมา จะเกิด claim hijack
- **Fix:** Workflow gate — ถ้า `workflowStatus=APPROVED` หรือมี signature แล้ว → block change ยกเว้น OWNER + audit log + commission recalc
- **Effort:** S (preventive)

#### **T4-C4 [High]** — Credit check override evidence gate
- **Gap:** `credit-check.service.overrideById()` enforce role แต่ `overrideReason` เป็น free-text ไม่มี validation — manager เขียน "ok" ได้
- **Fix:** `@IsNotEmpty() @MinLength(20)` + `attachmentIds[]` (proof documents) — audit log ต้องเก็บทั้ง reason + documents
- **Effort:** S

#### **T4-C6 [Medium]** — Broadcast large-audience second approval
- **Gap:** OWNER-only guard (Sprint 4b) แต่ OWNER กด broadcast ไปทุก customer ได้ — ไม่มี log content, ไม่มี trigger-word detection
- **Fix:** Log broadcast intent (targets, message, sender) **ก่อน**ส่ง + require second OWNER approval ถ้า audience > 1,000 หรือ message มี trigger words (repossess/legal/debt)
- **Effort:** M

#### **T4-C9 [Medium]** — LIFF per-session rate limit
- **Gap:** `liffRegisterLookup()` throttle 5/min per IP — attacker ใช้ LINE accounts หลายตัว (5×100=500/min) enumerate phone numbers
- **Fix:** Per-`lineUserId` counter ใน Redis (3 fail = 30min lockout) + email OTP confirmation + log failures
- **Effort:** M

#### **T4-C10 [Medium]** — Commission snapshot link to contract salesperson
- **Gap:** `SalesCommission.salespersonId` เก็บใน DB แต่ไม่ snapshot จาก contract ณ วันขาย — ถ้า contract reassigned salesperson หลัง approve commission ไม่เปลี่ยน (same person claim คนใหม่)
- **Fix:** Snapshot contract's salesperson ณ sale time; ถ้า contract.salesperson เปลี่ยนหลัง commission approved — commission ยังยึด original earner
- **Overlap:** T4-C1 fix นี้เพิ่มเติม — เน้นที่ audit evidence
- **Effort:** S

#### **T4-C11 [Medium]** — Staff chat handoff commission hijack
- **Gap:** Staff chat handoff logic ถ้ามี — agent ใหม่ take over session อาจเคลม commission ของ sale เก่า
- **Fix:** Immutable assignment เมื่อ customer signed + log session transfers + commission ยึด signer ณ เซ็น
- **Effort:** S–M (verify existing behavior first)

### T5 — Contracts / Inventory / CRM (12 items)

#### **T5-C2 [High]** — Contract void after activation
- **Gap:** `contracts.service.softDelete()` ตรวจแค่ `status === 'DRAFT'` แต่ถ้า status drift จาก ACTIVE → user void ได้; terminal status ไม่ immutable ที่ DB
- **Fix:** Guard `status !== 'DRAFT'` + block update/delete บน ACTIVE/OVERDUE/DEFAULT contracts; mark terminal enum ที่ schema
- **File:** `apps/api/src/modules/contracts/contracts.service.ts` L611-638
- **Effort:** S

#### **T5-C4 [High]** — Installment amounts แก้ได้เมื่อมี PENDING payments
- **Gap:** `contracts.service.update()` ให้แก้ sellingPrice/downPayment/totalMonths ได้ถ้า `paidOrPartialCount === 0` แม้มี PENDING payments
- **Fix:** Block ANY financial field edit ถ้า `payment.count > 0` (รวม PENDING)
- **File:** `contracts.service.ts` L545-604
- **Effort:** S

#### **T5-C12 [High]** — IMEI serial reuse across soft-deleted products
- **Gap:** `trade-in.service.accept()` ตรวจ `existing.deletedAt` แต่ไม่ prevent duplicate IMEIs เมื่อ product ถูก soft-delete
- **Fix:** Partial unique index: `CREATE UNIQUE INDEX imei_unique_active ON products (imei_serial) WHERE deleted_at IS NULL`
- **Effort:** S

#### **T5-C13 [High]** — Warranty atomic audit gap
- **Gap:** `warranty.service.adjustShopWarranty()` enforce OWNER สำหรับ BACKWARD adjustment แต่ audit log เขียนหลัง update — race condition
- **Fix:** Update + audit write ต้องอยู่ใน `prisma.$transaction()`; require 2-factor approval ถ้า backward > 7 days
- **Effort:** M

#### **T5-C14 [High]** — Stock adjustment DAMAGED photo gate
- **Gap:** Photo required เฉพาะ DEFECT exchange (T5-C10) — DAMAGED stock adjustment ไม่ต้องใส่รูป → mass-damage writeoff ทำได้
- **Fix:** Require `photos.length > 0` เมื่อ `reason=DAMAGED` + photos immutable หลัง post
- **Effort:** S

#### **T5-C15 [Medium]** — CRM stage change audit
- **Gap:** T5-C7 log assignment แต่ไม่ log stage transition — manager mark WON retroactively (เปลี่ยน wonAt + stage) เก็บ commission เดือนเก่า
- **Fix:** `CrmLeadStageHistory` table (`stagedBy`, `stagedAt`, `oldStage`, `newStage`) + enforce `wonAt >= createdAt`
- **Effort:** M

#### **T5-C16 [Medium]** — PO receive qty race condition
- **Gap:** `purchase-orders.service.receive*()` ใช้ in-memory `poItem.receivedQty` — 2 concurrent GR → receivedQty > ordered
- **Fix:** `SELECT FOR UPDATE` lock PO rows; ใช้ `SUM(receivedQty)` แทน loop accumulation
- **File:** `purchase-orders.service.ts` L486-491, L543
- **Effort:** M

#### **T5-C17 [Medium]** — Trade-in appraisal price drift
- **Gap:** `trade-in.service.appraise()` allow multiple calls — staff เสนอ 20K (blocked), เรียก appraise ใหม่ 18K (passed) — override หลักฐานหาย
- **Fix:** Snapshot offeredPrice immutably ที่ first APPRAISED; require 2FA override ถ้านอก ±15% ceiling
- **Effort:** M

#### **T5-C18 [Medium]** — Supplier bank account swap mid-PO
- **Gap:** `suppliers.service.update()` soft-delete old paymentMethods + create new — PO อ้างอิง supplierId (FK) ไม่ snapshot bank account
- **Fix:** Snapshot `supplier.bankAccountNumber` + `bankName` ที่ PO.create(); block supplier update บน bank fields ถ้ามี non-CANCELLED PO
- **Effort:** M

#### **T5-C19 [Medium]** — Commission rate snapshot validation
- **Gap:** T2-C5 block rule change while PENDING แต่ `SalesCommission.commissionRate` snapshot ที่ creation ไม่ถูก validate กับ rule ตอน approve
- **Fix:** ที่ approve — validate `SalesCommission.commissionRate === rule.rate`; log rule version ID ที่ `commission.create()`
- **Overlap:** T2-C16 — เน้นคนละ layer (T2 = rule lock, T5 = commission validation)
- **Effort:** S

#### **T5-C20 [Low]** — Contract hash integrity fields limited
- **Gap:** `contract-workflow.service.submitForReview()` hash แค่ 6 core fields — notes, signatures, documents, customer snapshot ไม่รวม
- **Fix:** ขยาย hash input; store on contract table; validate ทุก state transition
- **Effort:** S

#### **T5-C21 [Low]** — Inter-company SHOP↔FINANCE no FK lock
- **Gap:** `inter-company.service.ts` resolve companyId at tx create (not FK) — ถ้า FINANCE company ถูกลบ future tx จะมี NULL fromCompanyId
- **Fix:** NOT NULL constraint บน fromCompanyId/toCompanyId + pre-create stub companies
- **Effort:** S

### T6 — External Integrations & AI (10 items)

#### **T6-C4 [Critical]** — PEAK HMAC key mix-up (connectId แทน secretKey)
- **Gap:** `peak.service.ts` / MDM HMAC implementation: `createHmac('sha1', config.connectId).update(timeStamp)` — ควรใช้ `secretKey` ไม่ใช่ `connectId` (public identifier)
- **Impact:** Attacker ที่มี connectId (public value) forge journal entries บน PEAK ได้
- **Fix:** Use `secretKey` as HMAC key per PEAK spec + integration test
- **Priority:** **ทำก่อน** (security bug active ใน prod)
- **Effort:** S (<1 hr + migration test)

#### **T6-C5 [Critical]** — PEAK partial sync rollback หาย
- **Gap:** `peak.service.ts` L70-120 export entries sequentially — ถ้า sync ล้มกลาง batch, entries ที่เหลือ NOT synced แต่ marked as synced (race ระหว่าง Prisma update กับ HTTP timeout)
- **Fix:** Wrap export in `prisma.$transaction()` with idempotency markers; retry on HTTP failure; Sentry alert on partial state
- **Effort:** M–L

#### **T6-C9 [Critical]** — PEAK credentials ไม่มี rotation/access audit
- **Gap:** `PEAK_USER_TOKEN`, `PEAK_CONNECT_ID`, `PEAK_SECRET_KEY` อยู่ใน env — ไม่มี rotation cron, ไม่ log access
- **Fix:** Credential rotation runbook (quarterly) + integration-config access logging + Vault-style storage
- **Effort:** L (ต้องวาง design ก่อน)

#### **T6-C10 [High]** — SMS webhook ไม่มี signature verification
- **Gap:** `sms-webhook.controller.ts` accept GET+POST ไม่มี signature — throttle 60/min per-IP เท่านั้น
- **Fix:** Contact ThaiBulkSMS สำหรับ HMAC signing spec; ระหว่างรอ — strict IP whitelist ใน CloudArmor
- **Effort:** M (รอ provider)

#### **T6-C12 [High]** — PaySolutions webhook verify merchantId เท่านั้น (ไม่มี HMAC)
- **Gap:** `POST /api/paysolutions/webhook` accept request ใดๆที่ merchantId ถูก — spoof payment success ได้
- **Fix:** ประสานงาน PaySolutions สำหรับ HMAC signing; ระหว่างรอ — rate-limit per merchantId (ไม่ใช่ global) + IP whitelist
- **Effort:** M

#### **T6-C13 [High]** — MDM API key ไม่มี versioning/rotation
- **Gap:** MDM PJ-Soft API key เป็น plain string ใน `integrationConfig` — ถ้า leak attacker unlock ทุกเครื่อง + enable Lost Mode
- **Fix:** Key versioning + annual rotation cron + deprecation grace period
- **Effort:** M

#### **T6-C14 [High]** — Facebook webhook rawBody capture fragility
- **Gap:** `verifySignature()` ใช้ raw request body — ถ้า middleware ordering ผิด rawBody undefined → all FB events rejected (safe) แต่ไม่มี logging/alert → FB messaging เงียบหาย
- **Fix:** SLO alarm + log metric ต่อครั้งที่ rawBody capture failed; fallback emit Sentry warning
- **Effort:** S

#### **T6-C15 [Medium]** — LIFF cross-company boundary check
- **Gap:** `chatbot-finance-liff.controller.ts:64` — verify JWT แต่ไม่ check `lineUserId` เป็นของ requesting user's company (SHOP vs FINANCE)
- **Fix:** Add branchId/companyId check ใน `LiffTokenGuard`
- **Effort:** S

#### **T6-C16 [Medium]** — AI Claude tool input validation
- **Gap:** `finance-ai.service.ts:157-160` execute arbitrary tool input จาก Claude — prompt injection ดึง customer data ได้; audit log อาจมี PII leak
- **Fix:** Validate tool.input ต่อ schema ก่อน execute; strip PII keys ใน audit log
- **Effort:** M

#### **T6-C17 [Medium]** — Webhook anomaly log abuse rate-limit
- **Gap:** `WebhookAnomaly` table ไม่จำกัด insert rate — attacker trigger 100x invalid signatures ท่วม table
- **Fix:** Aggregate rate-limit per provider (e.g., max 100/hr/provider) + auto-alert เมื่อ 5+ anomalies/5min spike
- **Effort:** S

### T7 — Ops / Security / Resilience (4 items)

#### **T7-C2 [High]** — Password reset rate limit ยังไม่มี
- **Gap:** `/auth/forgot-password` token validity 15min แต่ไม่มี rate limit per email → attacker spam 1000 emails → enumeration via bounce
- **Fix:** Rate limit 3/hr per email
- **Effort:** S

#### **T7-C3 [High]** — /health/detailed leak env var names
- **Gap:** Return 503 พร้อม `"missing env vars: S3_ACCESS_KEY, S3_SECRET_KEY"` — attacker map integrations
- **Fix:** Return generic `"Storage misconfigured"` ไม่ระบุ var names
- **Effort:** XS

#### **T7-C5 [Medium]** — Refresh token body accept เพิ่มจาก cookie
- **Gap:** `/auth/refresh` accept body `refreshToken` (line 110) เพิ่มจาก HttpOnly cookie — CSRF exfil path ถ้า SameSite drop
- **Fix:** Only accept cookie; reject body refreshToken field
- **Effort:** S

#### **T7-C9 [Medium]** — Metrics token plaintext rotation
- **Gap:** `X-Metrics-Token` header เป็น plaintext ใน env — ถ้า Prometheus scraper URL leak (logs/dashboards) scrape metrics ได้
- **Fix:** mTLS หรือ OAuth token + auto-rotation cron
- **Effort:** L (ต้องวาง scraper config)

---

## 5. Priority Matrix (สำหรับ pick งานถัดไป)

### 🔴 ต้องทำก่อน (Critical — active risk in prod)
1. **T6-C4** — PEAK HMAC key bug (connectId vs secretKey) — **security bug ใน prod**
2. **T6-C5** — PEAK partial sync rollback — data integrity
3. **T6-C9** — PEAK credential rotation (runbook + impl)

### 🟠 High — ปิดก่อนสิ้นไตรมาส
- T1-C6, T1-C7 (clawback cron + bad-debt audit)
- T2-C9, T2-C10, T2-C11 (journal void reversal, period lock, stock adj OWNER gate)
- T3-C2, T3-C3, T3-C4, T3-C5 (slip reuse, loyalty cap, waiver signature, payment immutability)
- T4-C1, T4-C4 (salesperson reassign, credit override evidence)
- T5-C2, T5-C4, T5-C12, T5-C13, T5-C14 (contract void, installment lock, IMEI unique, warranty atomic, damage photo)
- T6-C10, T6-C12, T6-C13, T6-C14 (SMS/PaySolutions/MDM webhook + FB alert)
- T7-C2, T7-C3 (password reset rate limit, health env leak)

### 🟡 Medium — ปิดได้ตามจังหวะ
- T1-C8, T1-C9 (refund lock, waiver Sentry)
- T2-C12 → T2-C14 (expense lock, retention cron, journal post audit)
- T3-C7, T3-C9, T3-C11 (OCR hash, phone dedup, escalation hold)
- T4-C6, T4-C9, T4-C10, T4-C11 (broadcast approval, LIFF rate limit, commission snapshot, handoff)
- T5-C15 → T5-C19 (CRM stage audit, PO race, trade-in drift, supplier swap, commission rate validate)
- T6-C15, T6-C16, T6-C17 (LIFF company check, AI tool validation, anomaly rate limit)
- T7-C5, T7-C9 (refresh token, metrics token)

### 🟢 Low — hardening / compliance
- T2-C15, T2-C16 (config redaction, rule retroactive)
- T5-C20, T5-C21 (contract hash, FK lock)

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

**Last audit date:** 2026-04-19
**Total completed:** ~45 T-C items
**Total remaining:** ~51 T-C items
**Est. effort to close all remaining:** 12–16 developer-weeks
