import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CounterpartyPicker } from './CounterpartyPicker';

// Real ContactCombobox underneath — only the HTTP edges are mocked.
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

const ABC = {
  id: 'ct1',
  name: 'ABC Co',
  taxId: '0105500000001',
  phone: '021111111',
  roles: ['CUSTOMER'],
};
const EMPTY = { customerId: null, name: '' };

function renderPicker(value: React.ComponentProps<typeof CounterpartyPicker>['value'] = EMPTY) {
  const onChange = vi.fn();
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <CounterpartyPicker value={value} onChange={onChange} />
    </QueryClientProvider>,
  );
  return { onChange };
}
const trigger = () => screen.getByRole('combobox', { name: 'ลูกค้า' });

beforeEach(() => {
  vi.clearAllMocks();
  contacts.list.mockResolvedValue({ data: [ABC], total: 1, page: 1, limit: 20 });
  contacts.ensureRole.mockResolvedValue({
    contactId: 'ct1',
    role: 'CUSTOMER',
    customerId: 'cus-1',
    provisioned: true,
  });
  contacts.detail.mockResolvedValue({ ...ABC, address: '1 ถนนทดสอบ', phone: '021111111' });
});

// R2-3b characterization (wrapper unchanged by the task — pins its external API).
describe('CounterpartyPicker (R2-3b)', () => {
  it('shows value.name, or its placeholder', () => {
    renderPicker();
    expect(trigger()).toHaveTextContent('ค้นหา/สร้างลูกค้า-คู่ค้า');
  });

  it('pick → ensure-role CUSTOMER → detail → onChange with customerId = child id', async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker();
    await user.click(trigger());
    await user.click(await screen.findByRole('option', { name: /^ABC Co/ }));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        customerId: 'cus-1',
        name: 'ABC Co',
        taxId: '0105500000001',
        address: '1 ถนนทดสอบ',
        phone: '021111111',
      }),
    );
    expect(contacts.ensureRole).toHaveBeenCalledWith('ct1', 'CUSTOMER');
    expect(contacts.detail).toHaveBeenCalledWith('ct1');
  });

  it('a failed detail lookup still reports the pick (no address/phone)', async () => {
    contacts.detail.mockRejectedValue(new Error('down'));
    const user = userEvent.setup();
    const { onChange } = renderPicker({ customerId: null, name: 'เดิม' });
    expect(trigger()).toHaveTextContent('เดิม');
    await user.click(trigger());
    await user.click(await screen.findByRole('option', { name: /^ABC Co/ }));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        customerId: 'cus-1',
        name: 'ABC Co',
        taxId: '0105500000001',
        address: null,
        phone: null,
      }),
    );
  });
});
