import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pickComboOption } from '@/test/combobox';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api', () => ({ default: api }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import StuckContractsSection from './StuckContractsSection';

const rows = [
  {
    contractId: 'c1',
    contractNumber: 'CT-0001',
    customerName: 'สมชาย ผ่อนดี',
    customerPhone: null,
    branchName: 'สาขาลาดพร้าว',
    assignedToId: null,
    assignedToName: null,
    daysIdle: 21,
    outstanding: 4500,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockImplementation((url: string) =>
    Promise.resolve({
      data:
        url === '/users'
          ? {
              data: [
                { id: 'u1', name: 'เมย์', role: 'SALES' },
                { id: 'u2', name: 'สมหญิง รักงาน', role: 'BRANCH_MANAGER' },
              ],
            }
          : rows,
    }),
  );
  api.post.mockResolvedValue({ data: {} });
});

describe('StuckContractsSection — reassign combobox (R2-4a)', () => {
  it('posts the picked staff id for the checked contracts', async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <StuckContractsSection />
      </QueryClientProvider>,
    );
    await user.click(await screen.findByRole('checkbox', { name: 'เลือก CT-0001' }));
    await user.click(screen.getByRole('button', { name: 'มอบหมายใหม่ (1)' }));
    const confirm = screen.getByRole('button', { name: 'ยืนยัน' });
    const picker = screen.getByRole('combobox', { name: 'เลือกผู้รับผิดชอบใหม่' });
    expect(picker).toHaveTextContent('— เลือก —');
    expect(confirm).toBeDisabled();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/users'));

    await pickComboOption(user, 'เลือกผู้รับผิดชอบใหม่', 'สมหญิง รักงาน (BRANCH_MANAGER)', {
      search: 'สมหญิง',
    });

    expect(picker).toHaveTextContent('สมหญิง รักงาน (BRANCH_MANAGER)');
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/overdue/bulk/assign', {
        contractIds: ['c1'],
        assignedToId: 'u2',
      }),
    );
  });
});
