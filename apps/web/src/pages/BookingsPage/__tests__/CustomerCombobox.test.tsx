import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CustomerCombobox from '../components/CustomerCombobox';
import type { CustomerOption } from '../types';
import { pickComboOption } from '@/test/combobox';

const mocks = vi.hoisted(() => ({ get: vi.fn(), rows: [] as unknown[], fail: false }));
vi.mock('@/lib/api', () => ({ default: { get: mocks.get } }));
vi.mock('@/components/customer/CustomerCreateDialog', () => ({
  default: ({
    open,
    initialValues,
    onCreated,
  }: {
    open: boolean;
    initialValues?: { firstName?: string; lastName?: string };
    onCreated: (c: { id: string; name: string; phone?: string | null }) => void;
  }) =>
    open ? (
      <div data-testid="create-customer-dialog">
        <output data-testid="create-initial">{JSON.stringify(initialValues ?? null)}</output>
        <button
          type="button"
          onClick={() =>
            onCreated({ id: 'c-new', name: 'ลูกค้าใหม่', phone: '0899999999', extra: 1 } as never)
          }
        >
          บันทึกลูกค้าใหม่ (จำลอง)
        </button>
      </div>
    ) : null,
  splitDisplayName: (s: string) => {
    const [firstName = '', ...rest] = s.trim().split(/\s+/);
    return { firstName, lastName: rest.join(' ') };
  },
}));

const SOMCHAI: CustomerOption = { id: 'c1', name: 'สมชาย ใจดี', phone: '0812345678' };
const LEAD: CustomerOption = {
  id: 'c2',
  name: 'ผู้สนใจจากแชท',
  phone: null,
  chatPlaceholder: true,
};
const url = (search: string) => `/customers?${new URLSearchParams({ limit: '20', search })}`;

function Harness(props: {
  initial?: CustomerOption | null;
  canCreate?: boolean;
  disabled?: boolean;
  onChange: (c: CustomerOption | null) => void;
}) {
  const [value, setValue] = useState<CustomerOption | null>(props.initial ?? null);
  return (
    <CustomerCombobox
      value={value}
      onChange={(c) => {
        setValue(c);
        props.onChange(c);
      }}
      canCreate={props.canCreate ?? true}
      disabled={props.disabled}
    />
  );
}

function renderCombo(props: Partial<Omit<Parameters<typeof Harness>[0], 'onChange'>> = {}) {
  const onChange = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <Harness {...props} onChange={onChange} />
    </QueryClientProvider>,
  );
  return { onChange };
}

const trigger = () => screen.getByRole('combobox', { name: 'ลูกค้า' });
const searchBox = () => screen.getByPlaceholderText('พิมพ์ชื่อหรือเบอร์โทร');

beforeEach(() => {
  mocks.rows = [SOMCHAI, LEAD];
  mocks.fail = false;
  mocks.get.mockReset();
  mocks.get.mockImplementation(async () => {
    if (mocks.fail) throw new Error('ค้นหาล้ม');
    return { data: { data: mocks.rows } };
  });
});

