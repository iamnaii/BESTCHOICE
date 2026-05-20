# Merge Guard Report — feat/ai-relocate-and-24-7

**Date**: 2026-05-20  
**Branch**: `feat/ai-relocate-and-24-7`  
**Author**: Akenarin Kongdach  
**Latest commit**: `bd3c933e feat(ai): relocate AI menu to central settings + remove business-hours gate + add Persona viewer`

---

## File Changes Summary (TS/TSX only)

| File | Change | Notes |
|------|--------|-------|
| `apps/api/src/app.module.ts` | Modified | Remove `QuotesModule` + `DraftsModule` imports |
| `apps/api/src/modules/ai-settings/ai-settings.controller.ts` | Modified | Add `GET /ai-settings/persona` endpoint |
| `apps/api/src/modules/drafts/drafts.controller.ts` | **Deleted** | Module removed |
| `apps/api/src/modules/drafts/drafts.module.ts` | **Deleted** | Module removed |
| `apps/api/src/modules/drafts/drafts.service.ts` | **Deleted** | Module removed |
| `apps/api/src/modules/drafts/__tests__/drafts.service.spec.ts` | **Deleted** | Tests removed with module |
| `apps/api/src/modules/quotes/…` | **Deleted** | Module removed (controller, service, module, tests) |
| `apps/web/src/App.tsx` | Modified | Remove `/quotes` + `/drafts` routes; add `/settings/ai-persona` |
| `apps/web/src/config/menu.ts` | Modified | OWNER sidebar reorganised; remove Quotes+Drafts entries for all roles |
| `apps/web/src/pages/AiPersonaPage.tsx` | **New** | Read-only AI persona viewer (Phase A) |
| `apps/web/src/pages/AiSettingsPage.tsx` | Modified | Add `ChannelRoutingCard` display component |
| `apps/web/src/pages/DraftsPage.tsx` | **Deleted** | |
| `apps/web/src/pages/DraftsPage.test.tsx` | **Deleted** | |
| `apps/web/src/pages/QuotesPage.tsx` | **Deleted** | |
| `apps/web/src/pages/QuotesPage.test.tsx` | **Deleted** | |

**Total**: 34 files, ~8445 insertions (mostly docs), ~3485 deletions  
**Docs added**: 3 design/plan documents under `docs/superpowers/plans/`

---

## Analysis

### Security Checks — API Layer

**New endpoint**: `GET /ai-settings/persona` in `ai-settings.controller.ts`

```ts
@Controller('ai-settings')
@UseGuards(JwtAuthGuard, RolesGuard)   // ✓ guards present
export class AiSettingsController {
  @Get('persona')
  @Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')  // ✓ roles present
  getPersona() { … }
}
```

Guards and roles are correct. The endpoint returns AI system prompts verbatim — this is intentional (read-only persona viewer for admins).

**Deleted controllers** (`DraftsController`, `QuotesController`) had proper guards (`@UseGuards(JwtAuthGuard, RolesGuard, BranchGuard)`) — their removal does not leave any unguarded surface. ✓

### Security Checks — Frontend

- No raw `fetch()` calls. Uses `api.get()` from `@/lib/api`. ✓
- No `Number()` on money fields. ✓
- No hardcoded secrets. ✓
- No `$queryRaw` usage. ✓

---

## Issues Found

### Critical
_None_

### Warnings

**W1 — Role mismatch: `ProtectedRoute` vs. API endpoint for `/settings/ai-persona`**

`App.tsx` restricts the AI Persona page to `OWNER` only:
```tsx
<ProtectedRoute roles={['OWNER']}>
  <AiPersonaPage />
</ProtectedRoute>
```

But the backend allows `BRANCH_MANAGER` and `FINANCE_MANAGER` too:
```ts
@Roles('OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER')
getPersona() { … }
```

The frontend access control is correct and secure (only OWNER can reach the page). However, the broader API permission means BM/FM can call `GET /ai-settings/persona` directly via curl/Postman and retrieve the full AI system prompts. 

This is likely intentional (the endpoint was coded for future expansion), but it should be explicitly documented. If the system prompts are considered confidential business logic, restrict the backend to `OWNER` only as well for consistency.

**W2 — `/quotes` and `/drafts` routes removed with no fallback redirect**

Both routes are completely dropped from `App.tsx` with no `<Navigate to="/" />` fallback. Any staff member who has bookmarked these URLs, or any internal link (Slack messages, shared links) pointing to `/quotes` or `/drafts`, will land on the app's catch-all "not found" state rather than a graceful redirect.

Suggested fix (minimal): add two `<Route>` entries that `<Navigate to="/" replace />` so old links degrade gracefully.

**W3 — TypeScript `any` in `AiPersonaPage.tsx:68`**

```tsx
queryFn: () => api.get('/ai-settings/persona').then((r: any) => r.data),
```

The `any` cast suppresses TypeScript's type-checking on the Axios response. The correct type is `AxiosResponse<PersonaResponse>`. This is a low-risk `any` but violates the project's TypeScript strictness convention.

Fix:
```tsx
queryFn: async () => {
  const res = await api.get<PersonaResponse>('/ai-settings/persona');
  return res.data;
},
```

### Info

**I1 — AI system prompt exposed via API**  
`getPersona()` returns `SHOP_SALES_PERSONA` and `FINANCE_BOT_SYSTEM_PROMPT` verbatim. These contain the full instructions for how each bot behaves, including business rules and response templates. Sharing these read-only with OWNER/BM/FM is intentional by design. Confirm with the owner that this is acceptable before merge.

**I2 — Large docs commit (8000+ lines)**  
3 design documents were included in the feature branch. They bulk up the diff but have no runtime impact. Consider landing docs in a separate `docs/` branch to keep feature PRs focused.

**I3 — `OWNER_CONFIG` sidebar reorganised**  
The OWNER menu now moves "Finance Overview" to the `fin` zone and adds a dedicated "ติดตามหนี้" top-level group. This is a significant UX restructure for the primary power user role. Recommend manual smoke-test of the OWNER sidebar before shipping.

---

## Recommendation

**REVIEW** ⚠️

Three warnings need resolution before merge:

1. **W1** — Decide whether BM/FM access to the persona API is intentional and document it (or restrict to OWNER-only on the backend).
2. **W2** — Add `<Navigate to="/" replace />` fallback routes for `/quotes` and `/drafts` to prevent silent 404s.
3. **W3** — Fix the `any` cast in `AiPersonaPage.tsx:68` to use `api.get<PersonaResponse>(...)`.

None of these are blockers for CI or data integrity, but W2 creates a user-facing regression (broken bookmarks) and W1 is a security posture question worth answering explicitly.
