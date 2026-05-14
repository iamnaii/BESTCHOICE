# Pre-Merge Guard Report — 2026-05-14

**Reviewed by**: Pre-Merge Guard Agent (automated)
**Date**: 2026-05-14
**Branches reviewed**: 3 (most recently updated unmerged branches, excluding prior guard/watchdog branches)

---

## Summary

| Branch | Author | Files | +/- | Recommendation |
|--------|--------|-------|-----|----------------|
| `feat/ui-polish-emoji-daily-sheet-range` | Akenarin Kongdach | 40 | +337/−340 | ✅ APPROVE |
| `fix/expenses-6-critical-gl-bugs` | Akenarin Kongdach | 23 | +1822/−111 | ✅ APPROVE |
| `fix/payments-6-critical-gl-bugs` | Akenarin Kongdach | 24 | +1020/−203 | ✅ APPROVE |

No Critical issues found across any branch. No blocking concerns.

---

## Branch 1: `feat/ui-polish-emoji-daily-sheet-range`

**Last commit**: `336073fe` — 2026-05-15 01:20 ICT  
**Commits ahead of main**: 2

### What changed
- Replaced emoji icons (`📋`, `✅`, `📎`, `✍️`, `⏳`, `🔴`) with `lucide-react` components across ~15 pages
- Dark-mode contrast fix: `--muted-foreground` raised from 55% to 65% lightness (WCAG AA, ~5.0:1 contrast)
- Added `--color-accent-purple` / `--color-accent-sky` CSS tokens (light + dark variants) to `index.css`
- Daily-sheet API changed from single `date` param to `startDate`/`endDate` range (DTO + service + controller)
- Range validation: `endDate >= startDate` + max 366-day window — errors in Thai ✓

### Critical issues
_None._

### Warnings
_None._

### Info
| File | Note |
|------|------|
| `daily-sheet-query.dto.ts` | Single `date` field replaced with `startDate` + `endDate`. Both decorated with `@IsDateString()`. Range logic enforced in service (not just DTO) — appropriate. |
| `status-badges.ts` | Uses `bg-accent-purple`, `bg-info`, `bg-success` token classes. Confirmed all are properly declared CSS variables in `index.css` and Tailwind config. ✓ |
| `DocumentDashboardPage.tsx` | `StatCard` `color` prop maps string names (`'blue'`, `'green'`) to design token classes internally via `Record<string, string>`. Not hardcoded hex. ✓ |

---

## Branch 2: `fix/expenses-6-critical-gl-bugs`

**Last commit**: `4ac1d374` — 2026-05-15 01:07 ICT  
**Commits ahead of main**: 10 (8 fix commits + 2 from ui-polish stack)

### What changed
- **C9**: Period guard moved off `createAndPost()` to request boundary (`post()`) — prevents ghost JEs from cron-like callers bypassing the guard
- **C11**: SSO cap `@Max(750)` added to `create-payroll.dto.ts` with Thai message (`'SSO ต่อคนไม่เกิน 750 บาท/เดือน'`)
- **C12**: WHT form-type guard extended to SE / CN / PAYROLL document types (was expense-only before)
- JE preview gating fix — prevented early preview from running on incomplete drafts
- Attachment threshold: reads `ATTACHMENT_REQUIRED_ABOVE_AMOUNT` from `SystemConfig` via `Prisma.Decimal` (replaces implicit `Number()` cast)
- New utility `journal/utils/wht-form-type.ts` — `assertWhtFormType()` / `isWhtFormType()` centralise validation, prevent PND3/PND53 misfiling
- `PaymentVoucherPage`: new `bucketWhtByRate()` exported function uses `Decimal.js` arithmetic for form 50 ทวิ per-rate breakdown

### Critical issues
_None._

**Checked**:
- No new controllers → no missing guard check needed
- `companyInfo.findFirst({ where: { companyCode: 'SHOP', deletedAt: null } })` — `deletedAt: null` present on all 3 occurrences ✓
- `Number.isFinite(Number(rawThreshold))` — guard on a raw SystemConfig `string` value, not money arithmetic ✓
- No hardcoded secrets or API keys

### Warnings
| File | Line | Issue |
|------|------|-------|
| `journal/utils/wht-form-type.ts` | 32 | `assertWhtFormType()` throws `new Error(...)` (bare JS error) instead of `new BadRequestException(...)`. When this defense-in-depth guard fires inside a NestJS request cycle (JE template called from a route handler), NestJS's global exception filter maps it to HTTP 500 rather than 400. The service-level guard at `expense-documents.service.ts` `post()` should prevent reaching this path — but the stated intent is "defense-in-depth for future caller bypass," which makes it a guard you want to surface clearly. Recommend changing to `BadRequestException` from `@nestjs/common`. Fail-closed so no data risk, but caller gets an opaque 500. |
| `create-payroll.dto.ts` | ~37 | TODO comment: "If the cap moves, update this @Max + check payroll.template.ts". Low-risk note; SSO cap is a legal constant (last changed 2019). Not blocking — track as a backlog item. |

