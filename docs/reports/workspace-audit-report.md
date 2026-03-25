# BESTCHOICE Workspace Audit Report

**Date:** 2026-03-24
**Method:** Three-agent team — Researcher (full codebase + docs scan), Strategist (fix proposals), Critic (challenge & gap analysis)
**Scope:** 7 documentation files + .env.example cross-referenced against actual codebase

---

## 1. Codebase Inventory (Researcher Findings)

### 1.1 API Modules — 41 total

All modules confirmed in `apps/api/src/app.module.ts`. Documentation coverage:

| Module | Controller Prefix | Documented? |
|---|---|---|
| address | `address` | No |
| audit | `audit` | REVIEW_REPORT only |
| auth | `auth` | CLAUDE.md, REVIEW_REPORT |
| branch-receiving | `branch-receiving` | No |
| branches | `branches` | No |
| contract-documents | `contracts/:contractId/documents` | PLAN-contract-system.md only |
| contracts | `contracts` | CLAUDE.md, SPEC, PLAN |
| credit-check | `credit-checks` | PLAN-contract-system.md only |
| cron | `cron` | No |
| customer-access | (root) | DEPLOY.md only |
| customers | `customers` | CLAUDE.md, SPEC |
| dashboard | `dashboard` | No |
| documents | (root) | REVIEW_REPORT only |
| exchange | `exchange` | SPEC only |
| inspections | (root) | No |
| interest-config | `interest-configs` | PLAN-contract-system.md only |
| kyc | `contracts` (KYC sub-routes) | No |
| line-oa | `line-oa` | DEPLOY.md only |
| migration | `migration` | IMPLEMENTATION-GUIDE.md only |
| notifications | `notifications` | SPEC only |
| ocr | `ocr` | REVIEW_REPORT only |
| overdue | `overdue` | SPEC only |
| payments | `payments` | CLAUDE.md |
| pdpa | `pdpa` | No |
| pricing-templates | `pricing-templates` | No |
| product-photos | `products/:productId/photos` | No |
| products | `products` | No |
| purchase-orders | `purchase-orders` | IMPLEMENTATION-GUIDE.md only |
| receipts | `receipts` | No |
| reorder-points | `reorder-points` | No |
| reports | `reports` | CLAUDE.md |
| repossessions | `repossessions` | SPEC only |
| sales | `sales` | No |
| settings | `settings` | SPEC only |
| stickers | `sticker-templates` | IMPLEMENTATION-GUIDE.md only |
| stock-adjustments | `stock-adjustments` | No |
| stock-count | `stock-counts` | No |
| storage | (internal, no HTTP routes) | No |
| suppliers | `suppliers` | IMPLEMENTATION-GUIDE.md only |
| users | `users` | No |

**Undocumented with high user impact:** notifications, ocr, credit-check, kyc, pdpa, line-oa, storage (silent-skip behavior), cron/overdue dependency ordering.

### 1.2 Frontend Pages — 60+ routed pages

CLAUDE.md lists only 8. Full route inventory:

**Staff (admin panel):**
`/login`, `/forgot-password`, `/reset-password`, `/`, `/pos`, `/customers`, `/customers/:id`, `/contracts`, `/contracts/create`, `/contracts/:id`, `/contracts/:id/sign`, `/contract-templates`, `/verify/:id`, `/payments`, `/payments/import-csv`, `/stock`, `/stock/transfers`, `/stock/alerts`, `/stock/count`, `/stock/adjustments`, `/reports`, `/suppliers`, `/suppliers/:id`, `/purchase-orders`, `/overdue`, `/exchange`, `/repossessions`, `/receipts`, `/slip-review`, `/sales`, `/stickers`, `/branches`, `/audit-logs`, `/credit-checks`, `/notifications`, `/migration`, `/pdpa`, `/settings`, `/settings/interest-config`, `/settings/line-oa`, `/settings/sms`, `/settings/pricing-templates`, `/financial-audit`, `/document-dashboard`, `/products/create`, `/products/:id`, `/system-status`, `/users`, `/landing`

