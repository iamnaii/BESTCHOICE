import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ContactCombobox } from './ContactCombobox';
import { pickComboOption } from '@/test/combobox';

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

const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

// Mock CreateContactModal: when open=true it renders one button that fires onCreated
// with a stub result (simulates a user filling and submitting the form). The data-*
// attributes expose what ContactCombobox passed in.
vi.mock('./CreateContactModal', () => ({
  default: ({
    open,
    role,
    initialName,
    onCreated,
  }: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    role: string;
    initialName?: string;
    onCreated: (r: { contactId: string; childId: string; name: string; taxId: string }) => void;
  }) => {
    if (!open) return null;
    return (
      <button
        data-testid="mock-create-modal-submit"
        data-role={role}
        data-initial-name={initialName}
        onClick={() => onCreated({ contactId: 'ct9', childId: 'sup9', name: 'New Co', taxId: '' })}
      >
        mock-submit
      </button>
    );
  },
}));

type Props = React.ComponentProps<typeof ContactCombobox>;

function renderCombo(props: Partial<Props> = {}, before?: ReactNode) {
  const onSelect = vi.fn();
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      {before}
      <ContactCombobox roleNeeded="SUPPLIER" value="" onSelect={onSelect} {...props} />
    </QueryClientProvider>,
  );
  return { onSelect, qc };
}

const ABC = {
  id: 'c1',
  name: 'ABC Co',
  taxId: '0105500000001',
  phone: '021111111',
  roles: ['CUSTOMER'],
};
const ABC_TWIN = { id: 'c2', name: 'ABC Co', taxId: null, phone: '022222222', roles: ['SUPPLIER'] };
const XYZ = {
  id: 'c3',
  name: 'XYZ Ltd',
  taxId: null,
  phone: null,
  roles: ['SUPPLIER', 'CUSTOMER'],
};
const page = (data: unknown[]) => ({ data, total: data.length, page: 1, limit: 20 });
const MOUNT_KEY = ['contacts', 'list', { search: undefined, isActive: true, limit: 20 }];
const SEARCH_PLACEHOLDER = 'ค้นหาผู้ติดต่อ / เลขภาษี...';

/** The mount-time (empty search) query has landed. */
async function settled(qc: QueryClient) {
  await waitFor(() => expect(qc.getQueryState(MOUNT_KEY)?.status).not.toBe('pending'));
}
const searchBox = () => screen.getByPlaceholderText(SEARCH_PLACEHOLDER);
const checkOf = (row: HTMLElement) => row.querySelector('svg.lucide-check');
const rowsNamed = (name: string) =>
  screen.getAllByRole('option').filter((r) => r.textContent?.startsWith(name));

beforeEach(() => {
  listMock.mockReset();
  ensureRoleMock.mockReset();
  toastMock.error.mockReset();
});

describe('ContactCombobox', () => {
  it('searches all contacts (no role filter) and provisions the role on pick', async () => {
    listMock.mockResolvedValue({
      data: [{ id: 'c1', name: 'ABC Co', taxId: '0105500000001', roles: ['CUSTOMER'] }],
      total: 1,
      page: 1,
      limit: 20,
    });
    ensureRoleMock.mockResolvedValue({
      contactId: 'c1',
      role: 'SUPPLIER',
      supplierId: 'sup1',
      provisioned: true,
    });
    const { onSelect } = renderCombo();

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

  it('shows สร้างผู้ติดต่อใหม่ action when search has no matching contacts; clicking it opens modal and onSelect receives created result', async () => {
    // No contacts match the search term
    listMock.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });
    const { onSelect } = renderCombo();

    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.type(screen.getByPlaceholderText(/ค้นหา/), 'New Co');

    // The create action item should appear
    const createItem = await screen.findByText(/สร้างผู้ติดต่อใหม่/);
    expect(createItem).toBeDefined();

    // Click the create action — opens the (mocked) modal
    await userEvent.click(createItem);

    // The mock modal renders a submit button; click it to fire onCreated
    const submitBtn = await screen.findByTestId('mock-create-modal-submit');
    await userEvent.click(submitBtn);

    // onSelect should have been called with the shape returned by CreateContactModal
    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith({
        contactId: 'ct9',
        childId: 'sup9',
        name: 'New Co',
        taxId: '',
      }),
    );
  });
});

