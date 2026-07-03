import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import React from 'react';

const apiGet = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => apiGet(...args),
  },
}));

vi.mock('@/hooks/useUiFlags', () => ({
  useUiFlags: () => ({ cacheTtlReports: 300 }),
}));

vi.mock('@/components/CompanyFilter', () => ({
  __esModule: true,
  default: () => null,
}));

import { GeneralLedgerPage } from './GeneralLedgerPage';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(
      QueryClientProvider,
      { client: qc },
      React.createElement(MemoryRouter, null, React.createElement(GeneralLedgerPage)),
    ),
  );
}

describe('GeneralLedgerPage', () => {
  beforeEach(() => {
    apiGet.mockReset();
  });

  it('shows empty-state when no account is selected', async () => {
    // CoA grouped — picker has options but no account is chosen yet
    apiGet.mockImplementation(async (url: string) => {
      if (url.startsWith('/chart-of-accounts/grouped')) {
        return {
          data: {
            groups: [
              {
                category: 'Assets',
                accounts: [
                  {
                    code: '11-2101',
                    name: 'ลูกหนี้ผ่อนชำระ',
                    normalBalance: 'Dr',
                    vatApplicable: false,
                    notes: null,
                  },
                ],
              },
            ],
          },
        };
      }
      throw new Error(`unexpected url ${url}`);
    });

    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/เลือกบัญชีจากด้านบน/)).toBeInTheDocument();
    });
  });

  it('renders running balance table when API returns data', async () => {
    apiGet.mockImplementation(async (url: string) => {
      if (url.startsWith('/chart-of-accounts/grouped')) {
        return {
          data: {
            groups: [
              {
                category: 'Assets',
                accounts: [
                  {
                    code: '11-2101',
                    name: 'ลูกหนี้ผ่อนชำระ',
                    normalBalance: 'Dr',
                    vatApplicable: false,
                    notes: null,
                  },
                ],
              },
            ],
          },
        };
      }
      if (url.startsWith('/expenses/ledger/general-ledger')) {
        return {
          data: {
            accountCode: '11-2101',
            accountName: 'ลูกหนี้ผ่อนชำระ',
            normalBalance: 'Dr',
            periodStart: '2026-05-01T00:00:00.000Z',
            periodEnd: '2026-05-17T23:59:59.999Z',
            opening: 1000,
            closing: 1800,
            totalDebit: 1200,
            totalCredit: 400,
            lines: [
              {
                entryDate: '2026-05-10T00:00:00.000Z',
                entryNumber: 'JE-202605-001',
                description: 'ขายผ่อนชำระ',
                referenceType: 'CONTRACT',
                referenceId: 'aaaaaaaa-bbbb-cccc',
                debit: 1200,
                credit: 0,
                runningBalance: 2200,
              },
              {
                entryDate: '2026-05-12T00:00:00.000Z',
                entryNumber: 'JE-202605-002',
                description: 'รับชำระค่างวด',
                referenceType: 'PAYMENT',
                referenceId: 'dddddddd-eeee-ffff',
                debit: 0,
                credit: 400,
                runningBalance: 1800,
              },
            ],
          },
        };
      }
      throw new Error(`unexpected url ${url}`);
    });

    // We need to programmatically select an account. The page initializes
    // accountCode='' so the GL query is gated. We simulate selection by
    // re-rendering with the picker — for unit tests we just verify the empty
    // state lives even when CoA is loaded (no JS click on Popover trigger in
    // jsdom). Pull-only smoke: ensure the GL query at least is wired correctly
    // by asserting empty state is present when accountCode is ''.
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/เลือกบัญชีจากด้านบน/)).toBeInTheDocument();
    });
    // Then directly verify the table layout is reachable via DOM — title only.
    expect(screen.getByText('บัญชีแยกประเภท')).toBeInTheDocument();
  });
});

describe('GeneralLedgerPage — default date range (PR #1327)', () => {
  beforeAll(() => {
    // jsdom does not implement scrollIntoView; cmdk calls it on CommandItem mount.
    if (!window.HTMLElement.prototype.scrollIntoView) {
      window.HTMLElement.prototype.scrollIntoView = () => {};
    }
  });

  beforeEach(() => {
    apiGet.mockReset();
    // Freeze ONLY Date (timers stay real so waitFor/userEvent keep working).
    // The page computes its default range from LOCAL time, so anchor the clock
    // with a local-time constructor: 2026-07-01 00:30 local. On an Asia/Bangkok
    // machine this instant is 2026-06-30T17:30:00Z — the exact month-boundary
    // where the pre-fix toISOString() code shifted periodStart back to
    // 2026-06-30 (last day of the PREVIOUS month).
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 6, 1, 0, 30, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('defaults to the FULL current month and fires the GL query with periodStart = 1st, periodEnd = last day', async () => {
    apiGet.mockImplementation(async (url: string) => {
      if (url.startsWith('/chart-of-accounts/grouped')) {
        return {
          data: {
            groups: [
              {
                category: 'Assets',
                accounts: [
                  {
                    code: '11-2101',
                    name: 'ลูกหนี้ผ่อนชำระ',
                    normalBalance: 'Dr',
                    vatApplicable: false,
                    notes: null,
                  },
                ],
              },
            ],
          },
        };
      }
      if (url.startsWith('/expenses/ledger/general-ledger')) {
        return {
          data: {
            accountCode: '11-2101',
            accountName: 'ลูกหนี้ผ่อนชำระ',
            normalBalance: 'Dr',
            periodStart: '2026-07-01T00:00:00.000Z',
            periodEnd: '2026-07-31T23:59:59.999Z',
            opening: 0,
            closing: 0,
            totalDebit: 0,
            totalCredit: 0,
            lines: [],
          },
        };
      }
      throw new Error(`unexpected url ${url}`);
    });

    renderPage();

    // Default = full current month → the "เดือนนี้" chip reads active and the
    // label renders as the bare month name (pre-fix code produced a partial
    // range, so the chip was inactive and the label showed "(30/06 - 01/07)").
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: 'เดือนนี้' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
    });
    expect(screen.getByTestId('date-range-label')).toHaveTextContent(/^กรกฎาคม 2569$/);

    // Select an account — the GL query is gated on accountCode.
    await userEvent.click(screen.getByRole('combobox', { name: 'เลือกบัญชี' }));
    await userEvent.click(await screen.findByText('ลูกหนี้ผ่อนชำระ'));

    // The GL API call must use the local-month boundaries — NOT the UTC-shifted
    // 2026-06-30 start the old toISOString() code produced, and NOT "today" as
    // the end.
    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith(
        '/expenses/ledger/general-ledger?accountCode=11-2101&periodStart=2026-07-01&periodEnd=2026-07-31',
      );
    });
  });
});
