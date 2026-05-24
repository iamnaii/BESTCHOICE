# Pre-Merge Guard Report — 2026-05-24

**Reviewed by**: Pre-Merge Guard Agent  
**Date**: 2026-05-24  
**Branches reviewed**: 3 most-recently-updated substantive branches (from 608 unmerged)

---

## Branch 1 — `feat/inbox-avatar-fallback-and-customer-link`

**Author**: Akenarin Kongdach  
**Last commit**: 2026-05-24 18:28 BKK  
**Commit**: `e36c0cb1 feat(inbox): generated avatar fallback + link-customer-from-chat flow`

### File Changes Summary

| File | Change |
|------|--------|
| `apps/api/src/modules/chat-engine/services/room-manager.service.ts` | +35 — new `linkCustomer()` method |
| `apps/api/src/modules/staff-chat/staff-chat.controller.ts` | +13 — new `PATCH rooms/:id/customer` endpoint |
| `apps/web/src/lib/avatar.ts` | +14 — new file, DiceBear fallback avatar |
| `apps/web/src/pages/CustomersPage.tsx` | +28 — auto-open modal + post-create link flow |
| `apps/web/src/pages/UnifiedInboxPage/components/ChatPanel.tsx` | +4 — avatar fallback |
| `apps/web/src/pages/UnifiedInboxPage/components/ConversationItem.tsx` | +4 — avatar fallback |
| `apps/web/src/pages/UnifiedInboxPage/components/Customer360Panel.tsx` | +71 — no-customer empty-state CTA |
| `apps/web/src/pages/UnifiedInboxPage/index.tsx` | +5 — pass session to Customer360Panel |

### Critical Issues

None.

- `StaffChatController` has `@UseGuards(JwtAuthGuard, RolesGuard)` at class level ✅
- New endpoint has `@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES')` ✅
- No `Number()` on money fields ✅
- No raw `fetch()` — uses `api.patch()` ✅
- `queryClient.invalidateQueries()` called after mutation ✅
- `toast.success/error` from sonner ✅
- No hardcoded secrets ✅

### Warnings

**W1 — `linkCustomer()` throws generic `Error` instead of NestJS exceptions**

`apps/api/src/modules/chat-engine/services/room-manager.service.ts` (new method):
```ts
throw new Error('ห้องแชทไม่พบหรือถูกลบ');   // → HTTP 500
throw new Error('ห้องแชทนี้ผูกกับลูกค้ารายอื่นอยู่แล้ว');  // → HTTP 500
throw new Error('ไม่พบลูกค้า');  // → HTTP 500
```

Should use `NotFoundException` (room/customer not found) and `ConflictException` (already linked) so the HTTP status codes are semantically correct and the API contract is predictable. Generic `Error` objects result in HTTP 500 responses, which may confuse the frontend error handler.

**Recommended fix:**
```ts
import { NotFoundException, ConflictException } from '@nestjs/common';
// ...
if (!room || room.deletedAt) throw new NotFoundException('ห้องแชทไม่พบหรือถูกลบ');
if (room.customerId && room.customerId !== customerId) throw new ConflictException('ห้องแชทนี้ผูกกับลูกค้ารายอื่นอยู่แล้ว');
if (!customer || customer.deletedAt) throw new NotFoundException('ไม่พบลูกค้า');
```

### Info

**I1 — External CDN dependency for avatars (DiceBear)**

`apps/web/src/lib/avatar.ts` calls `https://api.dicebear.com/9.x/avataaars/svg?seed=...` from the customer's browser. Implications:
- DiceBear servers can see the seed values (chat session IDs — not PII, low risk).
- If DiceBear is unavailable, the component falls back to the initial-letter placeholder already in the UI.
- Consider a CSP `img-src` allowlist entry if not already present.

### Recommendation

**REVIEW** — Fix W1 (NestJS exceptions) before merge. I1 is acceptable as-is.

---

## Branch 2 — `fix/exchange-pdpa-clone`

**Author**: Akenarin Kongdach  
**Last commit**: 2026-05-24 17:30 BKK  
**Commit**: `e172e4eb fix(exchange): clone PDPA consent for new exchange contract`

### File Changes Summary

| File | Change |
|------|--------|
| `apps/api/src/modules/contract-exchange/contract-exchange.service.ts` | +30 — clone PDPA consent in `approve()` |
| `apps/api/src/modules/contract-exchange/contract-exchange.service.spec.ts` | +54 — updated + expanded tests |

### Critical Issues

None.

### Warnings

None.

### Info

**I1 — Correct fix for `@unique` constraint**

`Contract.pdpaConsentId` has a `@unique` constraint in the Prisma schema. The old code tried to reuse the same `PDPAConsent` row for the exchange contract, which would fail with a Prisma unique constraint violation at runtime. This fix correctly clones the row (same customer + same consent semantics + fresh UUID) so both the old and new contract each hold their own consent FK. The audit trail per-contract is also preserved.

Test coverage is thorough: covers the clone path, the null-consent path, and verifies the new `pdpaConsentId` is different from the original.

**I2 — Merge coordination required with `feat/sp2-exchange-sign-flow`**

