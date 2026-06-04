import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import EmployeesPage from '../EmployeesPage';
import { useAuth } from '@/contexts/AuthContext';

vi.mock('@/lib/api/employees', () => ({
  employeeKeys: {
    all: ['employees'],
    list: (p: unknown) => ['employees', 'list', p],
    detail: (id: string) => ['employees', 'detail', id],
    provisionable: (s: string) => ['employees', 'provisionable', s],
  },
  employeesApi: {
    list: vi.fn(),
    detail: vi.fn(),
    provisionable: vi.fn(),
    provision: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: vi.fn() }));

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <EmployeesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EmployeesPage', () => {
  it('renders the employee list rows', async () => {
    (useAuth as any).mockReturnValue({ user: { role: 'ACCOUNTANT' } });
    const { employeesApi } = await import('@/lib/api/employees');
    (employeesApi.list as any).mockResolvedValue({
      data: [
        {
          id: 'e1',
          userId: 'u1',
          position: 'ช่าง',
          employmentType: 'MONTHLY',
          baseSalary: '15000',
          ssoEligible: true,
          bankName: null,
          bankAccountNo: null,
          taxIdOverride: null,
          note: null,
          resignedDate: null,
          user: {
            id: 'u1',
            name: 'สมชาย',
            nickname: 'ชาย',
            employeeId: 'EMP-001',
            nationalId: '•••••••••0001',
            startDate: null,
            branchId: null,
            isActive: true,
          },
        },
      ],
      total: 1,
      page: 1,
      limit: 50,
    });
    wrap();
    await waitFor(() => expect(screen.getByText('สมชาย')).toBeInTheDocument());
    expect(screen.getByText('ช่าง')).toBeInTheDocument();
    expect(screen.getByText('•••••••••0001')).toBeInTheDocument();
    // manage button visible for ACCOUNTANT
    expect(screen.getByRole('button', { name: /เพิ่มพนักงาน/ })).toBeInTheDocument();
  });

  it('hides the manage button for SALES', async () => {
    (useAuth as any).mockReturnValue({ user: { role: 'SALES' } });
    const { employeesApi } = await import('@/lib/api/employees');
    (employeesApi.list as any).mockResolvedValue({ data: [], total: 0, page: 1, limit: 50 });
    wrap();
    await waitFor(() => expect(screen.getByText('ไม่พบพนักงาน')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /เพิ่มพนักงาน/ })).not.toBeInTheDocument();
  });

  it('opens provision dialog and lists provisionable users', async () => {
    (useAuth as any).mockReturnValue({ user: { role: 'OWNER' } });
    const { employeesApi } = await import('@/lib/api/employees');
    (employeesApi.list as any).mockResolvedValue({ data: [], total: 0, page: 1, limit: 50 });
    (employeesApi.provisionable as any).mockResolvedValue([
      { userId: 'u9', employeeId: 'EMP-009', name: 'ใหม่ มาก', nickname: null },
    ]);
    const user = userEvent.setup();
    wrap();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /เพิ่มพนักงาน/ })).toBeInTheDocument(),
    );
    await user.click(screen.getByRole('button', { name: /เพิ่มพนักงาน/ }));
    await waitFor(() => expect(screen.getByText('ใหม่ มาก')).toBeInTheDocument());
  });
});
