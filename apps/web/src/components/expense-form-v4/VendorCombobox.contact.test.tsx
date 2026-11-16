import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { VendorCombobox } from './VendorCombobox';

// VendorCombobox.test.tsx mocks ContactCombobox; this file runs the real one underneath
// (only the HTTP edges are mocked) so the vendor field is covered end to end.
const contacts = vi.hoisted(() => ({ list: vi.fn(), ensureRole: vi.fn(), detail: vi.fn() }));
vi.mock('@/lib/api/contacts', () => ({
  contactsApi: contacts,
  contactKeys: {
    all: ['contacts'],
    list: (p: unknown) => ['contacts', 'list', p],
    detail: (id: string) => ['contacts', 'detail', id],
  },
}));
vi.mock('@/components/contacts/CreateContactModal', () => ({ default: () => null }));

const ABC = { id: 'ct1', name: 'ABC Co', taxId: '0105', phone: '021111111', roles: ['CUSTOMER'] };

beforeEach(() => {
  vi.clearAllMocks();
  contacts.list.mockResolvedValue({ data: [ABC], total: 1, page: 1, limit: 20 });
  contacts.ensureRole.mockResolvedValue({
    contactId: 'ct1',
    role: 'SUPPLIER',
    supplierId: 'sup-1',
    provisioned: true,
  });
  contacts.detail.mockResolvedValue({ ...ABC, suppliers: [{ type: 'JURISTIC', taxId: '9999' }] });
});

describe('VendorCombobox over the real ContactCombobox (R2-3b)', () => {
  it('labelled by its id; pick → ensure-role SUPPLIER → detail → onSelectSupplier', async () => {
    const onSelectSupplier = vi.fn();
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={qc}>
        <label htmlFor="exp-vendor">ผู้ขาย *</label>
        <VendorCombobox id="exp-vendor" value="" onSelectSupplier={onSelectSupplier} />
      </QueryClientProvider>,
    );
    const trigger = screen.getByRole('combobox', { name: 'ผู้ขาย *' });
    expect(trigger).toHaveTextContent('เลือก/ค้นหาผู้ขาย');
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: /^ABC Co/ }));
    await waitFor(() =>
      expect(onSelectSupplier).toHaveBeenCalledWith({
        name: 'ABC Co',
        taxId: '9999',
        supplierId: 'sup-1',
        whtFormType: 'PND53',
      }),
    );
    expect(contacts.ensureRole).toHaveBeenCalledWith('ct1', 'SUPPLIER');
  });
});
