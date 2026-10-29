import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, it, expect, vi } from 'vitest';
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
// payroll/meta endpoint (2026-08-06) — resolve with empty whitelist so the
// component falls back to FALLBACK_INCOME_WHITELIST (what these tests exercise).
const apiGet = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ default: { get: apiGet } }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
beforeEach(() => {
  apiGet.mockReset();
  apiGet.mockResolvedValue({ data: { incomeWhitelist: [], cashAccounts: [] } });
});

const EMP: PickableEmployee = {
  userId: 'u1', employeeId: 'EMP-001', name: 'สมชาย ใจดี', nickname: 'ชาย',
  baseSalary: '16000', ssoEligible: true,
};

function Harness({
  initial,
  onValue,
  documentId,
}: {
  initial?: PayrollFormFields;
  onValue?: (v: PayrollFormFields) => void;
  documentId?: string;
}) {
  const [value, setValue] = useState<PayrollFormFields>(
    initial ?? {
      year: 2569,
      month: 6,
      payrollPeriod: '2026-06',
      entityScope: 'SHOP',
      lines: [newPayrollLine()],
    },
  );
  return (
    <PayrollLinesSection
      value={value}
      onChange={(v) => {
        setValue(v);
        onValue?.(v);
      }}
      documentDate="2026-06-01"
      onDocumentDateChange={() => {}}
      branchId="b1"
      documentId={documentId}
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
    expect(screen.getByDisplayValue('16,000')).toBeInTheDocument();
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

    expect(screen.getByDisplayValue('16,000')).toBeInTheDocument();
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

describe('PayrollLinesSection — Payroll D4 system rows', () => {
  it('the employee picker asks for staff payable in this payroll period (final-month resignees)', async () => {
    const { employeesApi } = await import('@/lib/api/employees');
    vi.mocked(employeesApi.pickable).mockResolvedValue([EMP]);
    const user = userEvent.setup();
    wrap(<Harness />);
    await user.click(screen.getAllByRole('combobox').find((el) => el.tagName === 'BUTTON')!);
    await user.type(screen.getByPlaceholderText(/ค้นหาพนักงาน/), 'สมชาย');
    await waitFor(() => expect(employeesApi.pickable).toHaveBeenCalledWith('สมชาย', '2026-06'));
  });

  it('copy previous keeps only typed (MANUAL) income — no system or adjustment rows', async () => {
    const income = (over: Record<string, unknown>) => ({ isTaxable: true, quantity: null, rate: null, multiplier: null, ...over });
    apiGet.mockImplementation((path: string) => {
      if (path.startsWith('/expense-documents?')) {
        return Promise.resolve({ data: { data: [{ id: 'prev-1', status: 'POSTED', documentDate: '2026-06-01' }] } });
      }
      if (path === '/expense-documents/prev-1') {
        return Promise.resolve({
          data: {
            number: 'PR-20260601-0001',
            payroll: {
              entityScope: 'SHOP',
              payrollPeriod: '2026-05',
              lines: [
                {
                  userId: 'u1', employeeName: 'สมชาย ใจดี', baseSalary: '16000', ssoEmployee: '800', whtAmount: '0',
                  customIncome: [
                    income({ accountCode: 'S52-1204', name: 'เบี้ยขยัน', amount: '500', source: 'MANUAL' }),
                    income({ accountCode: 'S52-1202', name: 'OT เม.ย. ที่จ่ายขาด', amount: '200', source: 'ADJUSTMENT' }),
                    income({ accountCode: 'S52-1202', name: 'OT วันทำงาน (1.5 เท่า)', amount: '609.38', source: 'ATTENDANCE_OT', quantity: '6.5', rate: '100', multiplier: '1.5' }),
                  ],
                  customDeduction: [],
                  attendanceSummary: { autoOtEligible: true },
                  systemNotes: { review: [], warnings: [] },
                },
              ],
            },
          },
        });
      }
      return Promise.resolve({ data: { incomeWhitelist: [], cashAccounts: [] } });
    });
    const onValue = vi.fn();
    const user = userEvent.setup();
    wrap(<Harness onValue={onValue} />);
    await user.click(screen.getByRole('button', { name: /ดึงข้อมูลงวดล่าสุดมาเติม/ }));
    await waitFor(() => expect(onValue).toHaveBeenCalled());
    const line = (onValue.mock.calls.at(-1)![0] as PayrollFormFields).lines[0];
    expect(line.customIncome.map((r) => [r.accountCode, r.name, r.amount, r.isAdjustment])).toEqual([
      ['S52-1204', 'เบี้ยขยัน', '500', false],
    ]);
    expect(line.systemIncome).toEqual([]);
    expect(line.attendanceSummary).toBeNull();
    expect(line.systemNotes).toBeNull();
  });

  it('picking another employee clears the stored system rows of the line', async () => {
    const { employeesApi } = await import('@/lib/api/employees');
    vi.mocked(employeesApi.pickable).mockResolvedValue([EMP]);
    const onValue = vi.fn();
    const user = userEvent.setup();
    wrap(
      <Harness
        onValue={onValue}
        initial={{
          year: 2569, month: 6, payrollPeriod: '2026-06', entityScope: 'SHOP',
          lines: [
            newPayrollLine({
              userId: 'u-old', employeeName: 'คนเดิม', baseSalary: '15000',
              systemIncome: [{ source: 'ATTENDANCE_OT', accountCode: 'S52-1202', name: 'OT วันทำงาน (1.5 เท่า)', quantity: '2.0', rate: '93.75', multiplier: '1.5', amount: '187.50' }],
              attendanceSummary: null,
              systemNotes: { review: [], warnings: [{ code: 'NO_PIN' }] },
            }),
          ],
        }}
      />,
    );
    await user.click(screen.getAllByRole('combobox').find((el) => el.tagName === 'BUTTON')!);
    await user.type(screen.getByPlaceholderText(/ค้นหาพนักงาน/), 'สมชาย');
    await user.click(await screen.findByText('สมชาย ใจดี'));
    const line = (onValue.mock.calls.at(-1)![0] as PayrollFormFields).lines[0];
    expect(line.userId).toBe('u1');
    expect(line.systemIncome).toEqual([]);
    expect(line.systemNotes).toBeNull();
  });
});

describe('PayrollLinesSection — fix round 1', () => {
  const stored = (): PayrollFormFields => ({
    year: 2569, month: 10, payrollPeriod: '2026-10', entityScope: 'SHOP',
    lines: [
      newPayrollLine({
        userId: 'u1', employeeName: 'สมศรี มีสุข', baseSalary: '15000',
        systemIncome: [
          { source: 'ATTENDANCE_OT', accountCode: 'S52-1202', name: 'OT วันทำงาน (1.5 เท่า)', quantity: '6.5', rate: '93.75', multiplier: '1.5', amount: '609.38' },
          { source: 'COMMISSION', accountCode: 'S51-1101', name: 'ค่าคอมที่อนุมัติแล้ว', quantity: null, rate: null, multiplier: null, amount: '2500.00' },
        ],
        attendanceSummary: {
          workDays: 25, lateCount: 0, lateMinutes: 0, absent: 0, leave: 0,
          otHours: '6.5', holidayHours: '0.0', holidayOtHours: '0.0', holidayWorkedDays: 0, reviewCount: 0, autoOtEligible: true,
        },
        systemNotes: { review: [], warnings: [{ code: 'NOT_YET_CLOSABLE', closableAt: '2026-11-01T11:00:00.000Z' }] },
      }),
    ],
  });
  const lastLine = (spy: ReturnType<typeof vi.fn>) => (spy.mock.calls.at(-1)![0] as PayrollFormFields).lines[0];

  it('M1: changing the month clears every line\'s stored system rows, summary and notes', async () => {
    const onValue = vi.fn();
    const user = userEvent.setup();
    wrap(<Harness initial={stored()} onValue={onValue} />);
    await user.selectOptions(screen.getByLabelText('เดือน'), '11');
    const line = lastLine(onValue);
    expect((onValue.mock.calls.at(-1)![0] as PayrollFormFields).payrollPeriod).toBe('2026-11');
    expect(line.systemIncome).toEqual([]);
    expect(line.attendanceSummary).toBeNull();
    expect(line.systemNotes).toBeNull();
  });

  it('M1: changing the year clears them too', async () => {
    const onValue = vi.fn();
    const user = userEvent.setup();
    wrap(<Harness initial={stored()} onValue={onValue} />);
    const year = screen.getByLabelText('ปี (พ.ศ.)');
    const other = Array.from((year as HTMLSelectElement).options).find((o) => o.value !== '2569')!.value;
    await user.selectOptions(year, other);
    expect(lastLine(onValue).systemIncome).toEqual([]);
    expect(lastLine(onValue).systemNotes).toBeNull();
  });

  it('M1: switching the employee group clears them too', async () => {
    const onValue = vi.fn();
    const user = userEvent.setup();
    wrap(<Harness initial={stored()} onValue={onValue} />);
    await user.click(screen.getByRole('button', { name: 'ส่วนกลาง (FINANCE)' }));
    const line = lastLine(onValue);
    expect((onValue.mock.calls.at(-1)![0] as PayrollFormFields).entityScope).toBe('FINANCE');
    expect(line.systemIncome).toEqual([]);
    expect(line.attendanceSummary).toBeNull();
    expect(line.systemNotes).toBeNull();
  });

  it('the net sub-line shows only the side that has an amount (no "−0.00")', () => {
    const v = stored();
    v.lines[0].customIncome = [{ uid: 'c1', accountCode: 'S52-1204', name: 'เบี้ยขยัน', amount: '500', isTaxable: true, isAdjustment: false }];
    v.lines[0].customDeduction = [];
    wrap(<Harness initial={v} />);
    expect(screen.queryByText(/−0\.00/)).not.toBeInTheDocument();
    expect(screen.getByText(/^\+[\d,]+\.\d{2}$/)).toBeInTheDocument();
  });

  it('M3: the OT chip counts only attendance rows', () => {
    wrap(<Harness initial={stored()} />);
    expect(screen.getByText('OT 1 แถว')).toBeInTheDocument();
    expect(screen.queryByText('OT 2 แถว')).not.toBeInTheDocument();
  });

  it('M4: copy previous never picks the document being edited', async () => {
    apiGet.mockImplementation((path: string) => {
      if (path.startsWith('/expense-documents?')) {
        return Promise.resolve({
          data: {
            data: [
              { id: 'doc-1', status: 'DRAFT', documentDate: '2026-11-02' },
              { id: 'prev-1', status: 'POSTED', documentDate: '2026-10-02' },
            ],
          },
        });
      }
      if (path === '/expense-documents/prev-1') {
        return Promise.resolve({
          data: {
            number: 'PR-20261002-0001',
            payroll: {
              entityScope: 'SHOP',
              payrollPeriod: '2026-09',
              lines: [{ userId: 'u9', employeeName: 'คนงวดก่อน', baseSalary: '12000', ssoEmployee: '600', whtAmount: '0', customIncome: [], customDeduction: [] }],
            },
          },
        });
      }
      return Promise.resolve({ data: { incomeWhitelist: [], cashAccounts: [] } });
    });
    const onValue = vi.fn();
    const user = userEvent.setup();
    wrap(<Harness initial={stored()} onValue={onValue} documentId="doc-1" />);
    await user.click(screen.getByRole('button', { name: /ดึงข้อมูลงวดล่าสุดมาเติม/ }));
    await waitFor(() => expect(onValue).toHaveBeenCalled());
    expect(apiGet).not.toHaveBeenCalledWith('/expense-documents/doc-1');
    expect(lastLine(onValue).userId).toBe('u9');
  });
});
