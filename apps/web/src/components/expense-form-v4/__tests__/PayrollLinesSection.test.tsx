import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PayrollLinesSection } from '../PayrollLinesSection';
import { newPayrollLine, type PayrollFormFields } from '../types';
import type { PickableEmployee } from '@/lib/api/employees';

vi.mock('@/lib/api/employees', () => ({
  employeeKeys: { all: ['employees'], pickable: (s: string) => ['employees', 'pickable', s] },
  employeesApi: { pickable: vi.fn() },
}));
vi.mock('@/lib/api/ssoConfig', () => ({
  ssoConfigKeys: { effective: (d: string) => ['sso-config', 'effective', d] },
  ssoConfigApi: { effective: vi.fn() },
}));
vi.mock('@/hooks/useUiFlags', () => ({ useUiFlags: () => ({ taxExemptWarningEnabled: true }) }));

const EMP: PickableEmployee = {
  userId: 'u1', employeeId: 'EMP-001', name: 'สมชาย ใจดี', nickname: 'ชาย',
  baseSalary: '16000', ssoEligible: true,
};

function Harness({ initial }: { initial?: PayrollFormFields }) {
  const [value, setValue] = useState<PayrollFormFields>(
    initial ?? { year: 2569, month: 6, payrollPeriod: '2026-06', lines: [newPayrollLine()] },
  );
  return (
    <PayrollLinesSection
      value={value}
      onChange={setValue}
      documentDate="2026-06-01"
      onDocumentDateChange={() => {}}
    />
  );
}

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('PayrollLinesSection — employee link + pre-fill', () => {
  it('pre-fills base salary and SSO (capped) when an employee is picked', async () => {
    const { employeesApi } = await import('@/lib/api/employees');
    const { ssoConfigApi } = await import('@/lib/api/ssoConfig');
    (employeesApi.pickable as any).mockResolvedValue([EMP]);
    (ssoConfigApi.effective as any).mockResolvedValue({
      salaryCeiling: '17500', maxContribution: '875', effectiveFrom: '2026-01-01', rate: 0.05,
    });
    const user = userEvent.setup();
    wrap(<Harness />);

    // The PayrollLinesSection also renders <select> elements (year/month) which
    // have implicit role="combobox". The EmployeeCombobox trigger is the only
    // <button role="combobox"> — narrow by element type.
    await user.click(screen.getAllByRole('combobox').find((el) => el.tagName === 'BUTTON')!);
    await user.type(screen.getByPlaceholderText(/ค้นหาพนักงาน/), 'สมชาย');
    await waitFor(() => expect(screen.getByText('สมชาย ใจดี')).toBeInTheDocument());
    await user.click(screen.getByText('สมชาย ใจดี'));

    // base prefilled = 16000; SSO = min(16000*0.05, 875) = 800
    expect(screen.getByDisplayValue('16000')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByDisplayValue('800')).toBeInTheDocument());
  });

  it('SSO pre-fill is 0 when the employee is not SSO-eligible', async () => {
    const { employeesApi } = await import('@/lib/api/employees');
    const { ssoConfigApi } = await import('@/lib/api/ssoConfig');
    (employeesApi.pickable as any).mockResolvedValue([{ ...EMP, ssoEligible: false }]);
    (ssoConfigApi.effective as any).mockResolvedValue({
      salaryCeiling: '17500', maxContribution: '875', effectiveFrom: '2026-01-01', rate: 0.05,
    });
    const user = userEvent.setup();
    wrap(<Harness />);

    // The PayrollLinesSection also renders <select> elements (year/month) which
    // have implicit role="combobox". The EmployeeCombobox trigger is the only
    // <button role="combobox"> — narrow by element type.
    await user.click(screen.getAllByRole('combobox').find((el) => el.tagName === 'BUTTON')!);
    await user.type(screen.getByPlaceholderText(/ค้นหาพนักงาน/), 'สมชาย');
    await waitFor(() => expect(screen.getByText('สมชาย ใจดี')).toBeInTheDocument());
    await user.click(screen.getByText('สมชาย ใจดี'));

    expect(screen.getByDisplayValue('16000')).toBeInTheDocument();
    // SSO stays 0 (its input still shows 0)
    const zeros = screen.getAllByDisplayValue('0');
    expect(zeros.length).toBeGreaterThan(0);
  });

  it('taxId column is read-only (server-derived) — no free-text taxId input', () => {
    wrap(<Harness />);
    expect(screen.queryByPlaceholderText('13 หลัก')).not.toBeInTheDocument();
    expect(screen.getByText(/ดึงเลขบัตรอัตโนมัติตอนบันทึก/)).toBeInTheDocument();
  });
});
