# Pre-Merge Guard Report — 2026-07-04

Reviewed the 3 most recently updated non-guard/non-docs unmerged branches against `origin/main`.

---

## Branch 1: `fix/reschedule-qa-test-slip-contract`

**Author:** iamnaii <akenarin.ak@gmail.com>  
**Commits (3):**
- `feat(payments)`: แท็บ "ชำระครบ" ในเมนูรับชำระ
- `fix(receipts)`: ยกเลิกใบเสร็จได้อีกครั้ง — ช่องผู้อนุมัติ (SoD) + GET /users/approvers
- `test(web)`: update reschedule QA test

**Changed files:** 19 files, +900 / -56 lines

### Critical
_None found._

### Warning
- **`parseFloat()` on money fields for Excel export** — `apps/web/src/pages/PaymentsPage/index.tsx` (lines ~1231-1233):  
  `amountDue: parseFloat(p.amountDue).toLocaleString()` — used for display/export formatting only (not stored back to DB), but the project rule is to use `Prisma.Decimal` throughout. A safer alternative: `new Prisma.Decimal(p.amountDue).toFixed(2)` or `String(p.amountDue)` before `toLocaleString()`.

### Info
- `apps/web/src/pages/PaymentsPage/index.tsx` has grown to **955 lines** (threshold 500). Consider splitting the "ชำระครบ" tab logic into a sub-component or custom hook.
- `any` type used in test setup (`setupHappyPath: (tx: any)`) — test-only, acceptable.

### Security Checks
| Check | Result |
|---|---|
| New controllers have `@UseGuards(JwtAuthGuard, RolesGuard)` | ✅ `GET /users/approvers` is on existing `UsersController` (class-level guards) |
| All new endpoints have `@Roles()` | ✅ `findApprovers()` has explicit `@Roles(...)` |
| `deletedAt: null` in new queries | ✅ 6 new queries all include filter |
| No `Number()` on DB money fields | ⚠️ `parseFloat()` on display-only formatting (see Warning) |
| No hardcoded secrets | ✅ |
| No raw `fetch()` in frontend | ✅ |
| `invalidateQueries()` after mutations | ✅ `ReceiptVoidDialog` invalidates `receipts`, `contract-receipts`, `contract-payments` |
| Receipt void SoD backend validation | ✅ approver role + active status validated server-side |

### Recommendation: **REVIEW**
One Warning (parseFloat on display). Functionally correct — safe to merge after confirming the export formatting behaviour is acceptable to the owner.

---

## Branch 2: `fix/late-fee-split-reschedule-collect-first`

