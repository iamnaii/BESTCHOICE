# Pre-Merge Guard Report — 2026-04-13

> Automated quality review of open branches against `origin/main`.
> Reviewed 3 branches (top by TypeScript diff size, skipping guard/reports/watchdog branches).

---

## Summary

| Branch | Files Changed | Recommendation |
|--------|--------------|----------------|
| `feat/chatbot-production-ready` | 16 files (734+/313−) | **BLOCK** |
| `chore/deps-tier3-chunk6-tailwind4` | 126 TS/TSX files | **REVIEW** |
| `chore/deps-tier3-chunk9-react-router7` | ~35 TS/TSX files | **APPROVE** |

---

## Branch 1: `feat/chatbot-production-ready`

**Author:** iamnaii <akenarin.ak@gmail.com>
**Commits:**
```
72a6fcce feat(chatbot): production-ready — feedback Quick Reply, admin prompt editor, KB seed, remove CHATCONE
```

### What Changed
- Added LINE postback handler for thumbs-up/down feedback (`FeedbackService`)
- Added `SystemPromptEditor` component in `ChatbotFinanceKnowledgePage.tsx` (admin can edit bot system prompt)
- Added `POST /admin/knowledge/seed` endpoint to seed default KB entries
- Added `UpdatePromptDto` with proper class-validator decorators
- Added `FinanceConfigService.getSystemPrompt/updateSystemPrompt/resetSystemPrompt`
- Added `FinanceAiService` in-memory prompt cache (5-min TTL)
- Removed entire `ChatconeModule` (unimplemented scaffold)
- Removed `ChatconeModule` from `AppModule`

---

### CRITICAL Issues (must fix before merge)

#### C-001 — Missing backend prompt management endpoints

**Severity:** Critical  
**File:** `apps/api/src/modules/chatbot-finance/chatbot-finance-admin.controller.ts`

The `SystemPromptEditor` frontend component makes three API calls that have **no corresponding backend routes**:

```
GET  /chatbot/finance/admin/prompt      → 404 (endpoint missing)
PUT  /chatbot/finance/admin/prompt      → 404 (endpoint missing)
POST /chatbot/finance/admin/prompt/reset → 404 (endpoint missing)
```

The backend infrastructure exists (`FinanceConfigService.getSystemPrompt/updateSystemPrompt/resetSystemPrompt`, `UpdatePromptDto`, `FinanceAiService.invalidatePromptCache`) but was never wired into the controller.

**Impact:** The System Prompt Editor UI will silently fail — all three calls return 404 at runtime. The feature is broken for OWNER/FINANCE_MANAGER users.

**Fix required:** Add these endpoints to `chatbot-finance-admin.controller.ts`:

```typescript
@Get('prompt')
@Roles('OWNER', 'FINANCE_MANAGER')
async getPrompt() {
  const prompt = await this.financeConfig.getSystemPrompt();
  const defaultPrompt = this.financeConfig.getDefaultSystemPrompt();
  return { prompt, defaultPrompt, isCustom: prompt !== defaultPrompt };
}

@Put('prompt')
@Roles('OWNER')
async updatePrompt(@Body() dto: UpdatePromptDto) {
  await this.financeConfig.updateSystemPrompt(dto.prompt);
  this.ai.invalidatePromptCache();
  return { ok: true };
}

@Post('prompt/reset')
@HttpCode(200)
@Roles('OWNER')
async resetPrompt() {
  await this.financeConfig.resetSystemPrompt();
  this.ai.invalidatePromptCache();
  return { ok: true };
}
```

Also inject `FinanceConfigService` and `FinanceAiService` into the controller constructor, and update the JSDoc route list at the top of the file.

---

### WARNING Issues (should fix)

#### W-001 — `systemConfig.findUnique` missing `deletedAt: null`

**File:** `apps/api/src/modules/chatbot-finance/services/finance-config.service.ts:107`

```typescript
// Current — returns soft-deleted configs
const config = await this.prisma.systemConfig.findUnique({
  where: { key: SYSTEM_CONFIG_KEYS.systemPrompt },
});
```

`SystemConfig` has `deletedAt DateTime?` in schema. A soft-deleted config entry with this key would still be returned. Should be:

```typescript
const config = await this.prisma.systemConfig.findFirst({
  where: { key: SYSTEM_CONFIG_KEYS.systemPrompt, deletedAt: null },
});
```

Note: `findUnique` cannot filter on `deletedAt` with a non-unique `where` clause — switch to `findFirst`.

#### W-002 — Duplicate KB seed logic

**Files:**
- `apps/api/prisma/seeds/knowledge-base.ts` (new file, 42 lines)
- `apps/api/src/modules/chatbot-finance/services/knowledge.service.ts:142–187`

The same idempotent seed loop is duplicated verbatim in both files. If the seed data or creation logic changes, both must be updated. The `seedDefaults()` service method should be extracted and the seed script should delegate to it (or vice versa).

---

### INFO

#### I-001 — Fragile `__MSG_ID__` placeholder pattern

**File:** `apps/api/src/modules/chatbot-finance/services/chatbot-finance.service.ts:357`

```typescript
data: `action=feedback&rating=1&sessionId=${sessionId}&messageId=__MSG_ID__`,
```

