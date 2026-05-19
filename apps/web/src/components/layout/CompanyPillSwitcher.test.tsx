import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CompanyPillSwitcher } from './CompanyPillSwitcher';
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

describe('CompanyPillSwitcher', () => {
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
    const { container } = render(<CompanyPillSwitcher />, { wrapper: Wrapper });
    expect(container.firstChild).toBeNull();
  });

  it('renders 2 pills when user has access to both companies', () => {
    mockUser.mockReturnValue({
      id: 'u1',
      role: 'OWNER',
      accessibleCompanies: ['SHOP', 'FINANCE'],
      primaryCompany: 'SHOP',
    });
    render(<CompanyPillSwitcher />, { wrapper: Wrapper });
    expect(screen.getByText('หน้าร้าน')).toBeInTheDocument();
    expect(screen.getByText('ไฟแนนซ์')).toBeInTheDocument();
  });

  it('clicking FINANCE pill switches scope and updates localStorage', () => {
    mockUser.mockReturnValue({
      id: 'u1',
      role: 'OWNER',
      accessibleCompanies: ['SHOP', 'FINANCE'],
      primaryCompany: 'SHOP',
    });
    render(<CompanyPillSwitcher />, { wrapper: Wrapper });
    fireEvent.click(screen.getByText('ไฟแนนซ์'));
    expect(localStorage.getItem('bc-entity-scope')).toBe('FINANCE');
  });
});