**Author:** iamnaii <akenarin.ak@gmail.com>  
**Commits (10+, top shown):**
- `fix(payments)`: fee-first late-fee split + reschedule collect-first (ปรับดิว) (#1326)
- New `RescheduleCollectService`, `PaysolutionsIntentService`, `PaysolutionsConfirmationService`
- Prisma migration: new schema field(s) + migration SQL

**Changed files:** 33 files, +2244 / -273 lines

### Critical
_None found._

### Warning
- **`toNumber()` calls when passing to external PaySolutions API** — `apps/api/src/modules/paysolutions/services/paysolutions-intent.service.ts` (lines ~81, 165-166):  
  `quote.collectAmount.toDecimalPlaces(2).toNumber()` — used solely to build the QR `amount` field sent to the PaySolutions gateway (which requires a JS `number`, not a Prisma `Decimal`). This is the same pattern used by the existing `paysolutions.service.ts`. **No Decimal-to-float loss on DB writes.** Risk is minimal but worth noting per project rule.
  
- **`toNumber()` in `reschedule-collect.service.ts` line ~366** — passed to `sendPaymentConfirmationLine()` for LINE OA notification formatting. Again display/transport only, not stored. Same risk profile as above.

### Info
- `RescheduleOverlay.tsx` grew by +362 lines in a single file; total may exceed 500 lines after this PR. Worth monitoring.
- `Number(link.amount)` in frontend `RescheduleOverlay.tsx` — used inside a `toLocaleString()` display call, not a DB write.
- The `contract.findUnique({ where: { id } })` pattern without inline `deletedAt: null` is compensated by immediate `if (!contract || contract.deletedAt) throw NotFoundException` guard — functionally equivalent to `{ where: { id, deletedAt: null } }` but less idiomatic. Low risk.
- `qrserver.com` external URL used in `reschedule-qr.flex.ts` — **established codebase pattern** (also in `partial-payment-qr.flex.ts`, `early-payoff-qr.flex.ts`). Not a new risk.

### Security Checks
| Check | Result |
|---|---|
| New controller endpoints have `@Roles()` | ✅ 2 new routes both have `@Roles(...)` |
| `deletedAt: null` in new queries | ✅ / ⚠️ inline filter OR explicit null-check (see Info) |
| `Number()` on DB money fields | ⚠️ `toNumber()` for PaySolutions API transport (not DB storage) |
| New DTO validators | ✅ `CreateRescheduleQrDto` has `@IsNumber`, `@Min`, `@IsString`, `@IsIn` |
| No hardcoded secrets | ✅ |
| Parameterized SQL | ✅ no raw `$queryRaw` in production paths |
| Atomic DB + reschedule in `$transaction` | ✅ `$transaction(Prisma.TransactionIsolationLevel.Serializable, ...)` |

### Recommendation: **REVIEW**
Large PR with well-structured logic. The `toNumber()` usages are all on transport paths (PaySolutions API, LINE notification), not DB writes — acceptable with team acknowledgment. No blocking issues.

---

## Branch 3: `feat/ai-hardening-followups`

**Author:** iamnaii <akenarin.ak@gmail.com>  
**Commits (20+, top shown):**
- AI hardening: windowed cap, LLM instrumentation, backfill resilience (#1316-#1320)
- `refactor(chat)`: retire draft pipeline — remove `ChatIntentRouterService` + 3 draft endpoints
- `feat(ai-usage)`: instrument vision, ai-assistant, knowledge-extractor, credit-check, ocr
- `fix(staff-chat)`: embedding backfill survives poison rows — per-row fallback + permanent skip
- `feat(sales-bot)`: rolling-window rate limit, tool error distinction

**Changed files:** 30 files (unique to this branch vs main), +672 / -111 lines

### Critical
_None found._

### Warning
_None found._

### Info
- **Dead code removal**: `ChatIntentRouterService` (95 lines) deleted + 3 draft endpoints removed from `ChatAiDraftController`. The removed endpoints (`draft/:id`, `approve`, `skip`) had proper `@Roles()` — deletion is correct since the pipeline is retired.
- `$executeRaw` in `embedding-backfill.cron.ts` — uses **tagged template literals** (Prisma's parameterized form), safe from SQL injection. All variables (`vector`, `model`, `id`) are bound parameters.
- New `POST /staff-chat/ai/embedding-backfill` endpoint is `@Roles('OWNER')` only, under `StaffChatController` which has class-level `@UseGuards(JwtAuthGuard, RolesGuard)`. ✅

### Security Checks
| Check | Result |
|---|---|
| Controller guards preserved after refactor | ✅ `ChatAiDraftController` retains class-level `@UseGuards` |
| New `embedding-backfill` endpoint has role | ✅ `@Roles('OWNER')` on admin trigger |
| `$executeRaw` safe | ✅ parameterized template literals |
| No `Number()` on DB money fields | ✅ |
| No hardcoded secrets | ✅ |
| AI error logging doesn't leak PII | ✅ only `roomId`, `modelName`, token counts in logs |

### Recommendation: **APPROVE**
Clean hardening branch. Well-tested (new spec files for each changed service), no security regressions, dead code correctly pruned.

---

## Summary

| Branch | Issues | Recommendation |
|---|---|---|
| `fix/reschedule-qa-test-slip-contract` | 1 Warning (parseFloat display), 1 Info (file size) | **REVIEW** |
| `fix/late-fee-split-reschedule-collect-first` | 2 Warning (toNumber transport), 1 Info (query style) | **REVIEW** |
| `feat/ai-hardening-followups` | 0 Critical, 0 Warning | **APPROVE** |

No branch is blocked. Both REVIEW branches have issues limited to display/transport use of numeric primitives (not DB writes) — safe to merge after owner acknowledgment.
