# Pre-Merge Guard Report — 2026-06-28

**Run time**: 2026-06-28 UTC  
**Branches scanned**: 5 (of 477 unmerged; filtered to those with valid merge-base against `main`)  
**Author**: iamnaii <akenarin.ak@gmail.com> (all branches)

---

## Branches Reviewed

> The 470+ remaining unmerged branches are historical worktrees, orphaned guard/watchdog
> branches, and deps-upgrade experiments — none with a valid merge-base against `main`.
> Five real chore branches have a proper ancestor: all 5 are reviewed here.

### 1. `chore/local-config-sync`
**Commit**: `9c920bd` — chore: pin Prisma VSCode extension to v6 + sync package-lock  
**Files**: `.vscode/settings.json` (+1 line), `package-lock.json` (-25 lines)

**Changes**:
- Adds `"prisma.pinToPrisma6": true` to VSCode workspace settings
- Removes `"peer": true` flags from 25 lockfile entries (npm version normalisation)

**Issues**: None  
**Verdict**: ✅ **APPROVE**

---

### 2. `chore/owner-mobile-settings-bar`
**Commit**: `9b79b49` — refactor(menu): dedupe OWNER mobile settings bottom-bar (align with FM/ACC)  
**Files**: `apps/web/src/config/menu.test.ts` (+10 lines), `apps/web/src/config/menu.ts` (+/−9 lines)

**Changes**:
- OWNER mobile bottom-nav `settings` slot: replaced 4 duplicate shortcuts
  (`/users`, `/branches`, `/settings/company/entities`, `/settings`) with
  `/contacts` + `#more` — aligned with FM/ACC pattern
- Removes unused `UserCog` import
- Adds a `menu.test.ts` assertion verifying the removed paths are gone

**Issues**: None  
**Verdict**: ✅ **APPROVE**

---

### 3. `chore/doc-config-single-source`
**Commit**: `5154ee9` — refactor(menu): remove ตั้งค่าเอกสาร from fin zone — single source in settings  
**Files**: `apps/web/src/config/menu.test.ts` (+/−8 lines), `apps/web/src/config/menu.ts` (−53 lines net)

**Changes**:
- Removes `owner-doc-config` section from OWNER FIN-zone sidebar (42-line block with
  nested doc-type children). The canonical location is `settings › บัญชี & ภาษี`.
- Removes `acc-doc-config` section from ACCOUNTANT FIN-zone sidebar. The page is
  OWNER-only at the route level; the sidebar link was misleading for ACCOUNTANTs
  (they would see a 403 view).
- Updates `menu.test.ts` to assert `not.toContain` for the removed keys.

**Security note (Info)**: Removing a dead sidebar link that led to a 403 for ACCOUNTANTs
is a correctness improvement — the route-level guard remains unchanged and is the
real enforcement mechanism. No regression risk.

**Issues**: None  
**Verdict**: ✅ **APPROVE**

---

### 4. `chore/dedupe-fin-zone-settings`
**Commit**: `aec07a0` — refactor(menu): dedupe fin-zone sidebar links that duplicate the settings submenu  
**Files**: `apps/web/src/config/menu.test.ts` (+3 lines), `apps/web/src/config/menu.ts` (−29 lines net)

**Changes**:
- Removes `owner-fin-integrations` section (LINE OA + การเชื่อมต่อ) — both items
  already live under `settings › สื่อสารลูกค้า` and `settings › เชื่อมต่อ`
- Removes ผังบัญชี link from `owner-bank` section; renames section label to
  "บัญชีธนาคาร/เงินสด" (ผังบัญชี lives in `settings › บัญชี & ภาษี`)
- Removes Dunning link from `owner-fin-notifications` (Dunning in `settings › สื่อสารลูกค้า`)
- Removes ผังบัญชี + PEAK Sync from ACCOUNTANT's fin section; fixes section label
  "ผังบัญชี + ธนาคาร" → "ธนาคาร"
- Updates test to `not.toContain('owner-fin-integrations')`

**Issues**: None  
**Verdict**: ✅ **APPROVE**

---

### 5. `chore/stale-contacts-comments`
**Commit**: `568c661` — chore(settings): refresh stale '/settings#contacts' comment examples  
**Files**: `apps/web/src/components/layout/Sidebar.tsx` (1 line), `apps/web/src/config/menu.ts` (1 line)

**Changes**:
- Updates a JSDoc comment example from `/settings#contacts` → `/settings/accounting#vat`
  (the old path was a stale artefact from before contacts was moved out of settings)
- Matching comment fix in `Sidebar.tsx`

**Issues**: None  
**Verdict**: ✅ **APPROVE**

---

## Summary

| Branch | Files Changed | Critical | Warning | Info | Verdict |
|--------|--------------|----------|---------|------|---------|
| `chore/local-config-sync` | 2 | 0 | 0 | 0 | ✅ APPROVE |
| `chore/owner-mobile-settings-bar` | 2 | 0 | 0 | 0 | ✅ APPROVE |
| `chore/doc-config-single-source` | 2 | 0 | 0 | 1* | ✅ APPROVE |
| `chore/dedupe-fin-zone-settings` | 2 | 0 | 0 | 0 | ✅ APPROVE |
| `chore/stale-contacts-comments` | 2 | 0 | 0 | 0 | ✅ APPROVE |

\* Info: ACC sidebar link to OWNER-only page removed — correctness improvement, not a regression.

**No critical or blocking issues found across all 5 branches.**  
All branches are pure UI menu/config deduplication — no controllers, no financial logic, no DTOs, no Prisma queries touched.
