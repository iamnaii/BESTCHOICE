import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import LiffNotificationSettings from './LiffNotificationSettings';

vi.mock('@/hooks/useLiffInit', () => ({
  useLiffInit: () => ({ lineId: 'synthetic-line-identity', loading: false, error: null }),
}));

it('renders the three LINE notification preferences with plain labels and decorative icons', () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(['liff-notif-prefs', 'synthetic-line-identity'], {
    paymentReminder: true,
    overdueNotice: false,
    receiptNotification: true,
  });
  render(
    <QueryClientProvider client={client}>
      <LiffNotificationSettings />
    </QueryClientProvider>,
  );

  const preferences = [
    ['แจ้งเตือนค่างวด แจ้งก่อนครบกำหนดชำระ 5, 3, 1 วัน', 'wallet'],
    ['แจ้งค้างชำระ แจ้งเมื่อเลยกำหนดชำระ', 'warning'],
    ['ใบเสร็จ/ยืนยันชำระ ส่งใบเสร็จหลังชำระเงินสำเร็จ', 'receipt'],
  ];
  for (const [name, icon] of preferences) {
    const preference = screen.getByRole('button', { name });
    expect(preference.querySelector('svg.app-icon-' + icon)).toHaveAttribute('aria-hidden', 'true');
  }
});
