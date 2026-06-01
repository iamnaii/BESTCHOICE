# Pre-Merge Guard Report — 2026-06-01

**Generated**: 2026-06-01  
**Reviewed by**: Pre-Merge Guard Agent  
**Branches reviewed**: 3 (most-recently-active unmerged feature branches)

---

## Summary

| Branch | Files Changed | Critical | Warning | Info | Recommendation |
|--------|--------------|----------|---------|------|----------------|
| `fix/fb-webhook-integration-config` | 3 | 0 | 1 | 1 | ✅ APPROVE |
| `fix/letters-e2e-sales-assertion` | 1 | 0 | 0 | 0 | ✅ APPROVE |
| `feat/canned-response-channel-tabs` | 5 | 0 | 1 | 0 | ✅ APPROVE |

All three branches pass the pre-merge gate. No blocking issues.

---

## Branch 1: `fix/fb-webhook-integration-config`

**Author**: Akenarin Kongdach  
**Last commit**: 2026-05-28

### File Changes
```
apps/api/src/modules/chat-adapters/chat-adapters.module.ts       |  3 +
apps/api/src/modules/chat-adapters/facebook-webhook.controller.spec.ts | 68 ++
apps/api/src/modules/chat-adapters/facebook-webhook.controller.ts  | 36 +-
3 files changed, 96 insertions(+), 11 deletions(-)
```

### What Changed
Moves Facebook verify token + app secret lookup from env vars (`FB_VERIFY_TOKEN`, `FB_APP_SECRET`) to `IntegrationConfigService` (database), making them configurable via the Settings UI. Falls closed when no token is configured (returns HTTP 400). Adds `IntegrationsModule` to `ChatAdaptersModule` and 3 new spec blocks covering the new DB-driven token resolution.

### Critical — None

### ⚠️ Warning

**W1 — Misleading spec comment (fail-closed vs env-fallback)**  
`facebook-webhook.controller.spec.ts` line 9 comment says *"DB → env fallback"* but the actual controller implementation has **no env fallback** — it fails closed when `cfg.verifyToken` is empty. The test itself correctly asserts fail-closed behaviour (`'rejects with 400 when no verify token is configured (fail closed)'`). The inconsistency is in the comment only; the code behaviour is correct and secure.  
*File*: `apps/api/src/modules/chat-adapters/facebook-webhook.controller.spec.ts:9`  
*Fix*: Update the comment to say *"reads from IntegrationConfig; fails closed when unset"*.

### ℹ️ Info

**I1 — `FacebookWebhookController` missing from security.md exceptions list**  
`security.md` lists intentionally-public controllers (no `JwtAuthGuard`). `FacebookWebhookController` is intentionally public (it's a Facebook server-to-server webhook) but is not in that list. **Pre-existing gap, not introduced by this PR.** The controller's own JSDoc already documents this intent. Recommend adding it to the security.md list to prevent future false-positive security flags.

### Recommendation: ✅ APPROVE

---

## Branch 2: `fix/letters-e2e-sales-assertion`

**Author**: Akenarin Kongdach  
**Last commit**: 2026-05-26

### File Changes
```
apps/web/e2e/letters-page.spec.ts | 12 ++++++++----
1 file changed, 8 insertions(+), 4 deletions(-)
```

### What Changed
Fixes a brittle E2E assertion for the SALES role on `/letters`. The old test asserted `getByRole('button', { name: 'ยกเลิก' })` had count 0 — but `ยกเลิก` also appears as the label of the **CANCELLED status tab**, causing a false-positive match. The new assertion is: page loads without redirect + heading `จัดการจดหมาย` is visible. A comment explains that the Cancel-button access control is now covered by backend role tests and unit tests instead.

### Critical — None

### Warning — None

### Info — None

This is a pure test quality improvement. No production code touched.

### Recommendation: ✅ APPROVE

---

## Branch 3: `feat/canned-response-channel-tabs`

**Author**: Akenarin Kongdach  
**Last commit**: 2026-05-25

### File Changes
```
apps/web/src/pages/canned-response-admin/BubbleList.tsx          | 86 +++-
apps/web/src/pages/canned-response-admin/ChannelTabs.tsx         | 63 ++ (new)
apps/web/src/pages/canned-response-admin/TemplateEditorPane.tsx  | 17 +-
apps/web/src/pages/canned-response-admin/bubble-reorder-logic.test.ts | 100 ++ (new)
apps/web/src/pages/canned-response-admin/bubble-reorder-logic.ts | 31 ++ (new)
5 files changed, 277 insertions(+), 20 deletions(-)
```

### What Changed
Adds per-channel filter tabs (LINE / Facebook / ALL) to the canned response template editor. Bubbles are filtered client-side by their `channels[]` field. New bubbles are scoped to the active channel. Drag-and-drop reorder was extracted into a pure `reorderBubbles()` function that operates on **all** bubbles (not just visible ones) to preserve cross-channel sort order when dragging inside a filtered view. 7 unit tests cover edge cases (hidden bubbles, universal bubbles, identity drag).

### Frontend Pattern Compliance ✓
- Data fetching via `useQuery` / `useMutation` ✓  
- `queryClient.invalidateQueries()` called in `onSuccess` via `invalidate()` ✓  
- `api.post()` / `api.get()` from `@/lib/api` ✓  
- `toast.error()` from sonner ✓  
- CSS design tokens only (`bg-primary`, `text-muted-foreground`, `bg-muted`, `border-border`) ✓  
- `leading-snug` on all Thai text elements ✓  
- No hardcoded hex colors ✓  

### Critical — None

### ⚠️ Warning

**W1 — `(r: any)` type cast in query function**  
`BubbleList.tsx` line 80: `.then((r: any) => r.data)` — loses the typed response shape from axios. This is an existing pattern across the codebase, but it suppresses TypeScript inference for `bubblesQ.data` downstream.  
*Fix*: Type the query with a generic `api.get<CannedResponseBubble[]>(...)` or add `r: AxiosResponse<CannedResponseBubble[]>`.  
Severity: low (no runtime risk; type-safety only).

### Info — None

The `reorderBubbles` extraction is exemplary — pure function, well-tested, explains the hidden-bubble invariant in the JSDoc. Good separation of concerns.

### Recommendation: ✅ APPROVE

---

## Security Checklist (all three branches)

| Check | Result |
|-------|--------|
| New controllers missing `@UseGuards(JwtAuthGuard)` | ✅ None |
| `Number()` on money/financial fields | ✅ None |
| `deletedAt: null` missing in new queries | ✅ None (no new DB queries) |
| Hardcoded secrets or API keys | ✅ None |
| Missing `@Roles()` on controller methods | ✅ None |
| Unparameterized `$queryRaw` | ✅ None |

---

## Action Items (non-blocking)

1. **security.md** — Add `facebook-webhook` (and `facebook-domain`) to the intentional-public-controller exceptions list to prevent future false flags.
2. **BubbleList.tsx** — Replace `(r: any)` with typed axios generic on the next touching of this file.
3. **facebook-webhook.controller.spec.ts:9** — Fix comment to say "fails closed when unset" instead of "DB → env fallback".
