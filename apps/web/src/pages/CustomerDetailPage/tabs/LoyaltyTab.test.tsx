import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { LoyaltyHistory } from '../hooks/useCustomerDetailData';
import LoyaltyTab from './LoyaltyTab';

it('renders shared earn and redeem glyphs and keeps the numeric point signs', () => {
  const record = { contractId: null, createdAt: '2026-01-01T00:00:00Z' };
  const loyaltyHistory: LoyaltyHistory = {
    data: [
      { ...record, id: '1', type: 'EARN', points: 25, reason: 'ON_TIME_PAYMENT' },
      { ...record, id: '2', type: 'REDEEM', points: 10, reason: 'OTHER' },
    ],
    total: 2,
    page: 1,
    limit: 10,
  };
  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <LoyaltyTab
        customerId="fixture"
        canEdit={false}
        loyaltyHistory={loyaltyHistory}
        loyaltyPoints={undefined}
        referralStats={undefined}
      />
    </QueryClientProvider>,
  );
  expect(container.querySelector('svg.app-icon-plus')).toHaveAttribute('aria-hidden', 'true');
  expect(container.querySelector('svg.app-icon-minus')).toHaveAttribute('aria-hidden', 'true');
  expect(screen.getByText('+25 แต้ม')).toBeVisible();
  expect(screen.getByText('-10 แต้ม')).toBeVisible();
});
