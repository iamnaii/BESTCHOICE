import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '@/lib/api';
import { pickComboOption } from '@/test/combobox';
import UserProfilePage from '../UserProfilePage';

vi.mock('@/lib/api', () => ({ default: { get: vi.fn(), patch: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/CashAccountSelect', () => ({ CashAccountSelect: () => null }));
const auth = vi.hoisted(() => ({
  user: {
    id: 'user-1', name: 'พนักงานทดสอบ', email: 'staff@example.test', role: 'SALES',
    yeastarExtension: '101', defaultCashAccountCode: '11-1101',
  } as Record<string, unknown>,
  refresh: vi.fn(),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }));

const extensions = [
  { number: '101', name: 'หมายเลขเดิม', status: 'ONLINE' },
  { number: '102', name: 'หมายเลขใหม่ที่มีชื่อยาว', status: 'ONLINE' },
  { number: '205', name: 'หน้าร้าน', status: 'OFFLINE' },
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <UserProfilePage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
const yeastarCard = () =>
  screen.getByText('ระบบโทรศัพท์ Yeastar PBX').closest('[data-slot="card"]') as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  auth.user.yeastarExtension = '101';
  vi.mocked(api.get).mockResolvedValue({ data: extensions });
  vi.mocked(api.patch).mockResolvedValue({ data: {} });
});

describe('UserProfilePage — Extension Yeastar (Combobox)', () => {
  it('shows the saved extension as "เบอร์ — ชื่อ"; a pick + บันทึก PATCHes the number', async () => {
    const user = userEvent.setup();
    renderPage();
    const trigger = await screen.findByRole('combobox', { name: 'Extension Yeastar (โทรศัพท์)' });
    expect(trigger).toHaveTextContent('101 — หมายเลขเดิม');

    await pickComboOption(user, 'Extension Yeastar (โทรศัพท์)', '102 — หมายเลขใหม่ที่มีชื่อยาว', { search: '102' });
    expect(trigger).toHaveTextContent('102 — หมายเลขใหม่ที่มีชื่อยาว');
    expect(api.patch).not.toHaveBeenCalled(); // draft only until บันทึก

    await user.click(within(yeastarCard()).getByRole('button', { name: 'บันทึก' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/users/me/extension', { extension: '102' }));
    await waitFor(() => expect(auth.refresh).toHaveBeenCalled());
  });

  it('a saved extension the PBX no longer lists still shows its number', async () => {
    auth.user.yeastarExtension = '109';
    renderPage();
    const trigger = await screen.findByRole('combobox', { name: 'Extension Yeastar (โทรศัพท์)' });
    expect(trigger).toHaveTextContent('109');
  });
});
