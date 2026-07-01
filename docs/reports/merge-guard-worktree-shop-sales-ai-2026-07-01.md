# Merge Guard Report — worktree-feat-shop-sales-ai-phase-a
**Date:** 2026-07-01  
**Branch:** `origin/worktree-feat-shop-sales-ai-phase-a`  
**Reviewer:** Pre-Merge Guard Agent  
**Recommendation:** ⚠️ REVIEW

---

## Summary

This is a large worktree branch (~2,609 commits ahead of main, 1,478 files changed) containing the SHOP Sales AI Bot feature. The branch has no common ancestor with `origin/main` — it diverges from a different base. Review was focused on the new `sales-bot` module and the AI-related changes.

### Key New Feature
- New `SalesBotModule` at `apps/api/src/modules/sales-bot/` with 5 AI tools:
  - `search-products.tool.ts` — searches product catalog for the AI
  - `calculate-installment.tool.ts` — installment calculation
  - `list-promotions.tool.ts` — promotion listings
  - `handoff-to-human.tool.ts` — escalation tool
  - `capture-lead.tool.ts` — creates Customer records and PromptPay QR
- Sales bot triggered via `AiAutoReplyService` on SHOP channels (LINE_SHOP, Facebook, Web)
- TikTok properly blocked (stub adapter defense)

---

## File Changes (New Code Only)

| File | Lines | Status |
|------|-------|--------|
| `apps/api/src/modules/sales-bot/sales-bot.service.ts` | +130 | New |
| `apps/api/src/modules/sales-bot/sales-bot.module.ts` | +20 | New |
| `apps/api/src/modules/sales-bot/tools/capture-lead.tool.ts` | +180 | New |
| `apps/api/src/modules/sales-bot/tools/search-products.tool.ts` | +60 | New |
| `apps/api/src/modules/sales-bot/prompts/sales-bot.system.ts` | +100 | New |
| `apps/api/src/modules/ai-settings/ai-settings.controller.ts` | Modified | Updated |

---

## Issues Found

### 🟡 Warning

**W1 — No server-side phone format validation in `capture-lead.tool.ts`**  
File: `apps/api/src/modules/sales-bot/tools/capture-lead.tool.ts`

The AI input schema declares `phone: "เบอร์โทร 10 หลัก"` but there is no server-side regex check before writing to `Customer.phone`. If the AI model hallucinates a malformed phone (e.g., "ไม่มีเบอร์", "N/A", etc.), it gets persisted as-is. The Customer model has no phone format constraint at the DB level.

**Recommended fix:**
```ts
// Add near top of run():
if (!/^0\d{9}$/.test(input.phone)) {
  throw new Error(`Invalid phone format: ${input.phone}`);
}
```

**W2 — `Number(r.costPrice)` in `search-products.tool.ts`**  
File: `apps/api/src/modules/sales-bot/tools/search-products.tool.ts`, line ~42

Price is returned as `priceThb: Number(r.costPrice)` to the AI model. While this is for display/AI consumption only (not stored or used in calculations), it converts a `Decimal` to a JavaScript `Number` which can lose precision on large values. For Thai phone prices (5,000–50,000 THB), this is unlikely to cause issues in practice, but breaks the project-wide Decimal discipline.

**W3 — Hardcoded model ID in `sales-bot.service.ts`**  
File: `apps/api/src/modules/sales-bot/sales-bot.service.ts`, line ~67

`model: 'claude-sonnet-4-6'` is hardcoded. The comment ("Do NOT drop to Haiku") is valid, but the model ID should come from a `SystemConfig` key (e.g., `SALES_BOT_MODEL`) or environment variable so upgrades don't require a code deploy.

---

### 🔵 Info

**I1 — AI persona system prompt exposed to BRANCH_MANAGER role**  
File: `apps/api/src/modules/ai-settings/ai-settings.controller.ts`

The `GET /ai-settings/persona` endpoint returns the full `SALES_BOT_SYSTEM_PROMPT` to `OWNER | BRANCH_MANAGER | FINANCE_MANAGER`. The prompt contains detailed sales tactics and "winning strategies." Restricting to OWNER-only would prevent staff from reading internal playbook instructions.

**I2 — ai-auto-reply per-session cap check uses `aiAutoReplyLog.count()` without branchId filter**  
The reply cap (`aiAutoMaxRepliesPerSession`) counts ALL logs for a room, not per-branch logs. This is OK since rooms are unique per channel, but worth confirming the intent.

---

## Security Checklist

| Check | Status |
|-------|--------|
| New controllers have `@UseGuards(JwtAuthGuard, RolesGuard)` | ✅ ai-settings controller properly guarded |
| No new public endpoints without guards | ✅ Sales bot triggered internally via service (no public endpoint) |
| No `Number()` on stored money fields | ⚠️ W2 above (display only) |
| No hardcoded secrets | ✅ Clean |
| No raw SQL injection | ✅ No `$queryRaw` in new sales-bot code |
| Soft-delete checks (`deletedAt: null`) | ✅ Present in capture-lead queries |
| DTO validation on new DTOs | ⚠️ No server-side phone validation (W1) |
| Thai validation messages | ✅ Present in ai-settings DTO |

---

## Recommendation: ⚠️ REVIEW

**Not a BLOCK** — the new sales-bot module has correct architecture, proper guards, good audit logging via `AI_LEAD_CAPTURED`, proper transaction usage, and TikTok defense-in-depth.

**Must address before production traffic:**
1. **W1 (phone validation)** — fix before enabling `ai.autoEnabled=true` in prod to prevent garbage data in the customer table.

**Nice-to-fix:**
2. W2 and W3 (Decimal discipline and model config externalization)
