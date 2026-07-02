import { describe, it, expect, vi } from 'vitest';
import type { QueryClient } from '@tanstack/react-query';
import { invalidatePaymentQueries } from '../invalidatePaymentQueries';

describe('invalidatePaymentQueries', () => {
  it('invalidates the per-contract history caches (regression: stale ประวัติ after a payment)', () => {
    const invalidateQueries = vi.fn();
    invalidatePaymentQueries({ invalidateQueries } as unknown as QueryClient);

    const keys = invalidateQueries.mock.calls.map((c) => c[0].queryKey[0]);
    // The two that were previously missing — their absence let the 3-min
    // staleTime serve a stale 0/N history behind a fresh daily summary.
    expect(keys).toContain('contract-payments');
    expect(keys).toContain('contract-receipts');
    // JE expansion cache (per-receipt bookkeeping view) must refresh too.
    expect(keys).toContain('contract-journal-entries');
    // Existing invalidations preserved.
    expect(keys).toContain('pending-payments');
    expect(keys).toContain('daily-summary');
  });
});
