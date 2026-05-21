# Merge Guard Report — feat/persona-no-data-rule

**Date**: 2026-05-21  
**Branch**: `feat/persona-no-data-rule`  
**Author**: Akenarin Kongdach  
**Latest commit**: `feat(persona): add no-data + anti-hallucinate rules to BOT_EXTRAS`

---

## File Changes Summary

| File | +Lines | -Lines |
|------|--------|--------|
| `apps/api/src/modules/staff-chat/prompts/sales-persona.ts` | +18 | 0 |

**Total**: 1 file changed, 18 insertions, 0 deletions.  
File length after change: 179 lines (well under 500-line threshold).

---

## Issue Analysis

### Critical
_None found._

- No new controllers → no `@UseGuards` / `@Roles` concern.
- No money calculations → no `Number()` risk.
- No Prisma queries → no `deletedAt: null` concern.
- No hardcoded secrets or API keys.

### Warning
_None found._

- No DTOs modified.
- No service methods added.
- No React components touched.

### Info
_None found._

- Change is a pure TypeScript string constant addition inside `SHOP_SALES_PERSONA_BOT_EXTRAS`.
- No `any` types introduced.
- No imports added.

---

## Change Summary

Adds two rule blocks to the AI sales persona prompt constant:

1. **กรณีไม่เจอข้อมูล / tool คืนค่าว่าง (ห้าม hallucinate)** — Instructs the bot to:
   - Retry with a broader keyword once if `search_products` returns `products=[]`.
   - Fall back to `handoff_to_human` if `calculate_installment` errors.
   - Fall back to `handoff_to_human` for spec/warranty/claim questions not covered by `list_promotions`.
   - Never answer numeric data (price/installment/stock) without a tool call.

2. **กฎเหล็ก — ห้าม hallucinate** — Reinforces that all numeric values must originate from tool results, with an explicit good/bad example.

These are defensive guardrails against the bot fabricating product data from Claude/Gemini's training knowledge, which would not reflect the shop's real inventory or pricing.

---

## Recommendation

**✅ APPROVE**

Pure prompt-string change. No security, financial, or correctness concerns. The rules are aligned with the existing anti-hallucination intent of the persona and the documented `handoff_to_human` tool contract.
