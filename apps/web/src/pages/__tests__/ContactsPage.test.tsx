import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { ReactNode } from 'react';
import ContactsPage from '../ContactsPage';
import { contactsApi } from '@/lib/api/contacts';

vi.mock('@/lib/api/contacts', async (orig) => {
  const actual = await orig<typeof import('@/lib/api/contacts')>();
  return { ...actual, contactsApi: { ...actual.contactsApi, list: vi.fn() } };
});

// Mock CreateContactModal: renders a marker with the requested role, a submit
// button that fires onCreated (simulates form fill + submit), and a close
// button that fires onOpenChange(false) (simulates กดยกเลิก/ESC).
vi.mock('@/components/contacts/CreateContactModal', () => ({
  default: ({
    open,
    onOpenChange,
    role,
    onCreated,
  }: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    role: string;
    onCreated: (r: { contactId: string; childId: string; name: string; taxId: string }) => void;
  }) => {
    if (!open) return null;
    return (
      <div data-testid="mock-create-modal" data-role={role}>
        <button
          data-testid="mock-create-modal-submit"
          onClick={() => onCreated({ contactId: 'ct1', childId: 'cust1', name: 'X', taxId: '' })}
        >
          mock-submit
        </button>
        <button data-testid="mock-create-modal-close" onClick={() => onOpenChange(false)}>
          mock-close
        </button>
      </div>
    );
  },
}));

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/contacts']}>
        <Routes>
          <Route path="/contacts" element={ui} />
          <Route path="/contacts/:id" element={<div data-testid="detail-probe" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
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
});

describe('ContactsPage', () => {
  it('renders contacts returned by the api', async () => {
    wrap(<ContactsPage />);
    await waitFor(() => expect(screen.getByText('นราธิป')).toBeInTheDocument());
    expect(screen.getByText('P-00001')).toBeInTheDocument();
  });

  it('เพิ่มลูกค้า opens CreateContactModal in CUSTOMER mode and navigates to the new contact on create', async () => {
    wrap(<ContactsPage />);
    await waitFor(() => expect(screen.getByText('นราธิป')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /เพิ่มผู้ติดต่อ/ }));
    await userEvent.click(await screen.findByText('เพิ่มลูกค้า'));

    const modal = await screen.findByTestId('mock-create-modal');
    expect(modal.getAttribute('data-role')).toBe('CUSTOMER');

    await userEvent.click(screen.getByTestId('mock-create-modal-submit'));
    await waitFor(() => expect(screen.getByTestId('detail-probe')).toBeInTheDocument());
  });

  it('เพิ่มผู้จัดจำหน่าย opens CreateContactModal in SUPPLIER mode', async () => {
    wrap(<ContactsPage />);
    await waitFor(() => expect(screen.getByText('นราธิป')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /เพิ่มผู้ติดต่อ/ }));
    await userEvent.click(await screen.findByText('เพิ่มผู้จัดจำหน่าย'));

    const modal = await screen.findByTestId('mock-create-modal');
    expect(modal.getAttribute('data-role')).toBe('SUPPLIER');
  });

  it('dismissing the modal removes it without navigating', async () => {
    wrap(<ContactsPage />);
    await waitFor(() => expect(screen.getByText('นราธิป')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /เพิ่มผู้ติดต่อ/ }));
    await userEvent.click(await screen.findByText('เพิ่มลูกค้า'));
    await screen.findByTestId('mock-create-modal');

    await userEvent.click(screen.getByTestId('mock-create-modal-close'));

    await waitFor(() =>
      expect(screen.queryByTestId('mock-create-modal')).not.toBeInTheDocument(),
    );
    // ยังอยู่หน้า list เดิม — ไม่ navigate ไป detail
    expect(screen.queryByTestId('detail-probe')).not.toBeInTheDocument();
    expect(screen.getByText('นราธิป')).toBeInTheDocument();
  });
});
