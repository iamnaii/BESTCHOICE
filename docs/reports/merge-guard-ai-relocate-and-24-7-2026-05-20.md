# Pre-Merge Guard Report: feat/ai-relocate-and-24-7

**Date**: 2026-05-20  
**Branch**: `feat/ai-relocate-and-24-7`  
**Latest commit**: `ea454def` (many commits ahead of main — accumulated feature branch)  
**Compared against**: `origin/main`

---

## Summary

Large accumulated branch covering: (1) removal of the business-hours gate from the LINE OA Sales chatbot (bot now replies 24/7), (2) deletion of the unused Quotes and Drafts modules from both API and frontend, (3) relocation of AI menu to a central top-level section in OWNER sidebar, (4) new read-only `AiPersonaPage` viewer for bot system prompts, (5) significant Insurance/SP5 Phase 2 content (PRs A/B/C) which overlaps with — and supersedes — `feat/sp5p2-warranty-check-unify`.

**Note**: This branch contains commits that reference already-reviewed PRs (#1043–#1047). It is likely intended as the "accumulation" branch that will land all SP5 Phase 2 changes in one merge. Merging this AND `feat/sp5p2-warranty-check-unify` separately would cause conflicts — only one should be merged.

## File Changes (TypeScript/TSX only — docs excluded)

| File | Change | Notes |
|------|--------|-------|
| `apps/api/src/modules/ai-settings/ai-settings.controller.ts` | Modified | New `GET /ai-settings/persona` endpoint |
| `apps/api/src/modules/line-oa/line-oa-chatbot.controller.ts` | Modified | Removes `isBusinessHours()` + outside-hours auto-reply |
| `apps/api/src/modules/quotes/` (5 files) | Deleted | Module removed — unused |
| `apps/api/src/modules/drafts/` (4 files) | Deleted | Module removed — unused |
| `apps/api/src/app.module.ts` | Modified | Removes QuotesModule + DraftsModule imports |
| `apps/web/src/config/menu.ts` | Modified | Major restructure — AI top-level + menu reorganisation |
| `apps/web/src/config/menu.test.ts` | Modified | Tests updated |
| `apps/web/src/App.tsx` | Modified | New `/settings/ai-persona` route + insurance routes |
| `apps/web/src/pages/AiPersonaPage.tsx` | New | Read-only bot persona viewer |
| `apps/web/src/pages/AiSettingsPage.tsx` | Modified | Adds ChannelRoutingCard |
| `apps/web/src/pages/QuotesPage.tsx` | Deleted | Frontend removed |
| `apps/web/src/pages/DraftsPage.tsx` | Deleted | Frontend removed |
| Various e2e + test files | New/modified | SP5 Phase 2 smoke tests |
| Docs (design specs, roadmaps) | New | ~6000 lines of markdown docs |

---

## Issues Found

### Critical
*None.*

### Warning

- **W-01** — **Role inconsistency on `/ai-settings/persona`**: The backend endpoint is decorated `@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')`, but the frontend `ProtectedRoute` for `/settings/ai-persona` restricts to `roles={['OWNER']}` only. A BRANCH_MANAGER or FINANCE_MANAGER cannot reach the page via the UI but CAN call the API directly (they have a valid JWT). The endpoint returns the full AI system prompt text. Confirm whether BM/FM should be able to read the prompts — if not, remove them from `@Roles`. If yes, update the ProtectedRoute to include them.

- **W-02** — **Overlapping branch**: This branch includes all the insurance content from `feat/sp5p2-warranty-check-unify` (commits `bcce8f35`, `6aeb5e30`, `010acb64`). Merging both branches to main will cause conflicts. Only one of the two should be merged. Recommend merging this one as it is the more complete version.

- **W-03** — **24/7 chatbot change**: Removing `isBusinessHours()` means the AI Sales Bot will respond to LINE messages at any hour, including the outside-hours auto-reply (`CHATBOT_RESPONSES.outsideHours`). Confirm this is the owner directive and that LINE OA rate limits are acceptable for 24/7 operation.

### Info

- **I-01** — `AiPersonaPage.tsx` uses `api.get()` + `useQuery` correctly. ✓

- **I-02** — Quotes and Drafts module deletions appear clean: `app.module.ts` removes both imports, and corresponding frontend pages/routes have been removed. No dangling references detected.

- **I-03** — The accumulation of 50+ commits in this branch (including multiple insurance sub-PRs) makes review harder. Future branches should keep individual PRs smaller and ensure they are rebased onto main before the accumulation branch is pushed.

- **I-04** — `AiSettingsPage.tsx` imports `Route` icon from `lucide-react` for the new `ChannelRoutingCard`. The icon name `Route` (a navigation path icon) is semantically reasonable for "channel routing". No issue.

---

## Recommendation: ⚠️ REVIEW BEFORE MERGE

Functional quality is good — no critical security issues, no raw fetch(), no Number() on financial fields, proper guards on all new controllers. However, two items need resolution before merge:

1. **W-01**: Clarify role scope for `GET /ai-settings/persona` — align backend @Roles with ProtectedRoute.
2. **W-02**: Coordinate with `feat/sp5p2-warranty-check-unify` owner to avoid double-merge. Only one branch should land.

Once W-01 and W-02 are resolved, this branch is safe to merge.
