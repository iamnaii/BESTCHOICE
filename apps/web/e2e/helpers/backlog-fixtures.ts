import { readFileSync } from 'node:fs';
import { test } from '@playwright/test';

/** Fail closed: these tests require the disposable whole-system harness, never live data. */
export function backlogFixtures() {
  const file = process.env.SYSTEM_E2E_FIXTURES;
  if (!file && !process.env.SYSTEM_E2E_OUTPUT && !process.env.DOCS_QA_OUTPUT) {
    test.skip(true, 'Requires the isolated backlog fixture runner; no live data fallback');
  }
  if (
    !file ||
    !process.env.SYSTEM_E2E_OUTPUT ||
    !process.env.DOCS_QA_OUTPUT ||
    !process.env.API_DIRECT_URL ||
    !process.env.BASE_URL
  ) {
    throw new Error(
      'Run these scenarios with tools/docs-integration.sh and e2e/ui-fields/system-e2e.audit-spec.ts (dedicated disposable fixtures required)',
    );
  }
  return JSON.parse(readFileSync(file, 'utf8')) as {
    prefix: string;
    financeCompanyId: string;
    verification: { id: string; contractNumber: string; hash: string };
    profile: { email: string; password: string };
    activation: { id: string; contractNumber: string; productId: string };
    template: { id: string; contractNumber: string };
    gateway: { id: string; paymentId: string; rawPayload: string; signature: string };
    period: { id: string; companyId: string; year: number; month: number };
    usedInvite: { id: string; email: string };
    receivables: {
      clean: { id: string; saleNumber: string };
      broken: { id: string; saleNumber: string };
    };
    promiseHappy: { id: string; contractNumber: string };
    promiseSupersede: { id: string; contractNumber: string };
  };
}