// R2-3b characterization — pinned on the cmdk version BEFORE the Combobox switch (spec §6.4).
// Every test here must pass unchanged on both the old and the new implementation.
describe('ContactCombobox — characterization (R2-3b)', () => {
  it('loads the first 20 active contacts on mount, before the menu is ever opened', async () => {
    listMock.mockResolvedValue(page([ABC]));
    renderCombo();
    await waitFor(() =>
      expect(listMock).toHaveBeenCalledWith({ search: undefined, isActive: true, limit: 20 }),
    );
    expect(screen.getByRole('combobox', { name: 'ผู้จัดจำหน่าย' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('opens straight onto the preloaded rows — no loading state', async () => {
    listMock.mockResolvedValue(page([ABC, XYZ]));
    const user = userEvent.setup();
    const { qc } = renderCombo();
    await settled(qc);

    await user.click(screen.getByRole('combobox', { name: 'ผู้จัดจำหน่าย' }));

    expect(screen.getByRole('option', { name: /^ABC Co/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /^XYZ Ltd/ })).toBeInTheDocument();
    expect(screen.queryByText(/กำลังโหลด/)).toBeNull();
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it('the trigger shows the value text (a display name) with a title, or the placeholder', async () => {
    listMock.mockResolvedValue(page([]));
    renderCombo({ value: 'ABC Co' });
    const trigger = screen.getByRole('combobox', { name: 'ผู้จัดจำหน่าย' });
    expect(trigger).toHaveTextContent('ABC Co');
    expect(trigger).toContainElement(screen.getByTitle('ABC Co'));
  });

  it('empty value shows the default placeholder "เลือก/ค้นหาผู้ติดต่อ" (or the caller one)', () => {
    listMock.mockResolvedValue(page([]));
    renderCombo();
    expect(screen.getByRole('combobox', { name: 'ผู้จัดจำหน่าย' })).toHaveTextContent(
      'เลือก/ค้นหาผู้ติดต่อ',
    );
  });

  it.each([
    ['SUPPLIER', 'ผู้จัดจำหน่าย'],
    ['CUSTOMER', 'ลูกค้า'],
    ['TRADE_IN_SELLER', 'คนขายมือสอง'],
  ] as const)('without an id the trigger is named by role: %s → %s', (roleNeeded, name) => {
    listMock.mockResolvedValue(page([]));
    renderCombo({ roleNeeded });
    expect(screen.getByRole('combobox', { name })).toHaveAttribute('aria-label', name);
  });

  it('with an id the trigger takes its name from the caller label and sets no aria-label', () => {
    listMock.mockResolvedValue(page([]));
    renderCombo({ id: 'vendor-x' }, <label htmlFor="vendor-x">ผู้ขาย *</label>);
    const trigger = screen.getByRole('combobox', { name: 'ผู้ขาย *' });
    expect(trigger).toHaveAttribute('id', 'vendor-x');
    expect(trigger).not.toHaveAttribute('aria-label');
  });

  it('ticks every row whose NAME equals the value (ids are never compared)', async () => {
    listMock.mockResolvedValue(page([ABC, ABC_TWIN, XYZ]));
    const user = userEvent.setup();
    const { qc } = renderCombo({ value: 'ABC Co' });
    await settled(qc);
    await user.click(screen.getByRole('combobox', { name: 'ผู้จัดจำหน่าย' }));

    const abcRows = rowsNamed('ABC Co');
    expect(abcRows).toHaveLength(2);
    for (const r of abcRows) expect(checkOf(r)).toHaveClass('opacity-100');
    expect(checkOf(rowsNamed('XYZ Ltd')[0])).toHaveClass('opacity-0');
  });

  it('a value that is no contact name (legacy snapshot) shows in the trigger and ticks nothing', async () => {
    listMock.mockResolvedValue(page([ABC, XYZ]));
    const user = userEvent.setup();
    const { qc } = renderCombo({ value: 'ผู้ขายเก่า (ไม่อยู่ในสมุด)' });
    await settled(qc);
    const trigger = screen.getByRole('combobox', { name: 'ผู้จัดจำหน่าย' });
    expect(trigger).toHaveTextContent('ผู้ขายเก่า (ไม่อยู่ในสมุด)');
    await user.click(trigger);

    const rows = screen.getAllByRole('option');
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(checkOf(r)).toHaveClass('opacity-0');
  });

  it('a row shows one badge per role and "ข้อมูลไม่ครบ" when the contact has no phone', async () => {
    listMock.mockResolvedValue(page([XYZ, ABC]));
    const user = userEvent.setup();
    const { qc } = renderCombo();
    await settled(qc);
    await user.click(screen.getByRole('combobox', { name: 'ผู้จัดจำหน่าย' }));

    const xyz = screen.getByRole('option', { name: /^XYZ Ltd/ });
    expect(within(xyz).getByText('ผู้จัดจำหน่าย')).toBeInTheDocument();
    expect(within(xyz).getByText('ลูกค้า')).toBeInTheDocument();
    expect(within(xyz).getByText('ข้อมูลไม่ครบ')).toBeInTheDocument();
    const abc = screen.getByRole('option', { name: /^ABC Co/ });
    expect(within(abc).queryByText('ข้อมูลไม่ครบ')).toBeNull();
  });

  it('while ensure-role runs the list shows only "กำลังเพิ่ม…" and stays open; it closes and reports on success', async () => {
    listMock.mockResolvedValue(page([ABC, XYZ]));
    let resolveRole!: (v: unknown) => void;
    ensureRoleMock.mockReturnValue(
      new Promise((r) => {
        resolveRole = r;
      }),
    );
    const user = userEvent.setup();
    const { onSelect, qc } = renderCombo();
    await settled(qc);
    const trigger = screen.getByRole('combobox', { name: 'ผู้จัดจำหน่าย' });
    await user.click(trigger);
    await user.click(screen.getByRole('option', { name: /^ABC Co/ }));

    expect(await screen.findByText(/กำลังเพิ่ม/)).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /^XYZ Ltd/ })).toBeNull();
    expect(searchBox()).toBeInTheDocument(); // menu still open
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(ensureRoleMock).toHaveBeenCalledWith('c1', 'SUPPLIER');
    expect(onSelect).not.toHaveBeenCalled();

    resolveRole({ contactId: 'c1', role: 'SUPPLIER', supplierId: 'sup1', provisioned: true });
    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith({
        contactId: 'c1',
        childId: 'sup1',
        name: 'ABC Co',
        taxId: '0105500000001',
      }),
    );
    await waitFor(() => expect(screen.queryByPlaceholderText(SEARCH_PLACEHOLDER)).toBeNull());
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it.each([
    ['CUSTOMER', 'ลูกค้า', { customerId: 'cus1' }, 'cus1'],
    ['TRADE_IN_SELLER', 'คนขายมือสอง', {}, 'c1'],
  ] as const)(
    '%s: childId = supplierId ?? customerId ?? contact id',
    async (roleNeeded, name, extra, childId) => {
      listMock.mockResolvedValue(page([ABC]));
      ensureRoleMock.mockResolvedValue({
        contactId: 'c1',
        role: roleNeeded,
        provisioned: true,
        ...extra,
      });
      const user = userEvent.setup();
      const { onSelect, qc } = renderCombo({ roleNeeded });
      await settled(qc);
      await user.click(screen.getByRole('combobox', { name }));
      await user.click(screen.getByRole('option', { name: /^ABC Co/ }));
      await waitFor(() => expect(ensureRoleMock).toHaveBeenCalledWith('c1', roleNeeded));
      await waitFor(() =>
        expect(onSelect).toHaveBeenCalledWith({
          contactId: 'c1',
          childId,
          name: 'ABC Co',
          taxId: '0105500000001',
        }),
      );
    },
  );

  it('when ensure-role fails: toast, the menu stays open with its rows and search text, no pick', async () => {
    listMock.mockImplementation(async ({ search }: { search?: string }) =>
      page(search ? [ABC] : [ABC, XYZ]),
    );
    ensureRoleMock.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    const { onSelect, qc } = renderCombo();
    await settled(qc);
    await user.click(screen.getByRole('combobox', { name: 'ผู้จัดจำหน่าย' }));
    await user.type(searchBox(), 'ABC');
    await waitFor(() =>
      expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ search: 'ABC' })),
    );
    await user.click(await screen.findByRole('option', { name: /^ABC Co/ }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        'ไม่สามารถเพิ่มบทบาทให้ผู้ติดต่อได้ กรุณาลองใหม่อีกครั้ง',
      ),
    );
    expect(await screen.findByRole('option', { name: /^ABC Co/ })).toBeInTheDocument();
    expect(searchBox()).toHaveValue('ABC');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it.each([
    ['SUPPLIER', 'ผู้จัดจำหน่าย', 'SUPPLIER'],
    ['CUSTOMER', 'ลูกค้า', 'CUSTOMER'],
    ['TRADE_IN_SELLER', 'คนขายมือสอง', 'CUSTOMER'],
  ] as const)(
    'Enter with no exact name match opens create-contact (%s → modal role %s) with the typed name',
    async (roleNeeded, name, modalRole) => {
      listMock.mockImplementation(async ({ search }: { search?: string }) =>
        page(search ? [ABC] : []),
      );
      const user = userEvent.setup();
      const { qc } = renderCombo({ roleNeeded });
      await settled(qc);
      await user.click(screen.getByRole('combobox', { name }));
      await user.type(searchBox(), 'AB');
      await screen.findByRole('option', { name: /^ABC Co/ }); // results for "AB" are in
      await user.keyboard('{Enter}');

      const modal = await screen.findByTestId('mock-create-modal-submit');
      expect(modal).toHaveAttribute('data-role', modalRole);
      expect(modal).toHaveAttribute('data-initial-name', 'AB');
      expect(ensureRoleMock).not.toHaveBeenCalled();
    },
  );

  it('Enter when a loaded contact matches the typed name exactly (any case) picks the highlighted row instead', async () => {
    listMock.mockImplementation(async ({ search }: { search?: string }) =>
      page(search ? [ABC, XYZ] : []),
    );
    ensureRoleMock.mockResolvedValue({
      contactId: 'c1',
      role: 'SUPPLIER',
      supplierId: 'sup1',
      provisioned: true,
    });
    const user = userEvent.setup();
    const { onSelect, qc } = renderCombo();
    await settled(qc);
    await user.click(screen.getByRole('combobox', { name: 'ผู้จัดจำหน่าย' }));
    await user.type(searchBox(), 'abc co');
    await screen.findByRole('option', { name: /^ABC Co/ });
    await user.keyboard('{Enter}');

    await waitFor(() => expect(ensureRoleMock).toHaveBeenCalledWith('c1', 'SUPPLIER'));
    await waitFor(() => expect(onSelect).toHaveBeenCalled());
    expect(screen.queryByTestId('mock-create-modal-submit')).toBeNull();
  });

  it('Enter inside the 300 ms debounce judges "exact match" on the previous results — opens create even though the server has that name (pinned, current behaviour)', async () => {
    listMock.mockImplementation(async ({ search }: { search?: string }) =>
      page(search ? [ABC] : [XYZ]),
    );
    const user = userEvent.setup();
    const { qc } = renderCombo();
    await settled(qc);
    await user.click(screen.getByRole('combobox', { name: 'ผู้จัดจำหน่าย' }));
    await user.type(searchBox(), 'ABC Co{Enter}');

    const modal = await screen.findByTestId('mock-create-modal-submit');
    expect(modal).toHaveAttribute('data-initial-name', 'ABC Co');
    expect(ensureRoleMock).not.toHaveBeenCalled();
  });

  it('TRADE_IN_SELLER create: adds the role to the new person, reports childId = contactId', async () => {
    listMock.mockResolvedValue(page([]));
    ensureRoleMock.mockResolvedValue({
      contactId: 'ct9',
      role: 'TRADE_IN_SELLER',
      provisioned: true,
    });
    const user = userEvent.setup();
    const { onSelect, qc } = renderCombo({ roleNeeded: 'TRADE_IN_SELLER' });
    await settled(qc);
    await user.click(screen.getByRole('combobox', { name: 'คนขายมือสอง' }));
    await user.type(searchBox(), 'New Co');
    await user.click(await screen.findByText(/สร้างผู้ติดต่อใหม่/));
    await user.click(await screen.findByTestId('mock-create-modal-submit'));

    await waitFor(() => expect(ensureRoleMock).toHaveBeenCalledWith('ct9', 'TRADE_IN_SELLER'));
    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith({
        contactId: 'ct9',
        childId: 'ct9',
        name: 'New Co',
        taxId: '',
      }),
    );
  });

  it('TRADE_IN_SELLER create: when adding the role fails → toast, no pick', async () => {
    listMock.mockResolvedValue(page([]));
    ensureRoleMock.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    const { onSelect, qc } = renderCombo({ roleNeeded: 'TRADE_IN_SELLER' });
    await settled(qc);
    await user.click(screen.getByRole('combobox', { name: 'คนขายมือสอง' }));
    await user.type(searchBox(), 'New Co');
    await user.click(await screen.findByText(/สร้างผู้ติดต่อใหม่/));
    await user.click(await screen.findByTestId('mock-create-modal-submit'));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        'ไม่สามารถเพิ่มบทบาทผู้ขายมือสองได้ กรุณาลองใหม่อีกครั้ง',
      ),
    );
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('no contacts and an empty search: the list says "พิมพ์เพื่อค้นหาผู้ติดต่อ"', async () => {
    listMock.mockResolvedValue(page([]));
    const user = userEvent.setup();
    const { qc } = renderCombo();
    await settled(qc);
    await user.click(screen.getByRole('combobox', { name: 'ผู้จัดจำหน่าย' }));
    expect(screen.getByText('พิมพ์เพื่อค้นหาผู้ติดต่อ')).toBeInTheDocument();
  });

  it('a failed load says "โหลดข้อมูลไม่สำเร็จ"', async () => {
    listMock.mockRejectedValue(new Error('down'));
    const user = userEvent.setup();
    const { qc } = renderCombo();
    await settled(qc);
    await user.click(screen.getByRole('combobox', { name: 'ผู้จัดจำหน่าย' }));
    expect(await screen.findByText('โหลดข้อมูลไม่สำเร็จ')).toBeInTheDocument();
  });

  it('even when the search fails, a typed name can still be created (create action stays)', async () => {
    listMock.mockRejectedValue(new Error('down'));
    const user = userEvent.setup();
    const { qc } = renderCombo();
    await settled(qc);
    await user.click(screen.getByRole('combobox', { name: 'ผู้จัดจำหน่าย' }));
    await user.type(searchBox(), 'New Co');
    await waitFor(() =>
      expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ search: 'New Co' })),
    );
    await user.click(await screen.findByText(/สร้างผู้ติดต่อใหม่ "New Co"/));
    expect(await screen.findByTestId('mock-create-modal-submit')).toHaveAttribute(
      'data-initial-name',
      'New Co',
    );
  });
});

