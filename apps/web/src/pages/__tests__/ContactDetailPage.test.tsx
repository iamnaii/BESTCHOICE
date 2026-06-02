import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router';
import ContactDetailPage from '../ContactDetailPage';
import { contactsApi } from '@/lib/api/contacts';
import { useAuth } from '@/contexts/AuthContext';

vi.mock('@/lib/api/contacts', async (orig) => {
  const actual = await orig<typeof import('@/lib/api/contacts')>();
  return {
    ...actual,
    contactsApi: { ...actual.contactsApi, detail: vi.fn(), list: vi.fn(), merge: vi.fn() },
  };
});

vi.mock('@/lib/api/customers', () => ({
  customerKeys: { summary: (id: string) => ['customer-summary', id] },
  customersApi: { summary: vi.fn() },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 'u1', role: 'OWNER', branchId: null },
    isLoading: false,
    isAuthenticated: true,
  })),
}));

function asOwner() {
  (useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    user: { id: 'u1', role: 'OWNER', branchId: null },
    isLoading: false,
    isAuthenticated: true,
  });
}

function wrap(id: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/contacts/${id}`]}>
        <Routes>
          <Route path="/contacts/:id" element={<ContactDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ContactDetailPage', () => {
  it('renders a supplier read-through card with a deep-link to the supplier page', async () => {
    (contactsApi.detail as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'c1',
      contactCode: 'P-00002',
      name: 'บ.แอปเปิล',
      roles: ['SUPPLIER'],
      isActive: true,
      taxId: '0105500000010',
      phone: null,
      email: null,
      peakContactCode: null,
      customers: [],
      tradeInsAsSeller: [],
      externalFinanceCompany: [],
      suppliers: [
        {
          id: 's1',
          name: 'บ.แอปเปิล',
          type: 'JURISTIC',
          taxId: '0105500000010',
          branchCode: '00000',
          contactName: 'คุณเอ',
          contactPhone: '02',
          phone: '02',
          hasVat: true,
          address: 'กทม',
        },
      ],
    });
    wrap('c1');
    await waitFor(() => expect(screen.getAllByText('บ.แอปเปิล').length).toBeGreaterThan(0));
    const link = screen.getByRole('link', { name: /แก้ไข|เปิดข้อมูล|ผู้ขาย/ });
    expect(link).toHaveAttribute('href', '/suppliers/s1');
  });

  it('shows customer financial snapshot from /summary on the customer card', async () => {
    const { customersApi } = await import('@/lib/api/customers');
    (customersApi.summary as any).mockResolvedValue({
      id: 'cus1',
      name: 'นราธิป',
      phone: '08',
      activeContracts: 2,
      overdueCount: 1,
      totalOutstandingThb: 15000,
    });
    (contactsApi.detail as any).mockResolvedValue({
      id: 'c1',
      contactCode: 'P-00001',
      name: 'นราธิป',
      roles: ['CUSTOMER'],
      isActive: true,
      taxId: null,
      phone: '08',
      email: null,
      peakContactCode: null,
      suppliers: [],
      tradeInsAsSeller: [],
      externalFinanceCompany: [],
      customers: [{ id: 'cus1', name: 'นราธิป', prefix: 'คุณ', phone: '08' }],
    });
    wrap('c1');
    await waitFor(() => expect(screen.getByText('นราธิป')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/15,000/)).toBeInTheDocument());
    expect(screen.getByText('ค้างชำระ')).toBeInTheDocument();
  });

  it('OWNER merges a searched duplicate into the current contact', async () => {
    asOwner();
    (contactsApi.detail as any).mockResolvedValue({
      id: 'c1',
      contactCode: 'P-1',
      name: 'A',
      roles: ['CUSTOMER'],
      isActive: true,
      taxId: null,
      phone: null,
      email: null,
      peakContactCode: null,
      customers: [],
      suppliers: [],
      tradeInsAsSeller: [],
      externalFinanceCompany: [],
    });
    (contactsApi.list as any).mockResolvedValue({
      data: [
        {
          id: 'c2',
          contactCode: 'P-2',
          name: 'A dup',
          roles: ['SUPPLIER'],
          isActive: true,
          taxId: '0105',
          phone: null,
          email: null,
          peakContactCode: null,
        },
      ],
      total: 1,
      page: 1,
      limit: 50,
    });
    const mergeSpy = ((contactsApi.merge as any) = vi.fn().mockResolvedValue({ primaryId: 'c1' }));

    const user = userEvent.setup();
    wrap('c1');
    await waitFor(() => expect(screen.getByText('ข้อมูลทั่วไป')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'รวมผู้ติดต่อซ้ำ' }));
    const searchInput = await screen.findByPlaceholderText(/ค้นหา/);
    await user.type(searchInput, 'A dup');

    const candidate = await screen.findByText('A dup');
    await user.click(candidate);

    const confirmBtn = await screen.findByRole('button', { name: 'รวมผู้ติดต่อ' });
    await user.click(confirmBtn);

    await waitFor(() => expect(mergeSpy).toHaveBeenCalledWith('c1', 'c2'));
  });

  it('hides the merge action for non-OWNER roles', async () => {
    (useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      user: { id: 'u2', role: 'SALES', branchId: null },
      isLoading: false,
      isAuthenticated: true,
    });
    (contactsApi.detail as any).mockResolvedValue({
      id: 'c1',
      contactCode: 'P-1',
      name: 'A',
      roles: ['CUSTOMER'],
      isActive: true,
      taxId: null,
      phone: null,
      email: null,
      peakContactCode: null,
      customers: [],
      suppliers: [],
      tradeInsAsSeller: [],
      externalFinanceCompany: [],
    });
    wrap('c1');
    await waitFor(() => expect(screen.getByText('ข้อมูลทั่วไป')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'รวมผู้ติดต่อซ้ำ' })).not.toBeInTheDocument();
  });
});
