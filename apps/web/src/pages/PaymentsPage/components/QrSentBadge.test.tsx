import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { QrSentBadge } from './QrSentBadge';
import api from '@/lib/api';

vi.mock('@/lib/api', () => ({
  default: {
    get: vi.fn(),
    delete: vi.fn(),
  },
  getErrorMessage: vi.fn(() => 'error'),
}));

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const activeLink = (purpose: 'INSTALLMENT' | 'RESCHEDULE') => ({
  id: 'pp-1',
  paymentId: 'pay-1',
  amount: '500',
  paymentUrl: 'https://pay.example/x',
  token: 'TOK123',
  status: 'ACTIVE' as const,
  purpose,
  expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  createdAt: new Date().toISOString(),
});

describe('QrSentBadge — purpose labels', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
  });

  it("purpose RESCHEDULE renders 'QR ปรับดิว' + the pending hint ดิวจะเลื่อนเมื่อเงินเข้า", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: activeLink('RESCHEDULE') });
    render(wrap(<QrSentBadge paymentId="pay-1" />));
    expect(await screen.findByText(/QR ปรับดิว/)).toBeInTheDocument();
    expect(screen.getByText('ดิวจะเลื่อนเมื่อเงินเข้า')).toBeInTheDocument();
  });

  it("purpose INSTALLMENT renders the default 'QR ส่งแล้ว' without the reschedule hint", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: activeLink('INSTALLMENT') });
    render(wrap(<QrSentBadge paymentId="pay-1" />));
    expect(await screen.findByText(/QR ส่งแล้ว/)).toBeInTheDocument();
    expect(screen.queryByText('ดิวจะเลื่อนเมื่อเงินเข้า')).not.toBeInTheDocument();
  });
});
