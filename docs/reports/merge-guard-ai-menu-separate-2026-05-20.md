# Pre-Merge Guard Report

**Branch**: `feat/ai-menu-separate`
**Author**: Akenarin Kongdach
**Date**: 2026-05-20
**Reviewed by**: Pre-Merge Guard Agent

---

## Summary

Moves the AI menu group from a nested `children[]` inside the "ตั้งค่า" section to its own top-level section in the `settings` zone of `OWNER_CONFIG`. Purely cosmetic/structural navigation change with no backend involvement.

## File Changes

| File | Change |
|------|--------|
| `apps/web/src/config/menu.ts` | +17 / -13 — AI group extracted to own section |
| `apps/web/package.json` | +1 / -1 — dependency version bump |

**Total**: 2 files, 17 insertions, 13 deletions

---

## Issues Found

### Critical
*None*

### Warning
*None*

### Info
*None*

---

## Verdict

**APPROVE**

Clean, scoped UI-config change. No security surface, no financial fields, no backend code touched. The `key: 'owner-ai'` section follows the existing menu schema shape exactly. Safe to merge.
