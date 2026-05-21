# Pre-Merge Guard Report — 2026-05-21

Generated: 2026-05-21 (today)
Reviewed branches: 3 most-recently-pushed unmerged branches (from 562 total)

---

## Branch 1 — `feat/persona-tone-tweaks`

**Author:** Akenarin Kongdach  
**Pushed:** ~53 minutes ago  
**Commits:** 1 (`b070f74e`)  
**Changes:** 1 file changed, 27 insertions, 3 deletions

### File Changes
```
apps/api/src/modules/staff-chat/prompts/sales-persona.ts  | 30 ++++++--
```

### Summary
Pure content edit to the Thai-language AI persona constants — no code logic changed:
- Added "ใช้คำว่า 'สนใจ' แทน 'อยากได้'" rule
- Tightened the "ask one question at a time" example
- Added new list-formatting section with `❌ / ✅` examples

### Issues Found

| Severity | Issue | Location |
|----------|-------|----------|
| — | None | — |

### Recommendation: ✅ **APPROVE**

No code logic changed. Text-only persona prompt edits, no security surface.

---

## Branch 2 — `feat/ai-persona-editor`

**Author:** Akenarin Kongdach  
**Pushed:** ~2 hours ago  
**Commits:** 1 (`ceefc339`)  
**Changes:** 15 files, +942 / -67

### File Changes Summary
```
apps/api/src/modules/ai-settings/ai-settings.controller.ts    | 34 ++++++++
apps/api/src/modules/ai-settings/ai-settings.module.ts        |  7 ++
apps/api/src/modules/sales-bot/prompts/sales-bot.system.ts    | 13 --- (deleted)
apps/api/src/modules/sales-bot/sales-bot.service.spec.ts      | 14 +++
apps/api/src/modules/sales-bot/sales-bot.service.ts           | 11 +++
apps/api/src/modules/staff-chat/dto/ai-settings.dto.ts        | 44 ++++++++++
apps/api/src/modules/staff-chat/prompts/sales-persona.ts      | 32 ++++++++
apps/api/src/modules/staff-chat/services/__tests__/*          | 19 +++
apps/api/src/modules/staff-chat/services/ai-auto-reply.service.spec.ts | 116 ++++++++
apps/api/src/modules/staff-chat/services/ai-auto-reply.service.ts      |  46 +++++++
apps/api/src/modules/staff-chat/services/ai-suggest.service.ts         |   3 +-
apps/api/src/modules/staff-chat/services/persona.service.spec.ts       | 187 +++++ (new)
apps/api/src/modules/staff-chat/services/persona.service.ts            | 136 +++++ (new)
apps/api/src/modules/staff-chat/staff-chat.module.ts           |   4 +-
apps/web/src/pages/AiPersonaPage.tsx                           | 258 ++++++---
```

### Feature Overview
Promotes the AI persona from a read-only code constant to a DB-backed override editable
by the OWNER from `/settings/ai-persona`. Key design:

- **Two editable layers**: `BASE` (identity + tone, used by AiSuggest + SalesBot) and
  `BOT_EXTRAS` (tool-use playbook, SalesBot only)
- **`PersonaService`** — reads `SystemConfig` with 60s in-memory cache + hardcoded fallback;
  `empty-string → revert (soft-delete row)`, `null/undefined → skip`
- **`AiAutoReplyService.updateSettings`** — handles the new DTO fields; calls
  `personaService.invalidateCache()` so changes take effect immediately
- **Frontend**: `EditablePersonaCard` with inline lint warnings (placeholder detection,
  required-tool-name check), char counter, confirm dialog before revert, dirty-state guard

---

### Critical Issues: ✅ None

| Check | Result |
|-------|--------|
| `@UseGuards(JwtAuthGuard, RolesGuard)` on `AiSettingsController` | ✅ Present (class-level) |
| `@Roles()` on `getPersona` | ✅ `OWNER, BRANCH_MANAGER, FINANCE_MANAGER` |
| `@Roles()` on `updateSettings` (unchanged, existing) | ✅ `OWNER, FINANCE_MANAGER` |
| No new unguarded controllers | ✅ |
| `Number()` on monetary fields | ✅ Not applicable (no money fields in this feature) |
| `deletedAt: null` in new queries | ✅ `PersonaService.getField()` + `isCustomized()` both include `deletedAt: null` |
| Hardcoded secrets / API keys | ✅ None |
| Raw `$queryRaw` / SQL injection | ✅ None |
| Frontend uses `api.patch()` not raw `fetch()` | ✅ `AiPersonaPage.tsx:1175` |
| `queryClient.invalidateQueries()` after mutation | ✅ `AiPersonaPage.tsx:1179` |
| DTO validation decorators on new fields | ✅ `@IsOptional() @IsString() @MaxLength()` on both persona fields |

