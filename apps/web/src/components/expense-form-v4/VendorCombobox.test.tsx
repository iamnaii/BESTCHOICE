import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VendorCombobox } from './VendorCombobox';

const detailMock = vi.fn();
vi.mock('@/lib/api/contacts', () => ({
  contactsApi: { detail: (...a: unknown[]) => detailMock(...a) },
}));

// Stub ContactCombobox: a button that fires onSelect with a fixed pick result.
vi.mock('@/components/contacts/ContactCombobox', () => ({
  ContactCombobox: ({ onSelect }: { onSelect: (r: unknown) => void }) => (
    <button
      type="button"
      onClick={() => onSelect({ contactId: 'c1', childId: 'sup1', name: 'ABC Co', taxId: '0105' })}
    >
      pick
    </button>
  ),
}));

beforeEach(() => {
  detailMock.mockReset();
});

describe('VendorCombobox.handleSelect WHT mapping', () => {
  it('maps a JURISTIC supplier to PND53, overrides taxId from the supplier link, and passes supplierId', async () => {
    detailMock.mockResolvedValue({ suppliers: [{ type: 'JURISTIC', taxId: '9999' }] });
    const onSelectSupplier = vi.fn();
    render(<VendorCombobox value="" onSelectSupplier={onSelectSupplier} onTypeName={vi.fn()} />);

    await userEvent.click(screen.getByText('pick'));

    await waitFor(() =>
      expect(onSelectSupplier).toHaveBeenCalledWith({
        name: 'ABC Co',
        taxId: '9999',
        supplierId: 'sup1',
        whtFormType: 'PND53',
      }),
    );
  });

  it('maps an INDIVIDUAL supplier to PND3, keeps the picked taxId, and passes supplierId', async () => {
    detailMock.mockResolvedValue({ suppliers: [{ type: 'INDIVIDUAL', taxId: null }] });
    const onSelectSupplier = vi.fn();
    render(<VendorCombobox value="" onSelectSupplier={onSelectSupplier} onTypeName={vi.fn()} />);

    await userEvent.click(screen.getByText('pick'));

    await waitFor(() =>
      expect(onSelectSupplier).toHaveBeenCalledWith({
        name: 'ABC Co',
        taxId: '0105',
        supplierId: 'sup1',
        whtFormType: 'PND3',
      }),
    );
  });

  it('falls back to the picked values (no whtFormType) when the detail lookup fails, still passes supplierId', async () => {
    detailMock.mockRejectedValue(new Error('boom'));
    const onSelectSupplier = vi.fn();
    render(<VendorCombobox value="" onSelectSupplier={onSelectSupplier} onTypeName={vi.fn()} />);

    await userEvent.click(screen.getByText('pick'));

    await waitFor(() =>
      expect(onSelectSupplier).toHaveBeenCalledWith({
        name: 'ABC Co',
        taxId: '0105',
        supplierId: 'sup1',
        whtFormType: undefined,
      }),
    );
  });
});
