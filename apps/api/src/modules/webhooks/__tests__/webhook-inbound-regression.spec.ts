/**
 * Regression lock — inbound webhook gating
 * ──────────────────────────────────────────────────────────────────
 * The `webhooks_enabled` SystemConfig flag (introduced in PR #922)
 * defaults to OFF and gates *outbound* webhook delivery from
 * `WebhooksController` via `WebhooksEnabledGuard`. Inbound webhooks
 * — payment confirmations, SMS DLRs, LINE / Facebook chat events —
 * MUST remain ungated by that flag. If the kill-switch ever blocked
 * them, production payments + chat would silently break the moment
 * the flag was toggled off in an incident.
 *
 * This file is a deliberate static-metadata assertion so that any
 * future refactor that accidentally attaches `WebhooksEnabledGuard`
 * to an inbound controller is caught at PR review time, not after
 * a paid-customer Sentry alarm.
 *
 * Detection strategy:
 *   1. Read the `__guards__` metadata that NestJS's `@UseGuards()`
 *      decorator writes onto each controller class + handler method.
 *   2. For inbound controllers: assert no guard's class name is
 *      `WebhooksEnabledGuard` (string match — works even if the
 *      guard class hasn't shipped yet; future PR that adds it will
 *      auto-pick up this regression test).
 *   3. For the outbound `WebhooksController`: assert standard
 *      authenticated guards are present (JwtAuthGuard + RolesGuard).
 *      The eventual `WebhooksEnabledGuard` is allowed but not
 *      required by this file — adding it lives in PR #922 itself.
 */
import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PaySolutionsController } from '../../paysolutions/paysolutions.controller';
import { SmsWebhookController } from '../../notifications/sms-webhook.controller';
import { LineOaChatbotController } from '../../line-oa/line-oa-chatbot.controller';
import { FacebookWebhookController } from '../../chat-adapters/facebook-webhook.controller';
import { ChatbotFinanceController } from '../../chatbot-finance/chatbot-finance.controller';
import { WebhooksController } from '../webhooks.controller';

/**
 * Returns the union of class-level + method-level guards as
 * `{ name: string }[]`. NestJS may store either class refs or
 * instances depending on decoration site, so we read `.name`
 * defensively (also covers `undefined`).
 */
function collectGuardNames(controller: Function, methodNames: string[]): string[] {
  const classGuards: unknown[] =
    Reflect.getMetadata(GUARDS_METADATA, controller) ?? [];

  const methodGuards: unknown[] = methodNames.flatMap((m) => {
    const handler = (controller.prototype as Record<string, unknown>)[m];
    return Array.isArray(Reflect.getMetadata(GUARDS_METADATA, handler as object))
      ? (Reflect.getMetadata(GUARDS_METADATA, handler as object) as unknown[])
      : [];
  });

  return [...classGuards, ...methodGuards]
    .map((g) => {
      if (typeof g === 'function') return g.name;
      if (g && typeof g === 'object' && 'constructor' in g) {
        return (g as { constructor: { name: string } }).constructor.name;
      }
      return '';
    })
    .filter((n) => n.length > 0);
}

/**
 * Returns the names of all instance methods declared on a controller
 * class (excludes inherited Object methods + constructor). Used so
 * the regression test scans every handler without enumerating them
 * by name.
 */
function instanceMethodNames(controller: Function): string[] {
  return Object.getOwnPropertyNames(controller.prototype).filter(
    (m) => m !== 'constructor' && typeof (controller.prototype as Record<string, unknown>)[m] === 'function',
  );
}

describe('webhook-inbound-regression — gating lock', () => {
  const INBOUND_CONTROLLERS: Array<{ name: string; ctor: Function }> = [
    { name: 'PaySolutionsController (inbound payment webhook)', ctor: PaySolutionsController },
    { name: 'SmsWebhookController (inbound ThaiBulkSMS DLR)', ctor: SmsWebhookController },
    { name: 'LineOaChatbotController (inbound LINE OA webhook)', ctor: LineOaChatbotController },
    { name: 'FacebookWebhookController (inbound FB messages)', ctor: FacebookWebhookController },
    { name: 'ChatbotFinanceController (inbound LINE Finance webhook)', ctor: ChatbotFinanceController },
  ];

  describe.each(INBOUND_CONTROLLERS)('$name', ({ ctor }) => {
    const allMethods = instanceMethodNames(ctor);
    const guards = collectGuardNames(ctor, allMethods);

    it('has NO WebhooksEnabledGuard attached at class or any method', () => {
      const hasEnabledGuard = guards.includes('WebhooksEnabledGuard');
      expect(hasEnabledGuard).toBe(false);
    });

    it('has NO JwtAuthGuard at class level (inbound webhooks are unauthenticated by design)', () => {
      // Class-level only — some inbound controllers expose unrelated
      // OWNER-only admin endpoints (e.g. /chatbot-finance/test/push).
      // Those individual handlers may opt into JwtAuthGuard. What we
      // forbid is gating the whole controller behind it, which would
      // 401 the real provider webhook.
      const classGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, ctor) ?? [];
      const classGuardNames = classGuards.map((g) =>
        typeof g === 'function' ? g.name : '',
      );
      expect(classGuardNames).not.toContain('JwtAuthGuard');
    });
  });

  describe('WebhooksController (OUTBOUND admin) — must stay authenticated', () => {
    const allMethods = instanceMethodNames(WebhooksController);
    const guards = collectGuardNames(WebhooksController, allMethods);

    it('has JwtAuthGuard attached (OWNER-only)', () => {
      expect(guards).toContain('JwtAuthGuard');
    });

    it('has RolesGuard attached (role check)', () => {
      expect(guards).toContain('RolesGuard');
    });
  });
});