---

### Warning Issues

#### W1 — `maxChars` hardcoded in JSX instead of using DTO constants
**Location:** `apps/web/src/pages/AiPersonaPage.tsx` lines ~1358, ~1367

```tsx
maxChars={20000}    // should import PERSONA_BASE_MAX from DTO (or shared constants)
maxChars={30000}    // should import PERSONA_BOT_EXTRAS_MAX
```

The backend caps live in `apps/api/src/modules/staff-chat/dto/ai-settings.dto.ts` as
`PERSONA_BASE_MAX = 20_000` and `PERSONA_BOT_EXTRAS_MAX = 30_000`. These constants are not
in `packages/shared/` so they can't be imported directly by the frontend, but the JSX
duplicates the numbers instead of defining local constants. If the caps change, the
frontend char-counter won't track it and will mislead the owner.

**Fix:** Either move constants to `packages/shared/` or define named local constants at
the top of `AiPersonaPage.tsx`:
```ts
const PERSONA_BASE_MAX = 20_000;
const PERSONA_BOT_EXTRAS_MAX = 30_000;
```

#### W2 — No audit log when persona is saved or reverted
**Location:** `apps/api/src/modules/staff-chat/services/ai-auto-reply.service.ts` (persona block ~L581–L641)

When the owner saves/reverts a persona override, no `AuditLog` entry is written. Other
sensitive operations in this codebase (e.g. `CONFIG_CHANGED` for LLM provider toggle,
`PEAK_MAPPING_UPDATED` for chart changes) write audit logs. Changing the system prompt
injected into every customer conversation is arguably more security-sensitive than a
billing config change.

**Fix:** Add a `CONFIG_CHANGED` (or new `PERSONA_UPDATED`) AuditLog entry in the persona
block of `updateSettings`, recording which layer changed and whether it was an override or
a revert.

---

### Info Issues

#### I1 — `PERSONA_BASE_MAX` / `PERSONA_BOT_EXTRAS_MAX` not in `packages/shared/`
Both constants are defined only in the API DTO (`ai-settings.dto.ts`). If the frontend
ever needs to validate sizes without a network round-trip, moving them to
`packages/shared/constants.ts` would eliminate the duplication in W1 and any future
re-definitions.

#### I2 — In-memory cache is per-instance (expected, consistent with existing pattern)
`PersonaService.cachedBase/cachedExtras` is a per-process cache — same design as the
existing `LlmProviderRegistry.cached`. On Cloud Run with multiple replicas, a persona
save on replica A invalidates only replica A's cache; other replicas see the old value
for up to 60s. This is acceptable and consistent with the project's existing approach.
No action required.

#### I3 — `staff-chat.module.ts` providers/exports arrays are very long single lines
The `providers` array at `staff-chat.module.ts:1028` is now 250+ chars on one line.
Not a correctness concern but would benefit from multi-line formatting for readability.

---

### Recommendation: ⚠️ **REVIEW**

No critical blockers. Two warnings (W1 — easy 2-line fix; W2 — missing audit trail for
a security-sensitive action). W1 is low-risk but easy to fix before merge. W2 is the
more important gap: owner persona edits are functionally equivalent to a code deploy
that changes the AI's behavior for all customers, and that should be auditable.

Suggested merge order: fix W1 (local constant) + W2 (audit log) → merge.

---

## Branch 3 — `hotfix/dockerfile-remove-legacy-csv`

**Author:** Akenarin Kongdach  
**Pushed:** ~3 hours ago  
**Commits:** 1 (`4017d0d5`)  
**Changes:** 1 file changed, 3 insertions, 1 deletion

### File Changes
```
Dockerfile  | 4 +++-
```

### Summary
Removes a `COPY` statement that referenced `ข้อมูลโปรแกรมเขียว4-7-2026` — a legacy
data-dump folder deleted from the repo in PR #1048. Without this fix, `docker build`
fails because the build context no longer contains the folder. Replaces the dead `COPY`
with an explanatory comment.

### Issues Found

| Severity | Issue | Location |
|----------|-------|----------|
| — | None | — |

### Recommendation: ✅ **APPROVE**

Straightforward build-fix. The remaining `COPY` for `apps/api/scripts/import-legacy/data`
is still present and intentional (that folder still exists).

---

## Overall Summary

| Branch | Files | Verdict | Reason |
|--------|-------|---------|--------|
| `feat/persona-tone-tweaks` | 1 | ✅ APPROVE | Text-only persona prompt tweaks |
| `feat/ai-persona-editor` | 15 | ⚠️ REVIEW | Fix W1 (hardcoded maxChars) + W2 (missing audit log) before merge |
| `hotfix/dockerfile-remove-legacy-csv` | 1 | ✅ APPROVE | Removes dead COPY that breaks docker build |
