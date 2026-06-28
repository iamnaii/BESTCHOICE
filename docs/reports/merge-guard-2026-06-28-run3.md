# Pre-Merge Guard Report — 2026-06-28 (run 3)

**Generated**: 2026-06-28  
**Reviewer**: Pre-Merge Guard Agent  
**Branches reviewed**: 5 (top active, excluding prior guard/watchdog branches)

---

## Summary

All 5 open branches are **frontend-only menu/config refactors** — part of a chained Settings IA consolidation sprint. No backend changes, no security-sensitive code paths, no financial logic touched.

| Branch | Commits | Files | Recommendation |
|--------|---------|-------|----------------|
| `chore/stale-contacts-comments` | 1 | 2 | ✅ APPROVE |
| `chore/dedupe-fin-zone-settings` | 1 | 2 | ✅ APPROVE |
| `chore/doc-config-single-source` | 1 | 2 | ✅ APPROVE |
| `chore/owner-mobile-settings-bar` | 1 | 2 | ✅ APPROVE |
| `chore/local-config-sync` | 1 | 2 | ✅ APPROVE |

**Chain order** (each builds on the previous, merge in order):
1. `chore/stale-contacts-comments` → base
2. `chore/dedupe-fin-zone-settings`
3. `chore/doc-config-single-source`
4. `chore/owner-mobile-settings-bar`
5. `chore/local-config-sync` → tip

---

## Branch Details

### 1. `chore/stale-contacts-comments`
**Commit**: `568c6614` — chore(settings): refresh stale '/settings#contacts' comment examples  
**Files**: `Sidebar.tsx`, `menu.ts`

Updates 2 comment strings from the old hash-based path (`/settings#contacts`) to a current example (`/settings/accounting#vat`). Pure doc/comment change — no logic altered.

**Issues**: None  
**Recommendation**: ✅ APPROVE

---

### 2. `chore/dedupe-fin-zone-settings`
**Commit**: `aec07a07` — refactor(menu): dedupe fin-zone sidebar links that duplicate the settings submenu  
**Files**: `menu.ts`, `menu.test.ts`

Removes the `owner-fin-integrations` sidebar section (LINE OA + การเชื่อมต่อ links) from the fin-zone OWNER menu — both items already live in the settings submenu. Also removes ผังบัญชี and PEAK Sync from the fin-zone ACC/OWNER sidebar for the same reason. Test updated to assert absence instead of presence.

**Issues**: None  
**Recommendation**: ✅ APPROVE

---

### 3. `chore/doc-config-single-source`
**Commit**: `5154ee90` — refactor(menu): remove ตั้งค่าเอกสาร from fin zone — single source in settings  
**Files**: `menu.ts`, `menu.test.ts`

Removes `owner-doc-config` and `acc-doc-config` sidebar sections from fin zone. The doc-config page (`/settings/document-config`) is OWNER-only — the old ACC link was landing on a 403 page. Cleanup removes the dead link for ACC and the duplicate for OWNER. Test updated accordingly.

**Issues**: None  
**Recommendation**: ✅ APPROVE

---

### 4. `chore/owner-mobile-settings-bar`
**Commit**: `9b79b49c` — refactor(menu): dedupe OWNER mobile settings bottom-bar (align with FM/ACC)  
**Files**: `menu.ts`, `menu.test.ts`

Aligns OWNER's mobile bottom-bar for the settings zone with FM/ACC pattern. Removes 4 duplicate shortcuts (`/users`, `/branches`, `/settings/company/entities`, `/settings`) that already live inside the settings submenu. Keeps `/contacts` as the one quick-access link. Test asserts the deduped paths are absent and `/contacts` is present.

**Issues**: None  
**Recommendation**: ✅ APPROVE

---

### 5. `chore/local-config-sync`
**Commit**: `9c920bda` — chore: pin Prisma VSCode extension to v6 + sync package-lock  
**Files**: `.vscode/settings.json`, `package-lock.json`

Adds `"prisma.pinToPrisma6": true` to VSCode workspace settings to prevent the extension from auto-upgrading to Prisma 7. Removes `"peer": true` flags from 25 platform-specific esbuild entries in `package-lock.json` (npm lockfile normalization — no version changes).

**Issues**: None  
**Recommendation**: ✅ APPROVE

---

## Critical Issues Found: 0
## Warning Issues Found: 0
## Info Issues Found: 0

All branches are clean. No security concerns, no financial-logic changes, no missing guards, no Decimal/money issues. Safe to merge in chain order.
