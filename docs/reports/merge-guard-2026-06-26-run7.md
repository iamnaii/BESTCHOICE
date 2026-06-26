# Pre-Merge Guard Report — 2026-06-26 (Run 7)

**Generated**: 2026-06-26  
**Reviewed branches**: 3 most-recently-updated non-guard branches  
**Total unmerged branches**: 464

---

## Branch 1: `chore/local-config-sync`

**Author**: iamnaii  
**Commit**: `9c920bda chore: pin Prisma VSCode extension to v6 + sync package-lock`  
**Files changed**: 2 (`.vscode/settings.json`, `package-lock.json`)

### Summary
- Adds `"prisma.pinToPrisma6": true` to VSCode settings to pin the Prisma extension to v6
- Removes `"peer": true` flags from 25 OS-specific `@esbuild/*` entries in `package-lock.json` (sync with npm version)

### Issues

| Severity | Count | Notes |
|----------|-------|-------|
| Critical | 0 | — |
| Warning  | 0 | — |
| Info     | 0 | — |

### Recommendation: ✅ APPROVE

Pure tooling/config sync. No production code changes. No security concerns.

---

## Branch 2: `chore/owner-mobile-settings-bar`

**Author**: iamnaii  
**Commit**: `9b79b49c refactor(menu): dedupe OWNER mobile settings bottom-bar (align with FM/ACC)`  
**Files changed**: 2 (`apps/web/src/config/menu.ts`, `apps/web/src/config/menu.test.ts`)

### Summary
Removes 4 redundant OWNER mobile bottom-nav shortcuts from the settings zone
(`/users`, `/settings/company/entities`, `/branches`, `/settings`) and replaces
them with a single `/contacts` shortcut — mirroring the FM/ACC layout.
Also removes the now-unused `UserCog` lucide-react import.
Adds a menu test asserting the new shape.

### Issues

| Severity | Count | Notes |
|----------|-------|-------|
| Critical | 0 | — |
| Warning  | 0 | — |
| Info     | 1 | See below |

**Info**
- The 4 removed shortcuts are still accessible via the drawer (เพิ่มเติม → sidebar), so no functionality is lost — this is a mobile UX dedupe, not a removal of access.

### Recommendation: ✅ APPROVE

Clean refactor with matching test coverage. Aligns OWNER mobile layout with FM/ACC. No logic regressions.

---

## Branch 3: `chore/doc-config-single-source`

**Author**: iamnaii  
**Commit**: `5154ee90 refactor(menu): remove ตั้งค่าเอกสาร from fin zone — single source in settings`  
**Files changed**: 2 (`apps/web/src/config/menu.ts`, `apps/web/src/config/menu.test.ts`)

### Summary
Removes two sidebar menu sections:
- `owner-doc-config` from OWNER's fin zone (previously pointed to `/settings/document-config` with child tabs — now lives exclusively in `settings › บัญชี & ภาษี`)
- `acc-doc-config` from ACCOUNTANT's fin zone (the linked page is OWNER-only; ACC would land on "ไม่มีสิทธิ์" — dead link removal)

Updates tests to match: asserts `owner-doc-config` is gone and ACC fin sections no longer include `acc-doc-config`.

### Issues

| Severity | Count | Notes |
|----------|-------|-------|
| Critical | 0 | — |
| Warning  | 0 | — |
| Info     | 1 | See below |

**Info**
- The `acc-doc-config` removal is strictly correct: the page enforces OWNER-only via `ProtectedRoute`, so ACC was seeing a link that would 403. Removing it improves UX without removing any real access.

### Recommendation: ✅ APPROVE

Removes a dead menu link for ACC (security enforced at page level was already correct) and deduplicates document-config from the OWNER fin sidebar. Single source of truth in settings panel is a net improvement. Test coverage updated.

---

## Summary

| Branch | Files | Critical | Warning | Recommendation |
|--------|-------|----------|---------|----------------|
| `chore/local-config-sync` | 2 | 0 | 0 | ✅ APPROVE |
| `chore/owner-mobile-settings-bar` | 2 | 0 | 0 | ✅ APPROVE |
| `chore/doc-config-single-source` | 2 | 0 | 0 | ✅ APPROVE |

**All 3 branches are safe to merge.** No security issues, no financial logic changes, no missing guards or validation. These are pure frontend menu/config refactors with test coverage.
