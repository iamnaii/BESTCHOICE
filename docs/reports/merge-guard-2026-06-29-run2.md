# Pre-Merge Guard Report — 2026-06-29 (Run 2)

**Run time**: 2026-06-29 UTC  
**Previous run**: `guard/review-2026-06-29` (03:07 UTC) — covered worktree-feat-shop-sales-ai-phase-a, worktree-feat+sp7.1-dual-prisma-foundation, chore/doc-config-single-source  
**Branches scanned this run**: 4 (unreviewed branches from worktree history)  
**Author**: iamnaii (Akenarin Kongdach — akenarin.ak@gmail.com)

---

## Context

All 4 branches belong to the **worktree history** (no common ancestor with `main`). They are stacked:

```
c8d4e3ab  docs: team onboarding / contributing guide  ← common base
    ↓
fix/inbox-stability-sweep   (2 unique commits — 23 UnifiedInbox bug fixes)
    ↓
fix/fb-profile-fields        (1 unique commit — FB User Profile API field fix)
    ↓
fix/fb-avatar-backfill       (1 unique commit — OWNER-gated backfill controller)

chore/stale-contacts-comments  ← common base (previously reviewed: APPROVE)
    ↓
chore/settings-contacts-cleanup  (1 unique commit — label rename + stale routing)
```

---

## Branches Reviewed

### 1. `fix/inbox-stability-sweep`
**Unique commits**: 2 (`4836433e`, `cbe0a49f`)  
**Scope**: 23 stability + correctness fixes across UnifiedInbox + FacebookAdapter

#### Changes Summary
| File | Change |
|------|--------|
| `chat-adapters/facebook.adapter.ts` | Switched from `ConfigService` (cached constructor env) to `IntegrationConfigService` (DB form w/ env fallback, per-call) |
| `chat-engine/services/assignment.service.ts` | `assertStaffExists()` guard before FK write; `resolve()` room-existence check |
| `chat-engine/services/handoff-manager.service.ts` | Room-existence check before `chatRoom.update` |
| `chat-engine/services/room-manager.service.ts` | Added `NotFoundException`/`ConflictException` imports |
| `chat-engine/services/assignment.service.spec.ts` | 2 new test cases (unknown staff, unknown room) |
| `UnifiedInboxPage/components/FlexMessagePreview.tsx` | Null guard on `bubble` in `renderBubble` |
| `UnifiedInboxPage/components/PaymentFlexPreview.tsx` | `safeNum()` prevents literal `"NaN"` in payment flex |
| `UnifiedInboxPage/hooks/useChatSocket.ts` | `ChatRole` type mirrors backend enum; reconnect handler re-joins open room |
| `UnifiedInboxPage/hooks/useKeyboardShortcuts.ts` | `isEditableTarget` guard stops Cmd+K/Ctrl+Shift+R misfiring in composer |
| `UnifiedInboxPage/index.tsx` | `sendRoomMessage` returns `boolean`; `onRoomUpdate` fires notification for background rooms |

#### Security & Guards
- No new controllers added. ✅
- `assertStaffExists` uses `deletedAt: null` filter correctly. ✅
- All 3 new `findUnique` calls properly gate on `!room` before `update`. ✅
- No hardcoded secrets or API keys. ✅
- Frontend uses `api.post()` from `@/lib/api` for message send. ✅

#### Money / Decimal
- No financial fields in this code path. ✅

#### Issues Found

| # | Severity | File | Issue |
|---|----------|------|-------|
| — | None | — | No issues found |

**Verdict**: ✅ **APPROVE**

---

### 2. `fix/fb-profile-fields`
**Unique commits**: 1 (`350822fb`)  
**Scope**: Facebook User Profile API field name fix

#### Changes
`fetchDirectProfile` in `facebook.adapter.ts`:
- **Before**: `?fields=name,profile_pic` → response typed as `{ name?: string; profile_pic?: string }`
- **After**: `?fields=first_name,last_name,profile_pic` → joins `${first_name ?? ''} ${last_name ?? ''}`.trim()

The fix is correct — the Messenger User Profile API returns `first_name`/`last_name` for PSIDs, not a top-level `name` field. The old code silently returned `null` for every profile (because `json.name` was always undefined), suppressing names and avatars.

