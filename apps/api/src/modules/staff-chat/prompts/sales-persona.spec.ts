import { REQUIRED_TOOL_NAMES, SHOP_SALES_PERSONA_BOT_EXTRAS } from './sales-persona';

/**
 * Contract pins for the persona ↔ tool-registration coupling (#1332 minors).
 *
 * REQUIRED_TOOL_NAMES drives the frontend persona lint (AiPersonaPage warns
 * the owner when a saved BOT_EXTRAS override drops a tool reference) via
 * GET /ai-settings/persona. If a registered tool is missing from the list —
 * or the DEFAULT extras never mention it — the bot silently stops calling
 * it and no lint fires. These pins fail the build instead.
 */
describe('sales-persona contract', () => {
  it('REQUIRED_TOOL_NAMES contains get_installment_rates (#1332)', () => {
    expect(REQUIRED_TOOL_NAMES).toContain('get_installment_rates');
  });

  it('default BOT_EXTRAS references every required tool name (lint parity with owner overrides)', () => {
    for (const name of REQUIRED_TOOL_NAMES) {
      expect(SHOP_SALES_PERSONA_BOT_EXTRAS).toContain(name);
    }
  });
});
