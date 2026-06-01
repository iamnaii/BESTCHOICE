import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router';
import ContactDetailPage from '../ContactDetailPage';
import { contactsApi } from '@/lib/api/contacts';

vi.mock('@/lib/api/contacts', async (orig) => {
  const actual = await orig<typeof import('@/lib/api/contacts')>();
  return { ...actual, contactsApi: { ...actual.contactsApi, detail: vi.fn() } };
});

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
});
