import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RepairCenterCombobox } from './RepairCenterCombobox';

// Real ContactCombobox underneath — only the HTTP edges are mocked.
const contacts = vi.hoisted(() => ({ list: vi.fn(), ensureRole: vi.fn() }));
vi.mock('@/lib/api/contacts', () => ({
  contactsApi: contacts,
  contactKeys: {
    all: ['contacts'],
    list: (p: unknown) => ['contacts', 'list', p],
    detail: (id: string) => ['contacts', 'detail', id],
  },
}));
const patch = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ default: { patch } }));
const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));
vi.mock('@/components/contacts/CreateContactModal', () => ({ default: () => null }));

const ICARE = {
  id: 'ct1',
  name: 'iCare',
  taxId: '0105500000009',
  phone: '020000000',
  roles: ['SUPPLIER'],
};

function renderPicker(props: Partial<React.ComponentProps<typeof RepairCenterCombobox>> = {}) {
  const onSelect = vi.fn();
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <RepairCenterCombobox value="" onSelect={onSelect} {...props} />
    </QueryClientProvider>,
  );
  return { onSelect };
}
const trigger = () => screen.getByRole('combobox', { name: 'ผู้จัดจำหน่าย' });

beforeEach(() => {
  vi.clearAllMocks();
  contacts.list.mockResolvedValue({ data: [ICARE], total: 1, page: 1, limit: 20 });
  contacts.ensureRole.mockResolvedValue({
    contactId: 'ct1',
    role: 'SUPPLIER',
    supplierId: 'sup-1',
    provisioned: true,
  });
  patch.mockResolvedValue({ data: {} });
});

// R2-3b characterization (wrapper unchanged by the task — pins its external API).
describe('RepairCenterCombobox (R2-3b)', () => {
  it('the trigger shows displayName; the supplier id in `value` is ignored (quirk kept)', () => {
    renderPicker({ value: 'sup-1' });
    expect(trigger()).toHaveTextContent('เลือก/ค้นหาศูนย์ซ่อม');
  });

  it('shows the display name of the current repair center', () => {
    renderPicker({ value: 'sup-1', displayName: 'iCare' });
    expect(trigger()).toHaveTextContent('iCare');
  });

  it('pick → ensure-role SUPPLIER → PATCH repair-center → onSelect({ id: supplierId, name })', async () => {
    const user = userEvent.setup();
    const { onSelect } = renderPicker();
    await user.click(trigger());
    await user.click(await screen.findByRole('option', { name: /^iCare/ }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith({ id: 'sup-1', name: 'iCare' }));
    expect(contacts.ensureRole).toHaveBeenCalledWith('ct1', 'SUPPLIER');
    expect(patch).toHaveBeenCalledWith('/suppliers/sup-1/repair-center');
  });

  it('a failed PATCH still selects, with a toast', async () => {
    patch.mockRejectedValue(new Error('down'));
    const user = userEvent.setup();
    const { onSelect } = renderPicker();
    await user.click(trigger());
    await user.click(await screen.findByRole('option', { name: /^iCare/ }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith({ id: 'sup-1', name: 'iCare' }));
    expect(toastMock.error).toHaveBeenCalledWith(
      'บันทึกเป็นศูนย์ซ่อมไม่สำเร็จ แต่เลือกผู้จัดจำหน่ายแล้ว',
    );
  });
});
