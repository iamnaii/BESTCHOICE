import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import EmployeeCombobox from '../EmployeeCombobox';

// Real employeesApi + employeeKeys; only the HTTP client is mocked → pins GET /employees/pickable params.
const get = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ default: { get } }));

const EMP = {
  userId: 'u1',
  employeeId: 'EMP-001',
  name: 'สมชาย ใจดี',
  nickname: 'ชาย',
  baseSalary: '15000',
  ssoEligible: true,
};

function renderCombo(period?: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <EmployeeCombobox value="" onSelect={vi.fn()} period={period} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  get.mockResolvedValue({ data: [EMP] });
});

describe('EmployeeCombobox — GET /employees/pickable (R2-3b characterization)', () => {
  it('sends { period } on open and { search, period } after typing', async () => {
    const user = userEvent.setup();
    renderCombo('2026-10');
    expect(get).not.toHaveBeenCalled();
    await user.click(screen.getByRole('combobox', { name: 'พนักงาน' }));
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith('/employees/pickable', { params: { period: '2026-10' } }),
    );
    await user.type(screen.getByPlaceholderText(/ค้นหาพนักงาน/), 'สม');
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith('/employees/pickable', {
        params: { search: 'สม', period: '2026-10' },
      }),
    );
  });

  it('sends no period param when the payroll period is not given', async () => {
    const user = userEvent.setup();
    renderCombo();
    await user.click(screen.getByRole('combobox', { name: 'พนักงาน' }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/employees/pickable', { params: {} }));
  });
});
