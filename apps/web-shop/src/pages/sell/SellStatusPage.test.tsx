import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { Buyback } from '@/types/buyback';
import SellStatusPage from './SellStatusPage';
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: { get: mocks.get } }));
vi.mock('@/components/layout/ShopLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
const record: Buyback = {
  id: 'local-request',
  status: 'PENDING_APPRAISAL',
  flow: 'EXCHANGE',
  deviceBrand: 'Apple',
  deviceModel: 'iPhone 17 Pro',
  deviceStorage: '256GB',
  deviceCondition: null,
  batteryHealth: null,
  photoUrls: [],
  estimatedValue: '30250',
  offeredPrice: null,
  agreedPrice: null,
  createdAt: '2026-11-20T00:00:00Z',
  quoteBreakdown: {
    maxPrice: '27500',
    fixedTotal: '0',
    pctTotal: '0',
    price: '30250',
    cashPrice: '27500',
    exchangePrice: '30250',
    bonusPct: '10',
    chosenFlow: 'EXCHANGE',
    lines: [
      {
        label: 'การหักที่ไม่ได้ใช้',
        deductType: 'PERCENT',
        deductValue: '10',
        amount: '2750',
        applied: false,
      },
    ],
  },
};
function mount() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/sell/local-request']}>
        <Routes>
          <Route path="/sell/:id" element={<SellStatusPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue({ data: record });
});
it('describes the instant estimate without confirming a final in-store price', async () => {
  mount();
  await screen.findByText('มูลค่าเครดิตเทิร์นโดยประมาณ');
  expect(screen.getByText(/ไม่จ่ายเป็นเงินสด/)).toBeInTheDocument();
  expect(screen.getByText(/ราคายืนยันจริงตอนตรวจเครื่องที่ร้าน/)).toBeInTheDocument();
  expect(screen.queryByText('การหักที่ไม่ได้ใช้')).not.toBeInTheDocument();
  expect(screen.queryByText('ยืนยันราคาแล้ว')).not.toBeInTheDocument();
});
it('continues the submitted request in LINE and links to the shop map', async () => {
  mount();
  await screen.findByText('มูลค่าเครดิตเทิร์นโดยประมาณ');
  const contact = within(screen.getByRole('region', { name: 'ติดต่อร้านเรื่องขายหรือเทิร์น' }));
  const url = new URL(contact.getByRole('link', { name: 'ทัก LINE' }).getAttribute('href')!);
  expect(url.pathname).toBe('/R/oaMessage/%40bestchoice/');
  const message = decodeURIComponent(url.search.slice(1));
  expect(message).toContain('local-re');
  expect(message).toContain('iPhone 17 Pro 256GB');
  expect(message).toContain('เครดิตเทิร์นโดยประมาณ 30,250 บาท');
  expect(contact.getByRole('link', { name: 'Google Maps' }).getAttribute('href')).toContain(
    'query_place_id=ChIJvw20uboBHjERsefpWFx4SPs',
  );
});
it('preserves offer actions for a non-instant appraisal', async () => {
  mocks.get.mockResolvedValue({
    data: {
      ...record,
      flow: 'BUYBACK',
      status: 'APPRAISED',
      quoteBreakdown: null,
      estimatedValue: null,
      offeredPrice: '25000',
    },
  });
  mount();
  await screen.findByText('ราคาที่ทีมงานเสนอ');
  expect(screen.getByRole('link', { name: 'ยอมรับราคา' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'ปฏิเสธ' })).toBeInTheDocument();
});
