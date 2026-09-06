import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import ContractJournalDialog, { groupByBook } from '../ContractJournalDialog';

const apiGet = vi.fn();
vi.mock('@/lib/api', () => ({
  default: { get: (...args: unknown[]) => apiGet(...args) },
  getErrorMessage: (e: unknown) => String(e),
}));

const je = (over: Record<string, unknown>) => ({
  id: 'je-1',
  entryNumber: 'JE-202609-0001',
  entryDate: '2026-09-01T00:00:00.000Z',
  postedAt: '2026-09-01T01:00:00.000Z',
  description: 'x',
  paymentId: null,
  tag: 'JP5',
  flow: 'repossession',
  deltaApplied: null,
  lateFeePortion: null,
  reversed: false,
  reversedByEntryNumber: null,
  originalEntryId: null,
  lines: [
    { accountCode: '11-1201', accountName: 'KBank', debit: '7000.00', credit: '0.00', description: '' },
    { accountCode: '11-2101', accountName: 'ลูกหนี้', debit: '0.00', credit: '7000.00', description: '' },
  ],
  totalDebit: '7000.00',
  totalCredit: '7000.00',
  isBalanced: true,
  companyCode: 'FINANCE' as const,
  ...over,
});

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => apiGet.mockReset());

describe('groupByBook', () => {
  it('orders FINANCE → SHOP → unknown and drops empty books', () => {
    const groups = groupByBook([
      je({ id: 'a', companyCode: 'SHOP', totalDebit: '10.00' }),
      je({ id: 'b', companyCode: 'FINANCE', totalDebit: '5.50' }),
      je({ id: 'c', companyCode: 'FINANCE', totalDebit: '4.50' }),
    ]);
    expect(groups.map((g) => [g.label, g.items.length, g.totalDebit])).toEqual([
      ['สมุด FINANCE', 2, 10],
      ['สมุด SHOP (หน้าร้าน)', 1, 10],
    ]);
  });
});

describe('ContractJournalDialog', () => {
  it('fetches the contract journal and renders one section per book', async () => {
    apiGet.mockResolvedValue({
      data: [
        je({ id: 'f1', entryNumber: 'JE-202609-0001' }),
        je({
          id: 's1',
          entryNumber: 'JE-202609-0002',
          companyCode: 'SHOP',
          flow: 'shop-inventory-transfer-cogs',
          tag: null,
        }),
      ],
    });
    render(
      <ContractJournalDialog contractId="c-1" contractNumber="TEST-001" onClose={() => {}} />,
      { wrapper },
    );

    expect(await screen.findByText('JE-202609-0001')).toBeInTheDocument();
    expect(screen.getByText('JE-202609-0002')).toBeInTheDocument();
    expect(screen.getByText('สมุด FINANCE')).toBeInTheDocument();
    expect(screen.getByText('สมุด SHOP (หน้าร้าน)')).toBeInTheDocument();
    expect(screen.getByText('JP5 — ยึดเครื่อง')).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith('/contracts/c-1/journal-entries');
  });

  it('shows the empty state when the contract has no JE', async () => {
    apiGet.mockResolvedValue({ data: [] });
    render(<ContractJournalDialog contractId="c-1" onClose={() => {}} />, { wrapper });
    expect(await screen.findByText('ยังไม่มีบันทึกบัญชีของสัญญานี้')).toBeInTheDocument();
  });

  it('does not fetch when closed (contractId null)', () => {
    render(<ContractJournalDialog contractId={null} onClose={() => {}} />, { wrapper });
    expect(apiGet).not.toHaveBeenCalled();
  });
});
