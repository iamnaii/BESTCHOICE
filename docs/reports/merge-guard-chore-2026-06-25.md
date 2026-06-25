# Pre-Merge Guard Report — 2026-06-25

**Run date**: 2026-06-25  
**Branches reviewed**: 3 genuine pending branches (449 total unmerged, 446 are stale post-squash-merge branches)  
**Reviewer**: Pre-Merge Guard (automated)

---

## Summary

| Branch | Commits Ahead | Author | Recommendation |
|--------|--------------|--------|---------------|
| `chore/local-config-sync` | 1 | iamnaii | ✅ APPROVE |
| `chore/owner-mobile-settings-bar` | 1 | iamnaii | ✅ APPROVE |
| `chore/doc-config-single-source` | 1 | iamnaii | ✅ APPROVE |

No Critical or Warning issues found across all three branches.

---

## Branch 1: `chore/local-config-sync`

**Commit**: `9c920bda` — chore: pin Prisma VSCode extension to v6 + sync package-lock  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Files changed**: 2 (`.vscode/settings.json`, `package-lock.json`)

### Changes
- `.vscode/settings.json`: Adds `"prisma.pinToPrisma6": true` — pins the Prisma VS Code extension to v6 to prevent auto-upgrade to v7+
- `package-lock.json`: Removes `"peer": true` from 25 platform-specific esbuild binary packages (npm lockfile sync)

### Issues Found
None.

### Recommendation: ✅ APPROVE

---

## Branch 2: `chore/owner-mobile-settings-bar`

**Commit**: `9b79b49c` — refactor(menu): dedupe OWNER mobile settings bottom-bar (align with FM/ACC)  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Files changed**: 2 (`apps/web/src/config/menu.ts`, `apps/web/src/config/menu.test.ts`)

### Changes
Replaces OWNER mobile settings bottom-bar from 4 items:
```
ผู้ใช้/พนักงาน → /users
บริษัท → /settings/company/entities
สาขา → /branches
ตั้งค่า → /settings
```
…down to 2 items that align with the FM/ACC pattern:
```
ผู้ติดต่อ → /contacts
เพิ่มเติม → #more (drawer)
```

All removed links are still accessible via the settings submenu drawer. Test added to verify the deduplication.

### Security Check
- No new controllers or API endpoints
- No `ProtectedRoute` changes
- No auth logic touched
- `/contacts` already guarded by `ProtectedRoute roles={['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT']}` (merged in PR #1291)

### Issues Found
None.

### Recommendation: ✅ APPROVE

---

## Branch 3: `chore/doc-config-single-source`

**Commit**: `5154ee90` — refactor(menu): remove ตั้งค่าเอกสาร from fin zone — single source in settings  
**Author**: iamnaii <akenarin.ak@gmail.com>  
**Files changed**: 2 (`apps/web/src/config/menu.ts`, `apps/web/src/config/menu.test.ts`)

### Changes
Removes two duplicate menu sections:
- `owner-doc-config` from OWNER fin zone (34 lines — links to `/settings/document-config?tab=*` sub-items)
- `acc-doc-config` from ACCOUNTANT fin zone (9 lines — link to `/settings/document-config` that was OWNER-only anyway, per the comment in the removed code)

Single source of truth is now `/settings/document-config` under the settings panel (accounting category).

### Info
The removed `acc-doc-config` section had a comment noting the page was OWNER-only but ACCOUNTANTs could still see the menu link (they'd get an access-denied view on click). Removing this link is a **UX improvement** — it stops presenting ACC users with a broken navigation shortcut. Security is enforced server-side and via `ProtectedRoute` on the page itself; this change has no security impact.

### Issues Found
None.

### Recommendation: ✅ APPROVE

---

## Notes on Other Branches

Of the 449 total unmerged branches, the vast majority fall into these categories:

1. **Stale post-merge branches** — branches whose work was squash-merged into `main` under a different commit ID. The branch still shows as "ahead" because git cannot detect content identity across squash merges. Examples:
   - `feat/settings-ia-redesign-p3p4` → merged as PR #1289
   - `feat/settings-sidebar-driven-nav` → merged as PR #1290
   - `feat/settings-contacts-standalone` → merged as PR #1291

2. **Large stale feature branches** (150–2600 commits ahead) — branches that diverged months ago and have not been rebased/updated. These represent either abandoned work or work-in-progress that predates many main merges.

3. **`chore/deps-tier3-*` series** — 10+ dependency upgrade branches; not reviewed in this run.

The 3 branches reviewed above were the only genuinely new pending commits from 2026-06-24 by the primary author.
