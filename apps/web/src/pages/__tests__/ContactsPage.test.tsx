import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';
import ContactsPage from '../ContactsPage';
import { contactsApi } from '@/lib/api/contacts';

vi.mock('@/lib/api/contacts', async (orig) => {
  const actual = await orig<typeof import('@/lib/api/contacts')>();
  return { ...actual, contactsApi: { ...actual.contactsApi, list: vi.fn() } };
});

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ContactsPage', () => {
  it('renders contacts returned by the api', async () => {
    (contactsApi.list as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [
        {
          id: 'c1',
          contactCode: 'P-00001',
          name: 'นราธิป',
          roles: ['CUSTOMER'],
          isActive: true,
          taxId: null,
          phone: null,
          email: null,
          peakContactCode: null,
        },
      ],
      total: 1,
      page: 1,
      limit: 50,
    });

    wrap(<ContactsPage />);
    await waitFor(() => expect(screen.getByText('นราธิป')).toBeInTheDocument());
    expect(screen.getByText('P-00001')).toBeInTheDocument();
  });
});