### Info
| File | Note |
|------|------|
| `expense-documents.service.ts` | File is large (~1500 lines, pre-existing). Branch adds ~60 production lines cleanly; candidate for splitting into sub-services (PostingService, VoidService) in a future refactor. |
| `journal-auto.service.spec.ts` | `let prisma: any` with `// eslint-disable-next-line @typescript-eslint/no-explicit-any` — test file only, acceptable mock pattern. |
| `wht-form-type.ts` | New utility, 41 lines. Clean `ReadonlySet` guard + TypeScript narrowing return type. One warning above on exception type. |
| `vendor-settlement.template.ts` | New `clearedDocsAmts` `findMany` correctly includes `deletedAt: null`. The partial-settlement logic (accumulate prior SE totals before flipping status) is a meaningful fix. ✓ |

---

## Branch 3: `fix/payments-6-critical-gl-bugs`

**Last commit**: `5d7760a2` — 2026-05-15 01:03 ICT  
**Commits ahead of main**: 9 (7 fix commits + 2 from ui-polish stack)

### What changed
- **Late fee GL**: Late fee now routed to account `42-1103` in `PaymentReceipt2BTemplate`; previously misfiled
- **PaySolutions atomicity**: `handlePaymentCallback` wraps Payment.update + JE post in `serializable` transaction; Sentry capture + re-throw on JE failure (lets PaySolutions retry, Sentry alert on exhausted retries)
- **VAT 60-day reversal**: `EarlyPayoffJP4Template` now receives injected `Vat60dayReversalTemplate` dependency — fixes silent skip of reversal on early payoff when installments had a 60-day flag
- **Credit delta**: `applyCreditBalance` now leaves audit trail via AuditLog
- **PDF Thai fonts**: Embedded `NotoSansThai-VF.ttf` + `Sriracha-Regular.ttf` into API assets — removes 8s `networkidle0` stall on external font fetch
- **CSV idempotency**: Bulk import now checks for duplicate refno before re-processing
- **Branch guard on 3 endpoints**: `waiveLateFee`, `createPartialQr`, `getActivePartialQr`, `cancelPartialQr` all now call `validateBranchAccessByPayment()` explicitly — fixes BranchGuard bypass when request carries only `paymentId`

### Critical issues
_None._

**Checked**:
- `payments.controller.ts` — all 4 modified methods retain `@Roles(...)` decorators ✓
- `paysolutions.controller.ts` — intentionally public endpoint (listed in security rules); webhook now properly Sentry-captures and re-throws on JE failure ✓
- `Number()` usage: all test-file only (`expect(Number(...).toBe(...)`) or Prisma.Decimal → `.toNumber()` for `Intl.NumberFormat` display ✓
- `toDec(receipt.amount).toNumber()` pattern in `receipts.service.ts`: arithmetic goes through `Prisma.Decimal`, `.toNumber()` only at the display formatting boundary (`toLocaleString`) ✓
- No hardcoded secrets
- New `payment.findUnique` in `validateBranchAccessByPayment` checks `payment.deletedAt` explicitly ✓

### Warnings
| File | Line | Issue |
|------|------|-------|
| `payment.dto.ts` | ~180 | `lateFee?: number` added as advisory field. JSDoc states "service recomputes from DB — ห้ามให้ลูกค้า/พนักงานกำหนดค่าปรับเอง". The advisory intent is clear and the service ignores the value for authoritative calculation — acceptable. Consider `@IsDecimal()` with string type in a future pass to avoid float drift on client side. |

### Info
| File | Note |
|------|------|
| `assets/fonts/NotoSansThai-VF.ttf` / `Sriracha-Regular.ttf` | Binary assets added (~200KB). Removes runtime network dependency on external font host. Good. |
| `atomicity.spec.ts` / `early-payoff-jp4.template.spec.ts` | `prisma as any` in test files for injection of real PrismaClient into template constructors — standard integration test pattern. |
| `thai-date.util.ts` | `Number(lookup.year)` / `Number(lookup.month)` etc. — these parse string fields from a `Date.toLocaleDateString('th-TH')` split result, not money values. ✓ |
| `payments-financial.integration.spec.ts` | New integration spec verifying atomicity on JE failure + VAT 60-day reversal flow. Good coverage. |

---

## Cross-branch checks

| Check | Result |
|-------|--------|
| New controllers without `@UseGuards` | None — no new controllers added |
| `@Roles` missing on new endpoints | None — all modified endpoints retain role decorators |
| `Number()` on money fields (production) | None — all `Number()` additions are in tests or on non-financial string→int conversions |
| Missing `deletedAt: null` in queries | None — all new queries on soft-deletable models include the filter |
| Hardcoded secrets / API keys | None |
| Raw SQL `$queryRaw` without parameterization | None |
| Raw `fetch()` in React components | None — all API calls use `api.get()` / `api.post()` from `@/lib/api` |
| `queryClient.invalidateQueries()` after mutations | Existing patterns preserved; no new mutations added without cache invalidation |
| CSS hardcoded hex colors | One minor instance in `index.css` editor theme section (pre-existing: `#047857`, `#9ca3af`) — not introduced by this branch |

---

## Recommendations

All 3 branches are **APPROVED** for merge. Suggested merge order (respects commit stack):

1. `feat/ui-polish-emoji-daily-sheet-range` — merge first (foundation)
2. `fix/expenses-6-critical-gl-bugs` — merge second
3. `fix/payments-6-critical-gl-bugs` — merge last

**Backlog items** (non-blocking, should be tracked):
- [ ] Move SSO monthly cap (750 THB) to `SystemConfig['sso_monthly_cap']` during next payroll refactor
- [ ] Consider changing `lateFee?: number` in `RecordPaymentDto` to `string` (Decimal-safe) in a future DTO cleanup pass
