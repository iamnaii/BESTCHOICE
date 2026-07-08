import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CashAccountSelect, CASH_ACCOUNT_CODES, KBANK_ONLY_CODES } from '../CashAccountSelect';

/**
 * Owner rule 2026-07-08: early payoff (JP4) + repossession (JP5) restrict
 * บัญชีรับเงิน to ธนาคารกสิกร (11-1201) via the `codes` prop. Default stays
 * the full 6-code list so the payment wizard / reschedule / bookings flows
 * are unaffected.
 */

const apiGet = vi.fn();
vi.mock('@/lib/api', () => ({
  default: { get: (...args: unknown[]) => apiGet(...args) },
}));

function wrap(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  apiGet.mockResolvedValue({
    data: [
      { code: '11-1101', name: '11-1101 เงินสด — สุทธินีย์ คงเดช' },
      { code: '11-1201', name: '11-1201 ธนาคาร KBank' },
    ],
  });
});

describe('CashAccountSelect — codes prop', () => {
  it('defaults to fetching all 6 cash/bank codes', async () => {
    render(wrap(<CashAccountSelect onChange={vi.fn()} />));
    await waitFor(() =>
      expect(apiGet).toHaveBeenCalledWith(
        `/chart-of-accounts/by-codes?codes=${CASH_ACCOUNT_CODES.join(',')}`,
      ),
    );
  });

  it('fetches ONLY the restricted codes when codes={KBANK_ONLY_CODES}', async () => {
    render(wrap(<CashAccountSelect onChange={vi.fn()} value="11-1201" codes={KBANK_ONLY_CODES} />));
    await waitFor(() =>
      expect(apiGet).toHaveBeenCalledWith('/chart-of-accounts/by-codes?codes=11-1201'),
    );
    // The selected KBank account renders its display name in the trigger.
    expect(await screen.findByText(/ธนาคาร KBank/)).toBeInTheDocument();
  });
});
