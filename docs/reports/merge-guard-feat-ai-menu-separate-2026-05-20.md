# Merge Guard Report — feat/ai-menu-separate

**Date**: 2026-05-20  
**Branch**: `feat/ai-menu-separate`  
**Author**: Akenarin Kongdach  
**Latest commit**: `9100b931 feat(menu): split AI into its own top-level section in Gear`

---

## File Changes Summary

| File | +/- | Notes |
|------|-----|-------|
| `apps/web/src/config/menu.ts` | +17 / -13 | AI menu moved from nested child → top-level section |
| `apps/web/package.json` | +1 / -1 | Version bump 26.5.14 → 26.5.15 |

**Total**: 2 files, 17 insertions, 13 deletions

---

## Analysis

### What changed
The AI submenu that was previously a nested `children` array inside the "ตั้งค่า" group in `OWNER_CONFIG` is extracted into its own `zone: 'settings'` top-level group (`key: 'owner-ai'`). The 5 child items (AI Admin, AI Persona, AI Assistant, AI Training, AI Performance) are unchanged.

### Critical Issues
_None_

### Warnings
_None_

### Info
- Version bump in `package.json` is consistent with the change being a user-visible menu restructure.
- The AI group is only in `OWNER_CONFIG` — no unintended role broadening.
- The comment in the diff explains the intent ("AI configuration is a distinct concern… settings group was getting crowded") — appropriate for a long-lived code change.

---

## Recommendation

**APPROVE** ✅

Clean, self-contained menu restructure. No security, data, or behavioral concerns.
