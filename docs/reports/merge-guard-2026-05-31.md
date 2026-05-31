# Pre-Merge Guard Report — 2026-05-31

**Reviewer**: Pre-Merge Guard (automated)
**Date**: 2026-05-31
**Branches reviewed**: 3 (from 666 total unmerged — most are already squash-merged to main or are guard/watchdog/report branches)

---

## Branch Selection

`git branch -r --no-merged origin/main` returns 666 branches, but this repository uses **squash-merge / rebase-merge**, so most branches appear "unmerged" because their original commit hashes differ from the squashed commits on main. Only branches where `git diff origin/main...<branch>` produces a non-empty diff contain genuinely unreleased content.

Top 3 branches with substantive new content identified:

| Branch | Changed Files | Net Lines |
|--------|--------------|-----------|
| `feat/canned-response-postback-routing` | 15 | +701 / -22 |
| `feat/sp2-exchange-sign-flow` | 10 | +685 / -261 |
| `feat/canned-response-channel-tabs` | 5 | +277 / -20 |

---

## Branch 1: `feat/canned-response-postback-routing`

**Authors**: Akenarin Kongdach, Claude  
**Size**: 15 files, 701 insertions, 22 deletions

### File Changes Summary

| File | Change |
|------|--------|
| `chat-adapters.module.ts` | Adds `forwardRef(() => StaffChatModule)` for QuickReplyPostbackRouterService |
| `facebook-webhook.controller.ts` | Injects `QuickReplyPostbackRouterService` to handle `TEMPLATE:<id>` postbacks |
| `chatbot-finance.service.ts` | Injects `QuickReplyPostbackRouterService` for LINE Finance postbacks |
| `line-oa-chatbot.controller.ts` | Injects `QuickReplyPostbackRouterService` for LINE Shop postbacks |
| `quick-reply-postback-router.service.ts` | **NEW** — routes `TEMPLATE:<id>` payloads to `CannedResponseSenderService` |
| `canned-response-sender.service.ts` | **NEW** — sends canned response bubbles to a chat room via channel adapter |
| `*.spec.ts` (5 files) | Test coverage for all new services and updated callers |
| `CannedResponseAdminPage.tsx` / `TemplateEditorPane.tsx` / `QuickReplyEditor.tsx` | Minor UI wires |
| `staff-chat.module.ts` | Registers new services |

### Critical Issues

None.

> `line-oa-chatbot.controller.ts` and `facebook-webhook.controller.ts` are in the intentionally-public list (no `JwtAuthGuard` required) — confirmed correct.

### Warning Issues

None.

### Info

- **W7 loop guard**: `QuickReplyPostbackRouterService.recentSends` is an in-memory `Map<roomId, number[]>` with a 10-second / 5-dispatch window. This correctly limits blast radius for mutual-postback loops. Map entries persist per-process (reset on restart) — acceptable for a rate-limit defense.
- **forwardRef pattern**: `forwardRef(() => StaffChatModule)` and `forwardRef(() => ChatAdaptersModule)` used for circular dependency resolution between `ChatAdaptersModule ↔ StaffChatModule`. This is the established NestJS pattern; no risk.
- **`deletedAt: null` present** in all new Prisma queries inside `canned-response-sender.service.ts`. ✓

### Recommendation: **APPROVE**

---

## Branch 2: `feat/canned-response-channel-tabs`

**Authors**: Akenarin Kongdach, Claude  
**Size**: 5 files, 277 insertions, 20 deletions

### File Changes Summary

| File | Change |
|------|--------|
| `BubbleList.tsx` | Adds `channelFilter` prop — filters visible bubbles; `onCountsChange` for tab badges |
| `ChannelTabs.tsx` | **NEW** — tab bar component (LINE_FINANCE / LINE_SHOP / FACEBOOK / ALL) |
| `TemplateEditorPane.tsx` | Wires `ChannelTabs` above `BubbleList`; resets tab on template switch |
| `bubble-reorder-logic.ts` | **NEW** — pure utility extracting drag-sort logic for channel-filtered DnD |
| `bubble-reorder-logic.test.ts` | **NEW** — 100-line Vitest suite (7 cases including cross-channel hidden-bubble edge cases) |

### Critical Issues

None.

### Warning Issues

None.

### Info

- **`(r: any) => r.data` pattern**: Used throughout API calls for response unwrapping. Minor — acceptable per project convention; no security risk.
- **`useEffect` dep stability**: `TemplateEditorPane` passes `setBubbleCounts` (a React state setter, which is guaranteed stable) as `onCountsChange`. No infinite re-render risk.
- **Design tokens correct**: All color references use `bg-primary`, `bg-muted`, `text-muted-foreground`, `text-foreground`, `border-border` — no hardcoded hex or `text-gray-*`. ✓
- **`queryClient.invalidateQueries` present** after all mutations in `BubbleList.tsx`. ✓
- **Cap logic**: Total bubble cap of 5 is applied to `allBubbles.length`, not the filtered-view count — LINE limit is correctly enforced regardless of active channel tab.

