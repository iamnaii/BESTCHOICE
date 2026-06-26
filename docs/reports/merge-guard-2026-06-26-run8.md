# Pre-Merge Guard Report — 2026-06-26 (Run 8)

**Run date**: 2026-06-26  
**Reviewed by**: Pre-Merge Guard agent  
**Scope**: Unmerged remote branches + new code merged to `main` since last substantive review (2026-06-25 18:08 ICT)

---

## Unmerged Branch Status

All non-guard, non-watchdog branches show last commit on **2026-06-24** — same as prior runs. Confirmed stale:

| Branch | Merged as | PR |
|--------|-----------|-----|
| `chore/local-config-sync` | Pin Prisma VSCode extension | #1299 |
| `chore/owner-mobile-settings-bar` | Dedupe OWNER mobile settings bar | #1298 |
| `chore/doc-config-single-source` | Remove ตั้งค่าเอกสาร from fin zone | #1297 |
| `chore/dedupe-fin-zone-settings` | Dedupe fin-zone sidebar links | #1296 |
| `chore/stale-contacts-comments` | Refresh stale comment examples | #1295 |

**Worktree branches** (`worktree-feat+sp7.1-dual-prisma-foundation`, `worktree-feat-shop-sales-ai-phase-a`) — last committed May 2026, no shared history with current `main`. Status unchanged from 2026-06-25 review: **REVIEW** pending rebase.

**`feat/a1-d1.x.x.x` series** — last committed May 2026, not new since last review.

---

## New Code in `main` Since Last Guard (2026-06-25 18:08 ICT)

Significant features landed on main during June 25-26 that were not in scope of the prior guard report:

| Merge | Description |
|-------|-------------|
| `feat/payment-reversal-phase4` | PaymentDraft side-table + บันทึก Draft → ลงบัญชี |
| `chore/payment-wizard-followups` | Config-driven waiver reasons + draft-button loading guard |
| `inbox fix K` | WS gateway `isActive` re-check on connect |
| `inbox fix J` | DB-level send idempotency (clientMessageId dedup) |
| `inbox fix I` | Server-side tab/channel/AI filters |
| `feat/payment-type-in-page-overlays` | In-page ปรับงวด + คืนเครื่อง overlays (no redirect) |
| `feat/record-payment-wizard-mockup` | Payment wizard phases 1–3 |
| `feat/late-fee-perday` | Per-day late fee + 5% cap (CPA-gated) |
| `feat/shop-collect-11-2107` | Shop-collect early payoff (11-2107) |
| `spec/payment-doc-code-alignment` | Consecutive-missed → ECL signal |

### Critical Checklist

| Check | Result |
|-------|--------|
| Missing `@UseGuards(JwtAuthGuard, RolesGuard)` on new controllers | ✅ None — PaymentsController and ContractsController both guard at class level |
| `Number()` on money/financial fields (new code, not passing to existing `number`-typed API) | ⚠️ See Warning below |
| Missing `deletedAt: null` in new queries | ✅ All PaymentDraft queries include `deletedAt: null`; ChatMessage intentionally has no `deletedAt` (append-only) |
| Hardcoded secrets / API keys | ✅ None found |
| Missing `@Roles()` on new controller methods | ✅ All new endpoints (`/draft`, `/draft/:id`, `/:id/post-draft`, `/waiver-reasons`) decorated |
| Unparameterized `$queryRaw` | ✅ None found |
| Raw `fetch()` in new frontend | ✅ None found |

### Issues Found

#### ⚠️ Warning — `Number()` on `Decimal` fields in `postDraft`

**File**: `apps/api/src/modules/payments/payments.service.ts:326,337`

```ts
// Line 326
Number(draft.amount),

// Line 337  
draft.lateFeeWaiverAmount != null ? Number(draft.lateFeeWaiverAmount) : undefined,
```

`draft.amount` and `draft.lateFeeWaiverAmount` are both `Decimal @db.Decimal(12, 2)` in the `PaymentDraft` model. They are converted to `number` to satisfy the existing `recordPayment(amount: number, ...)` signature, which the orchestrator internally converts back to `Prisma.Decimal` via `new Prisma.Decimal(amount.toString())`.

**Why not Critical**: The round-trip `Decimal → number → Decimal` is safe for 2-decimal-place Thai Baht amounts at typical installment scales. The orchestrator uses `d(amount)` which correctly handles the JS number → Decimal conversion. This is consistent with how every other caller of `recordPayment` works (the DTO also uses `amount: number`).

**Why it's a Warning**: The v4 hardening specifically replaced 53 `Number()` usages on financial fields with `Prisma.Decimal`. Using `Number()` here is a pattern regression from that effort. The minimal fix is to use `.toNumber()` (more idiomatic Prisma convention). The proper fix is to evolve `recordPayment` to accept `Decimal | number` so the conversion is avoided.

**Recommendation**: Low-priority cleanup — use `draft.amount.toNumber()` and `draft.lateFeeWaiverAmount.toNumber()` in `postDraft`. Track as tech-debt rather than blocking.

---

### Positive Findings

- **WS `isActive` hardening** (`staff-chat.gateway.ts`): New `isActive` DB check on WebSocket connect mirrors REST JwtStrategy — deactivated users with unexpired tokens are now rejected at WS layer too. 
- **Idempotent staff send**: `clientMessageId` dedup prevents double-send on retry. P2002 (unique constraint violation) is caught gracefully — losers skip re-send.
- **Per-day late fee**: Uses `resolveLateFee` utility for consistency; SQL cron uses `LEAST(...)` and an anti-drift test verifies SQL == TypeScript.
- **Shop-collect 11-2107**: Correctly routes Dr to new `11-2107 ลูกหนี้-หน้าร้าน` account; settlement endpoint is idempotent via `settlementJournalEntryId`.

---

## Recommendation

**APPROVE** — no critical pre-merge issues.

One **Warning** finding in already-merged code (`postDraft` Decimal→number round-trip) — flag for next cleanup sprint but does not require a hotfix. Worktree branches remain blocked on rebase.

---

## Branch Hygiene Note

444+ stale remote branches remain (branches from old PRs not deleted by GitHub). `git branch -r --merged origin/main | grep -v HEAD | grep -v 'main$'` returns ~440 entries. Consider running a periodic branch-cleanup action.