// R2-3b characterization — pinned on the cmdk version BEFORE the Combobox switch (spec §6.4).
describe('Bookings CustomerCombobox — characterization (R2-3b)', () => {
  it('the trigger is named "ลูกค้า" and shows the placeholder when empty', () => {
    renderCombo();
    expect(trigger()).toHaveTextContent('ค้นหาชื่อหรือเบอร์โทรลูกค้า…');
  });

  it('a value shows its name and " · phone" (a chat lead: "จากแชท · ยังไม่มีเบอร์")', () => {
    renderCombo({ initial: SOMCHAI });
    expect(trigger()).toHaveTextContent('สมชาย ใจดี · 0812345678');
  });

  it('a chat lead value says it has no phone yet', () => {
    renderCombo({ initial: LEAD });
    expect(trigger()).toHaveTextContent('ผู้สนใจจากแชท · จากแชท · ยังไม่มีเบอร์');
  });

  it('searches only while open: GET /customers?limit=20&search= then the debounced, trimmed term', async () => {
    const user = userEvent.setup();
    renderCombo();
    expect(mocks.get).not.toHaveBeenCalled();
    await user.click(trigger());
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith(url('')));
    await user.type(searchBox(), '  สม ');
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith(url('สม')));
  });

  it('rows show the name and a second line (phone, or the chat-lead note)', async () => {
    const user = userEvent.setup();
    renderCombo();
    await user.click(trigger());
    const somchai = await screen.findByRole('option', { name: /^สมชาย ใจดี/ });
    expect(within(somchai).getByText('0812345678')).toBeInTheDocument();
    const lead = screen.getByRole('option', { name: /^ผู้สนใจจากแชท/ });
    expect(within(lead).getByText('จากแชท · ยังไม่มีเบอร์')).toBeInTheDocument();
  });

  it('a pick hands the whole option up (chatPlaceholder kept) and closes the menu', async () => {
    const user = userEvent.setup();
    const { onChange } = renderCombo();
    await user.click(trigger());
    await user.click(await screen.findByRole('option', { name: /^ผู้สนใจจากแชท/ }));
    expect(onChange).toHaveBeenCalledWith(LEAD);
    await waitFor(() => expect(screen.queryByPlaceholderText('พิมพ์ชื่อหรือเบอร์โทร')).toBeNull());
    expect(trigger()).toHaveTextContent('ผู้สนใจจากแชท · จากแชท · ยังไม่มีเบอร์');
  });

  it('no result says "ไม่พบลูกค้า — พิมพ์ชื่อหรือเบอร์ให้ครบขึ้น"', async () => {
    mocks.rows = [];
    const user = userEvent.setup();
    renderCombo();
    await user.click(trigger());
    expect(
      await screen.findByText('ไม่พบลูกค้า — พิมพ์ชื่อหรือเบอร์ให้ครบขึ้น'),
    ).toBeInTheDocument();
  });

  it('shows a loading message while the search runs', async () => {
    let release!: () => void;
    mocks.get.mockImplementation(
      () =>
        new Promise((r) => {
          release = () => r({ data: { data: [SOMCHAI] } });
        }),
    );
    const user = userEvent.setup();
    renderCombo();
    await user.click(trigger());
    expect(await screen.findByText(/กำลังค้นหาลูกค้า|กำลังโหลด/)).toBeInTheDocument();
    release();
    expect(await screen.findByRole('option', { name: /^สมชาย ใจดี/ })).toBeInTheDocument();
  });

  it('a failed search says "โหลดลูกค้าไม่สำเร็จ" and offers a retry that asks again', async () => {
    mocks.fail = true;
    const user = userEvent.setup();
    renderCombo();
    await user.click(trigger());
    expect(await screen.findByText(/โหลดลูกค้าไม่สำเร็จ/)).toBeInTheDocument();
    const calls = mocks.get.mock.calls.length;
    await user.click(screen.getByRole('button', { name: /ลองอีกครั้ง|ลองใหม่/ }));
    await waitFor(() => expect(mocks.get.mock.calls.length).toBeGreaterThan(calls));
  });

  it('the chosen customer stays in the trigger when the next search fails', async () => {
    mocks.fail = true;
    const user = userEvent.setup();
    renderCombo({ initial: SOMCHAI });
    await user.click(trigger());
    await user.type(searchBox(), 'x');
    expect(await screen.findByText(/โหลดลูกค้าไม่สำเร็จ/)).toBeInTheDocument();
    expect(trigger()).toHaveTextContent('สมชาย ใจดี');
  });

  it('clear is a separate "ล้างลูกค้า" button: onChange(null), the menu stays closed', async () => {
    const user = userEvent.setup();
    const { onChange } = renderCombo({ initial: SOMCHAI });
    await user.click(screen.getByRole('button', { name: 'ล้างลูกค้า' }));
    expect(onChange).toHaveBeenCalledWith(null);
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(trigger()).toHaveTextContent('ค้นหาชื่อหรือเบอร์โทรลูกค้า…');
    expect(screen.queryByRole('button', { name: 'ล้างลูกค้า' })).toBeNull();
  });

  it('disabled: the trigger is disabled and there is no clear button', () => {
    renderCombo({ initial: SOMCHAI, disabled: true });
    expect(trigger()).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'ล้างลูกค้า' })).toBeNull();
  });

  it('canCreate: a create BUTTON (not an option) carries the typed name and opens create-customer with it', async () => {
    const user = userEvent.setup();
    const { onChange } = renderCombo();
    await user.click(trigger());
    expect(screen.getByRole('button', { name: 'สร้างลูกค้าใหม่' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /สร้างลูกค้าใหม่/ })).toBeNull();
    await user.type(searchBox(), 'สมศรี มีสุข');
    await user.click(screen.getByRole('button', { name: 'สร้างลูกค้าใหม่ “สมศรี มีสุข”' }));

    await waitFor(() => expect(screen.queryByPlaceholderText('พิมพ์ชื่อหรือเบอร์โทร')).toBeNull());
    expect(screen.getByTestId('create-initial')).toHaveTextContent(
      JSON.stringify({ firstName: 'สมศรี', lastName: 'มีสุข' }),
    );
    await user.click(screen.getByRole('button', { name: 'บันทึกลูกค้าใหม่ (จำลอง)' }));
    expect(onChange).toHaveBeenCalledWith({ id: 'c-new', name: 'ลูกค้าใหม่', phone: '0899999999' });
    expect(screen.queryByTestId('create-customer-dialog')).toBeNull();
    expect(trigger()).toHaveTextContent('ลูกค้าใหม่ · 0899999999');
  });

  it('create with an empty search opens create-customer with no initial values', async () => {
    const user = userEvent.setup();
    renderCombo();
    await user.click(trigger());
    await user.click(screen.getByRole('button', { name: 'สร้างลูกค้าใหม่' }));
    expect(await screen.findByTestId('create-initial')).toHaveTextContent('null');
  });

  it('canCreate=false: no create button', async () => {
    const user = userEvent.setup();
    renderCombo({ canCreate: false });
    await user.click(trigger());
    await screen.findByRole('option', { name: /^สมชาย ใจดี/ });
    expect(screen.queryByRole('button', { name: /สร้างลูกค้าใหม่/ })).toBeNull();
  });
});

