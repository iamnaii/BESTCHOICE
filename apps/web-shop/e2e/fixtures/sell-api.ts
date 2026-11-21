import type { Page, Request } from '@playwright/test';
import type { BuybackQuestionsResponse, BuybackQuoteResult } from '../../src/types/buyback';
import snapshots from './sell-data.json' with { type: 'json' };
export type SellFixtureLog = {
  submittedPayload: Record<string, unknown> | null;
  submitRequests: Request[];
  quotePayloads: Record<string, unknown>[];
  unmatched: string[];
};
export const sellData = snapshots;
export async function installSellApiFixtures(page: Page): Promise<SellFixtureLog> {
  const log: SellFixtureLog = {
    submittedPayload: null,
    submitRequests: [],
    quotePayloads: [],
    unmatched: [],
  };
  let lastQuote: BuybackQuoteResult | null = null;
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost'
      ? route.fallback()
      : route.abort();
  });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    if (pathname === '/api/shop/buyback/catalog') {
      await route.fulfill({ json: snapshots.catalog });
      return;
    }
    if (pathname === '/api/shop/buyback/questions') {
      const key = url.searchParams.get('model') + '|' + url.searchParams.get('storage');
      const profiles = snapshots.profiles as Record<string, BuybackQuestionsResponse>;
      await route.fulfill({ json: profiles[key] ?? { questions: [], bonusPct: '0' } });
      return;
    }
    if (pathname === '/api/shop/buyback/quote') {
      const body = request.postDataJSON();
      log.quotePayloads.push(body);
      const profiles = snapshots.profiles as Record<string, BuybackQuestionsResponse>;
      const profile = profiles[body.model + '|' + body.storage];
      const issues =
        body.answers?.find(
          (answer: { questionKey: string }) => answer.questionKey === 'functional-issues',
        )?.choiceIds ?? [];
      lastQuote = {
        available: true,
        price: issues.length ? '12340' : '27500',
        cashPrice: issues.length ? '12340' : '27500',
        exchangePrice: issues.length ? '12840' : '28500',
        bonusPct: '0',
        bonusAmount: issues.length ? '500' : '1000',
        grade: 'A',
        source: profile?.source,
        capturedAt: profile?.capturedAt,
        pricingMode: 'SUM_PERCENT_FLOOR10',
        breakdown: {
          maxPrice: '27500',
          price: issues.length ? '12340' : '27500',
          fixedTotal: '0',
          pctTotal: '0',
          lines: [],
        },
      };
      await route.fulfill({ json: lastQuote });
      return;
    }
    if (pathname === '/api/shop/buyback/submit') {
      log.submittedPayload = request.postDataJSON();
      log.submitRequests.push(request);
      await route.fulfill({
        json: {
          id: 'local-request',
          status: 'PENDING_APPRAISAL',
          price:
            log.submittedPayload?.flow === 'EXCHANGE'
              ? lastQuote?.exchangePrice
              : lastQuote?.cashPrice,
        },
      });
      return;
    }
    if (pathname === '/api/shop/buyback/local-request') {
      const body = log.submittedPayload ?? {};
      await route.fulfill({
        json: {
          id: 'local-request',
          status: 'PENDING_APPRAISAL',
          flow: body.flow ?? 'BUYBACK',
          deviceBrand: 'Apple',
          deviceModel: body.model ?? 'iPhone 17 Pro',
          deviceStorage: body.storage ?? '256GB',
          deviceCondition: null,
          batteryHealth: null,
          photoUrls: [],
          estimatedValue:
            body.flow === 'EXCHANGE' ? lastQuote?.exchangePrice : lastQuote?.cashPrice,
          quoteBreakdown: {
            ...lastQuote?.breakdown,
            bonusPct: '0',
            bonusAmount: lastQuote?.bonusAmount,
            cashPrice: lastQuote?.cashPrice,
            exchangePrice: lastQuote?.exchangePrice,
            chosenFlow: body.flow,
          },
          preferredVisitDate: body.preferredVisitDate ?? null,
          offeredPrice: null,
          agreedPrice: null,
          createdAt: '2026-11-20T00:00:00Z',
        },
      });
      return;
    }
    if (/\/track|\/analytics|\/events/.test(pathname)) {
      await route.fulfill({ json: { success: true } });
      return;
    }
    if (pathname === '/api/shop/auth/me') {
      await route.fulfill({ status: 401, json: { message: 'ไม่มีผู้เข้าสู่ระบบ' } });
      return;
    }
    log.unmatched.push(pathname);
    await route.fulfill({ status: 501, json: { message: 'Unmatched isolated test endpoint' } });
  });
  return log;
}