### Recommendation: **APPROVE**

---

## Branch 3: `feat/sp2-exchange-sign-flow`

**Authors**: Akenarin Kongdach, Claude  
**Size**: 10 files, 685 insertions, 261 deletions

### File Changes Summary

| File | Change |
|------|--------|
| `contract-exchange.service.ts` | **Major refactor** — `approve()` now creates DRAFT contract only; `finalizeAfterActivation()` is new method handling JE chain A.1-A.4 + old-side flips |
| `contract-workflow.service.ts` | Wires `finalizeAfterActivation()` inside `activate()` when `exchangedFromContractId` is set |
| `contracts.module.ts` | Registers `ContractExchangeService` in `ContractsModule` providers |
| `contract-exchange.service.spec.ts` | Test suite rewritten: `approve` tests updated; new `finalizeAfterActivation` suite added |
| `contract-workflow.service.spec.ts` | Exchange-path activation tests: call verification + rollback test |
| `contract-signing-workflow.spec.ts` | Minor mock alignment |
| `contract-hash.spec.ts` | Minor field additions to mock builder |
| `ExchangeRequestsPage.tsx` | Navigate to new DRAFT contract after approve, toast message updated |
| `ExchangeRequestForm.tsx` | Minor UI text update |
| `fix-sp1-used-exchange-uuid.sql` | **NEW** — one-time SQL backfill for SP1 records with mismatched UUID |

### Critical Issues

None.

> All monetary calculations use `new Decimal(...)` — no `Number()` on financial fields. ✓  
> New `findFirst` query in `finalizeAfterActivation` includes `deletedAt: null`. ✓  
> No new controllers, no new public endpoints.

### Warning Issues

**W1 — Type cast hides field access in `ContractWorkflowService.activate()`**

```typescript
// apps/api/src/modules/contracts/contract-workflow.service.ts
const isExchangeContract = !!(contract as any).exchangedFromContractId;
// ...
exchangedFromContractId: (contract as any).exchangedFromContractId,
```

`contract` is the result of a `prisma.contract.findFirstOrThrow()` call (Prisma returns all scalar fields by default, so `exchangedFromContractId` IS present at runtime). However, the `as any` cast suggests the inferred TypeScript type does not include the field — likely because the query uses a custom select/include without listing `exchangedFromContractId`. If someone later narrows the select to explicit fields and omits this one, the check silently becomes `undefined → false`, causing exchange contracts to go through the standard activation path (posting 1A instead of the exchange JE chain).

**Recommended fix**: Add `exchangedFromContractId: true` to the Prisma `findFirstOrThrow` select clause in `activate()`, removing the need for `as any`.

### Info

- **`fix-sp1-used-exchange-uuid.sql`**: One-time backfill for records created before SP2 where exchange requests have mismatched UUIDs. Must be run on production BEFORE deploying this branch if SP1 is already live. Review against prod data before executing.
- **`ExchangeContractForFinalize` interface** accepts `financedAmount: Prisma.Decimal | string | number`. The `number` type is potentially a float, but `new Decimal(newContract.financedAmount.toString())` safely converts — no precision loss. Low risk.
- **Rollback test present**: `contract-workflow.service.spec.ts` includes a test that activation rolls back when `finalizeAfterActivation` throws — atomicity guarantee is verified. ✓
- **PDPA consent carry-over**: `pdpaConsentId` is copied from old contract to new DRAFT contract. ✓
- **Audit trail**: `EXCHANGE_REQUEST_APPROVED` event now carries `phase: 'awaiting-sign-then-activate'` so auditors can see no money moved at approval time. ✓

### Recommendation: **REVIEW**

The Warning (W1) is not a security issue and the runtime behavior is correct today, but the `as any` cast creates a latent brittleness. Safe to merge after confirming `exchangedFromContractId` is included in the Prisma select in `activate()`, or after removing the `as any` cast.

---

## Summary

| Branch | Critical | Warning | Info | Verdict |
|--------|----------|---------|------|---------|
| `feat/canned-response-postback-routing` | 0 | 0 | 2 | ✅ APPROVE |
| `feat/canned-response-channel-tabs` | 0 | 0 | 4 | ✅ APPROVE |
| `feat/sp2-exchange-sign-flow` | 0 | 1 | 4 | 🔶 REVIEW |

---

*Generated by Pre-Merge Guard agent. Does not merge or push PRs — report only.*
