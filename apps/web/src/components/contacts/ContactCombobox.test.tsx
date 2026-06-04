import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ContactCombobox } from './ContactCombobox';

// jsdom does not implement scrollIntoView; cmdk calls it on CommandItem mount.
// Polyfill here (test-only) so the component can render without throwing.
beforeAll(() => {
  if (!window.HTMLElement.prototype.scrollIntoView) {
    window.HTMLElement.prototype.scrollIntoView = () => {};
  }
});

const listMock = vi.fn();
const ensureRoleMock = vi.fn();
vi.mock('@/lib/api/contacts', () => ({
  contactsApi: {
    list: (...a: unknown[]) => listMock(...a),
    ensureRole: (...a: unknown[]) => ensureRoleMock(...a),
  },
  contactKeys: {
    all: ['contacts'],
    list: (p: unknown) => ['contacts', 'list', p],
    detail: (id: string) => ['contacts', 'detail', id],
  },
}));

function renderCombo(onSelect = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ContactCombobox roleNeeded="SUPPLIER" value="" onSelect={onSelect} />
    </QueryClientProvider>,
  );
  return onSelect;
}

beforeEach(() => {
  listMock.mockReset();
  ensureRoleMock.mockReset();
});

describe('ContactCombobox', () => {
  it('searches all contacts (no role filter) and provisions the role on pick', async () => {
    listMock.mockResolvedValue({
      data: [{ id: 'c1', name: 'ABC Co', taxId: '0105500000001', roles: ['CUSTOMER'] }],
      total: 1, page: 1, limit: 20,
    });
    ensureRoleMock.mockResolvedValue({
      contactId: 'c1', role: 'SUPPLIER', supplierId: 'sup1', provisioned: true,
    });
    const onSelect = renderCombo();

    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.type(screen.getByPlaceholderText(/ค้นหา/), 'ABC');

    const item = await screen.findByText('ABC Co');
    await userEvent.click(item);

    // list was called WITHOUT a role filter
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    expect(listMock.mock.calls.some(([arg]) => (arg as { role?: string }).role === undefined)).toBe(
      true,
    );
    await waitFor(() => expect(ensureRoleMock).toHaveBeenCalledWith('c1', 'SUPPLIER'));
    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith({
        contactId: 'c1',
        childId: 'sup1',
        name: 'ABC Co',
        taxId: '0105500000001',
      }),
    );
  });
});