The `__MSG_ID__` string is replaced via `String.replace('__MSG_ID__', savedMsg.id)` after saving. Since `savedMsg.id` is a UUID (safe characters only), this is currently harmless. However, the pattern is fragile — document it with a comment or consider using a structured approach.

#### I-002 — `UpdatePromptDto` defined but unused (until C-001 is fixed)

**File:** `apps/api/src/modules/chatbot-finance/dto/admin.dto.ts:40`

`UpdatePromptDto` is exported but not imported anywhere until the missing endpoints are added. TypeScript will not complain but linters may flag it.

---

### Positive Findings
- All new controller endpoints have proper `@UseGuards(JwtAuthGuard, RolesGuard)` at class level and `@Roles()` per method
- All 3 frontend mutations (`saveMutation`, `resetMutation`, `seedMutation`) call `queryClient.invalidateQueries` in `onSuccess`
- `chatKnowledgeBase.findFirst` correctly includes `deletedAt: null`
- `UpdatePromptDto` has proper Thai validation messages and length guards
- `FeedbackService` injection follows DI patterns correctly
- Removing the unimplemented `ChatconeModule` scaffold is a clean housekeeping change

---

## Branch 2: `chore/deps-tier3-chunk6-tailwind4`

**Commits:** 5 commits (same tip as `origin/main` base — all work on top of current main)

### What Changed
- Tailwind CSS v3 → v4 upgrade
- 126 TS/TSX files with CSS class syntax changes:
  - `outline-none` → `outline-hidden`
  - `focus:outline-none` → `focus:outline-hidden`  
  - `focus:ring-offset-2` → `focus-visible:ring-offset-2`
  - `data-[state=open]:...` patterns updated for v4
  - `backdrop-blur-sm` → `backdrop-blur-xs` in some components
  - New `**:data-[slot=...]` variant syntax for nested element targeting
- `apps/web/vite.config.ts`: Tailwind v4 Vite plugin configuration

### Security Issues
None found. No logic changes, guards, or data access patterns were modified.

### Warning Issues

#### W-001 — Requires visual regression testing

Tailwind v4 has breaking changes in several utility classes. The class renames appear systematic and correct, but visual regression testing is strongly recommended — automated TypeScript checks will not catch styling regressions.

**Risk areas to test manually:**
- Dark mode (new `dark:` variant behavior changed)
- Focus ring visibility (changed from `ring-2` to `ring-1` in some form inputs)
- Backdrop blur on modals/overlays
- Sidebar active state indicators

### Recommendation: REVIEW
No code quality or security issues. Requires manual UI smoke test before merge. Run E2E suite and visually verify key pages (Login, POS, Contracts, Dashboard) in both light/dark mode.

---

## Branch 3: `chore/deps-tier3-chunk9-react-router7`

**Commits:**
```
8a7e4797 chore(web): bump react ^18.3.0 → ^19.2.5 — Tier 3 chunk 5
```
*(Note: commit message references React 19, but this branch is the router upgrade)*

### What Changed
- React Router v7: `react-router-dom` → `react-router` (v7 merged the two packages)
- ~35 files updated, all mechanical import path renames:
  ```typescript
  // Before
  import { Routes, Route } from 'react-router-dom';
  // After  
  import { Routes, Route } from 'react-router';
  ```
- Files affected: `App.tsx`, `main.tsx`, all layout components, all pages using `useNavigate/useParams/Link`

### Security Issues
None.

### Warning Issues
None. This is a purely mechanical rename — React Router v7 is API-compatible with v6 (the DOM-specific exports were merged into the main package).

### Recommendation: APPROVE
Safe to merge. Run `npm run build` to confirm no missing import errors. E2E login + navigation smoke test recommended.

---

## Additional Branches (not fully reviewed)

The following branches also exist on remote but had **no TypeScript diff against main** (contents already present in `origin/main` via force-push or merge):

| Branch | Status |
|--------|--------|
| `feat/accounting-audit-fixes` | Appears merged (0 TS diff vs main) |
| `feature/chatbot-finance` | Appears merged (0 TS diff vs main) |
| `chore/quickbuy-step1-reorder` | Appears merged (0 TS diff vs main) |
| `E2E-TEST` | Appears merged (0 TS diff vs main) |
| `claude/*` branches (8x) | Appears merged (0 TS diff vs main) |

These branches should be cleaned up from remote (`git push origin --delete <branch>`) to reduce clutter.

---

## Action Items

| Priority | Action | Branch | Owner |
|----------|--------|--------|-------|
| P0 | Add 3 missing prompt API endpoints to admin controller | `feat/chatbot-production-ready` | iamnaii |
| P0 | Fix `systemConfig.findUnique` → `findFirst` with `deletedAt: null` | `feat/chatbot-production-ready` | iamnaii |
| P1 | Deduplicate KB seed logic | `feat/chatbot-production-ready` | iamnaii |
| P1 | Visual regression test Tailwind v4 changes | `chore/deps-tier3-chunk6-tailwind4` | — |
| P2 | Run E2E smoke test for React Router v7 | `chore/deps-tier3-chunk9-react-router7` | — |
| P3 | Clean up stale merged branches from remote | all | iamnaii |
