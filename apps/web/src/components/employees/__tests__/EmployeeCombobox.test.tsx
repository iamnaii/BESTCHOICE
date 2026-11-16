import type { ReactElement } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import EmployeeCombobox from '../EmployeeCombobox';
import { employeesApi, type PickableEmployee } from '@/lib/api/employees';
import { pickComboOption } from '@/test/combobox';

// Real employeeKeys (the cache key carries the payroll period); only the request is mocked.
vi.mock('@/lib/api/employees', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/employees')>()),
  employeesApi: { pickable: vi.fn() },
}));
const pickable = vi.mocked(employeesApi.pickable);

const wrap = (ui: ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
  return {
    qc,
    rerender: (next: ReactElement) =>
      view.rerender(<QueryClientProvider client={qc}>{next}</QueryClientProvider>),
  };
};

const EMP: PickableEmployee = {
  userId: 'u1',
  employeeId: 'EMP-001',
  name: 'สมชาย ใจดี',
  nickname: 'ชาย',
  baseSalary: '15000',
  ssoEligible: true,
};
const EMP2: PickableEmployee = {
  userId: 'u2',
  employeeId: null,
  name: 'สมหญิง ดีใจ',
  nickname: null,
  baseSalary: null,
  ssoEligible: false,
};
const trigger = () => screen.getByRole('combobox', { name: 'พนักงาน' });
const searchBox = () => screen.getByPlaceholderText('ค้นหาพนักงาน (ชื่อ / ชื่อเล่น / รหัส)');
const checkOf = (row: HTMLElement) => row.querySelector('svg.lucide-check');

beforeEach(() => {
  pickable.mockReset();
});

