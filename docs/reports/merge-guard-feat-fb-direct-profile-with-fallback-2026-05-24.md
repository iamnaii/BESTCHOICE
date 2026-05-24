# Merge Guard Report — feat/fb-direct-profile-with-fallback

**Date**: 2026-05-24  
**Branch**: `feat/fb-direct-profile-with-fallback`  
**Author**: Akenarin Kongdach  
**Reviewed against**: `origin/main`

---

## File Changes Summary

| File | Change |
|------|--------|
| `apps/api/src/modules/chat-adapters/facebook.adapter.ts` | +50 lines, -5 deletions |

**Total**: 1 file changed, 50 insertions, 5 deletions

---

## Purpose

Refactors `FacebookAdapter.getUserProfile()` to try the direct Messenger User Profile API (`/{psid}?fields=name,profile_pic`) first, then fall back to the existing `/me/conversations?user_id=` workaround. The direct API returns both name and profile picture (when at Advanced Access tier), while the conversation workaround returns name only. Both paths have 10 s timeouts with Sentry capture on timeout errors.

---

## Critical Issues

_None._

---

## Warning Issues

_None._

---

## Info

| # | Location | Note |
|---|----------|------|
| I-1 | `facebook.adapter.ts:143` | `pageAccessToken` is embedded in the URL query string — standard for Graph API but tokens may appear in server-side request logs if HTTP logging is enabled. This is pre-existing behavior (same pattern in the conversation fallback path). |
| I-2 | `facebook.adapter.ts:130–155` | `fetch()` used directly — appropriate for backend adapter calling an external API. The frontend `api.get()` convention does not apply to backend service code. |

---

## Checklist

- [x] No controller changes — guards/roles not applicable
- [x] Both paths have `AbortSignal.timeout(10000)` for timeout safety
- [x] Sentry capture on timeout for both methods
- [x] Graceful degradation — any failure in `fetchDirectProfile` returns `null` and falls through to `fetchProfileViaConversations`
- [x] No money fields, no DB access
- [x] No hardcoded secrets (token sourced from `this.pageAccessToken` injected from config)

---

## Recommendation

**APPROVE** — Well-structured two-tier fallback with proper error handling. No security or convention issues.
