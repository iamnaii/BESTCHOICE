# Pre-Merge Guard Report

**Branch**: `fix/letters-e2e-sales-assertion`  
**Author**: Akenarin Kongdach / iamnaii  
**Date**: 2026-05-26  
**Reviewer**: Pre-Merge Guard (automated)

---

## File Changes Summary

| File | +/- | Description |
|------|-----|-------------|
| `apps/web/e2e/letters-page.spec.ts` | +8 / -4 | Update SALES-role E2E assertion |

**Total**: 1 file, 12 lines changed. All prior letters-related commits (Puppeteer PDF, templates, seed) are already on `main`; this branch is exactly 1 commit ahead.

---

## Issues by Severity

### Critical
_None._

### Warning
_None._

### Info
- **Assertion strategy change** (info): The previous test asserted `count(ยกเลิก) === 0` to verify SALES cannot cancel letters. That assertion was brittle because the "CANCELLED" status tab also carries the text "ยกเลิก", causing the count to be non-zero even for correct behavior. The new assertion (`heading 'จัดการจดหมาย' visible` + `url contains /letters`) correctly tests that SALES users can access the page without being redirected. The comment explains that cancel-button suppression is covered by a backend role test (403 on `POST /overdue/letters/:id/cancel` for SALES) — this separation of concerns is sound.

---

## Recommendation

**APPROVE** — Trivial, well-justified E2E test fix. No production code changed. The brittle selector is replaced with an accurate access-control check. No blockers.
