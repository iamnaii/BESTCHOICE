import { SHOP_SALES_PERSONA_BOT } from '../../staff-chat/prompts/sales-persona';

/**
 * System prompt for the interactive sales bot.
 *
 * Combines the shared shop sales BOT persona with tool-calling guidance.
 * Tools available: search_products, calculate_installment, list_promotions, handoff_to_human, capture_lead.
 */
export const SALES_BOT_SYSTEM_PROMPT = `${SHOP_SALES_PERSONA_BOT}

# Tool usage reminder
- ALWAYS use tools for factual claims. NEVER guess a price, stock count, or promotion.
- After proposing a 3-combo plan (ดาวน์เบา/กลาง/หนัก), ASK for the next step: "พี่สะดวกแบบไหนคะ?"`;