describe('EmployeeCombobox', () => {
  it('searches and selects an employee (returns the full pickable record)', async () => {
    pickable.mockResolvedValue([EMP]);
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
    pickable.mockResolvedValue([]);
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

// R2-3b characterization — pinned on the cmdk version BEFORE the Combobox switch (spec §6.4).
describe('EmployeeCombobox — characterization (R2-3b)', () => {
  it('fetches only while open; the payroll period is in the request and in the cache key', async () => {
    pickable.mockResolvedValue([EMP]);
    const user = userEvent.setup();
    const { qc } = wrap(<EmployeeCombobox value="" onSelect={vi.fn()} period="2026-10" />);
    expect(pickable).not.toHaveBeenCalled();

    await user.click(trigger());
    await waitFor(() => expect(pickable).toHaveBeenCalledWith(undefined, '2026-10'));
    expect(
      qc.getQueryCache().find({ queryKey: ['employees', 'pickable', '', '2026-10'], exact: true }),
    ).toBeDefined();

    await user.type(searchBox(), 'สมชาย');
    await waitFor(() => expect(pickable).toHaveBeenCalledWith('สมชาย', '2026-10'));
    expect(
      qc
        .getQueryCache()
        .find({ queryKey: ['employees', 'pickable', 'สมชาย', '2026-10'], exact: true }),
    ).toBeDefined();
  });

  it('a different period is a different query (people who resigned during that period)', async () => {
    pickable.mockResolvedValue([EMP]);
    const user = userEvent.setup();
    const { rerender } = wrap(<EmployeeCombobox value="" onSelect={vi.fn()} period="2026-10" />);
    await user.click(trigger());
    await waitFor(() => expect(pickable).toHaveBeenCalledWith(undefined, '2026-10'));

    rerender(<EmployeeCombobox value="" onSelect={vi.fn()} period="2026-11" />);
    await waitFor(() => expect(pickable).toHaveBeenCalledWith(undefined, '2026-11'));
  });

  it('without a period the request carries none', async () => {
    pickable.mockResolvedValue([EMP]);
    const user = userEvent.setup();
    wrap(<EmployeeCombobox value="" onSelect={vi.fn()} />);
    await user.click(trigger());
    await waitFor(() => expect(pickable).toHaveBeenCalledWith(undefined, undefined));
  });

  it('ticks the row whose NAME equals the value; a legacy snapshot name ticks none', async () => {
    pickable.mockResolvedValue([EMP, EMP2]);
    const user = userEvent.setup();
    wrap(<EmployeeCombobox value="สมชาย ใจดี" onSelect={vi.fn()} />);
    await user.click(trigger());
    const somchai = await screen.findByRole('option', { name: /^สมชาย ใจดี/ });
    expect(checkOf(somchai)).toHaveClass('opacity-100');
    expect(checkOf(screen.getByRole('option', { name: /^สมหญิง ดีใจ/ }))).toHaveClass('opacity-0');
  });

  it('a legacy snapshot value ticks nothing', async () => {
    pickable.mockResolvedValue([EMP, EMP2]);
    const user = userEvent.setup();
    wrap(<EmployeeCombobox value="พนักงานเก่า" onSelect={vi.fn()} />);
    await user.click(trigger());
    await screen.findByRole('option', { name: /^สมชาย ใจดี/ });
    for (const r of screen.getAllByRole('option')) expect(checkOf(r)).toHaveClass('opacity-0');
  });

  it('a row shows the nickname and the employee code', async () => {
    pickable.mockResolvedValue([EMP]);
    const user = userEvent.setup();
    wrap(<EmployeeCombobox value="" onSelect={vi.fn()} />);
    await user.click(trigger());
    const row = await screen.findByRole('option', { name: /^สมชาย ใจดี/ });
    expect(within(row).getByText('ชาย')).toBeInTheDocument();
    expect(within(row).getByText('EMP-001')).toBeInTheDocument();
  });

  it('empty search with no employees says "พิมพ์เพื่อค้นหาพนักงาน"', async () => {
    pickable.mockResolvedValue([]);
    const user = userEvent.setup();
    wrap(<EmployeeCombobox value="" onSelect={vi.fn()} />);
    await user.click(trigger());
    expect(await screen.findByText('พิมพ์เพื่อค้นหาพนักงาน')).toBeInTheDocument();
  });

  it('a failed load says "โหลดข้อมูลไม่สำเร็จ"', async () => {
    pickable.mockRejectedValue(new Error('down'));
    const user = userEvent.setup();
    wrap(<EmployeeCombobox value="" onSelect={vi.fn()} />);
    await user.click(trigger());
    expect(await screen.findByText('โหลดข้อมูลไม่สำเร็จ')).toBeInTheDocument();
  });

  it('a pick closes the menu at once (no async step) and the next open starts with an empty search', async () => {
    pickable.mockResolvedValue([EMP]);
    const onSelect = vi.fn();
    const user = userEvent.setup();
    wrap(<EmployeeCombobox value="" onSelect={onSelect} />);
    await user.click(trigger());
    await user.type(searchBox(), 'สมชาย');
    await user.click(await screen.findByRole('option', { name: /^สมชาย ใจดี/ }));
    expect(onSelect).toHaveBeenCalledWith(EMP);
    await waitFor(() => expect(screen.queryByRole('option')).toBeNull());
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');

    await user.click(trigger());
    expect(searchBox()).toHaveValue('');
  });

  it('empty value shows the placeholder "เลือกพนักงาน" (or the caller one)', () => {
    wrap(<EmployeeCombobox value="" onSelect={vi.fn()} />);
    expect(trigger()).toHaveTextContent('เลือกพนักงาน');
  });
});

describe('EmployeeCombobox — on the shared Combobox (R2-3b)', () => {
  it('pickComboOption: search → pick → onSelect(full record) (strict)', async () => {
    pickable.mockImplementation(async (search?: string) => (search ? [EMP] : [EMP2]));
    const onSelect = vi.fn();
    const user = userEvent.setup();
    wrap(<EmployeeCombobox value="" onSelect={onSelect} period="2026-10" />);
    await pickComboOption(user, 'พนักงาน', /^สมชาย ใจดี/, { search: 'สมชาย' });
    expect(onSelect).toHaveBeenCalledWith(EMP);
    expect(pickable).toHaveBeenCalledWith('สมชาย', '2026-10');
    expect(trigger()).toHaveAttribute('data-slot', 'combobox-trigger');
  });
});
