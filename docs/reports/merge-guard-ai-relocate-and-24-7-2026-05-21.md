# Merge Guard Report — feat/ai-relocate-and-24-7

**Date**: 2026-05-21  
**Branch**: `feat/ai-relocate-and-24-7`  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Last commit**: bd3c933e (2026-05-20 11:26 BKK)  
**Recommendation**: ⚠️ REVIEW (2 warnings — no blockers)

---

## Summary

Large branch (34 files, +8,445 / -3,485 lines) covering:

1. **AI menu relocation** — AI group moves from nested child of "ตั้งค่า" → top-level settings section across all role configs (OWNER, BRANCH_MANAGER, FINANCE_MANAGER, ACCOUNTANT, SALES)
2. **24/7 chatbot** — removes `isBusinessHours()` gate from LINE Shop chatbot so the bot responds at all hours
3. **AI Persona viewer** — new `GET /ai-settings/persona` endpoint + `AiPersonaPage.tsx` (read-only, prompts in-code for Phase A)
4. **Quotes + Drafts module removal** — deletes `QuotesModule`, `DraftsModule` from API + corresponding pages from frontend
5. **OWNER menu restructure** — moves Dashboard/CRM/Todos out of SHOP zone; adds `owner-fin-collection` section; reorders finance groups
6. **Large docs additions** — `plans/2026-05-19-insurance-repair-ticket.md` (4,762 lines), shop-finance-legal-split plans, Phase 2 roadmaps

## Files Changed (34 files)

### Backend API
| File | Change |
|------|--------|
| `apps/api/src/modules/ai-settings/ai-settings.controller.ts` | `+GET /ai-settings/persona` endpoint |
| `apps/api/src/modules/drafts/` (4 files) | **Deleted** — drafts.controller, .service, .module, .spec |
| `apps/api/src/modules/quotes/` (7 files) | **Deleted** — entire quotes module (controller, service, module, DTOs, template, spec) |
| `apps/api/src/modules/line-oa/line-oa-chatbot.controller.ts` | Removes `isBusinessHours()` + outside-hours auto-reply block |
| `apps/api/src/app.module.ts` | Removes `QuotesModule` + `DraftsModule` registrations |
| `apps/api/prisma/schema.prisma` | Removes Quote + related models (-73 lines) |

### Frontend
| File | Change |
|------|--------|
| `apps/web/src/pages/AiPersonaPage.tsx` | **New** — AI persona viewer (read-only) |
| `apps/web/src/pages/AiSettingsPage.tsx` | Minor updates |
| `apps/web/src/pages/QuotesPage.tsx` (785 lines) | **Deleted** |
| `apps/web/src/pages/DraftsPage.tsx` (183 lines) | **Deleted** |
| `apps/web/src/pages/QuotesPage.test.tsx` | **Deleted** |
| `apps/web/src/pages/DraftsPage.test.tsx` | **Deleted** |
| `apps/web/e2e/sp5-shop-additions.spec.ts` | **Deleted** (63 lines removed) |
| `apps/web/src/config/menu.ts` | Large restructure across all role configs |
| `apps/web/src/App.tsx` | Remove /quotes + /drafts routes; add /settings/ai-persona |
| `apps/web/src/config/menu.test.ts` | Updated for new menu structure |

### Docs (large, non-code)
| File | Change |
|------|--------|
| `docs/plans/2026-05-19-insurance-repair-ticket.md` | New (4,762 lines) |
| `docs/plans/2026-05-19-shop-finance-legal-split.md` | New (1,602 lines) |
| `docs/specs/2026-05-18-phase-2-csv-completion-roadmap.md` | New (161 lines) |
| `docs/designs/2026-05-19-insurance-repair-ticket-design.md` | New (753 lines) |
| `docs/designs/2026-05-19-shop-finance-legal-split-design.md` | New (812 lines) |

---

## Issues Found

### Critical
_None_

### Warning

**[WARN-1] Quotes + Drafts module hard-deletion — data loss risk if data exists in prod**

The branch permanently deletes `QuotesModule` and `DraftsModule` (backend services, controllers, Prisma models, DTOs, tests, frontend pages) and removes the `Quote` model from `schema.prisma`. If any Quote or Draft records exist in the production database, `prisma migrate deploy` will fail or data will be orphaned.