**Customer / LIFF (public):**
`/liff/contract`, `/liff/early-payoff`, `/liff/history`, `/liff/profile`, `/liff/register`, `/pay/:token`, `/customer-access/:token`

**Unrouted page files (exist but not in router):**
- `BranchReceivingPage.tsx` — superseded; `/stock/branch-receiving` redirects to `/stock/transfers?view=incoming`
- `InventoryWorkflowPage.tsx` — no route assigned
- `InspectionPage.tsx` + `InspectionDetailPage.tsx` — only reachable as sub-pages inside the unrouted `InventoryWorkflowPage`

### 1.3 Prisma Schema

**50 models** (REVIEW_REPORT incorrectly states "25+"). Key models: Branch, User, Customer, Contract, Payment, Product, PurchaseOrder, Inspection, ContractDocument, CreditCheck, InterestConfig, Receipt, KycVerification, PDPAConsent, DSARRequest, RefreshToken, PasswordResetToken, PaymentLink, PaymentEvidence, StockCount, ReorderPoint, BranchReceiving, CompanyInfo, and 27 more.

**Key enums confirmed:**

| Enum | Values |
|---|---|
| `ContractStatus` | DRAFT, ACTIVE, OVERDUE, DEFAULT, EARLY_PAYOFF, COMPLETED, EXCHANGED, CLOSED_BAD_DEBT |
| `ContractWorkflowStatus` | CREATING, PENDING_REVIEW, APPROVED, REJECTED |
| `ContractDocumentType` | 19 values (see schema.prisma) — **not** `DocumentType` with 9 values as in PLAN doc |
| `UserRole` | SALES, BRANCH_MANAGER, ACCOUNTANT, OWNER |
| `DunningStage` | NONE, REMINDER, NOTICE, FINAL_WARNING, LEGAL_ACTION |
| `ProductStatus` | 14 values including PO_RECEIVED through WRITTEN_OFF |
| `CreditCheckStatus` | PENDING, APPROVED, REJECTED, MANUAL_REVIEW |

### 1.4 Auth Flow

- **Access token:** in-memory JS variable (`let accessToken: string | null = null` in `apps/web/src/lib/api.ts`). **NOT localStorage.** One-time migration clears localStorage on first load. CLAUDE.md was wrong.
- **Refresh token:** httpOnly cookie via `withCredentials: true`
- **Guards:** `JwtAuthGuard`, `RolesGuard`, `ThrottlerGuard` (200 req/s global, 30/min login, 10/min refresh), `CsrfGuard` (X-Requested-With header)
- **In-memory user cache:** JwtStrategy caches user records for 30 seconds (per-process — not shared across scaled instances)

### 1.5 Dead Infrastructure

- **Redis:** defined in `docker-compose.yml` (dev) with `redis_data` volume, listed in `.env.example` (`REDIS_HOST`, `REDIS_PORT`), but **never imported or used anywhere in `apps/api/src/`**. Absent from `docker-compose.prod.yml`. REVIEW_REPORT SEC-07 recommends using it for refresh token blacklisting — it has not been implemented.

### 1.6 Missing Environment Variables

S3/MinIO storage vars used by `@aws-sdk/client-s3` but absent from `.env.example` and all docs:
- `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_REGION`

### 1.7 Notable Dependencies (undocumented)

**Backend:** `@aws-sdk/client-s3` (file storage), `puppeteer-core` (PDF generation), `qrcode` (PromptPay QR), `@anthropic-ai/sdk` (OCR + credit check)

**Frontend:** `zustand` (state management), `@radix-ui/*` (UI primitives), `exceljs` (replaced vulnerable `xlsx`), `@tiptap/*` (rich text editor), `@dnd-kit/*` (drag-and-drop), `@tanstack/react-table` (tables), `sonner` (toasts), `jspdf` + `jspdf-autotable` (PDF generation), `dompurify` (XSS sanitization)

---

## 2. Document-by-Document Fixes Applied (Strategist + Critic)

