import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import EmployeeCombobox from '../EmployeeCombobox';
import type { PickableEmployee } from '@/lib/api/employees';

vi.mock('@/lib/api/employees', () => ({
  employeeKeys: { all: ['employees'], pickable: (s: string) => ['employees', 'pickable', s] },
  employeesApi: { pickable: vi.fn() },
}));

const wrap = (ui: React.ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

const EMP: PickableEmployee = {
  userId: 'u1', employeeId: 'EMP-001', name: 'สมชาย ใจดี', nickname: 'ชาย',
  baseSalary: '15000', ssoEligible: true,
};

describe('EmployeeCombobox', () => {
  it('searches and selects an employee (returns the full pickable record)', async () => {
    const { employeesApi } = await import('@/lib/api/employees');
    (employeesApi.pickable as any).mockResolvedValue([EMP]);
    const onSelect = vi.fn();
    const user = userEvent.setup();
    wrap(<EmployeeCombobox value="" onSelect={onSelect} />);

    await user.click(screen.getByRole('combobox'));
    await user.type(screen.getByPlaceholderText(/ค้นหาพนักงาน/), 'สมชาย');
    await waitFor(() => expect(screen.getByText('สมชาย ใจดี')).toBeInTheDocument());
    await user.click(screen.getByText('สมชาย ใจดี'));
    expect(onSelect).toHaveBeenCalledWith(EMP);
  });

  it('shows a registry hint when no employee matches — and NO create action', async () => {
    const { employeesApi } = await import('@/lib/api/employees');
    (employeesApi.pickable as any).mockResolvedValue([]);
    const user = userEvent.setup();
    wrap(<EmployeeCombobox value="" onSelect={vi.fn()} />);

    await user.click(screen.getByRole('combobox'));
    await user.type(screen.getByPlaceholderText(/ค้นหาพนักงาน/), 'ไม่มีคนนี้');
    await waitFor(() => expect(screen.getByText(/เพิ่มที่หน้าทะเบียนพนักงาน/)).toBeInTheDocument());
    expect(screen.queryByText(/สร้างใหม่/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\+ สร้าง/)).not.toBeInTheDocument();
  });

  it('shows the current value as the trigger label (legacy snapshot display)', () => {
    wrap(<EmployeeCombobox value="พนักงานเก่า" onSelect={vi.fn()} />);
    expect(screen.getByRole('combobox')).toHaveTextContent('พนักงานเก่า');
  });
});
