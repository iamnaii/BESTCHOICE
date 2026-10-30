import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import WhtReportPage, { PersonalTable } from './WhtReportPage';

vi.mock('@/lib/api', () => {
  return {
    default: {
      get: vi.fn().mockResolvedValue({ data: [] }),
    },
  };
});

vi.mock('@/components/CompanyFilter', () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <select
      data-testid="company-filter"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">— เลือกบริษัท —</option>
    </select>
  ),
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <WhtReportPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('WhtReportPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders 3 WHT tabs (PND1 / PND3 / PND53)', () => {
    renderPage();
    expect(screen.getByRole('tab', { name: 'ภ.ง.ด.1' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'ภ.ง.ด.3' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'ภ.ง.ด.53' })).toBeInTheDocument();
  });

  it('defaults to PND1 tab with payroll subtitle', () => {
    renderPage();
    // The PND1 subtitle should be present
    expect(screen.getByText(/ม.50\(1\)/)).toBeInTheDocument();
  });

  it('clicking ภ.ง.ด.3 swaps subtitle to ม.3 เตรส (individuals)', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('tab', { name: 'ภ.ง.ด.3' }));
    expect(document.body.textContent ?? '').toMatch(/ม\.3 เตรส, ม\.50\(3\)\(4\)/);
  });

  it('clicking ภ.ง.ด.53 swaps subtitle to ทป.4/2528 (juristic)', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('tab', { name: 'ภ.ง.ด.53' }));
    expect(document.body.textContent ?? '').toMatch(/ทป\.4\/2528/);
  });
});

// คำตัดสินเจ้าของ 2026-10-29 (กระดาน 7) — ภ.ง.ด.1 ใบเดียว แยกช่องภาษีเงินเดือน / ภาษีค่าคอม 3% / รวม
describe('PersonalTable (ภ.ง.ด.1)', () => {
  const item = (name: string, salaryWht: string, commissionWht: string, whtAmount: string) => ({
    employeeName: name, employeeTaxId: null, gross: '15840.63', salaryWht, commissionWht, whtAmount,
    payDate: '2026-12-01T03:00:00.000Z', payrollDocNumber: 'PR-20261201-0001',
  });

  it('a month with commission WHT shows salary, commission 3% and total columns', () => {
    render(<PersonalTable items={[item('สมศรี มีสุข', '0', '21', '21'), item('อรุณี แก้วใส', '420.83', '0', '420.83')]} />);
    expect(screen.getByRole('columnheader', { name: 'ภาษีเงินเดือน (฿)' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'ภาษีค่าคอม 3% (฿)' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'ภาษีที่หักรวม (฿)' })).toBeInTheDocument();
    const cells = within(screen.getByRole('row', { name: /สมศรี มีสุข/ })).getAllByRole('cell').map((c) => c.textContent);
    expect(cells.slice(2, 6)).toEqual(['15,840.63', '0.00', '21.00', '21.00']);
  });

  it('a month without commission WHT keeps the single WHT column (older previews without the split too)', () => {
    render(<PersonalTable items={[{ employeeName: 'วิชัย', employeeTaxId: null, gross: '15000', whtAmount: '100', payDate: '2026-12-01', payrollDocNumber: 'PR-1' }]} />);
    expect(screen.getByRole('columnheader', { name: 'WHT (฿)' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'ภาษีค่าคอม 3% (฿)' })).not.toBeInTheDocument();
  });
});