### 2.1 CLAUDE.md
| Fix | Description |
|---|---|
| Token storage | Changed "Access token stored in localStorage" → "in-memory JS variable" |
| Key Routes | Expanded from 8 routes to full list: ~50 staff routes + 7 LIFF/customer routes |
| Unrouted pages | Added note distinguishing superseded, unrouted, and sub-page-only page files |

### 2.2 DEPLOY.md
| Fix | Description |
|---|---|
| Cost contradiction | Method 1 header: `~$12/เดือน (~430 THB)` → `~$14/เดือน (~500 THB)` (matches table) |
| S3 secrets | Added `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_REGION` to secrets table |
| Known Limitations | Added section documenting: password reset email stub, LIFF payment mock, S3 required for file storage |

### 2.3 IMPLEMENTATION-GUIDE.md
| Fix | Description |
|---|---|
| Redis prereq | Commented out `redis-cli ping` with note that Redis is defined but unused |
| "System complete" | Qualified the claim — noted 4 unrouted pages, password reset email stub, LIFF payment mock |

### 2.4 PLAN-contract-system.md
| Fix | Description |
|---|---|
| Enum name | Added note that `DocumentType` was implemented as `ContractDocumentType` |
| Enum values | Added note that implementation has 19 values (not 9 as originally planned) |

### 2.5 REVIEW_REPORT.md
| Fix | Description |
|---|---|
| Module count | `30+` → `41` (line 28 and Statistics) |
| Page count | `40+` → `60+` (line 43 and Statistics) |
| Model count | `25+` → `50` (Statistics) |
| bcrypt version | `5.1.1` → `^6.0.0` in tech stack table |
| dompurify version | `^3.3.1` → `^3.3.2` in dependencies table |
| xlsx → exceljs | Updated third-party deps table |
| SEC-01 FIXED | Marked as done in Recommended Fix Order |
| SEC-02 FIXED | Marked as done in Recommended Fix Order |
| SEC-08 FIXED | Marked as done in Recommended Fix Order |
| SEC-11 FIXED | Marked as done in Recommended Fix Order |
| S3 env vars | Added 5 S3 vars to Environment Variables table |
| Redis note | Added note that REDIS_HOST/PORT are in .env.example but never used |
| Rate limit | Fixed "30 req/s" → "200 req/s global (30/min login, 10/min refresh)" |
| Password reset | Noted endpoints exist but email delivery is stubbed in production |
| CSRF note | Corrected checklist — CSRF IS implemented via X-Requested-With + SameSite cookie |

### 2.6 SPEC-installment.md
| Fix | Description |
|---|---|
| Status header | `Draft — Pending stakeholder review` → `Implemented (with known gaps — see REVIEW_REPORT.md)` |

### 2.7 docs/system-analysis-test-scenarios.md
| Fix | Description |
|---|---|
| S4 (localStorage) | Marked **FIXED** — token moved to in-memory variable |
| S7 (password reset) | Marked **PARTIALLY FIXED** — endpoints implemented, email delivery stubbed in production |
| S17 (forgotPassword email) | Refined — not a missing flow, but a missing SMTP/email service |
| Positive findings | Added "Access token in-memory (SEC-08 applied)" to the "สิ่งที่ทำได้ดีแล้ว" list |

### 2.8 .env.example
| Fix | Description |
|---|---|
| Redis vars | Commented out with note: defined but never read by API |
| S3 vars | Added 5 S3 vars under a new "File Storage (S3-compatible)" section |
| LIFF_ID duplicate | Added comment noting bare `LIFF_ID=` is unused; only `VITE_LIFF_ID=` is read by Vite |

---

## 3. Gaps & Recommendations (Critic Findings)

### 3.1 Undelivered Promises (Critical)

