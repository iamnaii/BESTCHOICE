# Merge Guard Report — redesign/liff-pay-scan-only

**Date**: 2026-04-27  
**Branch**: `redesign/liff-pay-scan-only`  
**Author**: Akenarin Kongdach  
**Commits**: 1  
**Diff**: 2 files changed, +446 / -604  
**Recommendation**: ⚠️ REVIEW — fix 1 Warning item (hardcoded colors)

---

## Summary

`redesign(liff-pay): calm fintech visual, scan-to-pay only, fix 401 on reload`

Major redesign of `LiffPayment.tsx`:
- Removed slip upload tab ("โอนเอง") — scan-to-pay QR only
- New `Shell` wrapper with ambient gradient background
- Fixed 401-on-reload by calling `useLiffInit()` hook (LIFF token auto-retry)
- Removed `validateSlipFile` import (slip flow deleted)
- Updated E2E spec (`liff-payment.spec.ts`) to match new UI text and remove slip tests

---

## File Changes

| File | +/- | Notes |
|------|-----|-------|
| `LiffPayment.tsx` | +410/-580 | full redesign, 663 lines total |
| `liff-payment.spec.ts` | +36/-24 | updated selectors, removed slip tests |

---

## Issues by Severity

### Critical
_None_

### Warning

**W-1 — Hardcoded hex color + hardcoded white in `LiffPayment.tsx`** (violates design token rules)

```tsx
// Shell component — line ~580
<div style={{ backgroundColor: '#fafaf7' }}>

// Pay button — line ~350
<span className="... bg-white/20 backdrop-blur-sm">
```

Additionally, the ambient blob decorations use inline `rgb()` values for emerald:
```tsx
style={{ background: 'radial-gradient(circle, rgb(16 185 129 / 0.18) 0%, ...)' }}
style={{ background: 'radial-gradient(circle, rgb(16 185 129), transparent 70%)' }}
style={{ background: 'radial-gradient(circle, rgb(52 211 153), transparent 70%)' }}
```

Per frontend rules: "ห้ามใช้ hardcoded hex colors (`#...`) — ใช้ CSS variable tokens เท่านั้น"
and "ห้ามใช้ `bg-white` (ยกเว้น print/receipt context)".

**Fix options**:
- Replace `#fafaf7` with `bg-background` CSS token via className (remove inline style)
- Replace `bg-white/20` with `bg-white/20` is acceptable _only_ if this is intentionally
  a translucent overlay on a dark gradient; otherwise use `bg-card/20`
- Replace `rgb(16 185 129)` with `oklch(var(--primary))` or `hsl(var(--primary))` in
  inline gradient styles (or extract to a CSS class in `index.css`)

### Info

- `LiffPayment.tsx` is **663 lines** — exceeds the 500-line soft limit. The file handles
  multiple distinct views (loading, error, payment, gateway-pending, success). Consider
  extracting each view into a sub-component when the next touch happens.
- Removed `validateSlipFile` import is clean — no dead code left behind ✓
- E2E spec updated in sync with UI changes ✓

---

## Security Checklist

- [x] No new backend endpoints — LIFF page is frontend-only ✓
- [x] Uses `liffApi` (custom LIFF-aware API client), no raw `fetch()` ✓
- [x] Uses `useQuery` / `useMutation` from React Query ✓
- [x] `queryClient.invalidateQueries` present after payment mutations ✓
- [x] No hardcoded secrets ✓
- [x] `useLiffInit()` hook used — fixes 401 on reload without bypassing auth ✓
- [ ] **Hardcoded hex + rgb colors** ← W-1
