# Merge Guard Report — feat/ai-menu-separate

**Date**: 2026-05-20  
**Branch**: `feat/ai-menu-separate`  
**Author**: iamnaii (Akenarin Kongdach) `<akenarin.ak@gmail.com>`  
**Commits**: 3  
**Recommendation**: ✅ APPROVE

---

## File Changes Summary

```
2 files changed, 17 insertions(+), 13 deletions(-)
```

| File | Change |
|------|--------|
| `apps/web/src/config/menu.ts` | AI items moved from nested child of "ตั้งค่า" to its own top-level section in the settings zone |
| `apps/web/package.json` | Minor dependency update |

---

## Changes Description

Extracts the 5 AI menu items (`AI Admin`, `AI Persona`, `AI Assistant`, `AI Training`, `AI Performance`) from being nested children inside the "ตั้งค่า" group and gives them their own `key: 'owner-ai'` group section in the `settings` zone.

This is a pure UI restructuring. No backend changes, no new routes, no authentication changes. The menu config itself is an OWNER-only section (`OWNER_CONFIG`).

---

## Issues by Severity

### Critical — None

### Warning — None

### Info — None

---

## Security Checklist

| Check | Result |
|-------|--------|
| No new controllers or routes | ✅ N/A |
| No new DTOs or API calls | ✅ N/A |
| No Prisma queries | ✅ N/A |
| No hardcoded secrets | ✅ Pass |
| AI menu items remain OWNER-only (in `OWNER_CONFIG`) | ✅ Pass |

---

## Recommendation: ✅ APPROVE

Low-risk cosmetic restructuring. No security surface change. Safe to merge.