**Password reset is non-functional in production.**
`apps/api/src/modules/auth/auth.service.ts` lines 173–178 have a deliberately commented-out email send:
```typescript
// In production, send email with reset link:
// await emailService.send(user.email, 'Password Reset', resetUrl);
this.logger.log(`Password reset token generated...`);
return { ...(process.env.NODE_ENV !== 'production' ? { token } : {}) };
```
The token is returned in the response body in dev mode only. In production, the token is generated and stored in the DB but **never delivered to the user**. There is no email service, no SMTP config, and no mail package in either `package.json`. Password reset requires either: (a) implementing SMTP (e.g., `nodemailer`), or (b) sending the reset link via LINE OA notification.

**LIFF payment is a mock.**
`docs/system-analysis-test-scenarios.md` explicitly states: "ปัจจุบัน LIFF payment เป็น mock — ลูกค้าชำระจริงไม่ได้" (LIFF payment is currently a mock — customers cannot make actual payments).

**National ID encryption is described but not implemented.**
`.env.example` comments say `ENCRYPTION_KEY` is for encrypting national IDs. No encryption/decryption code exists in the customers module. National IDs are stored and searched as plaintext regardless of whether `ENCRYPTION_KEY` is set.

**Storage silently skips uploads when unconfigured.**
`StorageService` returns the file key as-is when S3 is not configured. Features relying on stored files (KYC docs, payment slips, contract PDFs) silently fail to persist in an unconfigured deployment. A subsequent download then fails with no clear error.

### 3.2 Open Security Issues (from REVIEW_REPORT, still unresolved)

| ID | Issue | Severity |
|---|---|---|
| SEC-03 | Multer DoS (3 CVEs) — requires NestJS upgrade to v11 | Critical |
| SEC-04 | Missing `@Roles()` on customer create/update | High |
| SEC-05 | Missing `@Roles()` on inspection create/update/complete | High |
| SEC-06 | Hardcoded seed password `admin1234` | High |
| SEC-07 | Refresh token rotation not atomic (TOCTOU race) | High |
| SEC-09 | No signature input validation DTO | High |
| SEC-10 | serialize-javascript RCE (fixable with `npm audit fix`) | High |
| SEC-12 | CSRF: note that X-Requested-With IS implemented, but SameSite=Strict cookies would be better | Medium |
| SEC-13 | Security middleware skip paths too broad | Medium |
| SEC-14 | Error messages leak internal details | Medium |
| SEC-15 | Weak UID generation (use `crypto.randomUUID()`) | Medium |
| SEC-16 | Dev Docker compose exposes ports publicly | Medium |
| D10 | No rate limit on forgot-password endpoint (token table flooding) | Medium |
| S11 | IDOR: cross-branch data access (SALES at branch A can query branch B contracts) | High |

**New gap identified:** SMS credentials stored in `SystemConfig` DB, overriding env vars at runtime. Any OWNER-role user who can write SystemConfig can redirect SMS traffic to an arbitrary account. No audit trail for SMS credential changes.

### 3.3 No Root README.md

No `/home/user/BESTCHOICE/README.md` exists. A root README is the entry point for any new developer or evaluator. REVIEW_REPORT Phase 8 checklist also flags this as missing.

Minimum content needed:
- Project name and one-sentence description
- Prerequisites (Node 20+, PostgreSQL 16+, Docker)
- Quickstart: `npm install && docker compose up -d && npm run dev`
- Test credentials (admin@bestchoice.com / admin1234)
- Pointers to DEPLOY.md, REVIEW_REPORT.md, CLAUDE.md
- Known limitations (password reset email stub, LIFF payment mock)

---

## 4. Cross-Document Contradictions Resolved