// R2-3b latent bug: the create button sat inside cmdk's <Command>, whose Enter handler picks
// the highlighted row instead of pressing the focused button. Fails before the switch.
describe('Bookings CustomerCombobox — create footer (R2-3b fix)', () => {
  it('Enter on the focused "สร้างลูกค้าใหม่" button opens create-customer and picks no row', async () => {
    const user = userEvent.setup();
    const { onChange } = renderCombo();
    await user.click(trigger());
    await screen.findByRole('option', { name: /^สมชาย ใจดี/ });
    const create = screen.getByRole('button', { name: 'สร้างลูกค้าใหม่' });
    // the Combobox footer box draws the top border and padding — no second box inside it
    expect(create.parentElement).toHaveAttribute('data-slot', 'combobox-footer');
    create.focus();
    await user.keyboard('{Enter}');

    expect(await screen.findByTestId('create-customer-dialog')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Bookings CustomerCombobox — on the shared Combobox (R2-3b)', () => {
  it('pickComboOption: search → pick → onChange(option) (strict)', async () => {
    mocks.get.mockImplementation(async (path: string) => ({
      data: { data: path === url('สม') ? [SOMCHAI] : [LEAD] },
    }));
    const user = userEvent.setup();
    const { onChange } = renderCombo();
    await pickComboOption(user, 'ลูกค้า', /^สมชาย ใจดี/, { search: 'สม' });
    expect(onChange).toHaveBeenCalledWith(SOMCHAI);
    expect(mocks.get).toHaveBeenCalledWith(url('สม'));
    expect(trigger()).toHaveAttribute('data-slot', 'combobox-trigger');
  });
});
