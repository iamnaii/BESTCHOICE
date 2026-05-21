# Merge Guard Report — feat/persona-tone-tweaks

**Date**: 2026-05-21  
**Branch**: `feat/persona-tone-tweaks`  
**Author**: Akenarin Kongdach  
**Latest commit**: `feat(persona): tone tweaks from Nai test — สนใจ over อยาก + ask-one + list formatting`

---

## File Changes Summary

| File | +Lines | -Lines |
|------|--------|--------|
| `apps/api/src/modules/staff-chat/prompts/sales-persona.ts` | +27 | -3 |

**Total**: 1 file changed, 30 lines changed.  
File length before this branch's changes: 161 lines (well under 500-line threshold).

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

- Change is a pure TypeScript string constant modification inside `SHOP_SALES_PERSONA_BASE`.
- No `any` types introduced.
- No imports changed.

---

## Change Summary

Four improvements to the AI sales persona tone, sourced from live test observations by Nai (shop owner):

1. **"สนใจ" over "อยากได้" / "อยากซื้อ"** — Replaces "อยาก" (implies urgency/want) with "สนใจ" (polite inquiry, less pushy). Applied consistently in example sentences and the Thai-language rule block.

2. **Ask-one-question rule** — Adds an explicit rule: bot must ask one question per message, not bundle list + question + justification into a single message. Includes a ❌/✅ example pair showing the correct pattern (send list → wait for reply → then ask budget in next message).

3. **List formatting rule** — When presenting >2 items (models/prices/options), use a separate-line bullet list rather than comma-joined or slash-joined inline text. Includes ❌/✅ example pair.

4. **Message structure rule** — New line break between intro sentence and list for readability. Includes a full ❌/✅ block showing how a model-listing response should be formatted end-to-end.

All changes reduce cognitive load on the customer and prevent the "translation accent" patterns the persona is designed to avoid.

---

## Recommendation

**✅ APPROVE**

Pure prompt-string change. No security, financial, or correctness concerns. The tone improvements are well-motivated (based on real test feedback) and consistent with the existing language rules in `SHOP_SALES_PERSONA_BASE`.
