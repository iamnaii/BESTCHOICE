import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import api from '@/lib/api';
import DashboardPage from '../index';
import { homeActionsForRole } from '@/config/work-navigation';

const { openSearch } = vi.hoisted(() => ({ openSearch: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'staff-1', name: 'พนักงานทดสอบ', role: 'SALES', branchName: 'สาขาทดสอบ' },
  }),
}));
vi.mock('@/lib/api', () => ({ default: { get: vi.fn() } }));
vi.mock('@/components/CommandPalette', () => ({ useCommandPalette: () => ({ open: openSearch }) }));
vi.mock('./DashboardMySales', () => ({ default: () => <section aria-label="ยอดขายของฉัน" /> }));

function renderHome() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('staff start screen', () => {
  it('offers four reachable tasks and only loads personal work, without management dashboard queries', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { data: [{ id: 'task-1', title: 'ติดต่อลูกค้าตามนัด', status: 'REVIEW' }], total: 1 },
    });
    renderHome();
    expect(await screen.findByRole('heading', { name: 'เริ่มงานวันนี้' })).toBeInTheDocument();
    expect(screen.getByText(/สาขาทดสอบ/)).toBeInTheDocument();
    for (const [name, href] of [
      ['ขายสินค้า', '/pos'],
      ['ทำสัญญาผ่อน', '/contracts/create'],
      ['รับชำระค่างวด', '/payments'],
      ['ตอบแชทลูกค้า', '/inbox'],
    ]) {
      expect(screen.getByRole('link', { name: new RegExp(`^${name}`) })).toHaveAttribute(
        'href',
        href,
      );
    }
    expect(await screen.findByText('ติดต่อลูกค้าตามนัด')).toBeInTheDocument();
    expect(screen.getByText('รอตรวจทาน')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ดูงานวันนี้ทั้งหมด' })).toHaveAttribute(
      'href',
      '/todos?view=today&assigneeId=me',
    );
    expect(api.get).toHaveBeenCalledExactlyOnceWith('/todos?view=today&assigneeId=me&limit=5');
    fireEvent.click(screen.getByRole('button', { name: 'ค้นหาลูกค้าหรือสัญญา' }));
    expect(openSearch).toHaveBeenCalledOnce();
  });

  it('keeps start actions usable when personal work fails, and allows retry', async () => {
    vi.mocked(api.get)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ data: { data: [], total: 0 } });
    renderHome();
    expect(await screen.findByRole('alert')).toHaveTextContent('โหลดงานวันนี้ไม่สำเร็จ');
    expect(screen.getByRole('link', { name: /^ขายสินค้า/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }));
    expect(
      await screen.findByText('ยังไม่มีงานที่มอบหมายให้คุณครบกำหนดวันนี้'),
    ).toBeInTheDocument();
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  });

  it('does not offer sales/chat actions to roles outside their existing permissions', () => {
    expect(homeActionsForRole('ACCOUNTANT').map((a) => a.id)).toEqual(['payment']);
    expect(homeActionsForRole('FINANCE_MANAGER').map((a) => a.id)).toEqual([
      'payment',
      'chat',
    ]);
    expect(homeActionsForRole('VIEWER')).toEqual([]);
    expect(homeActionsForRole('')).toEqual([]);
  });
});