Both branches modify `contract-exchange.service.ts`:`approve()` and its spec. The `sp2-exchange-sign-flow` branch contains a stale test:
```ts
// In sp2-exchange-sign-flow spec:
it('carries pdpaConsentId from old contract onto new contract', ...)
expect(createData.pdpaConsentId).toBe('pdpa-old-123');  // old behavior
```

This contradicts the clone behavior this branch introduces. These two branches **must be merged in order**: `fix/exchange-pdpa-clone` first, then `sp2-exchange-sign-flow` rebased/updated to remove the stale test.

### Recommendation

**APPROVE** — Clean fix with good test coverage. Merge before `feat/sp2-exchange-sign-flow`. See I2.

---

## Branch 3 — `feat/sp2-exchange-sign-flow`

**Author**: Akenarin Kongdach  
**Last commit**: 2026-05-24 16:11 BKK  
**Commits** (5):
- `refactor(exchange): defer JE chain + status flips to activation step`
- `feat(exchange): branch activate() to call finalizeAfterActivation for exchange contracts`
- `feat(exchange-ui): navigate to new contract sign page after approval`
- `fix(exchange): use advanceBalance + drop unknown contractDate field`
- `chore(seed): SQL fix-up converting SP1 used-exchange string IDs → UUIDs`

### File Changes Summary

| File | Change |
|------|--------|
| `apps/api/src/modules/contract-exchange/contract-exchange.service.ts` | +150 — `approve()` refactored, new `finalizeAfterActivation()` |
| `apps/api/src/modules/contract-exchange/contract-exchange.service.spec.ts` | +390 — full suite rewrite for sign-then-activate |
| `apps/api/src/modules/contracts/contract-workflow.service.ts` | major — `activate()` branches on `exchangedFromContractId` |
| `apps/api/src/modules/contracts/contracts.module.ts` | +15 — `ContractExchangeService` wired into `ContractsModule` |
| `apps/web/src/pages/insurance/ExchangeRequestForm.tsx` | +7 — updated toast message |
| `apps/web/src/pages/insurance/ExchangeRequestsPage.tsx` | +19 — navigate to new contract on approve |
| 4 spec files | mock additions for `ContractExchangeService` |

### Critical Issues

None.

- No `Number()` on financial fields — Decimal used correctly throughout `finalizeAfterActivation()` ✅
- No missing `deletedAt` — exchange request query includes `deletedAt: null` ✅
- No new controller endpoints (service-only change) ✅
- Frontend uses `api.post()`, `queryClient.invalidateQueries()`, `toast.success()` ✅

### Warnings

**W1 — Stale PDPA test contradicts `fix/exchange-pdpa-clone`**

The spec still contains:
```ts
// contract-exchange.service.spec.ts
it('carries pdpaConsentId from old contract onto new contract', async () => {
  ...
  expect(createData.pdpaConsentId).toBe('pdpa-old-123');  // will fail after pdpa-clone merges
});
```

`fix/exchange-pdpa-clone` changes `approve()` so `pdpaConsentId` is CLONED (new UUID), not carried (same UUID). This test will fail once `fix/exchange-pdpa-clone` is merged. Update the test to match the clone behavior before or during merge.

**W2 — `tx as any` casts in `finalizeAfterActivation()`**

```ts
const request = await (tx as any).contractExchangeRequest.findFirst({ ... });
await (tx as any).contractExchangeRequest.update({ ... });
```

The `Prisma.TransactionClient` type should expose `contractExchangeRequest` — the `as any` casts suggest a type mismatch in the `ExchangeContractForFinalize` / transaction client types. Consider adding the correct type import rather than casting.

### Info

**I1 — Architecture improvement: sign-then-activate flow**

The refactor correctly separates concerns: `approve()` creates a DRAFT contract (customer must sign), and `finalizeAfterActivation()` fires the JE chain only after the OWNER/BM/FM activates the signed contract. This matches the SP2 requirement and prevents premature JE posting. The `ContractWorkflowService.activate()` branching on `exchangedFromContractId` is clean.

**I2 — Merge dependency on `fix/exchange-pdpa-clone`**

`fix/exchange-pdpa-clone` was authored as a follow-up on a shared ancestor. Merge order:
1. `fix/exchange-pdpa-clone` → main
2. Rebase `feat/sp2-exchange-sign-flow` onto main (or squash-merge)
3. Update the stale PDPA test in step 2

### Recommendation

**REVIEW** — Fix W1 (update stale PDPA test) and W2 (remove `as any` casts). Merge AFTER `fix/exchange-pdpa-clone`.

---

## Summary Table

| Branch | Commits | Files Changed | Critical | Warnings | Verdict |
|--------|---------|--------------|----------|----------|---------|
| `feat/inbox-avatar-fallback-and-customer-link` | 1 | 8 | 0 | 1 | **REVIEW** |
| `fix/exchange-pdpa-clone` | 1 | 2 | 0 | 0 | **APPROVE** |
| `feat/sp2-exchange-sign-flow` | 5 | 10 | 0 | 2 | **REVIEW** |

## Merge Order Recommendation

```
fix/exchange-pdpa-clone  ──→  main
                                  ↑
feat/sp2-exchange-sign-flow  rebase + fix W1+W2  ──→  main
                                  ↑
feat/inbox-avatar-fallback-and-customer-link  fix W1  ──→  main  (independent)
```

`inbox-avatar` can be merged independently (no overlapping files). The two exchange branches must be sequenced.
