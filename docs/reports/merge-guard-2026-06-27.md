# Pre-Merge Guard Report — 2026-06-27

**Run date**: 2026-06-27  
**Branches reviewed**: 3 most recently updated non-guard branches  
**Reviewer**: Pre-Merge Guard (automated)

---

## Branch 1: `chore/local-config-sync`

**Author**: iamnaii (akenarin.ak@gmail.com)  
**Commit**: `9c920bda` — chore: pin Prisma VSCode extension to v6 + sync package-lock  
**Date**: 2026-06-24 16:47 +0700

### Files Changed
| File | Change |
|------|--------|
| `.vscode/settings.json` | +1 line (`prisma.pinToPrisma6: true`) |
| `package-lock.json` | -25 lines (removed `"peer": true` flags from platform packages) |

### Issues

None found.

### Notes
- Config-only change. VSCode extension pin prevents accidental upgrade to Prisma v7 before the project is ready.
- `package-lock.json` change removes redundant `"peer": true` markers — cosmetic diff from npm version sync.

### Recommendation: ✅ APPROVE

---

## Branch 2: `chore/owner-mobile-settings-bar`

**Author**: iamnaii (akenarin.ak@gmail.com)  
**Commit**: `9b79b49c` — refactor(menu): dedupe OWNER mobile settings bottom-bar (align with FM/ACC)  
**Date**: 2026-06-24 16:23 +0700

### Files Changed
| File | Change |
|------|--------|
| `apps/web/src/config/menu.ts` | Removed 4 shortcuts from OWNER settings bottom-bar, added `/contacts` |
| `apps/web/src/config/menu.test.ts` | +10 lines — new test asserting deduplication |

### Issues

**Info**: `menu.ts` is 953 lines — approaching a size where splitting by zone/role would aid navigation. Not blocking.

No critical or warning issues.

### Notes
- Removed `/users`, `/settings/company/entities`, `/branches`, `/settings` from OWNER mobile bottom-bar.
- Replaced with single `/contacts` shortcut (aligned with FM/ACC pattern).
- `UserCog` lucide import correctly removed alongside the usage.
- New test covers the deduplication assertion (`expect(paths).not.toContain(...)` pattern is consistent with existing tests).
- No backend/API changes, no auth/guard impact.

### Recommendation: ✅ APPROVE

---

## Branch 3: `chore/doc-config-single-source`

**Author**: iamnaii (akenarin.ak@gmail.com)  
**Commit**: `5154ee90` — refactor(menu): remove ตั้งค่าเอกสาร from fin zone — single source in settings  
**Date**: 2026-06-24 16:07 +0700

### Files Changed
| File | Change |
|------|--------|
| `apps/web/src/config/menu.ts` | -54 lines — removed `owner-doc-config` section + `acc-doc-config` section |
| `apps/web/src/config/menu.test.ts` | Tests updated to assert the sections are gone, not present |

### Issues

**Info**: `menu.ts` is 954 lines — same note as Branch 2.

No critical or warning issues.

### Notes
- `owner-doc-config` zone (fin zone, OWNER) was a duplicate of `/settings/document-config` — now removed.
- `acc-doc-config` section for ACCOUNTANT removed — document-config is OWNER-only, so ACCOUNTANT was seeing a nav link that 403'd. Correct fix.
- Tests updated correctly: `toContain` → `not.toContain` for the removed sections.
- No backend/API changes, no auth/guard impact.

### Recommendation: ✅ APPROVE

---

## Summary

| Branch | Critical | Warning | Info | Recommendation |
|--------|----------|---------|------|----------------|
| `chore/local-config-sync` | 0 | 0 | 0 | ✅ APPROVE |
| `chore/owner-mobile-settings-bar` | 0 | 0 | 1 (menu.ts size) | ✅ APPROVE |
| `chore/doc-config-single-source` | 0 | 0 | 1 (menu.ts size) | ✅ APPROVE |

All three branches are safe to merge. They are small, focused frontend/config chores with tests and no security-sensitive changes.