// After the switch (R2-3b): the shared Combobox contract and the strict pick path.
describe('ContactCombobox — on the shared Combobox (R2-3b)', () => {
  it('the trigger is the shared Combobox trigger (44px form-control skin, listbox popup)', () => {
    listMock.mockResolvedValue(page([]));
    renderCombo();
    const trigger = screen.getByRole('combobox', { name: 'ผู้จัดจำหน่าย' });
    expect(trigger).toHaveAttribute('data-slot', 'combobox-trigger');
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
    expect(trigger).toHaveClass('rounded-lg', 'border-input', 'bg-background', 'h-11');
  });

  it('pickComboOption: search → pick → ensure-role → onSelect (strict)', async () => {
    listMock.mockImplementation(async ({ search }: { search?: string }) =>
      page(search ? [ABC] : [XYZ]),
    );
    ensureRoleMock.mockResolvedValue({
      contactId: 'c1',
      role: 'SUPPLIER',
      supplierId: 'sup1',
      provisioned: true,
    });
    const user = userEvent.setup();
    const { onSelect, qc } = renderCombo();
    await settled(qc);
    await pickComboOption(user, 'ผู้จัดจำหน่าย', /^ABC Co/, { search: 'ABC' });
    expect(ensureRoleMock).toHaveBeenCalledWith('c1', 'SUPPLIER');
    expect(onSelect).toHaveBeenCalledWith({
      contactId: 'c1',
      childId: 'sup1',
      name: 'ABC Co',
      taxId: '0105500000001',
    });
  });

  it('no match: the "ไม่พบผู้ติดต่อ…" line now shows above the create action (was hidden by cmdk)', async () => {
    listMock.mockResolvedValue(page([]));
    const user = userEvent.setup();
    const { qc } = renderCombo();
    await settled(qc);
    await user.click(screen.getByRole('combobox', { name: 'ผู้จัดจำหน่าย' }));
    await user.type(searchBox(), 'New Co');
    expect(await screen.findByText('ไม่พบผู้ติดต่อที่ตรงกับ "New Co"')).toBeInTheDocument();
    expect(screen.getByText('+ สร้างผู้ติดต่อใหม่ "New Co"')).toBeInTheDocument();
  });
});
