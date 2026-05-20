# Pre-Merge Guard Report: feat/ai-menu-separate

**Date**: 2026-05-20  
**Branch**: `feat/ai-menu-separate`  
**Review commit**: `9100b931`  
**Compared against**: `origin/main`

---

## Summary

Single-commit branch that reorganises the AI navigation items from a nested sub-group inside the "ตั้งค่า" section to a dedicated top-level "AI" group in the `settings` zone of `OWNER_CONFIG`. No backend changes.

## File Changes

| File | +/- | Notes |
|------|-----|-------|
| `apps/web/src/config/menu.ts` | +17 / -13 | AI section promoted to top-level group |
| `apps/web/package.json` | +1 / -1 | Version bump only |

**Total**: 2 files, 17 insertions, 13 deletions.

---

## Issues Found

### Critical
*None.*

### Warning
*None.*

### Info

- `I-01` — The 5 AI menu items (`AI Admin`, `AI Persona`, `AI Assistant`, `AI Training`, `AI Performance`) all use the same `Sparkles` icon. Consider distinct icons per item in a follow-up for visual differentiation.

---

## Recommendation: ✅ APPROVE

The change is a pure cosmetic sidebar reorganisation. No data flow, API calls, or auth logic is modified. Correct use of `zone: 'settings'` and `key: 'owner-ai'`. No issues blocking merge.