| Contradiction | Documents | Resolution |
|---|---|---|
| Access token storage | CLAUDE.md ("localStorage") vs code (in-memory) | CLAUDE.md fixed |
| Cost: $12 vs $14 | DEPLOY.md Method 1 header vs cost table | Header fixed to $14 |
| S4 localStorage | system-analysis (open issue) vs actual code (fixed) | Marked FIXED |
| S7 password reset | system-analysis (missing) vs actual code (endpoints exist) | Marked PARTIALLY FIXED |
| Module count 30+ vs 41 | REVIEW_REPORT vs actual modules/ directory | REVIEW_REPORT fixed |
| Page count 40+ vs 60+ | REVIEW_REPORT vs actual router | REVIEW_REPORT fixed |
| Model count 25+ vs 50 | REVIEW_REPORT vs actual schema.prisma | REVIEW_REPORT fixed |
| `DocumentType` (9 values) vs `ContractDocumentType` (19 values) | PLAN-contract-system.md vs schema.prisma | Note added to PLAN doc |
| bcrypt 5.1.1 vs ^6.0.0 | REVIEW_REPORT table vs package.json | REVIEW_REPORT fixed |
| dompurify 3.3.1 vs 3.3.2 | REVIEW_REPORT table vs package.json | REVIEW_REPORT fixed |
| xlsx present vs exceljs | REVIEW_REPORT table vs package.json | REVIEW_REPORT fixed |
| Rate limit "30 req/s" vs "200 req/s" | REVIEW_REPORT checklist vs code/test-scenarios | REVIEW_REPORT fixed |
| Redis vars in .env.example but never used | .env.example vs API source code | .env.example commented out with note |
| SPEC status "Draft" | SPEC-installment.md vs actual implementation | Status updated |

---

## 5. Action Items — Prioritized Checklist

### Immediate (blocking production use)

- [ ] **Implement email delivery for password reset** — Add `nodemailer` or equivalent; configure SMTP env vars (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`); or route the reset link via LINE OA
- [ ] **Configure S3/MinIO before deploying** — Add `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_REGION` to production env. Without S3, all file uploads (KYC, contracts, payment slips) silently fail
- [ ] **Fix `npm audit fix`** — Resolves SEC-01 (dompurify, already done in code), SEC-10 (serialize-javascript RCE) — run and commit updated lockfile

### High Priority (security)

- [ ] **SEC-04** — Add `@Roles()` to `customers.controller.ts` create/update endpoints
- [ ] **SEC-05** — Add `@Roles()` to `inspections.controller.ts` mutation endpoints
- [ ] **SEC-07** — Wrap refresh token revoke+create in a DB transaction (or implement Redis blacklist)
- [ ] **D10** — Add `@Throttle()` to `POST /auth/forgot-password` endpoint
- [ ] **S11** — Audit branch-level filtering on contracts/payments queries for SALES role
- [ ] **SEC-03** — Upgrade `@nestjs/platform-express` to v11 (fixes Multer DoS — breaking change, test thoroughly)

### Medium Priority (documentation + quality)

- [ ] **Create root README.md** — Entry point for developers; see Section 3.3 for minimum content
- [ ] **Document the 20+ undocumented modules** — Priority order: notifications, ocr, credit-check, kyc, pdpa, line-oa, storage (silent-skip behavior), cron/overdue timing dependency
- [ ] **Route the 4 unrouted pages** — Decide: delete `InventoryWorkflowPage`, `InspectionPage`, `InspectionDetailPage` or complete and route them
- [ ] **Implement national ID encryption** — `ENCRYPTION_KEY` is advertised as encrypting national IDs; code doesn't encrypt them
- [ ] **LIFF payment** — Complete real payment flow or document clearly as future work
- [ ] **SEC-09** — Add signature validation DTO to `users.controller.ts`
- [ ] **SMS credential audit trail** — Log when SystemConfig SMS credentials are changed via Settings API

### Backlog

- [ ] **ARCH-01** — Global exception filter (standardize error responses)
- [ ] **ARCH-02** — API versioning (`/api/v1/`)
- [ ] **ARCH-04** — Structured JSON logging (pino/winston)
- [ ] **SEC-06** — Seed password via env var, add production guard
- [ ] **PERF-01** — Fix N+1 in notification bulk send
- [ ] **PERF-02** — Pagination on all list endpoints
- [ ] **CQ-01** — Refactor large page components (2000+ line files)
- [ ] **Add test scenarios** for: contract workflow, LIFF, credit check, document uploads, interest config, password reset (see Critic section 7 for full list)

---

*Report generated: 2026-03-24*
*Agents: Researcher (114 tool calls), Strategist (60 tool calls), Critic (95 tool calls)*
