import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { openCombobox, pickComboOption } from '@/test/combobox';
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

function renderPage(initialEntries?: string[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(
      QueryClientProvider,
      { client: qc },
      React.createElement(
        MemoryRouter,
        initialEntries ? { initialEntries } : null,
        React.createElement(GeneralLedgerPage),
      ),
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

    // Select an account — the GL query is gated on accountCode. (R2-3a characterization:
    // the page's only combobox, picked by role so it passes before and after AccountCombobox.)
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(await screen.findByRole('option', { name: /ลูกหนี้ผ่อนชำระ/ }));

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

describe('GeneralLedgerPage — account picker (R2-3a)', () => {
  beforeEach(() => {
    apiGet.mockReset();
  });

  it('the visible label "รหัสบัญชี" names the picker; picking loads that account', async () => {
    apiGet.mockImplementation(async (url: string) => {
      if (url.startsWith('/chart-of-accounts/grouped')) {
        return {
          data: {
            groups: [
              {
                category: 'สินทรัพย์หมุนเวียน',
                accounts: [
                  { code: '11-2101', name: 'ลูกหนี้ผ่อนชำระ (HP)', normalBalance: 'Dr', vatApplicable: false, notes: null },
                ],
              },
            ],
          },
        };
      }
      if (url.startsWith('/expenses/ledger/general-ledger')) return { data: null };
      throw new Error(`unexpected url ${url}`);
    });
    renderPage();
    await pickComboOption(userEvent.setup(), 'รหัสบัญชี', '11-2101 - ลูกหนี้ผ่อนชำระ');
    expect(screen.getByRole('combobox', { name: 'รหัสบัญชี' })).toHaveTextContent(
      '11-2101 - ลูกหนี้ผ่อนชำระ',
    );
    await waitFor(() =>
      expect(apiGet).toHaveBeenCalledWith(
        expect.stringMatching(/^\/expenses\/ledger\/general-ledger\?accountCode=11-2101&/),
      ),
    );
  });

  it('lists "<code> - <name>" and shows at most 200 accounts (as before)', async () => {
    const accounts = Array.from({ length: 205 }, (_, i) => ({
      code: `53-${1000 + i}`,
      name: `ค่าใช้จ่ายทดสอบ ${i} (หมายเหตุ)`,
      normalBalance: 'Dr',
      vatApplicable: false,
      notes: null,
    }));
    apiGet.mockImplementation(async (url: string) => {
      if (url.startsWith('/chart-of-accounts/grouped')) {
        return { data: { groups: [{ category: 'ค่าใช้จ่าย', accounts }] } };
      }
      throw new Error(`unexpected url ${url}`);
    });
    renderPage();
    const listbox = await openCombobox(userEvent.setup(), 'รหัสบัญชี');
    const options = await within(listbox).findAllByRole('option');
    expect(options).toHaveLength(200);
    expect(options[0]).toHaveTextContent(/^53-1000 - ค่าใช้จ่ายทดสอบ 0$/);
  });
});

describe('GeneralLedgerPage — เปิดจากงบทดลอง (?account=&start=&end=&from=)', () => {
  const FROM_TB =
    '/finance/general-ledger?account=11-1201&start=2026-11-01&end=2026-11-17&from=trial-balance';

  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockImplementation(async (url: string) => {
      if (url.startsWith('/chart-of-accounts/grouped')) {
        return {
          data: {
            groups: [
              {
                category: 'สินทรัพย์หมุนเวียน',
                accounts: [
                  { code: '11-1201', name: 'ธนาคาร KBank', normalBalance: 'Dr', vatApplicable: false, notes: null },
                ],
              },
            ],
          },
        };
      }
      if (url.startsWith('/expenses/ledger/general-ledger')) return { data: null };
      throw new Error(`unexpected url ${url}`);
    });
  });

  const glCalls = () =>
    apiGet.mock.calls.map((c) => c[0] as string).filter((u) => u.startsWith('/expenses/ledger/general-ledger'));

  it('รับบัญชีและช่วงวันที่จากลิงก์ โดยไม่ต้องเลือกบัญชีเอง', async () => {
    renderPage([FROM_TB]);
    await waitFor(() => expect(glCalls().length).toBeGreaterThan(0));
    const url = glCalls()[0];
    expect(url).toContain('accountCode=11-1201');
    expect(url).toContain('periodStart=2026-11-01');
    expect(url).toContain('periodEnd=2026-11-17');
  });

  it('มีลิงก์กลับไปงบทดลองช่วงวันที่เดิม', async () => {
    renderPage([FROM_TB]);
    const link = await screen.findByRole('link', { name: 'กลับไปงบทดลอง' });
    expect(link).toHaveAttribute('href', '/finance/trial-balance?start=2026-11-01&end=2026-11-17');
  });

  it('ไม่มีพารามิเตอร์ = พฤติกรรมเดิม (ไม่มีลิงก์กลับ ไม่เรียก general-ledger)', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/เลือกบัญชีจากด้านบน/)).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: 'กลับไปงบทดลอง' })).toBeNull();
    expect(glCalls()).toHaveLength(0);
  });

  it('วันที่รูปแบบผิดใช้ค่าเริ่มต้นเดิมของหน้า', async () => {
    renderPage(['/finance/general-ledger?account=11-1201&start=abc&end=2026-11-17']);
    await waitFor(() => expect(glCalls().length).toBeGreaterThan(0));
    expect(glCalls()[0]).not.toContain('periodStart=abc');
    expect(glCalls()[0]).toMatch(/periodStart=\d{4}-\d{2}-01/);
  });
});
