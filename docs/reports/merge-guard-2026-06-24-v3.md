# Pre-Merge Guard Report — 2026-06-24 (Run v3)

**Date**: 2026-06-24  
**Agent**: Pre-Merge Guard (automated)  
**Total unmerged branches**: 442  
**Branches reviewed**: 3 most recently updated (non-guard/non-watchdog)

---

## Branch 1: `chore/local-config-sync`

**Author**: iamnaii  
**Last commit**: 2026-06-24 16:47 +0700  
**Commit**: `chore: pin Prisma VSCode extension to v6 + sync package-lock`

### File Changes
| File | +/- |
|------|-----|
| `.vscode/settings.json` | +1 line: `"prisma.pinToPrisma6": true` |
| `package-lock.json` | -25 lines: removes `"peer": true` flags from platform-specific binary entries |

### Security Checks
- No TypeScript/backend changes — all Critical checks N/A
- No money fields, no controllers, no DTOs, no queries

### Issues
**None found.**

### Recommendation: ✅ APPROVE

Config-only change. Safe to merge.

---

## Branch 2: `chore/owner-mobile-settings-bar`

**Author**: iamnaii  
**Last commit**: 2026-06-24 16:23 +0700  
**Commit**: `refactor(menu): dedupe OWNER mobile settings bottom-bar (align with FM/ACC)`

### File Changes
| File | +/- |
|------|-----|
| `apps/web/src/config/menu.ts` | -9/+5: removes 4 duplicate shortcuts from OWNER settings bottomNav |
| `apps/web/src/config/menu.test.ts` | +10: adds regression test |

### Change Summary
Removes 4 nav entries from OWNER mobile `settings` zone bottom-bar that duplicate items already accessible via the settings submenu drawer:
- `/users` (ผู้ใช้ / พนักงาน)
- `/settings/company/entities` (บริษัท)
- `/branches` (สาขา)
- `/settings` (ตั้งค่า)

Replaces with `/contacts` + `#more` (matching FM/ACC layout). Drops unused `UserCog` import.

### Security Checks
- No backend changes — Critical checks N/A
- No money fields, no controllers, no DTOs
- No raw `fetch()` or missing `api.*` calls
- No `queryClient.invalidateQueries()` concerns (config-only, no mutations)

### Issues
**None found.** Test added confirms the deduplication.

### Recommendation: ✅ APPROVE

Clean UI dedup with test coverage. Aligns OWNER with FM/ACC mobile nav pattern.

---

## Branch 3: `chore/doc-config-single-source`

**Author**: iamnaii  
**Last commit**: 2026-06-24 16:07 +0700  
**Commit**: `refactor(menu): remove ตั้งค่าเอกสาร from fin zone — single source in settings`

### File Changes
| File | +/- |
|------|-----|
| `apps/web/src/config/menu.ts` | -54/+8: removes `owner-doc-config` and `acc-doc-config` menu sections |
| `apps/web/src/config/menu.test.ts` | -3/+6: updates tests to assert removal |

### Change Summary
Removes two menu sections that linked to OWNER-only document configuration pages from fin zones:
- `owner-doc-config` — OWNER's fin zone "ตั้งค่าเอกสาร" (8 sub-items with tab query params)
- `acc-doc-config` — ACCOUNTANT's fin zone "ตั้งค่าเอกสาร" (ACC landed on a 403 page anyway, per comment in removed code)

Both now exist exclusively at `/settings › บัญชี & ภาษี › เลขที่/รูปแบบเอกสาร`.

### Security Checks
- No backend changes — Critical checks N/A
- No money fields, no controllers, no DTOs
- Note: the removed `acc-doc-config` section was already unreachable functionally (page enforced OWNER-only via ProtectedRoute). Removing the dead menu entry is correct.

### Issues
**Info only**: The previous code contained a comment acknowledging ACC's link landed on a "ไม่มีสิทธิ์เข้าถึง" page — this was a UX bug (dead links). The fix removes the dead links rather than widening access, which is the right call.

### Recommendation: ✅ APPROVE

Clean single-source-of-truth refactor. Removes dead menu paths, tests updated.

---

## Summary

| Branch | Files Changed | Critical | Warning | Info | Verdict |
|--------|--------------|----------|---------|------|---------|
| `chore/local-config-sync` | 2 (config only) | 0 | 0 | 0 | ✅ APPROVE |
| `chore/owner-mobile-settings-bar` | 2 (menu + test) | 0 | 0 | 0 | ✅ APPROVE |
| `chore/doc-config-single-source` | 2 (menu + test) | 0 | 0 | 1 (dead link removed) | ✅ APPROVE |

All 3 branches reviewed are frontend/config-only changes with no security or data-integrity concerns. All pass Critical and Warning checks. Safe to merge.
