import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pickComboOption } from '@/test/combobox';

const apiGet = vi.fn();
const apiPut = vi.fn();
vi.mock('@/lib/api', () => ({
  default: {
    get: (...a: unknown[]) => apiGet(...a),
    put: (...a: unknown[]) => apiPut(...a),
  },
  getErrorMessage: () => 'บันทึกไม่สำเร็จ',
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import AccountRolesPage from '../AccountRolesPage';

const ROWS = [
  { id: 'rm-1', role: 'payroll_expense', accountCode: '53-1101', accountName: 'เงินเดือน', priority: 1, isActive: true, note: null, required: false },
  { id: 'rm-2', role: 'legacy_role', accountCode: '99-0000', accountName: null, priority: 1, isActive: true, note: null, required: false },
];
const ACCOUNTS = [
  { code: '53-1101', name: 'เงินเดือน' },
  { code: '53-1102', name: 'ประกันสังคม (นายจ้าง)' },
];

beforeEach(() => {
  apiGet.mockReset();
  apiPut.mockReset();
  apiGet.mockImplementation(async (url: string) => {
    if (url === '/settings/role-map') return { data: ROWS };
    // R1 picker: its own flat query · AccountCombobox: the grouped chart (same active accounts)
    if (url === '/chart-of-accounts')
      return { data: ACCOUNTS.map((a, i) => ({ id: `coa-${i}`, status: 'ใช้งาน', ...a })) };
    if (url === '/chart-of-accounts/grouped')
      return {
        data: {
          groups: [
            {
              category: 'OpEx-บุคลากร',
              accounts: ACCOUNTS.map((a) => ({ ...a, normalBalance: 'Dr', vatApplicable: false, notes: null })),
            },
          ],
        },
      };
    throw new Error(`unexpected url ${url}`);
  });
  apiPut.mockResolvedValue({ data: {} });
});

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AccountRolesPage />
    </QueryClientProvider>,
  );
}

// R2-3a characterization — passes on the R1 cmdk picker and on AccountCombobox.
describe('AccountRolesPage — edit dialog account picker', () => {
  it('shows the mapped code, picks another account and PUTs only accountCode', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'แก้ไข payroll_expense' }));
    const picker = await screen.findByRole('combobox', { name: 'รหัสบัญชี' });
    expect(picker).toHaveTextContent('53-1101');
    await user.click(picker);
    await user.click(await screen.findByRole('option', { name: /ประกันสังคม/ }));
    expect(picker).toHaveTextContent('53-1102');
    await user.click(screen.getByRole('button', { name: 'บันทึก' }));
    await waitFor(() =>
      expect(apiPut).toHaveBeenCalledWith('/settings/role-map/rm-1', { accountCode: '53-1102' }),
    );
  });

  it('a mapped code that is not in the chart still shows its code', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'แก้ไข legacy_role' }));
    expect(await screen.findByRole('combobox', { name: 'รหัสบัญชี' })).toHaveTextContent('99-0000');
  });

  it('the first Escape closes only the account menu, the second closes the dialog', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'แก้ไข payroll_expense' }));
    await user.click(await screen.findByRole('combobox', { name: 'รหัสบัญชี' }));
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(apiPut).not.toHaveBeenCalled();
  });
});

describe('AccountRolesPage — AccountCombobox (R2-3a)', () => {
  it('finds an account by code, saves it, and no longer runs its own /chart-of-accounts query', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'แก้ไข payroll_expense' }));
    await screen.findByRole('combobox', { name: 'รหัสบัญชี' });
    await pickComboOption(user, 'รหัสบัญชี', '53-1102 - ประกันสังคม', { search: '53-1102' });
    expect(screen.getByRole('combobox', { name: 'รหัสบัญชี' })).toHaveTextContent(/^53-1102$/);
    await user.click(screen.getByRole('button', { name: 'บันทึก' }));
    await waitFor(() =>
      expect(apiPut).toHaveBeenCalledWith('/settings/role-map/rm-1', { accountCode: '53-1102' }),
    );
    expect(apiGet).not.toHaveBeenCalledWith('/chart-of-accounts', expect.anything());
  });
});