Also updates `settings-tabs.spec.ts` tab IDs and `App.tsx` `PeriodsRedirect` path (both are carry-over from the stacked merge commits in this branch's history — already reviewed in prior guard runs).

#### Security & Guards
- No new controllers. ✅
- No secrets. ✅

#### Issues Found

| # | Severity | File | Issue |
|---|----------|------|-------|
| — | None | — | No issues found |

**Verdict**: ✅ **APPROVE**

---

### 3. `fix/fb-avatar-backfill`
**Unique commits**: 2 (`07c57a91` merge, `7c4981ce`)  
**Scope**: OWNER-only admin endpoint to backfill FB customer avatars

#### New Files
- `chat-adapters/facebook-admin.controller.ts` — `POST /admin/facebook/backfill-profiles`
- `chat-adapters/facebook-backfill.service.ts` — batch avatar backfill logic

#### Security & Guards

| Controller | Class Guards | Method Roles | Verdict |
|-----------|-------------|--------------|---------|
| `FacebookAdminController` | `@UseGuards(JwtAuthGuard, RolesGuard)` ✅ | `@Roles('OWNER')` ✅ | ✅ Secure |

- Endpoint is `POST` (state-changing) — correctly requires authentication. ✅
- `limit` parameter is clamped to `[1, 1000]` via `Math.min(Math.max(opts.limit ?? 150, 1), 1000)`. ✅
- `FacebookBackfillService` queries include `deletedAt: null`. ✅
- No hardcoded secrets. ✅
- Result summary returned (total/updatedName/updatedPicture/failed/remaining) but no PII in response body. ✅

#### Money / Decimal
- No financial fields. ✅

#### Issues Found

| # | Severity | File | Issue |
|---|----------|------|-------|
| I-1 | Info | `facebook-admin.controller.ts` | `onlyMissing !== 'false'` convention: param defaults to `true` unless explicitly `'false'`. Correct behavior but non-obvious; a `?onlyMissing=true` string would also work as `true`. Acceptable for a one-shot admin tool. |

**Verdict**: ✅ **APPROVE**

---

### 4. `chore/settings-contacts-cleanup`
**Unique commits**: 1 (`297d0108`)  
**Scope**: Label rename "รายชื่อผู้ติดต่อ" → "สมุดผู้ติดต่อ" across CommandPalette, ContactCombobox, QuickBuyModal; test + comment updates

#### Changes Summary
| File | Change |
|------|--------|
| `CommandPalette.tsx` | Label rename + removes "สมุดผู้ติดต่อ" from keywords (was in old label) |
| `CommandPalette.test.tsx` | Test strings updated to match new label |
| `ContactCombobox.tsx` | `CommandGroup heading` label renamed |
| `QuickBuyModal.tsx` | Toast error message renamed |
| `Sidebar.tsx` | Comment example updated |
| `App.tsx` | **⚠ Stale routing** — see W-1 below |
| `config/__tests__/settings-access.test.ts` | OWNER category count: 9 → 8 |

#### Security & Guards
- Frontend-only changes. No new controllers or guards. ✅

#### Issues Found

| # | Severity | File | Issue |
|---|----------|------|-------|
| W-1 | **Warning** | `apps/web/src/App.tsx` | **Stale routing conflict.** This branch was cut from `chore/stale-contacts-comments` which predates `feat/integrations-own-category`. Its `App.tsx` has redirects pointing `settings/integrations → settings/system/integrations` (OLD direction), whereas branches with `feat/integrations-own-category` merged have `settings/system/integrations → settings/integrations/hub`. The worktree tip (`worktree-feat-shop-sales-ai-phase-a`) has `/settings/integrations` as a real `ProtectedRoute`, not a redirect at all. **If cherry-picked onto any post-integration-split base, the routing would regress.** |
| W-2 | **Warning** | `config/__tests__/settings-access.test.ts` | Asserts OWNER sees 8 categories. Later branches assert 9. Count mismatch would fail TypeScript/E2E in the worktree tip state. |
| I-1 | Info | `CommandPalette.tsx` | `keywords` field for `/contacts` lost the keyword `"สมุดผู้ติดต่อ"` that previously existed (label was the keyword). After this change, searching "สมุด" in CommandPalette will miss the contacts entry because neither the label nor the keywords field contains it. Low impact but degrades search discoverability. |

**Verdict**: ⚠️ **REVIEW** — label renames are correct; cherry-pick only the `CommandPalette.tsx`, `ContactCombobox.tsx`, `QuickBuyModal.tsx`, and `Sidebar.tsx` changes. Do NOT carry `App.tsx` or `settings-access.test.ts` changes onto any post-`feat/integrations-own-category` base.

---

## Summary

| Branch | Critical | Warning | Info | Verdict |
|--------|----------|---------|------|---------|
| `fix/inbox-stability-sweep` | 0 | 0 | 0 | ✅ APPROVE |
| `fix/fb-profile-fields` | 0 | 0 | 0 | ✅ APPROVE |
| `fix/fb-avatar-backfill` | 0 | 0 | 1 | ✅ APPROVE |
| `chore/settings-contacts-cleanup` | 0 | 2 | 1 | ⚠️ REVIEW |

## Recommended Actions

1. **`fix/fb-avatar-backfill` (tip of inbox/FB stack)** — All 3 branches in this stack are APPROVE. The tip contains all 4 commits from the stack. Safe to integrate.

2. **`chore/settings-contacts-cleanup` W-1** — Do NOT merge the full branch. Cherry-pick only files `CommandPalette.tsx`, `ContactCombobox.tsx`, `QuickBuyModal.tsx`, `Sidebar.tsx` onto the current worktree tip. Discard `App.tsx` and `settings-access.test.ts` from this branch — they reflect an older routing state.

3. **`chore/settings-contacts-cleanup` I-1** — After cherry-picking, add `"สมุดผู้ติดต่อ"` back to the `keywords` field in `CommandPalette.tsx` so the entry is still searchable by the new term.

4. **All branches** have no common ancestor with `main`. Integration requires `--allow-unrelated-histories` or cherry-pick — owner to decide strategy (same caveat as in run 1).