- **Check before merging**: `SELECT COUNT(*) FROM quotes WHERE deleted_at IS NULL;` and `SELECT COUNT(*) FROM draft_documents;` (or equivalent) on prod DB.
- The Prisma migration will need to `DROP TABLE` for these tables. If records exist, a data-export step is required before the migration runs.
- The quotes spec had 462 lines of tests — their deletion removes coverage that was passing.

**[WARN-2] Business-hours gate removal — chatbot will now respond 24/7 without customer notification update**

`isBusinessHours()` and the outside-hours auto-reply (`CHATBOT_RESPONSES.outsideHours`) are both deleted. The LINE Shop bot now responds to all messages at any hour. This is the stated intent ("24-7 AI"), but:
- Customers who previously received the "นอกเวลาทำการ" message now receive AI responses instead. The LINE OA config or welcome messages should be updated to remove references to business hours.
- If the AI cost tracking budget cap isn't wired up yet, 24/7 operation significantly increases Claude API spend with no ceiling.

### Info

**[INFO-1] `AiPersonaPage.tsx:56` — TypeScript `any` cast**

```ts
queryFn: () => api.get('/ai-settings/persona').then((r: any) => r.data),
```

Should use the typed `PersonaResponse` interface already defined in the same file:

```ts
queryFn: () => api.get<{ data: PersonaResponse }>('/ai-settings/persona').then((r) => r.data),
```

Low risk (display-only page), but `any` bypasses the TypeScript type safety on `PersonaResponse`.

**[INFO-2] Role mismatch: frontend route vs backend endpoint for `/settings/ai-persona`**

- **Frontend route** (`App.tsx`): `roles={['OWNER']}` — only OWNER sees the page
- **Backend `@Roles`**: `'OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER'` — those roles can call the API

BRANCH_MANAGER and FINANCE_MANAGER can call `GET /ai-settings/persona` directly but can't reach the UI page. This is not a security issue (backend is the authoritative guard) but may cause confusion. Either extend the frontend route to include those roles, or tighten the backend to OWNER-only. The prompts returned are read-only business configuration, so broader access is probably fine.

**[INFO-3] Deleted E2E spec `sp5-shop-additions.spec.ts`**

63 lines of E2E coverage deleted. Confirm the scenarios tested there are either covered by remaining specs or deliberately dropped (e.g., /quotes route no longer exists).

---

## Verification Points — New Code

- [x] `GET /ai-settings/persona` — class-level `@UseGuards(JwtAuthGuard, RolesGuard)` on `AiSettingsController`; method-level `@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')` ✅
- [x] `AiPersonaPage.tsx` uses `useQuery` + `api.get()` — correct ✅
- [x] `AiPersonaPage.tsx` — no hardcoded colors; uses `border-primary/30`, `bg-muted/50`, `text-foreground`, `border-border` design tokens ✅
- [x] `/settings/ai-persona` route wrapped in `<ProtectedRoute>` ✅
- [x] No `Number()` on financial fields in new code ✅
- [x] No `$queryRaw` usage in new code ✅
- [x] No hardcoded secrets ✅

## Verification Points — Deleted Code

- [x] `QuotesModule` + `DraftsModule` unregistered from `app.module.ts` — no dangling imports ✅
- [x] Route `/quotes` and `/drafts` removed from `App.tsx` ✅
- [x] Menu items for quotes/drafts removed from all 5 role configs ✅
- [x] `package-lock.json` updated (+134/-134 lines) — reflects dependency graph update ✅

---

## Pre-Merge Checklist (human action required)

- [ ] **[WARN-1]** Run `SELECT COUNT(*) FROM quotes;` on prod before deploying migration
- [ ] **[WARN-2]** Update LINE OA welcome message to remove business-hours references
- [ ] **[WARN-2]** Confirm AI cost tracking budget cap is active before 24/7 goes live
- [ ] **[INFO-1]** Fix `(r: any)` cast in `AiPersonaPage.tsx:56` (trivial 2-line fix)

---

## Recommendation: ⚠️ REVIEW

No critical security issues. Two warnings require human sign-off before merge:
- Confirm Quote/Draft data is safely migrated or confirmed empty in prod (WARN-1)
- Confirm 24/7 chatbot budget controls are in place (WARN-2)

INFO-1 (TypeScript any) is a trivial fix that can be done in-branch before merge.
