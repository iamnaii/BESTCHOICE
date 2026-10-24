import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { it, expect, vi } from 'vitest';

const rows = [
  { id: 'k1', checkType: 'FULL', status: 'MANUAL_REVIEW', aiScore: null, aiSummary: null, aiRecommendation: null, bankName: null,
    createdAt: '2026-10-24T00:00:00Z', customer: { id: 'c1', name: 'ลูกค้าหนึ่ง', phone: null, occupation: null }, contract: null, checkedBy: null },
  { id: 'k2', checkType: 'FULL', status: 'MANUAL_REVIEW', aiScore: null, aiSummary: null, aiRecommendation: null, bankName: null,
    createdAt: '2026-10-24T00:00:00Z', customer: { id: 'c2', name: 'ลูกค้าสอง', phone: null, occupation: null }, contract: null, checkedBy: null },
];
const hard = { level: 'HARD', checkedAt: 't', reasons: [{ code: 'BAD_DEBT', level: 'HARD', message: 'เคยถูกตัดเป็นหนี้สูญ (สัญญา CT-X)' }] };
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'OWNER' } }) }));
vi.mock('@/lib/api', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(async (url: string) => {
      if (url === '/customers/blacklist') return { data: { c1: hard } };
      return { data: { data: rows, total: 2, page: 1, totalPages: 1, summary: { totalCount: 2, pendingCount: 2, approvedCount: 0, rejectedCount: 0, avgScore: 0 } } };
    }),
  },
  getErrorMessage: () => 'error',
}));
import CreditChecksPage from './CreditChecksPage';
import api from '@/lib/api';

it('fetches blacklist results for the customers on the page in one batch and badges only the flagged row', async () => {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><CreditChecksPage /></MemoryRouter></QueryClientProvider>);
  await screen.findByText('ลูกค้าหนึ่ง');
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/customers/blacklist', { params: { ids: 'c1,c2' } }));
  expect(await screen.findAllByText('ติด blacklist · ห้ามทำสัญญา')).toHaveLength(1);
  expect(screen.queryByText('ต้องให้ผู้จัดการอนุมัติ')).not.toBeInTheDocument();
});
