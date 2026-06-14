# Pre-Merge Guard Report — feat/canned-response-postback-routing

**Date**: 2026-06-14  
**Branch**: `feat/canned-response-postback-routing`  
**Author**: Akenarin Kongdach (akenarin.ak@gmail.com)  
**Unique commits vs main**: 4  
**Recommendation**: ✅ APPROVE — no blocking issues

---

## File Changes Summary

Branch has 4 unique commits:

| SHA | Description |
|-----|-------------|
| `57b23560` | fix(canned-response): Phase 5 — review issues C1/C2/W4/W5/W6/W7 |
| `3711808e` | feat(canned-response): Phase 5b — POSTBACK template picker in QuickReplyEditor |
| `4cff2b4d` | feat(canned-response): Phase 5 — Quick Reply postback routing (backend) |
| `b8e00b0d` | feat(chat): Message Template Picker + Admin Redesign + Multi-bubble Rich Content |

Phase 5 adds postback routing: when a customer taps a Quick Reply button, the bot automatically sends the linked canned response template. Phase 5b adds the frontend picker to associate a template with a Quick Reply option.

---

## Issues Found

### ℹ️ Info — Branch diverged from older base (same as channel-tabs branch)

Shares the same `b8e00b0d` base as `canned-response-channel-tabs`. Direct diff against main is large. Rebase recommended before merge.

---

## Positive Findings

### ✅ Race condition fix — `upsert` replaces `findFirst → create` (C1)

**Commit**: `57b23560`

`CannedResponseSenderService.getSystemUserId()` was using `findFirst → create`, a pattern vulnerable to P2002 unique constraint violations under concurrent postback sends. Replaced with `prisma.user.upsert` (atomic at PostgreSQL level). 4 new tests prove the fix: concurrent sends, upsert shape validation, role check, real-staff bypass path.

### ✅ System user role downgraded OWNER → SALES (W6)

Bot/system user now created with `role: 'SALES'` instead of `OWNER`. Prevents the system user from appearing in owner-only queries (audit recipients, notification targets, admin role-filtered lists). `upsert.update: {}` is a no-op so existing seeds that already created an OWNER-role system user are preserved without regression.

### ✅ FB ChatRoom resolved with correct ordering (C2)

`ChatRoom.findFirst` for Facebook PSID now includes `orderBy: { lastMessageAt: 'desc' }`. Without this, re-engagement (PSID with multiple rooms) would resolve to the stale oldest room.

### ✅ Postback loop guard added (W7)

In-memory sliding window per room: max 5 postback dispatches per 10 seconds. On the 6th attempt, a warning is logged and the send is skipped (does not throw). Prevents A→B→A Quick Reply chain infinite loops. 4 new tests verify limit enforcement, window expiry, and per-room isolation.

### ✅ Redundant `@Inject(forwardRef())` removed (W4)

Module-level `forwardRef(() => StaffChatModule)` in `chatbot-finance.module.ts` already handles the circular DI. Constructor-level `@Inject(forwardRef(...))` on the same provider was redundant and removed, simplifying the DI graph.

### ✅ No `Number()` on money fields in unique production code

Checked `apps/api/src/modules/**/*.ts` for `Number(` in the 3 feature commits (`4cff2b4d`, `3711808e`, `57b23560`). None found in production service code.

### ✅ `deletedAt: null` filters present

All new Prisma queries in the feature commits include `deletedAt: null`.

### ✅ No new controllers — no guard issues

No new NestJS controllers introduced in the unique commits. New service methods (`QuickReplyPostbackRouterService`) are called internally from existing guarded controllers.

---

## Summary

| Severity | Count | Status |
|----------|-------|--------|
| Critical | 0 | — |
| Warning | 0 | — |
| Info | 1 | Rebase recommended |

The 4 unique commits are high quality — they fix a genuine concurrency bug, a security concern (system user role), and add defensive rate limiting. Recommend rebase on `origin/main` before merge to ensure CI passes against the current codebase.
