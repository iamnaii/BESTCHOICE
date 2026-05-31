# Pre-Merge Guard Report — 2026-05-31

> Reviewed branches: top 3 by recency (excluding guard/watchdog branches).
> Total unmerged branches in repo: 673.

---

## Branch 1: `fix/fb-webhook-integration-config`

**Author:** Akenarin Kongdach  
**Commit:** `fix(facebook-webhook): resolve verify token + app secret from IntegrationConfig`  
**Files changed:** 3 (1 controller, 1 spec, 1 module)

### Summary
Migrates `FacebookWebhookController` off hard-coded env vars (`FB_VERIFY_TOKEN`, `FB_APP_SECRET`) to `IntegrationConfigService` (DB-backed with env fallback). Adds 3 new unit-test suites covering the DB-driven verify-token path.

### Issues

#### Critical — None

#### Warning

| # | File | Issue |
|---|------|-------|
| W1 | `facebook-webhook.controller.ts:86` | `verifyWebhook` changed from `void` to `async Promise<void>`. Facebook's webhook handshake is latency-sensitive; the added `await integrationConfig.getConfig('facebook')` on every GET verification call adds a DB round-trip. A cold-start verification delay could cause FB to retry, but this is a product decision not a security bug. |

#### Info

| # | File | Issue |
|---|------|-------|
| I1 | `facebook-webhook.controller.ts` | Controller is correctly public (intentionally listed in security rules — `paysolutions`/`sms-webhook`/`facebook` webhooks are explicitly exempt from `JwtAuthGuard`). No guard issue. |
| I2 | `chat-adapters.module.ts` | Module comment explains the `IntegrationsModule` import. |

### Recommendation: ✅ APPROVE

No blocking issues. The DB fallback path is correct (fail-closed: empty `verifyToken` rejects). Test coverage is solid (3 new describe blocks, 68 new lines of tests).

---

## Branch 2: `feat/canned-response-channel-tabs`

**Author:** Akenarin Kongdach  
**Commits:**
- `feat(canned-response): add per-channel tabs in template editor`
- `fix(canned-response): Phase 2b — review issues C/W1/W2 channel tabs`

**Files changed:** 5 (2 new TSX, 1 new TS logic, 1 new test, 1 modified TSX)

### Summary
Adds per-channel filter tabs (`LINE_FINANCE`, `FACEBOOK`, `ALL`) to the canned-response template editor. Bubble reorder logic is extracted into a pure function (`bubble-reorder-logic.ts`) with 100 lines of unit tests. Channel-scoped bubble creation (`channels[]` on create POST) is added.

### Issues

#### Critical — None

#### Warning — None

#### Info

| # | File | Issue |
|---|------|-------|
| I1 | `BubbleList.tsx:80` | `queryFn` uses an inline `.then((r: any) => r.data)` — minor `any` cast, pre-existing pattern. Not introduced by this PR. |
| I2 | `ChannelTabs.tsx` | New file has no TypeScript `any` usage. Design tokens used correctly (`bg-primary`, `text-muted-foreground`, `bg-muted`). No hardcoded hex colors. |
| I3 | `bubble-reorder-logic.ts` | Pure function, well-tested. Comment explains the cross-channel ordering invariant. |
| I4 | `TemplateEditorPane.tsx:133` | `useEffect` to reset `activeChannel` on template change is correct; dependency on `template?.id` is intentional. |

### Recommendation: ✅ APPROVE

Clean frontend-only change. Uses `api.get/post` from `@/lib/api`, `useQuery`/`useMutation` from React Query, `queryClient.invalidateQueries()` after mutations, `toast.success/error` from sonner, semantic design tokens. Pure logic extracted and unit-tested. No issues found.

---

## Branch 3: `feat/sp2-exchange-sign-flow`

**Author:** Akenarin Kongdach  
**Commits:** 3 commits (exchange sign-then-activate flow, UI navigation, seed SQL fix)  
**Files changed:** 10 (2 spec, 1 service, 1 workflow service, 1 module, 2 frontend TSX, 1 SQL, 2 other specs)

### Summary
Major refactor of the exchange approval flow. Previously `approve()` ran the full JE chain (A.1–A.4) atomically. Now `approve()` only creates a DRAFT contract + reserves the new product, and `finalizeAfterActivation()` (called from `ContractWorkflowService.activate()` inside the existing `$transaction`) runs the JE chain. This implements the "sign-then-activate" gate — customer must sign the new contract before money moves.

### Issues

#### Critical — None

#### Warning

| # | File | Lines | Issue |
|---|------|-------|-------|
| W1 | `contract-workflow.service.ts:409,450` | `(contract as any).exchangedFromContractId` — the `findOne` in `ContractsService` uses `include` (not `select`), so scalar fields ARE returned at runtime. However, the TypeScript type narrows to the Prisma relation-included type which doesn't expose this field, forcing the `as any` cast. This masks a type drift risk if the field is ever removed/renamed. Suggestion: add `exchangedFromContractId: true` to a `select` inside `activate()` or extend the return type. |
| W2 | `contract-exchange.service.ts` (production) | Multiple `data: { ... } as any` casts on Prisma update calls (`status: 'RESERVED'`, `status: 'EXCHANGED'`, `status: 'REFURBISHED'`). These are valid enum values in `schema.prisma` (lines 143, 147, 45) so they won't fail at runtime, but the `as any` suppresses compile-time enum validation. |
| W3 | `contract-exchange.service.ts` | `(tx as any).contractExchangeRequest.findFirst` and `.update` — `tx` inside `finalizeAfterActivation` is the Prisma transaction client passed by the caller. Its type should be `Prisma.TransactionClient`. If typed properly the `as any` cast is unnecessary. |

#### Info

| # | File | Issue |
|---|------|-------|
| I1 | `contracts.module.ts` | `ContractExchangeModule` added to imports with explanation comment. No circular dependency: `ContractExchangeModule` only imports `PrismaModule`, `AuditModule`, `JournalModule` — none of which import `ContractsModule`. ✅ |
| I2 | Test files | `let tx: any`, `let templates: any`, `let audit: any` etc. are test scaffolding — acceptable. |
| I3 | `ExchangeRequestsPage.tsx` | After approve mutation `onSuccess`, `invalidateQueries({ queryKey: ['exchange-requests-pending'] })` is called ✅. Navigation to `/contracts/${newContractId}` is gated on `newContractId` being truthy ✅. |
| I4 | `apps/api/src/cli/fix-sp1-used-exchange-uuid.sql` | One-time SQL migration file (48 lines). Idempotent pattern (UPDATE with WHERE string UUID check). No production risk but should be run via the standard migration runbook before merging. |

### Recommendation: ⚠️ REVIEW

No blocking security or data-integrity issues. Three `as any` casts in production service code are a maintainability concern — type drift could cause silent runtime errors if Prisma schema or enum values change. Recommend fixing W1–W3 before merge, or explicitly accepting the technical debt via a `// eslint-disable-next-line @typescript-eslint/no-explicit-any` comment with justification.

The architectural flow (approve → DRAFT, activate → finalize + JEs) is correct and well-tested.

---

## Summary Table

| Branch | Critical | Warning | Info | Verdict |
|--------|----------|---------|------|---------|
| `fix/fb-webhook-integration-config` | 0 | 1 (perf) | 2 | ✅ APPROVE |
| `feat/canned-response-channel-tabs` | 0 | 0 | 4 | ✅ APPROVE |
| `feat/sp2-exchange-sign-flow` | 0 | 3 (type safety) | 4 | ⚠️ REVIEW |

---

*Generated by Pre-Merge Guard agent — 2026-05-31*
