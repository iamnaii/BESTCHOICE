import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CompanySwitcher } from './CompanySwitcher';
import { EntityScopeProvider } from '@/contexts/EntityScopeContext';

// Mock useAuth to control what user is "logged in"
const mockUser = vi.fn();

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser(),
    isLoading: false,
    isAuthenticated: true,
  }),
}));

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <EntityScopeProvider>{children}</EntityScopeProvider>
    </QueryClientProvider>
  );
}

describe('CompanySwitcher', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('renders nothing when user has only 1 company', () => {
    mockUser.mockReturnValue({
      id: 'u1',
      role: 'SALES',
      accessibleCompanies: ['SHOP'],
      primaryCompany: 'SHOP',
    });
    const { container } = render(<CompanySwitcher />, { wrapper: Wrapper });
    expect(container.firstChild).toBeNull();
  });

  it('shows one labelled company menu for users with both companies', async () => {
    mockUser.mockReturnValue({
      id: 'u1',
      role: 'OWNER',
      accessibleCompanies: ['SHOP', 'FINANCE'],
      primaryCompany: 'SHOP',
    });
    render(<CompanySwitcher />, { wrapper: Wrapper });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'บริษัทที่แสดงข้อมูล: BESTCHOICE SHOP' }));
    expect(screen.getByRole('menuitemradio', { name: 'BESTCHOICE SHOP' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('menuitemradio', { name: 'BESTCHOICE FINANCE' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('selecting FINANCE updates company scope, storage and cached queries', async () => {
    mockUser.mockReturnValue({
      id: 'u1',
      role: 'OWNER',
      accessibleCompanies: ['SHOP', 'FINANCE'],
      primaryCompany: 'SHOP',
    });
    render(<CompanySwitcher />, { wrapper: Wrapper });
    const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'บริษัทที่แสดงข้อมูล: BESTCHOICE SHOP' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'BESTCHOICE FINANCE' }));
    expect(
      screen.getByRole('button', { name: 'บริษัทที่แสดงข้อมูล: BESTCHOICE FINANCE' }),
    ).toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledOnce();
    invalidate.mockRestore();
    expect(localStorage.getItem('bc-entity-scope')).toBe('FINANCE');
  });
});
